import type { CSSProperties } from "react";
import { getCardDesign } from "../../../lib/carddex/designs";
import { edgeFill, motifCss } from "./templates";
import { editionMaterialStyle } from "./edition-material";
import { memeIconMaterialStyle } from "./meme-icon-material";

/** The matching premium edge and reverse follow the selected print, never a market-cap tier. */
export function designMaterialStyle(key?: string): CSSProperties {
  const design = getCardDesign(key);
  const [base, metal, paper] = design.palette;
  const edge = { material: "polished" as const, front: metal, mid: `color-mix(in srgb, ${base} 40%, ${metal})`, core: base, back: metal, shine: .92 };
  return {
    ...editionMaterialStyle(design.edition), ...memeIconMaterialStyle(design.memeIcon),
    "--e1": edge.front, "--e2": edge.mid, "--core": edge.core, "--e3": edge.back,
    "--edge-fill": edgeFill(edge), "--edge-shine": edge.shine,
    "--bk-field": base, "--bk-ink": paper, "--bk-motif": motifCss("guilloche", metal, .4),
    "--bk-foil": `linear-gradient(115deg, transparent 36%, ${metal} 42%, ${paper} 50%, ${metal} 58%, transparent 64%)`,
    "--glow": metal, "--glow-k": .55,
  } as CSSProperties;
}
