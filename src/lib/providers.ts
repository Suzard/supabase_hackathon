// Upstreams are each provider's own OpenAI-compatible Chat Completions endpoint.
// Anthropic's compatibility layer: https://platform.claude.com/docs/en/api/openai-sdk
// (stream, stream_options, tools, and Bearer auth supported; response_format and tool
// `strict` are ignored there).

export type Provider = "openai" | "anthropic";

export const PROVIDERS: readonly Provider[] = ["openai", "anthropic"];

export const CHAT_COMPLETIONS_URL: Record<Provider, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/chat/completions",
};

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export interface ResolvedModel {
  provider: Provider;
  /** The model ID in the provider's native form, as sent upstream. */
  model: string;
}

/**
 * Maps the model string an agent sent to a provider and that provider's native ID.
 * Accepts native IDs (`gpt-5`, `claude-opus-5-5`) and OpenRouter/Gateway-style
 * prefixed IDs (`openai/gpt-5`, `anthropic/claude-opus-5.5`). Anthropic's native IDs
 * use dashes between version numbers, so dotted versions are converted.
 */
export function resolveModel(requested: string): ResolvedModel | null {
  const raw = requested.trim();
  if (!raw) return null;

  const slash = raw.indexOf("/");
  if (slash !== -1) {
    const prefix = raw.slice(0, slash);
    const rest = raw.slice(slash + 1);
    if (!isProvider(prefix) || !rest) return null;
    return { provider: prefix, model: prefix === "anthropic" ? anthropicNative(rest) : rest };
  }

  if (/^claude-/.test(raw)) return { provider: "anthropic", model: anthropicNative(raw) };
  if (/^(gpt-|o\d|chatgpt-)/.test(raw)) return { provider: "openai", model: raw };
  return null;
}

function anthropicNative(model: string): string {
  return model.replace(/(\d)\.(\d)/g, "$1-$2");
}

/** Last four characters, safe to show on a dashboard. */
export function keyHint(apiKey: string): string {
  return apiKey.length > 4 ? apiKey.slice(-4) : "****";
}
