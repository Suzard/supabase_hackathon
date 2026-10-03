import { askJev, buildJevRequest, parseJevChoice } from "./jev";
import type { Provider } from "./providers";

export interface Candidate {
  id: string;
  provider: Provider;
  models: string[];
  requestsServed: number;
  tokensServed: number;
  lastError: string | null;
  lastUsedAt: string | null;
}

/** What the decider sees about a request. Never the full prompt (Jev's state limit is 32k). */
export interface RequestFeatures {
  provider: Provider;
  model: string;
  approxPromptTokens: number;
  hasTools: boolean;
  stream: boolean;
  preview: string;
}

export interface Decision {
  decider: "jev" | "deterministic" | "single";
  /** Candidate IDs in the order to try them. */
  ranking: string[];
  probabilities?: Record<string, number>;
  confidence?: number | null;
  jevModel?: string | null;
  /** Why Jev was not used, when it was expected. */
  fallbackReason?: string;
  latencyMs: number;
}

/** Spread load: fewest requests first, then least recently used. */
export function rankDeterministic(candidates: Candidate[]): string[] {
  return [...candidates]
    .sort(
      (a, b) =>
        a.requestsServed - b.requestsServed ||
        (a.lastUsedAt ?? "").localeCompare(b.lastUsedAt ?? ""),
    )
    .map((c) => c.id);
}

export async function decide(
  features: RequestFeatures,
  candidates: Candidate[],
  deps: { jevApiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Decision> {
  const started = Date.now();
  if (candidates.length === 0) throw new Error("decide() needs at least one candidate");
  if (candidates.length === 1) {
    return { decider: "single", ranking: [candidates[0].id], latencyMs: 0 };
  }

  const deterministic = (fallbackReason: string): Decision => ({
    decider: "deterministic",
    ranking: rankDeterministic(candidates),
    fallbackReason,
    latencyMs: Date.now() - started,
  });

  if (!deps.jevApiKey) return deterministic("AI_GATEWAY_API_KEY not set");

  try {
    const { body, labels } = buildJevRequest(features, candidates);
    const choice = parseJevChoice(
      await askJev(body, deps.jevApiKey, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs }),
      labels,
    );
    // Anything beyond Jev's option cap still gets a turn, after Jev's picks.
    const rest = rankDeterministic(candidates).filter((id) => !choice.ranking.includes(id));
    return {
      decider: "jev",
      ranking: [...choice.ranking, ...rest],
      probabilities: choice.probabilities,
      confidence: choice.confidence,
      jevModel: choice.model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return deterministic(err instanceof Error ? err.message : String(err));
  }
}
