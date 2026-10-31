import { isCardDesignKey, type CardDesignKey } from "../../lib/carddex/designs";
import { PAIR_DESIGNS_2026_10_30 } from "../../lib/carddex/design-pairings";
import { DEFAULT_PAIR, boundQuoteForDesign, designForPair, designsForPair, getPairAsset, isOfferedPair, pairForDesign, type PairAssetKey } from "../../lib/carddex/pairs";

/**
 * Pure helpers for the one-page Launch form (routes/launch.tsx): which pair the page opens on and which card it shows
 * (the pair picks the card), the quick initial-buy amounts, and where focus goes when the form is incomplete. No
 * React, no DOM; tested in tests/carddex/launch-form.test.ts.
 */

/** Where an older ?design= link's pair came from before the identity designs: design -> pair (30 October 2026). */
const EARLIER_DESIGN_PAIR = new Map<string, string>(Object.entries(PAIR_DESIGNS_2026_10_30).map(([pair, design]) => [design, pair]));

/** A design the pair offers for a new launch (SOL: any of its options; a pair with alternates: its own card or one of them), else null. */
export function pairOption(pair: string, design?: string | null): CardDesignKey | null {
  return design ? designsForPair(pair).find((key) => key === design) ?? null : null;
}

/**
 * The pair a Launch address opens on, and the design when the link names one of that pair's (SOL's options): ?quote=
 * names the pair (an offered pair only), and ?design= with it the design (`?quote=sol&design=ronin`). An older
 * ?design= link alone opens on that design's pair: today's (any SOL option opens SOL with that design), else the pair
 * it had before the identity designs ("doge" DOGE), else its permanent binding; a design with none of these, or
 * nothing, opens on SOL without a word. A ?quote= that is unknown or not offered (AAVE, UNI), a ?design= whose pair
 * is not offered ("sovereign", ANSEM's earlier card), an unknown or withheld ?design= ("pair-aave") and
 * ?quote=sol with a design SOL does not offer open on SOL's main card and say so. `design` is null for the pair's main card.
 */
export function pairFromSearch(search: { quote?: string; design?: string }): { pair: PairAssetKey; design: CardDesignKey | null; notice: string } {
  const sol = getPairAsset(DEFAULT_PAIR).symbol;
  if (search.quote) {
    if (!isOfferedPair(search.quote)) return { pair: DEFAULT_PAIR, design: null, notice: `That pair is unavailable. ${sol} selected.` };
    const pair = search.quote as PairAssetKey;
    const design = pairOption(pair, search.design);
    // A design another pair owns, sent with this pair, is dropped without a word: the pair wins. A design a pair with a
    // choice (SOL, or a meme pair with alternates) does not offer, sent with that pair, says so.
    const refused = !design && !!search.design && designsForPair(pair).length > 1;
    return { pair, design: designsForPair(pair).length > 1 ? design : null, notice: refused ? `That card is unavailable. ${getPairAsset(pair).symbol} selected.` : "" };
  }
  const design = search.design;
  if (!design) return { pair: DEFAULT_PAIR, design: null, notice: "" };
  const candidates = [pairForDesign(design)?.key, EARLIER_DESIGN_PAIR.get(design), boundQuoteForDesign(design)?.key];
  const pair = candidates.find((key) => isOfferedPair(key));
  if (pair) return { pair: pair as PairAssetKey, design: designsForPair(pair).length > 1 ? pairOption(pair, design) : null, notice: "" };
  const unavailable = !isCardDesignKey(design) || candidates.some(Boolean);
  return { pair: DEFAULT_PAIR, design: null, notice: unavailable ? `That card is unavailable. ${sol} selected.` : "" };
}

/**
 * The card the form launches with and the preview shows: the creator's choice when the pair offers it (a SOL option),
 * else the pair's main design. A saved mainnet launch keeps the design it was saved with (one prepared before the pair
 * picked the card may carry another), until a pair or a design is picked.
 */
export function launchDesign(pair: string, savedDesign?: string | null, chosen?: string | null): CardDesignKey {
  if (savedDesign && isCardDesignKey(savedDesign)) return savedDesign;
  return pairOption(pair, chosen) ?? designForPair(pair) ?? designForPair(DEFAULT_PAIR)!;
}

/**
 * The card the Launch page shows and sends. A saved launch keeps its own design while the panel is open (`live`);
 * otherwise the chosen design when the pair offers it (SOL's options), else the pair's main card.
 */
export function formDesign(pair: string, savedDesign: string | null, live: boolean, chosen: string | null = null): CardDesignKey {
  return launchDesign(pair, live ? savedDesign : null, chosen);
}

/**
 * A tap on a design in a pair's chooser (SOL's, or a meme pair's with alternates): the form's next chosen design, or null when nothing changes (a design the pair
 * does not offer, or the one already shown). It ends a saved launch's own design, as a pair tap does.
 */
export function pickDesign(
  current: { pair: string; chosen: string | null; savedDesign: string | null },
  next: string,
): { chosen: CardDesignKey; savedDesign: null } | null {
  const design = pairOption(current.pair, next);
  if (!design) return null;
  if (!current.savedDesign && launchDesign(current.pair, null, current.chosen) === design) return null;
  return { chosen: design, savedDesign: null };
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

/**
 * A draft's chosen design: kept when the creator picked it (designChosen) and its pair still offers it as a choice
 * (SOL's options, or a meme pair's own card and alternates), else null (the main card). Drafts from before SOL's chooser carry SOL's old card (one-piece) without
 * designChosen; they reopen on SOL's main card, since nobody picked One Piece.
 */
export function draftDesign(draft: { quoteKey?: unknown; designKey?: unknown; designChosen?: unknown } | null | undefined): CardDesignKey | null {
  const pair = draftPair(draft);
  return pair && draft?.designChosen === true && designsForPair(pair).length > 1 && typeof draft.designKey === "string" ? pairOption(pair, draft.designKey) : null;
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
