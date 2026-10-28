/** EmptyState, apart from ui.tsx so the card back (the card engine) loads only with the pages that show one. */
import { useRef, type ReactNode } from "react";

import { CardBack } from "./card3d/CardBack";
import { Ledge, Pocket, usePauseGate } from "./ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Centered empty state: the card back in its tray on a ledge, a title, one sentence, one optional action. `hero`
 * (signed-out Portfolio): a larger held back over a slow holo glow, with two more backs fanned behind it that
 * drift (paused offscreen, in a hidden tab and under dialogs; still under calm).
 */
export function EmptyState({
  title,
  body,
  action,
  hero = false,
  className = "",
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  hero?: boolean;
  className?: string;
}) {
  const fanRef = useRef<HTMLDivElement>(null);
  usePauseGate(fanRef, { margin: "0px" });
  return (
    <div className={cx("grid h-full min-h-[320px] place-items-center px-4 py-8", className)}>
      <div className="flex max-w-[360px] flex-col items-center text-center">
        {hero ? (
          <div ref={fanRef} className="mdx-fan">
            <div aria-hidden className="mdx-fan__aura">
              <i />
            </div>
            <div aria-hidden className="mdx-fan__card mdx-fan__card--l">
              <div className="mdx-fan__float">
                <CardBack />
              </div>
            </div>
            <div aria-hidden className="mdx-fan__card mdx-fan__card--r">
              <div className="mdx-fan__float">
                <CardBack />
              </div>
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
        <Ledge className={hero ? "w-[260px]" : "w-[200px]"} />
        <p className="mt-4 text-[17px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
          {title}
        </p>
        {body ? (
          <p className="mt-1 text-pretty text-[13px] leading-[1.45] text-slate">{body}</p>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}
