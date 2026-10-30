import { OFFERED_PAIRS, type PairAsset } from "../../lib/carddex/pairs";

/**
 * The pair groups, in one order with one set of short names, shared by Launch's pair HUD (PairHud) and the Designs
 * screen. The pair picks the card, so the groups are the pairs' own kinds: memecoins, tokenized stocks, crypto (SOL,
 * USDC, Solana tokens and Solana versions of other coins) and collector tokens. Only offered pairs appear (pairs.ts
 * OFFERED_PAIRS).
 * Pure helpers, no React; tested in tests/carddex/launch-form.test.ts.
 */
export const PAIR_GROUPS = [
  { key: "all", name: "All" },
  { key: "memes", name: "Memes" },
  { key: "stocks", name: "Stocks" },
  { key: "crypto", name: "Crypto" },
  { key: "collector", name: "Collector" },
] as const;
export type PairGroup = (typeof PAIR_GROUPS)[number]["key"];

const KIND_GROUP: Record<PairAsset["kind"], Exclude<PairGroup, "all">> = { native: "crypto", stable: "crypto", crypto: "crypto", stock: "stocks", meme: "memes", collector: "collector" };
export const pairGroupOf = (asset: Readonly<PairAsset>) => KIND_GROUP[asset.kind];
/** Old group names in links: "base" (SOL and USDC) became part of "crypto" on 30 October 2026. */
export const groupAlias = (value: unknown): unknown => (value === "base" ? "crypto" : value);
export const isPairGroup = (value: unknown): value is PairGroup => PAIR_GROUPS.some((group) => group.key === value);

/**
 * Every offered pair in reading order: SOL and USDC (the default SOL first), the stocks, the memes, the other crypto
 * pairs, then the collector tokens. Stocks come early so a stock pair is a short swipe away on phones.
 */
const BASE_KINDS = new Set<PairAsset["kind"]>(["native", "stable"]);
export const ORDERED_PAIRS: readonly Readonly<PairAsset>[] = [
  ...OFFERED_PAIRS.filter((asset) => BASE_KINDS.has(asset.kind)),
  ...OFFERED_PAIRS.filter((asset) => asset.kind === "stock"),
  ...OFFERED_PAIRS.filter((asset) => asset.kind === "meme"),
  ...OFFERED_PAIRS.filter((asset) => asset.kind === "crypto"),
  ...OFFERED_PAIRS.filter((asset) => asset.kind === "collector"),
];

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

/**
 * How well a pair matches a query: 0 an exact symbol or key, 1 a symbol or key prefix, 2 a name word's prefix, 3 the
 * query anywhere in the symbol, key or name; null for no match.
 */
function matchRank(asset: Readonly<PairAsset>, q: string): number | null {
  const symbol = asset.symbol.toLowerCase(), key = asset.key, name = asset.name.toLowerCase();
  if (symbol === q || key === q) return 0;
  if (symbol.startsWith(q) || key.startsWith(q)) return 1;
  if (name.split(/[^a-z0-9]+/).some((word) => word && word.startsWith(q)) || name.startsWith(q)) return 2;
  if (symbol.includes(q) || key.includes(q) || name.includes(q)) return 3;
  return null;
}

/**
 * The pairs in a group that match the query (case and spacing ignored, a leading $ dropped), best match first: an exact
 * symbol, then a symbol prefix, a name word, anywhere; within each, reading order. All of them for "". Enter in the
 * search picks the first, so typing a full symbol always picks that pair ("pepe" is PEPE, not The Toad Pepe).
 */
export function filterPairs(group: PairGroup, query: string): readonly Readonly<PairAsset>[] {
  const q = query.trim().toLowerCase().replace(/^\$/, "").replace(/\s+/g, " ");
  const pairs = pairsInGroup(group);
  if (!q) return pairs;
  const ranked: Readonly<PairAsset>[][] = [[], [], [], []];
  for (const asset of pairs) {
    const rank = matchRank(asset, q);
    if (rank !== null) ranked[rank]!.push(asset);
  }
  return ranked.flat();
}

/**
 * A pair's typographic monogram: the first letter or digit of its symbol. It is the fallback for a pair without a logo
 * (pair-logos.json: GORK and MANIFEST, whose token images hold no logo; lib/carddex/pair-logos.ts pairLogo is null).
 */
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
