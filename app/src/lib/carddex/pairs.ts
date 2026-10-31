import verifiedAssets from "./pair-assets.json";
import { isCardDesignKey, type CardDesignKey } from "./designs";
import { DESIGN_QUOTE_KEYS, PAIR_DESIGNS, PAIR_DESIGNS_2026_10_30, SOL_DESIGN_OPTIONS } from "./design-pairings";
import { HELD_PAIR_DESIGNS, WITHHELD_PAIR_DESIGNS } from "./pair-designs";

export const PAIR_ASSET_KEYS = ["sol", "usdc", "gmex", "tslax", "nvdax", "aaplx", "mstrx", "coinx", "amc", "doge", "fartcoin", "pnut", "moodeng", "troll", "bonk", "wif", "cards", "sv151", "toad", "pengu", "giga", "spx", "trump", "useless", "chillguy", "goat", "zerebro", "act", "pippin", "vine", "aura", "michi", "cate", "ansem", "bert", "chillhouse", "usduc", "wbtc", "eth", "hype", "zec", "near", "xrp", "xmr", "sui", "arb", "aave", "uni", "tao", "peaq", "mon", "cashcat", "neet", "otc", "fone", "buttcoin", "triplet", "cupsey", "alon", "jimothy", "lmao", "bobo", "tokabu", "manifest", "baton", "claw", "67", "zauth", "kins", "percolator", "jotchua", "zcat", "gork", "stonk", "solangeles", "paid", "pepe", "jeanphil", "pill", "biketyson", "npc", "wojak", "eacc", "hodl", "agency", "claudia", "shib", "swordcat", "plague", "pump", "alch", "pumpcade", "codec", "ape", "link", "ore", "skr"] as const;
export type PairAssetKey = typeof PAIR_ASSET_KEYS[number];
export type PairAsset = {
  key: PairAssetKey;
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  tokenProgram: string;
  kind: "native" | "stable" | "stock" | "meme" | "collector" | "crypto";
  issuer: string | null;
  issuerTerms: string | null;
  listingProvider?: string;
  listingProviderTerms?: string;
  referenceTicker?: string;
  verifiedAt: string;
  verificationSlot: number;
  admission: string;
  /** Admitted by pump.fun's program on-chain but missing from its dated public pairs table (Codex, 30 October 2026). */
  listingStatus?: "direct-onchain";
  listingNotice?: string;
  /**
   * A dated snapshot (Codex's 28 and 30 October reviews) for the local demo's math and Discover's trending order. The
   * live path never reads it: preparePumpLaunchPlan uses the chain's QuoteControl values, which have moved since (from
   * -18.5% to +28.3% at slot 463274173), so nothing live may compare against it.
   */
  initialVirtualQuoteReserves: string;
};

export const PAIR_ASSETS: readonly Readonly<PairAsset>[] = Object.freeze(verifiedAssets.map(asset => Object.freeze(asset as PairAsset)));
const BY_KEY = new Map<string, Readonly<PairAsset>>(PAIR_ASSETS.map(asset => [asset.key, asset]));
export const PAIR_ASSETS_SOURCE = "https://pump.fun/docs/custom-pairs";
export const PAIR_ASSETS_VERIFIED_AT = "2026-10-30";

/** A pair pump.fun's program admits on-chain that its dated public pairs table does not list. */
export function isDirectPair(asset: Readonly<PairAsset>): boolean {
  return asset.listingStatus === "direct-onchain";
}

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

const PAIR_DESIGN: Readonly<Partial<Record<string, CardDesignKey>>> = PAIR_DESIGNS;
/** The pair whose designs SOL_DESIGN_OPTIONS lists: the one pair with more than one design. */
const MANY_DESIGNS_PAIR = "sol";
/** Each offered pair's designs, its main one first: SOL's options; every other pair its one design. */
const PAIR_DESIGN_LISTS: Readonly<Partial<Record<string, readonly CardDesignKey[]>>> = Object.freeze(Object.fromEntries(
  Object.entries(PAIR_DESIGNS).map(([pair, design]) => [pair, Object.freeze(pair === MANY_DESIGNS_PAIR ? [...SOL_DESIGN_OPTIONS] : [design!])]),
));
const DESIGN_PAIR = new Map<string, PairAssetKey>(Object.entries(PAIR_DESIGN_LISTS).flatMap(([pair, designs]) => designs!.map(design => [design, pair as PairAssetKey] as const)));
const LISTED_DESIGNS = Object.values(PAIR_DESIGN_LISTS).reduce((n, designs) => n + designs!.length, 0);
/**
 * Checked at module load (a broken list stops the app and the tests): every offered pair is a registry pair with an
 * installed design; SOL's options start with its main design and are installed design keys, none held, withheld or
 * bound to another quote for good; and no design belongs to two pairs, so every pair but SOL has one design no other
 * pair uses.
 */
export function pairDesignProblems(): string[] {
  const problems: string[] = [];
  for (const [pair, design] of Object.entries(PAIR_DESIGNS)) {
    if (!BY_KEY.has(pair)) problems.push(`${pair}: not a registry pair`);
    if (!isCardDesignKey(design)) problems.push(`${pair}: ${design} is not an installed design`);
  }
  if (PAIR_DESIGNS[MANY_DESIGNS_PAIR] !== SOL_DESIGN_OPTIONS[0]) problems.push("SOL's options must start with its main design");
  for (const design of SOL_DESIGN_OPTIONS) {
    if (!isCardDesignKey(design)) problems.push(`${design}: not an installed design`);
    if (Object.hasOwn(HELD_PAIR_DESIGNS, design) || (WITHHELD_PAIR_DESIGNS as readonly string[]).includes(design)) problems.push(`${design}: held or withheld`);
    const bound = DESIGN_QUOTE_KEYS[design];
    if (bound && bound !== MANY_DESIGNS_PAIR) problems.push(`${design}: bound to ${bound}`);
  }
  if (new Set(SOL_DESIGN_OPTIONS).size !== SOL_DESIGN_OPTIONS.length) problems.push("SOL's options name a design twice");
  if (DESIGN_PAIR.size !== LISTED_DESIGNS) problems.push("a design belongs to two pairs");
  return problems;
}
if (pairDesignProblems().length) {
  throw new Error(`Every offered pair needs its own card designs: ${pairDesignProblems().join("; ")}.`);
}

/** The pairs offered for new launches: those PAIR_DESIGNS gives a design (not AAVE and UNI, nor the held 67, AGENCY...). */
export const OFFERED_PAIRS: readonly Readonly<PairAsset>[] = Object.freeze(PAIR_ASSETS.filter(asset => PAIR_DESIGN[asset.key]));
export function isOfferedPair(key?: string | null): boolean {
  return !!key && isPairAssetKey(key) && !!PAIR_DESIGN[key];
}
/**
 * The pairs coins can trade in, so the demo funds them: every offered pair, and every pair offered before (a coin keeps
 * its pair). Pairs never offered in a release (AAVE, UNI and the held 67, AGENCY, ALON, HODL, JEANPHIL, CLAUDIA,
 * BIKETYSON, NEET) are left out.
 */
export const TRADED_PAIRS: readonly Readonly<PairAsset>[] = Object.freeze(PAIR_ASSETS.filter(asset => PAIR_DESIGN[asset.key] || asset.key in PAIR_DESIGNS_2026_10_30));
export const NOT_OFFERED_PAIR = "That pair is not offered yet. Pick another pair.";

/**
 * Offered pairs whose Token-2022 mint charges a transfer fee (ZCAT: 3%, in the reviewed 30 October mainnet fixtures).
 * The pump.fun adapter cannot price a buy with the fee and refuses them at prepare, so a mainnet launch on one is
 * refused before anything is uploaded (live validation.server.ts requireNewLaunchPair). The demo is unaffected. The
 * adapter's prepare tests read this list and prove it against the fixtures.
 */
export const TRANSFER_FEE_PAIRS: readonly PairAssetKey[] = Object.freeze(["zcat"] as PairAssetKey[]);
export const TRANSFER_FEE_PAIR = "Mainnet launches can't use this pair yet: its mint charges a transfer fee. Pick another pair.";
export const chargesTransferFee = (key?: string | null) => !!key && (TRANSFER_FEE_PAIRS as readonly string[]).includes(key);
/**
 * Direct pairs (isDirectPair) whose mainnet launches the owner has confirmed. Until a key is added here a mainnet launch
 * on a direct pair is refused before anything is uploaded (readiness audit, 30 October 2026: pump.fun's dated public
 * table leaves them out, so its site support can't be checked from the chain, and none has had a real mainnet create).
 * One key opens one pair. The demo is unaffected.
 */
export const CONFIRMED_DIRECT_PAIRS: readonly PairAssetKey[] = Object.freeze([] as PairAssetKey[]);
const FEE_HOLD = "Mainnet launches can't use this pair yet: its mint charges a transfer fee.";
const DIRECT_HOLD = "Mainnet launches can't use this pair yet: it isn't on pump.fun's public pairs list.";
export const DIRECT_PAIR_HELD = `${DIRECT_HOLD} Pick another pair.`;
/**
 * Why a new mainnet launch can't use this pair yet (the live pair panel's line), or null. New launches only: the live
 * composition, a first prepare, the size check and the panel refuse with mainnetPairRefusal before any upload. Saved
 * launches, reads and trades keep their pair.
 */
export function mainnetPairHold(key?: string | null): string | null {
  if (chargesTransferFee(key)) return FEE_HOLD;
  const asset = key ? BY_KEY.get(key) : undefined;
  return asset && isDirectPair(asset) && !(CONFIRMED_DIRECT_PAIRS as readonly string[]).includes(asset.key) ? DIRECT_HOLD : null;
}
export function mainnetPairRefusal(key?: string | null): string | null {
  const hold = mainnetPairHold(key);
  return hold ? `${hold} Pick another pair.` : null;
}

/** The main card design a pair launches with (null for an unknown pair or one not offered yet). */
export function designForPair(key?: string | null): CardDesignKey | null {
  return key && isPairAssetKey(key) ? PAIR_DESIGN[key] ?? null : null;
}

/**
 * Every design a new launch on this pair may take, its main design first: SOL's options (SOL_DESIGN_OPTIONS), any
 * other offered pair's one design, or none for an unknown pair or one not offered.
 */
export function designsForPair(key?: string | null): readonly CardDesignKey[] {
  return (key && isPairAssetKey(key) ? PAIR_DESIGN_LISTS[key] : undefined) ?? [];
}

/** The pair a design belongs to (any of SOL's options is SOL's); null for the designs no pair offers (kept by coins that already have one). */
export function pairForDesign(designKey?: string | null): Readonly<PairAsset> | null {
  const key = designKey ? DESIGN_PAIR.get(designKey) : undefined;
  return key ? getPairAsset(key) : null;
}

export const UNPAIRED_DESIGN = "This card design is no longer offered for new coins. Pick a pair: its card comes with it.";
/** A SOL option sent with another pair. */
export const solOnlyDesign = (symbol: string) => `That card design is for the SOL pair only. The ${symbol} pair comes with its own card.`;
const unknownDesign = "Choose an available card design.";

/**
 * What a launch request names, completed and nothing more: a pair alone takes its main design, a design alone (an older
 * link or client) takes its own pair (any SOL option, SOL), neither is SOL, and a missing mint is the pair's reviewed mint. It never checks
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
  let cardTemplate = input.cardTemplate;
  if (cardTemplate === undefined) {
    const design = designForPair(asset.key);
    if (!design) throw new Error(NOT_OFFERED_PAIR);
    cardTemplate = design;
  }
  return { cardTemplate, quoteAssetKey: asset.key as string, quoteMint: input.quoteMint ?? asset.mint };
}

/**
 * New launches only (the demo launch, the live card composition and a first live prepare): the pair picks the card.
 * The request's design, if it names one, must be one of that pair's designs (designsForPair: SOL's options, any other
 * pair's one design; none named is the main one), and its mint the pair's reviewed mint. Saved launches, coin reads,
 * trades and recovery never come through here: they keep whatever they stored.
 */
export function resolveNewLaunchPair(input: { cardTemplate?: string; quoteAssetKey?: string; quoteMint?: string }): { asset: Readonly<PairAsset>; designKey: CardDesignKey } {
  const fields = completeLaunchPair(input);
  const asset = getPairAsset(fields.quoteAssetKey), designs = designsForPair(asset.key);
  if (!designs.length) throw new Error(NOT_OFFERED_PAIR);
  const designKey = designs.find(design => design === fields.cardTemplate);
  if (!designKey) {
    if (!isCardDesignKey(fields.cardTemplate)) throw new Error(unknownDesign);
    const owner = pairForDesign(fields.cardTemplate);
    throw new Error(!owner ? UNPAIRED_DESIGN : owner.key === MANY_DESIGNS_PAIR ? solOnlyDesign(asset.symbol) : `The ${asset.symbol} pair comes with its own card. Pick a pair and its card comes with it.`);
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
