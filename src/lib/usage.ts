/**
 * Token counts normalized across providers. `input` excludes cache reads and writes.
 * Anthropic reports the three separately; OpenAI's input count includes them
 * (https://developers.openai.com/api/docs/guides/prompt-caching: ordinary input =
 * input_tokens - cached_tokens - cache_write_tokens).
 */
export interface NormalizedUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function totalTokens(u: NormalizedUsage): number {
  return u.input + u.cacheRead + u.cacheWrite + u.output;
}

/** Anthropic Messages `usage`, from a response body, `message_start`, or `message_delta`. */
export function fromAnthropic(usage: unknown, base?: NormalizedUsage | null): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") return base ?? null;
  const u = usage as Record<string, unknown>;
  // message_delta counts are cumulative: a field present overrides, a field absent keeps the prior value.
  const pick = (key: string, prior: number) => (key in u ? num(u[key]) : prior);
  return {
    input: pick("input_tokens", base?.input ?? 0),
    cacheRead: pick("cache_read_input_tokens", base?.cacheRead ?? 0),
    cacheWrite: pick("cache_creation_input_tokens", base?.cacheWrite ?? 0),
    output: pick("output_tokens", base?.output ?? 0),
  };
}

/** OpenAI Responses `usage`. */
export function fromOpenAIResponses(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const details = (u.input_tokens_details ?? {}) as Record<string, unknown>;
  const cacheRead = num(details.cached_tokens);
  const cacheWrite = num(details.cache_write_tokens);
  return {
    input: Math.max(0, num(u.input_tokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: num(u.output_tokens),
  };
}

/** OpenAI Chat Completions `usage`. */
export function fromOpenAIChat(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cacheRead = num(details.cached_tokens);
  const cacheWrite = num(details.cache_write_tokens);
  return {
    input: Math.max(0, num(u.prompt_tokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: num(u.completion_tokens),
  };
}
