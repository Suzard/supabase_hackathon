import { poolStats } from "@/lib/supabase-store";

export async function GET() {
  return Response.json(await poolStats(), { headers: { "cache-control": "no-store" } });
}
