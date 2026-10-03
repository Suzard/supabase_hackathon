import { describe, expect, it } from "vitest";
import { anthropicMessages, openaiChat, openaiResponses, type Protocol } from "../protocols";
import type { NormalizedUsage } from "../usage";
import { createUsageTap } from "../usage-tap";

async function run(protocol: Protocol, chunks: string[]) {
  let usage: NormalizedUsage | null | undefined;
  const enc = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
  const tap = createUsageTap(protocol.foldStreamEvent, (u) => void (usage = u));
  const out = await new Response(source.pipeThrough(tap)).text();
  return { out, usage };
}

describe("usage tap", () => {
  it("Anthropic: input from message_start, cumulative output from message_delta, pings relayed", async () => {
    // Event shapes from https://platform.claude.com/docs/en/build-with-claude/streaming
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":2679,"cache_creation_input_tokens":0,"cache_read_input_tokens":40000,"output_tokens":3}}}\n\n',
      'event: ping\ndata: {"type": "ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":510}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const { out, usage } = await run(anthropicMessages, sse);
    expect(out).toBe(sse.join(""));
    expect(usage).toEqual({ input: 2679, cacheRead: 40000, cacheWrite: 0, output: 510 });
  });

  it("OpenAI Responses: usage from response.completed, cached tokens split out", async () => {
    const { usage } = await run(openaiResponses, [
      'event: response.created\ndata: {"type":"response.created","response":{"usage":null}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":1200,"input_tokens_details":{"cached_tokens":1000,"cache_write_tokens":0},"output_tokens":80}}}\n\n',
    ]);
    expect(usage).toEqual({ input: 200, cacheRead: 1000, cacheWrite: 0, output: 80 });
  });

  it("OpenAI Chat: usage from the final chunk, events split across chunk boundaries", async () => {
    const { usage } = await run(openaiChat, [
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: {"choices":[],"usa',
      'ge":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    ]);
    expect(usage).toEqual({ input: 12, cacheRead: 0, cacheWrite: 0, output: 3 });
  });

  it("reports null when no usage was sent", async () => {
    const { usage } = await run(openaiChat, ['data: {"choices":[]}\n\n', "data: [DONE]\n\n"]);
    expect(usage).toBeNull();
  });
});
