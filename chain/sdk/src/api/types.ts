// The mintdex-chain HTTP API contract (refs/chain/m3-contract.md §3). The chain Worker (chain-worker/) and the
// app (app/src/lib/chain/) both import these types, so a field can only change in one place.
//
// Rules for this file (it is imported by the app's main chunk through "@mintdex/chain-sdk/api"):
//   - no imports at all (keeps the app bundle free of noble, PDAs and the IDL);
//   - every u64 amount crosses the wire as a decimal string (Lamports, TokenAmount); counts, levels, slots and
//     unix seconds are JSON numbers (all < 2^53);
//   - names start with Api / API_ so `export *` from the SDK index never collides with an existing export;
//   - FROZEN for the M3 build phase: a change needs a contract amendment (m3-contract.md §10). Amended once at
//     contract finalization (2026-10-04, §10.2): rate limit stores, new limits, NEEDS_COLLECT, the seller's own floor
//     on accept / list, the usage meter on /health, and trust notes on ApiConfig.

// ---------------------------------------------------------------- scalars

/** A Solana address or signature in base58. */
export type Base58 = string;
/** u64 lamports as a decimal string ("1500000000" = 1.5 SOL). */
export type Lamports = string;
/** u64 token base units as a decimal string (pump coins have 6 decimals: "1000000" = 1 token). */
export type TokenAmount = string;
/** Seconds since the unix epoch. */
export type UnixSeconds = number;
/** A serialized transaction (wire bytes) in standard base64. */
export type TxBase64 = string;

export const CHAIN_API_VERSION = 1 as const;
export const CHAIN_API_PREFIX = "/api/chain" as const;
/** The Wallet Standard chain id every devnet signing request uses. */
export const API_SOLANA_CHAIN = "solana:devnet" as const;
/** The clusters the API serves (one per deployment; the app checks ApiConfig.cluster against its own build). */
export type ApiCluster = "devnet" | "mainnet";
/** The Wallet Standard chain id of a cluster. */
export const apiSolanaChain = (cluster: ApiCluster): "solana:devnet" | "solana:mainnet" =>
  cluster === "mainnet" ? "solana:mainnet" : "solana:devnet";

// ---------------------------------------------------------------- routes

export type ApiMethod = "GET" | "POST";
export interface ApiRouteDef {
  method: ApiMethod;
  /** Path pattern; `:name` segments are base58 or kind parameters (never contain "/"). */
  path: string;
  /** "session" = Authorization: Bearer <token> from /auth/verify; "hook" = HELIUS_WEBHOOK_SECRET header. */
  auth: "none" | "session" | "hook";
}

/**
 * Every /api/chain route. The Worker binds one handler per id (chain-worker/src/index.ts), the app builds URLs
 * from the same table (app/src/lib/chain/client.ts). Order matters for matching: fixed paths come before
 * patterns that could also match them (tx/submit and tx/status before tx/:kind).
 */
export const API_ROUTES = {
  health: { method: "GET", path: "/api/chain/health", auth: "none" },
  config: { method: "GET", path: "/api/chain/config", auth: "none" },
  rev: { method: "GET", path: "/api/chain/rev", auth: "none" },
  home: { method: "GET", path: "/api/chain/home", auth: "none" },
  coins: { method: "GET", path: "/api/chain/coins", auth: "none" },
  coin: { method: "GET", path: "/api/chain/coins/:mint", auth: "none" },
  coinTrades: { method: "GET", path: "/api/chain/coins/:mint/trades", auth: "none" },
  coinChart: { method: "GET", path: "/api/chain/coins/:mint/chart", auth: "none" },
  card: { method: "GET", path: "/api/chain/cards/:mint", auth: "none" },
  cardEvolve: { method: "POST", path: "/api/chain/cards/:mint/evolve", auth: "none" },
  market: { method: "GET", path: "/api/chain/market", auth: "none" },
  activity: { method: "GET", path: "/api/chain/activity", auth: "none" },
  wallet: { method: "GET", path: "/api/chain/wallets/:address", auth: "none" },
  walletHandle: { method: "POST", path: "/api/chain/wallets/handle", auth: "session" },
  authNonce: { method: "POST", path: "/api/chain/auth/nonce", auth: "none" },
  authVerify: { method: "POST", path: "/api/chain/auth/verify", auth: "none" },
  authLogout: { method: "POST", path: "/api/chain/auth/logout", auth: "session" },
  media: { method: "POST", path: "/api/chain/media", auth: "session" },
  launchPrepare: { method: "POST", path: "/api/chain/launch/prepare", auth: "session" },
  launchFinalize: { method: "POST", path: "/api/chain/launch/finalize", auth: "session" },
  launchStatus: { method: "GET", path: "/api/chain/launch/:intentId", auth: "none" },
  txSubmit: { method: "POST", path: "/api/chain/tx/submit", auth: "none" },
  txStatus: { method: "GET", path: "/api/chain/tx/status/:intentId", auth: "none" },
  txBuild: { method: "POST", path: "/api/chain/tx/:kind", auth: "none" },
  rpc: { method: "POST", path: "/api/chain/rpc", auth: "none" },
  heliusHook: { method: "POST", path: "/api/chain/hooks/helius", auth: "hook" },
} as const satisfies Record<string, ApiRouteDef>;

export type ApiRouteId = keyof typeof API_ROUTES;

/** POST /api/chain/tx/:kind values. Each returns an unsigned v0 tx plus an effects summary. */
export const API_TX_KINDS = [
  "buy",
  "sell",
  "complete-curve",
  "withdraw",
  "collect",
  "bid",
  "cancel-bid",
  "accept",
  "list",
  "delist",
  "buy-now",
] as const;
export type ApiTxKind = (typeof API_TX_KINDS)[number];

/** JSON-RPC methods POST /api/chain/rpc forwards to the keyed RPC (everything else: RPC_METHOD_NOT_ALLOWED). */
export const API_RPC_METHODS = ["getBalance", "getSignatureStatuses", "getLatestBlockhash", "getAccountInfo"] as const;
export type ApiRpcMethod = (typeof API_RPC_METHODS)[number];

// ---------------------------------------------------------------- envelope and errors

/** Stable machine codes. Messages are plain English for people (no em dashes, en dashes or middle dots). */
export const API_ERROR_CODES = [
  // input (400)
  "BAD_REQUEST",
  "INVALID_ADDRESS",
  "INVALID_MINT",
  "INVALID_NAME",
  "INVALID_SYMBOL",
  "INVALID_DESCRIPTION",
  "INVALID_LINK",
  "INVALID_AMOUNT",
  "INVALID_SLIPPAGE",
  "INVALID_TX",
  /** The wallet sent a transaction in a format newer than v0 (O2); nothing was sent. */
  "TX_VERSION_UNSUPPORTED",
  "IMAGE_TOO_LARGE",
  "IMAGE_TYPE",
  "IMAGE_NOT_FOUND",
  "HANDLE_INVALID",
  // auth (401 / 403)
  "UNAUTHORIZED",
  "AUTH_EXPIRED",
  "NONCE_INVALID",
  "SIGNATURE_INVALID",
  "FORBIDDEN_ORIGIN",
  "HOOK_UNAUTHORIZED",
  // not found (404)
  "NOT_FOUND",
  "COIN_NOT_FOUND",
  "CARD_NOT_FOUND",
  "INTENT_NOT_FOUND",
  // state (409 / 410 / 422)
  "HANDLE_TAKEN",
  "NOT_HOLDER",
  "NOT_LISTED",
  "ALREADY_LISTED",
  "NO_BID",
  "BID_TOO_LOW",
  "PRICE_TOO_LOW",
  "PRICE_CHANGED",
  "SELF_TRADE",
  "LISTING_VOIDED",
  "LISTING_EXPIRED",
  "NOTHING_TO_WITHDRAW",
  "CURVE_COMPLETE",
  "CURVE_NOT_NEAR_COMPLETE",
  "NOT_GRADUATED",
  "POOL_TOO_THIN",
  "INSUFFICIENT_FUNDS",
  "FEES_BELOW_FLOOR",
  /** More vault-owned WSOL accounts than API_LIMITS.maxExtraWsolAccounts: run collect batches first (m3-contract §3.6). */
  "NEEDS_COLLECT",
  "PAUSED",
  "INTENT_EXPIRED",
  "INTENT_USED",
  "WALLET_REWROTE_TX",
  "FEE_PAYER_MISMATCH",
  "BAD_SIGNATURE",
  "MISSING_SIGNATURE",
  "SIMULATION_FAILED",
  "TX_TOO_LARGE",
  /**
   * The simulated launch would create a coin MintDex cannot register (a pump flag, creator or quote changed, O3):
   * launches pause with an alert (alert:pump_flags); nothing was signed.
   */
  "LAUNCH_COIN_CHECK_FAILED",
  /** The card's token account is frozen by another app (a delegate's Lock, F10): it can still withdraw fees, not trade. */
  "CARD_FROZEN",
  /** The app and the server are on different clusters (devnet build against a mainnet API or the reverse). */
  "WRONG_NETWORK",
  /**
   * Early-days exposure cap (launch-plan §4.5, 422): a new bid, a raise, a new listing or a higher re-price above the
   * Worker's MAX_BID_LAMPORTS / MAX_LIST_PRICE_LAMPORTS. details: { capLamports, kind: "bid" | "list" }.
   */
  "AMOUNT_ABOVE_LAUNCH_CAP",
  // limits (429)
  "RATE_LIMITED",
  "TOO_MANY_RESERVATIONS",
  // service (500 / 501 / 502 / 503)
  /** The launch gate is closed, or allowlisted and this wallet is not on the list (launch-plan §1.6, 503). */
  "LAUNCHES_NOT_OPEN",
  "VAULT_EMPTY",
  "ALT_UNAVAILABLE",
  "CLUSTER_MISMATCH",
  "RPC_UNAVAILABLE",
  "RPC_METHOD_NOT_ALLOWED",
  "SEND_FAILED",
  "ENGINE_OFF",
  "NOT_IMPLEMENTED",
  "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Present on 429 (mirrors the Retry-After header). */
  retryAfterSec?: number;
  /** Present on SIMULATION_FAILED / SEND_FAILED when a program error was decoded (e.g. MintDex 6035 FeesBelowFloor). */
  programError?: { program: Base58; code: number; name: string | null };
  /** Last simulation log lines (at most 20), for SIMULATION_FAILED. */
  logs?: string[];
  details?: Record<string, unknown>;
}

export type ApiOk<T extends object> = { ok: true } & T;
export interface ApiFail {
  ok: false;
  error: ApiError;
}
/** Every /api/chain response body. HTTP status mirrors the outcome (200 ok, 4xx/5xx with ok: false). */
export type ApiResult<T extends object> = ApiOk<T> | ApiFail;

// ---------------------------------------------------------------- limits (shared validation)

export const API_LIMITS = {
  nameMaxBytes: 32,
  symbolMinChars: 2,
  symbolMaxChars: 10,
  /** Ticker characters: uppercase letters and digits. */
  symbolPattern: "^[A-Z0-9]{2,10}$",
  descriptionMaxChars: 400,
  linkMaxChars: 200,
  imageMaxBytes: 2 * 1024 * 1024,
  imageTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  devBuyMaxLamports: "1000000000",
  slippageMaxBps: 2_000,
  slippageDefaultBps: 500,
  handlePattern: "^[a-z0-9_]{3,16}$",
  /** At most this many open launch reservations per wallet (C13). */
  maxOpenReservationsPerWallet: 2,
  /**
   * At most this many open launch reservations per network (IPv4 /24, IPv6 /48; ratelimit.ts ipNetworkSubject), so
   * one operator with many free wallets cannot hold the whole vault (C13).
   */
  maxOpenReservationsPerNetwork: 4,
  /**
   * An upload that needs a new KV write (bytes no wallet uploaded before) needs this much SOL in the wallet: below
   * the cheapest launch, so it never refuses a real launcher, but a spammer needs funded wallets.
   */
  mediaMinBalanceLamports: "10000000",
  /** "Complete the curve" shows when the curve's real token reserves (base units) are below this (1,000 tokens). */
  dustTokenThreshold: "1000000000",
  /** Extra (non-ATA) vault-owned WSOL accounts one sale / sweep tx may carry; more → NEEDS_COLLECT. */
  maxExtraWsolAccounts: 8,
  /** Data pollers (GET /rev first): every 20 s while the page is visible, paused while hidden. */
  revPollMs: 20_000,
  /** While the viewer's own tx or unlock is pending: every 5 s, for at most pendingPollMaxMs. */
  pendingPollMs: 5_000,
  pendingPollMaxMs: 120_000,
  /** A 'reserved' vault key whose mint signature never left the Worker is reusable after this (m3-contract §3.5.1). */
  reservationReclaimSec: 120,
  /** A mint-signed key is released only when the finalized block height passes lastValidBlockHeight + this. */
  releaseMarginBlocks: 32,
  /** POST /rpc reads at most this many bytes of the upstream answer (larger: RPC_UNAVAILABLE). */
  rpcRelayMaxBytes: 131_072,
  /** POST /hooks/helius body limit (larger: 413); signatures are taken by a bounded scan, never a JSON parse. */
  webhookMaxBytes: 4_194_304,
} as const;

/**
 * Fixed-window limits the Worker enforces. store "d1" = the rate_limits table (state-changing POSTs only, one row
 * write per check); store "isolate" = an in-memory soft counter per isolate (reads, /rev, status polls, the rpc
 * relay: polling never writes D1). Check IP keys before wallet keys. m3-contract §3.3.
 */
export const API_RATE_LIMITS = {
  prepareWallet: { limit: 5, windowSec: 600, store: "d1" },
  prepareIp: { limit: 10, windowSec: 600, store: "d1" },
  finalizeIntent: { limit: 3, windowSec: 600, store: "d1" },
  txBuildIp: { limit: 60, windowSec: 60, store: "d1" },
  txSubmitIp: { limit: 60, windowSec: 60, store: "d1" },
  mediaWallet: { limit: 10, windowSec: 3600, store: "d1" },
  mediaIp: { limit: 20, windowSec: 3600, store: "d1" },
  /** New bytes (a KV write) per wallet per day, and per network (IPv4 /24, IPv6 /48) per day. */
  mediaWalletDay: { limit: 10, windowSec: 86_400, store: "d1" },
  mediaNetworkDay: { limit: 30, windowSec: 86_400, store: "d1" },
  /**
   * Global (subject "all"): protects the KV Free quota of 1,000 writes a day, shared with publish.mjs. Counted last,
   * after the per-wallet, per-network and balance checks, so one stranger cannot use it all up.
   */
  mediaDay: { limit: 300, windowSec: 86_400, store: "d1" },
  authIp: { limit: 30, windowSec: 600, store: "d1" },
  handleWallet: { limit: 5, windowSec: 86_400, store: "d1" },
  evolveIp: { limit: 20, windowSec: 60, store: "d1" },
  evolveMint: { limit: 1, windowSec: 30, store: "d1" },
  /**
   * Global (subject "all"): chain re-reads an API call may trigger (the evolve press, coins/:mint?fresh=1; up to 6 RPC
   * calls each). Over the limit the route answers from D1 without the re-read, so no caller can spend the RPC credits
   * the indexer, launches and tx builds need.
   */
  apiRefreshAll: { limit: 30, windowSec: 60, store: "d1" },
  rpcIp: { limit: 120, windowSec: 60, store: "isolate" },
  readsIp: { limit: 600, windowSec: 60, store: "isolate" },
  statusIp: { limit: 120, windowSec: 60, store: "isolate" },
  /** coin?fresh=1 (known mints only, coalesced per mint). */
  freshIp: { limit: 20, windowSec: 60, store: "isolate" },
  /** GET /wallets/:address (cached 10 s per address). */
  walletIp: { limit: 30, windowSec: 60, store: "isolate" },
} as const satisfies Record<string, { limit: number; windowSec: number; store: "d1" | "isolate" }>;
export type ApiRateLimitKey = keyof typeof API_RATE_LIMITS;

// ---------------------------------------------------------------- shared shapes

export interface ApiImage {
  /** KV key (content addressed, immutable). */
  key: string;
  /** Absolute URL to fetch it from (`{mediaOrigin}/img/{key}`). */
  url: string;
}

export interface ApiListingFlags {
  voidOnEvolve: boolean;
}

export interface ApiListing extends ApiListingFlags {
  mint: Base58;
  seller: Base58;
  sellerHandle: string | null;
  price: Lamports;
  /** 0 = never. */
  expiresAt: UnixSeconds;
  levelAtList: number;
  minFeesToSeller: Lamports;
  createdAt: UnixSeconds;
  /** buy_now would pass the program's rules right now (not expired, not voided). */
  buyable: boolean;
  voided: boolean;
  expired: boolean;
  /**
   * VOID_ON_EVOLVE listings (fix pack F2): the slot through which `buy_now` stays refused if the current unlock stops
   * now (the program's mark, or the window held so far), null when nothing pauses it. Absent from older Workers.
   */
  pausedUntilSlot?: number | null;
  /** pausedUntilSlot as an estimated unix time (0.2 s per slot), null when not paused. */
  resumesAt?: UnixSeconds | null;
  /**
   * False when the pause protection cannot be relied on right now (the observer is silent, or a VOID-listed card's
   * level rose without a window: alert void_unprotected). Absent from older Workers (= true).
   */
  protectionActive?: boolean;
  /**
   * Wallet listings only (`ApiWallet.listings`): the listed coin is hidden by the operator (see ApiCardState.hidden),
   * so the app can drop it for other viewers. Absent elsewhere (the enclosing coin or card carries `hidden`) and from
   * older Workers.
   */
  hidden?: boolean;
}

export interface ApiBid {
  mint: Base58;
  bidder: Base58;
  bidderHandle: string | null;
  amount: Lamports;
  createdAt: UnixSeconds;
  updatedAt: UnixSeconds;
  /** False when the indexer's simulation says accept_bid would fail (e.g. MemoTransfer bidder ATA, R25). */
  acceptable: boolean;
}

export interface ApiSale {
  sig: Base58;
  mint: Base58;
  name: string;
  symbol: string;
  image: ApiImage | null;
  /** Card level at the time of the sale. */
  level: number;
  seller: Base58;
  sellerHandle: string | null;
  buyer: Base58;
  buyerHandle: string | null;
  price: Lamports;
  protocolFee: Lamports;
  royalty: Lamports;
  sellerNet: Lamports;
  feesToSeller: Lamports;
  viaBid: boolean;
  slot: number;
  blockTime: UnixSeconds;
}

export interface ApiTrade {
  sig: Base58;
  mint: Base58;
  trader: Base58;
  traderHandle: string | null;
  side: "buy" | "sell";
  venue: "curve" | "pool";
  solLamports: Lamports;
  tokens: TokenAmount;
  feeLamports: Lamports;
  creatorFeeLamports: Lamports;
  mcapAfterLamports: Lamports;
  slot: number;
  blockTime: UnixSeconds;
}

export type ApiEventKind =
  | "launch"
  | "buy"
  | "sell"
  | "levelup"
  | "pending"
  | "pending_cleared"
  | "bid"
  | "bid_cancel"
  | "list"
  | "delist"
  | "sale"
  | "withdraw"
  | "migrate";

/** One authentic on-chain event for feeds (never simulated, never a bot). */
export interface ApiEvent {
  /** "{sig}:{ix}:{inner}" */
  id: string;
  kind: ApiEventKind;
  mint: Base58;
  name: string;
  symbol: string;
  image: ApiImage | null;
  wallet: Base58 | null;
  walletHandle: string | null;
  amountLamports: Lamports | null;
  level: number | null;
  sig: Base58;
  slot: number;
  blockTime: UnixSeconds;
}

/** The §8 withdrawable breakdown (SDK withdrawableBreakdown) at `syncedSlot`. */
export interface ApiFeeBreakdown {
  vaultAvailable: Lamports;
  curveLeg: Lamports;
  ammLeg: Lamports;
  wsolLeg: Lamports;
  /** One-time vault top-up the first sweep's signer pays (0 after the first). */
  topUp: Lamports;
  /** What withdraw_fees moves to the holder now (also the seller's fee floor, sellerFeeFloor). */
  total: Lamports;
  /** total minus topUp: the holder's balance change before the tx fee. */
  netToHolder: Lamports;
  /** Non-ATA vault-owned WSOL accounts (pass on every sweep and sale). */
  extraWsolAccounts: Base58[];
  syncedSlot: number;
}

export interface ApiEvolveProgress {
  obs: number;
  obsNeeded: number;
  slotsLeft: number;
  /** slotsLeft × 0.2 s, rounded up (display only). */
  etaSeconds: number;
  expiresAtSlot: number;
  /** Attested mode (F1): distinct observers who witnessed the window, and how many a confirm needs. Absent before. */
  witnesses?: number;
  witnessesNeeded?: number;
}

export interface ApiCardState {
  mint: Base58;
  cardState: Base58;
  cardMint: Base58;
  /** cardMint == PDA(["card-mint", mint], MintDex) (R20); the app shows no card otherwise. */
  cardMintVerified: boolean;
  level: number;
  /** Level the current market cap alone would unlock (SDK liveLevel with the live Config). */
  liveLevel: number;
  pendingLevel: number;
  pendingObs: number;
  pendingSinceSlot: number;
  pendingLastSlot: number;
  progress: ApiEvolveProgress | null;
  /** A user pressed "Unlock design" and the watchdog has not observed the card since. */
  unlockQueued: boolean;
  flags: number;
  graduated: boolean;
  creatorLost: boolean;
  feesChanged: boolean;
  legacy: boolean;
  /**
   * Card NFT standard (Card.flags bit 16, card-program-v2 §18.17): "metaplex" = Metaplex metadata + master edition
   * (wallet collectibles, marketplaces), "token2022" = Token-2022 TokenMetadata only. Optional for older Workers.
   */
  nftStandard?: ApiCardStandard;
  /** Card.flags bit 32: verified into the MintDex collection (F8). Absent from older Workers. */
  inCollection?: boolean;
  /** F2 mark (Card @212 / @220): VOID listings at a lower level stay paused through this slot. Absent from older Workers. */
  pendingHwmUntil?: number;
  pendingHwmLevel?: number;
  /** The holder's card token account is frozen by another app (F10): withdrawals work, market actions do not. */
  frozen?: boolean;
  /**
   * Unlock concentration (tier B1): when the current design unlocked, the 10 largest wallets (excluding the curve, the
   * pool and pump-owned accounts) held this share of the supply, in bps. null when not measured.
   */
  top10Bps?: number | null;
  launcher: Base58;
  launcherHandle: string | null;
  holder: Base58 | null;
  holderHandle: string | null;
  holderAccount: Base58 | null;
  /** wallet: a normal token account; listing: in escrow, holder = listing.seller; launcher_fallback: §4.5 sinks. */
  holderMode: "wallet" | "listing" | "launcher_fallback" | "unknown";
  listing: ApiListing | null;
  fees: ApiFeeBreakdown;
  feesPaidOut: Lamports;
  sales: number;
  lastSalePrice: Lamports;
  evolvedAt: UnixSeconds;
  /**
   * The operator hid this coin (automated test launches; chain Worker migration 0006 coin_flags): public lists, stats,
   * the market and the X bot leave it out, but its own page, trades, chart and card keep working so the holder can still
   * trade and withdraw. The app shows a notice. Added 2026-10-04 (m3-contract §10.1); absent from older Workers.
   */
  hidden?: boolean;
}

export interface ApiCoinSummary {
  mint: Base58;
  name: string;
  symbol: string;
  dexNo: number | null;
  image: ApiImage | null;
  description: string;
  level: number;
  liveLevel: number;
  pendingLevel: number;
  pendingObs: number;
  mcapLamports: Lamports;
  /** mcap × config price × multiplier (devnet ×100 at $118), micro-USD as a decimal string. */
  mcapUsdE6: string;
  /** Display only (float): SOL per whole token. */
  priceSol: number;
  supply: TokenAmount;
  /** 0..10000 share of the curve's real tokens sold; 10000 once complete. */
  curveProgressBps: number;
  complete: boolean;
  graduated: boolean;
  volume24hLamports: Lamports;
  trades24h: number;
  change24hBps: number;
  /** null when no DAS holder count is available (public RPC). */
  holders: number | null;
  /**
   * Unlock concentration of the current design (tier B1): the 10 largest wallets' share in bps when it unlocked; the app
   * shows "Concentrated" at 5,000 or more. null when not measured; absent from older Workers.
   */
  top10Bps?: number | null;
  launcher: Base58;
  launcherHandle: string | null;
  holder: Base58 | null;
  holderHandle: string | null;
  listing: ApiListing | null;
  topBid: Lamports | null;
  bidCount: number;
  withdrawableLamports: Lamports;
  legacy: boolean;
  flags: number;
  createdAt: UnixSeconds;
  lastTradeAt: UnixSeconds;
  /**
   * Hidden by the operator (see ApiCardState.hidden). Only a coin's own page and the wallet's own portfolio can
   * carry true; every public list leaves hidden coins out. Absent from older Workers.
   */
  hidden?: boolean;
}

export interface ApiCurveState {
  virtualSolReserves: Lamports;
  virtualTokenReserves: TokenAmount;
  realSolReserves: Lamports;
  realTokenReserves: TokenAmount;
  tokenTotalSupply: TokenAmount;
  complete: boolean;
}

export interface ApiPoolState {
  pool: Base58;
  baseAmount: TokenAmount;
  quoteAmount: Lamports;
  virtualQuoteReserves: Lamports;
  mintSupply: TokenAmount;
  coinCreator: Base58;
  poolBaseTokenAccount: Base58;
  poolQuoteTokenAccount: Base58;
}

export interface ApiCoinAddresses {
  cardState: Base58;
  cardMint: Base58;
  cardVault: Base58;
  bondingCurve: Base58;
  pool: Base58 | null;
  listing: Base58;
  listingEscrow: Base58;
  coinUri: string;
  cardUri: string;
}

export interface ApiCoinDetail extends ApiCoinSummary {
  addresses: ApiCoinAddresses;
  curve: ApiCurveState | null;
  pool: ApiPoolState | null;
  links: { twitter: string | null; website: string | null; telegram: string | null };
  card: ApiCardState;
  /** Top 20 by amount. */
  bids: ApiBid[];
  /** Last 20. */
  sales: ApiSale[];
  explorer: { coin: string; card: string };
  syncedSlot: number;
  syncedAt: UnixSeconds;
}

// ---------------------------------------------------------------- reads

/**
 * Display data. The client's verifier never takes a trust input from here: program id, Config address, ALT A / B,
 * the ALT treasury and the genesis hash come from the app's own constants (app/src/lib/chain/env.ts TRUST_ANCHORS),
 * and Config, pump Global, pAMM GlobalConfig, curves, pools and fee legs from its own public RPC reads
 * (m3-contract §7.3, R21).
 */
export interface ApiConfig {
  apiVersion: typeof CHAIN_API_VERSION;
  cluster: ApiCluster;
  genesisHash: Base58;
  programId: Base58;
  configAddress: Base58;
  altA: Base58;
  altB: Base58;
  admin: Base58;
  treasury: Base58;
  /** Config.paused bits: 1 REGISTER, 2 EVOLVE, 4 MARKET. */
  paused: number;
  sweepFlags: number;
  protocolFeeBps: number;
  creatorRoyaltyBps: number;
  minBid: Lamports;
  launchFee: Lamports;
  priceSource: "admin" | "pyth";
  solUsdE6: string;
  mcapMultiplier: number;
  /** "devnet ×100 at $118" (SDK DEVNET_USD_LABEL); every USD figure in the UI carries it. */
  usdLabel: string;
  /** Whole USD for levels 2..14 (13 values). */
  thresholdsUsd: number[];
  /** 14 values: the smallest market cap (lamports) for each level; level 1 = "0". */
  levelMinMcapLamports: Lamports[];
  evolve: { holdSlots: number; minObs: number; maxStep: number; gapSlots: number; expirySlots: number };
  rent0: Lamports;
  /** https://mintdex.fun: the origin bound in on-chain URIs. */
  publicOrigin: string;
  /** Where /img/ answers for this deployment (dev: the local Worker). */
  mediaOrigin: string;
  /** Informational: the browser uses its own build constant PUBLIC_RPC_URL (app env.ts), never this value. */
  publicRpcUrl: string;
  cuPriceMicroLamports: number;
  limits: typeof API_LIMITS;
  syncedSlot: number;
  /**
   * What a launch costs on top of Config.launch_fee and the dev buy (O5): absent from Workers older than O5, so
   * clients keep a fallback constant.
   */
  launchCost?: ApiLaunchCost;
  /**
   * Fix-pack settings (display only; absent from older Workers): attested mode (F1), the tier guard (F6), register flags
   * and the card standards they allow (F9), the outside royalty (F8), and whether the price is delayed (Pyth older than
   * the Config's max age, F3).
   */
  attested?: { minObservers: number; epoch: number; observers: number } | null;
  tierGuard?: boolean;
  registerFlags?: number;
  cardStandards?: ApiCardStandard[];
  outsideRoyaltyBps?: number;
  priceDelayed?: boolean;
  /**
   * Launch-plan §1.6 and §4.5 (absent from Workers older than the mainnet env; display only, the Worker enforces them):
   * the effective launch gate and engine mode after the D1 switch flags, and the early-days exposure caps (decimal
   * lamport strings; null = no cap on that side; the whole field null = caps lifted).
   */
  launches?: ApiLaunchGate;
  engineMode?: ApiEngineMode;
  exposureCaps?: ApiExposureCaps | null;
}

/** The launch gate: everyone, only LAUNCH_ALLOWLIST wallets, or nobody (LAUNCHES_NOT_OPEN). */
export type ApiLaunchGate = "open" | "allowlist" | "closed";
/** "exit": only withdraw_fees, cancel_bid and delist_card build; "off": nothing builds (ENGINE_OFF, details.engine). */
export type ApiEngineMode = "on" | "exit" | "off";
export interface ApiExposureCaps {
  maxBidLamports: Lamports | null;
  maxListPriceLamports: Lamports | null;
}

/** Launch cost estimate (O5, refs/mainnet/design-compat.md §5): rents at the live rent, the Metaplex fee, network fee. */
export interface ApiLaunchCost {
  /** Rents of every account a Metaplex-card launch creates (longest name, symbol and URI) + Metaplex fee + network fee. */
  baseLamports: Lamports;
  /** Added by a dev buy: the coin token account, pump's creator vault (first fee) and volume tracker. */
  devBuyExtraLamports: Lamports;
  /** Metaplex's NFT creation fee inside baseLamports (not refundable). */
  metaplexFeeLamports: Lamports;
  /** "profile": the measured per-cluster constant; "measured": the median of recent landed registrations was higher. */
  source: "profile" | "measured";
  /** Unix seconds of the newest observation behind "measured" (null for "profile"). */
  measuredAt: UnixSeconds | null;
}

export interface ApiHealthResponse {
  cluster: ApiCluster;
  genesisOk: boolean;
  engine: "on" | "off";
  slot: number | null;
  indexer: {
    lastRunAt: UnixSeconds | null;
    lagSlots: number | null;
    backlog: number;
    /** Signatures parked in the last 24 h because their transaction version is newer than the indexer reads (O2). */
    unsupported?: number;
    /** The RPC served the cluster's pinned v1 transaction in the indexer's shape (null: not checked or no probe). */
    txVersionOk?: boolean | null;
  };
  crank: { address: Base58; lamports: Lamports | null; low: boolean };
  vault: { free: number; low: boolean };
  alts: { a: "ok" | "bad" | "unknown"; b: "ok" | "bad" | "unknown" };
  version: string;
  /** Today's metered usage against the daily budget (m3-contract §6.3); null when the meter has no row yet. */
  usage?: ApiUsageToday | null;
}

/** Daily usage meter (usage_daily) next to the budget the Worker plans for (Free plan). */
export interface ApiUsageToday {
  /** UTC yyyy-mm-dd */
  day: string;
  /** metric → count so far today (rpc_credits_engine, rpc_credits_api, d1_rows_written, kv_writes, do_requests, api_requests). */
  counts: Record<string, number>;
  /** metric → daily budget; a metric at 80% raises "alert:budget". */
  budget: Record<string, number>;
}

export interface ApiRevResponse {
  rev: string;
  changed: boolean;
}

export interface ApiHomeResponse {
  featured: ApiCoinSummary[];
  trending: ApiCoinSummary[];
  activity: ApiEvent[];
  stats: { coins: number; cardSales: number; volume24hLamports: Lamports; wallets: number };
  rev: string;
}

export type ApiCoinSort = "trending" | "mcap" | "new" | "next";
export interface ApiCoinListQuery {
  sort?: ApiCoinSort;
  q?: string;
  /** Unlocked level filter 1..14 (0 or absent = all). */
  tier?: number;
  /** Default 50, max 100. */
  limit?: number;
  cursor?: string;
}
export interface ApiCoinListResponse {
  coins: ApiCoinSummary[];
  nextCursor: string | null;
  rev: string;
}

export interface ApiCoinDetailResponse {
  coin: ApiCoinDetail;
  rev: string;
}

export interface ApiTradesQuery {
  before?: string;
  /** Default 50, max 200. */
  limit?: number;
}
export interface ApiTradesResponse {
  trades: ApiTrade[];
  nextCursor: string | null;
}

export type ApiChartRange = "1h" | "24h" | "7d" | "all";
export interface ApiChartResponse {
  mint: Base58;
  range: ApiChartRange;
  /** [unix seconds, market cap lamports], oldest first. */
  points: Array<[UnixSeconds, Lamports]>;
  /** Same as ApiConfig.levelMinMcapLamports (drawn as unlock lines). */
  thresholds: Lamports[];
}

export interface ApiCardResponse {
  card: ApiCardState;
}

export interface ApiMarketResponse {
  listed: ApiCoinSummary[];
  topBids: ApiCoinSummary[];
  sales: ApiSale[];
  rev: string;
}

export interface ApiActivityResponse {
  events: ApiEvent[];
  rev: string;
}

export interface ApiWalletCoin {
  mint: Base58;
  name: string;
  symbol: string;
  image: ApiImage | null;
  amount: TokenAmount;
  valueLamports: Lamports;
  /** Hidden by the operator (see ApiCardState.hidden); the wallet's own holdings still list it. Absent from older Workers. */
  hidden?: boolean;
}
export interface ApiWalletCard {
  coin: ApiCoinSummary;
  listed: boolean;
  withdrawable: Lamports;
  feesPaidOut: Lamports;
}
export interface ApiWallet {
  address: Base58;
  handle: string | null;
  lamports: Lamports;
  coins: ApiWalletCoin[];
  cards: ApiWalletCard[];
  bids: Array<{ bid: ApiBid; coin: ApiCoinSummary }>;
  /** Bids on cards this wallet holds. */
  offers: Array<{ bid: ApiBid; coin: ApiCoinSummary }>;
  listings: ApiListing[];
  totals: { holdingsValueLamports: Lamports; withdrawableLamports: Lamports; escrowedLamports: Lamports };
  syncedAt: UnixSeconds;
}
export interface ApiWalletResponse {
  wallet: ApiWallet;
  /** Whether this wallet may launch now under the launch gate (absent from Workers older than the mainnet env). */
  launchAllowed?: boolean;
}

// ---------------------------------------------------------------- auth (Sign-In With Solana, api/siws.ts)

export interface ApiNonceRequest {
  address: Base58;
}
export interface ApiNonceResponse {
  nonce: string;
  /** The exact UTF-8 text the wallet must sign with solana:signMessage (buildSiwsMessage). */
  message: string;
  issuedAt: string;
  expiresAt: string;
}
export interface ApiVerifyRequest {
  address: Base58;
  message: string;
  /** base64 of the 64-byte Ed25519 signature over utf8(message). */
  signature: string;
}
export interface ApiSession {
  /** Opaque bearer token (send as Authorization: Bearer <token>). */
  token: string;
  address: Base58;
  handle: string | null;
  expiresAt: string;
}
export interface ApiVerifyResponse {
  session: ApiSession;
}
export interface ApiHandleRequest {
  handle: string;
}
export interface ApiHandleResponse {
  address: Base58;
  handle: string;
}
export interface ApiMediaResponse {
  image: ApiImage;
  bytes: number;
  contentType: string;
  sha256: string;
}

// ---------------------------------------------------------------- effects summary (every tx route)

export interface ApiEffectLine {
  label: string;
  lamports?: Lamports;
  tokens?: TokenAmount;
  direction: "out" | "in" | "info";
}

export interface ApiAccountCreated {
  address: Base58;
  label: string;
  rentLamports: Lamports;
}

/**
 * What a transaction does, for the confirm sheet and for the client's cross-check against the SDK verifier's
 * TxSummary (m3-contract.md §7.3). The client never trusts this for safety; it is display plus a consistency check.
 */
export interface ApiEffectsSummary {
  kind: ApiTxKind | "launch";
  /** Plain words, e.g. "Buy HONK". */
  title: string;
  feePayer: Base58;
  lines: ApiEffectLine[];
  /** Upper bound of lamports that can leave the fee payer: amounts + rents + network fee. */
  maxSolOutLamports: Lamports;
  /** Lamports expected back (sale proceeds, fees withdrawn, refunds); "0" when none. */
  expectedSolInLamports: Lamports;
  tokensOut: TokenAmount | null;
  tokensIn: TokenAmount | null;
  rentLamports: Lamports;
  accountsCreated: ApiAccountCreated[];
  /** 5,000 per signature + CU limit × CU price. */
  networkFeeLamports: Lamports;
  programs: Base58[];
  warnings: string[];
}

// ---------------------------------------------------------------- launch (server-first by default)

export type ApiSigningMode = "server_first" | "wallet_first";
export type ApiAltChoice = "A" | "B" | "none";

export interface ApiLaunchPrepareRequest {
  name: string;
  symbol: string;
  description: string;
  /** From POST /media (must belong to the session wallet). */
  imageKey: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  devBuyLamports: Lamports;
  slippageBps: number;
  /** Default server_first; wallet_first after WALLET_REWROTE_TX or per wallet config. */
  mode?: ApiSigningMode;
  /**
   * Card NFT standard the client can verify (card-program-v2 §18.17): "metaplex" = register_card_metaplex (Metaplex
   * metadata + master edition, so wallets list the card as a collectible). Omitted = "token2022" (the original
   * register_card), which is what clients built before §18.17 verify.
   */
  cardStandard?: ApiCardStandard;
}
/**
 * "metaplex-collection": register_card_metaplex verified into the MintDex collection (F8, the mainnet rule);
 * "metaplex": register_card_metaplex; "token2022": the original register_card (§18.17).
 */
export type ApiCardStandard = "token2022" | "metaplex" | "metaplex-collection";
export interface ApiLaunchPrepareResponse {
  intentId: string;
  mint: Base58;
  mode: ApiSigningMode;
  /** server_first: mint signature present, payer slot zeroed; wallet_first: both slots zeroed. */
  tx: TxBase64;
  alt: ApiAltChoice;
  lastValidBlockHeight: number;
  expiresAt: UnixSeconds;
  coinUri: string;
  /** Config.treasury the tx was built with (the client re-reads it from chain). */
  treasury: Base58;
  /** Exact pump buy arguments in the tx; null without a dev buy. */
  devBuy: null | { tokens: TokenAmount; maxSolCost: Lamports };
  /**
   * The register instruction in the tx (§18.17). "metaplex" only when the request asked for it and an ALT is usable
   * (without an ALT a Metaplex launch is over the size limit, so the Worker falls back to "token2022"). Absent from
   * Workers built before §18.17 (= "token2022").
   */
  cardStandard?: ApiCardStandard;
  /**
   * Fix pack (admin B6): the dev buy did not fit in the launch transaction (a collection launch through an unextended
   * lookup table), so the launch goes alone and the client sends this dev buy as a normal buy right after it lands.
   * Absent when the dev buy is inside the launch (or there is none).
   */
  devBuySplit?: { lamports: Lamports; slippageBps: number };
  summary: ApiEffectsSummary;
}
export interface ApiLaunchFinalizeRequest {
  intentId: string;
  /** The wallet-signed tx (all bytes, base64). */
  tx: TxBase64;
}
export interface ApiLaunchFinalizeResponse {
  intentId: string;
  mint: Base58;
  signature: Base58;
  status: "submitted";
}
export type ApiIntentStatus = "prepared" | "submitted" | "confirmed" | "failed" | "expired";
export interface ApiLaunchStatusResponse {
  intentId: string;
  mint: Base58;
  status: ApiIntentStatus;
  signature: Base58 | null;
  error: ApiError | null;
  /** The indexer has the coin and its card (the coin page will load). */
  coinIndexed: boolean;
}

// ---------------------------------------------------------------- tx builds

export interface ApiTxBuyRequest {
  wallet: Base58;
  mint: Base58;
  /**
   * SOL the user wants to spend. The tx buys the tokens quoted for this amount and caps the trade at
   * slippageCeil(solLamports, slippageBps) (pump max_sol_cost / pAMM max_quote_amount_in), pump-sdk's convention.
   */
  solLamports: Lamports;
  slippageBps: number;
}
export interface ApiTxSellRequest {
  wallet: Base58;
  mint: Base58;
  tokenAmount: TokenAmount;
  slippageBps: number;
}
export interface ApiTxCompleteCurveRequest {
  wallet: Base58;
  mint: Base58;
  slippageBps: number;
}
export interface ApiTxWithdrawRequest {
  wallet: Base58;
  mint: Base58;
}
export interface ApiTxCollectRequest {
  wallet: Base58;
  mint: Base58;
}
export interface ApiTxBidRequest {
  wallet: Base58;
  mint: Base58;
  /** New total bid (place, raise or lower). */
  amountLamports: Lamports;
}
export interface ApiTxCancelBidRequest {
  wallet: Base58;
  mint: Base58;
}
/**
 * The seller's own fee-floor inputs (card-program-v2 §18.9, m3-contract §3.6): the floor and the vault-owned WSOL
 * accounts the seller's client read itself from the public RPC. The Worker uses max(its floor, this floor) and the
 * union of the accounts (each re-checked), so a public read newer than the Worker's never fails an honest build.
 */
export interface ApiSellerFloorInput {
  minFeesToSellerLamports?: Lamports;
  /** Non-ATA WSOL token accounts owned by the card vault (never ATA(card_vault, WSOL) itself). */
  extraWsolAccounts?: Base58[];
}
export interface ApiTxAcceptRequest extends ApiSellerFloorInput {
  wallet: Base58;
  mint: Base58;
  bidder: Base58;
  /** The bid amount the seller saw (accept_bid min_amount). */
  minAmountLamports: Lamports;
}
export interface ApiTxListRequest extends ApiSellerFloorInput {
  wallet: Base58;
  mint: Base58;
  priceLamports: Lamports;
  /** 0 = never. */
  expiresAt: UnixSeconds;
  voidOnEvolve: boolean;
}
export interface ApiTxDelistRequest {
  wallet: Base58;
  mint: Base58;
}
export interface ApiTxBuyNowRequest {
  wallet: Base58;
  mint: Base58;
  /** The listing price the buyer saw (buy_now expected_price). */
  expectedPriceLamports: Lamports;
  /** Put cancel_bid first when the buyer has an open bid on this card. */
  cancelOwnBid: boolean;
}

export interface ApiTxRequestMap {
  buy: ApiTxBuyRequest;
  sell: ApiTxSellRequest;
  "complete-curve": ApiTxCompleteCurveRequest;
  withdraw: ApiTxWithdrawRequest;
  collect: ApiTxCollectRequest;
  bid: ApiTxBidRequest;
  "cancel-bid": ApiTxCancelBidRequest;
  accept: ApiTxAcceptRequest;
  list: ApiTxListRequest;
  delist: ApiTxDelistRequest;
  "buy-now": ApiTxBuyNowRequest;
}

/** Trade quote the Worker built the tx from (SDK quote.ts). */
export interface ApiTradeQuote {
  venue: "curve" | "pool";
  /** Exact instruction arguments in the tx. */
  args:
    | { ix: "pump_buy"; amount: TokenAmount; maxSolCost: Lamports }
    | { ix: "pump_sell"; amount: TokenAmount; minSolOutput: Lamports }
    | { ix: "pamm_buy"; baseAmountOut: TokenAmount; maxQuoteAmountIn: Lamports }
    | { ix: "pamm_sell"; baseAmountIn: TokenAmount; minQuoteAmountOut: Lamports };
  expectedTokens: TokenAmount;
  expectedSol: Lamports;
  feeLamports: Lamports;
  creatorFeeLamports: Lamports;
  priceImpactBps: number;
  mcapAfterLamports: Lamports;
}

/** The exact values the Worker used, so the client can rebuild every instruction and verify (m3-contract §7.3). */
export interface ApiTxParamsMap {
  buy: { quote: ApiTradeQuote };
  sell: { quote: ApiTradeQuote };
  "complete-curve": { quote: ApiTradeQuote };
  withdraw: { holderCardAccount: Base58; holderMode: ApiCardState["holderMode"]; extraWsolAccounts: Base58[]; fees: ApiFeeBreakdown };
  collect: { extraWsolAccounts: Base58[]; fees: ApiFeeBreakdown };
  bid: { previousLamports: Lamports; amountLamports: Lamports };
  "cancel-bid": { amountLamports: Lamports };
  accept: {
    launcher: Base58;
    treasury: Base58;
    minAmountLamports: Lamports;
    maxTotalFeeBps: number;
    minFeesToSeller: Lamports;
    extraWsolAccounts: Base58[];
    escrowPath: boolean;
  };
  list: { minFeesToSeller: Lamports; flags: number; reprice: boolean };
  delist: Record<string, never>;
  "buy-now": {
    seller: Base58;
    launcher: Base58;
    treasury: Base58;
    maxTotalFeeBps: number;
    extraWsolAccounts: Base58[];
    cancelOwnBid: boolean;
  };
}

export interface ApiTxBuildResponse<K extends ApiTxKind = ApiTxKind> {
  intentId: string;
  kind: K;
  /** Unsigned v0 tx, fee payer = request.wallet. */
  tx: TxBase64;
  alt: ApiAltChoice;
  lastValidBlockHeight: number;
  expiresAt: UnixSeconds;
  cuLimit: number;
  cuPriceMicroLamports: number;
  simulation: { unitsConsumed: number; logsTail: string[] };
  params: ApiTxParamsMap[K];
  summary: ApiEffectsSummary;
}

export interface ApiTxSubmitRequest {
  intentId: string;
  tx: TxBase64;
}
export interface ApiTxSubmitResponse {
  intentId: string;
  signature: Base58;
  status: "submitted";
}
export interface ApiTxStatusResponse {
  intentId: string;
  signature: Base58 | null;
  status: "built" | "submitted" | "confirmed" | "failed" | "expired";
  err: unknown | null;
  slot: number | null;
}

// ---------------------------------------------------------------- crank queue, rpc, hooks

export interface ApiEvolveQueueResponse {
  mint: Base58;
  queued: boolean;
  reason: "queued" | "already_pending" | "no_level_above" | "paused";
  card: ApiCardState;
}

export interface ApiRpcRequest {
  method: ApiRpcMethod;
  params: unknown[];
}
export interface ApiRpcResponse {
  result: unknown;
}

export interface ApiHeliusHookResponse {
  accepted: number;
}
