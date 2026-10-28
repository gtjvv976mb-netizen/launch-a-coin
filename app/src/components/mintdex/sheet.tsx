/**
 * Phone sheets (backlog P1-1, decision C10). The drawer primitive lives here, on vaul directly, instead of
 * reusing src/components/ui/drawer.tsx (that file stays untouched and out of the chrome).
 *
 *   Sheet          open (req), onOpenChange (req), title (req), description (sr-only), children (req). A bottom
 *                  sheet: panel fill, 24px top corners, a grip, swipe down (or tap outside, Escape, the 44px
 *                  close) to dismiss, up to 90% of the screen tall with its own scroll, safe-area padding. It
 *                  slides up on open and back down on close (instant under reduced motion). vaul keeps a
 *                  focused field above the on-screen keyboard (it watches visualViewport and lifts the sheet).
 *                  Wrap a dialog's call to action in .mdx-sheet-foot to pin it to the sheet's bottom edge when
 *                  the content scrolls. Mark a horizontal scroller inside with data-vaul-no-drag.
 *   useIsPhone()   true under 1024px (the phone shell). false on the server and during hydration, so use it
 *                  only for things that render after an interaction (an open sheet), never for first-paint
 *                  markup.
 *   isPhoneNow()   the same test, read once (for click handlers).
 *   isCoarsePointer() touch screens: skip autofocus there, so the keyboard does not cover a sheet as it opens.
 *   useKeyboardSafe(ref) keeps the submit button of the form in `ref` above the on-screen keyboard while one of
 *                  its fields has focus (phones, outside sheets: the coin page trade ticket).
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Drawer } from "vaul";

import { CardMotionProvider } from "./card3d";
import { ancestry, focusNear } from "./focus";

export const PHONE_MQ = "(max-width: 1023.98px)";

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_MQ).matches,
    () => false,
  );
}

export function isPhoneNow() {
  return typeof window !== "undefined" && !!window.matchMedia?.(PHONE_MQ).matches;
}

export function isCoarsePointer() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

/** Text fields that raise the on-screen keyboard. */
function isTextField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["range", "radio", "checkbox", "file", "button", "submit", "color"].includes(type);
}

/**
 * While a field inside the form has focus on a phone and the on-screen keyboard shrinks the visual viewport,
 * scroll the page just enough that the form's submit button sits above the keyboard, never pushing the
 * focused field off the top. Re-checks on every visualViewport resize (the keyboard animating in).
 */
export function useKeyboardSafe(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const form = ref.current;
    if (!vv || !form) return;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!isPhoneNow() || !isCoarsePointer()) return;
        const active = document.activeElement;
        if (!isTextField(active) || !form.contains(active)) return;
        const submit = form.querySelector<HTMLElement>('button[type="submit"]');
        if (!submit) return;
        const bottom = vv.offsetTop + vv.height - 12;
        const b = submit.getBoundingClientRect();
        if (b.bottom <= bottom) return;
        // Room above the field: never scroll it under the sticky header (56px plus a margin).
        const fieldTop = active.getBoundingClientRect().top - vv.offsetTop;
        const delta = Math.min(b.bottom - bottom, Math.max(0, fieldTop - 72));
        if (delta > 1) window.scrollBy({ top: delta, behavior: "auto" });
      });
    };
    vv.addEventListener("resize", check);
    form.addEventListener("focusin", check);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", check);
      form.removeEventListener("focusin", check);
    };
  }, [ref]);
}

function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Sheet({
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
          className="mdx-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-[600px] flex-col rounded-t-panel bg-plinth text-ink shadow-modal outline-none"
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            // Never hand focus back to a text field on a touch screen: that would raise the keyboard again.
            returnTo.current =
              el instanceof HTMLElement && el !== document.body && !(isCoarsePointer() && isTextField(el))
                ? el
                : null;
            returnChain.current = ancestry(el instanceof HTMLElement && el !== document.body ? el : null);
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
          {description ? <Drawer.Description className="sr-only">{description}</Drawer.Description> : null}
          <div className="mdx-sheet__body mdx-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* Cards inside a sheet lift in after it slides up (M11). */}
            <CardMotionProvider enter="liftin">{children}</CardMotionProvider>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
