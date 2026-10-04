import { encrypt, hashApiKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { readSessionFromRequest } from "@/lib/oauth-session";
import { probeKey } from "@/lib/probe";
import { isProvider, keyHint } from "@/lib/providers";
import { addPoolKey, deletePoolKeyByIdAny } from "@/lib/supabase-store";

function missingTable(error: unknown, table: string): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("schema cache") && msg.includes(`public.${table}`);
}

/** Adds a provider API key to the pool after confirming the provider accepts it. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    provider?: unknown;
    api_key?: unknown;
    email?: unknown;
    duration_days?: unknown;
    event_tag?: unknown;
  };
  if (!isProvider(body.provider)) {
    return Response.json({ error: "`provider` must be \"openai\" or \"anthropic\"" }, { status: 400 });
  }
  if (typeof body.api_key !== "string" || body.api_key.trim().length < 8) {
    return Response.json({ error: "`api_key` is required" }, { status: 400 });
  }
  const apiKey = body.api_key.trim();
  const sessionSecret = env.oauthSessionSecret();
  const session = sessionSecret ? readSessionFromRequest(request, sessionSecret) : null;
  const email = typeof body.email === "string" ? body.email.slice(0, 320) : session?.email ?? undefined;
  const eventTag = typeof body.event_tag === "string" && body.event_tag.trim()
    ? body.event_tag.trim().slice(0, 80)
    : undefined;
  const durationDaysRaw = typeof body.duration_days === "number" ? body.duration_days : Number(body.duration_days ?? 30);
  const durationDays = Number.isFinite(durationDaysRaw) ? Math.min(365, Math.max(1, Math.trunc(durationDaysRaw))) : 30;
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const probe = await probeKey(body.provider, apiKey);
  if (!probe.ok) return Response.json({ error: probe.reason }, { status: 422 });

  let added: Awaited<ReturnType<typeof addPoolKey>>;
  try {
    added = await addPoolKey({
      email,
      owner: session ? { provider: session.provider, subject: session.subject, email: session.email, name: session.name } : undefined,
      expiresAt,
  eventTag,
      provider: body.provider,
      ciphertext: encrypt(apiKey, env.poolEncryptionKey()),
      fingerprint: hashApiKey(apiKey),
      hint: keyHint(apiKey),
      models: probe.models,
    });
  } catch (error) {
    if (missingTable(error, "pool_keys") || missingTable(error, "donors")) {
      return Response.json(
        {
          error:
            "Donation backend is not initialized yet (missing Supabase tables). Apply migrations, then retry donation.",
        },
        { status: 503 },
      );
    }
    throw error;
  }
  if ("duplicate" in added) return Response.json({ error: "This key is already in the pool" }, { status: 409 });

  return Response.json(
    {
      id: added.id,
      provider: body.provider,
      key_hint: keyHint(apiKey),
      models_reachable: probe.models.length,
      expires_at: expiresAt,
      donor: session?.name ?? email ?? null,
      event_tag: eventTag ?? null,
    },
    { status: 201 },
  );
}

/** Removes a donated key from the pool by id. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id.trim()) {
    return Response.json({ error: "`id` is required" }, { status: 400 });
  }

  try {
    const removed = await deletePoolKeyByIdAny(body.id.trim());
    if (!removed) return Response.json({ error: "Key not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    if (missingTable(error, "pool_keys")) {
      return Response.json({ error: "Donation backend is not initialized yet." }, { status: 503 });
    }
    throw error;
  }
}
