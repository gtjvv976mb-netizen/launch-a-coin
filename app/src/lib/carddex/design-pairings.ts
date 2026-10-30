import { ACTIVE_PAIR_DESIGNS } from "./pair-designs";

/** Exact design/quote policy; assets and live admission are resolved separately. */
export const LEGACY_DESIGN_QUOTE_KEYS = Object.freeze({
  "stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax",
  "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx",
  gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx",
  doge: "doge", bonk: "bonk", wif: "wif",
} as const);
export const DESIGN_QUOTE_KEYS:Readonly<Record<string,string>>=Object.freeze({
  ...LEGACY_DESIGN_QUOTE_KEYS,
  ...Object.fromEntries(ACTIVE_PAIR_DESIGNS.map(design=>[design.key,design.quoteKey])),
});

const LEGACY_PREFERRED_PAIR_DESIGNS: Readonly<Record<string,string>> = Object.freeze({
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
});
export const PREFERRED_PAIR_DESIGNS:Readonly<Record<string,string>>=Object.freeze({
  ...LEGACY_PREFERRED_PAIR_DESIGNS,
  ...Object.fromEntries(ACTIVE_PAIR_DESIGNS.map(design=>[design.quoteKey,design.key])),
});

/**
 * Explicit chooser presets, not new restrictions on existing design identities.
 * Historical neutral cards keep their stored SOL, stock or other quote unchanged.
 */
export const LEGACY_MEME_PAIR_PRESETS = Object.freeze([
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

/** New exact identities replace chooser recommendations, never historical saved designs or quotes. */
export const MEME_PAIR_PRESETS:readonly {design:string;quote:string}[]=Object.freeze([
  ...LEGACY_MEME_PAIR_PRESETS.filter(preset=>!ACTIVE_PAIR_DESIGNS.some(design=>design.quoteKey===preset.quote)),
  ...ACTIVE_PAIR_DESIGNS.filter(design=>design.category==="memes").map(design=>({design:design.key,quote:design.quoteKey})),
]);
