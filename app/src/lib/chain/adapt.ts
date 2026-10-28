// The chain API's shapes (chain/sdk/src/api/types.ts) turned into the app's existing shapes (lib/mintdex/types.ts),
// so the devnet pages keep rendering CoinSummary, TradeRow and friends with the mint address as the coin id
// (refs/chain/m3-contract.md §8.5). The trade ticket's estimates live in estimate.ts (they need the SDK quote math).
//
// Owner: app:pages. Pure functions, no I/O: SSR and client safe. Imports types only ("@mintdex/chain-sdk/api" is
// import free), so it can sit in the main chunk with the page loaders.
// Amounts arrive as decimal strings and become JS numbers here (every devnet amount is far below 2^53); the
// exact bigint values the transactions use never come from these helpers.

import type {
  ApiBid,
  ApiCardState,
  ApiCoinDetail,
  ApiCoinSummary,
  ApiCurveState,
  ApiEvent,
  ApiHomeResponse,
  ApiMarketResponse,
  ApiPoolState,
  ApiSale,
  ApiTrade,
} from "@mintdex/chain-sdk/api";

import type {
  BidRow,
  CoinDetail,
  CoinSummary,
  EventRow,
  HomeData,
  LevelsData,
  MarketData,
  SaleRow,
  TradeRow,
} from "../mintdex/types";
import { CLUSTER } from "../mintdex/mode";
import { TIERS } from "../mintdex/tiers";
import { getPairAsset, getTradingPair } from "../carddex/pairs";

// Inactive legacy SDK records are native SOL only; they do not infer custom quote identities from a skin.
const legacySol = getPairAsset("sol");
const LEGACY_SOL_QUOTE = { quoteAssetKey: legacySol.key, quoteMint: legacySol.mint, quoteSymbol: legacySol.symbol, quoteDecimals: legacySol.decimals, quoteTokenProgram: legacySol.tokenProgram };

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const TOKEN_UNIT = 1_000_000;

/**
 * USD per lamport of market cap on devnet: $118 per SOL times the ×100 devnet multiplier (card-program-v2 §13
 * step 7). Used only when a coin's own mcapUsdE6 / mcapLamports ratio is not available (market cap 0).
 */
export const DEVNET_USD_PER_LAMPORT = (118 * 100) / LAMPORTS_PER_SOL;

/** Solana's target slot time after SIMD-0525. Estimates vary with actual cluster performance. */
export const ESTIMATED_SLOT_SECONDS = 0.2;
export const MAINNET_DEFAULT_HOLD_SLOTS = 18_000;

/** Display the current Config's hold duration, falling back to the selected cluster's planned setting. */
export function holdTimeOf(holdSlots?: number, cluster: "devnet" | "mainnet" = CLUSTER): string {
  const slots = Number.isFinite(holdSlots) && holdSlots! > 0 ? holdSlots! : cluster === "mainnet" ? MAINNET_DEFAULT_HOLD_SLOTS : 150;
  const seconds = Math.max(1, Math.round(slots * ESTIMATED_SLOT_SECONDS));
  if (seconds < 60) return `about ${seconds} seconds`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes === 1) return "about a minute";
  if (minutes === 60) return "about an hour";
  return `about ${minutes} minutes`;
}

/**
 * USD per lamport of market cap from the live Config (ApiConfig.solUsdE6 and mcapMultiplier: $ per SOL times 1 on
 * mainnet, times 100 on devnet), else the devnet constant (0 on mainnet). Display only.
 */
export function usdPerLamportOf(cfg: { solUsdE6?: string; mcapMultiplier?: number } | null | undefined): number {
  const usd = num(cfg?.solUsdE6) / 1e6;
  const mult = cfg?.mcapMultiplier && cfg.mcapMultiplier > 0 ? cfg.mcapMultiplier : 1;
  return usd > 0 ? (usd * mult) / LAMPORTS_PER_SOL : CLUSTER === "mainnet" ? 0 : DEVNET_USD_PER_LAMPORT;
}

/**
 * The 14 design thresholds in USD (level 1 = 0) from the chain Config (ApiConfig.thresholdsUsd, 13 rising values for
 * levels 2..14), else TIERS (equal to the mainnet defaults $15K to $1M, tests/chain/mainnet-build.test.ts). Display
 * only; the program enforces its own Config.
 */
export function tierUsdOf(cfg: { thresholdsUsd?: number[] } | null | undefined): number[] {
  const t = cfg?.thresholdsUsd;
  const ok =
    Array.isArray(t) &&
    t.length === TIERS.length - 1 &&
    t.every((v, i) => Number.isFinite(v) && v > 0 && (i === 0 || v > t[i - 1]));
  return ok ? [0, ...t] : TIERS.map((x) => x.minUsd);
}

// ---------------------------------------------------------------- scalars

/** A decimal-string amount as a JS number (0 for null or garbage). */
export function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A decimal-string amount as a bigint (0n for null or garbage). */
export function big(v: string | number | null | undefined): bigint {
  if (v == null) return 0n;
  try {
    return BigInt(typeof v === "number" ? Math.trunc(v) : v.trim() || "0");
  } catch {
    return 0n;
  }
}

/** "BiHs...dFtQ": a wallet address short enough for a row. */
export function shortAddress(address: string | null | undefined): string {
  if (!address) return "unknown";
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

/** The name a wallet goes by: its MintDex handle, else its short address. */
export function walletName(handle: string | null | undefined, address: string | null | undefined): string {
  return handle || shortAddress(address);
}

/** A stable positive 31-bit number for a string key (FNV-1a), for row types whose id is a number. */
export function numericId(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

/**
 * USD per lamport of market cap for this coin, from its own figures (exact ratio of the Worker's math). Without them
 * (market cap 0): the devnet constant on devnet, 0 on mainnet (no USD figure rather than a devnet ×100 one).
 */
export function usdPerLamport(c: Pick<ApiCoinSummary, "mcapLamports" | "mcapUsdE6">): number {
  const lamports = num(c.mcapLamports);
  const usd = num(c.mcapUsdE6) / 1e6;
  return lamports > 0 && usd > 0 ? usd / lamports : CLUSTER === "mainnet" ? 0 : DEVNET_USD_PER_LAMPORT;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A mint address as the coin route takes it (base58, 32 to 44 characters). */
export function isMintParam(s: string): boolean {
  return BASE58.test(s);
}

// ---------------------------------------------------------------- coins

/** The listing price when buy now would pass right now, else null. */
function buyablePrice(listing: ApiCoinSummary["listing"]): number | null {
  return listing && listing.buyable && !listing.voided && !listing.expired ? num(listing.price) : null;
}

export function toCoinSummary(c: ApiCoinSummary): CoinSummary {
  const holder = c.holder ?? c.launcher;
  return {
    ...LEGACY_SOL_QUOTE,
    tradingPair: getTradingPair(c.symbol, "sol"),
    priceQuote: Number.isFinite(c.priceSol) ? c.priceSol : 0,
    mcapQuote: num(c.mcapLamports) / LAMPORTS_PER_SOL,
    volumeQuote: c.volume24hLamports,
    volume24hQuote: c.volume24hLamports,
    valuationMode: "demo-reference",
    id: c.mint,
    dexNo: c.dexNo ?? 0,
    name: c.name,
    ticker: c.symbol,
    image: c.image?.url ?? "",
    lore: c.description ?? "",
    level: c.level,
    liveLevel: c.liveLevel,
    mcapUsd: num(c.mcapUsdE6) / 1e6,
    priceSol: Number.isFinite(c.priceSol) ? c.priceSol : 0,
    change24h: (c.change24hBps ?? 0) / 10_000,
    volume: num(c.volume24hLamports),
    volume24h: num(c.volume24hLamports),
    // Holder counts need DAS (HELIUS_DAS=1, M4); without it the card shows 0 (m3-contract §10 known gap 4).
    holders: c.holders ?? 0,
    trades: c.trades24h ?? 0,
    curveProgress: (c.curveProgressBps ?? 0) / 10_000,
    ownerId: holder,
    ownerHandle: walletName(c.holder ? c.holderHandle : c.launcherHandle, holder),
    ownerIsBot: false,
    creatorId: c.launcher,
    creatorHandle: walletName(c.launcherHandle, c.launcher),
    creatorIsBot: false,
    listPrice: buyablePrice(c.listing),
    topBid: c.topBid != null && num(c.topBid) > 0 ? num(c.topBid) : null,
    bidCount: c.bidCount ?? 0,
    createdAt: (c.createdAt ?? 0) * 1000,
    lastTradeAt: (c.lastTradeAt ?? c.createdAt ?? 0) * 1000,
    feeVault: num(c.withdrawableLamports),
    mintAddress: c.mint,
    graduated: c.graduated,
  };
}

/** Virtual reserves the sim shapes carry (vSol, vTok): the curve's, or the pool's quote and base amounts. */
function reserves(curve: ApiCurveState | null, pool: ApiPoolState | null) {
  if (pool) return { vSol: num(pool.quoteAmount) + num(pool.virtualQuoteReserves), vTok: num(pool.baseAmount) };
  if (curve) return { vSol: num(curve.virtualSolReserves), vTok: num(curve.virtualTokenReserves) };
  return { vSol: 0, vTok: 0 };
}

export function toCoinDetail(c: ApiCoinDetail): CoinDetail {
  const s = toCoinSummary(c);
  const card: ApiCardState = c.card;
  const paid = num(card.feesPaidOut);
  return {
    ...s,
    // The card's own holder and fees (fresher than the summary's when the card was just read).
    ownerId: card.holder ?? s.ownerId,
    ownerHandle: card.holder ? walletName(card.holderHandle, card.holder) : s.ownerHandle,
    feeVault: num(card.fees.total),
    listPrice: buyablePrice(card.listing),
    ...reserves(c.curve, c.pool),
    vQuote: reserves(c.curve, c.pool).vSol,
    ownerFees: paid + num(card.fees.total),
    ownerEarnings: paid,
    website: c.links.website,
    xUrl: c.links.twitter,
    deedGuide: Math.max(num(card.lastSalePrice), s.topBid ?? 0),
  };
}

// ---------------------------------------------------------------- trades and the chart

/** Trades oldest first (TradesList and McapChart read the last row as the newest). */
export function toTrades(trades: ApiTrade[], perLamport: number): TradeRow[] {
  return [...trades]
    .sort((a, b) => a.slot - b.slot || a.blockTime - b.blockTime)
    .map((t, i) => {
      const sol = num(t.solLamports);
      const toks = num(t.tokens);
      return {
        ...LEGACY_SOL_QUOTE,
        quoteAmount: sol,
        priceQuote: toks > 0 ? sol / LAMPORTS_PER_SOL / (toks / TOKEN_UNIT) : 0,
        mcapQuote: num(t.mcapAfterLamports) / LAMPORTS_PER_SOL,
        id: numericId(`${t.sig}:${i}`),
        side: t.side,
        sol,
        tokens: toks,
        price: toks > 0 ? sol / LAMPORTS_PER_SOL / (toks / TOKEN_UNIT) : 0,
        mcapUsd: num(t.mcapAfterLamports) * perLamport,
        handle: walletName(t.traderHandle, t.trader),
        isBot: false,
        createdAt: t.blockTime * 1000,
      };
    });
}

/**
 * The chart's points as the rows McapChart draws (it reads only createdAt and mcapUsd), oldest first. McapChart
 * starts its "All" line from the last row before the coin's createdAt, so the page passes the first point's time
 * plus 1 ms as createdAt (chartStart) and the line starts at the chain's own first market cap.
 */
export function chartRows(points: Array<[number, string]>, perLamport: number): TradeRow[] {
  return [...points]
    .sort((a, b) => a[0] - b[0])
    .map(([t, mcap], i) => ({
      ...LEGACY_SOL_QUOTE,
      quoteAmount: 0,
      priceQuote: 0,
      mcapQuote: num(mcap) / LAMPORTS_PER_SOL,
      id: i + 1,
      side: "buy" as const,
      sol: 0,
      tokens: 0,
      price: 0,
      mcapUsd: num(mcap) * perLamport,
      handle: "",
      isBot: false,
      createdAt: t * 1000,
    }));
}

/** createdAt for McapChart: just after the first chart point (see chartRows), else the coin's own. */
export function chartStart(rows: TradeRow[], createdAt: number): number {
  return rows.length ? rows[0].createdAt + 1 : createdAt;
}

// ---------------------------------------------------------------- bids, sales, events

export function toBid(b: ApiBid): BidRow {
  return {
    id: `${b.mint}:${b.bidder}`,
    coinId: b.mint,
    amount: num(b.amount),
    bidderId: b.bidder,
    handle: walletName(b.bidderHandle, b.bidder),
    isBot: false,
    createdAt: (b.updatedAt || b.createdAt) * 1000,
  };
}

export function toSale(s: ApiSale): SaleRow {
  return {
    id: numericId(s.sig),
    coinId: s.mint,
    coinName: s.name,
    ticker: s.symbol,
    image: s.image?.url ?? "",
    level: s.level,
    price: num(s.price),
    seller: walletName(s.sellerHandle, s.seller),
    buyer: walletName(s.buyerHandle, s.buyer),
    buyerIsBot: false,
    kind: s.viaBid ? "bid" : "buy_now",
    createdAt: s.blockTime * 1000,
  };
}

/** Feed kinds the activity rows can say; other chain events (cancel, delist, withdraw, pending) stay out of feeds. */
const EVENT_KINDS: Partial<Record<ApiEvent["kind"], EventRow["kind"]>> = {
  launch: "launch",
  buy: "buy",
  sell: "sell",
  levelup: "levelup",
  bid: "bid",
  list: "list",
  sale: "sale",
};

export function toEvent(e: ApiEvent): EventRow | null {
  const kind = EVENT_KINDS[e.kind];
  if (!kind) return null;
  return {
    ...LEGACY_SOL_QUOTE,
    quoteAmount: num(e.amountLamports),
    id: numericId(e.id),
    kind,
    coinId: e.mint,
    coinName: e.name,
    ticker: e.symbol,
    image: e.image?.url ?? "",
    handle: e.wallet ? walletName(e.walletHandle, e.wallet) : null,
    isBot: false,
    amount: num(e.amountLamports),
    level: e.level ?? 0,
    createdAt: e.blockTime * 1000,
  };
}

// ---------------------------------------------------------------- pages

export function toHome(r: ApiHomeResponse): HomeData & { rev: string } {
  return {
    // Lowest design first, as the test-mode home lists them (Home steps from the rarest).
    featured: r.featured.map(toCoinSummary).sort((a, b) => a.level - b.level || (a.mcapUsd ?? 0) - (b.mcapUsd ?? 0)),
    trending: r.trending.map(toCoinSummary),
    activity: r.activity.map(toEvent).filter((e): e is EventRow => e !== null),
    stats: {
      coins: r.stats.coins,
      deedSales: r.stats.cardSales,
      volume: num(r.stats.volume24hLamports),
      volumeByQuote: { sol: r.stats.volume24hLamports },
      players: r.stats.wallets,
    },
    rev: r.rev,
  };
}

export function toMarket(r: ApiMarketResponse): MarketData & { rev: string } {
  return {
    listed: r.listed.map(toCoinSummary),
    topBids: r.topBids.map(toCoinSummary),
    sales: r.sales.map(toSale),
    rev: r.rev,
  };
}

/** Levels: how many cards hold each design, and the busiest coin for the stage card. */
export function toLevels(coins: CoinSummary[]): LevelsData {
  const counts = TIERS.map((t) => coins.filter((c) => c.level === t.level).length);
  const coin = [...coins].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0) || (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0))[0] ?? null;
  return { coin, counts };
}

/** UTF-8 byte length (the launch name limit is 32 bytes, never characters). */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
