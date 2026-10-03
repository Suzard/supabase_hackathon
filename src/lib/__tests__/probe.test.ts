import { describe, expect, it, vi } from "vitest";
import { probeKey, providerErrorMessage } from "../probe";

describe("providerErrorMessage", () => {
  // Bodies captured from the live probes on 2026-10-03.
  it("pulls the message out of Anthropic and OpenAI error bodies", () => {
    expect(
      providerErrorMessage('{"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}'),
    ).toBe("API key is invalid.");
    expect(
      providerErrorMessage('{"error":{"message":"Incorrect API key provided: sk-proj-***key.","type":"invalid_request_error","code":"invalid_api_key"}}'),
    ).toBe("Incorrect API key provided: sk-proj-***key.");
  });
  it("falls back to trimmed text when the body isn't JSON", () => {
    expect(providerErrorMessage("  Bad Gateway  ")).toBe("Bad Gateway");
    expect(providerErrorMessage("")).toBe("no details");
  });
});

describe("probeKey", () => {
  it("reports a rejection in plain words", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ type: "error", error: { type: "authentication_error", message: "API key is invalid." } }, { status: 401 }),
    );
    expect(await probeKey("anthropic", "sk-ant-bad", fetchImpl)).toEqual({
      ok: false,
      status: 401,
      reason: "Anthropic rejected the key: API key is invalid.",
    });
  });
  it("returns the model IDs a valid key can reach", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }] }));
    expect(await probeKey("anthropic", "sk-ant-good", fetchImpl)).toEqual({ ok: true, models: ["claude-opus-5-5", "claude-sonnet-5-5"] });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/models?limit=1000");
  });
});
