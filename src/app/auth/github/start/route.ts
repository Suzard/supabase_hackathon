import { env } from "@/lib/env";
import { createOauthState, oauthStateCookieHeader } from "@/lib/oauth-session";

export async function GET(request: Request) {
  const clientId = env.githubClientId();
  if (!clientId) return Response.json({ error: "GitHub OAuth is not configured." }, { status: 503 });

  const state = createOauthState();
  const url = new URL(request.url);
  const callback = `${url.origin}/auth/github/callback`;

  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", callback);
  auth.searchParams.set("scope", "read:user user:email");
  auth.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: auth.toString(),
      "set-cookie": oauthStateCookieHeader(state),
    },
  });
}
