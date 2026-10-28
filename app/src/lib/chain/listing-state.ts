// What a listing and a card show after the mainnet fix pack (refs/mainnet/fix-plan.md §4.4): why a VOID_ON_EVOLVE
// listing does not sell right now (F2), when it resumes, and the "Concentrated" note (tier B1). Pure helpers for the
// card panel and the market rows.
import type { ApiCardState, ApiListing } from "@mintdex/chain-sdk/api";

import { FIXPACK_COPY } from "../mintdex/copy";

/**
 * A listing's resume time as a clock time ("3:42 PM", the viewer's locale), or null. Within a minute it reads "in a
 * minute". `now` is milliseconds.
 */
export function resumeText(listing: ApiListing, now: number): string | null {
  if (!listing.resumesAt) return null;
  const ms = listing.resumesAt * 1000;
  if (ms - now <= 60_000) return "in a minute";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Why a VOID_ON_EVOLVE listing does not sell right now: "pause" while the card unlocks (with a resume time), "unlocked"
 * when the level rose since listing, "evolve-paused" while unlocks are paused, or null when it sells (or is not VOID).
 */
export function listingPauseReason(
  listing: ApiListing | null,
  card: Pick<ApiCardState, "level">,
  evolvePaused: boolean,
): "pause" | "unlocked" | "evolve-paused" | null {
  if (!listing || !listing.voided || !listing.voidOnEvolve) return null;
  if (card.level > listing.levelAtList) return "unlocked";
  if (listing.pausedUntilSlot !== null && listing.pausedUntilSlot !== undefined) return "pause";
  if (evolvePaused) return "evolve-paused";
  return "unlocked";
}

/** The "Concentrated" note for a card's current design (tier B1), or null below 50% or when not measured. */
export function concentratedNote(card: Pick<ApiCardState, "top10Bps">): string | null {
  const bps = card.top10Bps;
  if (bps === null || bps === undefined || bps < 5_000) return null;
  return FIXPACK_COPY.concentratedHelp(String(Math.round(bps / 100)));
}
