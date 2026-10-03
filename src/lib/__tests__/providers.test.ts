import { describe, expect, it } from "vitest";
import { resolveModel } from "../providers";

describe("resolveModel", () => {
  it.each([
    ["gpt-5", "openai", "gpt-5"],
    ["o4-mini", "openai", "o4-mini"],
    ["chatgpt-4o-latest", "openai", "chatgpt-4o-latest"],
    ["claude-opus-5-5", "anthropic", "claude-opus-5-5"],
    ["claude-haiku-4-5", "anthropic", "claude-haiku-4-5"],
    ["openai/gpt-5.2", "openai", "gpt-5.2"],
    ["anthropic/claude-opus-5.5", "anthropic", "claude-opus-5-5"],
    ["claude-sonnet-5.5", "anthropic", "claude-sonnet-5-5"],
  ])("%s -> %s %s", (input, provider, model) => {
    expect(resolveModel(input)).toEqual({ provider, model });
  });

  it.each(["", "  ", "gemini-3-pro", "google/gemini-3-pro", "openai/", "llama-4"])("rejects %j", (input) => {
    expect(resolveModel(input)).toBeNull();
  });
});
