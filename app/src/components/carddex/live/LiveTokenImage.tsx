import type { LiveLaunchIntent } from "../../../lib/carddex/live/api";
import { useMotionLevel } from "../../mintdex/card3d/motion3d";
import { Icon, TextLink } from "../../mintdex/ui";

/**
 * The coin's image exactly as its metadata carries it: the creator's complete card turning through its front and back
 * (the server-made GIF), shown before the wallet opens. Under Calm or reduced motion it shows the full-colour still
 * instead, never the loop. A launch prepared before the turning image existed has neither, and shows nothing.
 */
export function LiveTokenImage({ intent, compact = false }: { intent: Pick<LiveLaunchIntent, "name" | "assets">; compact?: boolean }) {
  const calm = useMotionLevel() === "calm";
  const turning = intent.assets.tokenImage, still = intent.assets.tokenPoster;
  if (!turning) return null;
  const showStill = calm && !!still;
  return <figure className="cdx-live-token-image" data-compact={compact || undefined}>
    <span className="cdx-live-token-image__frame">
      <img src={showStill ? still.url : turning.url} width={1024} height={1024} decoding="async"
        alt={`${intent.name} coin image: your complete card${showStill ? ", front" : " turning from front to back"}`} />
    </span>
    <figcaption>
      <strong>Coin image</strong>
      {compact ? null : <span>{showStill ? "A still of your card. The coin image turns it front to back." : "Your complete card, turning front to back."} Wallets that cannot play it show the front.</span>}
      <span className="cdx-live-token-image__links">
        <TextLink href={turning.url} target="_blank" aria-label="Coin image animation, opens in a new tab">Animation<Icon name="external" size={12} /></TextLink>
        {still ? <TextLink href={still.url} target="_blank" aria-label="Coin image still, opens in a new tab">Still<Icon name="external" size={12} /></TextLink> : null}
      </span>
    </figcaption>
  </figure>;
}
