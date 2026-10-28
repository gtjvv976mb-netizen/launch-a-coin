/** EmptyState, apart from ui.tsx so the card back (the card engine) loads only with the pages that show one. */
import { useRef, type ReactNode } from "react";

import { CardBack } from "./card3d/CardBack";
import { Ledge, Pocket, usePauseGate } from "./ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Centered empty state: the card back in its tray on a ledge, a title, one sentence, then the actions (one button,
 * then an optional TextLink; the button is primary only when the view has no other primary). `hero` (signed-out
 * Portfolio): a larger held back over a slow holo glow, two more backs fanned behind it that drift (paused
 * offscreen, in a hidden tab and under dialogs; still under calm). `inline`: no card back, for a no-results line or
 * an empty list inside a pane (Discover and Designs search, an empty chart or activity, empty Portfolio tabs).
 */
export function EmptyState({
  title,
  body,
  action,
  hero = false,
  inline = false,
  className = "",
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  hero?: boolean;
  inline?: boolean;
  className?: string;
}) {
  const fanRef = useRef<HTMLDivElement>(null);
  usePauseGate(fanRef, { margin: "0px" });
  return (
    <div className={cx("mdx-empty", inline && "mdx-empty--inline", className)}>
      <div className="flex max-w-[360px] flex-col items-center text-center">
        {inline ? null : hero ? (
          <div ref={fanRef} className="mdx-fan">
            {/* Operate screen: the fan holds still (no drifting side cards, no aura); the held back keeps the
                card engine's own idle. */}
            <div aria-hidden className="mdx-fan__card mdx-fan__card--l">
              <CardBack />
            </div>
            <div aria-hidden className="mdx-fan__card mdx-fan__card--r">
              <CardBack />
            </div>
            <Pocket className="mdx-fan__hero [--pocket:6px]">
              <CardBack depth="hand" />
            </Pocket>
          </div>
        ) : (
          // 6px at every width (delta 4): the phone 4px rule exists for the 12px shelf gap, and this card has no
          // neighbors and stays 112px wide on phones. The back is a held card: it breathes, peeks and its seal
          // follows the pointer (calm: still).
          <Pocket className="w-[112px] [--pocket:6px]">
            <CardBack depth="hand" />
          </Pocket>
        )}
        {inline ? null : <Ledge className={hero ? "w-[260px]" : "w-[200px]"} />}
        <p className={cx("mdx-empty__title", inline && "mt-0")}>{title}</p>
        {body ? <p className="mdx-empty__body">{body}</p> : null}
        {action ? <div className="mdx-empty__action">{action}</div> : null}
      </div>
    </div>
  );
}
