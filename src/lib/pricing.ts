import type { Provider } from "./providers";
import type { NormalizedUsage } from "./usage";

// List prices come from the AI Gateway's public model catalog, not from memory.
// The Gateway states it adds no markup, so its per-token prices are provider list
// prices. Long-context tier pricing is ignored; base rates are used.
export const PRICE_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

/** USD per token. Cache rates fall back to the input rate when the catalog omits them. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type PriceTable = Map<string, Price>;

export function buildPriceTable(catalog: unknown): PriceTable {
  const table: PriceTable = new Map();
  const data = (catalog as { data?: unknown })?.data;
  if (!Array.isArray(data)) return table;
  for (const entry of data) {
    const id = (entry as { id?: unknown }).id;
    const pricing = (entry as { pricing?: Record<string, unknown> }).pricing;
    if (typeof id !== "string" || !pricing) continue;
    const input = Number(pricing.input);
    const output = Number(pricing.output);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    const rate = (key: string) => {
      const v = Number(pricing[key]);
      return Number.isFinite(v) ? v : input;
    };
    table.set(id, { input, output, cacheRead: rate("input_cache_read"), cacheWrite: rate("input_cache_write") });
  }
  return table;
}

/**
 * Finds the catalog price for a native model ID. The catalog writes Anthropic
 * versions with dots (`claude-opus-5.5`) where native IDs use dashes
 * (`claude-opus-5-5`), and dated snapshots are listed under their base name.
 * Returns null rather than guessing when nothing matches.
 */
export function lookupPrice(table: PriceTable, provider: Provider, model: string): Price | null {
  const undated = model.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const candidates = new Set([model, undated]);
  if (provider === "anthropic") {
    for (const c of [...candidates]) candidates.add(c.replace(/(\d)-(\d)/g, "$1.$2"));
  }
  for (const c of candidates) {
    const price = table.get(`${provider}/${c}`);
    if (price) return price;
  }
  return null;
}

/** Recipients pay this fraction of the provider's list price. */
export const RECIPIENT_RATE = 0.05;

export function costUsd(price: Price | null, usage: NormalizedUsage): number {
  if (!price) return 0;
  return (
    price.input * usage.input +
    price.cacheRead * usage.cacheRead +
    price.cacheWrite * usage.cacheWrite +
    price.output * usage.output
  );
}

let cached: { table: PriceTable; fetchedAt: number } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function getPriceTable(fetchImpl: typeof fetch = fetch): Promise<PriceTable> {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.table;
  try {
    const res = await fetchImpl(PRICE_CATALOG_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    cached = { table: buildPriceTable(await res.json()), fetchedAt: Date.now() };
    return cached.table;
  } catch {
    // Metering must never break serving. A stale table beats none; none means price unknown.
    return cached?.table ?? new Map();
  }
}
