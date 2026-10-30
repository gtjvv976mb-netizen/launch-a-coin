/**
 * Coin list order and the design filter, shared by the server (listCoins) and Discover, which sorts and
 * filters the list it already has on the client so a sort or design change is instant (backlog P0-2, step 4).
 * Move sorting back to the server only if the dex grows past a few hundred coins.
 */
import { getPairAsset } from "../carddex/pairs";
import { MAX_LEVEL, TIERS } from "./tiers";
import type { CoinSummary } from "./types";

export type CoinSort = "trending" | "mcap" | "new" | "next";

/** How close the market cap is to unlocking the card's next design (the top design sorts last). */
export function nextDesignProgress(c: Pick<CoinSummary, "level" | "mcapUsd">) {
  if (c.level >= MAX_LEVEL) return -1;
  return c.mcapUsd === null ? -1 : c.mcapUsd / TIERS[c.level].minUsd;
}

/** The coins with one design (0 or a level outside 1..MAX_LEVEL keeps every coin). Never mutates the input. */
export function filterByDesign<T extends Pick<CoinSummary, "level">>(coins: T[], tier?: number) {
  return tier && tier >= 1 && tier <= MAX_LEVEL ? coins.filter((c) => c.level === tier) : coins;
}

/**
 * A coin's 24h volume as a share of its pair's starting curve reserve: unit-free, so a TOAD coin and a SOL coin
 * compare fairly (most demo pairs have no USD reference, and nothing is converted between quotes).
 */
export function trendingScore(c: Pick<CoinSummary, "volume24hQuote" | "quoteAssetKey">): number {
  const reserve = Number(getPairAsset(c.quoteAssetKey).initialVirtualQuoteReserves);
  const volume = Number(c.volume24hQuote ?? 0);
  return reserve > 0 && Number.isFinite(volume) ? volume / reserve : 0;
}

/**
 * A sorted copy: market cap, newest, nearest to the next design, or trending, then the latest trade. Market cap ranks
 * by bonding-curve progress, which rises with market cap on every pair's curve and needs no USD price; trending ranks
 * by 24h volume against the pair's own curve (trendingScore). One fair order across pairs. Never mutates the input.
 */
export function sortCoins<T extends CoinSummary>(coins: T[], sort: CoinSort = "trending") {
  return [...coins].sort((a, b) => {
    if (sort === "mcap") return b.curveProgress - a.curveProgress || b.lastTradeAt - a.lastTradeAt;
    if (sort === "new") return b.createdAt - a.createdAt;
    if (sort === "next") return nextDesignProgress(b) - nextDesignProgress(a);
    return trendingScore(b) - trendingScore(a) || b.lastTradeAt - a.lastTradeAt;
  });
}
