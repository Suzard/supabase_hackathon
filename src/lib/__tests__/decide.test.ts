import { describe, expect, it, vi } from "vitest";
import { decide, rankDeterministic, type Candidate, type RequestFeatures } from "../decide";
import { JEV_URL } from "../jev";

const features: RequestFeatures = {
  provider: "openai",
  model: "gpt-6.1-sol",
  approxPromptTokens: 40,
  hasTools: false,
  stream: false,
  preview: "hello",
};
const cand = (id: string, requestsServed: number, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  provider: "openai",
  models: ["gpt-6.1-sol"],
  requestsServed,
  tokensServed: requestsServed * 100,
  lastError: null,
  lastUsedAt: null,
  ...extra,
});

// Response shape from https://docs.typesafe.ai/api (Choice answer).
const jevResponse = (choice: string, probabilities: Record<string, number>) =>
  new Response(
    JSON.stringify({
      model: "jev-1.13.0",
      answers: { route: { type: "choice", choice, probabilities, confidence: 0.8 } },
      usage: { input_tokens: 300, output_tokens: 20 },
    }),
    { status: 200 },
  );

describe("rankDeterministic", () => {
  it("prefers the least-used key", () => {
    expect(rankDeterministic([cand("a", 5), cand("b", 1), cand("c", 3)])).toEqual(["b", "c", "a"]);
  });
});

describe("decide", () => {
  it("skips the decider for a single candidate", async () => {
    const fetchImpl = vi.fn();
    const d = await decide(features, [cand("a", 0)], { jevApiKey: "k", fetchImpl });
    expect(d).toMatchObject({ decider: "single", ranking: ["a"] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to deterministic without a Gateway key", async () => {
    const d = await decide(features, [cand("a", 5), cand("b", 1)]);
    expect(d).toMatchObject({ decider: "deterministic", ranking: ["b", "a"], fallbackReason: "AI_GATEWAY_API_KEY not set" });
  });

  it("asks Jev with labeled options and ranks by its answer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jevResponse("k2", { k1: 0.1, k2: 0.6, k3: 0.3 }));
    const d = await decide(features, [cand("a", 0), cand("b", 9), cand("c", 2)], { jevApiKey: "gw-key", fetchImpl });
    expect(d).toMatchObject({ decider: "jev", ranking: ["b", "c", "a"], confidence: 0.8, jevModel: "jev-1.13.0" });
    expect(d.probabilities).toEqual({ a: 0.1, b: 0.6, c: 0.3 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(JEV_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer gw-key");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("typesafe-ai/jev");
    expect(body.questions.route.type).toBe("choice");
    expect(Object.keys(body.questions.route.criteria)).toEqual(["k1", "k2", "k3"]);
    expect(JSON.stringify(body.state)).not.toContain("gw-key");
  });

  it("falls back to deterministic when Jev errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("overloaded", { status: 529 }));
    const d = await decide(features, [cand("a", 5), cand("b", 1)], {
      jevApiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(d.decider).toBe("deterministic");
    expect(d.ranking).toEqual(["b", "a"]);
    expect(d.fallbackReason).toMatch(/Jev 529/);
  });

  it("falls back when Jev picks an option that does not exist", async () => {
    const fetchImpl = vi.fn(async () => jevResponse("k9", { k1: 0.5, k2: 0.5 }));
    const d = await decide(features, [cand("a", 1), cand("b", 0)], {
      jevApiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(d).toMatchObject({ decider: "deterministic", ranking: ["b", "a"] });
  });
});
