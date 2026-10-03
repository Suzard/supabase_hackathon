export type Provider = "openai" | "anthropic";

export const PROVIDERS: readonly Provider[] = ["openai", "anthropic"];

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** Last four characters, safe to show on a dashboard. */
export function keyHint(apiKey: string): string {
  return apiKey.length > 4 ? apiKey.slice(-4) : "****";
}
