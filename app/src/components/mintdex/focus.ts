/**
 * Focus that stays in place (backlog P1-24, QA): where keyboard focus lands when the control that had it leaves
 * with its action. Shared by ui.tsx (Modal, toasts, the rescue observer, arrow-key paging) and sheet.tsx.
 * DOM only, client only: every function runs from an event or an effect.
 */

const TABBABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusable(el: HTMLElement) {
  return (
    !el.hasAttribute("disabled") &&
    !el.closest("[inert], [aria-hidden='true']") &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden"
  );
}

/** `el` and its ancestors, nearest first, up to (not including) <body>. Record it while `el` is still mounted. */
export function ancestry(el: Element | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el; p && p !== document.body; p = p.parentElement) if (p instanceof HTMLElement) out.push(p);
  return out;
}

/** A text field (focusing one on a touch screen raises the keyboard). */
function isTextEntry(el: HTMLElement) {
  return el.matches('textarea, input:not([type="button"], [type="submit"], [type="checkbox"], [type="radio"], [type="range"])');
}

type FocusOpts = { avoidText?: boolean };

function pick(scope: ParentNode, opts: FocusOpts, selfFirst?: HTMLElement): HTMLElement | null {
  const ok = (el: HTMLElement) => focusable(el) && !(opts.avoidText && isTextEntry(el));
  if (selfFirst?.matches("[data-focus-home]") && ok(selfFirst)) return selfFirst;
  const home = [...scope.querySelectorAll<HTMLElement>("[data-focus-home]")].find(ok);
  return home ?? [...scope.querySelectorAll<HTMLElement>(TABBABLE)].find(ok) ?? null;
}

/**
 * True only while land() moves focus itself. Fields that fill a suggested amount on focus (the bid and list
 * price fields) skip the fill then: a landing after Buy card or Cancel bid is not the player asking for a
 * price, and a filled, selected field would let one more Enter list the card or bid again.
 */
let landingNow = false;
export function isLanding() {
  return landingNow;
}

function land(el: HTMLElement) {
  if (!el.matches(TABBABLE) && !el.hasAttribute("tabindex")) el.tabIndex = -1;
  landingNow = true;
  try {
    el.focus({ preventScroll: true });
  } finally {
    landingNow = false;
  }
}

/**
 * The page's own landing spot: its first visible [data-focus-home] or h1 (made focusable, with a visible ring),
 * else main#content. Used when nothing near the lost control is left.
 */
export function focusPageHome(opts: FocusOpts = {}) {
  const main = document.getElementById("content");
  const home = [...(main?.querySelectorAll<HTMLElement>("[data-focus-home], h1") ?? [])].find(
    (el) => focusable(el) && !(opts.avoidText && isTextEntry(el)),
  );
  if (home) land(home);
  else main?.focus({ preventScroll: true });
}

/**
 * The same region after a re-render that replaced it (entering MintDex remounts the panels): an element with
 * the lost one's id, or its tag and accessible name ("form" named "Trade $SPORE").
 */
function twin(a: HTMLElement): HTMLElement | null {
  if (a.id) return document.getElementById(a.id);
  const label = a.getAttribute("aria-label");
  if (!label) return null;
  return document.querySelector<HTMLElement>(`${a.tagName.toLowerCase()}[aria-label="${CSS.escape(label)}"]`);
}

/**
 * Keyboard users keep their place: when the control that had focus leaves with its action (an accepted bid's
 * row, Cancel bid, a bid form that unmounts because the card is now yours, quick chips that hide), focus moves
 * to the nearest thing still on screen. `chain` is the lost control's ancestry (nearest first): the first
 * ancestor still mounted (or its re-rendered twin) lends its [data-focus-home] (a section title, the amount
 * field) or, failing that, its first focusable control. Nothing near is left: the page home. `avoidText` skips
 * text fields (touch screens, where focusing one raises the keyboard).
 */
export function focusNear(chain: HTMLElement[], opts: FocusOpts = {}) {
  for (const a of chain) {
    if (a.id === "content") break;
    const live = a.isConnected ? a : twin(a);
    if (!live) continue;
    const target = pick(live, opts, live);
    if (target) {
      land(target);
      return;
    }
  }
  focusPageHome(opts);
}
