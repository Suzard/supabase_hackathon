// Validates a donated key with the provider's free model-list endpoint (no tokens
// spent) and records which models it can reach. Verified endpoints:
//   OpenAI:    GET https://api.openai.com/v1/models (Bearer)
//   Anthropic: GET https://api.anthropic.com/v1/models (x-api-key, anthropic-version; limit 1..1000)
// A key that lists models but has no credit passes here and is caught on first use.

import type { Provider } from "./providers";

export type ProbeResult = { ok: true; models: string[] } | { ok: false; status: number; reason: string };

const REQUESTS: Record<Provider, (key: string) => [string, RequestInit]> = {
  openai: (key) => ["https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } }],
  anthropic: (key) => [
    "https://api.anthropic.com/v1/models?limit=1000",
    { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } },
  ],
};

export async function probeKey(provider: Provider, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const [url, init] = REQUESTS[provider](apiKey);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    return { ok: false, status: 0, reason: `could not reach ${provider}: ${err instanceof Error ? err.message : err}` };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `${provider} rejected the key (${res.status}): ${(await res.text()).slice(0, 300)}` };
  }
  const data = ((await res.json()) as { data?: Array<{ id?: unknown }> }).data ?? [];
  return { ok: true, models: data.map((m) => m.id).filter((id): id is string => typeof id === "string") };
}
