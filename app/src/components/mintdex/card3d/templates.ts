/**
 * The 14 card templates (owner 2026-10-17: "make each tier of card their 3d card template"). One row per design,
 * Spark to Legend: the cut edge's material and colors, the printed back's palette and motif, the holo rung (the
 * ladder itself lives in card3d.css, keyed on the face's data-tier) and the halo glow. Tweak a design here.
 *
 * Every card is ONE solid thin slab (owner 2026-10-17: "make each card a one solid thin 3d card"): the face is one
 * plane, the back is one plane, and a continuous edge of walls (extrude.ts) in the template's material joins them.
 * Card3D, CardCase and the 3D viewer put templateStyle() on the scene as CSS variables, so the walls (built once),
 * the back and the halo follow every face swap without a rebuild.
 */
import type { CSSProperties } from "react";

import { TIERS, type TierKey } from "../../../lib/mintdex/tiers";

/**
 * stock: card stock, cream skins with the dark core line real trading cards show on their cut edge.
 * lacquer: a glossy colored lacquer, no core line.
 * brushed: brushed metal, fine lines along the edge.
 * polished: a mirror metal (gold, prism) with a bright center line.
 */
export type EdgeMaterial = "stock" | "lacquer" | "brushed" | "polished";
/** The face's Pokemon-style holo rung (card3d.css .mdx-card__poke, by data-tier). */
export type HoloRung = "sheen" | "holo" | "cosmos" | "radiant" | "secret" | "gold";
/** The back's motif, drawn over the plate's dark field (CSS gradients: no image, no bytes). */
export type BackMotif =
  | "grain"
  | "bolts"
  | "stars"
  | "waves"
  | "chevrons"
  | "rays"
  | "petals"
  | "hex"
  | "ribbons"
  | "guilloche"
  | "crystals"
  | "lattice"
  | "cosmos"
  | "sunburst";

export type CardTemplate = {
  edge: {
    material: EdgeMaterial;
    /** The face side skin, the middle, the core line and the back side skin. */
    front: string;
    mid: string;
    core: string;
    back: string;
    /** Extra colors running along the edge (the prism edge). */
    along?: string[];
    /** How strongly the edge catches the light as the card turns, 0 to 1. */
    shine: number;
  };
  back: {
    /** The dark field, screened over the plate. */
    field: string;
    /** The keylines, seal and emblem ink (multiplied over the plate's cream lines). */
    ink: string;
    motif: BackMotif;
    /** The motif's strength, 0 to 1. */
    motifK: number;
    /** The back foil's rainbow (the guilloche glint), three to five stops. */
    foil: string[];
  };
  holo: HoloRung;
  glow: { color: string; k: number };
};

export const TEMPLATES: Record<TierKey, CardTemplate> = {
  spark: {
    edge: { material: "stock", front: "#f8f3e8", mid: "#e2d8c2", core: "#77736b", back: "#d8ccb2", shine: 0.25 },
    back: { field: "#2a2f3a", ink: "#e9e4da", motif: "grain", motifK: 0.35, foil: ["#f2f2f2", "#dfe6ee", "#f4ece0"] },
    holo: "sheen",
    glow: { color: "#8fb4d8", k: 0.3 },
  },
  surge: {
    edge: { material: "stock", front: "#f6f8fc", mid: "#d9dfec", core: "#2c4a9a", back: "#cdd5e6", shine: 0.3 },
    back: { field: "#0f1c46", ink: "#bcd0ff", motif: "bolts", motifK: 0.4, foil: ["#9cc0ff", "#e8f0ff", "#7fa2ff"] },
    holo: "sheen",
    glow: { color: "#4d7cff", k: 0.36 },
  },
  nova: {
    edge: { material: "lacquer", front: "#c9bff5", mid: "#8a80c4", core: "#4d407d", back: "#6f63ad", shine: 0.45 },
    back: { field: "#1f1a40", ink: "#d8d0ff", motif: "stars", motifK: 0.55, foil: ["#c9a8ff", "#f3eaff", "#8fd0ff"] },
    holo: "sheen",
    glow: { color: "#a08bff", k: 0.42 },
  },
  tide: {
    edge: { material: "lacquer", front: "#8fe3dc", mid: "#1e8a86", core: "#005258", back: "#13706f", shine: 0.5 },
    back: { field: "#06302f", ink: "#bff3ec", motif: "waves", motifK: 0.45, foil: ["#8ff5e0", "#cfe9ff", "#4dd9c0"] },
    holo: "holo",
    glow: { color: "#2fd6c6", k: 0.48 },
  },
  apex: {
    edge: { material: "lacquer", front: "#ffd896", mid: "#c08a32", core: "#6d3e00", back: "#a5711f", shine: 0.55 },
    back: { field: "#3a2408", ink: "#ffe2a8", motif: "chevrons", motifK: 0.4, foil: ["#ffe58a", "#fff4d6", "#ffb547"] },
    holo: "holo",
    glow: { color: "#ffb547", k: 0.54 },
  },
  ember: {
    edge: { material: "lacquer", front: "#ffb59c", mid: "#d04a2a", core: "#7a0d00", back: "#b1361c", shine: 0.6 },
    back: { field: "#3e0d07", ink: "#ffc7b0", motif: "rays", motifK: 0.45, foil: ["#ffb36b", "#ffe1c9", "#ff6a4d"] },
    holo: "holo",
    glow: { color: "#ff6a4d", k: 0.6 },
  },
  bloom: {
    edge: { material: "lacquer", front: "#fde4ef", mid: "#e2a4bf", core: "#b76074", back: "#cf8aa6", shine: 0.65 },
    back: { field: "#3d1a28", ink: "#ffd6e6", motif: "petals", motifK: 0.45, foil: ["#ff9ccf", "#fff0f6", "#d9e8f6", "#fbefd8"] },
    holo: "cosmos",
    glow: { color: "#ff8fc0", k: 0.66 },
  },
  mythic: {
    edge: { material: "brushed", front: "#e6ebf3", mid: "#8d94a6", core: "#1a1a20", back: "#5c6274", shine: 0.75 },
    back: { field: "#141218", ink: "#f2c4e6", motif: "hex", motifK: 0.45, foil: ["#f08bd0", "#e6ecf5", "#7fe3f5"] },
    holo: "cosmos",
    glow: { color: "#f08bd0", k: 0.72 },
  },
  aurora: {
    edge: { material: "brushed", front: "#f3f1fb", mid: "#b9b3d6", core: "#4d2f86", back: "#8f87b8", shine: 0.75 },
    back: { field: "#1d1533", ink: "#d6f7e9", motif: "ribbons", motifK: 0.5, foil: ["#8febc4", "#dcd8f2", "#e3a8f5"] },
    holo: "cosmos",
    glow: { color: "#6ff0bc", k: 0.78 },
  },
  relic: {
    edge: { material: "brushed", front: "#f7d8b0", mid: "#b07a3c", core: "#4a2a10", back: "#8c5a26", shine: 0.8 },
    back: { field: "#2c1a0c", ink: "#f5cf9c", motif: "guilloche", motifK: 0.5, foil: ["#edb57a", "#fff0dc", "#c98a4a"] },
    holo: "cosmos",
    glow: { color: "#ffa65c", k: 0.82 },
  },
  frost: {
    edge: { material: "brushed", front: "#f4fbff", mid: "#a9c8da", core: "#2a6f9a", back: "#86aec6", shine: 0.85 },
    back: { field: "#0c2436", ink: "#d4f0ff", motif: "crystals", motifK: 0.5, foil: ["#4fc3f7", "#e6f7ff", "#b39dff", "#4dd9c0"] },
    holo: "radiant",
    glow: { color: "#4fc3f7", k: 0.88 },
  },
  regal: {
    edge: { material: "brushed", front: "#ffe4dc", mid: "#d98a7a", core: "#6a0f24", back: "#b9675a", shine: 0.9 },
    back: { field: "#320814", ink: "#ffd7c2", motif: "lattice", motifK: 0.5, foil: ["#ffc14d", "#ff5c8a", "#ffd978", "#e8336b"] },
    holo: "radiant",
    glow: { color: "#ff5c8a", k: 0.92 },
  },
  celestial: {
    edge: {
      material: "polished",
      front: "#f2e9ff",
      mid: "#b9a8ff",
      core: "#2a1e7b",
      back: "#8f7bff",
      along: ["#ff5cc8", "#ffd93d", "#3de0a8", "#3da8ff", "#a86bff", "#ff5cc8"],
      shine: 1,
    },
    back: { field: "#140f3d", ink: "#e9dcff", motif: "cosmos", motifK: 0.6, foil: ["#ff5cc8", "#ffd93d", "#3de0a8", "#3da8ff", "#a86bff"] },
    holo: "secret",
    glow: { color: "#b06bff", k: 0.96 },
  },
  legend: {
    edge: { material: "polished", front: "#fff1c4", mid: "#e2b350", core: "#8a5a0c", back: "#b07a1c", shine: 1 },
    back: { field: "#2a1d04", ink: "#ffe08a", motif: "sunburst", motifK: 0.32, foil: ["#ffd36b", "#fff1c4", "#d9a21e", "#fff8e0"] },
    holo: "gold",
    glow: { color: "#ffd36b", k: 1 },
  },
};

/** Every design key, in ladder order (TIERS). */
export const TEMPLATE_KEYS: TierKey[] = TIERS.map((t) => t.key);

/** The template for a design key; an unknown or missing key gets Spark's. */
export function templateOf(key: string | null | undefined): CardTemplate {
  return (key && (TEMPLATES as Record<string, CardTemplate>)[key]) || TEMPLATES.spark;
}

/**
 * The edge's fill along a wall: the wall's height is the card's thickness (top = the back, bottom = the face) and
 * its width runs along the edge.
 */
export function edgeFill(e: CardTemplate["edge"]): string {
  switch (e.material) {
    case "stock":
      return `linear-gradient(to bottom, ${e.back} 0 34%, ${e.core} 34% 66%, ${e.front} 66%)`;
    case "lacquer":
      return `linear-gradient(to bottom, ${e.back}, ${e.mid} 30%, ${e.front} 50%, ${e.mid} 70%, ${e.core})`;
    case "brushed":
      return (
        `repeating-linear-gradient(90deg, rgb(255 255 255 / 0.16) 0 1px, rgb(0 0 0 / 0.08) 1px 2px, transparent 2px 4px), ` +
        `linear-gradient(to bottom, ${e.back}, ${e.mid} 28%, ${e.front} 50%, ${e.mid} 72%, ${e.core})`
      );
    case "polished": {
      const along = e.along?.length
        ? `linear-gradient(90deg, ${e.along.map((c) => `color-mix(in srgb, ${c} 45%, transparent)`).join(", ")}), `
        : "";
      return `${along}linear-gradient(to bottom, ${e.back}, ${e.mid} 30%, ${e.front} 46%, #fffdf4 50%, ${e.front} 54%, ${e.mid} 70%, ${e.back})`;
    }
  }
}

const dot = (c: string, r: number, s: number, x = 0, y = 0) =>
  `radial-gradient(circle, ${c} 0 ${r}px, transparent ${r + 0.6}px) ${x}px ${y}px / ${s}px ${s}px`;

/**
 * The back's motif as a CSS background (sized in cqw of the card, so every card size reads the same), its ink at
 * the template's strength `k`.
 */
export function motifCss(m: BackMotif, ink: string, k = 0.5): string {
  const a = (x: number) => `color-mix(in srgb, ${ink} ${Math.round(Math.min(1, x * k * 1.3) * 100)}%, transparent)`;
  switch (m) {
    case "grain":
      return `${dot(a(0.5), 0.6, 5)}, ${dot(a(0.3), 0.5, 7, 2, 3)}`;
    case "bolts":
      return `repeating-linear-gradient(135deg, ${a(0.55)} 0 1px, transparent 1px 7cqw), repeating-linear-gradient(45deg, ${a(0.25)} 0 1px, transparent 1px 7cqw)`;
    case "stars":
      return `${dot(a(0.9), 0.9, 23, 3, 5)}, ${dot(a(0.6), 0.6, 13, 7, 1)}, ${dot(a(0.35), 0.5, 7, 1, 4)}`;
    case "waves":
      return `repeating-radial-gradient(circle at 50% 118%, ${a(0.5)} 0 1px, transparent 1px 4.5cqw)`;
    case "chevrons":
      return `linear-gradient(135deg, ${a(0.45)} 0 6%, transparent 6% 50%, ${a(0.45)} 50% 56%, transparent 56%) 0 0 / 9cqw 9cqw, linear-gradient(225deg, ${a(0.45)} 0 6%, transparent 6% 50%, ${a(0.45)} 50% 56%, transparent 56%) 0 0 / 9cqw 9cqw`;
    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% 50%, ${a(0.4)} 0 2deg, transparent 2deg 12deg)`;
    case "petals":
      return `${dot(a(0.55), 2.2, 18, 0, 0)}, ${dot(a(0.35), 1.4, 18, 9, 9)}`;
    case "hex":
      return `repeating-linear-gradient(60deg, ${a(0.4)} 0 1px, transparent 1px 6cqw), repeating-linear-gradient(-60deg, ${a(0.4)} 0 1px, transparent 1px 6cqw), repeating-linear-gradient(0deg, ${a(0.25)} 0 1px, transparent 1px 5.2cqw)`;
    case "ribbons":
      return `repeating-linear-gradient(168deg, transparent 0 6cqw, ${a(0.45)} 6cqw 6.6cqw, transparent 6.6cqw 9cqw, ${a(0.25)} 9cqw 9.4cqw)`;
    case "guilloche":
      return `repeating-radial-gradient(circle at 50% 50%, ${a(0.45)} 0 1px, transparent 1px 2.6cqw), repeating-radial-gradient(circle at 30% 40%, ${a(0.2)} 0 1px, transparent 1px 3.4cqw)`;
    case "crystals":
      return `repeating-conic-gradient(from 0deg at 50% 50%, ${a(0.45)} 0 1.2deg, transparent 1.2deg 30deg), ${dot(a(0.6), 0.8, 11, 2, 2)}`;
    case "lattice":
      return `repeating-linear-gradient(45deg, ${a(0.45)} 0 1px, transparent 1px 5cqw), repeating-linear-gradient(-45deg, ${a(0.45)} 0 1px, transparent 1px 5cqw)`;
    case "cosmos":
      return `${dot(a(1), 1, 29, 4, 9)}, ${dot(a(0.7), 0.7, 17, 11, 3)}, ${dot(a(0.45), 0.5, 9, 2, 6)}, conic-gradient(from 200deg at 50% 50%, #ff5cc826, #ffd93d26, #3de0a826, #3da8ff26, #a86bff26, #ff5cc826)`;
    case "sunburst":
      return `repeating-conic-gradient(from 0deg at 50% 50%, ${a(0.55)} 0 3deg, transparent 3deg 10deg), radial-gradient(closest-side, transparent 55%, ${a(0.3)})`;
  }
}

/**
 * The scene's CSS variables for a design: the edge (--e1 front, --e2, --core, --e3 back, --edge-fill,
 * --edge-shine), the back (--bk-field, --bk-ink, --bk-motif, --bk-foil) and the
 * halo (--glow, --glow-k). Static per face; inline on the scene.
 */
export function templateStyle(key: string | null | undefined): CSSProperties {
  const tpl = templateOf(key);
  const { edge, back, glow } = tpl;
  return {
    "--e1": edge.front,
    "--e2": edge.mid,
    "--core": edge.core,
    "--e3": edge.back,
    "--edge-fill": edgeFill(edge),
    "--edge-shine": edge.shine,
    "--bk-field": back.field,
    "--bk-ink": back.ink,
    "--bk-motif": motifCss(back.motif, back.ink, back.motifK),
    "--bk-foil": `linear-gradient(115deg, transparent 36%, ${back.foil.map((c, i) => `${c} ${42 + (i * 16) / Math.max(1, back.foil.length - 1)}%`).join(", ")}, transparent 64%)`,
    "--glow": glow.color,
    "--glow-k": glow.k,
  } as CSSProperties;
}
