import type { CardDesignKey } from "./designs";
import type { PairAssetKey } from "./pairs";
import { ACTIVE_PAIR_DESIGNS, HELD_PAIR_DESIGNS } from "./pair-designs";

/**
 * Permanent design bindings that coins and saved launches already carry (the stock finishes and three meme finishes).
 * Reads, trades and saved-launch recovery check a stored design against these; they never change.
 */
export const LEGACY_DESIGN_QUOTE_KEYS = Object.freeze({
  "stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax",
  "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx",
  gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx",
  doge: "doge", bonk: "bonk", wif: "wif",
} as const);

/**
 * Every permanent design binding: the legacy ones above, plus each installed pair identity design (Codex, 30 October
 * 2026) bound to its own pair for good (pair-sol, pair-usdc and the held ones included, though no pair offers them).
 */
export const DESIGN_QUOTE_KEYS: Readonly<Record<string, PairAssetKey>> = Object.freeze({
  ...LEGACY_DESIGN_QUOTE_KEYS,
  ...Object.fromEntries(ACTIVE_PAIR_DESIGNS.map(design => [design.key, design.quoteKey as PairAssetKey])),
});

/**
 * History: the map new launches used from the pair-picks-the-card change until the identity designs (30 October 2026),
 * and the one production offers today. Old /launch?design= links resolve through it, so they keep their pair (design
 * "pepe" was TOAD's, "doge" DOGE's).
 */
export const PAIR_DESIGNS_2026_10_30 = Object.freeze({
  sol: "one-piece", usdc: "duel-masters",
  gmex: "stock-gme", tslax: "stock-tsla", nvdax: "stock-nvda",
  aaplx: "stock-aapl", mstrx: "stock-mstr", coinx: "stock-coin",
  amc: "amc", doge: "doge", bonk: "bonk", wif: "wif",
  cards: "obsidian-archive", sv151: "pokemon-classic", toad: "pepe",
  fartcoin: "ember", pnut: "relic", moodeng: "tide", troll: "neon-circuit",
  pengu: "frost", giga: "mythic", spx: "celestial", trump: "regal",
  useless: "wildtype", chillguy: "aurora",
  goat: "apex", zerebro: "astral", act: "yugioh-spell", pippin: "bloom",
  vine: "magic-etched", aura: "nova", michi: "spark", cate: "ronin",
  ansem: "sovereign", bert: "legend", chillhouse: "abyssal", usduc: "surge",
} as const satisfies Readonly<Partial<Record<PairAssetKey, CardDesignKey>>>);

/**
 * The owner's identity rule (30 October 2026), before the content holds: SOL keeps One Piece and USDC keeps Duel
 * Masters (the owner's choice); every other pair with a finished identity design takes its own. AAVE and UNI are
 * missing: Codex left them no finished card (pair-designs.ts WITHHELD_PAIR_DESIGNS).
 */
export const PAIR_IDENTITY_DESIGNS: Readonly<Partial<Record<PairAssetKey, CardDesignKey>>> = Object.freeze({
  sol: "one-piece", usdc: "duel-masters", gmex: "pair-gmex", tslax: "pair-tslax", nvdax: "pair-nvdax",
  aaplx: "pair-aaplx", mstrx: "pair-mstrx", coinx: "pair-coinx", amc: "pair-amc", doge: "pair-doge",
  fartcoin: "pair-fartcoin", pnut: "pair-pnut", moodeng: "pair-moodeng", troll: "pair-troll",
  bonk: "pair-bonk", wif: "pair-wif", cards: "pair-cards", sv151: "pair-sv151", toad: "pair-toad",
  pengu: "pair-pengu", giga: "pair-giga", spx: "pair-spx", trump: "pair-trump", useless: "pair-useless",
  chillguy: "pair-chillguy", goat: "pair-goat", zerebro: "pair-zerebro", act: "pair-act",
  pippin: "pair-pippin", vine: "pair-vine", aura: "pair-aura", michi: "pair-michi", cate: "pair-cate",
  ansem: "pair-ansem", bert: "pair-bert", chillhouse: "pair-chillhouse", usduc: "pair-usduc",
  wbtc: "pair-wbtc", eth: "pair-eth", hype: "pair-hype", zec: "pair-zec", near: "pair-near", xrp: "pair-xrp",
  xmr: "pair-xmr", sui: "pair-sui", arb: "pair-arb", tao: "pair-tao", peaq: "pair-peaq", mon: "pair-mon",
  cashcat: "pair-cashcat", neet: "pair-neet", otc: "pair-otc", fone: "pair-fone", buttcoin: "pair-buttcoin",
  triplet: "pair-triplet", cupsey: "pair-cupsey", alon: "pair-alon", jimothy: "pair-jimothy",
  lmao: "pair-lmao", bobo: "pair-bobo", tokabu: "pair-tokabu", manifest: "pair-manifest", baton: "pair-baton",
  claw: "pair-claw", "67": "pair-67", zauth: "pair-zauth", kins: "pair-kins", percolator: "pair-percolator",
  jotchua: "pair-jotchua", zcat: "pair-zcat", gork: "pair-gork", stonk: "pair-stonk",
  solangeles: "pair-solangeles", paid: "pair-paid", pepe: "pair-pepe", jeanphil: "pair-jeanphil",
  pill: "pair-pill", biketyson: "pair-biketyson", npc: "pair-npc", wojak: "pair-wojak", eacc: "pair-eacc",
  hodl: "pair-hodl", agency: "pair-agency", claudia: "pair-claudia", shib: "pair-shib",
  swordcat: "pair-swordcat", plague: "pair-plague", pump: "pair-pump", alch: "pair-alch",
  pumpcade: "pair-pumpcade", codec: "pair-codec", ape: "pair-ape", link: "pair-link", ore: "pair-ore",
  skr: "pair-skr",
});

/**
 * The full release's map (claude/pair-identities): the identity rule above with the content holds applied
 * (pair-designs.ts HELD_PAIR_DESIGNS), so a held identity's pair launches with the design the hold names, or is not
 * offered when it names none. This release step does not offer it (PAIR_DESIGNS below).
 */
export const IDENTITY_RELEASE_PAIR_DESIGNS: Readonly<Partial<Record<PairAssetKey, CardDesignKey>>> = Object.freeze(Object.fromEntries(
  Object.entries(PAIR_IDENTITY_DESIGNS).flatMap(([pair, design]) => {
    if (!Object.hasOwn(HELD_PAIR_DESIGNS, design!)) return [[pair, design]];
    const live = HELD_PAIR_DESIGNS[design!];
    return live ? [[pair, live as CardDesignKey]] : [];
  }),
));

/**
 * The pair picks the card (owner, 30 October 2026): every offered pair has exactly one design, and a new launch always
 * takes its pair's design. This map is the one source of truth for that (pairs.ts designForPair and pairForDesign read
 * it). A pair missing here is not offered for new launches; designs no pair names here are not offered either, and
 * coins that already have one keep it.
 *
 * Release step (rollback target, 30 October 2026): new launches get exactly what production offers today, its 37 pairs
 * with their production designs, while the code and registries of the full release stay, so this build reads and
 * renders every pair-* design, quote key and demo balance the full release can create. The full release sets this to
 * IDENTITY_RELEASE_PAIR_DESIGNS.
 */
export const PAIR_DESIGNS: Readonly<Partial<Record<PairAssetKey, CardDesignKey>>> = PAIR_DESIGNS_2026_10_30;

/**
 * Historical: the design and pair combinations the earlier separate chooser offered (before 30 October 2026). Coins
 * and saved launches may carry any of them (or any other design with SOL), and reads, trades and recovery keep them
 * exactly as stored. Nothing offers them for a new launch; tests use them to prove that.
 */
export const MEME_PAIR_PRESETS = Object.freeze([
  {design:"obsidian-archive",quote:"cards"},
  {design:"pokemon-classic",quote:"sv151"},
  {design:"pokemon-full-art",quote:"sv151"},
  {design:"pokemon-classic",quote:"cards"},
  {design:"pokemon-full-art",quote:"cards"},
  {design:"pepe",quote:"toad"},
  {design:"doge",quote:"doge"},
  {design:"bonk",quote:"bonk"},
  {design:"wif",quote:"wif"},
  {design:"ember",quote:"fartcoin"},
  {design:"relic",quote:"pnut"},
  {design:"tide",quote:"moodeng"},
  {design:"neon-circuit",quote:"troll"},
  {design:"frost",quote:"pengu"},
  {design:"mythic",quote:"giga"},
  {design:"celestial",quote:"spx"},
  {design:"regal",quote:"trump"},
  {design:"wildtype",quote:"useless"},
  {design:"aurora",quote:"chillguy"},
  {design:"apex",quote:"goat"},
  {design:"astral",quote:"zerebro"},
  {design:"yugioh-spell",quote:"act"},
  {design:"bloom",quote:"pippin"},
  {design:"magic-etched",quote:"vine"},
  {design:"nova",quote:"aura"},
  {design:"spark",quote:"michi"},
  {design:"ronin",quote:"cate"},
  {design:"sovereign",quote:"ansem"},
  {design:"legend",quote:"bert"},
  {design:"abyssal",quote:"chillhouse"},
  {design:"surge",quote:"usduc"},
] as const);
