/** The centered Radix dialog behind Modal (ui.tsx) on desktop, loaded on demand. */
import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";

import { CardMotionProvider } from "./card3d/context";
import { ancestry, focusNear } from "./focus";
import type { ModalProps } from "./ui";

export default function DialogModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 440,
}: ModalProps) {
  // Modals open without a Radix Trigger, so Radix has nothing to refocus on close and focus would fall
  // to <body>. Remember what had focus when the dialog opened and hand focus back to it on close.
  const returnTo = useRef<HTMLElement | null>(null);
  const returnChain = useRef<HTMLElement[]>([]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="mdx-overlay fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-modal="true"
          className="mdx-dialog fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-aside bg-plinth p-6 text-ink shadow-modal outline-none max-lg:rounded-panel"
          style={{ maxWidth: width }}
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            returnTo.current = el instanceof HTMLElement && el !== document.body ? el : null;
            returnChain.current = ancestry(returnTo.current);
          }}
          onCloseAutoFocus={(e) => {
            const el = returnTo.current;
            returnTo.current = null;
            e.preventDefault();
            if (el?.isConnected) el.focus({ preventScroll: true });
            // The opener left with the action (an accepted bid's row, a signed-out button that became another):
            // keep the place next to where it was, with a visible ring, instead of <body> or the ringless main.
            else focusNear(returnChain.current);
          }}
          // No description: drop aria-describedby so screen readers do not read the title twice
          // (this explicit undefined is also how Radix opts out of its missing-description check).
          {...(description ? null : { "aria-describedby": undefined })}
        >
          <div className="mdx-dialog__head flex flex-none items-start justify-between gap-4">
            <Dialog.Title className="pt-1 text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
              {title}
            </Dialog.Title>
            {/* 40px circle under a fine pointer, 44px on phones and touch screens (backlog P1-25); the negative margins
                keep the glyph put. Only the fill and ink fade: the focus ring never transitions. */}
            <Dialog.Close
              className="-mr-3 -mt-2 grid h-10 w-10 flex-none place-items-center rounded-pill text-ink transition-[background-color,color] duration-(--t-fast) ease-room hover:bg-track pointer-coarse:-mr-3.5 pointer-coarse:-mt-2.5 pointer-coarse:h-11 pointer-coarse:w-11 max-lg:-mr-3.5 max-lg:-mt-2.5 max-lg:h-11 max-lg:w-11"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path
                  d="M2.5 2.5l9 9M11.5 2.5l-9 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
          ) : null}
          {/* Cards inside a dialog lift in after its entrance (M11) and keep moving while it is open. */}
          <div className="mdx-dialog__body min-h-0 flex-1">
            <CardMotionProvider enter="liftin">{children}</CardMotionProvider>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
