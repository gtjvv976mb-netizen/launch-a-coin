/**
 * Coin list order and the design filter, shared by the server (listCoins) and Discover, which sorts and
 * filters the list it already has on the client so a sort or design change is instant (backlog P0-2, step 4).
 * Move sorting back to the server only if the dex grows past a few hundred coins.
 */
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
 * A sorted copy: market cap, newest, nearest to the next design, or trending (24h volume, then the latest
 * trade). Never mutates the input.
 */
export function sortCoins<T extends CoinSummary>(coins: T[], sort: CoinSort = "trending") {
  return [...coins].sort((a, b) => {
    if (sort === "mcap") return (b.mcapUsd ?? -1) - (a.mcapUsd ?? -1) || b.lastTradeAt - a.lastTradeAt;
    if (sort === "new") return b.createdAt - a.createdAt;
    if (sort === "next") return nextDesignProgress(b) - nextDesignProgress(a);
    return (b.volume24h ?? -1) - (a.volume24h ?? -1) || b.lastTradeAt - a.lastTradeAt;
  });
}
