import { describe, expect, it } from "vitest";
import { buildPriceTable, costUsd, lookupPrice } from "../pricing";

// Shape and values copied from https://ai-gateway.vercel.sh/v1/models on 2026-10-03.
const catalog = {
  data: [
    {
      id: "openai/gpt-6.1-sol",
      pricing: { input: "0.000002", output: "0.00001", input_cache_read: "0.0000001", input_cache_write: "0.0000025" },
    },
    {
      id: "anthropic/claude-opus-5.5",
      pricing: { input: "0.000004", output: "0.00002", input_cache_read: "0.0000002", input_cache_write: "0.000005" },
    },
    { id: "anthropic/claude-fable-5.1", pricing: { input: "0.00001", output: "0.00005" } },
    { id: "broken/entry" },
  ],
};

describe("pricing", () => {
  const table = buildPriceTable(catalog);

  it("reads cache rates and skips entries without pricing", () => {
    expect(table.get("openai/gpt-6.1-sol")).toEqual({ input: 0.000002, output: 0.00001, cacheRead: 0.0000001, cacheWrite: 0.0000025 });
    expect(table.has("broken/entry")).toBe(false);
  });
  it("falls back to the input rate when cache rates are absent", () => {
    expect(table.get("anthropic/claude-fable-5.1")).toMatchObject({ cacheRead: 0.00001, cacheWrite: 0.00001 });
  });
  it("matches native OpenAI IDs and dated snapshots", () => {
    expect(lookupPrice(table, "openai", "gpt-6.1-sol")?.input).toBe(0.000002);
    expect(lookupPrice(table, "openai", "gpt-6.1-sol-2026-09-01")?.input).toBe(0.000002);
  });
  it("maps Anthropic dashed versions onto the catalog's dotted IDs", () => {
    expect(lookupPrice(table, "anthropic", "claude-opus-5-5")?.input).toBe(0.000004);
    expect(lookupPrice(table, "anthropic", "claude-fable-5-1")?.input).toBe(0.00001);
  });
  it("returns null instead of guessing", () => {
    expect(lookupPrice(table, "openai", "gpt-unknown")).toBeNull();
  });
  it("prices cache reads and writes at their own rates", () => {
    const price = table.get("anthropic/claude-opus-5.5")!;
    const cost = costUsd(price, { input: 1000, cacheRead: 100_000, cacheWrite: 2000, output: 500 });
    expect(cost).toBeCloseTo(0.000004 * 1000 + 0.0000002 * 100_000 + 0.000005 * 2000 + 0.00002 * 500, 12);
    expect(costUsd(null, { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 })).toBe(0);
  });
});
