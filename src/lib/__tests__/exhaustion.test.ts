import { describe, expect, it } from "vitest";
import { classifyUpstream } from "../exhaustion";

describe("classifyUpstream", () => {
  it("passes 2xx through", () => {
    expect(classifyUpstream(200, "")).toMatchObject({ ok: true, reroute: false, markKey: null });
  });
  it("marks the key invalid on auth failures and reroutes", () => {
    expect(classifyUpstream(401, "")).toMatchObject({ reroute: true, markKey: "invalid" });
    expect(classifyUpstream(403, "")).toMatchObject({ reroute: true, markKey: "invalid" });
  });
  it("marks the key exhausted on 402 and on quota-worded 4xx", () => {
    expect(classifyUpstream(402, "")).toMatchObject({ reroute: true, markKey: "exhausted" });
    expect(classifyUpstream(429, '{"error":{"message":"You exceeded your current quota"}}')).toMatchObject({
      reroute: true,
      markKey: "exhausted",
    });
    expect(classifyUpstream(400, "Your credit balance is too low")).toMatchObject({ markKey: "exhausted" });
  });
  it("reroutes a plain 429 without killing the key", () => {
    expect(classifyUpstream(429, "rate limit")).toMatchObject({ reroute: true, markKey: null });
  });
  it("reroutes provider 5xx without killing the key", () => {
    expect(classifyUpstream(529, "overloaded")).toMatchObject({ reroute: true, markKey: null });
  });
  it("returns caller mistakes to the caller", () => {
    expect(classifyUpstream(400, "messages: field required")).toMatchObject({ reroute: false, markKey: null });
    expect(classifyUpstream(404, "model not found")).toMatchObject({ reroute: false, markKey: null });
  });
});
