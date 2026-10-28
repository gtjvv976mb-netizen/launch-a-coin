import { useRef, type CSSProperties } from "react";
import type { CardDesign } from "../../lib/carddex/designs";
import { CANONICAL_CARD_LAYOUT, CANONICAL_CARD_TEMPLATE } from "../../lib/carddex/card-template";
import { cardArtSources } from "../../lib/mintdex/art";
import { tierForLevel } from "../../lib/mintdex/tiers";
import { CardPrint, boxStyle } from "../mintdex/CardPrint";
import { useImageFailure } from "../mintdex/image-state";
import type { CardData } from "../mintdex/MintCard";
import { GeneratedCardFinish, generatedCardStyle } from "./GeneratedCardArt";
import { CanonicalCardSkin } from "./CanonicalCardSkin";

/** All48 choices share this exact print. A skin can change decoration, never its live content boxes. */
export function CanonicalCardFace({ card, design, priority = false, sizes, compact = false, lite = false, className = "", style, label }: {
  card: CardData; design: CardDesign; priority?: boolean; sizes?: string; compact?: boolean; lite?: boolean; className?: string; style?: CSSProperties; label?: string;
}) {
  const art = useRef<HTMLImageElement>(null);
  const failure = useImageFailure(art, card.image || null, `${design.key}:${card.image ?? ""}`);
  const source = card.image ? cardArtSources(card.image) : null;
  const dark = design.key === "neon-circuit";
  const vars = {
    ...generatedCardStyle(design.key),
    "--design-base": design.palette[0], "--design-metal": design.palette[1], "--design-paper": design.palette[2],
    "--canonical-paper": dark ? "#102b30" : design.palette[2], "--canonical-ink": dark ? "#e2f4f0" : "#30251a",
    "--accent": dark ? "#e2f4f0" : "#30251a", "--card-radius": "5.04% / 3.61%", aspectRatio: "63 / 88", ...style,
  } as CSSProperties;
  return <div className={`mdx-card cdx-canonical-card ${compact ? "mdx-card--compact" : ""} ${className}`} data-card-template={design.key} data-content-template={CANONICAL_CARD_TEMPLATE} data-card-layout={CANONICAL_CARD_TEMPLATE} data-finish={design.finish} data-carddex-premium="" style={vars} role={label ? "img" : undefined} aria-label={label}>
    <CanonicalCardSkin cardTemplate={design.key} priority={priority} sizes={sizes} />
    <div className="mdx-card__art" style={boxStyle(CANONICAL_CARD_LAYOUT.window)} data-card-slot="art">
      {card.image ? <img ref={art} src={source?.card ?? card.image} srcSet={source?.srcSet} sizes={source ? sizes ?? (priority ? "300px" : "auto, 300px") : undefined} alt="" hidden={failure.failed} draggable={false} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : undefined} onError={failure.onError} onLoad={failure.onLoad} /> : null}
      {!card.image || failure.failed ? <div className="cdx-canonical-card__art-fallback">{failure.failed ? "Artwork unavailable" : "Your token art"}</div> : null}
    </div>
    <CardPrint card={card} layout={CANONICAL_CARD_LAYOUT} tier={tierForLevel(design.materialLevel)} preview={card.dexNo<=0} />
    {!lite ? <div className="mdx-card__lights" aria-hidden><GeneratedCardFinish cardTemplate={design.key} /><div className="mdx-card__gloss" /><div className="mdx-card__rim" /></div> : null}
  </div>;
}
