import { describe, expect, it } from "vitest";
import { anthropicMessages, openaiChat, openaiResponses, relayHeaders } from "../protocols";

describe("protocol adapters", () => {
  it("Anthropic forwards every anthropic-* header and swaps in the donated key", () => {
    const incoming = new Headers({
      "x-api-key": "tc_live_caller",
      authorization: "Bearer tc_live_caller",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "context-management-2025-06-27,some-future-beta",
      "anthropic-some-new-header": "kept",
      "x-claude-code-session-id": "s1",
    });
    const out = anthropicMessages.upstreamHeaders(incoming, "sk-ant-donated");
    expect(out.get("x-api-key")).toBe("sk-ant-donated");
    expect(out.get("authorization")).toBeNull();
    expect(out.get("anthropic-beta")).toBe("context-management-2025-06-27,some-future-beta");
    expect(out.get("anthropic-some-new-header")).toBe("kept");
    expect(out.get("x-claude-code-session-id")).toBeNull();
  });

  it("Anthropic defaults anthropic-version when the caller omits it", () => {
    expect(anthropicMessages.upstreamHeaders(new Headers(), "k").get("anthropic-version")).toBe("2023-06-01");
  });

  it("Anthropic and Responses bodies pass through byte for byte", () => {
    const raw = '{"model":"claude-opus-5-5",  "max_tokens":1024,"system":[{"type":"text","text":"x"}],"messages":[]}';
    expect(anthropicMessages.prepareBody(raw, JSON.parse(raw))).toBe(raw);
    const r = '{"model":"gpt-6.1-sol","input":"hi","stream":true}';
    expect(openaiResponses.prepareBody(r, JSON.parse(r))).toBe(r);
  });

  it("OpenAI never forwards the caller's org or project headers", () => {
    const out = openaiResponses.upstreamHeaders(new Headers({ "openai-organization": "org-caller" }), "sk-donated");
    expect(out.get("authorization")).toBe("Bearer sk-donated");
    expect(out.get("openai-organization")).toBeNull();
  });

  it("Chat Completions asks for usage on streams only", () => {
    const streamed = '{"model":"gpt-6.1-sol","stream":true,"messages":[]}';
    expect(JSON.parse(openaiChat.prepareBody(streamed, JSON.parse(streamed))).stream_options).toEqual({ include_usage: true });
    const plain = '{"model":"gpt-6.1-sol","messages":[]}';
    expect(openaiChat.prepareBody(plain, JSON.parse(plain))).toBe(plain);
  });

  it("relays retry and rate-limit headers but not framing or donor identity", () => {
    const out = relayHeaders(
      new Headers({
        "retry-after": "5",
        "x-should-retry": "true",
        "anthropic-ratelimit-unified-status": "allowed",
        "content-encoding": "gzip",
        "content-length": "10",
        "anthropic-organization-id": "donor-org",
        "openai-organization": "donor-org",
      }),
    );
    expect(out.get("retry-after")).toBe("5");
    expect(out.get("x-should-retry")).toBe("true");
    expect(out.get("anthropic-ratelimit-unified-status")).toBe("allowed");
    expect(out.get("content-encoding")).toBeNull();
    expect(out.get("content-length")).toBeNull();
    expect(out.get("anthropic-organization-id")).toBeNull();
    expect(out.get("openai-organization")).toBeNull();
  });
});
