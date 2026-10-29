export type LiveStage = "prepared" | "token_pending" | "nft_pending" | "complete" | "abandoned";
export type LiveAsset = { sha256: string; url: string; mimeType: string; bytes: number };
// Token media is server-derived on new preparation. Historical immutable intents have only the original three assets.
export type LiveAssets = { artwork: LiveAsset; cardImage: LiveAsset; caseImage: LiveAsset; tokenImage?: LiveAsset; tokenPoster?: LiveAsset };
export type LivePrepareInput = {
  idempotencyKey: string; tokenMint: string; nftMint: string;
  name: string; symbol: string; description: string; website?: string; xUrl?: string; cardTemplate: string;
  quoteAssetKey: string; quoteMint: string; initialBuyQuoteBaseUnits: string; slippageBps: number;
  assets: LiveAssets; termsAcknowledged: true;
};
export type LiveComposeInput = Pick<LivePrepareInput, "tokenMint" | "name" | "symbol" | "description" | "website" | "xUrl" | "cardTemplate" | "quoteAssetKey" | "quoteMint">;
export type { WalletTransactionPlan } from "../../../../../integrations/pumpfun/src/live";
export type LiveReadiness = {
  implemented: true; configured: boolean; enabled: boolean; ready: boolean;
  network: "solana-mainnet-beta"; publicOrigin: string | null; blockers: string[];
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
export type LiveResult<T extends object = object> = ({ok: true} & T) | {ok: false; error: string};
