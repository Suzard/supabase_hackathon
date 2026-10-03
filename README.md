# Token Charity

**Live: [tokencharity.dev](https://tokencharity.dev)** · protocol for agents:
[tokencharity.dev/agents.md](https://tokencharity.dev/agents.md)

Hackathon participants get sponsor API credits they never finish. Agents run out of
credits mid-task. Token Charity connects the two: people donate unused Anthropic and
OpenAI keys into a pool, and agents that ran dry get a key, change two environment
variables, and keep working at 5% of list price.

Each request is served by one donated key, picked by
[Jev](https://docs.typesafe.ai) (TypeSafe's decision model) through the Vercel AI
Gateway. When a donated key runs out of credit or is revoked, the request moves to the
next key. The caller never sees it.

## For agents

Fetch [`https://tokencharity.dev/agents.md`](https://tokencharity.dev/agents.md). That's
the whole protocol, written for a model to read.

```bash
curl -X POST https://tokencharity.dev/register -H 'content-type: application/json' \
  -d '{"email":"<billing email>","label":"<agent name>"}'

# Claude Code / Anthropic SDK
export ANTHROPIC_BASE_URL=https://tokencharity.dev
export ANTHROPIC_AUTH_TOKEN=<api_key>

# Codex / OpenAI SDK
export OPENAI_BASE_URL=https://tokencharity.dev/v1
export OPENAI_API_KEY=<api_key>
```

## For donors

```bash
curl -X POST https://tokencharity.dev/donate -H 'content-type: application/json' \
  -d '{"provider":"anthropic","api_key":"<your key>"}'
```

`provider` is `anthropic` or `openai`. The key is checked with a free model-list call,
encrypted at rest (AES-256-GCM), and never shown back. The
[dashboard](https://tokencharity.dev) shows every donated key as a jar, live.

## How it works

- **Native protocols, pass-through.** `/v1/messages` (Anthropic), `/v1/responses` and
  `/v1/chat/completions` (OpenAI). The router swaps in a donated key and forwards. No
  format translation. Anthropic traffic follows Claude Code's
  [gateway contract](https://code.claude.com/docs/en/llm-gateway-protocol).
- **Jev decides.** Each live key is an option in one Choice question; the probability
  ranking is the retry order. A deterministic fallback takes over if Jev is unavailable.
- **Dead keys reroute.** 401/403 marks a key revoked, 402 or a credit-worded 4xx marks it
  spent, 429/5xx retries without marking. Up to three keys per request.
- **Metering.** Prices come from the AI Gateway's public catalog. Cache reads and writes
  are priced at their own rates. Streams are tapped for usage, never modified.
- **Donated keys never touch the Gateway.** Gateway BYOK falls back to Gateway credits
  when a key fails, which would hide key death and bill the operator.

Design spec: [`docs/superpowers/specs/2026-10-03-token-charity-design.md`](docs/superpowers/specs/2026-10-03-token-charity-design.md).
Stage runbook: [`docs/demo.md`](docs/demo.md).

## Run it

```bash
pnpm install
cp .env.example .env.local      # fill it in; POOL_ENCRYPTION_KEY: openssl rand -base64 32
supabase db push --db-url "$SUPABASE_DB_URL"   # applies supabase/migrations
pnpm dev
pnpm seed                       # donates the SEED_* keys through /donate
pnpm smoke                      # register + one call per protocol + stats
```

`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

Stack: Next.js 16 on Vercel, Supabase, Vercel AI Gateway (Jev), Stripe. Recipients pay 5%
of provider list price; billing is metered today and not switched on yet.
