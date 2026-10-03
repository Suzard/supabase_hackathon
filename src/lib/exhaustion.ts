// Classifies an upstream response so the router knows whether to blame the donated
// key, the caller, or the provider. Provider error shapes are deliberately NOT
// hardcoded: signals are status codes plus a loose keyword match on the body, and the
// router logs every non-2xx body verbatim so this matcher can be tuned on real traffic.

export type KeyStatusChange = "exhausted" | "invalid" | null;

export interface UpstreamVerdict {
  ok: boolean;
  /** Try the next key instead of returning this response to the caller. */
  reroute: boolean;
  /** Persist a status change on the donated key. */
  markKey: KeyStatusChange;
  reason: string;
}

const QUOTA_WORDS = /quota|credit|billing|insufficient|balance|exceeded your/i;

export function classifyUpstream(status: number, body: string): UpstreamVerdict {
  if (status >= 200 && status < 300) {
    return { ok: true, reroute: false, markKey: null, reason: "ok" };
  }
  if (status === 401 || status === 403) {
    return { ok: false, reroute: true, markKey: "invalid", reason: `auth rejected (${status})` };
  }
  if (status === 402 || (status >= 400 && status < 500 && QUOTA_WORDS.test(body))) {
    return { ok: false, reroute: true, markKey: "exhausted", reason: `out of credit (${status})` };
  }
  if (status === 429) {
    // Rate limited but not out of credit: route around it, keep the key live.
    return { ok: false, reroute: true, markKey: null, reason: "rate limited (429)" };
  }
  if (status >= 500) {
    return { ok: false, reroute: true, markKey: null, reason: `provider error (${status})` };
  }
  // Remaining 4xx: the caller's request is malformed; another key would fail the same way.
  return { ok: false, reroute: false, markKey: null, reason: `client error (${status})` };
}
