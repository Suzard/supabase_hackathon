import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "tc_session";
const STATE_COOKIE = "tc_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

type CookieOptions = {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
};

function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly ?? true) parts.push("HttpOnly");
  if (opts.secure ?? true) parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return acc;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) acc[k] = decodeURIComponent(v);
      return acc;
    }, {});
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function unb64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export type SessionUser = {
  provider: "github";
  subject: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
};

export function createSession(user: Omit<SessionUser, "iat" | "exp">, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionUser = { ...user, iat: now, exp: now + SESSION_TTL_SECONDS };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionUser | null {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64url(payloadB64)) as SessionUser;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.provider !== "github" || !payload.subject) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSessionFromRequest(request: Request, secret: string): SessionUser | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifySession(token, secret);
}

export function sessionCookieHeader(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
}

export function clearSessionCookieHeader(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export function createOauthState(): string {
  return randomBytes(16).toString("hex");
}

export function oauthStateCookieHeader(state: string): string {
  return serializeCookie(STATE_COOKIE, state, { maxAge: 600 });
}

export function clearOauthStateCookieHeader(): string {
  return serializeCookie(STATE_COOKIE, "", { maxAge: 0 });
}

export function readOauthStateFromRequest(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies[STATE_COOKIE] ?? null;
}
