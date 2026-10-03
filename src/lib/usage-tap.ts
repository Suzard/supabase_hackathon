// Pass-through TransformStream for an OpenAI-format SSE stream that captures the
// final `usage` object. The router sets `stream_options.include_usage = true` on
// streamed requests so the provider sends one (both OpenAI and Anthropic's
// compatibility layer support it).

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export function parseUsage(value: unknown): TokenUsage | null {
  const u = value as { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined;
  if (!u || typeof u.prompt_tokens !== "number" || typeof u.completion_tokens !== "number") return null;
  return { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens };
}

export function createUsageTap(
  onComplete: (usage: TokenUsage | null) => Promise<void> | void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: TokenUsage | null = null;

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const found = parseUsage(JSON.parse(payload).usage);
      if (found) usage = found;
    } catch {
      // Not JSON; pass it through untouched.
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        consumeLine(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
      }
    },
    async flush() {
      buffer += decoder.decode();
      if (buffer) consumeLine(buffer.replace(/\r$/, ""));
      await onComplete(usage);
    },
  });
}
