import type { CSSProperties } from "react";

import { EDITION_CATALOG, getEdition, type EditionKey } from "../../../lib/mintdex/editions";
import { edgeFill, motifCss, type BackMotif, type EdgeMaterial } from "./templates";

/** Cosmetic material only: this does not change a card's earned tier, rights or market-cap data. */
const MATERIALS: Record<EditionKey, { edge: EdgeMaterial; motif: BackMotif; strength: number; shine: number }> = {
  wildtype: { edge: "lacquer", motif: "petals", strength: 0.42, shine: 0.7 },
  ronin: { edge: "stock", motif: "grain", strength: 0.3, shine: 0.32 },
  astral: { edge: "polished", motif: "cosmos", strength: 0.55, shine: 0.86 },
  "neon-circuit": { edge: "brushed", motif: "bolts", strength: 0.42, shine: 0.8 },
  sovereign: { edge: "polished", motif: "guilloche", strength: 0.48, shine: 0.9 },
  abyssal: { edge: "lacquer", motif: "waves", strength: 0.48, shine: 0.8 },
};

const STYLES = new Map<EditionKey, CSSProperties>(EDITION_CATALOG.map((edition) => {
  const [base, accent, paper] = edition.palette;
  const { edge: material, motif, strength, shine } = MATERIALS[edition.key];
  const edge = {
    material,
    front: edition.key === "ronin" ? paper : accent,
    mid: `color-mix(in srgb, ${base} 45%, ${accent})`,
    core: base,
    back: `color-mix(in srgb, ${base} 65%, ${accent})`,
    shine,
  };
  // Ivory Ronin keeps its vermilion accent in the foil; its reverse stays an ink-dark print.
  const field = edition.key === "ronin" ? "#231f1c" : `color-mix(in srgb, ${base} 86%, black)`;
  const foil = [accent, paper, accent];
  return [edition.key, {
    "--e1": edge.front,
    "--e2": edge.mid,
    "--core": edge.core,
    "--e3": edge.back,
    "--edge-fill": edgeFill(edge),
    "--edge-shine": shine,
    "--bk-field": field,
    "--bk-ink": paper,
    "--bk-motif": motifCss(motif, accent, strength),
    "--bk-foil": `linear-gradient(115deg, transparent 36%, ${foil.map((color, index) => `${color} ${42 + index * 8}%`).join(", ")}, transparent 64%)`,
    "--glow": accent,
    "--glow-k": 0.55,
  } as CSSProperties];
}));

/** Merge after the earned tier's template style. Unknown or absent editions leave that style intact. */
export function editionMaterialStyle(input: unknown): CSSProperties {
  const edition = getEdition(input);
  return edition ? STYLES.get(edition.key)! : {};
}
