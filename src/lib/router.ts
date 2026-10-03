import { authenticate, callerKey } from "./auth";
import { decide, type Candidate, type Decision, type RequestFeatures } from "./decide";
import { classifyUpstream, type UpstreamVerdict } from "./exhaustion";
import { costUsd, lookupPrice, RECIPIENT_RATE, type PriceTable } from "./pricing";
import { relayHeaders, type Protocol } from "./protocols";
import type { Store } from "./store";
import { totalTokens, type NormalizedUsage } from "./usage";
import { createUsageTap } from "./usage-tap";

// A dead or throttled donated key costs one extra attempt, not the caller's request.
const MAX_ATTEMPTS = 3;

export interface RouterDeps {
  store: Store;
  decryptKey(ciphertext: string): string;
  getPrices(): Promise<PriceTable>;
  /** Schedules work after the response is sent (Next's `after`). */
  defer(task: () => Promise<void>): void;
  /** Bills what the recipient owes for one request. */
  charge(input: { recipientId: string; chargedUsd: number }): Promise<void>;
  jevApiKey?: string;
  fetchImpl?: typeof fetch;
}

function json(protocol: Protocol, status: number, type: string, message: string, extra?: HeadersInit): Response {
  return Response.json(protocol.errorBody(type, message), { status, headers: extra });
}

function featuresOf(protocol: Protocol, raw: string, parsed: Record<string, unknown>): RequestFeatures {
  const turns = (parsed.messages ?? parsed.input) as unknown;
  const last = Array.isArray(turns) ? turns[turns.length - 1] : turns;
  return {
    provider: protocol.provider,
    model: String(parsed.model ?? ""),
    approxPromptTokens: Math.ceil(raw.length / 4),
    hasTools: Array.isArray(parsed.tools) && parsed.tools.length > 0,
    stream: parsed.stream === true,
    preview: (typeof last === "string" ? last : JSON.stringify(last ?? "")).slice(0, 500),
  };
}

/** Keys whose probe listed the model; if none did, every live key gets a chance. */
function eligible(candidates: Candidate[], model: string): Candidate[] {
  const known = candidates.filter((c) => c.models.includes(model));
  return known.length > 0 ? known : candidates;
}

export async function routeRequest(request: Request, protocol: Protocol, deps: RouterDeps): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  if (!callerKey(request.headers)) {
    return json(protocol, 401, "authentication_error", "Missing Token Charity key. Get one: POST /register");
  }
  const recipient = await authenticate(request.headers, deps.store.findRecipient);
  if (!recipient) return json(protocol, 401, "authentication_error", "Unknown Token Charity key");

  const raw = await request.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(protocol, 400, "invalid_request_error", "Body must be JSON");
  }
  if (typeof parsed.model !== "string" || !parsed.model) {
    return json(protocol, 400, "invalid_request_error", "`model` is required");
  }
  const model = parsed.model;

  const live = await deps.store.liveCandidates(protocol.provider);
  if (live.length === 0) {
    return json(
      protocol,
      503,
      "overloaded_error",
      `The pool has no live ${protocol.provider} keys right now. Donate one: POST /donate`,
    );
  }
  const candidates = eligible(live, model);
  const features = featuresOf(protocol, raw, parsed);
  const decision: Decision = protocol.metered
    ? await decide(features, candidates, { jevApiKey: deps.jevApiKey, fetchImpl })
    : { decider: "single", ranking: [candidates[0].id], latencyMs: 0 };

  const body = protocol.prepareBody(raw, parsed);
  const prices = protocol.metered ? await deps.getPrices() : new Map();
  const price = lookupPrice(prices, protocol.provider, model);

  let last: { verdict: UpstreamVerdict; response: Response; text: string } | null = null;
  const order = decision.ranking.slice(0, MAX_ATTEMPTS);

  for (let i = 0; i < order.length; i++) {
    const keyId = order[i];
    const attempt = i + 1;
    const secret = await deps.store.keySecret(keyId);
    if (!secret) continue;

    const started = Date.now();
    let upstream: Response;
    try {
      upstream = await fetchImpl(protocol.upstreamUrl, {
        method: "POST",
        headers: protocol.upstreamHeaders(request.headers, deps.decryptKey(secret.ciphertext)),
        body,
        signal: request.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      last = {
        verdict: { ok: false, reroute: true, markKey: null, reason: `network: ${message}` },
        response: new Response(null, { status: 502 }),
        text: message,
      };
      continue;
    }

    const verdict = classifyUpstream(upstream.status, "");
    const meta = {
      "x-token-charity-key": secret.hint,
      "x-token-charity-decider": decision.decider,
      "x-token-charity-attempt": String(attempt),
    };

    if (verdict.ok) {
      const record = async (usage: NormalizedUsage | null) => {
        if (!protocol.metered) return;
        const u = usage ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        const listPriceUsd = costUsd(price, u);
        const chargedUsd = listPriceUsd * RECIPIENT_RATE;
        try {
          await deps.store.insertUsage({
            recipientId: recipient.id,
            poolKeyId: keyId,
            provider: protocol.provider,
            protocol: protocol.id,
            model,
            stream: features.stream,
            usage: u,
            listPriceUsd,
            chargedUsd,
            priceKnown: price !== null,
            statusCode: upstream.status,
            errorBody: null,
            decision,
            attempt,
            latencyMs: Date.now() - started,
          });
          await deps.store.recordKeyUsage(keyId, totalTokens(u), listPriceUsd);
          await deps.charge({ recipientId: recipient.id, chargedUsd });
        } catch (err) {
          console.error("metering failed", err);
        }
      };

      const headers = relayHeaders(upstream.headers);
      for (const [k, v] of Object.entries(meta)) headers.set(k, v);

      const isStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
      if (isStream && upstream.body) {
        return new Response(upstream.body.pipeThrough(createUsageTap(protocol.foldStreamEvent, record)), {
          status: upstream.status,
          headers,
        });
      }
      const text = await upstream.text();
      deps.defer(async () => {
        let usage: NormalizedUsage | null = null;
        try {
          usage = protocol.usageFromBody(JSON.parse(text));
        } catch {
          // Non-JSON success body: recorded with zero usage.
        }
        await record(usage);
      });
      return new Response(text, { status: upstream.status, headers });
    }

    // Failure: classify with the body, log it verbatim, decide whether to try the next key.
    const text = await upstream.text();
    const failure = classifyUpstream(upstream.status, text);
    last = { verdict: failure, response: upstream, text };
    deps.defer(async () => {
      try {
        if (failure.markKey || failure.reroute) await deps.store.markKey(keyId, failure.markKey, `${failure.reason}: ${text.slice(0, 500)}`);
        if (protocol.metered) {
          await deps.store.insertUsage({
            recipientId: recipient.id,
            poolKeyId: keyId,
            provider: protocol.provider,
            protocol: protocol.id,
            model,
            stream: features.stream,
            usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
            listPriceUsd: 0,
            chargedUsd: 0,
            priceKnown: price !== null,
            statusCode: upstream.status,
            errorBody: text.slice(0, 4000),
            decision,
            attempt,
            latencyMs: Date.now() - started,
          });
        }
      } catch (err) {
        console.error("failure logging failed", err);
      }
    });
    if (!failure.reroute) break;
  }

  if (!last) {
    return json(protocol, 503, "overloaded_error", "No usable donated key was found. Donate one: POST /donate");
  }
  // Caller mistakes and provider throttling/outages go back as the provider sent them,
  // so clients can read the real error and honor retry-after. A donated key that is
  // dead must never look like the caller's own credential failing.
  if (last.verdict.markKey) {
    return json(
      protocol,
      503,
      "overloaded_error",
      `Every donated ${protocol.provider} key tried was out of credit or rejected (${last.verdict.reason}). Donate one: POST /donate`,
    );
  }
  return new Response(last.text, { status: last.response.status, headers: relayHeaders(last.response.headers) });
}
