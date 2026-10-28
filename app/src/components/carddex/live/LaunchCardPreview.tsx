import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CardData } from "../../mintdex/MintCard";
import { HeroTurntable } from "../HeroTurntable";

const InspectStage = lazy(() => import("../../mintdex/card3d/InspectStage"));

/** One live card at every viewport size; the separate case opens only on request. */
export function LaunchCardPreview({ card }: { card: CardData }) {
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
  return <div className="cdx-launch-card">
    <HeroTurntable card={card} followEdits viewportFit controls={<button ref={opener} type="button" className="cdx-launch-card__inspect" onClick={() => setOpen(true)} aria-haspopup="dialog">Inspect</button>} />
    {open ? <Suspense fallback={null}><InspectStage card={card} open={open} onOpenChange={setOpen} /></Suspense> : null}
  </div>;
}
