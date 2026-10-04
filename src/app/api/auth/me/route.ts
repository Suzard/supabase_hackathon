import { env } from "@/lib/env";
import { readSessionFromRequest } from "@/lib/oauth-session";

export async function GET(request: Request) {
  const secret = env.oauthSessionSecret();
  if (!secret) {
    return Response.json({ user: null }, { headers: { "cache-control": "no-store" } });
  }
  const session = readSessionFromRequest(request, secret);
  if (!session) return Response.json({ user: null }, { headers: { "cache-control": "no-store" } });
  return Response.json(
    {
      user: {
        provider: session.provider,
        subject: session.subject,
        email: session.email,
        name: session.name,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
