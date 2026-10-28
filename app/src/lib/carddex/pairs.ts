import verifiedAssets from "./pair-assets.json";
import { CARD_DESIGNS, isCardDesignKey } from "./designs";
import { DESIGN_QUOTE_KEYS, MEME_PAIR_PRESETS, PREFERRED_PAIR_DESIGNS } from "./design-pairings";

export const PAIR_ASSET_KEYS = ["sol", "usdc", "gmex", "tslax", "nvdax", "aaplx", "mstrx", "coinx", "amc", "doge", "fartcoin", "pnut", "moodeng", "troll", "bonk", "wif", "cards", "sv151", "toad", "pengu", "giga", "spx", "trump", "useless", "chillguy"] as const;
export type PairAssetKey = typeof PAIR_ASSET_KEYS[number];
export type PairAsset = {
  key: PairAssetKey;
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
  kind: "native" | "stable" | "stock" | "meme" | "collector";
  issuer: string | null;
  issuerTerms: string | null;
  listingProvider?: string;
  listingProviderTerms?: string;
  referenceTicker?: string;
  verifiedAt: string;
  verificationSlot: number;
  admission: string;
  /** Reviewed on-chain snapshot for the local demo. Production resolves fresh account state. */
  initialVirtualQuoteReserves: string;
};

export const PAIR_ASSETS: readonly Readonly<PairAsset>[] = Object.freeze(verifiedAssets.map(asset => Object.freeze(asset as PairAsset)));
const BY_KEY = new Map<string, Readonly<PairAsset>>(PAIR_ASSETS.map(asset => [asset.key, asset]));
export const PAIR_ASSETS_SOURCE = "https://pump.fun/docs/custom-pairs";
export const PAIR_ASSETS_VERIFIED_AT = "2026-10-28";

export function isPairAssetKey(value: unknown): value is PairAssetKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/** Unknown identities fail closed; absent legacy values are native SOL. */
export function getPairAsset(key?: string | null): Readonly<PairAsset> {
  const asset = BY_KEY.get(key ?? "sol");
  if (!asset) throw new Error("Choose a supported pump.fun quote asset.");
  return asset;
}

const DESIGN_QUOTES: Readonly<Record<string, PairAssetKey>> = DESIGN_QUOTE_KEYS;

export function boundQuoteForDesign(designKey?: string): Readonly<PairAsset> | null {
  const key = designKey ? DESIGN_QUOTES[designKey] : undefined;
  return key ? getPairAsset(key) : null;
}

export function defaultQuoteForDesign(designKey?: string): Readonly<PairAsset> {
  return boundQuoteForDesign(designKey) ?? getPairAsset("sol");
}

export function allowedQuotesForDesign(designKey?: string): readonly Readonly<PairAsset>[] {
  const bound = boundQuoteForDesign(designKey);
  return bound ? [bound] : PAIR_ASSETS;
}

export function resolveLaunchQuote(designKey: string, input: { quoteAssetKey?: string; quoteMint?: string } = {}): Readonly<PairAsset> {
  if (!isCardDesignKey(designKey)) throw new Error("Choose an available card design.");
  const asset = input.quoteAssetKey === undefined ? defaultQuoteForDesign(designKey) : getPairAsset(input.quoteAssetKey);
  const bound = boundQuoteForDesign(designKey);
  if (bound && bound.key !== asset.key) throw new Error(`This card is paired with ${bound.symbol}. Choose a compatible card finish to change the pair.`);
  if (input.quoteMint !== undefined && input.quoteMint !== asset.mint) throw new Error("The quote mint does not match the selected asset.");
  return asset;
}

export function getTradingPair(ticker: string, quoteKey?: string | null): string {
  return `${ticker.replace(/^\$/, "") || "TOKEN"} / ${getPairAsset(quoteKey).symbol}`;
}

export function preferredDesignForQuote(key: string): string | null {
  return PREFERRED_PAIR_DESIGNS[key] ?? null;
}

/** Optional collector/meme finish presets never rewrite a stored or default quote. */
export function recommendedMemeQuoteForDesign(designKey: string, preferredQuoteKey?: string): Readonly<PairAsset> | null {
  const choices = MEME_PAIR_PRESETS.filter(preset => preset.design === designKey);
  const preset = choices.find(choice => choice.quote === preferredQuoteKey) ?? choices[0];
  return preset ? getPairAsset(preset.quote) : null;
}

/** Matches both permanent bindings and explicitly selectable themed presets. */
export function matchingDesignsForQuote(key: string) {
  const presets = new Set(MEME_PAIR_PRESETS.filter(preset => preset.quote === key).map(preset => String(preset.design)));
  return CARD_DESIGNS.filter(design => boundQuoteForDesign(design.key)?.key === key || presets.has(design.key));
}
