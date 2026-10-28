import type { CSSProperties } from "react";

import { MEME_ICON_CATALOG, getMemeIcon, type MemeIconKey } from "../../../lib/mintdex/meme-icons";
import { edgeFill, motifCss, type BackMotif, type EdgeMaterial } from "./templates";

/** Match each reusable frame's reverse and thin cut edge without changing earned rarity or rights. */
const MATERIALS: Record<MemeIconKey, { edge: EdgeMaterial; motif: BackMotif; strength: number }> = {
  doge: { edge: "polished", motif: "guilloche", strength: 0.42 },
  pepe: { edge: "lacquer", motif: "petals", strength: 0.42 },
  shib: { edge: "lacquer", motif: "chevrons", strength: 0.38 },
  bonk: { edge: "brushed", motif: "bolts", strength: 0.42 },
  wif: { edge: "brushed", motif: "lattice", strength: 0.38 },
  popcat: { edge: "lacquer", motif: "rays", strength: 0.44 },
  gamestop: { edge: "brushed", motif: "bolts", strength: 0.35 },
  amc: { edge: "polished", motif: "rays", strength: 0.35 },
  blackberry: { edge: "brushed", motif: "hex", strength: 0.32 },
  nokia: { edge: "lacquer", motif: "waves", strength: 0.35 },
  coinbase: { edge: "brushed", motif: "lattice", strength: 0.32 },
  binance: { edge: "polished", motif: "guilloche", strength: 0.4 },
  kraken: { edge: "polished", motif: "ribbons", strength: 0.42 },
  strategy: { edge: "brushed", motif: "chevrons", strength: 0.35 },
};

const STYLES = new Map<MemeIconKey, CSSProperties>(MEME_ICON_CATALOG.map((icon) => {
  const [base, accent, paper] = icon.palette;
  const { edge: material, motif, strength } = MATERIALS[icon.key];
  const edge = {
    material,
    front: accent,
    mid: `color-mix(in srgb, ${base} 45%, ${accent})`,
    core: base,
    back: `color-mix(in srgb, ${base} 65%, ${accent})`,
    shine: 0.82,
  };
  return [icon.key, {
    "--e1": edge.front,
    "--e2": edge.mid,
    "--core": edge.core,
    "--e3": edge.back,
    "--edge-fill": edgeFill(edge),
    "--edge-shine": edge.shine,
    "--bk-field": `color-mix(in srgb, ${base} 86%, black)`,
    "--bk-ink": paper,
    "--bk-motif": motifCss(motif, accent, strength),
    "--bk-foil": `linear-gradient(115deg, transparent 36%, ${accent} 42%, ${paper} 50%, ${accent} 58%, transparent 64%)`,
    "--glow": accent,
    "--glow-k": 0.55,
  } as CSSProperties];
}));

export function memeIconMaterialStyle(input: unknown): CSSProperties {
  const icon = getMemeIcon(input);
  return icon ? STYLES.get(icon.key)! : {};
}
