import { env } from "@/lib/env";
import {
  clearOauthStateCookieHeader,
  createSession,
  readOauthStateFromRequest,
  sessionCookieHeader,
} from "@/lib/oauth-session";

type GithubUser = { id: number; login: string; name: string | null; email: string | null };
type GithubEmail = { email: string; primary: boolean; verified: boolean };

export async function GET(request: Request) {
  const clientId = env.githubClientId();
  const clientSecret = env.githubClientSecret();
  const sessionSecret = env.oauthSessionSecret();
  if (!clientId || !clientSecret || !sessionSecret) {
    return Response.json({ error: "GitHub OAuth is not fully configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readOauthStateFromRequest(request);
  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.json({ error: "OAuth state mismatch." }, { status: 400 });
  }

  const callback = `${url.origin}/auth/github/callback`;
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callback, state }),
    cache: "no-store",
  });
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  const accessToken = tokenBody.access_token;
  if (!tokenRes.ok || !accessToken) {
    return Response.json({ error: tokenBody.error ?? "OAuth token exchange failed." }, { status: 400 });
  }

  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "user-agent": "tokencharity-oauth",
  };

  const userRes = await fetch("https://api.github.com/user", { headers, cache: "no-store" });
  if (!userRes.ok) return Response.json({ error: "Failed to load GitHub user." }, { status: 400 });
  const user = (await userRes.json()) as GithubUser;

  const emailsRes = await fetch("https://api.github.com/user/emails", { headers, cache: "no-store" });
  const emails = emailsRes.ok ? ((await emailsRes.json()) as GithubEmail[]) : [];
  const bestEmail =
    emails.find((e) => e.primary && e.verified)?.email ??
    emails.find((e) => e.verified)?.email ??
    user.email ??
    null;

  const token = createSession(
    {
      provider: "github",
      subject: String(user.id),
      email: bestEmail,
      name: user.name ?? user.login,
    },
    sessionSecret,
  );

  const headersOut = new Headers({ location: "/" });
  headersOut.append("set-cookie", clearOauthStateCookieHeader());
  headersOut.append("set-cookie", sessionCookieHeader(token));
  return new Response(null, { status: 302, headers: headersOut });
}
