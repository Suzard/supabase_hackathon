import { describe, expect, it, vi } from "vitest";
import { hashApiKey } from "../crypto";
import type { Candidate } from "../decide";
import { buildPriceTable } from "../pricing";
import { anthropicMessages, openaiResponses } from "../protocols";
import { routeRequest, type RouterDeps } from "../router";
import type { Store, UsageRow } from "../store";

const CALLER = "tc_live_caller";

function makeStore(keys: Array<{ id: string; provider: "openai" | "anthropic"; secret: string; requestsServed?: number }>) {
  const marks: Array<{ id: string; status: string | null; lastError: string }> = [];
  const usage: UsageRow[] = [];
  const store: Store = {
    findRecipient: async (hash) => (hash === hashApiKey(CALLER) ? { id: "r1" } : null),
    liveCandidates: async (provider) =>
      keys
        .filter((k) => k.provider === provider && !marks.some((m) => m.id === k.id && m.status))
        .map<Candidate>((k) => ({
          id: k.id,
          provider: k.provider,
          models: [],
          requestsServed: k.requestsServed ?? 0,
          tokensServed: 0,
          lastError: null,
          lastUsedAt: null,
        })),
    keySecret: async (id) => {
      const k = keys.find((x) => x.id === id);
      return k ? { ciphertext: k.secret, hint: k.secret.slice(-4) } : null;
    },
    markKey: async (id, status, lastError) => void marks.push({ id, status, lastError }),
    insertUsage: async (row) => void usage.push(row),
    recordKeyUsage: async () => {},
  };
  return { store, marks, usage };
}

function deps(store: Store, fetchImpl: typeof fetch): RouterDeps & { flush: () => Promise<void> } {
  const pending: Array<() => Promise<void>> = [];
  return {
    store,
    decryptKey: (c) => c, // test secrets are stored "decrypted"
    getPrices: async () =>
      buildPriceTable({
        data: [
          { id: "anthropic/claude-opus-5.5", pricing: { input: "0.000004", output: "0.00002", input_cache_read: "0.0000002", input_cache_write: "0.000005" } },
          { id: "openai/gpt-6.1-sol", pricing: { input: "0.000002", output: "0.00001", input_cache_read: "0.0000001", input_cache_write: "0.0000025" } },
        ],
      }),
    defer: (task) => void pending.push(task),
    charge: async () => {},
    fetchImpl,
    flush: async () => {
      while (pending.length) await pending.shift()!();
    },
  };
}

const messagesBody = '{"model":"claude-opus-5-5","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}';
const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CALLER, "anthropic-version": "2023-06-01", "content-type": "application/json", ...headers },
    body,
  });

describe("routeRequest", () => {
  it("rejects a missing or unknown Token Charity key with a provider-shaped error", async () => {
    const { store } = makeStore([]);
    const d = deps(store, vi.fn());
    const missing = await routeRequest(new Request("http://x/v1/messages", { method: "POST", body: "{}" }), anthropicMessages, d);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ type: "error", error: { type: "authentication_error" } });
    const unknown = await routeRequest(req(messagesBody, { "x-api-key": "tc_live_nope" }), anthropicMessages, d);
    expect(unknown.status).toBe(401);
  });

  it("returns 503 pointing at /donate when the pool is empty", async () => {
    const { store } = makeStore([]);
    const res = await routeRequest(req(messagesBody), anthropicMessages, deps(store, vi.fn()));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain("/donate");
  });

  it("forwards the exact body with the donated key, never the caller's", async () => {
    const { store, usage } = makeStore([{ id: "k1", provider: "anthropic", secret: "sk-ant-donor-AAAA" }]);
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      Response.json({ id: "msg_1", usage: { input_tokens: 10, output_tokens: 5 } }, { headers: { "anthropic-organization-id": "donor" } }),
    );
    const d = deps(store, fetchImpl as unknown as typeof fetch);
    const res = await routeRequest(req(messagesBody, { "anthropic-beta": "interleaved-thinking-2025-05-14" }), anthropicMessages, d);
    await d.flush();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-token-charity-key")).toBe("AAAA");
    expect(res.headers.get("anthropic-organization-id")).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.body).toBe(messagesBody);
    const sent = init?.headers as Headers;
    expect(sent.get("x-api-key")).toBe("sk-ant-donor-AAAA");
    expect(sent.get("anthropic-beta")).toBe("interleaved-thinking-2025-05-14");
    expect(JSON.stringify([...sent.entries()])).not.toContain(CALLER);

    expect(usage[0]).toMatchObject({ poolKeyId: "k1", statusCode: 200, usage: { input: 10, output: 5 }, priceKnown: true });
    expect(usage[0].listPriceUsd).toBeCloseTo(0.000004 * 10 + 0.00002 * 5, 12);
  });

  it("reroutes past an out-of-credit key, marks it exhausted, and serves from the next", async () => {
    const { store, marks, usage } = makeStore([
      { id: "dead", provider: "anthropic", secret: "sk-dead", requestsServed: 0 },
      { id: "good", provider: "anthropic", secret: "sk-good", requestsServed: 5 },
    ]);
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const key = (init?.headers as Headers).get("x-api-key");
      return key === "sk-dead"
        ? Response.json({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, { status: 400 })
        : Response.json({ usage: { input_tokens: 3, output_tokens: 2 } });
    });
    const d = deps(store, fetchImpl as unknown as typeof fetch);
    const res = await routeRequest(req(messagesBody), anthropicMessages, d);
    await d.flush();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-token-charity-attempt")).toBe("2");
    expect(marks).toEqual([expect.objectContaining({ id: "dead", status: "exhausted" })]);
    expect(usage.map((u) => [u.poolKeyId, u.statusCode])).toEqual([
      ["dead", 400],
      ["good", 200],
    ]);
    expect(usage[0].errorBody).toContain("credit balance is too low");
  });

  it("never surfaces a dead donor key as the caller's 401", async () => {
    const { store } = makeStore([{ id: "k1", provider: "anthropic", secret: "sk-revoked" }]);
    const fetchImpl = vi.fn(async () => Response.json({ type: "error", error: { type: "authentication_error" } }, { status: 401 }));
    const res = await routeRequest(req(messagesBody), anthropicMessages, deps(store, fetchImpl as unknown as typeof fetch));
    expect(res.status).toBe(503);
  });

  it("returns caller mistakes unmodified without trying other keys", async () => {
    const { store, marks } = makeStore([
      { id: "a", provider: "anthropic", secret: "sk-a" },
      { id: "b", provider: "anthropic", secret: "sk-b", requestsServed: 1 },
    ]);
    const upstreamError = '{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: Field required"}}';
    const fetchImpl = vi.fn(async () => new Response(upstreamError, { status: 400, headers: { "x-should-retry": "false" } }));
    const res = await routeRequest(req(messagesBody), anthropicMessages, deps(store, fetchImpl as unknown as typeof fetch));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(upstreamError);
    expect(res.headers.get("x-should-retry")).toBe("false");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(marks).toEqual([]);
  });

  it("streams through unchanged and meters from the stream", async () => {
    const { store, usage } = makeStore([{ id: "k1", provider: "openai", secret: "sk-oa" }]);
    const sse =
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":50,"input_tokens_details":{"cached_tokens":40,"cache_write_tokens":0},"output_tokens":7}}}\n\n';
    const fetchImpl = vi.fn(async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }));
    const res = await routeRequest(
      new Request("http://x/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${CALLER}` },
        body: '{"model":"gpt-6.1-sol","input":"hi","stream":true}',
      }),
      openaiResponses,
      deps(store, fetchImpl as unknown as typeof fetch),
    );
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(sse);
    expect(usage[0]).toMatchObject({ stream: true, usage: { input: 10, cacheRead: 40, cacheWrite: 0, output: 7 } });
  });
});
