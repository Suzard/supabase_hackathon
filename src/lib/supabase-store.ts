import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BillingStore } from "./billing";
import type { Candidate } from "./decide";
import { env } from "./env";
import type { Provider } from "./providers";
import type { Store, UsageRow } from "./store";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  client ??= createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(`supabase: ${error.message}`);
  return data;
}

function missingRpc(error: unknown, fn: string): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("schema cache") && msg.includes(`function public.${fn}`);
}

function missingTable(error: unknown, table?: string): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (!msg.includes("schema cache") || !msg.includes("could not find the table")) return false;
  return table ? msg.includes(`public.${table}`) : true;
}

function missingColumn(error: unknown, column?: string): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (!msg.includes("column") || !msg.includes("does not exist")) return false;
  return column ? msg.includes(column.toLowerCase()) : true;
}

function firstRow<T>(rows: T[] | null, what: string): T {
  const row = rows?.[0];
  if (!row) throw new Error(`supabase: insert into ${what} returned no row`);
  return row;
}

type LiveCandidateRow = {
  id: string;
  provider: Provider;
  models: string[] | null;
  requests_served: number;
  tokens_served: number | string;
  last_error: string | null;
  last_used_at: string | null;
};

type DonorCompat = {
  email?: string | null;
  display_name?: string | null;
  oauth_provider?: string | null;
  oauth_subject?: string | null;
};

type PoolKeyCompat = {
  id: string;
  provider: Provider;
  key_hint: string;
  status: string;
  requests_served: number;
  tokens_served: number | string;
  cost_absorbed_usd: number | string;
  last_error: string | null;
  last_used_at: string | null;
  expires_at?: string | null;
  event_tag?: string | null;
  donor?: DonorCompat | DonorCompat[] | null;
};

export const supabaseStore: Store = {
  async findRecipient(apiKeyHash) {
    const rows = check(await db().from("recipients").select("id").eq("api_key_hash", apiKeyHash).limit(1));
    return rows?.[0] ?? null;
  },

  async liveCandidates(provider: Provider): Promise<Candidate[]> {
    const nowIso = new Date().toISOString();
    let rows: LiveCandidateRow[] | null;
    try {
      rows = check(
        await db()
          .from("pool_keys")
          .select("id, provider, models, requests_served, tokens_served, last_error, last_used_at")
          .eq("provider", provider)
          .eq("status", "live")
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      );
    } catch (error) {
      if (!missingColumn(error, "expires_at")) throw error;
      rows = check(
        await db()
          .from("pool_keys")
          .select("id, provider, models, requests_served, tokens_served, last_error, last_used_at")
          .eq("provider", provider)
          .eq("status", "live"),
      );
    }
    return (rows ?? []).map((r) => ({
      id: r.id,
      provider: r.provider,
      models: r.models ?? [],
      requestsServed: r.requests_served,
      tokensServed: Number(r.tokens_served),
      lastError: r.last_error,
      lastUsedAt: r.last_used_at,
    }));
  },

  async keySecret(id) {
    const rows = check(await db().from("pool_keys").select("key_ciphertext, key_hint").eq("id", id).limit(1));
    const row = rows?.[0];
    return row ? { ciphertext: row.key_ciphertext, hint: row.key_hint } : null;
  },

  async markKey(id, status, lastError) {
    const patch: Record<string, unknown> = { last_error: lastError };
    if (status) patch.status = status;
    check(await db().from("pool_keys").update(patch).eq("id", id));
  },

  async insertUsage(row: UsageRow) {
    check(
      await db().from("usage").insert({
        recipient_id: row.recipientId,
        pool_key_id: row.poolKeyId,
        provider: row.provider,
        protocol: row.protocol,
        model: row.model,
        stream: row.stream,
        tokens_input: row.usage.input,
        tokens_cache_read: row.usage.cacheRead,
        tokens_cache_write: row.usage.cacheWrite,
        tokens_output: row.usage.output,
        list_price_usd: row.listPriceUsd,
        charged_usd: row.chargedUsd,
        price_known: row.priceKnown,
        status_code: row.statusCode,
        error_body: row.errorBody,
        decision: row.decision,
        attempt: row.attempt,
        latency_ms: row.latencyMs,
      }),
    );
  },

  async recordKeyUsage(id, tokens, costUsd) {
    check(await db().rpc("record_key_usage", { p_key_id: id, p_tokens: tokens, p_cost: costUsd }));
  },
};

export async function createRecipient(input: { email: string; label?: string; apiKeyHash: string }) {
  const rows = check(
    await db()
      .from("recipients")
      .insert({ email: input.email, label: input.label ?? null, api_key_hash: input.apiKeyHash })
      .select("id"),
  );
  return firstRow(rows, "recipients") as { id: string };
}

export type DonorOwner = {
  provider: "github";
  subject: string;
  email?: string | null;
  name?: string | null;
};

async function findDonorId(owner: DonorOwner): Promise<string | null> {
  const rows = check(
    await db().from("donors").select("id").eq("oauth_provider", owner.provider).eq("oauth_subject", owner.subject).limit(1),
  );
  return rows?.[0]?.id ?? null;
}

async function ensureDonor(input: { email?: string; owner?: DonorOwner }): Promise<{ id: string }> {
  if (input.owner) {
    const existingId = await findDonorId(input.owner);
    if (existingId) {
      if (input.owner.email || input.owner.name) {
        try {
          check(
            await db()
              .from("donors")
              .update({ email: input.owner.email ?? undefined, display_name: input.owner.name ?? undefined })
              .eq("id", existingId),
          );
        } catch (error) {
          if (!missingColumn(error, "display_name")) throw error;
          check(await db().from("donors").update({ email: input.owner.email ?? undefined }).eq("id", existingId));
        }
      }
      return { id: existingId };
    }
  }

  let rows;
  try {
    rows = check(
      await db()
        .from("donors")
        .insert({
          email: input.owner?.email ?? input.email ?? null,
          display_name: input.owner?.name ?? null,
          oauth_provider: input.owner?.provider ?? null,
          oauth_subject: input.owner?.subject ?? null,
        })
        .select("id"),
    );
  } catch (error) {
    if (!missingColumn(error)) throw error;
    rows = check(
      await db()
        .from("donors")
        .insert({
          email: input.owner?.email ?? input.email ?? null,
        })
        .select("id"),
    );
  }
  return firstRow(rows, "donors") as { id: string };
}

export async function addPoolKey(input: {
  email?: string;
  owner?: DonorOwner;
  expiresAt?: string | null;
  eventTag?: string | null;
  provider: Provider;
  ciphertext: string;
  fingerprint: string;
  hint: string;
  models: string[];
}): Promise<{ id: string } | { duplicate: true }> {
  const existing = check(await db().from("pool_keys").select("id").eq("key_fingerprint", input.fingerprint).limit(1));
  if (existing?.length) return { duplicate: true };
  const donor = await ensureDonor({ email: input.email, owner: input.owner });
  let rows;
  try {
    rows = check(
      await db()
        .from("pool_keys")
        .insert({
          donor_id: donor.id,
          provider: input.provider,
          key_ciphertext: input.ciphertext,
          key_fingerprint: input.fingerprint,
          key_hint: input.hint,
          models: input.models,
          expires_at: input.expiresAt ?? null,
          event_tag: input.eventTag ?? null,
        })
        .select("id"),
    );
  } catch (error) {
    if (!missingColumn(error)) throw error;
    rows = check(
      await db()
        .from("pool_keys")
        .insert({
          donor_id: donor.id,
          provider: input.provider,
          key_ciphertext: input.ciphertext,
          key_fingerprint: input.fingerprint,
          key_hint: input.hint,
          models: input.models,
        })
        .select("id"),
    );
  }
  return firstRow(rows, "pool_keys") as { id: string };
}

export async function deletePoolKeyById(id: string, owner: DonorOwner): Promise<boolean> {
  const donorId = await findDonorId(owner);
  if (!donorId) return false;
  const rows = check(await db().from("pool_keys").delete().eq("id", id).eq("donor_id", donorId).select("id").limit(1));
  return Boolean(rows?.[0]);
}

export async function deletePoolKeyByIdAny(id: string): Promise<boolean> {
  const rows = check(await db().from("pool_keys").delete().eq("id", id).select("id").limit(1));
  return Boolean(rows?.[0]);
}

export interface PoolStats {
  keys: Array<{
    id: string;
    provider: Provider;
    hint: string;
    status: string;
    requestsServed: number;
    tokensServed: number;
    costAbsorbedUsd: number;
    lastError: string | null;
    lastUsedAt: string | null;
    expiresAt: string | null;
    eventTag: string | null;
    donorName: string | null;
    donorEmail: string | null;
    donorAuthProvider: string | null;
    donorAuthSubject: string | null;
  }>;
  recent: Array<{
    createdAt: string;
    provider: string;
    model: string;
    statusCode: number;
    listPriceUsd: number;
    chargedUsd: number;
    tokens: number;
    decider: string | null;
    confidence: number | null;
    keyId: string | null;
    attempt: number;
  }>;
  totals: {
    donatedUsd: number;
    chargedUsd: number;
    requests: number;
    tokens: number;
    liveKeys: Record<Provider, number>;
  };
}

async function totalCharged(): Promise<number> {
  try {
    return Number(check(await db().rpc("charged_total")) ?? 0);
  } catch (error) {
    if (!missingRpc(error, "charged_total")) throw error;
    try {
      const rows = check(await db().from("usage").select("charged_usd")) as Array<{ charged_usd: string | number }> | null;
      return (rows ?? []).reduce((sum, row) => sum + Number(row.charged_usd ?? 0), 0);
    } catch (usageError) {
      if (missingTable(usageError, "usage")) return 0;
      throw usageError;
    }
  }
}

export async function poolStats(): Promise<PoolStats> {
  try {
    const [usageResult, chargedUsd] = await Promise.all([
      db()
        .from("usage")
        .select(
          "created_at, provider, model, status_code, list_price_usd, charged_usd, tokens_input, tokens_cache_read, tokens_cache_write, tokens_output, decision, pool_key_id, attempt",
        )
        .order("created_at", { ascending: false })
        .limit(25),
      totalCharged(),
    ]);

    let keyRows;
    try {
      keyRows = check(
        await db()
          .from("pool_keys")
          .select(
            "id, provider, key_hint, status, requests_served, tokens_served, cost_absorbed_usd, last_error, last_used_at, expires_at, event_tag, donor:donors(email, display_name, oauth_provider, oauth_subject)",
          )
          .order("created_at", { ascending: true }),
      );
    } catch (error) {
      if (!missingColumn(error)) throw error;
      keyRows = check(
        await db()
          .from("pool_keys")
          .select(
            "id, provider, key_hint, status, requests_served, tokens_served, cost_absorbed_usd, last_error, last_used_at, donor:donors(email)",
          )
          .order("created_at", { ascending: true }),
      );
    }

    const usageRows = check(usageResult);

    const keys = (keyRows ?? []).map((k) => {
      const row = k as unknown as PoolKeyCompat;
      const donor = Array.isArray(row.donor) ? row.donor[0] : row.donor;
      return {
        id: row.id,
        provider: row.provider,
        hint: row.key_hint,
        status: row.status,
        requestsServed: row.requests_served,
        tokensServed: Number(row.tokens_served),
        costAbsorbedUsd: Number(row.cost_absorbed_usd),
        lastError: row.last_error,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at ?? null,
        eventTag: row.event_tag ?? null,
        donorName: donor?.display_name ?? null,
        donorEmail: donor?.email ?? null,
        donorAuthProvider: donor?.oauth_provider ?? null,
        donorAuthSubject: donor?.oauth_subject ?? null,
      };
    });
    const liveKeys = { openai: 0, anthropic: 0 } as Record<Provider, number>;
    for (const k of keys) if (k.status === "live") liveKeys[k.provider as Provider] += 1;

    return {
      keys,
      recent: (usageRows ?? []).map((u) => ({
        createdAt: u.created_at,
        provider: u.provider,
        model: u.model,
        statusCode: u.status_code,
        listPriceUsd: Number(u.list_price_usd),
        chargedUsd: Number(u.charged_usd),
        tokens: u.tokens_input + u.tokens_cache_read + u.tokens_cache_write + u.tokens_output,
        decider: u.decision?.decider ?? null,
        confidence: u.decision?.confidence ?? null,
        keyId: u.pool_key_id,
        attempt: u.attempt,
      })),
      totals: {
        donatedUsd: keys.reduce((s, k) => s + k.costAbsorbedUsd, 0),
        chargedUsd,
        requests: keys.reduce((s, k) => s + k.requestsServed, 0),
        tokens: keys.reduce((s, k) => s + k.tokensServed, 0),
        liveKeys,
      },
    };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return {
      keys: [],
      recent: [],
      totals: {
        donatedUsd: 0,
        chargedUsd: 0,
        requests: 0,
        tokens: 0,
        liveKeys: { openai: 0, anthropic: 0 },
      },
    };
  }
}

export const billingStore: BillingStore = {
  async claimUnbilled(recipientId, minUsd) {
    const rows = check(await db().rpc("claim_unbilled", { p_recipient: recipientId, p_min_usd: minUsd })) as Array<{
      invoice_id: string;
      amount_usd: string | number;
      amount_cents: number;
      request_count: number;
    }> | null;
    const row = rows?.[0];
    if (!row) return null;
    return {
      invoiceId: row.invoice_id,
      amountUsd: Number(row.amount_usd),
      amountCents: row.amount_cents,
      requestCount: row.request_count,
    };
  },

  async releaseInvoice(invoiceId, error) {
    check(await db().rpc("release_invoice", { p_invoice: invoiceId, p_error: error.slice(0, 1000) }));
  },

  async recipientForBilling(recipientId) {
    const rows = check(await db().from("recipients").select("email, stripe_customer_id").eq("id", recipientId).limit(1));
    const row = rows?.[0];
    return row ? { email: row.email, stripeCustomerId: row.stripe_customer_id } : null;
  },

  async setStripeCustomer(recipientId, stripeCustomerId) {
    check(await db().from("recipients").update({ stripe_customer_id: stripeCustomerId }).eq("id", recipientId));
  },

  async markInvoiceIssued(invoiceId, issued) {
    check(
      await db()
        .from("invoices")
        .update({
          status: "open",
          stripe_invoice_id: issued.stripeInvoiceId,
          hosted_invoice_url: issued.hostedInvoiceUrl,
          error: issued.error ?? null,
        })
        .eq("id", invoiceId),
    );
  },
};

export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible";

/** Applies a Stripe webhook's invoice status to our invoice row. */
export async function setInvoiceStatus(stripeInvoiceId: string, status: InvoiceStatus) {
  const patch: Record<string, unknown> = { status };
  if (status === "paid") patch.paid_at = new Date().toISOString();
  check(await db().from("invoices").update(patch).eq("stripe_invoice_id", stripeInvoiceId));
}

export interface BillingSummary {
  unbilledUsd: number;
  invoices: Array<{
    amountUsd: number;
    requestCount: number;
    status: string;
    hostedInvoiceUrl: string | null;
    createdAt: string;
  }>;
}

export async function billingSummary(recipientId: string): Promise<BillingSummary> {
  const [unbilled, invoiceRows] = await Promise.all([
    db().from("usage").select("charged_usd").eq("recipient_id", recipientId).is("invoice_id", null),
    db()
      .from("invoices")
      .select("amount_usd, request_count, status, hosted_invoice_url, created_at")
      .eq("recipient_id", recipientId)
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  return {
    unbilledUsd: (check(unbilled) ?? []).reduce((sum, r) => sum + Number(r.charged_usd), 0),
    invoices: (check(invoiceRows) ?? []).map((i) => ({
      amountUsd: Number(i.amount_usd),
      requestCount: i.request_count,
      status: i.status,
      hostedInvoiceUrl: i.hosted_invoice_url,
      createdAt: i.created_at,
    })),
  };
}
