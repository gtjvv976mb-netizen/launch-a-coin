/**
 * CardMotionProvider / CardMotionCell (spec 4.10): the enter mode of a group of cards (deal, rise, lift-in), the
 * deck they are dealt from, and the glint group (L4, hype arcade: the holo shimmer never stops. Every 0.7 s the next
 * visible, non-held table card catches a 1.2 s light pass, weighted round robin, at most three cards at once on the
 * page; it pauses while hidden, under dialogs, under lite and calm). gather() is the shuffle's
 * first half (M9): the cards fly back to the deck face down and riffle.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";

import { motionLevel, onMotionLevel } from "./motion3d";

type GlintCard = { el: HTMLElement; weight: () => number; cur: number };

export type MotionGroup = {
  enter: "deal" | "rise" | "liftin" | "none";
  deck: RefObject<HTMLElement | null> | null;
  glint: boolean;
  /** A hard load: the server-painted cards play the wave (moments.ts) once the page settles. */
  wave: boolean;
  /** The group's table cards are inline turntables (spin.ts) unless a card asks for another idle. */
  turntable?: boolean;
  register: (el: HTMLElement, weight: () => number) => () => void;
  /** Deal bookkeeping: the deck shows while any card of the group is in flight. */
  dealStart: () => void;
  dealEnd: () => void;
};

export const MotionCtx = createContext<MotionGroup | null>(null);
export const CellCtx = createContext<{ index: number; glintWeight: number } | null>(null);

const GLINT_EVERY = 700;
const GLINT_MS = 1200;
/** At most this many cards shimmer at once (each pass repaints its card). */
const GLINT_MAX = 3;
const glinting = new Set<HTMLElement>();

/** The last gather (shuffle): the deal that follows it uses the shuffle's quicker timings. */
let lastGather = 0;
/** gather.ts marks the start of the shuffle (the following deal is quicker). */
export function markGather() {
  lastGather = performance.now();
}
export function recentlyGathered() {
  return typeof performance !== "undefined" && performance.now() - lastGather < 2500;
}

function eligible(c: GlintCard) {
  const s = c.el.dataset.state ?? "";
  return c.el.isConnected && !glinting.has(c.el) && !/\b(held|dragging|offscreen|dealing|turning|ascending)\b/.test(s);
}

export function CardMotionProvider({
  enter = "none",
  deck = null,
  glint = false,
  wave = false,
  turntable = false,
  children,
}: {
  enter?: "deal" | "rise" | "liftin" | "none";
  deck?: RefObject<HTMLElement | null> | null;
  glint?: boolean;
  wave?: boolean;
  turntable?: boolean;
  children: ReactNode;
}) {
  const cards = useRef<GlintCard[]>([]);
  const flying = useRef(0);
  const deckRef = useRef(deck);
  deckRef.current = deck;

  // The glint relay: one setTimeout chain, stopped while hidden, calm or lite, and with nothing to glint.
  useEffect(() => {
    if (!glint) return;
    let timer = 0;
    const tick = () => {
      timer = 0;
      if (document.hidden || motionLevel() !== "full") return;
      const pool = cards.current.filter(eligible);
      if (pool.length && glinting.size < GLINT_MAX && !document.body.hasAttribute("data-scroll-locked")) {
        // Smooth weighted round robin: everyone earns their weight, the richest glints and pays the total.
        let total = 0;
        let pick: GlintCard | null = null;
        for (const c of pool) {
          const w = Math.max(0.1, c.weight());
          total += w;
          c.cur += w;
          if (!pick || c.cur > pick.cur) pick = c;
        }
        if (pick) {
          pick.cur -= total;
          const el = pick.el;
          glinting.add(el);
          el.setAttribute("data-glint", "");
          window.setTimeout(() => {
            el.removeAttribute("data-glint");
            glinting.delete(el);
          }, GLINT_MS + 50);
        }
      }
      schedule();
    };
    const schedule = () => {
      if (!timer && !document.hidden && motionLevel() === "full") timer = window.setTimeout(tick, GLINT_EVERY);
    };
    const onVis = () => (document.hidden ? stop() : schedule());
    const stop = () => {
      clearTimeout(timer);
      timer = 0;
    };
    schedule();
    document.addEventListener("visibilitychange", onVis);
    const off = onMotionLevel(() => (motionLevel() === "full" ? schedule() : stop()));
    return () => {
      stop();
      off();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [glint]);

  const group = useMemo<MotionGroup>(
    () => ({
      enter,
      get deck() {
        return deckRef.current;
      },
      glint,
      wave,
      turntable,
      register(el, weight) {
        const c: GlintCard = { el, weight, cur: 0 };
        cards.current.push(c);
        return () => {
          cards.current = cards.current.filter((x) => x !== c);
        };
      },
      dealStart() {
        const d = deckRef.current?.current;
        if (flying.current++ === 0 && d) {
          d.setAttribute("data-active", "");
          d.setAttribute("data-flying", "");
        }
      },
      dealEnd() {
        if (--flying.current <= 0) {
          flying.current = 0;
          deckRef.current?.current?.removeAttribute("data-active");
          deckRef.current?.current?.removeAttribute("data-flying");
        }
      },
    }),
    [enter, glint, wave, turntable],
  );
  return <MotionCtx.Provider value={group}>{children}</MotionCtx.Provider>;
}

export function CardMotionCell({ index, glintWeight = 1, children }: { index: number; glintWeight?: number; children: ReactNode }) {
  const value = useMemo(() => ({ index, glintWeight }), [index, glintWeight]);
  return <CellCtx.Provider value={value}>{children}</CellCtx.Provider>;
}

export function useMotionGroup() {
  return useContext(MotionCtx);
}

/**
 * Shuffle phases 1 and 2 (M9) for the table cards inside `container`: gather to the deck face down, then a riffle.
 * Resolves when done; the caller then swaps the items and the new cards deal in. Calm and lite resolve at once.
 * The choreography itself is a lazy chunk (gather.ts).
 */
let gatherChunk: Promise<typeof import("./gather")> | null = null;
const loadGather = () => (gatherChunk ??= import("./gather"));

export async function gather(container: HTMLElement, deck: HTMLElement | null): Promise<void> {
  if (typeof window === "undefined" || motionLevel() !== "full") return;
  lastGather = performance.now();
  const m = await loadGather();
  return m.gatherCards(container, deck);
}

/** A shelf that can shuffle fetches the gather chunk when the page is idle, so the first shuffle starts at once. */
export function prefetchGather() {
  if (gatherChunk || typeof window === "undefined" || motionLevel() !== "full") return;
  const go = () => void loadGather();
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 5000 });
  else setTimeout(go, 2500);
}
