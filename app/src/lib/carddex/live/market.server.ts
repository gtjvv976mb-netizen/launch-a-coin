/**
 * A launched coin's market data (GET /api/live/market/<mint> and /candles/<range>; the shapes are in market.ts).
 *
 * Sources: the curve (price, market cap, progress, reserves) and the holders are read from Solana through the server's
 * mainnet RPC (CARDDEX_MAINNET_RPC_URL, never sent to the browser); 24-hour stats, trades and candles come from
 * GeckoTerminal's free public API (api.geckoterminal.com), whose pool for a coin on its curve is the curve account.
 *
 * Every part is kept in D1 (live_market_cache, one row per coin and kind) and refreshed at most once per its window
 * site-wide, within two site budgets (LIMITS.marketGeckoSite, LIMITS.marketRpcSite). When a refresh fails or a budget
 * is spent, the last answer is served with `stale: true`; with no answer at all the figure is null. Nothing is
 * invented, and no upstream error, URL or key leaves this file.
 */
import { bindings } from "../../bindings.server";
import { one, stmt, UserError } from "../../mintdex/server/db.server";
import { edgeCached } from "../../edge-cache";
import { createMainnetConnection } from "../../../../../integrations/pumpfun/src/live";
import { readCurveMarket, readTopHolders, type CurveMarket, type MarketConnection, type TopHolder } from "../../../../../integrations/pumpfun/src/market";
import { getPairAsset } from "../pairs";
import { liveReadiness } from "./config.server";
import { enforceLimit, LIMITS, SITE, type LimitRule } from "./limits.server";
import { SOLANA_ADDRESS } from "./launches";
import { CHART_RANGES, isChartRange, type Candle, type CandleAnswer, type ChartRange, type CoinMarket, type MarketHolder, type MarketTrade } from "./market";

export const GECKO_API = "https://api.geckoterminal.com/api/v2";
const GECKO_ACCEPT = "application/json;version=20230302";
const TIMEOUT_MS = 6_000, MAX_BYTES = 768 * 1024;
const SECOND = 1_000, MINUTE = 60 * SECOND;
/** How long each part is reused before it is read again. */
export const TTL = { curve: 10 * SECOND, pool: 30 * SECOND, trades: 30 * SECOND, holders: MINUTE, holderCount: 10 * MINUTE, poolLookup: 10 * MINUTE } as const;
export const CANDLE_TTL: Record<ChartRange, number> = { "1m": 45 * SECOND, "5m": 45 * SECOND, "15m": 2 * MINUTE, "1h": 2 * MINUTE, "4h": 5 * MINUTE, "1d": 5 * MINUTE };
const CANDLE_PATH: Record<ChartRange, [timeframe: "minute" | "hour" | "day", aggregate: number]> = {
  "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1],
};
/** Trades shown, newest first. */
export const TRADES_SHOWN = 40;
/** Holders shown (the RPC returns the 20 largest accounts). */
export const HOLDERS_SHOWN = 10;
/** Holder count: at most this many pages of 1,000 accounts are read; past it the count is shown as "N+". */
export const HOLDER_PAGES = 10;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type MarketDeps = {
  fetch?: Fetch;
  now?: () => number;
  /** The mainnet connection, or null when this deployment has no RPC ready (local, paused). */
  connection?: () => MarketConnection | null;
  rpcUrl?: () => string | null;
};

// ---------------------------------------------------------------- the cache

type Part<T> = { value: T | null; at: number | null; stale: boolean };

async function readRow<T>(mint: string, kind: string): Promise<{ at: number; value: T } | null> {
  try {
    const row = await one<{ fetched_at: number; json: string }>("SELECT fetched_at, json FROM live_market_cache WHERE mint = ? AND kind = ?", mint, kind);
    return row ? { at: row.fetched_at, value: JSON.parse(row.json) as T } : null;
  } catch { return null; }
}
async function writeRow(mint: string, kind: string, at: number, value: unknown) {
  try { await stmt("INSERT OR REPLACE INTO live_market_cache (mint, kind, fetched_at, json) VALUES (?, ?, ?, ?)", mint, kind, at, JSON.stringify(value)).run(); }
  catch (error) { console.error("market_cache_write_failed", JSON.stringify({ kind: kind.split(":")[0] }), error instanceof Error ? error.name : "error"); }
}
/**
 * The cached part when fresh; else one refresh within `rule`; else the last answer marked stale, or null. A refresh
 * that finds nothing or fails is remembered (a `<kind>~miss` row) and not tried again within the part's window, so a
 * coin GeckoTerminal has not indexed yet, or an RPC without DAS, never spends the site budget on every request. With
 * `load` null (no upstream to ask, such as no RPC here), only the cache is read and nothing is counted.
 */
async function part<T>(mint: string, kind: string, ttl: number, rule: LimitRule, now: number, load: (() => Promise<T | null>) | null): Promise<Part<T>> {
  const cached = await readRow<T>(mint, kind);
  if (cached && now - cached.at < ttl) return { value: cached.value, at: cached.at, stale: false };
  const missed = load ? await readRow<true>(mint, `${kind}~miss`) : null;
  if (load && !(missed && now - missed.at < ttl)) {
    try {
      await enforceLimit(rule, SITE, "Market budget used", now);
      const value = await load();
      if (value !== null) { await writeRow(mint, kind, now, value); return { value, at: now, stale: false }; }
      await writeRow(mint, `${kind}~miss`, now, true);
    } catch (error) {
      // A spent budget is not a miss: the next request may refresh. An upstream failure waits out the window.
      if (!(error instanceof UserError)) await writeRow(mint, `${kind}~miss`, now, true);
      console.log(JSON.stringify({ event: "market_refresh_failed", kind: kind.split(":")[0], reason: error instanceof Error ? error.name : "error" }));
    }
  }
  // Stale means an older answer is shown; a part never read shows as missing (a dash), not as stale.
  return cached ? { value: cached.value, at: cached.at, stale: true } : { value: null, at: null, stale: false };
}

// ---------------------------------------------------------------- GeckoTerminal (read only)

async function readCapped(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) throw new Error("Upstream answer too large");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("Upstream answer too large");
  return text;
}
async function gecko(send: Fetch, path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await send(`${GECKO_API}${path}`, { method: "GET", headers: { accept: GECKO_ACCEPT }, redirect: "manual", signal: controller.signal });
    if (!response.ok) throw new Error(`GeckoTerminal ${response.status}`);
    return JSON.parse(await readCapped(response)) as Record<string, unknown>;
  } finally { clearTimeout(timer); }
}
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const count = (value: unknown) => { const n = num(value); return n !== null && n >= 0 ? Math.floor(n) : 0; };
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

export type PoolStats = {
  priceUsd: number | null; quoteUsd: number | null; reserveUsd: number | null; fdvUsd: number | null;
  change: CoinMarket["change"]; volumeUsd24h: number | null; txns24h: CoinMarket["txns24h"];
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

/** GeckoTerminal's trades as the page's rows, newest first. */
export function parseTrades(json: unknown, mint: string): MarketTrade[] {
  const rows = Array.isArray(record(json).data) ? record(json).data as unknown[] : [];
  const trades: MarketTrade[] = [];
  for (const row of rows) {
    const a = record(record(row).attributes);
    const at = Date.parse(String(a.block_timestamp ?? ""));
    const tx = String(a.tx_hash ?? ""), wallet = String(a.tx_from_address ?? "");
    if (!Number.isFinite(at) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx) || !SOLANA_ADDRESS.test(wallet)) continue;
    // The side follows the coin, whichever side of the pool it is: receiving it is a buy, sending it a sell.
    const coinIn = String(a.to_token_address ?? "") === mint, coinOut = String(a.from_token_address ?? "") === mint;
    if (coinIn === coinOut) continue;
    const kind = coinIn ? "buy" as const : "sell" as const;
    const tokens = num(coinIn ? a.to_token_amount : a.from_token_amount), quote = num(coinIn ? a.from_token_amount : a.to_token_amount);
    if (tokens === null || quote === null || tokens <= 0) continue;
    trades.push({ at, kind, wallet, tokens, quote, usd: num(a.volume_in_usd), tx });
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

// ---------------------------------------------------------------- holders (RPC)

/**
 * Every wallet holding the coin, counted through the RPC's DAS getTokenAccounts (Helius and others), the market's own
 * accounts left out. Null when the RPC does not offer it.
 */
export async function countHolders(send: Fetch, rpcUrl: string, mint: string, marketOwners: readonly string[]): Promise<{ count: number; capped: boolean } | null> {
  const owners = new Set<string>();
  for (let page = 1; page <= HOLDER_PAGES; page++) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body: Record<string, unknown>;
    try {
      const response = await send(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, redirect: "manual", signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: "holders", method: "getTokenAccounts", params: { mint, limit: 1000, page, options: { showZeroBalance: false } } }) });
      if (!response.ok) return null;
      body = JSON.parse(await readCapped(response)) as Record<string, unknown>;
    } finally { clearTimeout(timer); }
    if (body.error || !body.result) return null;
    const accounts = record(body.result).token_accounts;
    if (!Array.isArray(accounts)) return null;
    for (const entry of accounts) {
      const owner = String(record(entry).owner ?? ""), amount = num(record(entry).amount) ?? 0;
      if (amount > 0 && SOLANA_ADDRESS.test(owner) && !marketOwners.includes(owner)) owners.add(owner);
    }
    if (accounts.length < 1000) return { count: owners.size, capped: false };
  }
  return { count: owners.size, capped: true };
}

// ---------------------------------------------------------------- the coin

type Coin = { creator: string; quoteKey: string; quoteMint: string };
async function launchedCoin(mint: string): Promise<Coin | null> {
  if (!SOLANA_ADDRESS.test(mint)) return null;
  const row = await one<{ creator_wallet: string; quote_key: string; quote_mint: string }>(
    "SELECT creator_wallet, quote_key, quote_mint FROM live_launch_intents WHERE status = 'complete' AND token_mint = ? LIMIT 1", mint);
  return row ? { creator: row.creator_wallet, quoteKey: row.quote_key, quoteMint: row.quote_mint } : null;
}

function defaults(deps: MarketDeps) {
  const rpcUrl = deps.rpcUrl ?? (() => (liveReadiness().recoveryReady ? bindings().CARDDEX_MAINNET_RPC_URL ?? null : null));
  return {
    send: deps.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init)),
    now: deps.now ?? Date.now,
    rpcUrl,
    connection: deps.connection ?? (() => { const url = rpcUrl(); return url ? createMainnetConnection(url) as unknown as MarketConnection : null; }),
  };
}

async function curvePart(mint: string, coin: Coin, d: ReturnType<typeof defaults>, now: number) {
  const connection = d.connection();
  return part<CurveMarket>(mint, "curve", TTL.curve, LIMITS.marketRpcSite, now, connection
    ? () => readCurveMarket(connection, { mint, quoteMint: coin.quoteMint, quoteDecimals: getPairAsset(coin.quoteKey).decimals, nowSec: Math.floor(now / 1000) })
    : null);
}

/** Everything the coin page shows besides the chart. */
export async function readCoinMarket(mint: string, deps: MarketDeps = {}): Promise<CoinMarket | null> {
  const coin = await launchedCoin(mint);
  if (!coin) return null;
  const d = defaults(deps), now = d.now();
  const curve = await curvePart(mint, coin, d, now);
  const c = curve.value, connection = d.connection(), rpcUrl = d.rpcUrl();
  const pool = c?.pool ?? (await poolLookup(mint, d, now));
  const [stats, trades, top, holderCount] = await Promise.all([
    pool ? part<PoolStats>(mint, "pool", TTL.pool, LIMITS.marketGeckoSite, now, async () => parsePool(await gecko(d.send, `/networks/solana/pools/${pool}`), mint)) : null,
    pool ? part<MarketTrade[]>(mint, "trades", TTL.trades, LIMITS.marketGeckoSite, now, async () => parseTrades(await gecko(d.send, `/networks/solana/pools/${pool}/trades`), mint)) : null,
    c && connection ? part<TopHolder[]>(mint, "holders", TTL.holders, LIMITS.marketRpcSite, now, () => readTopHolders(connection, { mint, supply: c.supply, marketOwners: c.marketOwners })) : null,
    c && rpcUrl ? part<{ count: number; capped: boolean }>(mint, "holder-count", TTL.holderCount, LIMITS.marketRpcSite, now, () => countHolders(d.send, rpcUrl, mint, c.marketOwners)) : null,
  ]);
  const s = stats?.value ?? null;
  // The quote's dollar price comes from GeckoTerminal; the coin's own price from the curve, so it is current.
  const quoteUsd = s?.quoteUsd ?? null;
  const priceQuote = c?.priceQuote ?? null;
  const chainPrice = priceQuote !== null && quoteUsd !== null;
  const priceUsd = chainPrice ? priceQuote * quoteUsd : s?.priceUsd ?? null;
  const supply = c?.supply ?? null;
  const holders: MarketHolder[] | null = top?.value
    ? top.value.filter(h => !h.market).slice(0, HOLDERS_SHOWN).map(h => ({ owner: h.owner, amount: h.amount, share: h.share, creator: h.owner === coin.creator }))
    : null;
  const curveShare = top?.value ? top.value.filter(h => h.market).reduce((sum, h) => sum + h.share, 0) : null;
  const parts: { at: number | null; stale: boolean }[] = [curve, stats, trades, top, holderCount].filter(p => p !== null);
  const reservesUsd = c?.status === "migrated" ? s?.reserveUsd ?? null : c?.reservesQuote != null && quoteUsd !== null ? c.reservesQuote * quoteUsd : null;
  return {
    mint,
    asOf: parts.some(p => p.at !== null) ? Math.max(...parts.map(p => p.at ?? 0)) : null,
    priceSource: priceUsd === null ? null : chainPrice ? "chain" : "geckoterminal",
    status: c?.status ?? null,
    priceQuote,
    priceUsd,
    marketCapQuote: c?.marketCapQuote ?? null,
    marketCapUsd: priceUsd !== null && supply !== null ? priceUsd * supply : s?.fdvUsd ?? null,
    progress: c?.progress ?? null,
    reservesQuote: c?.status === "migrated" ? null : c?.reservesQuote ?? null,
    reservesUsd,
    quoteUsd,
    change: s?.change ?? { m5: null, h1: null, h6: null, h24: null },
    volumeUsd24h: s?.volumeUsd24h ?? null,
    txns24h: s?.txns24h ?? null,
    trades: trades?.value ?? null,
    holders,
    holderCount: holderCount?.value?.count ?? null,
    holderCountCapped: holderCount?.value?.capped ?? false,
    curveShare,
    stale: parts.some(p => p.stale),
  };
}

/** Without the curve (no RPC, or it failed): GeckoTerminal's own record of the coin's pool. */
async function poolLookup(mint: string, d: ReturnType<typeof defaults>, now: number): Promise<string | null> {
  return (await part<string>(mint, "pool-lookup", TTL.poolLookup, LIMITS.marketGeckoSite, now, async () => parseTopPool(await gecko(d.send, `/networks/solana/tokens/${mint}`)))).value;
}

/** One range's candles for the coin's pool, in US dollars. */
export async function readCoinCandles(mint: string, range: ChartRange, deps: MarketDeps = {}): Promise<CandleAnswer | null> {
  const coin = await launchedCoin(mint);
  if (!coin) return null;
  const d = defaults(deps), now = d.now();
  const pool = (await curvePart(mint, coin, d, now)).value?.pool ?? (await poolLookup(mint, d, now));
  if (!pool) return { range, candles: [], asOf: now, stale: true };
  const [timeframe, aggregate] = CANDLE_PATH[range];
  const candles = await part<Candle[]>(mint, `ohlcv:${range}`, CANDLE_TTL[range], LIMITS.marketGeckoSite, now, async () =>
    parseCandles(await gecko(d.send, `/networks/solana/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=300&currency=usd&token=${mint}`)));
  return { range, candles: candles.value ?? [], asOf: candles.at ?? now, stale: candles.stale };
}

// ---------------------------------------------------------------- the routes

const json = (body: unknown, status: number, cache: string) => Response.json(body, { status, headers: { "cache-control": cache } });

/** GET /api/live/market/<mint>: public and read only; each colo reuses an answer for a few seconds. */
export function serveCoinMarket(request: Request, mint: string, deps: MarketDeps = {}): Promise<Response> {
  if (!SOLANA_ADDRESS.test(mint)) return Promise.resolve(json({ error: "Not a coin address." }, 400, "no-store"));
  return edgeCached(request, `/api/live/market/${mint}`, 5, async () => {
    try {
      const market = await readCoinMarket(mint, deps);
      return market ? json(market, 200, "public, max-age=10") : json({ error: "Not a coin launched here." }, 404, "public, max-age=30");
    } catch (error) {
      console.error("market_read_failed", error instanceof Error ? error.name : "error");
      return json({ error: "Market data is unavailable right now." }, 503, "no-store");
    }
  });
}

/** GET /api/live/market/<mint>/candles/<range>. */
export function serveCoinCandles(request: Request, mint: string, range: string, deps: MarketDeps = {}): Promise<Response> {
  if (!SOLANA_ADDRESS.test(mint) || !isChartRange(range)) return Promise.resolve(json({ error: `Ranges: ${CHART_RANGES.join(", ")}.` }, 400, "no-store"));
  return edgeCached(request, `/api/live/market/${mint}/candles/${range}`, 15, async () => {
    try {
      const answer = await readCoinCandles(mint, range, deps);
      return answer ? json(answer, 200, "public, max-age=20") : json({ error: "Not a coin launched here." }, 404, "public, max-age=30");
    } catch (error) {
      console.error("market_candles_failed", error instanceof Error ? error.name : "error");
      return json({ error: "The chart is unavailable right now." }, 503, "no-store");
    }
  });
}
