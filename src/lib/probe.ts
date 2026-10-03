// Validates a donated key with the provider's free model-list endpoint (no tokens
// spent) and records which models it can reach. Verified endpoints:
//   OpenAI:    GET https://api.openai.com/v1/models (Bearer)
//   Anthropic: GET https://api.anthropic.com/v1/models (x-api-key, anthropic-version; limit 1..1000)
// A key that lists models but has no credit passes here and is caught on first use.

import { PROVIDER_NAME, type Provider } from "./providers";

export type ProbeResult = { ok: true; models: string[] } | { ok: false; status: number; reason: string };

const REQUESTS: Record<Provider, (key: string) => [string, RequestInit]> = {
  openai: (key) => ["https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } }],
  anthropic: (key) => [
    "https://api.anthropic.com/v1/models?limit=1000",
    { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } },
  ],
};

/**
 * The human-readable part of a provider error body. Both providers nest it at
 * `error.message`; anything unparseable falls back to the raw text, trimmed.
 */
export function providerErrorMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    // Not JSON.
  }
  return body.trim().slice(0, 200) || "no details";
}

export async function probeKey(provider: Provider, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const [url, init] = REQUESTS[provider](apiKey);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    return { ok: false, status: 0, reason: `Couldn't reach ${PROVIDER_NAME[provider]}: ${err instanceof Error ? err.message : err}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      reason: `${PROVIDER_NAME[provider]} rejected the key: ${providerErrorMessage(await res.text())}`,
    };
  }
  const data = ((await res.json()) as { data?: Array<{ id?: unknown }> }).data ?? [];
  return { ok: true, models: data.map((m) => m.id).filter((id): id is string => typeof id === "string") };
}
