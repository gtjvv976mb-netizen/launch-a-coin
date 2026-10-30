import { isCardDesignKey, type CardDesignKey } from "../../lib/carddex/designs";
import { DEFAULT_PAIR, designForPair, getPairAsset, isPairAssetKey, pairForDesign, type PairAssetKey } from "../../lib/carddex/pairs";
import { quickBuyPresets } from "../../lib/carddex/quote-simulation";

/**
 * Pure helpers for the one-page Launch form (routes/launch.tsx): which pair the page opens on and which card it shows
 * (the pair picks the card), the quick initial-buy amounts, and where focus goes when the form is incomplete. No
 * React, no DOM; tested in tests/carddex/launch-form.test.ts.
 */

/**
 * The pair a Launch address opens on: ?quote= names it; an older ?design= link opens on that design's own pair; a
 * design no pair has, or nothing, opens on SOL without a word. An unknown ?quote= opens on SOL and says so.
 */
export function pairFromSearch(search: { quote?: string; design?: string }): { pair: PairAssetKey; notice: string } {
  if (search.quote) {
    if (isPairAssetKey(search.quote)) return { pair: search.quote, notice: "" };
    return { pair: DEFAULT_PAIR, notice: `That pair is unavailable. ${getPairAsset(DEFAULT_PAIR).symbol} selected.` };
  }
  return { pair: pairForDesign(search.design)?.key ?? DEFAULT_PAIR, notice: "" };
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
 * The card the Launch page shows and sends in its current mode. A saved launch's own design belongs to mainnet mode
 * only: Demo always shows (and sends) the pair's own card, since the demo launch refuses any other.
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
  return isPairAssetKey(draft?.quoteKey) ? draft.quoteKey : null;
}


/** Whole quote atoms for a short decimal amount (exact; null when the quote has too few decimals for it). */
function atomsOf(amount: string, decimals: number): bigint | null {
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * The quick initial-buy amounts offered for this quote: the coin page's buy amounts for its pair (quickBuyPresets, the
 * same share of its curve as SOL's 0.1 / 0.5 / 1 / 5) that it can hold at its decimals and, when a cap is given (the
 * demo's largest initial buy, in atoms), no larger than the cap.
 */
export function quickBuyAmounts(quoteKey: string, maxAtoms?: number): string[] {
  const { decimals } = getPairAsset(quoteKey);
  return quickBuyPresets(quoteKey).filter((amount) => {
    const atoms = atomsOf(amount, decimals);
    return atoms !== null && (maxAtoms === undefined || atoms <= BigInt(Math.floor(maxAtoms)));
  });
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

/**
 * The Demo primary pressed while signed out: the first required field still missing (it takes focus, and no dialog
 * opens), or "enter" once name, ticker and art are all there, so the one demo prompt opens and finishes the launch.
 * Art picked while signed out counts: it is kept in the page and uploaded when the demo starts.
 */
export function signedOutPress(form: { nameOk: boolean; tickerOk: boolean; hasArt: boolean }): "name" | "ticker" | "art" | "enter" {
  return firstProblem([
    { key: "name" as const, ok: form.nameOk },
    { key: "ticker" as const, ok: form.tickerOk },
    { key: "art" as const, ok: form.hasArt },
  ]) ?? "enter";
}
