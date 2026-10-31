/**
 * "Creator fees" in Launch's More options: who receives the coin's pump.fun creator fees, and (custom pairs only) an
 * optional custom rate. The rules are the server's (integrations/pumpfun/src/create-options.ts); this file holds the
 * form's draft, its parsing and its plain words. No promise of earnings anywhere: who pays, when, and what is permanent.
 */
import {
  CREATOR_FEE_RATE_CEILING_BPS, CREATOR_FEE_RATE_OFF, CREATOR_FEE_RATE_PAIR, createFeeRateRange, creatorFeeRateEligible, formatFeeRate,
  HOLDER_REWARDS_NO_SPLIT,
} from "../../../../../integrations/pumpfun/src/create-options";
import type { LiveCreateOptions } from "../../../lib/carddex/live/types";

export { creatorFeeRateEligible, formatFeeRate, HOLDER_REWARDS_NO_SPLIT };

type OptionsOf = { tokenMint: string; holderReward?: boolean; creatorFeeBps?: number | null };
/**
 * True when the server's intent names create options other than the ones this tab prepared for the same coin. A tab
 * holding no input for that coin (a resumed launch) has nothing to compare, and shows the intent's options in full.
 */
export function createOptionsChanged(input: OptionsOf | null | undefined, intent: OptionsOf): boolean {
  if (!input || input.tokenMint !== intent.tokenMint) return false;
  return !!input.holderReward !== !!intent.holderReward || (input.creatorFeeBps ?? 0) !== (intent.creatorFeeBps ?? 0);
}

/** The group as typed: who gets the fees, and the custom rate as a percent ("" for pump.fun's standard rate). */
export type CreatorFeesDraft = { holders: boolean; rate: string };
export const EMPTY_CREATOR_FEES: CreatorFeesDraft = { holders: false, rate: "" };

/** A saved draft's group, or the default (the creator keeps the fees, standard rate) for anything unreadable. */
export function readCreatorFeesDraft(value: unknown): CreatorFeesDraft {
  if (!value || typeof value !== "object") return EMPTY_CREATOR_FEES;
  const v = value as { holders?: unknown; rate?: unknown };
  return { holders: v.holders === true, rate: typeof v.rate === "string" ? v.rate.replace(/[^0-9.]/g, "").slice(0, 6) : "" };
}

/** What the form may offer right now: each option only while pump.fun allows it (and the rate on custom pairs only). */
export function creatorFeesOffer(options: LiveCreateOptions | null | undefined, admission: string) {
  const rateMax = options?.creatorFeeRate && creatorFeeRateEligible(admission) ? Math.min(CREATOR_FEE_RATE_CEILING_BPS, options.creatorFeeRate.maxBps) : null;
  return { holders: options?.holderRewards === true, rateMax };
}

/**
 * A typed percent as whole basis points: null for empty (pump.fun's standard rate), or the plain refusal. Two decimals
 * at most (0.01% steps), 0.01% to `maxBps`.
 */
export function parseFeeRate(text: string, maxBps: number): { bps: number | null; error: string | null } {
  const value = text.trim();
  if (!value) return { bps: null, error: null };
  if (!/^\d{0,2}(\.\d{0,2})?$/.test(value) || value === ".") return { bps: null, error: createFeeRateRange(maxBps) };
  const bps = Math.round(Number(value) * 100);
  return bps >= 1 && bps <= maxBps ? { bps, error: null } : { bps: null, error: createFeeRateRange(maxBps) };
}

/**
 * What the Launch form shows and sends for the group. A choice the creator made is never dropped without a word:
 * - Holders chosen (in a restored draft) while pump.fun has them off stays shown, so prepare refuses it in plain words;
 *   once shown, the choice stays mounted for the session (`seen.holders`) with holders disabled while pump.fun is
 *   known not to offer them, so focus never falls out of a vanished group.
 * - A rate typed on a custom pair stays shown and sent while pump.fun's answer is unknown (loading or unreadable), so
 *   prepare checks it; when pump.fun is known to accept no custom rate it blocks Launch with that refusal. On SOL or
 *   USDC the typed rate is not sent and the form says so.
 * `options` null means pump.fun's answer is not known (loading, or the read failed).
 */
export function creatorFeesView({ options, admission, draft, locked, seen }: {
  options: LiveCreateOptions | null | undefined; admission: string; draft: CreatorFeesDraft; locked: boolean;
  seen: { holders: boolean; rate: boolean };
}) {
  const offer = creatorFeesOffer(options, admission);
  const known = !!options;
  const typed = draft.rate.trim() !== "";
  if (locked) {
    const rateMax = typed ? CREATOR_FEE_RATE_CEILING_BPS : null;
    const rateCheck = rateMax !== null ? parseFeeRate(draft.rate, rateMax) : { bps: null, error: null };
    return { offer, holdersShown: draft.holders, holdersOffered: true, holdersActive: draft.holders, rateMax, rateCheck, rateNote: null as string | null, holdersNote: null as string | null };
  }
  const holdersShown = offer.holders || draft.holders || seen.holders;
  const holdersOffered = !known || offer.holders;
  const holdersActive = holdersShown && draft.holders;
  const eligible = creatorFeeRateEligible(admission);
  let rateMax = offer.rateMax, rateNote: string | null = null;
  let rateCheck: { bps: number | null; error: string | null } = rateMax !== null ? parseFeeRate(draft.rate, rateMax) : { bps: null, error: null };
  if (rateMax === null && eligible && (typed || seen.rate)) {
    // Kept: unknown is sent for prepare to check; known-off blocks Launch with pump.fun's refusal.
    rateMax = CREATOR_FEE_RATE_CEILING_BPS;
    rateCheck = parseFeeRate(draft.rate, rateMax);
    if (known && typed) rateCheck = { bps: null, error: CREATOR_FEE_RATE_OFF };
    else if (!known) rateNote = FEE_RATE_UNCHECKED;
  } else if (!eligible && typed) rateNote = `${FEE_RATE_NOT_USED} ${CREATOR_FEE_RATE_PAIR}`;
  const holdersNote = holdersShown && known && !offer.holders ? HOLDERS_NOT_OFFERED : null;
  return { offer, holdersShown, holdersOffered, holdersActive, rateMax, rateCheck, rateNote, holdersNote };
}

export const FEE_RATE_UNCHECKED = "Launch a Card couldn't confirm yet that pump.fun accepts custom rates. Your rate is kept and checked when you launch; clear it to use pump.fun's standard rate.";
export const FEE_RATE_NOT_USED = "Your typed creator fee rate is not sent with this pair.";
export const HOLDERS_NOT_OFFERED = "pump.fun isn't offering holder rewards right now. A launch with them is refused until you choose \"Creator keeps fees\".";

export const CREATOR_FEES_TITLE = "Creator fees";
export const CREATOR_KEEPS_LABEL = "Creator keeps fees";
export const CREATOR_KEEPS_HINT = "Creator fees build up for you on pump.fun, where you claim them, as on any pump.fun coin (or for the wallets in your split, below).";
export const HOLDERS_LABEL = "Holders get the fees";
export const HOLDERS_HINT = "pump.fun holder rewards: the creator fee from every trade of this coin goes to its holders instead of you.";
/** Shown with the choice, in the review and in the docs: what is permanent, who pays, and that nothing is promised. */
export const HOLDERS_PERMANENT = "Permanent: you earn no creator fees from this coin, it can never go back, and it can't share fees with wallets.";
export const HOLDERS_WHO_PAYS = "pump.fun alone decides and sends the payouts, from time to time, in the pair's asset, net of its costs, and only to wallets holding at least its minimum (about US$20 worth today). Payouts are not guaranteed; Launch a Card never holds or sends them.";
export const FEE_RATE_LABEL = "Creator fee rate";
export const FEE_RATE_HINT = "Optional, on custom pairs only. Empty keeps pump.fun's standard rate.";
export const FEE_RATE_PERMANENT = "A custom rate replaces pump.fun's standard creator fee on every trade on this coin's bonding curve and is fixed for its life. A higher rate costs every trader more.";

/** The holder-rewards model as one short line (saved launch, coin page). */
export const HOLDERS_LINE = "pump.fun holder rewards (paid by pump.fun, not guaranteed)";
/** A custom rate as one short line. */
export const feeRateLine = (bps: number) => `${formatFeeRate(bps)} per trade, fixed`;
