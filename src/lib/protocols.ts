// One adapter per native provider API. The router is a pass-through: it swaps the
// credential and forwards. Adapters only say where to send, which caller headers
// survive, and how to read usage.
//
// Anthropic Messages follows Claude Code's gateway contract
// (https://code.claude.com/docs/en/llm-gateway-protocol): body forwarded unchanged,
// every `anthropic-*` request header forwarded as an open list.

import type { Provider } from "./providers";
import { fromAnthropic, fromOpenAIChat, fromOpenAIResponses, type NormalizedUsage } from "./usage";

export type ProtocolId = "anthropic-messages" | "anthropic-count-tokens" | "openai-responses" | "openai-chat";

export interface Protocol {
  id: ProtocolId;
  provider: Provider;
  upstreamUrl: string;
  /** Count-token calls are free upstream; they are routed but not metered. */
  metered: boolean;
  upstreamHeaders(incoming: Headers, donatedKey: string): Headers;
  prepareBody(raw: string, parsed: Record<string, unknown>): string;
  usageFromBody(json: unknown): NormalizedUsage | null;
  /** Folds one parsed SSE `data:` payload into the running usage. */
  foldStreamEvent(acc: NormalizedUsage | null, event: unknown): NormalizedUsage | null;
  errorBody(type: string, message: string): unknown;
}

const ANTHROPIC_VERSION = "2023-06-01";

function anthropicHeaders(incoming: Headers, donatedKey: string): Headers {
  const out = new Headers({ "content-type": "application/json", "x-api-key": donatedKey });
  incoming.forEach((value, name) => {
    if (name.toLowerCase().startsWith("anthropic-")) out.set(name, value);
  });
  if (!out.has("anthropic-version")) out.set("anthropic-version", ANTHROPIC_VERSION);
  return out;
}

// OpenAI-* caller headers (organization, project) name the caller's account and would
// break against a donated key, so none are forwarded.
function openaiHeaders(_incoming: Headers, donatedKey: string): Headers {
  return new Headers({ "content-type": "application/json", authorization: `Bearer ${donatedKey}` });
}

const anthropicError = (type: string, message: string) => ({ type: "error", error: { type, message } });
const openaiError = (type: string, message: string) => ({ error: { message, type, code: null } });
const unchanged = (raw: string) => raw;

export const anthropicMessages: Protocol = {
  id: "anthropic-messages",
  provider: "anthropic",
  upstreamUrl: "https://api.anthropic.com/v1/messages",
  metered: true,
  upstreamHeaders: anthropicHeaders,
  prepareBody: unchanged,
  usageFromBody: (json) => fromAnthropic((json as { usage?: unknown })?.usage),
  foldStreamEvent(acc, event) {
    const e = event as { type?: string; message?: { usage?: unknown }; usage?: unknown };
    if (e?.type === "message_start") return fromAnthropic(e.message?.usage, acc);
    if (e?.type === "message_delta") return fromAnthropic(e.usage, acc);
    return acc;
  },
  errorBody: anthropicError,
};

export const anthropicCountTokens: Protocol = {
  ...anthropicMessages,
  id: "anthropic-count-tokens",
  upstreamUrl: "https://api.anthropic.com/v1/messages/count_tokens",
  metered: false,
};

export const openaiResponses: Protocol = {
  id: "openai-responses",
  provider: "openai",
  upstreamUrl: "https://api.openai.com/v1/responses",
  metered: true,
  upstreamHeaders: openaiHeaders,
  prepareBody: unchanged,
  usageFromBody: (json) => fromOpenAIResponses((json as { usage?: unknown })?.usage),
  // Final usage arrives on response.completed (and on response.failed / response.incomplete).
  foldStreamEvent: (acc, event) => fromOpenAIResponses((event as { response?: { usage?: unknown } })?.response?.usage) ?? acc,
  errorBody: openaiError,
};

export const openaiChat: Protocol = {
  id: "openai-chat",
  provider: "openai",
  upstreamUrl: "https://api.openai.com/v1/chat/completions",
  metered: true,
  upstreamHeaders: openaiHeaders,
  // Chat Completions streams only report usage when asked.
  prepareBody(raw, parsed) {
    if (parsed.stream !== true) return raw;
    const options = (parsed.stream_options ?? {}) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, stream_options: { ...options, include_usage: true } });
  },
  usageFromBody: (json) => fromOpenAIChat((json as { usage?: unknown })?.usage),
  foldStreamEvent: (acc, event) => fromOpenAIChat((event as { usage?: unknown })?.usage) ?? acc,
  errorBody: openaiError,
};

// Upstream response headers that must not be relayed: transport framing (fetch has
// already decoded the body) and the donor's account identifiers.
const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
  "openai-organization",
  "openai-project",
  "anthropic-organization-id",
]);

/** Relays retry-after, x-should-retry, rate-limit headers and the rest, minus the drop list. */
export function relayHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
  });
  return out;
}
