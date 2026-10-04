"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { HackathonItem } from "@/lib/hackathons";
import { PROVIDER_NAME, type Provider } from "@/lib/providers";
import type { PoolStats } from "@/lib/supabase-store";

type Key = PoolStats["keys"][number];
type Row = PoolStats["recent"][number];
type TopTab = "ai-credits" | "leaderboard" | "upcoming" | "donate" | "api" | "console" | "about";
type ModelRow = { id: string; owned_by: Provider };

const POLL_MS = 2000;

const DONOR_ROWS = [
  { provider: "OpenAI", donor: "alex.dev", hackathon: "Supabase Hackathon", creditsM: "1,000", expires: "Oct 3, 2026" },
  { provider: "Google", donor: "cloudlover", hackathon: "Cloud Lover Hackathon", creditsM: "750", expires: "Oct 3, 2026" },
  { provider: "Anthropic", donor: "jane.doe", hackathon: "Build for Good Hackathon", creditsM: "500", expires: "Oct 3, 2026" },
  { provider: "Vercel", donor: "builder.san", hackathon: "Student Builders Hackathon", creditsM: "300", expires: "Nov 15, 2026" },
  { provider: "Mistral", donor: "codeforgood", hackathon: "Open Source AI Hackathon", creditsM: "1,500", expires: "Nov 22, 2026" },
  { provider: "Meta", donor: "hacktogether", hackathon: "GameDev AI Hackathon", creditsM: "2,000", expires: "Dec 6, 2026" },
] as const;

const LEADERBOARD_ROWS = [
  ["alex.dev", 12.6],
  ["cloudlover", 8.5],
  ["jane.doe", 7.8],
  ["team-builder", 5.5],
  ["devangelist", 4.8],
  ["hacktogether", 4.2],
  ["builder.san", 3.9],
  ["openbuilder", 3.5],
  ["ai.collective", 3.2],
  ["codeforgood", 2.8],
] as const;

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

function dateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function donorLabel(k: Key): string {
  return k.donorName ?? k.donorEmail ?? "anonymous";
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

function useHackathons() {
  const [items, setItems] = useState<HackathonItem[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/hackathons", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { items?: HackathonItem[] };
        if (alive) setItems(body.items ?? []);
      } catch {
        // ignore and keep fallback empties
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  return items;
}

function useModels() {
  const [models, setModels] = useState<ModelRow[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/v1/models", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Array<{ id?: unknown; owned_by?: unknown }> };
        const parsed = (body.data ?? [])
          .map((m) => ({ id: String(m.id ?? ""), owned_by: m.owned_by === "openai" || m.owned_by === "anthropic" ? m.owned_by : null }))
          .filter((m): m is ModelRow => Boolean(m.id) && Boolean(m.owned_by));
        if (alive) setModels(parsed);
      } catch {
        // ignore
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  return models;
}

export function Board() {
  const { stats, error, reload } = useStats();
  const hackathons = useHackathons();
  const models = useModels();
  const [tab, setTab] = useState<TopTab>("donate");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [jarActionError, setJarActionError] = useState<string | null>(null);
  const keyById = new Map((stats?.keys ?? []).map((k) => [k.id, k]));
  const latest = stats?.recent.find((r) => r.statusCode < 300);

  async function removeJar(id: string) {
    if (!id || deletingId) return;
    setDeletingId(id);
    setJarActionError(null);
    try {
      const res = await fetch("/donate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setJarActionError(body.error ?? `Delete failed (${res.status})`);
        return;
      }
      reload();
    } catch {
      setJarActionError("Could not remove this key right now.");
    } finally {
      setDeletingId(null);
    }
  }

  const filteredRows = DONOR_ROWS.filter((r) =>
    [r.provider, r.donor, r.hackathon].join(" ").toLowerCase().includes(search.toLowerCase().trim()),
  );

  return (
    <main className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 lg:px-10">
      <header className="rounded-3xl border border-indigo-100 bg-white px-6 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-indigo-100 text-lg text-indigo-700">♡</span>
            <p className="text-2xl font-black tracking-tight text-indigo-950">tokencharity.dev</p>
          </div>
          <nav className="hidden gap-6 text-sm font-medium text-slate-600 md:flex">
            <TabButton label="AI Credits" active={tab === "ai-credits"} onClick={() => setTab("ai-credits")} />
            <TabButton label="Leaderboard" active={tab === "leaderboard"} onClick={() => setTab("leaderboard")} />
            <TabButton label="Upcoming Hackathons" active={tab === "upcoming"} onClick={() => setTab("upcoming")} />
            <TabButton label="Donate" active={tab === "donate"} onClick={() => setTab("donate")} />
            <TabButton label="API" active={tab === "api"} onClick={() => setTab("api")} />
            <TabButton label="Console" active={tab === "console"} onClick={() => setTab("console")} />
            <TabButton label="About" active={tab === "about"} onClick={() => setTab("about")} />
          </nav>
        </div>
      </header>

  <section className="mt-6 grid gap-6 rounded-3xl border border-indigo-100 bg-gradient-to-b from-white to-indigo-50/40 p-5 shadow-sm sm:p-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-indigo-950 sm:text-6xl">Donate Your API Token</h1>
          <p className="mt-3 max-w-3xl text-lg text-slate-600">
            Share your existing API tokens with the hacker community. Set access limits and duration, and we&apos;ll
            securely validate and manage usage.
          </p>
        </div>
        <HeroAside />
      </section>

      {tab === "ai-credits" && (
        <section className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_0.85fr]">
          <article className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-black tracking-tight text-indigo-950">Free AI Credits for Hackers</h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search providers, donors, or hackathons..."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none sm:max-w-md"
              />
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-2">Provider</th>
                    <th>Donor</th>
                    <th>Hackathon</th>
                    <th>Credits (M)</th>
                    <th>Expires On</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={`${r.provider}-${r.donor}-${r.hackathon}`} className="border-t border-slate-100">
                      <td className="py-3 font-semibold text-indigo-950">{r.provider}</td>
                      <td>{r.donor}</td>
                      <td>{r.hackathon}</td>
                      <td className="font-semibold text-indigo-700">{r.creditsM}</td>
                      <td>{r.expires}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <div className="space-y-6">
            <UpcomingListCard items={hackathons} />
            <LeaderboardMini />
          </div>
        </section>
      )}

      {tab === "leaderboard" && (
        <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
          <h2 className="text-3xl font-black tracking-tight text-indigo-950">Top Donors</h2>
          <p className="mt-1 text-sm text-slate-600">By billions of tokens donated.</p>
          <ol className="mt-6 space-y-3">
            {LEADERBOARD_ROWS.map(([name, score], idx) => (
              <li key={name} className="grid grid-cols-[28px_1fr_70px] items-center gap-3">
                <span className="text-sm font-semibold text-slate-500">{idx + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-indigo-950">{name}</p>
                  <div className="mt-1 h-2 rounded-full bg-indigo-100">
                    <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${(score / LEADERBOARD_ROWS[0][1]) * 100}%` }} />
                  </div>
                </div>
                <span className="text-right text-sm font-bold text-indigo-700">{score.toFixed(1)}B</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {tab === "upcoming" && (
        <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
          <h2 className="text-3xl font-black tracking-tight text-indigo-950">Upcoming Hackathons</h2>
          <p className="mt-1 text-sm text-slate-600">Live-scraped from Luma with seeded fallback data.</p>
          <div className="mt-5 grid gap-3">
            {hackathons.map((h) => (
              <a key={h.id} href={h.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-semibold text-indigo-950">{h.title}</p>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">{h.source}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{h.city}</p>
                <p className="mt-1 text-xs text-slate-500">{new Date(h.startsAt).toLocaleDateString()} → {new Date(h.endsAt).toLocaleDateString()}</p>
              </a>
            ))}
          </div>
        </section>
      )}

      {tab === "donate" && (
        <>
          <section className="mt-6 grid gap-6 xl:grid-cols-[1.02fr_1.4fr]">
            <div className="space-y-6">
              <WhyDonate />
              <SupportedProviders />
              <ToteBoard stats={stats} />
            </div>

            <div className="space-y-6">
              <DonatePanel onDonated={reload} />
              {error && !stats && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                  Can&apos;t reach the pool yet ({error}). Once the database is connected, this board fills in.
                </p>
              )}
              <Jars
                keys={stats?.keys ?? []}
                latestKeyId={latest?.keyId ?? null}
                latestAt={latest?.createdAt ?? null}
                deletingId={deletingId}
                onRemove={removeJar}
                actionError={jarActionError}
              />
            </div>
          </section>

          <section className="mt-8 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-indigo-950">Live pool activity</h2>
            <Ledger rows={stats?.recent ?? []} keyById={keyById} />
          </section>
        </>
      )}

      {tab === "api" && <ApiTab />}

      {tab === "console" && <ConsoleTab models={models} />}

      {tab === "about" && (
        <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
          <h2 className="text-3xl font-black tracking-tight text-indigo-950">About Token Charity</h2>
          <p className="mt-3 max-w-3xl text-slate-700">
            Token Charity helps agents that ran out of credits continue working by routing requests through donated
            provider keys. Donors contribute unused credits, and recipients pay a reduced metered rate.
          </p>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-slate-700">
            <li>Native protocol support for Anthropic and OpenAI-compatible calls.</li>
            <li>Automatic rerouting when a donated key is revoked or exhausted.</li>
            <li>Usage ledger and donation impact tracking for transparency.</li>
          </ul>
        </section>
      )}
    </main>
  );
}

function ApiTab() {
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  const masked = apiKey ? `${apiKey.slice(0, 6)}${"•".repeat(Math.max(8, apiKey.length - 10))}${apiKey.slice(-4)}` : "No key yet";

  async function issueKey() {
    if (!email.trim()) {
      setStatus("Email is required to issue a key.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), label: "board-api-tab" }),
      });
      const body = (await res.json().catch(() => ({}))) as { api_key?: string; error?: string };
      if (!res.ok || !body.api_key) {
        setStatus(body.error ?? `Register failed (${res.status})`);
        return;
      }
      setApiKey(body.api_key);
      setShow(false);
      setStatus("API key issued. Use copy to save it now.");
    } catch {
      setStatus("Could not issue key right now.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setStatus("Copied API key.");
    } catch {
      setStatus("Clipboard blocked. Reveal and copy manually.");
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
      <h2 className="text-3xl font-black tracking-tight text-indigo-950">API</h2>
      <p className="mt-1 text-sm text-slate-600">Issue a Token Charity API key, keep it hidden by default, then copy it.</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className={FIELD_LABEL}>
          Billing email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" className={FIELD_INPUT} />
        </label>
        <button
          type="button"
          onClick={issueKey}
          disabled={busy}
          className="self-end rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Issuing…" : "Issue key"}
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">API key</p>
        <p className="mt-2 break-all font-mono text-sm text-indigo-950">{show ? apiKey || "No key yet" : masked}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setShow((v) => !v)} disabled={!apiKey} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
            {show ? "Hide" : "Reveal"}
          </button>
          <button type="button" onClick={copy} disabled={!apiKey} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 disabled:opacity-50">
            Copy key
          </button>
        </div>
      </div>

      {!!status && <p className="mt-3 text-sm text-slate-700">{status}</p>}
    </section>
  );
}

function ConsoleTab({ models }: { models: ModelRow[] }) {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [chosenByProvider, setChosenByProvider] = useState<Partial<Record<Provider, string>>>({});
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatRows, setChatRows] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const providerModels = models.filter((m) => m.owned_by === provider);
  const selectedModel = chosenByProvider[provider] && providerModels.some((m) => m.id === chosenByProvider[provider])
    ? (chosenByProvider[provider] as string)
    : (providerModels[0]?.id ?? "");

  function onModelChange(next: string) {
    setChosenByProvider((prev) => ({ ...prev, [provider]: next }));
  }

  function readOpenAIText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const p = payload as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
    };
    if (typeof p.output_text === "string" && p.output_text.trim()) return p.output_text;
    const parts = (p.output ?? []).flatMap((o) =>
      (o.content ?? [])
        .filter((c) => c?.type === "output_text" && typeof c.text === "string")
        .map((c) => String(c.text)),
    );
    return parts.join("\n").trim();
  }

  function readAnthropicText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const p = payload as { content?: Array<{ type?: unknown; text?: unknown }> };
    const parts = (p.content ?? [])
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => String(c.text));
    return parts.join("\n").trim();
  }

  function summarizeError(body: string): string {
    if (!body.trim()) return "Request failed.";
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      if (typeof parsed.error === "string") return parsed.error;
      if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") return parsed.error.message;
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // keep raw body
    }
    return body.slice(0, 240);
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = apiKey.trim();
    const text = prompt.trim();
    if (!key || !text || !selectedModel || sending) return;

    setSending(true);
    setChatError(null);
    setPrompt("");
    setChatRows((prev) => [...prev, { role: "user", text }]);

    try {
      const res = provider === "anthropic"
        ? await fetch("/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: selectedModel,
              max_tokens: 512,
              messages: [{ role: "user", content: text }],
            }),
          })
        : await fetch("/v1/responses", {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: selectedModel,
              max_output_tokens: 512,
              input: text,
            }),
          });

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        throw new Error(summarizeError(raw) || `${provider} request failed (${res.status})`);
      }

      const payload = (await res.json().catch(() => ({}))) as unknown;
      const answer = provider === "anthropic" ? readAnthropicText(payload) : readOpenAIText(payload);
      setChatRows((prev) => [...prev, { role: "assistant", text: answer || "(No text was returned.)" }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      setChatError(message);
      setChatRows((prev) => [...prev, { role: "assistant", text: `Error: ${message}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm">
      <h2 className="text-3xl font-black tracking-tight text-indigo-950">Console</h2>
      <p className="mt-1 text-sm text-slate-600">Pick a provider and model, then chat directly from the dashboard.</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className={FIELD_LABEL}>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={FIELD_INPUT}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label className={FIELD_LABEL}>
          Model
          <select value={selectedModel} onChange={(e) => onModelChange(e.target.value)} className={FIELD_INPUT}>
            {providerModels.length === 0 ? (
              <option value="">No models available</option>
            ) : (
              providerModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))
            )}
          </select>
        </label>

        <label className={FIELD_LABEL}>
          Token Charity API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="tc_..."
            autoComplete="off"
            spellCheck={false}
            className={FIELD_INPUT}
          />
        </label>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p>
          Selected provider: <span className="font-semibold text-indigo-900">{PROVIDER_NAME[provider]}</span>
        </p>
        <p className="mt-1 break-all">
          Selected model: <span className="font-semibold text-indigo-900">{selectedModel || "—"}</span>
        </p>
      </div>

      <form onSubmit={onSend} className="mt-4 space-y-3">
        <label className={FIELD_LABEL}>
          Chat prompt
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask anything..."
            rows={4}
            className={`${FIELD_INPUT} resize-y`}
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Sends to {provider === "anthropic" ? "`/v1/messages`" : "`/v1/responses`"} using your selected model.
          </p>
          <button
            type="submit"
            disabled={sending || !apiKey.trim() || !prompt.trim() || !selectedModel}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {chatError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{chatError}</p>}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-indigo-950">Chat</h3>
        {chatRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No messages yet. Send your first prompt above.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {chatRows.map((row, idx) => (
              <li
                key={`${row.role}-${idx}-${row.text.slice(0, 16)}`}
                className={`rounded-lg px-3 py-2 text-sm ${
                  row.role === "user" ? "bg-indigo-600 text-white" : "bg-white text-slate-800"
                }`}
              >
                <p className="mb-1 text-[11px] font-semibold uppercase opacity-80">{row.role}</p>
                <p className="whitespace-pre-wrap break-words">{row.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 pb-1 transition ${active ? "border-indigo-500 text-indigo-700" : "border-transparent hover:text-indigo-700"}`}
    >
      {label}
    </button>
  );
}

function UpcomingListCard({ items }: { items: HackathonItem[] }) {
  return (
    <article className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-indigo-950">Upcoming Hackathons</h3>
      <ul className="mt-3 space-y-3 text-sm">
        {items.slice(0, 5).map((h) => (
          <li key={h.id} className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="font-semibold text-indigo-900">{h.title}</p>
            <p className="text-slate-600">{h.city}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}

function LeaderboardMini() {
  return (
    <article className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-indigo-950">Top Donors</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {LEADERBOARD_ROWS.slice(0, 5).map(([name, score], idx) => (
          <li key={name} className="flex items-center justify-between gap-3">
            <span className="text-slate-500">#{idx + 1} {name}</span>
            <span className="font-semibold text-indigo-700">{score.toFixed(1)}B</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function HeroAside() {
  return (
    <aside className="grid gap-4 sm:grid-cols-[1fr_1.4fr] lg:grid-cols-[1fr_1.2fr]">
      <div className="grid place-items-center rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-indigo-500">
        <div className="text-7xl leading-none">♡</div>
      </div>
      <div className="rounded-2xl border border-indigo-100 bg-white p-4">
        <ul className="space-y-3">
          {[
            ["Make an impact", "Help hackers build amazing projects."],
            ["You stay in control", "Set limits, duration, and provider."],
            ["Secure & transparent", "Tokens are validated, encrypted, and monitored."],
          ].map(([title, text]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 inline-grid size-6 place-items-center rounded-full border border-indigo-200 bg-indigo-50 text-xs text-indigo-700">
                ✓
              </span>
              <div>
                <p className="text-sm font-semibold text-indigo-950">{title}</p>
                <p className="text-xs text-slate-600">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function WhyDonate() {
  const reasons = [
    ["🤝", "Support the hacker community", "Give builders access to AI tools to create innovative projects at hackathons."],
    ["⚙️", "Flexible controls", "Set time limits, usage limits, and model restrictions."],
    ["🛡️", "Secure & validated", "We validate your token with the provider and keep it encrypted at rest."],
    ["📈", "Track your impact", "See usage stats and the projects your token has helped power."],
  ] as const;

  return (
    <article className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
      <h2 className="text-3xl font-black tracking-tight text-indigo-950">Why Donate Your API Token?</h2>
      <ul className="mt-6 space-y-5">
        {reasons.map(([icon, title, text]) => (
          <li key={title} className="flex gap-4">
            <span className="mt-1 inline-grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-100 text-lg" aria-hidden>
              {icon}
            </span>
            <div>
              <p className="font-semibold text-indigo-950">{title}</p>
              <p className="text-sm text-slate-600">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}

function SupportedProviders() {
  const cards = [
    ["OpenAI", "GPT-4, GPT-4o"],
    ["Google", "Gemini 1.5, 2.0"],
    ["Anthropic", "Claude 3.5 / 3 Opus"],
    ["Vercel", "AI SDK, Vercel AI"],
    ["Meta", "Llama 3"],
    ["Mistral", "Mistral Large, Small"],
    ["Cohere", "Command R+"],
    ["xAI", "Grok 2"],
  ] as const;

  return (
    <article className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
      <h3 className="text-2xl font-black tracking-tight text-indigo-950">Supported Providers</h3>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([name, note]) => (
          <li key={name} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
            <p className="font-semibold text-indigo-950">{name}</p>
            <p className="mt-1 text-xs text-slate-600">{note}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ToteBoard({ stats }: { stats: PoolStats | null }) {
  const totals = stats?.totals;
  const digits = boardDigits(totals?.donatedUsd ?? 0);

  return (
    <section aria-label="Inference donated so far" className="rounded-2xl border border-indigo-100 bg-indigo-950 px-6 pt-5 pb-6 text-white shadow-sm">
      <p className="text-xs font-semibold tracking-[0.2em] text-indigo-200 uppercase">Inference donated so far</p>
      <div className="mt-3 flex flex-wrap gap-[0.35rem]" aria-live="polite" aria-label={digits}>
        {digits.split("").map((ch, i) => (
          <Tile key={`${i}-${ch}`} ch={ch} />
        ))}
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-indigo-100 sm:grid-cols-4">
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
      className={`flap relative grid place-items-center overflow-hidden rounded-[3px] bg-indigo-900 font-display font-extrabold text-indigo-100 ${
        narrow ? "w-[0.55em]" : "w-[0.82em]"
      } h-[1.2em] text-[clamp(3.25rem,8vw,6.5rem)] leading-none`}
    >
      {ch}
      {!narrow && <span className="absolute inset-x-0 top-1/2 h-[2px] bg-indigo-800" aria-hidden />}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.7rem] font-semibold tracking-[0.2em] text-indigo-300 uppercase">{label}</dt>
      <dd className="font-display text-2xl font-bold tracking-wide">{value}</dd>
    </div>
  );
}

function Jars({
  keys,
  latestKeyId,
  latestAt,
  deletingId,
  onRemove,
  actionError,
}: {
  keys: Key[];
  latestKeyId: string | null;
  latestAt: string | null;
  deletingId: string | null;
  onRemove: (id: string) => void;
  actionError: string | null;
}) {
  if (keys.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
        <h2 className="font-display text-2xl font-bold uppercase">No donated keys yet</h2>
        <p className="mt-2 max-w-prose text-ink-soft">Nobody has donated a key yet. Be the first, just above.</p>
      </section>
    );
  }

  return (
    <section aria-label="Donated keys" className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-indigo-950">Donated keys</h2>
      {actionError && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8">
        {keys.map((k) => (
          
          <Jar
            key={k.id}
            k={k}
            serving={k.id === latestKeyId}
            servedAt={latestAt}
            removing={deletingId === k.id}
            onRemove={() => onRemove(k.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function Jar({
  k,
  serving,
  servedAt,
  removing,
  onRemove,
}: {
  k: Key;
  serving: boolean;
  servedAt: string | null;
  removing: boolean;
  onRemove: () => void;
}) {
  const live = k.status === "live";
  const stampText = k.status === "invalid" ? "Revoked" : "Spent";
  const donatedBy = donorLabel(k);

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
      <p className="mt-3 text-sm font-semibold">{PROVIDER_NAME[k.provider] ?? k.provider} · {donatedBy}</p>
      <p className="font-display text-lg tracking-[0.2em]">····{k.hint}</p>
      <p className="text-xs text-ink-soft">
        {usd(k.costAbsorbedUsd)} given · {compact(k.requestsServed)} req
      </p>
      <p className="text-[11px] text-slate-500">Expires: {dateShort(k.expiresAt)}</p>
      {k.eventTag && <p className="text-[11px] text-indigo-700">Event: {k.eventTag}</p>}
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Delete donated ${PROVIDER_NAME[k.provider] ?? k.provider} key ending in ${k.hint}`}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
        {removing ? "Deleting…" : "Delete"}
      </button>
    </li>
  );
}

function Ledger({ rows, keyById }: { rows: Row[]; keyById: Map<string, Key> }) {
  // Rows are keyed, so only new ones mount, and the slide-in animation plays on mount only.
  const rowId = (r: Row) => `${r.createdAt}-${r.keyId}-${r.attempt}`;

  return (
    <aside aria-label="Recent requests" className="lg:row-span-2">
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
          {clock(r.createdAt)} · key {k?.hint ?? "?"}
          {decider && <span className="ml-2 rounded-sm bg-ink px-1.5 py-px font-semibold text-paper">{decider}</span>}
          {r.attempt > 1 && !failed && (
            <span className="ml-2 font-semibold text-telethon uppercase">rerouted · try {r.attempt}</span>
          )}
        </span>
        <span>{failed ? "key failed, trying next key" : `paid ${usd(r.chargedUsd)}`}</span>
      </div>
    </li>
  );
}

const FIELD_LABEL = "flex flex-col gap-1 text-xs font-semibold tracking-[0.15em] text-ink-soft uppercase";
const FIELD_INPUT =
  "rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-sans text-base tracking-normal text-slate-900 normal-case outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

type DonateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; hint: string; provider: Provider }
  | { kind: "failed"; message: string };

function DonatePanel({ onDonated }: { onDonated: () => void }) {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [eventTag, setEventTag] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [limitUsd, setLimitUsd] = useState("100");
  const [rateLimit, setRateLimit] = useState("60");
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
        body: JSON.stringify({
          provider,
          api_key: apiKey.trim(),
          email: email.trim() || undefined,
          event_tag: eventTag.trim() || undefined,
          duration_days: Number(durationDays),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { key_hint?: string; error?: string };
      if (!res.ok) {
        setStatus({ kind: "failed", message: body.error ?? `Donation failed (${res.status})` });
        return;
      }
      setApiKey("");
      setEventTag("");
      setStatus({ kind: "done", hint: body.key_hint ?? "", provider });
      onDonated();
    } catch {
      setStatus({ kind: "failed", message: "Couldn't reach Token Charity. Try again." });
    }
  }

  const checking = status.kind === "checking";
  const providerChoices = [
    { id: "openai", label: "OpenAI", short: "OA", supported: true },
    { id: "google", label: "Google", short: "G", supported: false },
    { id: "anthropic", label: "Anthropic", short: "AI", supported: true },
    { id: "vercel", label: "Vercel", short: "V", supported: false },
    { id: "meta", label: "Meta", short: "M", supported: false },
    { id: "mistral", label: "Mistral", short: "Mi", supported: false },
    { id: "cohere", label: "Cohere", short: "C", supported: false },
    { id: "xai", label: "xAI", short: "x", supported: false },
  ] as const;

  return (
    <section aria-labelledby="donate-heading" className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="donate-heading" className="text-3xl font-black tracking-tight text-indigo-950">
          Donate Your API Token
        </h2>
        <p className="text-sm text-slate-500">Securely validated and encrypted</p>
      </div>

      <ol className="mt-5 grid gap-3 text-sm font-medium text-slate-500 sm:grid-cols-4">
        {["Configure", "Validate", "Review", "Complete"].map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className={`grid size-7 place-items-center rounded-full ${i === 0 ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"}`}>
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-indigo-950">1 · Select Provider</p>
          <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <legend className="sr-only">Provider</legend>
            {providerChoices.map((choice) => {
              const selected = provider === choice.id;
              return (
                <label
                  key={choice.id}
                  className={`rounded-xl border px-2 py-2 text-center text-xs font-semibold transition ${
                    choice.supported
                      ? selected
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={choice.id}
                    checked={selected}
                    onChange={() => {
                      if (!choice.supported) return;
                      setProvider(choice.id as Provider);
                    }}
                    disabled={!choice.supported}
                    className="sr-only"
                  />
                  <span className="mx-auto mb-1 grid size-7 place-items-center rounded-md bg-white/80 text-[11px] font-bold text-indigo-900">
                    {choice.short}
                  </span>
                  {choice.label}
                </label>
              );
            })}
          </fieldset>
          <p className="mt-2 text-xs text-slate-500">Only OpenAI and Anthropic are active in this build.</p>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-indigo-950">2 · Enter Your API Token</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={FIELD_LABEL}>
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
            <label className={FIELD_LABEL}>
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
            <label className={FIELD_LABEL}>
              Event tag (optional)
              <input
                value={eventTag}
                onChange={(e) => setEventTag(e.target.value)}
                placeholder="Supabase Hackathon"
                maxLength={80}
                className={FIELD_INPUT}
              />
            </label>
          </div>
          <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Your token will be validated to ensure it&apos;s active and has the required permissions.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-indigo-950">3 · Set Access Limits</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={FIELD_LABEL}>
              Duration
              <select value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className={FIELD_INPUT}>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </label>
            <label className={FIELD_LABEL}>
              Usage limit (USD)
              <input value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} className={FIELD_INPUT} />
            </label>
            <label className={FIELD_LABEL}>
              Currency
              <select className={FIELD_INPUT} defaultValue="USD">
                <option>USD</option>
              </select>
            </label>
            <label className={FIELD_LABEL}>
              Rate limit (req/min)
              <input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} className={FIELD_INPUT} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-sm">
            {status.kind === "checking" && <span className="text-slate-600">Checking the key with {PROVIDER_NAME[provider]}…</span>}
            {status.kind === "done" && (
              <span className="font-semibold text-emerald-700">
                Thanks. Your {PROVIDER_NAME[status.provider]} key ····{status.hint} is live.
              </span>
            )}
            {status.kind === "failed" && <span className="font-semibold text-rose-700">{status.message}</span>}
          </p>

          <button
            type="submit"
            disabled={checking || !apiKey.trim()}
            className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? "Validating…" : "Validate and Continue"}
          </button>
        </div>

      </form>

      <p className="mt-4 max-w-prose text-xs text-slate-500">
        We confirm the key with the provider before accepting it, store it encrypted, and only ever show its last 4
        characters. Best practice: create a separate key just for this, with a spend limit.
      </p>

    </section>
  );
}
