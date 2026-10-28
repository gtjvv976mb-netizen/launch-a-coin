/**
 * The inline turntables (owner 2026-10-17: "the 3d turntable available on the main site itself while users scroll
 * through the tokens"). Every table card in a list (Shelf) registers here. Only cards well inside the viewport
 * spin, the ones nearest its middle first, at most 8 at once on desktop and 4 on phones; the rest rest facing
 * front. Scrolling gives the spinning cards a push. Full motion only: lite and calm keep every card at rest, and the
 * engine already pauses everything in a hidden tab and under dialogs.
 */
import { Engine, motionLevel, onMotionLevel, type Body } from "./motion3d";

export type SpinCard = {
  /** The body to spin (made on demand); null under calm. */
  body(): Body | null;
  /** The printed back and the walls, before the first turn. */
  prepare(): void;
  seed: number;
};

type Entry = SpinCard & { el: HTMLElement; ratio: number; on: boolean };

const entries = new Map<HTMLElement, Entry>();
let io: IntersectionObserver | null = null;
let wired = false;
let raf = 0;
let repickTimer = 0;
const scrollTops = new WeakMap<EventTarget, number>();

/** How many list cards may spin at once. */
export function spinCap() {
  if (typeof window === "undefined") return 0;
  const phone = window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768;
  return phone ? 4 : 8;
}

/** A slow turn, about 9 to 16 s a revolution, different per card so a row never turns in step. */
function rateOf(seed: number) {
  return 23 + ((Math.abs(seed) * 37) % 11) * 1.5;
}

function schedule() {
  if (raf || typeof window === "undefined") return;
  raf = requestAnimationFrame(pick);
}

function pick() {
  raf = 0;
  const full = motionLevel() === "full" && !document.hidden;
  const cap = spinCap();
  const mid = window.innerHeight / 2;
  const midX = window.innerWidth / 2;
  const cands: Array<{ e: Entry; d: number }> = [];
  if (full) {
    for (const e of entries.values()) {
      if (!e.el.isConnected || e.ratio < 0.35) continue;
      const r = e.el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid) + 0.25 * Math.abs(r.left + r.width / 2 - midX);
      cands.push({ e, d });
    }
    cands.sort((a, b) => a.d - b.d);
  }
  const chosen = new Set(cands.slice(0, cap).map((c) => c.e));
  let i = 0;
  for (const e of entries.values()) {
    const on = chosen.has(e);
    if (on === e.on) continue;
    e.on = on;
    if (on) {
      const b = e.body();
      if (!b) {
        e.on = false;
        continue;
      }
      e.prepare();
      // A small stagger, so cards that come into view together do not start in step.
      b.spinFrom = performance.now() + (i++ % 8) * 420 + (Math.abs(e.seed) % 5) * 150;
      b.spinRate = rateOf(e.seed);
      b.spinCard = true;
      e.el.setAttribute("data-spin", "");
    } else {
      const b = e.body();
      if (b) b.spinRate = 0;
      e.el.removeAttribute("data-spin");
    }
  }
  Engine.kick();
}

function onScroll(ev: Event) {
  const t = ev.target === document ? document.scrollingElement : (ev.target as Element | null);
  if (!t || !("scrollTop" in t)) return;
  const top = (t as Element).scrollTop;
  const last = scrollTops.get(t) ?? top;
  scrollTops.set(t, top);
  const dy = Math.abs(top - last);
  if (dy > 0 && motionLevel() === "full") {
    // The page's scroll pushes the turn along (capped, so a fling never whirls the cards).
    const push = Math.min(140, dy * 3);
    for (const e of entries.values()) {
      if (!e.on) continue;
      const b = e.body();
      if (b && b.spinOn) b.spinBoost = Math.min(160, b.spinBoost + push * 0.35);
    }
    Engine.kick();
  }
  // Re-rank which cards spin once the scroll pauses (the nearest to the middle win).
  clearTimeout(repickTimer);
  repickTimer = window.setTimeout(schedule, 140);
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(
      (list) => {
        for (const en of list) {
          const e = entries.get(en.target as HTMLElement);
          if (e) e.ratio = en.isIntersecting ? en.intersectionRatio : 0;
        }
        schedule();
      },
      { threshold: [0, 0.2, 0.35, 0.5, 0.75, 1] },
    );
  }
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("resize", schedule, { passive: true });
  onMotionLevel(schedule);
}

/** Register a list card; returns the unregister. */
export function registerSpin(el: HTMLElement, card: SpinCard) {
  if (typeof window === "undefined") return () => {};
  wire();
  const e: Entry = { ...card, el, ratio: 0, on: false };
  entries.set(el, e);
  io?.observe(el);
  return () => {
    io?.unobserve(el);
    entries.delete(el);
    el.removeAttribute("data-spin");
    if (e.on) schedule();
  };
}

/** Tests and the motion check: how many list cards spin now. */
export function spinningCount() {
  let n = 0;
  for (const e of entries.values()) if (e.on) n++;
  return n;
}
