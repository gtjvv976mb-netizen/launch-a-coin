export type LiveStage = "prepared" | "token_pending" | "nft_pending" | "complete" | "abandoned";
export type LiveAsset = { sha256: string; url: string; mimeType: string; bytes: number };
export type LiveAssets = { artwork: LiveAsset; cardImage: LiveAsset; caseImage: LiveAsset };
export type LivePrepareInput = {
  idempotencyKey: string; tokenMint: string; nftMint: string;
  name: string; symbol: string; description: string; website?: string; xUrl?: string; cardTemplate: string;
  quoteAssetKey: string; quoteMint: string; initialBuyQuoteBaseUnits: string; slippageBps: number;
  assets: LiveAssets; termsAcknowledged: true;
};
export type LiveComposeInput = Pick<LivePrepareInput, "tokenMint" | "name" | "symbol" | "description" | "website" | "xUrl" | "cardTemplate" | "quoteAssetKey" | "quoteMint">;
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
};
/**
 * `unsendable`: the server did not send this signed transaction and never will, so its stage is prepared again.
 * `expired`: that refusal was the wallet approval's blockhash running out, so the page can prepare and ask once more.
 */
export type LiveResult<T extends object = object> = ({ok: true} & T) | {ok: false; error: string; unsendable?: true; expired?: true};
/** Solana's packet limit for one signed transaction. Launch transactions use no lookup tables. */
export const LIVE_PACKET_LIMIT = 1232;
