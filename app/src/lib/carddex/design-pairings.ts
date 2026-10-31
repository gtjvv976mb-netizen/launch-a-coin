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
 * 2026) bound to its own pair for good (pair-usdc and the held ones included, though no pair offers them).
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
 * The owner's identity rule (30 October 2026), before the content holds: USDC keeps Duel Masters (the owner's choice);
 * every other pair with a finished identity design takes its own. SOL's own card, pair-sol, is its main design since
 * 31 October 2026 (SOL_DESIGN_OPTIONS below lists the others it offers). AAVE and UNI are missing: Codex left them no
 * finished card (pair-designs.ts WITHHELD_PAIR_DESIGNS).
 */
export const PAIR_IDENTITY_DESIGNS: Readonly<Partial<Record<PairAssetKey, CardDesignKey>>> = Object.freeze({
  sol: "pair-sol", usdc: "duel-masters", gmex: "pair-gmex", tslax: "pair-tslax", nvdax: "pair-nvdax",
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
 * The pair picks the card (owner, 30 October 2026): every offered pair has one design of its own, and a new launch
 * takes its pair's design (SOL alone offers more: SOL_DESIGN_OPTIONS). This map gives each pair's main design (pairs.ts
 * designForPair, designsForPair and pairForDesign read it): the identity rule above with the content holds applied (pair-designs.ts HELD_PAIR_DESIGNS), so a held identity's
 * pair launches with the design the hold names, or is not offered when it names none. A pair missing here is not
 * offered for new launches. Designs no pair names here, and SOL_DESIGN_OPTIONS leaves out, are not offered either;
 * coins that already have one keep it.
 */
export const PAIR_DESIGNS: Readonly<Partial<Record<PairAssetKey, CardDesignKey>>> = Object.freeze(Object.fromEntries(
  Object.entries(PAIR_IDENTITY_DESIGNS).flatMap(([pair, design]) => {
    if (!Object.hasOwn(HELD_PAIR_DESIGNS, design!)) return [[pair, design]];
    const live = HELD_PAIR_DESIGNS[design!];
    return live ? [[pair, live as CardDesignKey]] : [];
  }),
));

/**
 * SOL's designs (owner, 31 October 2026: "the SOL pair card designs would be many, but the main design is the SOL card
 * design, so every token pair will have their own distinct and unique design, except for SOL, with many designs").
 * SOL's own card first (its main design, PAIR_DESIGNS.sol), then One Piece (SOL's design until then), then every
 * installed design no other pair uses, in the catalogue's order. A new SOL launch may take any of them; no other pair
 * may. pairs.ts checks at module load that they are installed design keys, that none is held, withheld or bound to
 * another quote, and that no other pair uses one.
 *
 * Left out: the held and withheld identity designs (pair-designs.ts), pair-usdc (USDC keeps Duel Masters and its own
 * card is not offered), and the legacy finishes bound to another quote for good: doge, bonk, wif, gamestop, coinbase,
 * strategy (LEGACY_DESIGN_QUOTE_KEYS). Content check (31 October 2026, every front and back looked at): no option shows
 * a real person, a child, or another company's logo or wordmark, so none was left out for its art. For the owner's
 * review, as with the pairs' own cards: One Piece's back is the Straw Hat jolly roger, Pokemon Prism's back a Poke
 * Ball, Jade Reliquary's back Pepe the Frog, Noir Terminal and Nordic Signal show unbranded phones in the style of a
 * BlackBerry and a Nokia 3310 (no mark on either). A visual check, not legal advice. The owner reviewed these on
 * 31 October 2026 and kept One Piece and Pokemon Prism as SOL options. Regal, Mythic, Ember and Pokemon Classic joined
 * the same day, when the owner released the content holds whose pairs had launched with them (Pokemon Classic's back
 * is a Poke Ball, as Pokemon Prism's); AMC and the six stock-* finishes stay bound to their own stocks.
 */
export const SOL_DESIGN_OPTIONS: readonly CardDesignKey[] = Object.freeze([
  "pair-sol", "one-piece",
  "pokemon-classic", "pokemon-full-art", "yugioh-monster", "yugioh-spell", "obsidian-archive",
  "spark", "surge", "nova", "tide", "apex", "ember", "bloom", "mythic", "aurora", "relic", "frost", "regal", "legend",
  "pepe", "shib", "popcat", "blackberry", "nokia", "binance", "kraken",
  "wildtype", "ronin", "astral", "neon-circuit", "abyssal",
] as CardDesignKey[]);

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
