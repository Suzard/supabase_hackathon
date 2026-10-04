import { db } from "./supabase-store";

export interface HackathonItem {
  id: string;
  title: string;
  city: string;
  startsAt: string;
  endsAt: string;
  url: string;
  source: "luma" | "seed";
}

interface HackathonRow {
  external_id: string;
  title: string;
  city: string;
  starts_at: string;
  ends_at: string;
  url: string;
  source: string;
}

const seedSupabaseHackathon: HackathonItem = {
  id: "seed-supabase-2026-10-03",
  title: "Supabase Hackathon",
  city: "Virtual",
  startsAt: "2026-10-03T16:00:00.000Z",
  endsAt: "2026-10-03T23:59:00.000Z",
  url: "https://supabase.com",
  source: "seed",
};

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const LUMA_COLLECTION_URLS = ["https://luma.com/hackathon_collections", "https://lu.ma/hackathon_collections"];
const HACKATHON_WORDS = /(hackathon|hack day|sprint)/i;

function mergeWithHardcodedSupabase(items: HackathonItem[]): HackathonItem[] {
  return [seedSupabaseHackathon, ...items.filter((e) => e.title !== seedSupabaseHackathon.title)].slice(0, 8);
}

async function pruneOldStoredEvents() {
  const cutoffIso = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { error } = await db().from("hackathon_events").delete().lt("ends_at", cutoffIso);
  if (error) throw new Error(`supabase: ${error.message}`);
}

async function upsertStoredEvents(items: HackathonItem[]) {
  if (!items.length) return;
  const rows = items.map((item) => ({
    external_id: item.id,
    title: item.title,
    city: item.city,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    url: item.url,
    source: item.source,
  }));
  const { error } = await db().from("hackathon_events").upsert(rows, { onConflict: "external_id" });
  if (error) throw new Error(`supabase: ${error.message}`);
}

async function readStoredEvents(limit: number): Promise<HackathonItem[]> {
  const { data, error } = await db()
    .from("hackathon_events")
    .select("external_id, title, city, starts_at, ends_at, url, source")
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`supabase: ${error.message}`);
  const rows = (data ?? []) as HackathonRow[];

  return rows.map((row) => ({
    id: row.external_id,
    title: row.title,
    city: row.city,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    url: row.url,
    source: row.source === "seed" ? "seed" : "luma",
  }));
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseMonthDayTime(context: string): Date | null {
  const monthDay = context.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/i);
  if (!monthDay) return null;

  const month = MONTHS[monthDay[1].slice(0, 3).toLowerCase()];
  const day = Number(monthDay[2]);
  if (month === undefined || Number.isNaN(day)) return null;

  const now = new Date();
  const time = context.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  let hours = 9;
  let minutes = 0;
  if (time) {
    const rawHours = Number(time[1]);
    const rawMinutes = Number(time[2]);
    const meridiem = time[3].toUpperCase();
    hours = rawHours % 12 + (meridiem === "PM" ? 12 : 0);
    minutes = rawMinutes;
  }

  let year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
  if (candidate.getTime() < now.getTime() - 45 * 24 * 60 * 60 * 1000) {
    year += 1;
  }
  return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
}

function extractCity(context: string): string {
  const match = context.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2})|Virtual|Financial District)\b/);
  return match?.[1] ?? "SF Bay Area";
}

function parseEventLinks(html: string): HackathonItem[] {
  const out: HackathonItem[] = [];
  const anchorRegex = /<a[^>]*href=["'](https:\/\/luma\.com\/[^"'#?\s]+|\/[^"'#?\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const deniedPath = new Set([
    "/",
    "/discover",
    "/signin",
    "/hackathon_collections",
    "/hackathon_collections/map",
  ]);

  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = match[1] ?? "";
    const href = rawHref.startsWith("http") ? rawHref : `https://luma.com${rawHref}`;
    const u = new URL(href);

    if (deniedPath.has(u.pathname)) continue;
    if (u.pathname.startsWith("/event-search")) continue;

    const title = (match[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;

    const lower = title.toLowerCase();
    if (!HACKATHON_WORDS.test(lower)) continue;

    const start = Math.max(0, (match.index ?? 0) - 180);
    const end = Math.min(html.length, (match.index ?? 0) + 220);
    const context = html.slice(start, end).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const startsAtDate = parseMonthDayTime(context) ?? new Date();
    const startsAt = startsAtDate.toISOString();
    const endsAt = new Date(startsAtDate.getTime() + 8 * 60 * 60 * 1000).toISOString();

    out.push({
      id: `luma-${u.pathname.replace(/^\//, "")}`,
      title,
      city: extractCity(context),
      startsAt,
      endsAt,
      url: u.toString(),
      source: "luma",
    });
  }
  return out;
}

function parseEventFromLd(value: unknown): HackathonItem[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;

  const nodes: Record<string, unknown>[] = [];
  if (Array.isArray(root["@graph"])) {
    for (const n of root["@graph"] as unknown[]) {
      if (n && typeof n === "object") nodes.push(n as Record<string, unknown>);
    }
  }
  nodes.push(root);

  const pushEventLikeNodes = (node: Record<string, unknown>) => {
    const type = node["@type"];
    const isItemList =
      type === "ItemList" ||
      (Array.isArray(type) && type.some((t) => typeof t === "string" && t.toLowerCase() === "itemlist"));
    if (!isItemList) return;

    const list = node.itemListElement;
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const entryObj = entry as Record<string, unknown>;
      const item = entryObj.item;
      if (item && typeof item === "object") nodes.push(item as Record<string, unknown>);
    }
  };

  for (const node of [...nodes]) pushEventLikeNodes(node);

  const events: HackathonItem[] = [];
  for (const node of nodes) {
    const type = node["@type"];
    const isEvent =
      type === "Event" ||
      (Array.isArray(type) && type.some((t) => typeof t === "string" && t.toLowerCase() === "event"));
    if (!isEvent) continue;

    const title = typeof node.name === "string" ? node.name : "Hackathon";
    const startsAt = typeof node.startDate === "string" ? node.startDate : new Date().toISOString();
    const endsAt = typeof node.endDate === "string" ? node.endDate : startsAt;
    const url = typeof node.url === "string" ? node.url : "https://lu.ma";

    let city = "Virtual";
    const location = node.location;
    if (location && typeof location === "object") {
      const loc = location as Record<string, unknown>;
      if (typeof loc.name === "string") city = loc.name;
      const address = loc.address;
      if (address && typeof address === "object") {
        const addr = address as Record<string, unknown>;
        const locality = typeof addr.addressLocality === "string" ? addr.addressLocality : "";
        const region = typeof addr.addressRegion === "string" ? addr.addressRegion : "";
        if (locality || region) city = [locality, region].filter(Boolean).join(", ");
      }
    }

    events.push({
      id: `luma-${url}`,
      title,
      city,
      startsAt,
      endsAt,
      url,
      source: "luma",
    });
  }
  return events;
}

async function scrapeLumaHackathons(): Promise<HackathonItem[]> {
  const errors: string[] = [];
  let html = "";

  for (const url of LUMA_COLLECTION_URLS) {
    try {
      console.info(`[hackathons] requesting ${url}`);
      const res = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
        redirect: "follow",
      });
      console.info(`[hackathons] ${url} -> ${res.status}`);

      if (!res.ok) {
        errors.push(`${url} -> ${res.status}`);
        continue;
      }

      const body = await res.text();
      if (!body.trim()) {
        errors.push(`${url} -> empty-body`);
        continue;
      }

      html = body;
      break;
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!html) throw new Error(`luma crawl failed: ${errors.join(" | ")}`);

  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const out: HackathonItem[] = [];
  for (const m of scripts) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) out.push(...parseEventFromLd(n));
    } catch {
      // ignore malformed blocks
    }
  }

  if (!out.length) {
    out.push(...parseEventLinks(html));
  }

  const unique = new Map<string, HackathonItem>();
  for (const e of out) unique.set(e.id, e);
  return [...unique.values()].slice(0, 8);
}

export async function getUpcomingHackathons(): Promise<HackathonItem[]> {
  let live: HackathonItem[] = [];

  try {
    console.info("[hackathons] attempting live crawl from luma");
    live = await scrapeLumaHackathons();
    console.info(`[hackathons] live crawl succeeded: ${live.length} events`);
  } catch {
    live = [];
    console.warn("[hackathons] live crawl failed; falling back to DB cache/fallback event");
  }

  if (live.length) {
    try {
      await pruneOldStoredEvents();
      await upsertStoredEvents(live);
    } catch {
      // If DB persistence fails, still return fresh crawl results.
    }
    return mergeWithHardcodedSupabase(live);
  }

  try {
    await pruneOldStoredEvents();
    const stored = await readStoredEvents(8);
    if (stored.length) return mergeWithHardcodedSupabase(stored);
  } catch {
    // Fall through to hardcoded fallback.
  }

  return [seedSupabaseHackathon];
}
