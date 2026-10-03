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

    # Claude Code, or anything on the Anthropic SDK:
    export ANTHROPIC_BASE_URL=https://<host>
    export ANTHROPIC_AUTH_TOKEN=tc_live_xxx   # not ANTHROPIC_API_KEY: that one waits
                                              # for a one-time interactive approval

    # Codex, or anything on the OpenAI SDK:
    export OPENAI_BASE_URL=https://<host>/v1
    export OPENAI_API_KEY=tc_live_xxx

No SDK, no code change, native model names. `/agents.md` is written for a model to
read, not a human.

## Architecture (verified against primary docs, 2026-10-03)

### Router: native protocols, pass-through

Each provider is served on its own current native API. The router swaps the
credential, forwards, and relays the response unbuffered. No translation between
formats. (Revised 2026-10-03: an earlier draft proxied Anthropic through its
OpenAI-compatibility layer, which Anthropic does not position as production grade
and which Claude Code cannot use.)

| Endpoint | Upstream | Clients |
| - | - | - |
| `POST /v1/messages` | `https://api.anthropic.com/v1/messages` | Claude Code, Anthropic SDK |
| `POST /v1/messages/count_tokens` | `https://api.anthropic.com/v1/messages/count_tokens` (free, not metered) | Claude Code |
| `POST /v1/responses` | `https://api.openai.com/v1/responses` | Codex, OpenAI SDK |
| `POST /v1/chat/completions` | `https://api.openai.com/v1/chat/completions` | older OpenAI-compatible clients |
| `GET /v1/models` | union of models the live pool keys reach | Claude Code discovery, OpenAI SDK |

Anthropic Messages follows Claude Code's gateway contract
(https://code.claude.com/docs/en/llm-gateway-protocol): accept the credential in
`Authorization` or `x-api-key`; forward the body byte for byte and every
`anthropic-*` header as an open list; stream unbuffered including pings; relay
`retry-after`, `x-should-retry`, `anthropic-ratelimit-unified-*`; forward error
bodies unmodified. Donor account identifiers (`anthropic-organization-id`,
`openai-organization`, `openai-project`) are stripped from responses, and caller
`openai-*` headers are never forwarded.

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
   4xx body containing "quota", "credit", or "billing" marks the key; 429 and 5xx
   reroute without marking. The router tries up to three keys in Jev's probability
   order. A dead donor key is never surfaced as the caller's own 401. Every non-2xx
   body is logged verbatim so the matcher is tuned against real responses.
6. Metering. Every call records input, cache-read, cache-write, and output tokens
   priced at the catalog's separate rates (Claude Code is cache-heavy, so this
   matters). Anthropic reports cache tokens separately; OpenAI's input count
   includes them. Streams are tapped, never modified: Anthropic usage comes from
   `message_start` and the cumulative `message_delta`, Responses from
   `response.completed`. Only Chat Completions streams get
   `stream_options.include_usage = true` injected, since they report nothing
   otherwise.
7. Charging. Recipients pay 5% of list price. Decided 2026-10-03: plain Stripe
   Invoices (Metronome is Stripe's recommended usage-billing platform, but it needs a
   separate account and duplicates metering we already do). When a recipient's unbilled
   charges reach $0.50 (Stripe's minimum charge), `claim_unbilled()` atomically moves
   their unbilled usage rows onto a new invoice row; the app then creates a USD invoice
   (explicit currency, since a new customer has none), adds one line item, finalizes,
   and sends it. Every Stripe call carries an idempotency key derived from the invoice
   row. A failure before finalization releases the usage; after finalization it never
   does, so usage is never billed twice. `GET /v1/billing` and
   `POST /v1/billing/invoice` give agents their pay link. `invoice.paid`, `invoice.voided`
   and `invoice.marked_uncollectible` arrive on a signed webhook. Stripe account must be
   registered outside India, or Indian export rules require each customer's name and
   billing address.

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
2. Native pass-through router (`/v1/messages`, `/v1/responses`, `/v1/chat/completions`)
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
sets `ANTHROPIC_BASE_URL`, resumes mid-task. A second terminal donates a fresh key. The
dashboard shows Jev picking keys, a key draining to `exhausted`, traffic rerouting
live, and the donated-dollars counter climbing.

## Status (2026-10-03)

Verified live on tokencharity.dev: Anthropic Messages (plain and streamed), OpenAI
Responses, Jev routing across two Anthropic keys, metering, and a Stripe test-mode
invoice issued, paid, and reconciled through the webhook.
