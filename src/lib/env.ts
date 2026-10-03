// Server-only configuration. Missing required values fail loudly at first use, never
// silently fall back to a placeholder.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  poolEncryptionKey: () => required("POOL_ENCRYPTION_KEY"),
  /** Optional: without it, routing falls back to the deterministic decider. */
  aiGatewayApiKey: () => process.env.AI_GATEWAY_API_KEY || undefined,
};
