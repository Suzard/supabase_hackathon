"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

const PROVIDER_NAME: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

function useStats() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  return { stats, error };
}

export function Board() {
  const { stats, error } = useStats();
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

const noSubscribe = () => () => {};

/** This site's origin in the browser; empty during server rendering. */
function useOrigin(): string {
  return useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
}

function Jars({ keys, latestKeyId, latestAt }: { keys: Key[]; latestKeyId: string | null; latestAt: string | null }) {
  const origin = useOrigin();
  if (keys.length === 0) {
    return (
      <section className="border-2 border-dashed border-ink/30 p-6">
        <h2 className="font-display text-2xl font-bold uppercase">The jars are empty</h2>
        <p className="mt-2 max-w-prose text-ink-soft">Nobody has donated a key yet. Got unused credits?</p>
        <pre className="mt-3 overflow-x-auto bg-paper-deep p-3 text-sm">
          {`curl -X POST ${origin}/donate -H 'content-type: application/json' \\\n  -d '{"provider":"anthropic","api_key":"<key>"}'`}
        </pre>
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
