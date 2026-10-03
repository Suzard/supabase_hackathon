import { describe, expect, it } from "vitest";
import { createUsageTap, type TokenUsage } from "../usage-tap";

async function run(chunks: string[]) {
  let usage: TokenUsage | null | undefined;
  const enc = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
  const out = await new Response(source.pipeThrough(createUsageTap((u) => void (usage = u)))).text();
  return { out, usage };
}

describe("createUsageTap", () => {
  it("passes bytes through unchanged and captures the final usage chunk", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\n',
      "data: [DONE]\n\n",
    ];
    const { out, usage } = await run(sse);
    expect(out).toBe(sse.join(""));
    expect(usage).toEqual({ prompt_tokens: 12, completion_tokens: 3 });
  });
  it("handles events split across chunk boundaries", async () => {
    const { usage } = await run(['data: {"choices":[],"usa', 'ge":{"prompt_tokens":7,"completion_tokens":2}}\n', "data: [DONE]\n"]);
    expect(usage).toEqual({ prompt_tokens: 7, completion_tokens: 2 });
  });
  it("reports null when the provider sent no usage", async () => {
    const { usage } = await run(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', "data: [DONE]\n\n"]);
    expect(usage).toBeNull();
  });
});
