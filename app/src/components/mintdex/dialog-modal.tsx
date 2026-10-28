/** The centered Radix dialog behind Modal (ui.tsx) on desktop, loaded on demand. */
import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";

import { CardMotionProvider } from "./card3d/context";
import { ancestry, focusNear } from "./focus";
import { IconButton, type ModalProps } from "./ui";

/**
 * One panel (styles/screens/overlays.css .cdx-overlay), the compact anatomy with 16px padding: the title and a quiet
 * Close on one row, then the body, which grows with its content up to the window and scrolls inside past that. A `.mdx-sheet-foot` in the body stays on
 * the panel's bottom edge while the body scrolls. A control marked data-autofocus takes focus on open (the safe
 * answer of a destructive confirm); otherwise Radix focuses the first control.
 */
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
  const panel = useRef<HTMLDivElement>(null);
  // What had focus when the panel opened, read while rendering the open state: a field inside with autoFocus takes
  // focus during the commit, and Radix then skips onOpenAutoFocus altogether.
  const wasOpen = useRef(false);
  if (open !== wasOpen.current) {
    wasOpen.current = open;
    if (open && typeof document !== "undefined") {
      const el = document.activeElement;
      returnTo.current = el instanceof HTMLElement && el !== document.body ? el : null;
      returnChain.current = ancestry(returnTo.current);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="mdx-overlay cdx-overlay-backdrop" />
        <Dialog.Content
          ref={panel}
          aria-modal="true"
          className="mdx-dialog cdx-overlay cdx-overlay--dialog"
          style={{ maxWidth: width }}
          onOpenAutoFocus={(e) => {
            // The opener may have moved since the render (a menu that closed and handed focus to its trigger).
            const el = document.activeElement;
            if (el instanceof HTMLElement && el !== document.body && !panel.current?.contains(el)) {
              returnTo.current = el;
              returnChain.current = ancestry(el);
            }
            const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]");
            if (first) {
              e.preventDefault();
              first.focus({ preventScroll: true });
            }
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
          <div className="cdx-overlay__head">
            <Dialog.Title className="cdx-overlay__title">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon="close" label="Close" className="cdx-overlay__close" />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
          ) : null}
          {/* Cards inside a dialog lift in after its entrance (M11) and keep moving while it is open. */}
          <div className="cdx-overlay__body">
            <CardMotionProvider enter="liftin">{children}</CardMotionProvider>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
