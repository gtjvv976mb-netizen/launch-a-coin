/** The vaul bottom sheet behind Sheet (sheet.tsx), loaded on demand so vaul stays out of the shared chunk. */
import { useRef, type ReactNode } from "react";
import { Drawer } from "vaul";

import { CardMotionProvider } from "./card3d";
import { ancestry, focusNear } from "./focus";
import { isCoarsePointer, isTextField } from "./sheet";
import { IconButton } from "./ui";

/**
 * The phone panel (styles/screens/overlays.css .cdx-overlay--sheet), the compact anatomy with 12px padding (16px from
 * 768px): a grab handle, the title and a quiet Close, then the body, as tall as its content up to near the top of the
 * screen, scrolling inside past that, with the safe-area insets as padding when they are larger. A `.mdx-sheet-foot` in the body stays above the home indicator while the body
 * scrolls. A control marked data-autofocus takes focus on open.
 */
export default function SheetDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  // Like Modal: sheets often open without a Radix Trigger, so remember what had focus and hand it back.
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
      const opener = el instanceof HTMLElement && el !== document.body ? el : null;
      // Never hand focus back to a text field on a touch screen: that would raise the keyboard again.
      returnTo.current = opener && !(isCoarsePointer() && isTextField(opener)) ? opener : null;
      returnChain.current = ancestry(opener);
    }
  }
  return (
    // autoFocus: focus moves into the sheet (the first field with autoFocus, else the first control), so
    // keyboard and screen reader users land inside it.
    <Drawer.Root open={open} onOpenChange={onOpenChange} autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="mdx-sheet-overlay cdx-overlay-backdrop" />
        <Drawer.Content
          ref={panel}
          className="mdx-sheet cdx-overlay cdx-overlay--sheet"
          onOpenAutoFocus={(e) => {
            // The opener may have moved since the render (a menu that closed and handed focus to its trigger).
            const el = document.activeElement;
            if (el instanceof HTMLElement && el !== document.body && !panel.current?.contains(el)) {
              returnTo.current = isCoarsePointer() && isTextField(el) ? null : el;
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
            // The opener left with the action: the nearest thing still there, never a text field on a touch
            // screen (the keyboard would rise again).
            else focusNear(returnChain.current, { avoidText: isCoarsePointer() });
          }}
          {...(description ? null : { "aria-describedby": undefined })}
        >
          {/* The grip: a visual cue that the sheet swipes down. The whole sheet drags. */}
          <div aria-hidden className="cdx-overlay__grip" />
          <div className="cdx-overlay__head">
            <Drawer.Title className="cdx-overlay__title">{title}</Drawer.Title>
            <Drawer.Close asChild>
              <IconButton icon="close" label="Close" className="cdx-overlay__close" />
            </Drawer.Close>
          </div>
          {description ? (
            <Drawer.Description className="sr-only">{description}</Drawer.Description>
          ) : null}
          <div className="cdx-overlay__body">
            {/* Cards inside a sheet lift in after it slides up (M11). */}
            <CardMotionProvider enter="liftin">{children}</CardMotionProvider>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
