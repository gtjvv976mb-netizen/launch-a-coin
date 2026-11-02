import { pairLogo } from "../../lib/carddex/pair-logos";
import type { PairAsset } from "../../lib/carddex/pairs";
import { pairMonogram } from "./pair-groups";

/**
 * A pair's logo in a gold-ringed circle: the token's own image (public/assets/pairs, 64 px and 128 px WebP), or its
 * letter when it has none (GORK, MANIFEST). Decorative: the symbol is always written beside it. No state, so it renders
 * the same on the server and in the browser.
 */
export function PairLogo({ asset, size = 24, className }: { asset: Readonly<PairAsset>; size?: number; className?: string }) {
  const files = pairLogo(asset.key);
  const classes = ["cdx-pair-logo", files ? "cdx-pair-logo--img" : "cdx-pair-logo--mono", className].filter(Boolean).join(" ");
  return (
    <span aria-hidden className={classes}>
      {files ? (
        <img
          src={files.w64}
          srcSet={`${files.w64} 64w, ${files.w128} 128w`}
          sizes={`${size}px`}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : pairMonogram(asset)}
    </span>
  );
}
