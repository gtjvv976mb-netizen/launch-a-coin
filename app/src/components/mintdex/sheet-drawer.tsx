/** The vaul bottom sheet behind Sheet (sheet.tsx), loaded on demand so vaul stays out of the shared chunk. */
import { useRef, type ReactNode } from "react";
import { Drawer } from "vaul";

import { CardMotionProvider } from "./card3d";
import { ancestry, focusNear } from "./focus";
import { isCoarsePointer, isTextField } from "./sheet";

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M2.5 2.5l9 9M11.5 2.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
  return (
    // autoFocus: focus moves into the sheet (the first field with autoFocus, else the first control), so
    // keyboard and screen reader users land inside it.
    <Drawer.Root open={open} onOpenChange={onOpenChange} autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="mdx-sheet-overlay fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Drawer.Content
          className="mdx-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[600px] flex-col rounded-t-panel bg-plinth text-ink shadow-modal outline-none"
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            // Never hand focus back to a text field on a touch screen: that would raise the keyboard again.
            returnTo.current =
              el instanceof HTMLElement &&
              el !== document.body &&
              !(isCoarsePointer() && isTextField(el))
                ? el
                : null;
            returnChain.current = ancestry(
              el instanceof HTMLElement && el !== document.body ? el : null,
            );
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
          <div aria-hidden className="mdx-sheet__grip" />
          <div className="mdx-sheet__head flex flex-none items-start justify-between gap-4">
            <Drawer.Title className="min-w-0 pt-2.5 text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">
              {title}
            </Drawer.Title>
            <Drawer.Close
              className="-mr-2.5 grid h-11 w-11 flex-none place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track"
              aria-label="Close"
            >
              <CloseGlyph />
            </Drawer.Close>
          </div>
          {description ? (
            <Drawer.Description className="sr-only">{description}</Drawer.Description>
          ) : null}
          <div className="mdx-sheet__body min-h-0 flex-1">
            {/* Cards inside a sheet lift in after it slides up (M11). */}
            <CardMotionProvider enter="liftin">{children}</CardMotionProvider>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
