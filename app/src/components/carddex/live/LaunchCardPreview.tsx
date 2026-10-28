import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CardData } from "../../mintdex/MintCard";
import { getCardDesign } from "../../../lib/carddex/designs";
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

/** Phones: the same live card as a small face beside the step title; a tap opens it in 3D. */
export function LaunchCardThumb({ card }: { card: CardData }) {
  const viewer = useViewer();
  return <>
    <button ref={viewer.opener} type="button" className="cdx-launch-thumb" onClick={() => viewer.setOpen(true)} aria-haspopup="dialog" aria-label={`Preview card in 3D: ${card.name}`}>
      <span className="cdx-launch-thumb__card" aria-hidden><CanonicalCardFace card={card} design={getCardDesign(card.cardTemplate)} compact lite sizes="72px" /></span>
      <span className="cdx-launch-thumb__label" aria-hidden>Preview</span>
    </button>
    {viewer.open ? <Suspense fallback={null}><InspectStage card={card} open={viewer.open} onOpenChange={viewer.setOpen} /></Suspense> : null}
  </>;
}
