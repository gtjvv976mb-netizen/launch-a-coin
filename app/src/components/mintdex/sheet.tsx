/**
 * Phone sheets (backlog P1-1, decision C10). The drawer primitive lives here, on vaul directly, instead of
 * reusing src/components/ui/drawer.tsx (that file stays untouched and out of the chrome).
 *
 *   Sheet          open (req), onOpenChange (req), title (req), description (sr-only), children (req). A bottom
 *                  sheet: panel fill, 24px top corners, a grip, swipe down (or tap outside, Escape, the 44px
 *                  close) to dismiss, with viewport-bounded pages and safe-area padding. It
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
import { lazy, Suspense, useEffect, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { useOpenedOnce } from "./opened-once";

import "../../carddex-overlays.css";

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
export function isTextField(el: Element | null): el is HTMLElement {
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

const loadDrawer = () => import("./sheet-drawer");
const SheetDrawer = lazy(loadDrawer);

type SheetProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * Sheets never render open on the server or at hydration (they open after an interaction), so the drawer mounts
 * on first open (see useOpenedOnce).
 */
export function Sheet(props: SheetProps) {
  if (!useOpenedOnce(props.open, loadDrawer)) return null;
  return (
    <Suspense fallback={null}>
      <SheetDrawer {...props} />
    </Suspense>
  );
}
