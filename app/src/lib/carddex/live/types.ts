import type { LiveXAnnounce } from "./x-announce";

export type LiveStage = "prepared" | "token_pending" | "nft_pending" | "complete" | "abandoned";
export type LiveAsset = { sha256: string; url: string; mimeType: string; bytes: number };
// Token media is server-derived on new preparation. Historical immutable intents have only the original three assets.
export type LiveAssets = { artwork: LiveAsset; cardImage: LiveAsset; caseImage: LiveAsset; tokenImage?: LiveAsset; tokenPoster?: LiveAsset };
export type LivePrepareInput = {
  idempotencyKey: string; tokenMint: string; nftMint: string;
  name: string; symbol: string; description: string; website?: string; xUrl?: string; cardTemplate: string;
  quoteAssetKey: string; quoteMint: string; initialBuyQuoteBaseUnits: string; slippageBps: number;
  assets: LiveAssets; termsAcknowledged: true;
  /**
   * Also prepare the card transaction now, for a wallet that approves the coin and its card in one prompt. Not part of
   * the launch's identity: the same request with or without it is the same launch.
   */
  withCard?: boolean;
  /**
   * The creator fee split chosen at launch (1 to 7 Solana wallets, whole basis points adding to 10,000), set by its own
   * creator-only transaction after the card. Not part of the launch's identity either: it is saved beside the launch
   * (live_fee_shares), never in its payload or binding.
   */
  feeShares?: LiveFeeRecipient[];
  /**
   * "Announce my coin on @launchacard": saved beside the launch (live_x_optins) while announcements are on, never in
   * its payload or binding. The post is made after the card is confirmed.
   */
  announceOnX?: boolean;
};
export type LiveFeeRecipient = { address: string; bps: number };
export type LiveFeeShareStatus = "requested" | "prepared" | "pending" | "complete" | "set_elsewhere" | "skipped" | "failed";
/** A launch's creator fee split as saved: what was chosen, where it stands, and (set_elsewhere) the split on chain. */
export type LiveFeeShare = { status: LiveFeeShareStatus; recipients: LiveFeeRecipient[]; signature: string | null; error: string | null; onChain?: LiveFeeRecipient[] };
export type LiveComposeInput = Pick<LivePrepareInput, "tokenMint" | "name" | "symbol" | "description" | "website" | "xUrl" | "cardTemplate" | "quoteAssetKey" | "quoteMint">;
/** A prepare request as the server accepts it: the pair alone names the card (an older client also sends the design). */
export type LivePrepareRequest = Omit<LivePrepareInput, "cardTemplate" | "quoteAssetKey" | "quoteMint"> & Partial<Pick<LivePrepareInput, "cardTemplate" | "quoteAssetKey" | "quoteMint">>;
export type { WalletTransactionPlan } from "../../../../../integrations/pumpfun/src/live";
export type LiveReadiness = {
  implemented: true; configured: boolean;
  /** New launches: the switch, and switched on with everything configured. */
  enabled: boolean; ready: boolean;
  /** Existing launches (sign-in, confirmations, the card stage, discards): the switch, and ready to serve. */
  recoveryEnabled: boolean; recoveryReady: boolean;
  network: "solana-mainnet-beta"; publicOrigin: string | null; blockers: string[];
  /** Wallet names (Wallet Standard `name`, any case) that sign before this page co-signs; "*" is every wallet. */
  walletFirst: string[];
  /** Wallet names that approve the coin and its card in one prompt (multi-input solana:signTransaction). Never Phantom. */
  walletBatch: string[];
  /** The optional creator fee split (CARDDEX_LIVE_FEE_SHARING="true", with recovery ready). Absent means off. */
  feeSharing?: boolean;
  /** Announcements on @launchacard (CARDDEX_X_AUTOPOST="true" with its secrets, and recovery ready). Absent means off. */
  xAnnounce?: boolean;
};
export type LiveWallet = { wallet: string; expiresAt: number };
export type LiveLaunchIntent = {
  id: string; creatorWallet: string; tokenMint: string; nftMint: string;
  name: string; symbol: string; description: string; website?: string; xUrl?: string;
  quoteAssetKey: string; quoteMint: string; cardTemplate: string; status: LiveStage;
  bindingSha256: string; initialBuyQuoteBaseUnits: string; nftMetadataSha256: string;
  tokenMetadataUri: string; nftMetadataUri: string; assets: LiveAssets;
  tokenSignature: string | null; nftSignature: string | null;
  createdAt: number; updatedAt: number;
  /**
   * The card the wallet approved together with the coin, saved before the coin was sent (getLiveLaunchIntent only):
   * the plan id and the exact signed bytes the relay sends once the coin is verified. Null when none is saved for the
   * current card address; absent from other responses.
   */
  approvedCard?: LiveApprovedCard | null;
  /**
   * Set by getLiveLaunchIntent when the saved launch could not be confirmed as it stands (it never throws for a chain
   * problem, so a saved launch always loads and can be discarded or prepared again). Absent when the check found nothing
   * to say or was not run.
   */
  chainCheck?: LiveChainCheck;
  /** The creator fee split chosen with this launch; absent when none was chosen. */
  feeShare?: LiveFeeShare;
  /** The announcement on @launchacard the creator asked for; absent when they did not. */
  xAnnounce?: LiveXAnnounce;
};
/**
 * What the last chain check of a saved launch found. "failed-on-chain": its transaction landed and failed, so nothing
 * was created. "expired-unlanded": its saved transaction can no longer land and never did. Both can be prepared again
 * with the same keys (or discarded) once the server proves nothing can still land. "unchecked": Solana could not be
 * checked now; the launch is unchanged.
 */
export type LiveChainCheck = { state: "failed-on-chain" | "expired-unlanded" | "unchecked"; kind: "token" | "nft"; reason: string };
export type LiveApprovedCard = { messageSha256: string; transactionBase64: string; nftMint: string };
/**
 * `unsendable`: the server did not send this signed transaction and never will, so its stage is prepared again.
 * `expired`: that refusal was the wallet approval's blockhash running out, so the page can prepare and ask once more.
 */
export type LiveResult<T extends object = object> = ({ok: true} & T) | {ok: false; error: string; unsendable?: true; expired?: true};
/** Solana's packet limit for one signed transaction. Launch transactions use no lookup tables. */
export const LIVE_PACKET_LIMIT = 1232;
