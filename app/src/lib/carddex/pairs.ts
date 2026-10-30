import verifiedAssets from "./pair-assets.json";
import { isCardDesignKey, type CardDesignKey } from "./designs";
import { DESIGN_QUOTE_KEYS, PAIR_DESIGNS } from "./design-pairings";

export const PAIR_ASSET_KEYS = ["sol", "usdc", "gmex", "tslax", "nvdax", "aaplx", "mstrx", "coinx", "amc", "doge", "fartcoin", "pnut", "moodeng", "troll", "bonk", "wif", "cards", "sv151", "toad", "pengu", "giga", "spx", "trump", "useless", "chillguy", "goat", "zerebro", "act", "pippin", "vine", "aura", "michi", "cate", "ansem", "bert", "chillhouse", "usduc"] as const;
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
export const PAIR_ASSETS_VERIFIED_AT = "2026-10-29";

export function isPairAssetKey(value: unknown): value is PairAssetKey {
  return typeof value === "string" && BY_KEY.has(value);
}

/** Unknown identities fail closed; absent legacy values are native SOL. */
export function getPairAsset(key?: string | null): Readonly<PairAsset> {
  const asset = BY_KEY.get(key ?? "sol");
  if (!asset) throw new Error("Choose a supported pump.fun quote asset.");
  return asset;
}

// ---------------------------------------------------------------- the pair picks the card (new launches)

/** The pair a fresh Launch starts on. */
export const DEFAULT_PAIR: PairAssetKey = "sol";

const PAIR_DESIGN: Readonly<Record<string, CardDesignKey>> = PAIR_DESIGNS;
const DESIGN_PAIR = new Map<string, PairAssetKey>(Object.entries(PAIR_DESIGNS).map(([pair, design]) => [design, pair as PairAssetKey]));
// One pair, one design: a second pair on the same design, or a pair without a reviewed asset, stops the module loading.
if (DESIGN_PAIR.size !== PAIR_ASSETS.length || PAIR_ASSETS.some(asset => !PAIR_DESIGN[asset.key])) throw new Error("Every pair needs exactly one card design of its own.");

/** The one card design a pair launches with (null for an unknown pair). */
export function designForPair(key?: string | null): CardDesignKey | null {
  return key && isPairAssetKey(key) ? PAIR_DESIGN[key]! : null;
}

/** The pair a design belongs to; null for the designs no pair names (offered only to coins that already have one). */
export function pairForDesign(designKey?: string | null): Readonly<PairAsset> | null {
  const key = designKey ? DESIGN_PAIR.get(designKey) : undefined;
  return key ? getPairAsset(key) : null;
}

export const UNPAIRED_DESIGN = "This card design is no longer offered for new coins. Pick a pair: its card comes with it.";
const unknownDesign = "Choose an available card design.";

/**
 * What a launch request names, completed and nothing more: a pair alone takes its own design, a design alone (an older
 * link or client) takes its own pair, neither is SOL, and a missing mint is the pair's reviewed mint. It never checks
 * that the two agree (resolveNewLaunchPair does) and never touches a request that names all three.
 */
export function completeLaunchPair(input: { cardTemplate?: string; quoteAssetKey?: string; quoteMint?: string }) {
  let quoteAssetKey = input.quoteAssetKey;
  if (quoteAssetKey === undefined) {
    if (input.cardTemplate === undefined) quoteAssetKey = DEFAULT_PAIR;
    else {
      if (!isCardDesignKey(input.cardTemplate)) throw new Error(unknownDesign);
      const pair = pairForDesign(input.cardTemplate);
      if (!pair) throw new Error(UNPAIRED_DESIGN);
      quoteAssetKey = pair.key;
    }
  }
  const asset = getPairAsset(quoteAssetKey);
  return { cardTemplate: input.cardTemplate ?? designForPair(asset.key)!, quoteAssetKey: asset.key as string, quoteMint: input.quoteMint ?? asset.mint };
}

/**
 * New launches only (the demo launch, the live card composition and a first live prepare): the pair picks the card.
 * The request's design, if it names one, must be that pair's design, and its mint the pair's reviewed mint. Saved
 * launches, coin reads, trades and recovery never come through here: they keep whatever they stored.
 */
export function resolveNewLaunchPair(input: { cardTemplate?: string; quoteAssetKey?: string; quoteMint?: string }): { asset: Readonly<PairAsset>; designKey: CardDesignKey } {
  const fields = completeLaunchPair(input);
  const asset = getPairAsset(fields.quoteAssetKey), designKey = designForPair(asset.key)!;
  if (fields.cardTemplate !== designKey) {
    if (!isCardDesignKey(fields.cardTemplate)) throw new Error(unknownDesign);
    throw new Error(pairForDesign(fields.cardTemplate) ? `The ${asset.symbol} pair comes with its own card. Pick a pair and its card comes with it.` : UNPAIRED_DESIGN);
  }
  if (fields.quoteMint !== asset.mint) throw new Error("The quote mint does not match the selected asset.");
  return { asset, designKey };
}

// ---------------------------------------------------------------- stored coins and saved launches (unchanged rules)

const DESIGN_QUOTES: Readonly<Record<string, PairAssetKey>> = DESIGN_QUOTE_KEYS;

/** A stored design's permanent quote binding (stock and three meme finishes), for reads of coins that carry it. */
export function boundQuoteForDesign(designKey?: string): Readonly<PairAsset> | null {
  const key = designKey ? DESIGN_QUOTES[designKey] : undefined;
  return key ? getPairAsset(key) : null;
}

/** A stored row with no quote key: its bound quote, else SOL (legacy coins only; new launches use designForPair). */
export function defaultQuoteForDesign(designKey?: string): Readonly<PairAsset> {
  return boundQuoteForDesign(designKey) ?? getPairAsset("sol");
}

/** The quotes a stored coin of this design may carry (every reviewed asset unless the design is bound). */
export function allowedQuotesForDesign(designKey?: string): readonly Readonly<PairAsset>[] {
  const bound = boundQuoteForDesign(designKey);
  return bound ? [bound] : PAIR_ASSETS;
}

/**
 * The identity check every launch record passes, before and after this change: a known design, a reviewed quote, the
 * design's permanent binding and the exact mint. Saved launches prepared before the pair picked the card are
 * re-prepared and recovered through this (and the pump.fun adapter), so it must keep accepting every combination it
 * accepted then. New launches pass resolveNewLaunchPair as well.
 */
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
