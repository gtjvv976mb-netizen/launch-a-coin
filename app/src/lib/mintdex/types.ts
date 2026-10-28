// Shapes returned by the server functions (client-safe).

import type { InboxKind } from "./copy";

export type CoinSummary = {
  id: string;
  dexNo: number;
  name: string;
  ticker: string;
  image: string;
  lore: string;
  /** Creator-selected design identity. Fixed for the lifetime of this CardDex card. */
  cardTemplate?: string;
  /** Associated stock reference derived from the fixed design; never equity backing or ownership. */
  stockTicker?: string | null;
  /** Catalog-defined reference pair, such as GME / SOL; no external market or redemption promise. */
  tokenPair?: string | null;
  /** Fixed material/lighting finish chosen at launch; independent of market cap. */
  level: number;
  /** Compatibility copy of the fixed material finish. */
  liveLevel: number;
  mcapUsd: number;
  priceSol: number;
  change24h: number;
  volume: number;
  volume24h: number;
  holders: number;
  trades: number;
  curveProgress: number;
  ownerId: string;
  ownerHandle: string;
  /** The card's owner is a demo bot (test mode, backlog P0-6). */
  ownerIsBot: boolean;
  creatorId: string;
  creatorHandle: string;
  /** The launcher is a demo bot (test mode). */
  creatorIsBot: boolean;
  listPrice: number | null;
  topBid: number | null;
  bidCount: number;
  createdAt: number;
  lastTradeAt: number;
  /** Card fees waiting in the card's fee vault (lamports). */
  feeVault: number;
  /** Vanity mint address (ends in "mint"). */
  mintAddress: string | null;
  /** The pump.fun curve sold out and the coin trades on PumpSwap. */
  graduated: boolean;
};

export type CoinDetail = CoinSummary & {
  vSol: number;
  vTok: number;
  ownerFees: number;
  ownerEarnings: number;
  website: string | null;
  xUrl: string | null;
  deedGuide: number;
};

export type TradeRow = {
  id: number;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  price: number;
  mcapUsd: number;
  handle: string;
  /** The trader is a demo bot (test mode). */
  isBot: boolean;
  createdAt: number;
};

export type BidRow = {
  id: string;
  coinId: string;
  amount: number;
  bidderId: string;
  handle: string;
  /** The bidder is a demo bot (test mode). */
  isBot: boolean;
  createdAt: number;
};

export type SaleRow = {
  id: number;
  coinId: string;
  coinName: string;
  ticker: string;
  image: string;
  level: number;
  price: number;
  seller: string;
  buyer: string;
  /** The buyer is a demo bot (test mode). */
  buyerIsBot: boolean;
  kind: "bid" | "buy_now";
  createdAt: number;
};

export type EventRow = {
  id: number;
  kind: "launch" | "buy" | "sell" | "levelup" | "bid" | "sale" | "list";
  coinId: string;
  coinName: string;
  ticker: string;
  image: string;
  handle: string | null;
  /** The player behind the event is a demo bot (test mode). */
  isBot: boolean;
  amount: number;
  level: number;
  createdAt: number;
};

/** One thing that happened to a player's cards or bids while they were away (backlog P1-13). */
export type InboxItem = {
  kind: InboxKind;
  coinId: string;
  coinName: string;
  /** The bid or sale amount (lamports). */
  amount: number;
  /** The other player (the buyer of a sold card, the bidder of an offer), when there is one. */
  who: string | null;
  whoIsBot: boolean;
  at: number;
};

/** Unread counts since the player last opened Portfolio, and the newest unread event (P1-13). */
export type Inbox = {
  offers: number;
  won: number;
  outbid: number;
  sold: number;
  latest: InboxItem | null;
  /** The cursor: events after this time are unread. */
  seenAt: number;
};

export type Me = {
  id: string;
  handle: string;
  balance: number;
  canFaucet: boolean;
  faucetReadyAt: number | null;
  /** Only the getMe read (the root loader and its poll) carries the inbox; write results leave it out. */
  inbox?: Inbox;
} | null;

export type CoinPage = {
  coin: CoinDetail;
  trades: TradeRow[];
  bids: BidRow[];
  sales: SaleRow[];
  viewer: {
    holding: number;
    myBid: BidRow | null;
    isOwner: boolean;
    isCreator: boolean;
  } | null;
};

export type HomeData = {
  featured: CoinSummary[];
  trending: CoinSummary[];
  activity: EventRow[];
  stats: { coins: number; deedSales: number; volume: number; players: number };
};

export type MarketData = {
  listed: CoinSummary[];
  topBids: CoinSummary[];
  sales: SaleRow[];
};

export type PortfolioData = {
  holdings: Array<{ coin: CoinSummary; amount: number; valueSol: number }>;
  deeds: Array<{ coin: CoinSummary; earnings: number }>;
  bids: Array<{ bid: BidRow; coin: CoinSummary }>;
  offers: Array<{ bid: BidRow; coin: CoinSummary }>;
  totals: { holdingsValue: number; earnings: number; escrowed: number };
};

export type LevelsData = {
  coin: CoinSummary | null;
  counts: number[];
};
