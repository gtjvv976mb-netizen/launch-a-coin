import { CARD_DESIGNS, isCardDesignKey } from "../../lib/carddex/designs";
import { allowedQuotesForDesign, getPairAsset, isPairAssetKey, matchingDesignsForQuote, preferredDesignForQuote } from "../../lib/carddex/pairs";

/**
 * Pure helpers for the one-page Launch form (routes/launch.tsx): the suggested-design row and the designs matched to
 * its quote, the quick initial-buy amounts, and where focus goes when the form is incomplete. No React, no DOM;
 * tested in tests/carddex/launch-form.test.ts.
 */

/** Which matched designs a quote has ("Matching meme designs"): stock, meme and collector quotes; none for SOL or USDC. */
export type MatchFamily = "stock" | "meme" | "collector";

export function matchFamily(quoteKey: string): MatchFamily | null {
  if (!isPairAssetKey(quoteKey)) return null;
  const { kind } = getPairAsset(quoteKey);
  return kind === "stock" || kind === "meme" || kind === "collector" ? kind : null;
}

/**
 * The designs matched to a stock, meme or collector quote (the designs bound to it and its explicit meme-pair
 * presets, design-pairings.ts), the quote's preferred finish first. Empty for SOL, USDC and unknown keys.
 */
export function matchedDesignKeys(quoteKey: string): string[] {
  if (!matchFamily(quoteKey)) return [];
  const keys: string[] = matchingDesignsForQuote(quoteKey).map((design) => design.key);
  const preferred = preferredDesignForQuote(quoteKey);
  return preferred && keys.includes(preferred) ? [preferred, ...keys.filter((key) => key !== preferred)] : keys;
}

/** The suggested designs beside the chosen one: the quote they were picked for, and the keys in their slots. */
export type DesignRow = { quote: string; keys: readonly string[] };

/** The row holds this many designs; the screen shows the first 3, 5 or all 6 by width (launch.css). */
export const DESIGN_ROW_SIZE = 6;

/**
 * The row of designs a creator can pick with one tap. It stays still while they pick inside it (only the pressed
 * state moves), so a swatch never jumps under the pointer:
 *   - seeded from the current design, then the designs matched to the quote (its preferred finish first), then the
 *     trading-card classics that take the quote (no duplicates);
 *   - re-seeded when the quote changes;
 *   - a current design that is not in the row (picked from All designs, or arriving in the URL) takes the first slot.
 */
export function designRow(prev: DesignRow | null, current: string, quoteKey: string, n = DESIGN_ROW_SIZE): DesignRow {
  if (prev && prev.quote === quoteKey) {
    if (prev.keys.includes(current)) return prev;
    return { quote: quoteKey, keys: [current, ...prev.keys.slice(1)] };
  }
  const keys: string[] = [];
  const add = (key: string) => { if (keys.length < n && isCardDesignKey(key) && !keys.includes(key)) keys.push(key); };
  add(current);
  for (const key of matchedDesignKeys(quoteKey)) add(key);
  for (const design of CARD_DESIGNS) if (design.category === "classic" && allowedQuotesForDesign(design.key).some(a => a.key === quoteKey)) add(design.key);
  return { quote: quoteKey, keys };
}

/** The quick initial-buy amounts (the coin page's buy amounts), in the quote's own units. */
const QUICK_BUY = ["0.1", "0.5", "1", "5"] as const;

/** Whole quote atoms for a short decimal amount (exact; null when the quote has too few decimals for it). */
function atomsOf(amount: string, decimals: number): bigint | null {
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * The quick amounts offered for this quote: the ones it can hold at its decimals and, when a cap is given (the demo's
 * largest initial buy, in atoms), no larger than the cap.
 */
export function quickBuyAmounts(quoteKey: string, maxAtoms?: number): string[] {
  const { decimals } = getPairAsset(quoteKey);
  return QUICK_BUY.filter((amount) => {
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
