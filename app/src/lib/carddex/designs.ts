import { TIERS, type Finish, type TierKey } from "../mintdex/tiers";
import { EDITION_CATALOG, type EditionKey } from "../mintdex/editions";
import { MEME_ICON_CATALOG, type MemeIconKey } from "../mintdex/meme-icons";
import verifiedAssets from "./pair-assets.json";
import { DESIGN_QUOTE_KEYS } from "./design-pairings";
import { ACTIVE_PAIR_DESIGNS, type PairDesignKey } from "./pair-designs";

export type StockDesignKey = "stock-gme" | "stock-tsla" | "stock-nvda" | "stock-aapl" | "stock-mstr" | "stock-coin";
export type ClassicDesignKey = StockDesignKey | "pokemon-classic" | "pokemon-full-art" | "yugioh-monster" | "yugioh-spell" | "magic-etched" | "duel-masters" | "one-piece" | "obsidian-archive";
export type CardDesignKey = TierKey | EditionKey | MemeIconKey | ClassicDesignKey | PairDesignKey;
export type CardDesign = {
  key: CardDesignKey;
  name: string;
  description: string;
  category: "classic" | "premium" | "limited" | "stocks" | "memes" | "crypto";
  /** The bound tokenized quote's stock reference; never a company share or affiliation. */
  stock?: { ticker: string; name: string; quoteAssetKey: string };
  /** Fixed print/material reference. This never reads the token's price or market cap. */
  materialLevel: number;
  palette: readonly [string, string, string];
  finish: Finish;
  layout?: ClassicDesignKey;
  edition?: EditionKey;
  memeIcon?: MemeIconKey;
};

export const DEFAULT_CARD_DESIGN: CardDesignKey = "pokemon-classic";

const STOCKS: readonly CardDesign[] = [
  { key: "stock-gme", name: "GameStop Arcade", description: "Crimson enamel, black console hardware and silver controller engravings. A premium GMEX-paired finish.", category: "stocks", materialLevel: 12, palette: ["#1b1115", "#e44746", "#f3e4dc"], finish: "holo", layout: "stock-gme" },
  { key: "stock-tsla", name: "Tesla Current", description: "Pearl ceramic, brushed titanium and electric-red conductor rails, paired with Tesla xStock (TSLAX).", category: "stocks", materialLevel: 11, palette: ["#263039", "#d73742", "#f0efeb"], finish: "holo", layout: "stock-tsla" },
  { key: "stock-nvda", name: "NVIDIA Silicon", description: "Obsidian silicon, emerald circuitry and precision chip fittings, paired with NVIDIA xStock (NVDAX).", category: "stocks", materialLevel: 13, palette: ["#111c19", "#b8d967", "#eaf0d3"], finish: "prism", layout: "stock-nvda" },
  { key: "stock-aapl", name: "Apple Titanium", description: "Satin titanium, pearl ceramic and a precisely machined monolithic surround, paired with Apple xStock (AAPLX).", category: "stocks", materialLevel: 11, palette: ["#353838", "#c9ccc8", "#f3f1eb"], finish: "holo", layout: "stock-aapl" },
  { key: "stock-mstr", name: "Strategy Reserve", description: "Burnished copper, treasury-vault steel and stacked medallion engravings, paired with Strategy xStock (MSTRX).", category: "stocks", materialLevel: 14, palette: ["#241c18", "#e5a05c", "#f5e1c0"], finish: "gold", layout: "stock-mstr" },
  { key: "stock-coin", name: "Coinbase Vault", description: "Cobalt enamel, polished palladium and a precision-cut vault surround, paired with Coinbase xStock (COINX).", category: "stocks", materialLevel: 11, palette: ["#0c2456", "#9bc5ee", "#eff4f6"], finish: "holo", layout: "stock-coin" },
];

const CLASSICS: readonly CardDesign[] = [
  { key: "pokemon-classic", name: "Pokémon Classic", description: "Classic gold, warm enamel and polished collector metalwork around the shared print.", category: "classic", materialLevel: 14, palette: ["#d9ac21", "#f8db69", "#fcf1c9"], finish: "gold", layout: "pokemon-classic" },
  { key: "pokemon-full-art", name: "Pokémon Prism", description: "Sapphire, silver and opalescent prism laminate with a polished collector frame.", category: "classic", materialLevel: 13, palette: ["#263849", "#c4e5ef", "#f2f8fa"], finish: "prism", layout: "pokemon-full-art" },
  { key: "yugioh-monster", name: "Yu-Gi-Oh! Monster", description: "Copper marbling, antique gold and warm collector paper with a sculpted vortex reverse.", category: "classic", materialLevel: 10, palette: ["#8d4d23", "#e4b36b", "#f2e0b7"], finish: "foil", layout: "yugioh-monster" },
  { key: "yugioh-spell", name: "Yu-Gi-Oh! Spell", description: "Deep emerald lacquer, engraved silver and a jade vortex reverse.", category: "classic", materialLevel: 11, palette: ["#185b54", "#90d5bf", "#e5f0d6"], finish: "holo", layout: "yugioh-spell" },
  { key: "magic-etched", name: "Magic: Etched", description: "Dark bronze, grimoire engraving, warm paper and gem-set gold fittings.", category: "classic", materialLevel: 10, palette: ["#382b27", "#b79a64", "#ede1c5"], finish: "foil", layout: "magic-etched" },
  { key: "duel-masters", name: "Duel Masters", description: "Sapphire enamel, satin gold and jewel-cut collector metalwork.", category: "classic", materialLevel: 11, palette: ["#092b5a", "#e5c66c", "#eff5e3"], finish: "holo", layout: "duel-masters" },
  { key: "one-piece", name: "One Piece", description: "Scarlet enamel, gold ropework and polished nautical collector details.", category: "classic", materialLevel: 12, palette: ["#7e1723", "#f2cc86", "#fff0d6"], finish: "holo", layout: "one-piece" },
  { key: "obsidian-archive", name: "Obsidian Archive", description: "A private-vault treatment in obsidian, electrum inlay and faceted archival metalwork.", category: "premium", materialLevel: 14, palette: ["#111416", "#d6b874", "#eee4ca"], finish: "gold", layout: "obsidian-archive" },
];

const PREMIUM_COPY: Record<TierKey,string> = {
  spark:"Pearl stone, platinum keylines and polished mineral fittings.",
  surge:"Cobalt enamel, brushed silver and bolt-cut metalwork.",
  nova:"Lilac pearl, silver stars and opalescent collector metalwork.",
  tide:"Teal enamel, engraved waves and polished silver fittings.",
  apex:"Champagne gold, crown engravings and sculpted metal rosettes.",
  ember:"Vermilion enamel, copper flame engraving and burnished fittings.",
  bloom:"Rose enamel, pearl embossing and sculpted blossom metalwork.",
  mythic:"Black crystal, chrome keylines and diamond-cut collector metalwork.",
  aurora:"Amethyst lacquer, silver crescents and luminous opal fittings.",
  relic:"Antique bronze, engraved sunbursts and compass-inspired metalwork.",
  frost:"Ice-blue enamel, crystalline platinum and faceted silver fittings.",
  regal:"Crimson enamel, raised gold scrollwork and ruby-set metalwork.",
  celestial:"Cosmic prism, silver constellations and sapphire collector settings.",
  legend:"Engraved gold leaf, emerald fittings and a polished laurel reverse.",
};

/** A creator selects one permanent design at launch; every finish is available from the first card. */
const BASE_CARD_DESIGNS: readonly CardDesign[] = [
  ...CLASSICS,
  ...STOCKS,
  ...TIERS.map((tier): CardDesign => ({ key: tier.key, name: tier.name, description: PREMIUM_COPY[tier.key], category: "premium", materialLevel: tier.level, palette: [tier.ring, tier.sheen[0], "#f3e8cd"], finish: tier.level >= 13 ? tier.finish : tier.level >= 11 ? "holo" : "foil" })),
  ...MEME_ICON_CATALOG.map((icon): CardDesign => ({ key: icon.key, name: icon.name, description: icon.description, category: "limited", materialLevel: 14, palette: icon.palette, finish: "gold", memeIcon: icon.key })),
  ...EDITION_CATALOG.map((edition): CardDesign => ({ key: edition.key, name: edition.name, description: edition.description.replaceAll("MintDex", "Launch a Card"), category: "limited", materialLevel: edition.key === "astral" ? 13 : 14, palette: edition.palette, finish: edition.key === "astral" ? "prism" : "gold", edition: edition.key })),
];

export const LEGACY_CARD_DESIGNS = BASE_CARD_DESIGNS;
export const CARD_DESIGNS: readonly CardDesign[] = [...BASE_CARD_DESIGNS,...ACTIVE_PAIR_DESIGNS].map(design => {
  const key = DESIGN_QUOTE_KEYS[design.key];
  const asset = verifiedAssets.find(asset => asset.key === key && asset.kind === "stock");
  return asset?.referenceTicker ? {...design, stock: {ticker:asset.referenceTicker,name:asset.name,quoteAssetKey:asset.key}} : design;
});

const BY_KEY = new Map(CARD_DESIGNS.map((design) => [design.key, design]));
export function isCardDesignKey(value: unknown): value is CardDesignKey {
  return typeof value === "string" && BY_KEY.has(value as CardDesignKey);
}
export function getCardDesign(key?: string): CardDesign {
  return BY_KEY.get(key as CardDesignKey) ?? BY_KEY.get(DEFAULT_CARD_DESIGN)!;
}
