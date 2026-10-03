"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PROVIDER_NAME, type Provider } from "@/lib/providers";
import type { PoolStats } from "@/lib/supabase-store";

type Key = PoolStats["keys"][number];
type Row = PoolStats["recent"][number];

const POLL_MS = 2000;

/** Money on the tote board: four decimals below $10 so sub-cent donations still move. */
function boardDigits(usd: number): string {
  return `$${usd < 10 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function useStats() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect: an immediate fetch, then polling resumes.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error(`stats ${res.status}`);
        const next = (await res.json()) as PoolStats;
        if (alive) {
          setStats(next);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [reloads]);

  return { stats, error, reload: () => setReloads((n) => n + 1) };
}

export function Board() {
  const { stats, error, reload } = useStats();
  const keyById = new Map((stats?.keys ?? []).map((k) => [k.id, k]));
  const latest = stats?.recent.find((r) => r.statusCode < 300);

  return (
    <main className="mx-auto grid max-w-[1400px] gap-x-10 gap-y-8 px-[clamp(1rem,3vw,3rem)] py-[clamp(1.25rem,3vw,2.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <header className="flex items-end justify-between gap-6 border-b-2 border-ink pb-3 lg:col-span-2">
        <h1 className="font-display text-[clamp(2.25rem,5vw,4rem)] leading-[0.85] font-extrabold tracking-tight uppercase">
          Token Charity
        </h1>
        <p className="flex items-center gap-2 pb-1 text-sm font-semibold tracking-[0.18em] text-telethon uppercase">
          <span className="blink inline-block size-2.5 rounded-full bg-telethon" aria-hidden />
          Live drive
        </p>
      </header>

      <div className="flex flex-col gap-8">
        <ToteBoard stats={stats} />
        <DonatePanel onDonated={reload} />
        {error && !stats && (
          <p className="text-ink-soft">
            Can&apos;t reach the pool yet ({error}). Once the database is connected, this board fills in.
          </p>
        )}
        <Jars keys={stats?.keys ?? []} latestKeyId={latest?.keyId ?? null} latestAt={latest?.createdAt ?? null} />
      </div>

      <Ledger rows={stats?.recent ?? []} keyById={keyById} />
    </main>
  );
}

function ToteBoard({ stats }: { stats: PoolStats | null }) {
  const totals = stats?.totals;
  const digits = boardDigits(totals?.donatedUsd ?? 0);

  return (
    <section aria-label="Inference donated so far" className="rounded-sm bg-board px-[clamp(1rem,3vw,2.5rem)] pt-6 pb-7 text-paper shadow-[0_2px_0_var(--color-board-seam),0_18px_40px_-24px_var(--color-board)]">
      <p className="text-[0.8rem] font-semibold tracking-[0.3em] text-gold uppercase">Inference donated so far</p>
      <div className="mt-3 flex flex-wrap gap-[0.35rem]" aria-live="polite" aria-label={digits}>
        {digits.split("").map((ch, i) => (
          <Tile key={`${i}-${ch}`} ch={ch} />
        ))}
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-paper/85 sm:grid-cols-4">
        <Stat label="Agents paid (5%)" value={usd(totals?.chargedUsd ?? 0)} />
        <Stat label="Requests" value={compact(totals?.requests ?? 0)} />
        <Stat label="Tokens" value={compact(totals?.tokens ?? 0)} />
        <Stat label="Live jars" value={String(totals ? totals.liveKeys.anthropic + totals.liveKeys.openai : 0)} />
      </dl>
    </section>
  );
}

function Tile({ ch }: { ch: string }) {
  const narrow = ch === "." || ch === "$";
  return (
    <span
      className={`flap relative grid place-items-center overflow-hidden rounded-[3px] bg-board-tile font-display font-extrabold text-gold ${
        narrow ? "w-[0.55em]" : "w-[0.82em]"
      } h-[1.2em] text-[clamp(3.25rem,8vw,6.5rem)] leading-none`}
    >
      {ch}
      {!narrow && <span className="absolute inset-x-0 top-1/2 h-[2px] bg-board-seam" aria-hidden />}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.7rem] font-semibold tracking-[0.2em] text-gold/80 uppercase">{label}</dt>
      <dd className="font-display text-2xl font-bold tracking-wide">{value}</dd>
    </div>
  );
}

function Jars({ keys, latestKeyId, latestAt }: { keys: Key[]; latestKeyId: string | null; latestAt: string | null }) {
  if (keys.length === 0) {
    return (
      <section className="border-2 border-dashed border-ink/30 p-6">
        <h2 className="font-display text-2xl font-bold uppercase">The jars are empty</h2>
        <p className="mt-2 max-w-prose text-ink-soft">Nobody has donated a key yet. Be the first, just above.</p>
      </section>
    );
  }

  return (
    <section aria-label="Donated keys">
      <h2 className="mb-4 font-display text-xl font-bold tracking-wide uppercase">Donation jars</h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8">
        {keys.map((k) => (
          <Jar key={k.id} k={k} serving={k.id === latestKeyId} servedAt={latestAt} />
        ))}
      </ul>
    </section>
  );
}

function Jar({ k, serving, servedAt }: { k: Key; serving: boolean; servedAt: string | null }) {
  const live = k.status === "live";
  const stampText = k.status === "invalid" ? "Revoked" : "Spent";

  return (
    <li className="flex flex-col items-center text-center">
      <div className="relative h-36 w-28">
        {/* lid */}
        <div className="absolute inset-x-3 top-0 h-3 rounded-sm bg-ink/80" />
        {/* glass */}
        <div
          className={`absolute inset-x-0 top-2.5 bottom-0 overflow-hidden rounded-b-[1.4rem] rounded-t-md border-[3px] bg-paper/60 transition-colors duration-700 ${
            serving && live ? "border-gold-deep" : "border-ink/70"
          }`}
        >
          {/* honey: full while the provider accepts the key, drains when it says the key is spent */}
          <div
            className="absolute inset-0 origin-bottom bg-gradient-to-t from-gold-deep to-gold transition-transform duration-[1400ms] ease-[var(--ease-out-quart)]"
            style={{ transform: `scaleY(${live ? 0.86 : 0})` }}
          />
          <div className="absolute inset-y-3 left-2 w-1.5 rounded-full bg-paper/50" aria-hidden />
        </div>
        {serving && live && servedAt && (
          <span key={servedAt} className="rise absolute -top-2 left-1/2 -translate-x-1/2 font-display text-lg font-bold text-gold-deep">
            served
          </span>
        )}
        {!live && (
          <span className="stamp absolute inset-x-[-0.5rem] top-12 border-[3px] border-telethon px-1 py-0.5 font-display text-2xl font-extrabold tracking-[0.15em] text-telethon uppercase">
            {stampText}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm font-semibold">{PROVIDER_NAME[k.provider] ?? k.provider}</p>
      <p className="font-display text-lg tracking-[0.2em]">····{k.hint}</p>
      <p className="text-xs text-ink-soft">
        {usd(k.costAbsorbedUsd)} given · {compact(k.requestsServed)} req
      </p>
    </li>
  );
}

function Ledger({ rows, keyById }: { rows: Row[]; keyById: Map<string, Key> }) {
  // Rows are keyed, so only new ones mount, and the slide-in animation plays on mount only.
  const rowId = (r: Row) => `${r.createdAt}-${r.keyId}-${r.attempt}`;

  return (
    <aside aria-label="Recent requests" className="lg:row-span-2">
      <h2 className="mb-3 border-b border-ink/40 pb-2 font-display text-xl font-bold tracking-wide uppercase">
        Ledger
      </h2>
      {rows.length === 0 ? (
        <div className="text-ink-soft">
          <p>Waiting for the first agent.</p>
          <p className="mt-2 text-sm">
            Point <code className="bg-paper-deep px-1">ANTHROPIC_BASE_URL</code> at this site, register for a key,
            and its requests land here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r) => (
            <LedgerRow key={rowId(r)} r={r} k={r.keyId ? keyById.get(r.keyId) : undefined} />
          ))}
        </ol>
      )}
    </aside>
  );
}

/** "Jev 0.83" when Jev decided, otherwise the decider's name. */
function deciderLabel(r: Row): string {
  if (r.decider !== "jev") return r.decider ?? "";
  if (r.confidence == null) return "Jev";
  return `Jev ${r.confidence.toFixed(2)}`;
}

function LedgerRow({ r, k }: { r: Row; k: Key | undefined }) {
  const failed = r.statusCode >= 300;
  const decider = deciderLabel(r);

  return (
    <li className="slide-in border-b border-dashed border-ink/25 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-semibold">{r.model}</span>
        <span className={`font-display text-lg font-bold ${failed ? "text-telethon" : ""}`}>
          {failed ? r.statusCode : usd(r.listPriceUsd)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-ink-soft">
        <span>
          {clock(r.createdAt)} · jar {k?.hint ?? "?"}
          {decider && <span className="ml-2 rounded-sm bg-ink px-1.5 py-px font-semibold text-paper">{decider}</span>}
          {r.attempt > 1 && !failed && (
            <span className="ml-2 font-semibold text-telethon uppercase">rerouted · try {r.attempt}</span>
          )}
        </span>
        <span>{failed ? "key failed, next jar" : `paid ${usd(r.chargedUsd)}`}</span>
      </div>
    </li>
  );
}

const FIELD_LABEL = "flex flex-col gap-1 text-xs font-semibold tracking-[0.15em] text-ink-soft uppercase";
const FIELD_INPUT =
  "border-2 border-ink bg-paper/80 px-3 py-2 font-sans text-base tracking-normal text-ink normal-case outline-none focus:border-gold-deep focus:bg-paper";

type DonateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; hint: string; provider: Provider }
  | { kind: "failed"; message: string };

function DonatePanel({ onDonated }: { onDonated: () => void }) {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<DonateStatus>({ kind: "idle" });

  function onKeyChange(value: string) {
    setApiKey(value);
    // Anthropic keys start with sk-ant-; anything else pasted while Anthropic is picked is left alone.
    if (value.trim().startsWith("sk-ant-")) setProvider("anthropic");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setStatus({ kind: "checking" });
    try {
      const res = await fetch("/donate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), email: email.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { key_hint?: string; error?: string };
      if (!res.ok) {
        setStatus({ kind: "failed", message: body.error ?? `Donation failed (${res.status})` });
        return;
      }
      setApiKey("");
      setStatus({ kind: "done", hint: body.key_hint ?? "", provider });
      onDonated();
    } catch {
      setStatus({ kind: "failed", message: "Couldn't reach Token Charity. Try again." });
    }
  }

  const checking = status.kind === "checking";

  return (
    <section aria-labelledby="donate-heading" className="border-y-2 border-ink py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="donate-heading" className="font-display text-[clamp(1.6rem,3vw,2.1rem)] leading-none font-extrabold uppercase">
          Donate your leftover credits
        </h2>
        <p className="text-sm text-ink-soft">Agents that ran dry keep working on it.</p>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3">
        <fieldset className="flex">
          <legend className="sr-only">Provider</legend>
          {(["anthropic", "openai"] as const).map((p) => (
            <label
              key={p}
              className={`cursor-pointer border-2 border-ink px-3 py-2 text-sm font-semibold first:rounded-l-sm last:rounded-r-sm not-first:-ml-0.5 ${
                provider === p ? "bg-ink text-paper" : "bg-paper/70 text-ink hover:bg-paper-deep"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={p}
                checked={provider === p}
                onChange={() => setProvider(p)}
                className="sr-only"
              />
              {PROVIDER_NAME[p]}
            </label>
          ))}
        </fieldset>

        <label className={`${FIELD_LABEL} min-w-[min(100%,18rem)] flex-[2]`}>
          API key
          <input
            type="password"
            required
            value={apiKey}
            onChange={(e) => onKeyChange(e.target.value)}
            placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
            className={FIELD_INPUT}
          />
        </label>

        <label className={`${FIELD_LABEL} min-w-[min(100%,12rem)] flex-1`}>
          Email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={FIELD_INPUT}
          />
        </label>

        <button
          type="submit"
          disabled={checking || !apiKey.trim()}
          className="border-2 border-board bg-board px-5 py-2 font-display text-xl font-extrabold tracking-wider text-gold uppercase transition-colors hover:bg-board-tile disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? "Checking…" : "Donate key"}
        </button>
      </form>

      <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
        {status.kind === "checking" && <span className="text-ink-soft">Checking the key with {PROVIDER_NAME[provider]}…</span>}
        {status.kind === "done" && (
          <span className="font-semibold text-live">
            Thanks. Your {PROVIDER_NAME[status.provider]} jar ····{status.hint} is live.
          </span>
        )}
        {status.kind === "failed" && <span className="font-semibold text-telethon">{status.message}</span>}
      </p>

      <p className="mt-1 max-w-prose text-xs text-ink-soft">
        We confirm the key with the provider before accepting it, store it encrypted, and only ever show its last 4
        characters. Best practice: create a separate key just for this, with a spend limit.
      </p>
    </section>
  );
}
