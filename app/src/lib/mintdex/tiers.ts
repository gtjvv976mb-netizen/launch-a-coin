import layoutJson from "./frame-layout.json";

/**
 * The card designs, in unlock order. Everything that lists, counts or numbers the designs (the Levels
 * ladder and slider, the Discover design menu, "3 of 14", chart unlock lines, copy) reads this array
 * or MAX_LEVEL, so a new design only needs a row here, a frame in /assets/frames (plus its miniature in
 * /assets/frames/mini: `python3 tools/process_assets.py minis`) and a frame-layout entry.
 *
 * Cards v4 (refs/cards-v4/ladder.md): the border gets richer at every rung and each rung adds a material,
 * from flat letterpress (I to III) to the only gold card (XIV). Cards v5 (tools/regrade_frames.py) regrades
 * Bloom, Aurora, Relic and Celestial so the resting look climbs too. Rings are sampled from the frames;
 * `finish` and `sheen` drive the live finish MintCard draws over the frame.
 */
export type TierKey =
  | "spark"
  | "surge"
  | "nova"
  | "tide"
  | "apex"
  | "ember"
  | "bloom"
  | "mythic"
  | "aurora"
  | "relic"
  | "frost"
  | "regal"
  | "celestial"
  | "legend";

/**
 * How a design's border takes the light, lowest to highest. Each finish adds to the one before it:
 *   print  soft glare only (matte letterpress, I to III)
 *   satin  a quiet metallic sheen band (intaglio with metallic ink, IV to VI)
 *   foil   a bright specular band in the foil's metal (hot-foil keylines and bronze, VII to X)
 *   holo   foil plus a rainbow that follows the pointer (XI, XII)
 *   prism  two crossing rainbows plus a fine sparkle (XIII)
 *   gold   the richest gold sweep plus rainbow sparkle (XIV)
 * The frame art already reads as its material at rest (phones and screenshots never tilt); the finish
 * only adds the light. See .mdx-card[data-finish] in mintdex.css.
 */
export type Finish = "print" | "satin" | "foil" | "holo" | "prism" | "gold";

/** A design level, 1 (Spark) to MAX_LEVEL (Legend): a row's level is its position in TIERS (checked below). */
export type TierLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type Tier = {
  level: TierLevel;
  key: TierKey;
  name: string;
  /** Roman numeral printed in the card's name bar, where the HP figure sits on a Pokemon card. */
  numeral: string;
  minUsd: number;
  /** The border's finish: which live light MintCard draws over the frame (see Finish). */
  finish: Finish;
  material: string;
  blurb: string;
  /**
   * Accent used for the numeral, values and labels on the card's cream panels: the border's hue, deepened
   * (OKLCH lightness only) to at least 7:1 on the darker parchment stop (#EEE4CC). The chrome uses it only as
   * a fill (Coin progress, Levels slider) and through `tint`, never as text.
   */
  accent: string;
  /**
   * The frame's main border color (the median for mixed metal and holo borders), for any thin ring around
   * a coin and the chart's dashed unlock lines. Some are pale (Frost, Legend, Bloom): never the only cue.
   */
  ring: string;
  /**
   * The light the finish reflects, as one to five colors. Print to foil use the first (white for
   * letterpress, then the metal of the keylines: silver, pewter, copper, pearl, chrome, bronze); holo, prism
   * and gold use them all as the spectrum (icy for Frost, crimson and gold for Regal, full prism for
   * Celestial, gold for Legend). Card only: MintCard turns them into --s1 to --s5.
   */
  sheen: string[];
  /**
   * Chrome chip and indicator background (Holo Soft): the accent at 14% on sheet (#FFFEFC), precomputed
   * here so the CSS never needs color-mix. Ink on every tint is 13:1 or better. UI data only: MintCard
   * never reads it. Derived from `accent` by tintOf() unless a row sets its own.
   */
  tint: string;
};

/** Sheet, the dark panel the tints are mixed on (--color-sheet in mintdex.css, hype arcade). */
const TINT_BASE = [0x15, 0x1c, 0x29] as const;
/** How much of the lifted accent a tint carries. */
const TINT_AMOUNT = 0.26;

/**
 * A tier tint (hype arcade): `accent` (#RRGGBB) lifted halfway to white, at 26% over the dark sheet, as #RRGGBB, so
 * the chip carries the design's hue and the light ink on it stays at 9:1 or better. Spark #524744 gives #3B3F48.
 */
export function tintOf(accent: string): string {
  const hex = accent.replace("#", "");
  return `#${TINT_BASE.map((base, i) => {
    const c = (Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) + 255) / 2;
    return Math.round(base * (1 - TINT_AMOUNT) + c * TINT_AMOUNT)
      .toString(16)
      .padStart(2, "0");
  })
    .join("")
    .toUpperCase()}`;
}

/** The rows as written: `tint` is optional and follows the accent when left out. */
const TIER_ROWS: Array<Omit<Tier, "tint"> & { tint?: string }> = [
  {
    level: 1,
    key: "spark",
    name: "Spark",
    numeral: "I",
    minUsd: 0,
    finish: "print",
    material: "Stone pearl stock",
    blurb: "The first edition: stone-grey stock, fine cream keylines and a quiet pearl finish around an open seal.",
    accent: "#524744",
    ring: "#8B817E",
    sheen: ["#FFFFFF"],
  },
  {
    level: 2,
    key: "surge",
    name: "Surge",
    numeral: "II",
    minUsd: 15_000,
    finish: "print",
    material: "Cobalt etched pearl",
    blurb: "Cobalt pearl with bolt-etched corners and a brighter, crisply cut edge.",
    accent: "#293F86",
    ring: "#2A4083",
    sheen: ["#FFFFFF"],
  },
  {
    level: 3,
    key: "nova",
    name: "Nova",
    numeral: "III",
    minUsd: 50_000,
    finish: "print",
    material: "Lilac starlight pearl",
    blurb: "Lilac pearl with fine star engraving and a starlight seal; the first small glints catch the light.",
    accent: "#4D407D",
    ring: "#867CBC",
    sheen: ["#FFFFFF"],
  },
  {
    level: 4,
    key: "tide",
    name: "Tide",
    numeral: "IV",
    minUsd: 100_000,
    finish: "satin",
    material: "Silver wave intaglio",
    blurb: "Engraved teal waves, silver keylines and a raised wave seal introduce the first metalwork.",
    accent: "#005258",
    ring: "#1A7379",
    sheen: ["#CFDDE6"],
  },
  {
    level: 5,
    key: "apex",
    name: "Apex",
    numeral: "V",
    minUsd: 150_000,
    finish: "satin",
    material: "Pewter guilloche",
    blurb: "Engine-turned ochre engraving, pewter corner rosettes and a crown seal give the border more depth.",
    accent: "#6D3E00",
    ring: "#AF7E31",
    sheen: ["#D8D0C2"],
  },
  {
    level: 6,
    key: "ember",
    name: "Ember",
    numeral: "VI",
    minUsd: 200_000,
    finish: "satin",
    material: "Copper flame intaglio",
    blurb: "Vermilion flame engraving with copper keylines, stronger corner work and a bright copper seal.",
    accent: "#990000",
    ring: "#E96151",
    sheen: ["#F0A07A"],
  },
  {
    level: 7,
    key: "bloom",
    name: "Bloom",
    numeral: "VII",
    minUsd: 300_000,
    finish: "foil",
    material: "Embossed rose and pearl foil",
    blurb: "Deep rose embossing, raised pearl foil and blossom-set corners introduce a richer, dimensional border.",
    accent: "#76353D",
    ring: "#B76074",
    sheen: ["#F6D9E6", "#D9E8F6", "#FBEFD8"],
  },
  {
    level: 8,
    key: "mythic",
    name: "Mythic",
    numeral: "VIII",
    minUsd: 400_000,
    finish: "foil",
    material: "Obsidian and chrome foil",
    blurb: "Black varnish, raised chrome keylines and diamond-cut corner work reveal a restrained oil-slick sheen.",
    accent: "#3F2041",
    ring: "#18171C",
    sheen: ["#E6ECF5", "#F08BD0", "#7FE3F5"],
  },
  {
    level: 9,
    key: "aurora",
    name: "Aurora",
    numeral: "IX",
    minUsd: 500_000,
    finish: "foil",
    material: "Amethyst and silver foil",
    blurb: "Luminous aurora over amethyst, sculpted silver star corners and a crescent seal add a deeper foil finish.",
    accent: "#523069",
    ring: "#36154A",
    sheen: ["#DCD8F2", "#8FEBC4", "#E3A8F5"],
  },
  {
    level: 10,
    key: "relic",
    name: "Relic",
    numeral: "X",
    minUsd: 600_000,
    finish: "foil",
    material: "Sculpted bronze foil",
    blurb: "A full bronze border with engraved sunbursts, stepped metal brackets and a raised compass seal.",
    accent: "#664021",
    ring: "#AF6A32",
    sheen: ["#EDB57A"],
  },
  {
    level: 11,
    key: "frost",
    name: "Frost",
    numeral: "XI",
    minUsd: 700_000,
    finish: "holo",
    material: "Faceted platinum ice holo",
    blurb: "Faceted platinum edging, crystalline frost engraving and a snowflake seal surround an icy holo picture.",
    accent: "#214D68",
    ring: "#A8C2DE",
    sheen: ["#4FC3F7", "#7FA8FF", "#B39DFF", "#4DD9C0", "#A8E6FF"],
  },
  {
    level: 12,
    key: "regal",
    name: "Regal",
    numeral: "XII",
    minUsd: 800_000,
    finish: "holo",
    material: "Ruby-set crimson holo",
    blurb: "Crimson holo damask with raised scrollwork, ruby-set corners and a sculpted royal seal.",
    accent: "#73011F",
    ring: "#71152E",
    sheen: ["#FFC14D", "#FF5C8A", "#FFD978", "#E8336B", "#FFB36B"],
  },
  {
    level: 13,
    key: "celestial",
    name: "Celestial",
    numeral: "XIII",
    minUsd: 900_000,
    finish: "prism",
    material: "Sapphire-set full prism",
    blurb: "Full-border cosmic prism, silver constellations and sapphire settings; the picture carries the richest rainbow finish.",
    accent: "#2A1E7B",
    ring: "#616199",
    sheen: ["#FF5CC8", "#FFD93D", "#3DE0A8", "#3DA8FF", "#A86BFF"],
  },
  {
    level: 14,
    key: "legend",
    name: "Legend",
    numeral: "XIV",
    minUsd: 1_000_000,
    finish: "gold",
    material: "Emerald-set gold leaf",
    blurb: "The final design: engraved gold leaf, a reeded gold rim, emerald settings and a laurel seal, finished with gold dust.",
    accent: "#105431",
    ring: "#C0A25F",
    sheen: ["#FFD36B", "#FFF1C4", "#D9A21E"],
  },
];

export const TIERS: Tier[] = TIER_ROWS.map((t) => ({ ...t, tint: t.tint ?? tintOf(t.accent) }));

// tierForLevel, levelForMcap and the server's level math index TIERS by level: keep the rows in
// unlock order with level = position and strictly rising thresholds.
if (TIERS.some((t, i) => t.level !== i + 1 || (i > 0 && t.minUsd <= TIERS[i - 1].minUsd))) {
  throw new Error("TIERS must be in unlock order, with each level equal to its position");
}

/** The top design level. Derived from TIERS so adding a tier never needs a hunt for literals. */
export const MAX_LEVEL = TIERS.length;

/** The level of a design by key ("tide" is 4). */
export function levelOf(key: TierKey): number {
  return TIERS.findIndex((t) => t.key === key) + 1;
}

/** Clamp any number to a valid design level, 1..MAX_LEVEL. */
export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
}

export function tierForLevel(level: number): Tier {
  return TIERS[clampLevel(level) - 1];
}

/** The design a market cap unlocks. Cards keep the best one they have reached. */
export function levelForMcap(usd: number): number {
  let lvl = 1;
  for (const t of TIERS) if (usd >= t.minUsd) lvl = t.level;
  return lvl;
}

/** Progress from the current tier threshold to the next one, 0..1 (1 at the top design). */
export function levelProgress(usd: number) {
  const lvl = levelForMcap(usd);
  if (lvl >= MAX_LEVEL) return { level: MAX_LEVEL, next: null as Tier | null, progress: 1, toGoUsd: 0 };
  const cur = TIERS[lvl - 1];
  const next = TIERS[lvl];
  const progress = Math.min(1, Math.max(0, (usd - cur.minUsd) / (next.minUsd - cur.minUsd)));
  return { level: lvl, next, progress, toGoUsd: Math.max(0, next.minUsd - usd) };
}

export type Box = { x: number; y: number; w: number; h: number };
export type FrameLayout = {
  aspect: number;
  /** Corner radius as a fraction of card width (Pokemon card: 1/8 in on 63 mm = 0.0504). */
  radius?: number;
  window: Box;
  name: Box;
  type: Box;
  text: Box;
  footer: Box[];
};

const LAYOUT = layoutJson as Record<string, FrameLayout>;

export function frameLayout(key: TierKey): FrameLayout {
  return LAYOUT[key] ?? LAYOUT.spark;
}

/**
 * The frame art version. Bump it whenever tools/process_assets.py writes new frames or minis: the proxy
 * caches /assets/frames for 7 days (plus 30 stale) and keys its edge cache on the full URL, query included,
 * so a new version is a new URL everywhere (browser, edge and origin) and nobody keeps an old frame
 * (backlog P0-4, decision C13). 4 was the cards v4 ladder; 5 is the v5 regrade plus the sized copies.
 */
const FRAME_VERSION = "5";

export function frameSrc(key: TierKey) {
  return `/assets/frames/${key}.webp?v=${FRAME_VERSION}`;
}

/** The smaller copies of every frame (tools/regrade_frames.py), for grid cards and phones. Widths in px. */
export const FRAME_WIDTHS = [360, 600] as const;
export type FrameWidth = (typeof FRAME_WIDTHS)[number];

/** A frame at one of its sized widths (the full 900px frame for anything wider). */
export function frameSizedSrc(key: TierKey, width: FrameWidth | 900) {
  return width === 900 ? frameSrc(key) : `/assets/frames/w${width}/${key}.webp?v=${FRAME_VERSION}`;
}

/** srcset for a frame <img>: 360, 600 and the full 900px frame. */
export function frameSrcSet(key: TierKey) {
  return [...FRAME_WIDTHS.map((w) => `${frameSizedSrc(key, w)} ${w}w`), `${frameSrc(key)} 900w`].join(", ");
}

/**
 * Designs whose live light reads a map instead of the frame's own luminance: Legend's gold, so the emerald
 * enamel (dark in the map) never washes out under the gold light (QA). 360px, grayscale.
 */
const LIGHT_MAPS: ReadonlySet<TierKey> = new Set<TierKey>(["legend"]);

export function frameLightMapSrc(key: TierKey): string | null {
  return LIGHT_MAPS.has(key) ? `/assets/frames/map/${key}.webp?v=${FRAME_VERSION}` : null;
}

/**
 * The frame as a 48 x 67 miniature (about 1KB): what FrameMini and the chart's unlock labels show, so a
 * list of every design (Levels ladder, Design menu) never downloads the full 900px frames.
 */
export function frameMiniSrc(key: TierKey) {
  return `/assets/frames/mini/${key}.webp?v=${FRAME_VERSION}`;
}
