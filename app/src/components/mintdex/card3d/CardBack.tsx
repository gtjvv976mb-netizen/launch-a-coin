/**
 * The printed back (the Holo Seal plate): BackFace inside a 3D card, CardBack on its own (empty states, the
 * unverified-mint fallback) and CardDeck (three stacked mini backs, the deal's origin).
 */
import type { Ref } from "react";

import { BACK_SRC, BACK_SRCSET, BackFace } from "./backface";
import { Card3DView } from "./Card3D";

const HAND_BACK_TIER = { finish: "print" as const, sheen: ["#f6c6dd", "#c8f0de", "#c6e0f5"], ring: "#dccdf5" };

/**
 * A standalone card back (spec 4.10). `flat` is the plain plate (today's .mdx-cardback); `hand` breathes, peeks
 * and its seal follows the pointer, with no flip. Decorative (aria-hidden) unless `title` is given.
 */
export function CardBack({ depth = "flat", title, className = "" }: { depth?: "flat" | "hand"; title?: string; className?: string }) {
  if (depth === "hand") {
    return (
      <div className={className} title={title} aria-hidden={title ? undefined : true}>
        <Card3DView
          depth="hand"
          label={title ?? "Card back"}
          faces={[{ key: "back", node: <BackFace sizes="(max-width: 1023px) 220px, 300px" face eager />, tier: HAND_BACK_TIER }]}
          front="back"
          flippable={false}
          tapTurns={false}
          drag="none"
          idle="breathe-peek"
          gyro
          noBack
          outside="none"
        />
      </div>
    );
  }
  return (
    <div
      className={`mdx-cardback ${className}`}
      title={title}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <img src={BACK_SRC} srcSet={BACK_SRCSET} sizes="(max-width: 1023px) 220px, 300px" alt="" draggable={false} />
    </div>
  );
}

/** Three stacked mini backs (44px): hidden at rest; the deal and the gather show it and fly from it. */
export function CardDeck({ ref, className = "" }: { ref?: Ref<HTMLDivElement>; className?: string }) {
  return (
    <div ref={ref} className={`mdx-deck ${className}`} aria-hidden>
      <i />
      <i />
      <i />
    </div>
  );
}
