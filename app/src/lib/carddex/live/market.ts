/**
 * A launched coin's market data, as GET /api/live/market/<mint> and /api/live/market/<mint>/candles/<range> return it
 * (market.server.ts builds both). Client-safe: the shapes, the chart ranges and the queries the coin page polls.
 *
 * Sources (shown on the page): the price, market cap, curve progress, curve reserves and holders are read from Solana
 * itself; 24-hour volume, change, trade counts, the candles and the trades list come from GeckoTerminal, about a minute
 * behind the chain. Anything a source did not give is null and shows as a dash: no figure is ever made up.
 */

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

export type CoinMarket = {
  mint: string;
  /** When the freshest part was read (ms). */
  asOf: number;
  status: MarketStatus | null;
  /** One token, in the quote asset and in US dollars. */
  priceQuote: number | null;
  priceUsd: number | null;
  /** Price times the 1B supply. */
  marketCapQuote: number | null;
  marketCapUsd: number | null;
  /** 0..1 to graduation (1 once graduated); null when the curve could not be read. */
  progress: number | null;
  /** Quote tokens buyers have put into the curve (what sellers can be paid from). */
  reservesQuote: number | null;
  reservesUsd: number | null;
  /** One quote token in US dollars (from GeckoTerminal). */
  quoteUsd: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  volumeUsd24h: number | null;
  txns24h: { buys: number; sells: number; buyers: number; sellers: number } | null;
  trades: MarketTrade[] | null;
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

export const CHART_RANGES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const isChartRange = (value: string): value is ChartRange => (CHART_RANGES as readonly string[]).includes(value);
export const CHART_RANGE_LABEL: Record<ChartRange, string> = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "4h": "4 hours", "1d": "1 day" };

/** One candle: time in seconds (the chart's unit), prices in US dollars, volume in US dollars. */
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type CandleAnswer = { range: ChartRange; candles: Candle[]; asOf: number; stale: boolean };

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Market ${response.status}`);
  return (await response.json()) as T;
}

/** The page's stats, trades and holders: polled every 15 seconds while the tab is visible. */
export const coinMarketQuery = (mint: string) => ({
  queryKey: ["coin-market", mint] as const,
  queryFn: () => readJson<CoinMarket>(`/api/live/market/${mint}`),
  staleTime: 10_000,
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  retry: 1,
});

/** One range's candles: polled every 30 seconds (GeckoTerminal itself updates about once a minute). */
export const coinCandlesQuery = (mint: string, range: ChartRange) => ({
  queryKey: ["coin-candles", mint, range] as const,
  queryFn: () => readJson<CandleAnswer>(`/api/live/market/${mint}/candles/${range}`),
  staleTime: 20_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  retry: 1,
});
