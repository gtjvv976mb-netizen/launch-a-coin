/**
 * The velvet stage (spec 4.10, 5.3), a lazy chunk: a night vitrine with a static spotlight, a warm floor glow and a
 * tier-tinted floor pool (never a reflection). The labeled case unboxes on open, breathes and turns slowly (25
 * deg/s) until someone touches it; Turn over and Close; Esc closes and focus returns to the opener (Radix). Built on
 * Radix Dialog, so isDialogOpen() sees it and the page's bodies sleep underneath.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type CSSProperties } from "react";

import { tierForLevel } from "../../../lib/mintdex/tiers";
import { cardDesign, type CardData } from "../MintCard";
import { CaseScene } from "./CardCase";
import { GyroChip } from "./GyroChip";
import type { Card3DHandle } from "./types";

export default function InspectStage({
  card,
  open,
  onOpenChange,
}: {
  card: CardData;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const handle = useRef<Card3DHandle | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const tier = tierForLevel(cardDesign(card).materialLevel);
  const pool = tier.sheen.length > 1 ? tier.sheen[1] : tier.ring;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          className="mdx-inspect"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            close.current?.focus();
          }}
          // CardCase hands focus back to the opener (Inspect opens without a Radix Trigger).
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Inspect the {card.name} card</Dialog.Title>
          <i className="mdx-inspect__spot" aria-hidden />
          <i className="mdx-inspect__floor" aria-hidden />
          <Dialog.Close ref={close} className="mdx-inspect__btn mdx-inspect__close">
            Close
          </Dialog.Close>
          <div className="mdx-inspect__stage" style={{ "--pool": pool } as CSSProperties}>
            <i className="mdx-inspect__pool" aria-hidden />
            <CaseScene
              card={card}
              kind="inspect"
              variant="labeled"
              controls="none"
              unbox
              gyroChip={false}
              turntable
              sizes="(max-width: 1023px) 70vw, 300px"
              ref={handle}
            />
          </div>
          <div className="mdx-inspect__bar">
            <button type="button" className="mdx-inspect__btn" onClick={() => handle.current?.turnOver(1)}>
              Turn over
            </button>
            {/* "Tilt to shine" (iOS) in the bar, beside Turn over: never over the case or the bar. */}
            <GyroChip className="mdx-inspect__btn" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
