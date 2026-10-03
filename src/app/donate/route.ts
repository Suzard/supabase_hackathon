import { encrypt, hashApiKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { probeKey } from "@/lib/probe";
import { isProvider, keyHint } from "@/lib/providers";
import { addPoolKey } from "@/lib/supabase-store";

/** Adds a provider API key to the pool after confirming the provider accepts it. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; api_key?: unknown; email?: unknown };
  if (!isProvider(body.provider)) {
    return Response.json({ error: "`provider` must be \"openai\" or \"anthropic\"" }, { status: 400 });
  }
  if (typeof body.api_key !== "string" || body.api_key.trim().length < 8) {
    return Response.json({ error: "`api_key` is required" }, { status: 400 });
  }
  const apiKey = body.api_key.trim();
  const email = typeof body.email === "string" ? body.email.slice(0, 320) : undefined;

  const probe = await probeKey(body.provider, apiKey);
  if (!probe.ok) return Response.json({ error: probe.reason }, { status: 422 });

  const added = await addPoolKey({
    email,
    provider: body.provider,
    ciphertext: encrypt(apiKey, env.poolEncryptionKey()),
    fingerprint: hashApiKey(apiKey),
    hint: keyHint(apiKey),
    models: probe.models,
  });
  if ("duplicate" in added) return Response.json({ error: "This key is already in the pool" }, { status: 409 });

  return Response.json(
    { id: added.id, provider: body.provider, key_hint: keyHint(apiKey), models_reachable: probe.models.length },
    { status: 201 },
  );
}
