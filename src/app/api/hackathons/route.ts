import { getUpcomingHackathons } from "@/lib/hackathons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const items = await getUpcomingHackathons();
  return Response.json({ items }, { headers: { "cache-control": "no-store" } });
}
