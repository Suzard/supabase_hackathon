import { PROVIDERS } from "@/lib/providers";
import { supabaseStore } from "@/lib/supabase-store";

// Models the live pool can serve, from each key's intake probe. Claude Code queries
// this for model discovery (GET /v1/models?limit=1000, 3s timeout, keeps IDs containing
// "claude"); the OpenAI SDK lists models on the same path.
export async function GET() {
  const seen = new Map<string, string>();
  for (const provider of PROVIDERS) {
    for (const key of await supabaseStore.liveCandidates(provider)) {
      for (const id of key.models) seen.set(id, provider);
    }
  }
  const data = [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([id, owner]) => ({ id, object: "model", owned_by: owner }));
  return Response.json({ object: "list", data, has_more: false }, { headers: { "cache-control": "no-store" } });
}
