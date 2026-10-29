import type { CardData } from "../../mintdex/MintCard";
import { useViewIn3D } from "../CardControls";
import { HeroTurntable } from "../HeroTurntable";

/** One live card on the stage (beside the fields on phones); the separate 3D case opens only on request. */
export function LaunchCardPreview({ card }: { card: CardData }) {
  const view3d = useViewIn3D(card, "cdx-launch-card__inspect");
  return <div className="cdx-launch-card">
    <HeroTurntable card={card} followEdits viewportFit controls={view3d.control} />
    {view3d.viewer}
  </div>;
}
