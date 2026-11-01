/**
 * GeckoTerminal's free public API (api.geckoterminal.com), read from the visitor's browser for a coin page's 24-hour
 * stats, trades and candles. It allows cross-origin reads, and its limit is about 30 calls a minute per address: the
 * Worker's shared outgoing addresses were refused (429) on every call on 1 November 2026, while a visitor's own address
 * has the limit to itself (a coin page makes about five calls a minute). Read only; nothing about the visitor is sent
 * but the request itself. For a coin on its curve, GeckoTerminal's pool is the curve account.
 */
import { SOLANA_ADDRESS } from "./launches";
import type { Candle, ChartRange, MarketTrade } from "./market";

export const GECKO_API = "https://api.geckoterminal.com/api/v2";
const GECKO_ACCEPT = "application/json;version=20230302";
const TIMEOUT_MS = 8_000;
/** Trades shown, newest first. */
export const TRADES_SHOWN = 40;
export const CANDLE_PATH: Record<ChartRange, [timeframe: "minute" | "hour" | "day", aggregate: number]> = {
  "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1],
};

const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const count = (value: unknown) => { const n = num(value); return n !== null && n >= 0 ? Math.floor(n) : 0; };
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

export type PoolStats = {
  priceUsd: number | null; quoteUsd: number | null; reserveUsd: number | null; fdvUsd: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  volumeUsd24h: number | null;
  txns24h: { buys: number; sells: number; buyers: number; sellers: number } | null;
};
/** GeckoTerminal's pool answer as the page's stats; the coin may be either side of the pool. */
export function parsePool(json: unknown, mint: string): PoolStats | null {
  const data = record(record(json).data), attributes = record(data.attributes);
  if (!Object.keys(attributes).length) return null;
  const relationships = record(data.relationships);
  const baseId = String(record(record(relationships.base_token).data).id ?? "");
  const coinIsBase = !baseId || baseId.endsWith(mint);
  const change = record(attributes.price_change_percentage), volume = record(attributes.volume_usd), h24 = record(record(attributes.transactions).h24);
  // GeckoTerminal states change as the base token's; the page never shows it for a coin that is the pool's quote.
  const pct = (key: string) => (coinIsBase ? num(change[key]) : null);
  return {
    priceUsd: num(coinIsBase ? attributes.base_token_price_usd : attributes.quote_token_price_usd),
    quoteUsd: num(coinIsBase ? attributes.quote_token_price_usd : attributes.base_token_price_usd),
    reserveUsd: num(attributes.reserve_in_usd),
    fdvUsd: coinIsBase ? num(attributes.fdv_usd) : null,
    change: { m5: pct("m5"), h1: pct("h1"), h6: pct("h6"), h24: pct("h24") },
    volumeUsd24h: num(volume.h24),
    txns24h: Object.keys(h24).length ? { buys: count(h24.buys), sells: count(h24.sells), buyers: count(h24.buyers), sellers: count(h24.sellers) } : null,
  };
}

/** GeckoTerminal's trades as the page's rows, newest first. The side follows the coin, whichever side of the pool it is. */
export function parseTrades(json: unknown, mint: string): MarketTrade[] {
  const rows = Array.isArray(record(json).data) ? record(json).data as unknown[] : [];
  const trades: MarketTrade[] = [];
  for (const row of rows) {
    const a = record(record(row).attributes);
    const at = Date.parse(String(a.block_timestamp ?? ""));
    const tx = String(a.tx_hash ?? ""), wallet = String(a.tx_from_address ?? "");
    if (!Number.isFinite(at) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx) || !SOLANA_ADDRESS.test(wallet)) continue;
    // Receiving the coin is a buy, sending it a sell.
    const coinIn = String(a.to_token_address ?? "") === mint, coinOut = String(a.from_token_address ?? "") === mint;
    if (coinIn === coinOut) continue;
    const tokens = num(coinIn ? a.to_token_amount : a.from_token_amount), quote = num(coinIn ? a.from_token_amount : a.to_token_amount);
    if (tokens === null || quote === null || tokens <= 0) continue;
    trades.push({ at, kind: coinIn ? "buy" : "sell", wallet, tokens, quote, usd: num(a.volume_in_usd), tx });
  }
  return trades.sort((a, b) => b.at - a.at).slice(0, TRADES_SHOWN);
}

/**
 * GeckoTerminal's candles, oldest first. Its list can repeat the newest bucket (a real row and a flat copy): the first
 * row for a time wins, since it carries the bucket's open and range. Minutes without trades stay gaps.
 */
export function parseCandles(json: unknown): Candle[] {
  const list = record(record(record(json).data).attributes).ohlcv_list;
  const seen = new Set<number>(), candles: Candle[] = [];
  for (const row of Array.isArray(list) ? list : []) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.map(num);
    if (t === null || o === null || h === null || l === null || c === null || seen.has(t)) continue;
    seen.add(t);
    candles.push({ t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: v ?? 0 });
  }
  return candles.sort((a, b) => a.t - b.t);
}

/** The coin's busiest pool as GeckoTerminal lists it: used only when the curve cannot be read. */
export function parseTopPool(json: unknown): string | null {
  const pools = record(record(record(record(json).data).relationships).top_pools).data;
  const id = Array.isArray(pools) ? String(record(pools[0]).id ?? "") : "";
  const address = id.replace(/^solana_/, "");
  return SOLANA_ADDRESS.test(address) ? address : null;
}

/** A GeckoTerminal answer that was not a success: its HTTP status (null when unreachable). */
export class GeckoError extends Error {
  constructor(readonly status: number | null) { super(`GeckoTerminal ${status ?? "unreachable"}`); this.name = "GeckoError"; }
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export async function geckoGet(path: string, send: Fetch = (url, init) => globalThis.fetch(url, init)): Promise<unknown> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try { response = await send(`${GECKO_API}${path}`, { method: "GET", headers: { accept: GECKO_ACCEPT }, credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal }); }
    catch { throw new GeckoError(null); }
    if (!response.ok) throw new GeckoError(response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export const candlesPath = (pool: string, mint: string, range: ChartRange) => {
  const [timeframe, aggregate] = CANDLE_PATH[range];
  return `/networks/solana/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=300&currency=usd&token=${mint}`;
};

// Polled only while the tab is visible; a refused call keeps the last answer on screen (react-query keeps data on error).
const polled = { refetchIntervalInBackground: false, retry: 1, retryDelay: 5_000 } as const;

export const geckoPoolQuery = (pool: string | null, mint: string) => ({
  queryKey: ["gecko-pool", pool, mint] as const,
  queryFn: async () => parsePool(await geckoGet(`/networks/solana/pools/${pool}`), mint),
  enabled: !!pool, staleTime: 20_000, refetchInterval: 30_000, ...polled,
});
export const geckoTradesQuery = (pool: string | null, mint: string) => ({
  queryKey: ["gecko-trades", pool, mint] as const,
  queryFn: async () => parseTrades(await geckoGet(`/networks/solana/pools/${pool}/trades`), mint),
  enabled: !!pool, staleTime: 20_000, refetchInterval: 30_000, ...polled,
});
export const geckoCandlesQuery = (pool: string | null, mint: string, range: ChartRange) => ({
  queryKey: ["gecko-candles", pool, mint, range] as const,
  queryFn: async () => parseCandles(await geckoGet(candlesPath(pool!, mint, range))),
  enabled: !!pool, staleTime: 40_000, refetchInterval: 60_000, ...polled,
});
/** Only when the server could not give the pool (the curve unreadable). */
export const geckoPoolLookupQuery = (mint: string, enabled: boolean) => ({
  queryKey: ["gecko-pool-lookup", mint] as const,
  queryFn: async () => parseTopPool(await geckoGet(`/networks/solana/tokens/${mint}`)),
  enabled, staleTime: 10 * 60_000, retry: 1,
});
