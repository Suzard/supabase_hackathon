import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

function firstRow<T>(rows: T[] | null, what: string): T {
  const row = rows?.[0];
  if (!row) throw new Error(`supabase: insert into ${what} returned no row`);
  return row;
}

export const supabaseStore: Store = {
  async findRecipient(apiKeyHash) {
    const rows = check(await db().from("recipients").select("id").eq("api_key_hash", apiKeyHash).limit(1));
    return rows?.[0] ?? null;
  },

  async liveCandidates(provider: Provider): Promise<Candidate[]> {
    const rows = check(
      await db()
        .from("pool_keys")
        .select("id, provider, models, requests_served, tokens_served, last_error, last_used_at")
        .eq("provider", provider)
        .eq("status", "live"),
    );
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

export async function createRecipient(input: { email?: string; label?: string; apiKeyHash: string }) {
  const rows = check(
    await db()
      .from("recipients")
      .insert({ email: input.email ?? null, label: input.label ?? null, api_key_hash: input.apiKeyHash })
      .select("id"),
  );
  return firstRow(rows, "recipients") as { id: string };
}

export async function addPoolKey(input: {
  email?: string;
  provider: Provider;
  ciphertext: string;
  fingerprint: string;
  hint: string;
  models: string[];
}): Promise<{ id: string } | { duplicate: true }> {
  const existing = check(await db().from("pool_keys").select("id").eq("key_fingerprint", input.fingerprint).limit(1));
  if (existing?.length) return { duplicate: true };
  const donor = firstRow(check(await db().from("donors").insert({ email: input.email ?? null }).select("id")), "donors") as {
    id: string;
  };
  const rows = check(
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
  return firstRow(rows, "pool_keys") as { id: string };
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
  }>;
  recent: Array<{
    createdAt: string;
    provider: string;
    model: string;
    statusCode: number;
    listPriceUsd: number;
    tokens: number;
    decider: string | null;
    confidence: number | null;
    keyId: string | null;
    attempt: number;
  }>;
  totals: { donatedUsd: number; requests: number; tokens: number; liveKeys: Record<Provider, number> };
}

export async function poolStats(): Promise<PoolStats> {
  const keyRows = check(
    await db()
      .from("pool_keys")
      .select("id, provider, key_hint, status, requests_served, tokens_served, cost_absorbed_usd, last_error, last_used_at")
      .order("created_at", { ascending: true }),
  );
  const usageRows = check(
    await db()
      .from("usage")
      .select(
        "created_at, provider, model, status_code, list_price_usd, tokens_input, tokens_cache_read, tokens_cache_write, tokens_output, decision, pool_key_id, attempt",
      )
      .order("created_at", { ascending: false })
      .limit(25),
  );

  const keys = (keyRows ?? []).map((k) => ({
    id: k.id,
    provider: k.provider,
    hint: k.key_hint,
    status: k.status,
    requestsServed: k.requests_served,
    tokensServed: Number(k.tokens_served),
    costAbsorbedUsd: Number(k.cost_absorbed_usd),
    lastError: k.last_error,
    lastUsedAt: k.last_used_at,
  }));
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
      tokens: u.tokens_input + u.tokens_cache_read + u.tokens_cache_write + u.tokens_output,
      decider: u.decision?.decider ?? null,
      confidence: u.decision?.confidence ?? null,
      keyId: u.pool_key_id,
      attempt: u.attempt,
    })),
    totals: {
      donatedUsd: keys.reduce((s, k) => s + k.costAbsorbedUsd, 0),
      requests: keys.reduce((s, k) => s + k.requestsServed, 0),
      tokens: keys.reduce((s, k) => s + k.tokensServed, 0),
      liveKeys,
    },
  };
}
