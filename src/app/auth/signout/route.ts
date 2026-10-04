import { clearSessionCookieHeader } from "@/lib/oauth-session";

export async function GET() {
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "set-cookie": clearSessionCookieHeader(),
    },
  });
}
