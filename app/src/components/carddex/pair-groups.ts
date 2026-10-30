import { PAIR_ASSETS, type PairAsset } from "../../lib/carddex/pairs";

/**
 * The pair groups, in one order with one set of short names, shared by Launch's pair HUD (PairHud) and the Designs
 * screen. The pair picks the card, so the groups are the pairs' own kinds: memecoins, tokenized stocks, collector
 * tokens, and the base quotes SOL and USDC. Pure helpers, no React; tested in tests/carddex/launch-form.test.ts.
 */
export const PAIR_GROUPS = [
  { key: "all", name: "All" },
  { key: "memes", name: "Memes" },
  { key: "stocks", name: "Stocks" },
  { key: "collector", name: "Collector" },
  { key: "base", name: "Base" },
] as const;
export type PairGroup = (typeof PAIR_GROUPS)[number]["key"];

const KIND_GROUP: Record<PairAsset["kind"], Exclude<PairGroup, "all">> = { native: "base", stable: "base", stock: "stocks", meme: "memes", collector: "collector" };
export const pairGroupOf = (asset: Readonly<PairAsset>) => KIND_GROUP[asset.kind];
export const isPairGroup = (value: unknown): value is PairGroup => PAIR_GROUPS.some((group) => group.key === value);

/** Every pair in reading order: the base quotes (the default SOL first), then memes, stocks and collector tokens. */
const ORDER: readonly Exclude<PairGroup, "all">[] = ["base", "memes", "stocks", "collector"];
export const ORDERED_PAIRS: readonly Readonly<PairAsset>[] = ORDER.flatMap((group) => PAIR_ASSETS.filter((asset) => pairGroupOf(asset) === group));

/** The pairs a group holds, in reading order. */
export function pairsInGroup(group: PairGroup): readonly Readonly<PairAsset>[] {
  return group === "all" ? ORDERED_PAIRS : ORDERED_PAIRS.filter((asset) => pairGroupOf(asset) === group);
}

/** A tile's short name: the asset's name without its representation or listing note ("Dogecoin", "Tesla"). */
export function shortPairName(asset: Readonly<PairAsset>): string {
  return asset.name.replace(/\s*\(.*\)\s*$/, "").replace(/\s+(?:xStock|tokenized equity)$/i, "").trim() || asset.name;
}

/** The name line a tile shows under its symbol, or null when the short name only repeats the symbol ("BONK", "Bonk"). */
export function tileName(asset: Readonly<PairAsset>): string | null {
  const name = shortPairName(asset);
  return name.toLowerCase() === asset.symbol.toLowerCase() ? null : name;
}

/** The pairs in a group whose symbol or name contains the query (case and spacing ignored); all of them for "". */
export function filterPairs(group: PairGroup, query: string): readonly Readonly<PairAsset>[] {
  const q = query.trim().toLowerCase().replace(/^\$/, "").replace(/\s+/g, " ");
  const pairs = pairsInGroup(group);
  if (!q) return pairs;
  return pairs.filter((asset) => asset.symbol.toLowerCase().includes(q) || asset.name.toLowerCase().includes(q) || asset.key.includes(q));
}

/** A pair's typographic monogram: the first letter or digit of its symbol (no pair ships its own logo here). */
export function pairMonogram(asset: Readonly<PairAsset>): string {
  return (asset.symbol.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
}

/**
 * Where an arrow key moves in the tile grid (a radio group): Left and Right one tile, Up and Down one row (`columns`
 * tiles), Home and End to the ends; past either end it wraps, as radio groups do. Null for any other key.
 */
export function gridStep(key: string, index: number, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.min(columns, count));
  const wrap = (n: number) => ((n % count) + count) % count;
  /** The last tile in a column (the bottom row may be short). */
  const bottomOf = (col: number) => col + Math.floor((count - 1 - col) / cols) * cols;
  switch (key) {
    case "ArrowRight": return wrap(index + 1);
    case "ArrowLeft": return wrap(index - 1);
    // Down from a column's last tile goes on to the top of the next column; from the last column, back to the first.
    case "ArrowDown": {
      if (index + cols < count) return index + cols;
      const next = (index % cols) + 1;
      return next < cols && next < count ? next : 0;
    }
    // Up from a column's first tile goes to the bottom of the previous column; from the first, to the last tile.
    case "ArrowUp": {
      if (index - cols >= 0) return index - cols;
      const previous = (index % cols) - 1;
      return previous < 0 ? count - 1 : bottomOf(previous);
    }
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
