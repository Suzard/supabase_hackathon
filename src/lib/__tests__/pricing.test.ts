import { describe, expect, it } from "vitest";
import { buildPriceTable, costUsd, lookupPrice } from "../pricing";

// Shape and values copied from https://ai-gateway.vercel.sh/v1/models on 2026-10-03.
const catalog = {
  data: [
    { id: "openai/gpt-5", pricing: { input: "0.00000125", output: "0.00001" } },
    { id: "anthropic/claude-opus-5.5", pricing: { input: "0.000004", output: "0.00002" } },
    { id: "anthropic/claude-haiku-4.5", pricing: { input: "0.000001", output: "0.000005" } },
    { id: "typesafe-ai/jev", pricing: { input: "0.000000042", output: "0" } },
    { id: "broken/entry" },
  ],
};

describe("pricing", () => {
  const table = buildPriceTable(catalog);

  it("skips entries without pricing", () => {
    expect(table.has("broken/entry")).toBe(false);
  });
  it("matches native OpenAI IDs and dated snapshots", () => {
    expect(lookupPrice(table, "openai", "gpt-5")).toEqual({ input: 0.00000125, output: 0.00001 });
    expect(lookupPrice(table, "openai", "gpt-5-2025-08-07")).toEqual({ input: 0.00000125, output: 0.00001 });
  });
  it("maps Anthropic dashed versions onto the catalog's dotted IDs", () => {
    expect(lookupPrice(table, "anthropic", "claude-opus-5-5")).toEqual({ input: 0.000004, output: 0.00002 });
    expect(lookupPrice(table, "anthropic", "claude-haiku-4-5-20251001")).toEqual({ input: 0.000001, output: 0.000005 });
  });
  it("returns null instead of guessing", () => {
    expect(lookupPrice(table, "openai", "gpt-unknown")).toBeNull();
  });
  it("computes cost, zero when price unknown", () => {
    expect(costUsd({ input: 0.000004, output: 0.00002 }, 1000, 500)).toBeCloseTo(0.014, 10);
    expect(costUsd(null, 1000, 500)).toBe(0);
  });
});
