import { isCardDesignKey, type CardDesignKey } from "../../lib/carddex/designs";
import { PAIR_DESIGNS_2026_10_30 } from "../../lib/carddex/design-pairings";
import { DEFAULT_PAIR, boundQuoteForDesign, designForPair, getPairAsset, isOfferedPair, pairForDesign, type PairAssetKey } from "../../lib/carddex/pairs";

/**
 * Pure helpers for the one-page Launch form (routes/launch.tsx): which pair the page opens on and which card it shows
 * (the pair picks the card), the quick initial-buy amounts, and where focus goes when the form is incomplete. No
 * React, no DOM; tested in tests/carddex/launch-form.test.ts.
 */

/** Where an older ?design= link's pair came from before the identity designs: design -> pair (30 October 2026). */
const EARLIER_DESIGN_PAIR = new Map<string, string>(Object.entries(PAIR_DESIGNS_2026_10_30).map(([pair, design]) => [design, pair]));

/**
 * The pair a Launch address opens on: ?quote= names it (an offered pair only). An older ?design= link opens on that
 * design's pair: today's, else the pair it had before the identity designs ("doge" DOGE, "pepe" TOAD), else its
 * permanent binding; a design with none of these, or nothing, opens on SOL without a word. A ?quote= that is unknown
 * or not offered (AAVE, UNI), a ?design= whose pair is not offered ("sovereign", ANSEM's earlier card) and an unknown
 * or withheld ?design= ("pair-aave") open on SOL and say so.
 */
export function pairFromSearch(search: { quote?: string; design?: string }): { pair: PairAssetKey; notice: string } {
  if (search.quote) {
    if (isOfferedPair(search.quote)) return { pair: search.quote as PairAssetKey, notice: "" };
    return { pair: DEFAULT_PAIR, notice: `That pair is unavailable. ${getPairAsset(DEFAULT_PAIR).symbol} selected.` };
  }
  const design = search.design;
  if (!design) return { pair: DEFAULT_PAIR, notice: "" };
  const candidates = [pairForDesign(design)?.key, EARLIER_DESIGN_PAIR.get(design), boundQuoteForDesign(design)?.key];
  const pair = candidates.find((key) => isOfferedPair(key));
  if (pair) return { pair: pair as PairAssetKey, notice: "" };
  const unavailable = !isCardDesignKey(design) || candidates.some(Boolean);
  return { pair: DEFAULT_PAIR, notice: unavailable ? `That card is unavailable. ${getPairAsset(DEFAULT_PAIR).symbol} selected.` : "" };
}

/**
 * The card the form launches with and the preview shows: the pair's own design. A saved mainnet launch keeps the
 * design it was saved with (one prepared before the pair picked the card may carry another), until a pair is picked.
 */
export function launchDesign(pair: string, savedDesign?: string | null): CardDesignKey {
  if (savedDesign && isCardDesignKey(savedDesign)) return savedDesign;
  return designForPair(pair) ?? designForPair(DEFAULT_PAIR)!;
}

/**
 * The card the Launch page shows and sends. A saved launch keeps its own design while the panel is open (`live`);
 * otherwise the pair's own card.
 */
export function formDesign(pair: string, savedDesign: string | null, live: boolean): CardDesignKey {
  return launchDesign(pair, live ? savedDesign : null);
}

/**
 * A tap on a pair: the form's next pair, or null when nothing changes. Any tap ends a saved launch's own design, the
 * checked pair's included (its card comes back), so `savedDesign` is always cleared; `changed` says the pair moved
 * (an initial buy in the old pair's unit is then cleared).
 */
export function pickPair(
  current: { pair: PairAssetKey; savedDesign: string | null },
  next: PairAssetKey,
): { pair: PairAssetKey; savedDesign: null; changed: boolean } | null {
  if (next === current.pair && !current.savedDesign) return null;
  return { pair: next, savedDesign: null, changed: next !== current.pair };
}

/** A draft this browser kept: its pair, if it is still offered (an older draft's separate design is not used). */
export function draftPair(draft: { quoteKey?: unknown } | null | undefined): PairAssetKey | null {
  return typeof draft?.quoteKey === "string" && isOfferedPair(draft.quoteKey) ? draft.quoteKey as PairAssetKey : null;
}

/** True when the typed amount is the same number as the quick amount (0.50 is 0.5). Empty and 0 are "None". */
export function sameAmount(typed: string, amount: string): boolean {
  const t = typed.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t)) return amount === "" && t === "";
  return Number(t) === Number(amount || "0");
}

/** One required check in the form, in DOM order. */
export type FormCheck<K extends string> = { key: K; ok: boolean };

/** The first check that fails, in the order given (the form's DOM order), or null when every one passes. */
export function firstProblem<K extends string>(order: readonly FormCheck<K>[]): K | null {
  return order.find((check) => !check.ok)?.key ?? null;
}

/**
 * Where Enter in a text field goes, since Enter never submits the form: the first incomplete or invalid field, or the
 * screen's primary button when the form is ready (pressing it is the only way to launch).
 */
export function enterTarget<K extends string>(order: readonly FormCheck<K>[]): K | "primary" {
  return firstProblem(order) ?? "primary";
}
