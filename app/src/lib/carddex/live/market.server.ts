/**
 * The Solana half of a launched coin's market (GET /api/live/market/<mint>; shapes in market.ts): the curve (price in
 * the quote asset, market cap, progress, reserves), the pool to follow, and the holders, read through the server's
 * mainnet RPC (CARDDEX_MAINNET_RPC_URL, never sent to the browser). The GeckoTerminal half (dollar prices, 24-hour
 * stats, trades, candles) is read in the visitor's browser (gecko.ts): GeckoTerminal refuses the Worker's shared
 * addresses.
 *
 * Every part is kept in D1 (live_market_cache, one row per coin and kind) and refreshed at most once per its window
 * site-wide, within the RPC site budget (LIMITS.marketRpcSite). When a refresh fails or the budget is spent, the last
 * answer is served with `stale: true`; with no answer at all the figure is null. Nothing is invented, and no upstream
 * error, URL or key leaves this file.
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
import type { ChainMarket, MarketHolder } from "./market";

const TIMEOUT_MS = 6_000, MAX_BYTES = 768 * 1024;
const SECOND = 1_000, MINUTE = 60 * SECOND;
/** How long each part is reused before it is read again. */
export const TTL = { curve: 10 * SECOND, holders: MINUTE, holderCount: 10 * MINUTE } as const;
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
      console.log(JSON.stringify({ event: "market_refresh_failed", kind: kind.split(":")[0], reason: error instanceof Error ? error.name : "error", }));
    }
  }
  // Stale means an older answer is shown; a part never read shows as missing (a dash), not as stale.
  return cached ? { value: cached.value, at: cached.at, stale: true } : { value: null, at: null, stale: false };
}

async function readCapped(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) throw new Error("Upstream answer too large");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("Upstream answer too large");
  return text;
}
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

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

/** The Solana half of the coin page's market. */
export async function readCoinMarket(mint: string, deps: MarketDeps = {}): Promise<ChainMarket | null> {
  const coin = await launchedCoin(mint);
  if (!coin) return null;
  const d = defaults(deps), now = d.now();
  const curve = await curvePart(mint, coin, d, now);
  const c = curve.value, connection = d.connection(), rpcUrl = d.rpcUrl();
  const [top, holderCount] = await Promise.all([
    c ? part<TopHolder[]>(mint, "holders", TTL.holders, LIMITS.marketRpcSite, now, connection ? () => readTopHolders(connection, { mint, supply: c.supply, marketOwners: c.marketOwners }) : null) : null,
    c ? part<{ count: number; capped: boolean }>(mint, "holder-count", TTL.holderCount, LIMITS.marketRpcSite, now, rpcUrl ? () => countHolders(d.send, rpcUrl, mint, c.marketOwners) : null) : null,
  ]);
  const holders: MarketHolder[] | null = top?.value
    ? top.value.filter(h => !h.market).slice(0, HOLDERS_SHOWN).map(h => ({ owner: h.owner, amount: h.amount, share: h.share, creator: h.owner === coin.creator }))
    : null;
  const parts: { at: number | null; stale: boolean }[] = [curve, top, holderCount].filter(p => p !== null);
  const migrated = c?.status === "migrated";
  return {
    mint,
    asOf: parts.some(p => p.at !== null) ? Math.max(...parts.map(p => p.at ?? 0)) : null,
    status: c?.status ?? null,
    priceQuote: c?.priceQuote ?? null,
    marketCapQuote: c?.marketCapQuote ?? null,
    progress: c?.progress ?? null,
    reservesQuote: migrated ? null : c?.reservesQuote ?? null,
    supply: c?.supply ?? null,
    pool: c?.pool ?? null,
    holders,
    holderCount: holderCount?.value?.count ?? null,
    holderCountCapped: holderCount?.value?.capped ?? false,
    curveShare: top?.value ? top.value.filter(h => h.market).reduce((sum, h) => sum + h.share, 0) : null,
    stale: parts.some(p => p.stale),
  };
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
