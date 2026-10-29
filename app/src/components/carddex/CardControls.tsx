import { lazy, Suspense, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import type { CardData } from "../mintdex/MintCard";
import { Icon, type IconName } from "../mintdex/icons";

const InspectStage = lazy(() => import("../mintdex/card3d/InspectStage"));

/**
 * The compact card-controls row (density R6 and R8, .taste-skill/density/rules.md): a card keeps Turn over,
 * Pause or Resume spin and View in 3D in less room, as 36px icon buttons (44px on touch) that carry their accessible
 * name and show it as a tooltip on hover (after a short delay) and on keyboard focus (at once). One row, centred
 * under the card; HeroTurntable (Launch, Designs) and the 3D viewer use it, and any card stage can.
 */
export function CardControls({ label = "Card controls", children, className = "" }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`cdx-card-controls ${className}`}>
      {children}
    </div>
  );
}

/** One control in the row. `label` is the accessible name; `tip` the shorter tooltip when the name is long. */
export function CardControlButton({
  icon,
  label,
  tip,
  ref,
  className = "",
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { icon: IconName; label: string; tip?: string; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type={type} aria-label={label} data-tip={tip ?? label} className={`mdx-btn mdx-btn--outline mdx-btn--icon cdx-card-control ${className}`} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

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

/**
 * A turntable stage's View in 3D: the row's last control and the 3D case it opens on request (InspectStage, loaded
 * then), so every stage with a controls row (Launch, Designs, the coin case) offers Turn over, Pause and View in 3D.
 */
export function useViewIn3D(card: CardData, className = "") {
  const viewer = useViewer();
  return {
    control: <CardControlButton ref={viewer.opener} icon="rotate-3d" label={`View in 3D: ${card.name}`} tip="View in 3D" className={className} onClick={() => viewer.setOpen(true)} aria-haspopup="dialog" />,
    viewer: viewer.open ? <Suspense fallback={null}><InspectStage card={card} open={viewer.open} onOpenChange={viewer.setOpen} /></Suspense> : null,
  };
}
