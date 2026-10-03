// Pass-through TransformStream over an SSE body that folds each `data:` payload into
// usage via the protocol adapter, then reports the total when the stream ends. Bytes
// (including keep-alive pings) are relayed unchanged and unbuffered.

import type { NormalizedUsage } from "./usage";

export function createUsageTap(
  fold: (acc: NormalizedUsage | null, event: unknown) => NormalizedUsage | null,
  onComplete: (usage: NormalizedUsage | null) => Promise<void> | void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: NormalizedUsage | null = null;

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      usage = fold(usage, JSON.parse(payload));
    } catch {
      // Not JSON; relayed untouched.
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
