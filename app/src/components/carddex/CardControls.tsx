import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type IconName } from "../mintdex/icons";

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
