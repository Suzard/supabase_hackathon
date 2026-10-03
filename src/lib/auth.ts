import { hashApiKey } from "./crypto";

/** The caller's Token Charity key, from `Authorization: Bearer` or `x-api-key`. */
export function callerKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return headers.get("x-api-key")?.trim() || null;
}

export async function authenticate(
  headers: Headers,
  findRecipient: (apiKeyHash: string) => Promise<{ id: string } | null>,
): Promise<{ id: string } | null> {
  const key = callerKey(headers);
  return key ? findRecipient(hashApiKey(key)) : null;
}
