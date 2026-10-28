import { dexNo } from "../../../lib/mintdex/format";
import type { CardData } from "../MintCard";
import type { EdgeBox } from "./extrude";

const CARD_H = (100 * 88) / 63;

/** The card remains 100 × 139.683 cqw; the transparent protective case surrounds it. */
export function caseBox(labeled = true): EdgeBox {
  const top = labeled ? 28 : 6;
  return { x: -6, y: -top, w: 112, h: CARD_H + top + 6, r: 7.5 };
}

function caseIdentifier(card: CardData): string {
  return card.mintAddress
    ? `${card.mintAddress.slice(0, 5)}...${card.mintAddress.slice(-4)}`
    : card.dexLabel ?? dexNo(card.dexNo);
}

/** Shared front/back optics and label for both the page case and its full-screen turntable. */
export function CasePlate({ card, side }: { card: CardData; side: "front" | "back" }) {
  return (
    <div className={`mdx-case__plate mdx-case__plate--${side}`} data-case-side={side} aria-hidden="true">
      <i className="mdx-case__acrylic" />
      <i className="mdx-case__bevel" />
      <i className="mdx-case__gasket" />
      <i className="mdx-case__well" />
      <i className="mdx-case__rail mdx-case__rail--left" />
      <i className="mdx-case__rail mdx-case__rail--right" />
      <div className={`mdx-case__label${side === "back" ? " mdx-case__label--back" : ""}`}>
        <div className="mdx-case__name">
          <b>CardDex</b>
          <span>{caseIdentifier(card)}</span>
        </div>
        <div className="mdx-case__no">
          <b>1/1</b>
          <span>One of one</span>
        </div>
        <i className="mdx-case__holo" />
      </div>
      <i className="mdx-case__gloss" />
      <i className="mdx-case__rim" />
    </div>
  );
}
