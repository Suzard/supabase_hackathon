// Jev (TypeSafe's System One decision model) through AI Gateway's TypeSafe-compatible
// endpoint. Verified shapes:
//   https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe
//   https://docs.typesafe.ai/api
// A Choice question returns { type, choice, probabilities, confidence }.

import type { Candidate, RequestFeatures } from "./decide";

export const JEV_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
export const JEV_MODEL = "typesafe-ai/jev";
const QUESTION_ID = "route";
const MAX_OPTIONS = 255; // Choice limit

export interface JevRequest {
  model: string;
  state: unknown;
  questions: Record<string, unknown>;
}

export interface JevChoice {
  /** Candidate IDs ordered by Jev's probability, best first. */
  ranking: string[];
  probabilities: Record<string, number>;
  confidence: number | null;
  model: string | null;
}

/**
 * Options are short labels (k1, k2, ...) rather than UUIDs so the model reasons over
 * readable names; `labels` maps them back to candidate IDs.
 */
export function buildJevRequest(
  features: RequestFeatures,
  candidates: Candidate[],
): { body: JevRequest; labels: Map<string, string> } {
  const labels = new Map<string, string>();
  const criteria: Record<string, unknown> = {};
  candidates.slice(0, MAX_OPTIONS).forEach((c, i) => {
    const label = `k${i + 1}`;
    labels.set(label, c.id);
    criteria[label] = {
      provider: c.provider,
      can_serve_requested_model: c.models.length === 0 ? "unknown" : c.models.includes(features.model),
      requests_served: c.requestsServed,
      tokens_served: c.tokensServed,
      last_error: c.lastError ?? "none",
      last_used_at: c.lastUsedAt ?? "never",
    };
  });

  return {
    labels,
    body: {
      model: JEV_MODEL,
      state: { incoming_request: features },
      questions: {
        [QUESTION_ID]: {
          type: "choice",
          instructions:
            "Pick the donated API key that should serve `incoming_request`. Prefer keys that can serve the " +
            "requested model and have no recent errors. Among healthy keys, prefer the one that has served " +
            "fewer requests and tokens, so load spreads across donors.",
          criteria,
        },
      },
    },
  };
}

export function parseJevChoice(json: unknown, labels: Map<string, string>): JevChoice {
  const answer = (json as { answers?: Record<string, unknown> })?.answers?.[QUESTION_ID] as
    | { type?: unknown; choice?: unknown; probabilities?: unknown; confidence?: unknown }
    | undefined;
  if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") {
    throw new Error("Jev response has no choice answer");
  }
  const rawProbs = (answer.probabilities ?? {}) as Record<string, unknown>;
  const probabilities: Record<string, number> = {};
  for (const [label, id] of labels) {
    const p = Number(rawProbs[label]);
    probabilities[id] = Number.isFinite(p) ? p : 0;
  }
  const chosen = labels.get(answer.choice);
  if (!chosen) throw new Error(`Jev chose unknown option ${answer.choice}`);
  const ranking = [...labels.values()].sort((a, b) => {
    if (a === chosen) return -1;
    if (b === chosen) return 1;
    return probabilities[b] - probabilities[a];
  });
  const model = (json as { model?: unknown }).model;
  return {
    ranking,
    probabilities,
    confidence: typeof answer.confidence === "number" ? answer.confidence : null,
    model: typeof model === "string" ? model : null,
  };
}

export async function askJev(
  body: JevRequest,
  apiKey: string,
  { fetchImpl = fetch, timeoutMs = 4000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<unknown> {
  const res = await fetchImpl(JEV_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
