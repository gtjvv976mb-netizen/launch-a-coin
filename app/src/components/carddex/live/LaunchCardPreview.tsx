import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CardData } from "../../mintdex/MintCard";
import { getCardDesign } from "../../../lib/carddex/designs";
import { getTradingPair } from "../../../lib/carddex/pairs";
import { Icon } from "../../mintdex/ui";
import { CanonicalCardFace } from "../CanonicalCardFace";
import { CardControlButton } from "../CardControls";
import { HeroTurntable } from "../HeroTurntable";

const InspectStage = lazy(() => import("../../mintdex/card3d/InspectStage"));

/** The 3D viewer on request: open state, and focus back on the control that opened it once it closes. */
function useViewer() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const target = opener.current;
    const frame = requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return { open, setOpen, opener };
}

/** One live card on the stage (tablet and desktop); the separate 3D case opens only on request. */
export function LaunchCardPreview({ card }: { card: CardData }) {
  const viewer = useViewer();
  return <div className="cdx-launch-card">
    <HeroTurntable card={card} followEdits viewportFit controls={<CardControlButton ref={viewer.opener} icon="rotate-3d" label={`View in 3D: ${card.name}`} tip="View in 3D" className="cdx-launch-card__inspect" onClick={() => viewer.setOpen(true)} aria-haspopup="dialog" />} />
    {viewer.open ? <Suspense fallback={null}><InspectStage card={card} open={viewer.open} onOpenChange={viewer.setOpen} /></Suspense> : null}
  </div>;
}

/**
 * Phones and landscape phones: the same live card as one compact row above the form (a small face, the coin, its
 * design and pair); a tap opens it in 3D. The design name is on screen here, so a design picked elsewhere is
 * confirmed at the top of the page.
 */
export function LaunchCardRow({ card }: { card: CardData }) {
  const viewer = useViewer();
  const design = getCardDesign(card.cardTemplate);
  return <>
    <button ref={viewer.opener} type="button" className="cdx-launch-row" onClick={() => viewer.setOpen(true)} aria-haspopup="dialog" aria-label={`Preview your card in 3D: ${card.name}, ${design.name}`}>
      <span className="cdx-launch-row__face" aria-hidden><CanonicalCardFace card={card} design={design} compact lite sizes="48px" /></span>
      <span className="cdx-launch-row__text">
        <strong>{card.name}{card.ticker ? <span className="cdx-launch-row__ticker"> · ${card.ticker}</span> : null}</strong>
        <span>{design.name} · {getTradingPair(card.ticker, card.quoteAssetKey)}</span>
      </span>
      <span className="cdx-launch-row__go" aria-hidden><Icon name="rotate-3d" />3D</span>
    </button>
    {viewer.open ? <Suspense fallback={null}><InspectStage card={card} open={viewer.open} onOpenChange={viewer.setOpen} /></Suspense> : null}
  </>;
}
