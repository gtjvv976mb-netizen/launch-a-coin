import { TIERS, type Finish, type TierKey } from "../mintdex/tiers";
import { EDITION_CATALOG, type EditionKey } from "../mintdex/editions";
import { MEME_ICON_CATALOG, type MemeIconKey } from "../mintdex/meme-icons";

export type StockDesignKey = "stock-gme" | "stock-tsla" | "stock-nvda" | "stock-aapl" | "stock-mstr" | "stock-coin";
export type ClassicDesignKey = StockDesignKey | "pokemon-classic" | "pokemon-full-art" | "yugioh-monster" | "yugioh-spell" | "magic-etched" | "duel-masters" | "one-piece" | "obsidian-archive";
export type CardDesignKey = TierKey | EditionKey | MemeIconKey | ClassicDesignKey;
export type CardDesign = {
  key: CardDesignKey;
  name: string;
  description: string;
  category: "classic" | "premium" | "limited" | "stocks";
  /** A visual reference only; not a share, backing claim or company affiliation. */
  stock?: { ticker: string; name: string; pair: string };
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
  { key: "stock-gme", name: "GameStop Arcade", description: "Crimson enamel, black console hardware and silver controller engravings. A GME reference for your own token.", category: "stocks", stock: { ticker: "GME", name: "GameStop", pair: "GME / SOL" }, materialLevel: 12, palette: ["#1b1115", "#e44746", "#f3e4dc"], finish: "holo", layout: "stock-gme" },
  { key: "stock-tsla", name: "Tesla Current", description: "Pearl ceramic, brushed titanium and electric-red conductor rails, referencing TSLA.", category: "stocks", stock: { ticker: "TSLA", name: "Tesla", pair: "TSLA / SOL" }, materialLevel: 11, palette: ["#263039", "#d73742", "#f0efeb"], finish: "holo", layout: "stock-tsla" },
  { key: "stock-nvda", name: "NVIDIA Silicon", description: "Obsidian silicon, emerald circuitry and precision chip fittings, referencing NVDA.", category: "stocks", stock: { ticker: "NVDA", name: "NVIDIA", pair: "NVDA / SOL" }, materialLevel: 13, palette: ["#111c19", "#b8d967", "#eaf0d3"], finish: "prism", layout: "stock-nvda" },
  { key: "stock-aapl", name: "Apple Titanium", description: "Satin titanium, pearl ceramic and a precisely machined monolithic surround, referencing AAPL.", category: "stocks", stock: { ticker: "AAPL", name: "Apple", pair: "AAPL / SOL" }, materialLevel: 11, palette: ["#353838", "#c9ccc8", "#f3f1eb"], finish: "holo", layout: "stock-aapl" },
  { key: "stock-mstr", name: "Strategy Reserve", description: "Burnished copper, treasury-vault steel and stacked medallion engravings, referencing MSTR.", category: "stocks", stock: { ticker: "MSTR", name: "Strategy", pair: "MSTR / SOL" }, materialLevel: 14, palette: ["#241c18", "#e5a05c", "#f5e1c0"], finish: "gold", layout: "stock-mstr" },
  { key: "stock-coin", name: "Coinbase Vault", description: "Cobalt enamel, polished palladium and a precision-cut vault surround, referencing COIN.", category: "stocks", stock: { ticker: "COIN", name: "Coinbase", pair: "COIN / SOL" }, materialLevel: 11, palette: ["#0c2456", "#9bc5ee", "#eff4f6"], finish: "holo", layout: "stock-coin" },
];

const CLASSICS: readonly CardDesign[] = [
  { key: "pokemon-classic", name: "Pokémon Classic", description: "The familiar golden border, broad illustration window and clean collector print, finished in holographic gold.", category: "classic", materialLevel: 14, palette: ["#d9ac21", "#f8db69", "#fcf1c9"], finish: "gold", layout: "pokemon-classic" },
  { key: "pokemon-full-art", name: "Pokémon Full Art", description: "An edge-to-edge illustration, silver collector rim and luminous prism laminate.", category: "classic", materialLevel: 13, palette: ["#263849", "#c4e5ef", "#f2f8fa"], finish: "prism", layout: "pokemon-full-art" },
  { key: "yugioh-monster", name: "Yu-Gi-Oh! Monster", description: "Copper marbling, a raised name plaque, eight-star rail, square art and a parchment effect panel.", category: "classic", materialLevel: 10, palette: ["#8d4d23", "#e4b36b", "#f2e0b7"], finish: "foil", layout: "yugioh-monster" },
  { key: "yugioh-spell", name: "Yu-Gi-Oh! Spell", description: "Deep emerald lacquer with the iconic dueling-card proportions and an engraved silver surround.", category: "classic", materialLevel: 11, palette: ["#185b54", "#90d5bf", "#e5f0d6"], finish: "holo", layout: "yugioh-spell" },
  { key: "magic-etched", name: "Magic: Etched", description: "A dark collector border, arched illustration, inset type rail and parchment text well with gold foil fittings.", category: "classic", materialLevel: 10, palette: ["#382b27", "#b79a64", "#ede1c5"], finish: "foil", layout: "magic-etched" },
  { key: "duel-masters", name: "Duel Masters", description: "Sapphire and gold framing, a sculpted corner disc and a sweeping illustration window.", category: "classic", materialLevel: 11, palette: ["#092b5a", "#e5c66c", "#eff5e3"], finish: "holo", layout: "duel-masters" },
  { key: "one-piece", name: "One Piece", description: "Full-art manga energy, bold red framing and polished collector details around your token identity.", category: "classic", materialLevel: 12, palette: ["#7e1723", "#f2cc86", "#fff0d6"], finish: "holo", layout: "one-piece" },
  { key: "obsidian-archive", name: "Obsidian Archive", description: "A private-vault treatment: obsidian, inset electrum, engraved corner fittings and a luminous archival seal.", category: "premium", materialLevel: 14, palette: ["#111416", "#d6b874", "#eee4ca"], finish: "gold", layout: "obsidian-archive" },
];

/** A creator selects one permanent design at launch; every finish is available from the first card. */
export const CARD_DESIGNS: readonly CardDesign[] = [
  ...CLASSICS,
  ...STOCKS,
  ...TIERS.map((tier): CardDesign => ({ key: tier.key, name: tier.name, description: tier.blurb.replace(/The first edition: /, ""), category: "premium", materialLevel: tier.level, palette: [tier.ring, tier.sheen[0], "#f3e8cd"], finish: tier.level >= 13 ? tier.finish : tier.level >= 11 ? "holo" : "foil" })),
  ...MEME_ICON_CATALOG.map((icon): CardDesign => ({ key: icon.key, name: icon.name, description: icon.description, category: "limited", materialLevel: 14, palette: icon.palette, finish: "gold", memeIcon: icon.key, ...(icon.key === "gamestop" ? { stock: { ticker: "GME", name: "GameStop", pair: "GME / SOL" } } : icon.key === "blackberry" ? { stock: { ticker: "BB", name: "BlackBerry", pair: "BB / SOL" } } : {}) })),
  ...EDITION_CATALOG.map((edition): CardDesign => ({ key: edition.key, name: edition.name, description: edition.description.replaceAll("MintDex", "CardDex"), category: "limited", materialLevel: edition.key === "astral" ? 13 : 14, palette: edition.palette, finish: edition.key === "astral" ? "prism" : "gold", edition: edition.key })),
];

const BY_KEY = new Map(CARD_DESIGNS.map((design) => [design.key, design]));
export function isCardDesignKey(value: unknown): value is CardDesignKey {
  return typeof value === "string" && BY_KEY.has(value as CardDesignKey);
}
export function getCardDesign(key?: string): CardDesign {
  return BY_KEY.get(key as CardDesignKey) ?? BY_KEY.get(DEFAULT_CARD_DESIGN)!;
}
