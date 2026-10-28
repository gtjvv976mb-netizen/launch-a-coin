/**
 * The 3D cards on the page that Claim (M15) plays on, by coin id: the coin page's case (desktop and the phone Card
 * section) and the card in Market's quick sheet. A tiny module of its own, so the pages that buy cards (the coin
 * page, Market's sheet) share it without pulling in each other's code.
 */
import { useEffect, type RefObject } from "react";

import type { Card3DHandle } from "./card3d";

type CaseEntry = { el: RefObject<HTMLElement | null>; handle: RefObject<Card3DHandle | null> };
const CASES = new Map<string, Set<CaseEntry>>();

function visibleCases(coinId: string) {
  return [...(CASES.get(coinId) ?? [])].filter(
    (c) => c.handle.current && c.el.current && c.el.current.getClientRects().length > 0,
  );
}

/**
 * Make a 3D card (its host element and its handle) one Claim may play on for this coin while it is in view.
 */
export function useClaimable(
  coinId: string,
  el: RefObject<HTMLElement | null>,
  handle: RefObject<Card3DHandle | null>,
) {
  useEffect(() => {
    const entry: CaseEntry = { el, handle };
    let set = CASES.get(coinId);
    if (!set) CASES.set(coinId, (set = new Set()));
    set.add(entry);
    return () => {
      set.delete(entry);
      if (!set.size) CASES.delete(coinId);
    };
  }, [coinId, el, handle]);
}

/**
 * Claim (M15): a confirmed card purchase or accepted bid spins the coin's card once with a ring of light, and the
 * success toast follows when it settles. Resolves at once when no such card is in view (or under calm), and never
 * later than 1.1 s.
 */
export function claimCard(coinId: string): Promise<void> {
  const live = visibleCases(coinId);
  if (!live.length) return Promise.resolve();
  return Promise.race([
    live[0].handle.current!.claim(),
    new Promise<void>((done) => setTimeout(done, 1100)),
  ]).catch(() => undefined);
}
