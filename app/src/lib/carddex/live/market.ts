/**
 * A launched coin's market data, in two halves the coin page combines (combineMarket):
 * - from Solana, through the site's server (GET /api/live/market/<mint>, market.server.ts): the curve (price in the
 *   quote asset, market cap, progress, reserves), the pool to follow, and the holders;
 * - from GeckoTerminal, read in the visitor's browser (gecko.ts): the quote's dollar price, 24-hour change, volume and
 *   trade counts, the recent trades and the candles, about a minute behind the chain.
 * Anything a source did not give is null and shows as a dash: no figure is ever made up.
 */
import type { PoolStats } from "./gecko";

export type MarketStatus = "curve" | "complete" | "migrated";

export type MarketTrade = {
  at: number;
  kind: "buy" | "sell";
  /** The trader's wallet. */
  wallet: string;
  /** Coin tokens bought or sold (UI units). */
  tokens: number;
  /** Quote tokens paid or received (UI units). */
  quote: number;
  usd: number | null;
  tx: string;
};

export type MarketHolder = { owner: string; amount: number; share: number; creator: boolean };

/** What the server reads from Solana. */
export type ChainMarket = {
  mint: string;
  /** When the freshest part was read (ms); null when nothing could be read yet. */
  asOf: number | null;
  status: MarketStatus | null;
  /** One token in the quote asset (UI units); null once migrated (the curve no longer prices it). */
  priceQuote: number | null;
  marketCapQuote: number | null;
  /** 0..1 to graduation (1 once graduated). */
  progress: number | null;
  /** Quote tokens buyers have put into the curve (what sellers can be paid from). */
  reservesQuote: number | null;
  supply: number | null;
  /** The pool GeckoTerminal follows: the curve account, or the PumpSwap pool after migration. */
  pool: string | null;
  /** The largest holders, the curve's own account left out. */
  holders: MarketHolder[] | null;
  /** Wallets holding any of the coin (the curve left out); null when the RPC cannot count them. */
  holderCount: number | null;
  /** The count stopped at its cap: the true number is higher. */
  holderCountCapped: boolean;
  /** Share of supply still in the curve. */
  curveShare: number | null;
  /** Some part could not be refreshed and is older than usual. */
  stale: boolean;
};

/** The page's view: both halves together. */
export type CoinMarket = Omit<ChainMarket, "pool" | "supply"> & {
  /** Where the dollar price came from: the curve on Solana (times GeckoTerminal's quote price), or GeckoTerminal alone. */
  priceSource: "chain" | "geckoterminal" | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  reservesUsd: number | null;
  quoteUsd: number | null;
  change: PoolStats["change"];
  volumeUsd24h: number | null;
  txns24h: PoolStats["txns24h"];
  trades: MarketTrade[] | null;
};

const NO_CHANGE: PoolStats["change"] = { m5: null, h1: null, h6: null, h24: null };

/**
 * The two halves as one view. The dollar price is the curve's price times the quote's dollar price when both are known
 * (current to the chain); otherwise GeckoTerminal's own price; otherwise nothing.
 */
export function combineMarket(mint: string, chain: ChainMarket | null | undefined, stats: PoolStats | null | undefined, trades: MarketTrade[] | null | undefined, geckoStale = false): CoinMarket {
  const quoteUsd = stats?.quoteUsd ?? null;
  const priceQuote = chain?.priceQuote ?? null;
  const chainPrice = priceQuote !== null && quoteUsd !== null;
  const priceUsd = chainPrice ? priceQuote * quoteUsd : stats?.priceUsd ?? null;
  const supply = chain?.supply ?? null;
  const migrated = chain?.status === "migrated";
  return {
    mint,
    asOf: chain?.asOf ?? null,
    status: chain?.status ?? null,
    priceQuote,
    marketCapQuote: chain?.marketCapQuote ?? null,
    progress: chain?.progress ?? null,
    reservesQuote: migrated ? null : chain?.reservesQuote ?? null,
    holders: chain?.holders ?? null,
    holderCount: chain?.holderCount ?? null,
    holderCountCapped: chain?.holderCountCapped ?? false,
    curveShare: chain?.curveShare ?? null,
    stale: (chain?.stale ?? false) || geckoStale,
    priceSource: priceUsd === null ? null : chainPrice ? "chain" : "geckoterminal",
    priceUsd,
    marketCapUsd: priceUsd !== null && supply !== null ? priceUsd * supply : stats?.fdvUsd ?? null,
    reservesUsd: migrated ? stats?.reserveUsd ?? null : chain?.reservesQuote != null && quoteUsd !== null ? chain.reservesQuote * quoteUsd : null,
    quoteUsd,
    change: stats?.change ?? NO_CHANGE,
    volumeUsd24h: stats?.volumeUsd24h ?? null,
    txns24h: stats?.txns24h ?? null,
    trades: trades ?? null,
  };
}

export const CHART_RANGES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const isChartRange = (value: string): value is ChartRange => (CHART_RANGES as readonly string[]).includes(value);
/** Each range as an adjective ("5-minute candles"). */
export const CHART_RANGE_LABEL: Record<ChartRange, string> = { "1m": "1-minute", "5m": "5-minute", "15m": "15-minute", "1h": "1-hour", "4h": "4-hour", "1d": "1-day" };

/** One candle: time in seconds (the chart's unit), prices and volume in US dollars. */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** The Solana half, from the site's server: polled every 15 seconds while the tab is visible. */
export const coinMarketQuery = (mint: string) => ({
  queryKey: ["coin-market", mint] as const,
  queryFn: async () => {
    const response = await fetch(`/api/live/market/${mint}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Market ${response.status}`);
    return (await response.json()) as ChainMarket;
  },
  staleTime: 10_000,
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  retry: 1,
});
