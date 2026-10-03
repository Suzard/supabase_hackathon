# Stage runbook

## Before going on stage

1. `.env.local` has `AI_GATEWAY_API_KEY`, Supabase URL and service role key,
   `POOL_ENCRYPTION_KEY`, and two Anthropic seed keys plus one OpenAI key.
2. Schema applied (`supabase db push --db-url ...`).
3. App running (local `pnpm dev` or the deployed URL). Dashboard open on the projector.
4. `pnpm seed` run against that URL. Three jars on the board.
5. In a spare terminal, register a key for the demo agent and keep the two
   `ANTHROPIC_*` lines ready to paste.

Two Anthropic keys are the minimum. With one, there is no decision for Jev to make and the
ledger shows `single` instead of `Jev 0.83`.

## The script

1. **The wall.** Claude Code is mid-task on a real repo and stops: out of credits.
2. **The front door.** It fetches `<host>/agents.md`, registers with your email, and you
   paste:
   ```bash
   export ANTHROPIC_BASE_URL=<host>
   export ANTHROPIC_AUTH_TOKEN=<api_key>
   ```
   Use `ANTHROPIC_AUTH_TOKEN`. `ANTHROPIC_API_KEY` makes Claude Code stop for a one-time
   approval prompt.
3. **It resumes.** Requests land on the ledger. Each line shows the model, which jar served
   it, `Jev` with its confidence, the list price, and the 5% the agent pays. The board
   counter ticks up.
4. **A donor's key dies.** Revoke one of the two Anthropic keys in the Anthropic Console.
   Real credit exhaustion can't be timed; revoking can. The next request hits that key,
   gets a real 401, the jar drains and is stamped REVOKED, the ledger shows the failed line
   followed by `REROUTED · TRY 2`, and Claude Code never notices.
5. **A new donor.** In a second terminal:
   ```bash
   curl -X POST <host>/donate -H 'content-type: application/json' \
     -d '{"provider":"anthropic","api_key":"<fresh key>"}'
   ```
   A new jar appears and takes traffic.

## If something goes wrong

- 503 "no live keys": every jar for that provider is spent or revoked. Donate one.
- Ledger shows `deterministic` instead of `Jev`: `AI_GATEWAY_API_KEY` is missing or the
  Gateway call failed. Routing still works; the usage row's `decision.fallbackReason`
  says why.
- Board says it can't reach the pool: the Supabase env vars are wrong or the schema
  isn't applied.
