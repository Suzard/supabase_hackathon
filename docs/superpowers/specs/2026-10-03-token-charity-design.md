# Token Charity

Date: 2026-10-03
Status: approved, building
Context: one-day Stripe hackathon ("Ship by Sundown", https://shipbysundown.dev).
Sponsors: Supabase, OpenAI, Anthropic, Stripe.

## Problem

Every hackathon participant is handed sponsor API credits. Most expire unused.
Meanwhile agents run dry mid-task and stop, because the credits they need sit in
somebody else's account.

## What we are building

An inference provider whose cost basis is donated credits. Participants donate
unused API keys into a pool. Agents that ran out get a Token Charity key and keep
working. Same interface as OpenRouter, far cheaper, because the credits were free
and we take no cut. A decision model (Jev) picks which donated key serves each
request.

## Success criteria

A real agent that hit a credit wall resumes work by changing two environment
variables, served by a key somebody else donated, with the routing decision made
by Jev and a dollars-donated counter climbing on screen.

## Surface

The whole onboarding contract, from the agent's point of view:

    curl https://<host>/agents.md              # protocol + live pool state, no auth
    curl -X POST https://<host>/register       # -> tc_live_xxx
    export OPENAI_BASE_URL=https://<host>/v1
    export OPENAI_API_KEY=tc_live_xxx

No SDK, no code change. Model names stay native: the agent keeps sending
`gpt-...` or `claude-...` exactly as before. `/agents.md` is written for a model
to read, not a human.

## Architecture (verified against primary docs, 2026-10-03)

### Router: pass-through, not translation

`POST /v1/chat/completions`, OpenAI-compatible. The router swaps the auth header,
forwards the body unchanged, and pipes the response back. Streaming works for free.

- OpenAI keys forward to `https://api.openai.com/v1/chat/completions`.
- Anthropic keys forward to `https://api.anthropic.com/v1/chat/completions`.
  Anthropic's OpenAI compatibility layer documents `stream` and `stream_options`
  as fully supported and tools as supported. Documented caveats, surfaced in
  `/agents.md`: `response_format` is ignored, tool `strict` is ignored, and
  Anthropic does not position the layer as production grade.
- Provider is inferred from the requested model string.

### Decision: Jev via AI Gateway (one call per request)

`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`,
`model: "typesafe-ai/jev"`, `Authorization: Bearer $AI_GATEWAY_API_KEY`.
Price $0.042/M input tokens, output free. Limits: 64k tokens per request, 32k for
state plus the longest question, no streaming.

- State is NOT the prompt. It is request features (provider, model, approximate
  token count, whether tools are present, first ~500 chars) plus a pool snapshot.
- Each eligible pool key is a Choice option (max 255). The answer carries the pick,
  a probability per option, and a confidence. The probability ranking is the
  reroute order when the chosen key dies.
- `decide()` has two implementations behind one signature: Jev, and a
  deterministic fallback (least-used live key). Jev can never block the build.

### Why donated keys do not go through AI Gateway

Gateway BYOK retries failed requests on Gateway system credentials, billed to our
balance, and BYOK spend cannot be capped by budgets. There is no documented switch
to disable that fallback. It would drain our credits and, worse, hide the moment a
donated key dies, which is the core of the product. Donated keys are called
directly; the Gateway is used only for Jev.

### Components

1. Intake. `POST /donate {provider, api_key}`. Probe with a minimal real call,
   store only keys that work, encrypt at rest.
2. Pool. Supabase. Status `live` | `exhausted` | `invalid`.
3. Router. As above.
4. `decide()`. As above.
5. Exhaustion. No provider error shapes hardcoded from memory. 401, 402, 429, or a
   4xx body containing "quota", "credit", or "billing" marks the key suspect; the
   router reroutes once to the next key by Jev's probability ranking. Every non-2xx
   body is logged verbatim so the matcher is tuned against real responses.
6. Metering. Every call records tokens and the provider list-price cost. For
   streams the router injects `stream_options.include_usage = true`, tees the
   stream, and records usage from the final chunk.
7. Charging. One function that consumes the metered amount. Which Stripe product
   backs it is an open question for the user (MPP, prepaid Checkout credits, or a
   threshold invoice). Until answered, it is a no-op that records the amount.

## Data model

    donors      id, email, created_at
    pool_keys   id, donor_id, provider, key_ciphertext, key_hint, status,
                tokens_served, cost_absorbed_usd, last_error, created_at
    recipients  id, email, api_key_hash, created_at
    usage       id, recipient_id, pool_key_id, provider, model, tokens_in,
                tokens_out, list_price_usd, status_code, error_body,
                decision jsonb, created_at

## Decisions

- OpenAI-compatible wire format, native model names.
- Pass-through proxy; no cross-provider translation.
- Gateway for Jev only.
- LLM routing only today. Supabase is the charity's own database.
- Credentials are never assumed or stubbed. Nothing ships against an API shape
  that was not verified from a primary source.

## Roadmap (not today)

- "Routers for everything an agent needs": the hackathon partner list (Exa,
  Firecrawl, Browserbase, Browser Use, Kernel, AgentMail, AgentPhone) are the next
  routes, each with the same donate, pool, decide, meter loop.
- Distribution: `stripe directory search` is how agents discover services. Listing
  Token Charity there is the distribution step, if Directory accepts listings
  (unverified).

## Build order

Each step is demoable on its own.

1. Scaffold: Next.js, pnpm, `.env.example`, Supabase migration SQL
2. Pass-through `/v1/chat/completions` against one env-provided key
3. Pool table and deterministic `decide()`
4. Jev in `decide()`
5. `POST /donate` with probe
6. Exhaustion detection and reroute
7. Metering
8. `/agents.md`
9. Stripe charging function
10. Dashboard
11. Streaming usage capture polish

## Demo script

Anything not in this script is out of scope today.

Claude Code is working, hits a credit wall, fetches `/agents.md`, registers,
repoints `base_url`, resumes mid-task. A second terminal donates a fresh key. The
dashboard shows Jev picking keys, a key draining to `exhausted`, traffic rerouting
live, and the donated-dollars counter climbing.

## Open questions (blocking only the step named)

- Which Stripe product backs charging (step 9).
- Which Supabase org hosts the project (live DB; migration SQL is written regardless).
- Seed OpenAI and Anthropic keys (end-to-end testing; code is written regardless).
