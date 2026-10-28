// Devnet page data: the chain API reads (lib/chain/client.ts) turned into the shapes the pages render
// (lib/chain/adapt.ts), with the loader rules of refs/chain/m3-contract.md §3.3, §3.8 and §7.1.
//
// Owner: app:pages. Rules:
//   - SSR loaders call only cheap GET reads (never fresh=1, /wallets/:address or the status routes), and never
//     throw on a slow or failing chain API: they answer fallback data marked `fallback: true`, and the page
//     refetches in the browser right after hydration (chainInitial) instead of blocking the page;
//   - browser polls ask GET /rev first (hooks.ts revPoll in devnet) every API_LIMITS.revPollMs while the page is
//     visible (react-query pauses intervals in hidden tabs), and every pendingPollMs for at most pendingPollMaxMs
//     while the viewer's own transaction or unlock is pending (boost);
//   - nothing here touches a wallet or signs anything.

import { useQuery } from "@tanstack/react-query";
import { notFound, redirect } from "@tanstack/react-router";
import { API_LIMITS, type ApiCoinDetail, type ApiConfig, type ApiWallet } from "@mintdex/chain-sdk/api";

import { MODE_COPY } from "../mintdex/copy";
import { IS_SIM } from "../mintdex/mode";
import { pageHead } from "../mintdex/seo";
import type { BidRow, CoinDetail, CoinSummary, HomeData, LevelsData, MarketData, TradeRow } from "../mintdex/types";
import {
  chartRows,
  isMintParam,
  toBid,
  toCoinDetail,
  toCoinSummary,
  toHome,
  toLevels,
  toMarket,
  toTrades,
  usdPerLamport,
} from "./adapt";
import * as client from "./client";
import { resolveCoinSlug, type CoinSlugMatch } from "./coin-slug";

const SSR = typeof window === "undefined";

/** Loader data the chain API could not provide in time: the page renders it and refetches in the browser. */
export type Fallback = { fallback?: boolean };

/** A loader read that never throws: on failure it answers `fallback()` (marked), so SSR is never blocked. */
async function loaderRead<T extends object>(read: () => Promise<T>, fallback: () => T): Promise<T & Fallback> {
  try {
    return await read();
  } catch {
    return { ...fallback(), fallback: true };
  }
}

/**
 * Extra useQuery options for loader data: fallback data counts as stale from the start, so the browser refetches
 * it as soon as the page mounts. Sim data never carries `fallback`, so sim pages get no extra option.
 */
export function chainInitial(initial: unknown): { initialDataUpdatedAt?: number } {
  if (IS_SIM || !initial || typeof initial !== "object") return {};
  // A list loader cannot carry the mark: an empty list, or a full first page (SSR reads one page), is read again
  // right away in the browser.
  const stale = Array.isArray(initial) ? initial.length === 0 || initial.length >= 100 : !!(initial as Fallback).fallback;
  return stale ? { initialDataUpdatedAt: 0 } : {};
}

/**
 * The devnet page poll interval (m3-contract §3.8: GET /rev every 20 s while visible). Call sites write
 * `IS_SIM ? simMs : CHAIN_POLL_MS` (and `IS_SIM ? null : chainInitial(x)`) rather than calling into this module,
 * so a test-mode build never loads it.
 */
export const CHAIN_POLL_MS: number = API_LIMITS.revPollMs;

// ---------------------------------------------------------------- pending boosts (the viewer's own tx or unlock)

const boosts = new Map<string, number>();
const freshKeys = new Set<string>();

/**
 * The viewer just changed `key` (a mint, or "wallet:{address}"): poll it every pendingPollMs for up to
 * pendingPollMaxMs, and make the next read of a coin ask the Worker to re-read the chain first (fresh=1).
 */
export function boost(key: string): void {
  boosts.set(key, Date.now() + API_LIMITS.pendingPollMaxMs);
  freshKeys.add(key);
}

export function isBoosted(key: string): boolean {
  const until = boosts.get(key);
  if (!until) return false;
  if (until > Date.now()) return true;
  boosts.delete(key);
  return false;
}

/** True once after boost(key): the next coin read uses fresh=1 (known mints only, coalesced by the Worker). */
export function takeFresh(key: string): boolean {
  return freshKeys.delete(key);
}

/** The poll interval for something the viewer may be waiting on. */
export function boostedPollMs(key: string, pending = false): number {
  return pending || isBoosted(key) ? API_LIMITS.pendingPollMs : API_LIMITS.revPollMs;
}

// ---------------------------------------------------------------- lists

const EMPTY_HOME: HomeData & { rev: string } = {
  featured: [],
  trending: [],
  activity: [],
  stats: { coins: 0, deedSales: 0, volume: 0, players: 0 },
  rev: "",
};

/** Home: featured, trending, activity (chain events only) and stats from GET /home. */
export async function chainHome(): Promise<HomeData & { rev: string } & Fallback> {
  return toHome(await client.getHome());
}

export function chainHomeLoader() {
  return loaderRead(chainHome, () => EMPTY_HOME);
}

/** How many coins the list pages read at most (100 per page, cursor paging). */
const LIST_MAX = 500;

/**
 * Every coin (up to LIST_MAX), as Discover and Levels sort and filter them on the client (the sim's behavior:
 * a sort or design change is instant). `q` searches name and ticker on the Worker.
 */
export async function chainCoinList(q?: string): Promise<CoinSummary[]> {
  const out: CoinSummary[] = [];
  let cursor: string | undefined;
  // SSR reads one page at most (each read has a 1.5 s budget); the browser reads the rest after hydration.
  const pages = SSR ? 1 : LIST_MAX / 100;
  for (let page = 0; page < pages; page++) {
    const r = await client.listCoins({ sort: "trending", limit: 100, q: q?.trim() || undefined, cursor });
    out.push(...r.coins.map(toCoinSummary));
    if (!r.nextCursor || r.coins.length === 0) break;
    cursor = r.nextCursor;
  }
  return out;
}

/** Discover's loader: an empty list (and a refetch in the browser) when the chain API is slow. */
export async function chainCoinListLoader(q?: string): Promise<CoinSummary[]> {
  try {
    return await chainCoinList(q);
  } catch {
    return [];
  }
}

export type ChainMarketData = { market: MarketData & { rev: string }; all: CoinSummary[] } & Fallback;

/** Market: listings, top bids and recent sales from GET /market, plus every coin for All cards. */
export async function chainMarket(): Promise<ChainMarketData> {
  const [market, all] = await Promise.all([client.getMarket(), chainCoinList()]);
  const out: ChainMarketData = { market: toMarket(market), all: [...all].sort((a, b) => b.mcapUsd - a.mcapUsd) };
  // SSR read one page of coins: the browser reads them all right after hydration.
  if (SSR && all.length >= 100) out.fallback = true;
  return out;
}

export function chainMarketLoader() {
  return loaderRead(chainMarket, () => ({
    market: { listed: [], topBids: [], sales: [], rev: "" },
    all: [],
  }));
}

/** Levels: cards per design and the busiest coin, from the coin list. */
export async function chainLevels(): Promise<LevelsData & Fallback> {
  return toLevels(await chainCoinList());
}

export function chainLevelsLoader() {
  return loaderRead(chainLevels, () => ({ coin: null, counts: [] }));
}

// ---------------------------------------------------------------- the coin page

export type ChainCoinPage = {
  detail: ApiCoinDetail;
  coin: CoinDetail;
  /** Recent trades, oldest first. */
  trades: TradeRow[];
  /** Chart points as rows McapChart draws, oldest first. */
  chart: TradeRow[];
  bids: BidRow[];
  perLamport: number;
  rev: string;
};

/** Coin detail (with card state, top bids, last sales), its last 50 trades and its full chart. null on 404. */
export async function chainCoinPage(mint: string, opts: { fresh?: boolean } = {}): Promise<ChainCoinPage | null> {
  const [res, trades, chart] = await Promise.all([
    client.getCoin(mint, { fresh: !SSR && !!opts.fresh }),
    client.getCoinTrades(mint, { limit: 50 }).catch(() => null),
    client.getCoinChart(mint, "all").catch(() => null),
  ]);
  if (!res) return null;
  const detail = res.coin;
  const perLamport = usdPerLamport(detail);
  return {
    detail,
    coin: toCoinDetail(detail),
    trades: toTrades(trades?.trades ?? [], perLamport),
    chart: chartRows(chart?.points ?? [], perLamport),
    bids: [...detail.bids].sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount))).map(toBid),
    perLamport,
    rev: res.rev,
  };
}

export type ChainCoinRoute =
  | { status: "ok"; page: ChainCoinPage }
  | { status: "missing" }
  | { status: "unavailable"; mint: string };

/**
 * The coin route's loader in devnet: `$id` must be a mint address (tickers and old slugs are 404s, m3-contract
 * §2.2). A slow or failing chain API answers "unavailable" and the page reads the coin in the browser.
 */
export async function chainCoinRoute(id: string): Promise<ChainCoinRoute> {
  if (!isMintParam(id)) return { status: "missing" };
  try {
    const page = await chainCoinPage(id);
    return page ? { status: "ok", page } : { status: "missing" };
  } catch {
    return { status: "unavailable", mint: id };
  }
}

/**
 * Why a devnet coin URL is a 404, as notFound data (ChainCoinNotFound.tsx reads it; absent for a mint without a
 * card). "unavailable": the chain API did not answer the ticker lookup, and the page asks again from the browser.
 */
export type ChainCoinNotFound =
  { kind: "none" } | { kind: "several"; matches: CoinSlugMatch[] } | { kind: "unavailable" };

/** A ticker or name slug: the one visible coin it names (the 301 target), or why it is a 404. Never throws. */
export async function findCoinSlug(
  id: string,
): Promise<{ kind: "one"; mint: string } | ChainCoinNotFound> {
  try {
    const r = await resolveCoinSlug(id);
    if (r.status === "one") return { kind: "one", mint: r.match.mint };
    return r.status === "several" ? { kind: "several", matches: r.matches } : { kind: "none" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * The coin route's loader on devnet (routes/coin/$id.tsx): `$id` is a mint with a MintDex card (unknown mints are
 * real 404s). Old links (a ticker or name slug, any casing, with or without $: /coin/honk, /coin/$HONK) answer 301
 * to /coin/{mint} when exactly one visible coin goes by it, keeping the query string; none or several is a real 404
 * that lists the several (coin-slug.ts). A slow chain API never blocks the page: it answers "unavailable" and the
 * page reads the coin in the browser. Kept here, apart from the page components, so the route module (main chunk)
 * does not pull the coin page in with it.
 */
export async function chainCoinLoader(id: string, search?: object): Promise<ChainCoinRoute> {
  if (!isMintParam(id)) {
    const found = await findCoinSlug(id);
    if (found.kind === "one") {
      throw redirect({
        to: "/coin/$id",
        params: { id: found.mint },
        search: (search ?? {}) as never,
        statusCode: 301,
      });
    }
    throw notFound({ data: found satisfies ChainCoinNotFound });
  }
  const route = await chainCoinRoute(id);
  if (route.status === "missing") throw notFound();
  return route;
}

type HeadTags = { meta: Array<Record<string, string>>; links?: Array<{ rel: string; href: string }> };

/**
 * Head tags for a devnet coin page: the test-mode head (`simHead`, which reads the devnet qualifier, the mint as the
 * canonical path and indexability from seo.ts) for a loaded coin; a plain, indexable title with the canonical mint
 * path while the chain API was too slow during SSR.
 */
export function chainCoinHead(route: ChainCoinRoute | undefined, simHead: (coin: CoinDetail) => HeadTags): HeadTags {
  if (route?.status === "ok") return simHead(route.page.coin);
  if (route?.status === "unavailable") {
    return pageHead({ path: `/coin/${route.mint}`, title: "A one-of-one card on MintDex", description: MODE_COPY.coinQualifier });
  }
  return { meta: [{ title: "Card not found | MintDex" }, { name: "robots", content: "noindex" }] };
}

// ---------------------------------------------------------------- browser-only reads

/** ApiConfig (display values: fees, min bid, thresholds). Browser only; null until loaded or when it fails. */
export function useChainConfig(): ApiConfig | null {
  const { data } = useQuery({
    queryKey: ["chain-config"],
    queryFn: () => client.getConfig(),
    enabled: !IS_SIM && !SSR,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
  return data ?? null;
}

/**
 * The viewer's wallet from GET /wallets/:address (coins, cards, bids, offers, listings, totals). Browser only
 * (SSR never calls it: walletIp is 30 a minute per IP), every 20 s while visible, every 5 s after the viewer's
 * own transaction for up to 2 minutes.
 */
export function useChainWallet(address: string | null | undefined): {
  wallet: ApiWallet | null;
  loading: boolean;
  error: boolean;
} {
  const key = address ? `wallet:${address}` : "wallet:";
  const { data, isPending, isError } = useQuery({
    queryKey: ["chain-wallet", address ?? ""],
    queryFn: async () => (await client.getWallet(address!)).wallet,
    enabled: !IS_SIM && !SSR && !!address,
    staleTime: 5_000,
    refetchInterval: () => boostedPollMs(key),
    retry: 1,
  });
  return { wallet: data ?? null, loading: !!address && isPending, error: isError };
}

// ---------------------------------------------------------------- sitemap

/** Coin pages for the sitemap in devnet (newest first, at most 1,000), never throwing. */
export async function chainSitemapCoins(): Promise<Array<{ mint: string; lastTradeAt: number }>> {
  const out: Array<{ mint: string; lastTradeAt: number }> = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 10; page++) {
      const r = await client.listCoins({ sort: "new", limit: 100, cursor });
      for (const c of r.coins) out.push({ mint: c.mint, lastTradeAt: (c.lastTradeAt || c.createdAt) * 1000 });
      if (!r.nextCursor || r.coins.length === 0) break;
      cursor = r.nextCursor;
    }
  } catch {
    // Whatever was read so far.
  }
  return out;
}
