// Pure mirror of the evolve state machine (card-program-v2 §7.3; mainnet fix pack: refs/mainnet/fix-plan.md §2.3),
// for the watchdog crank, the watcher and the UI ("confirming 2/3, about 40 s", "paused until about ..."). It must stay
// identical to the program's `evolve.rs`: test/evolve.test.ts runs the same vectors as the Rust unit tests (U4a to
// U4n, F2a to F2h, the ignore-rule truth table).
//
// Fix pack additions (all optional on the inputs, so pre-fix-pack callers keep working: missing fields read as 0, which
// is exactly what every live card holds before the upgrade):
// - who observes (F1): `{ kind: "open" }` (open mode, every rule as before), `{ kind: "count", bit }` (a ROLE_COUNT
//   observer in attested mode), `{ kind: "cap" }` (a ROLE_CAP-only observer, the watcher: lower or clear only);
// - the listing-pause mark (F2): `hwmUntil` / `hwmLevel`, armed by a dip (`clamp(held, gap, hold)`) or an expiry
//   (`hold`), reset by a confirm, lapsed lazily after `hwmUntil`;
// - witness bits and the observer-set epoch (F1, tier B7 / B12).
//
// Review round 2 (both mirrored from evolve.rs):
// - `resumedSlot` (Config.evolve_resumed_slot, the last EVOLVE unpause): a window opened before it is dropped like an
//   expired one on its next observation, because nothing could observe it while EVOLVE was paused;
// - `lowerOnIgnored`: an ignored counting call still lowers the pending level to its cap (never further).

export interface EvolveCard {
  level: number;
  /** 0 = nothing pending */
  pendingLevel: number;
  pendingObs: number;
  pendingSinceSlot: bigint;
  pendingLastSlot: bigint;
  /** F2: VOID_ON_EVOLVE listings stay paused through this slot (0 = no mark). Card @212. */
  hwmUntil?: bigint;
  /** F2: highest pending level of the episode that armed the mark. Card @220. */
  hwmLevel?: number;
  /** F1: witness bits of the current window. Card @221. */
  observers?: number;
  /** F1: ObserverSet.epoch the current window was opened under (0 = open mode). Card @222. */
  epoch?: number;
}

export interface EvolveParams {
  /** `config.evolve_hold_slots` (program floor 150) */
  holdSlots: number;
  /** `config.evolve_min_obs` (devnet 3, counting the confirming call) */
  minObs: number;
  /** `config.evolve_max_step` (devnet 2) */
  maxStep: number;
  /** `config.evolve_min_observers`: 0 = open mode (default), else the distinct witnesses a confirm needs. */
  minObservers?: number;
  /** `ObserverSet.epoch` in attested mode, 0 in open mode (default). */
  epoch?: number;
  /** `Config.evolve_resumed_slot` (review round 2): windows opened before the last EVOLVE unpause restart. Default 0. */
  resumedSlot?: bigint;
}

/** Who makes an observation (fix-plan §2.3). */
export type EvolveWho = { kind: "open" } | { kind: "count"; bit: number } | { kind: "cap" };
export const WHO_OPEN: EvolveWho = Object.freeze({ kind: "open" }) as EvolveWho;
export const WHO_CAP: EvolveWho = Object.freeze({ kind: "cap" }) as EvolveWho;
/** A ROLE_COUNT observer in slot `index` of the ObserverSet (its witness bit is `1 << index`). */
export const whoCount = (index: number): EvolveWho => ({ kind: "count", bit: 1 << index });

export type EvolveEvent =
  | { kind: "EvolvePendingCleared"; liveLevel: number; slot: bigint; reason: "expired" | "dip" }
  | { kind: "EvolveObserved"; liveLevel: number; pendingLevel: number; obs: number; slot: bigint }
  | { kind: "CardEvolved"; fromLevel: number; toLevel: number; slot: bigint };

/** What one observation did (the Rust `StepOutcome`). */
export interface EvolveOutcome {
  expired: boolean;
  dipCleared: boolean;
  /** [pendingLevel, obs] right after the observation; null on a dip or a Cap call on an idle card. */
  observed: [number, number] | null;
  /** [from, to] when the level was confirmed. */
  evolved: [number, number] | null;
}

export interface EvolveResult {
  /** Every field filled (the optional fix-pack fields included). */
  card: Required<EvolveCard>;
  events: EvolveEvent[];
  outcome: EvolveOutcome;
}

/** Minimum spacing between counted observations: `hold / (k + 1)` (devnet 150 / 4 = 37 slots). */
export const evolveGap = (p: EvolveParams): bigint => BigInt(p.holdSlots) / BigInt(p.minObs + 1);

const popcount = (x: number): number => {
  let n = 0;
  for (let v = x & 0xff; v; v &= v - 1) n++;
  return n;
};
const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
const clampBig = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

/** Fills the optional fix-pack fields with 0 (what every pre-upgrade card holds). */
export function fullEvolveCard(c: EvolveCard): Required<EvolveCard> {
  return {
    level: c.level,
    pendingLevel: c.pendingLevel,
    pendingObs: c.pendingObs,
    pendingSinceSlot: c.pendingSinceSlot,
    pendingLastSlot: c.pendingLastSlot,
    hwmUntil: c.hwmUntil ?? 0n,
    hwmLevel: c.hwmLevel ?? 0,
    observers: c.observers ?? 0,
    epoch: c.epoch ?? 0,
  };
}

/** The evolve window of a decoded Card account (snake_case IDL fields; missing fix-pack fields read as 0). */
export function evolveCardOf(card: {
  level: number;
  pending_level: number;
  pending_obs: number;
  pending_since_slot: bigint | number;
  pending_last_slot: bigint | number;
  pending_hwm_until?: bigint | number;
  pending_hwm_level?: number;
  pending_observers?: number;
  pending_epoch?: number;
}): Required<EvolveCard> {
  return {
    level: card.level,
    pendingLevel: card.pending_level,
    pendingObs: card.pending_obs,
    pendingSinceSlot: BigInt(card.pending_since_slot),
    pendingLastSlot: BigInt(card.pending_last_slot),
    hwmUntil: BigInt(card.pending_hwm_until ?? 0),
    hwmLevel: card.pending_hwm_level ?? 0,
    observers: card.pending_observers ?? 0,
    epoch: card.pending_epoch ?? 0,
  };
}

function clearPending(w: Required<EvolveCard>): void {
  w.pendingLevel = 0;
  w.pendingObs = 0;
  w.pendingSinceSlot = 0n;
  w.pendingLastSlot = 0n;
  w.observers = 0;
  w.epoch = 0;
}

function startPending(w: Required<EvolveCard>, live: number, slot: bigint, bit: number, epoch: number): void {
  w.pendingLevel = live;
  w.pendingObs = 1;
  w.pendingSinceSlot = slot;
  w.pendingLastSlot = slot;
  w.observers = bit;
  w.epoch = epoch;
}

/** F2: the window ends (dip or expiry) but the episode is remembered for `ttl` more slots. */
function arm(w: Required<EvolveCard>, slot: bigint, ttl: bigint): void {
  w.hwmLevel = Math.max(w.hwmLevel, w.pendingLevel);
  w.hwmUntil = maxBig(w.hwmUntil, slot + ttl);
}

function resetMark(w: Required<EvolveCard>): void {
  w.hwmLevel = 0;
  w.hwmUntil = 0n;
}

/**
 * One observation of live level `live` at `slot` by `who` (default open mode), exactly as `evolve.rs::step`.
 * In attested mode `live` must already be `min(on-chain, cap)` and the caller must apply `countCallIgnored` first
 * (an ignored call changes nothing).
 */
export function evolveStep(input: EvolveCard, live: number, slot: bigint, p: EvolveParams, who: EvolveWho = WHO_OPEN): EvolveResult {
  const hold = BigInt(p.holdSlots);
  const gap = evolveGap(p);
  const minObservers = p.minObservers ?? 0;
  const epoch = p.epoch ?? 0;
  const counts = who.kind !== "cap";
  const bit = who.kind === "count" ? who.bit & 0xff : 0;
  const w = fullEvolveCard(input);
  const events: EvolveEvent[] = [];
  const outcome: EvolveOutcome = { expired: false, dipCleared: false, observed: null, evolved: null };

  // 0. A mark past its deadline has lapsed.
  if (w.hwmLevel !== 0 && slot > w.hwmUntil) resetMark(w);
  // 1. A pending level that waited too long is dropped; the mark covers one more full hold (tier B6). So is a window
  //    opened before the last EVOLVE unpause (review round 2).
  if (w.pendingLevel !== 0 && (slot > w.pendingSinceSlot + 4n * hold || w.pendingSinceSlot < (p.resumedSlot ?? 0n))) {
    arm(w, slot, hold);
    clearPending(w);
    outcome.expired = true;
  }
  // 2. An observation at or below the current level ends the window; the mark covers as long as the window had been
  //    held, at least one gap and at most one hold (market M-2).
  if (live <= w.level) {
    if (w.pendingLevel !== 0) {
      const held = slot > w.pendingSinceSlot ? slot - w.pendingSinceSlot : 0n;
      arm(w, slot, clampBig(held, gap, hold));
      clearPending(w);
      outcome.dipCleared = true;
    }
    if (outcome.expired || outcome.dipCleared) {
      events.push({ kind: "EvolvePendingCleared", liveLevel: live, slot, reason: outcome.expired ? "expired" : "dip" });
    }
    return { card: w, events, outcome };
  }
  if (outcome.expired) events.push({ kind: "EvolvePendingCleared", liveLevel: live, slot, reason: "expired" });
  // 3. Start, restart, lower, or count.
  if (w.pendingLevel === 0) {
    if (!counts) return { card: w, events, outcome }; // only counting callers open windows
    startPending(w, live, slot, bit, epoch);
  } else if (who.kind === "count" && (w.epoch !== epoch || w.observers === 0)) {
    startPending(w, live, slot, bit, epoch); // no inherited counts (tier B7, B12)
  } else {
    if (live < w.pendingLevel) w.pendingLevel = live;
    if (counts) {
      w.observers = (w.observers | bit) & 0xff;
      if (slot >= w.pendingLastSlot + gap) {
        w.pendingObs = Math.min(255, w.pendingObs + 1);
        w.pendingLastSlot = slot;
      }
    }
  }
  outcome.observed = [w.pendingLevel, w.pendingObs];
  events.push({ kind: "EvolveObserved", liveLevel: live, pendingLevel: w.pendingLevel, obs: w.pendingObs, slot });
  // 4. Confirm when enough spaced observations by enough witnesses span the window.
  if (counts && w.pendingObs >= p.minObs && slot >= w.pendingSinceSlot + hold && popcount(w.observers) >= minObservers) {
    const to = Math.min(w.pendingLevel, w.level + p.maxStep);
    const from = w.level;
    w.level = to;
    outcome.evolved = [from, to];
    events.push({ kind: "CardEvolved", fromLevel: from, toLevel: to, slot });
    resetMark(w);
    if (live > to) startPending(w, live, slot, bit, epoch);
    else clearPending(w);
  }
  return { card: w, events, outcome };
}

/**
 * F1 ignore rule (tier B5): in attested mode a counting observer's `observe(cap)` is dropped (no state change, only an
 * `ObservationMismatch { applied: false }` event) when its cap is above the card level and the on-chain read is below
 * the cap. Watcher (cap) calls and caps at or below the level are never ignored.
 */
export function countCallIgnored(who: EvolveWho, cap: number, level: number, liveOnchain: number): boolean {
  return who.kind === "count" && cap > level && liveOnchain < cap;
}

/**
 * Review round 2 (`evolve.rs::lower_on_ignored`): what an ignored counting call still does. When its cap is below the
 * pending level (and above the card level) the pending level drops to the cap; nothing else changes (no count, no
 * witness). Returns the new window and whether it changed.
 */
export function lowerOnIgnored(input: EvolveCard, cap: number): { card: Required<EvolveCard>; changed: boolean } {
  const w = fullEvolveCard(input);
  if (w.pendingLevel > cap && cap > w.level) {
    w.pendingLevel = cap;
    return { card: w, changed: true };
  }
  return { card: w, changed: false };
}

/** F2: the card is unlocking above `level` at `slot` (a pending level above it, or an unlapsed mark above it). */
export function unlockingAbove(card: EvolveCard, level: number, slot: bigint): boolean {
  const w = fullEvolveCard(card);
  return w.pendingLevel > level || (w.hwmLevel > level && slot <= w.hwmUntil);
}

/** `Config.paused` EVOLVE bit and `Listing.flags` VOID_ON_EVOLVE (duplicated from mintdex/config.ts to keep this module pure). */
const PAUSE_EVOLVE_BIT = 2;
const LISTING_VOID_ON_EVOLVE_BIT = 1;

/**
 * `buy_now`'s VOID_ON_EVOLVE rule (market.rs `check_buyable`, fix-plan §2.4): a VOID listing is refused
 * (`ListingVoided`) when the level moved since listing, the card is unlocking above the listed level, or EVOLVE is
 * paused. Plain listings are never voided.
 */
export function listingVoided(
  listing: { levelAtList: number; flags: number },
  card: EvolveCard,
  slot: bigint,
  paused: number,
): boolean {
  if ((listing.flags & LISTING_VOID_ON_EVOLVE_BIT) === 0) return false;
  return card.level !== listing.levelAtList || unlockingAbove(card, listing.levelAtList, slot) || (paused & PAUSE_EVOLVE_BIT) !== 0;
}

/**
 * The slot through which a VOID listing stays paused if the current unlock stops now, or null when nothing pauses it
 * by the mark (the level moved, or nothing is pending or marked above the listed level). While a window is open above
 * the listed level the pause lasts at least until the window could dip: `max(hwmUntil, slot + clamp(held, gap, hold))`.
 */
export function listingPausedUntilSlot(
  listing: { levelAtList: number; flags: number },
  card: EvolveCard,
  slot: bigint,
  p: EvolveParams,
): bigint | null {
  if ((listing.flags & LISTING_VOID_ON_EVOLVE_BIT) === 0) return null;
  const w = fullEvolveCard(card);
  if (w.level !== listing.levelAtList) return null;
  const hold = BigInt(p.holdSlots);
  let until: bigint | null = w.hwmLevel > listing.levelAtList && slot <= w.hwmUntil ? w.hwmUntil : null;
  if (w.pendingLevel > listing.levelAtList) {
    const held = slot > w.pendingSinceSlot ? slot - w.pendingSinceSlot : 0n;
    const ifDipNow = slot + clampBig(held, evolveGap(p), hold);
    until = until === null ? ifDipNow : maxBig(until, ifDipNow);
  }
  return until;
}

/** Progress of a pending window for display: counted observations and slots left until a confirm is possible. */
export function evolveProgress(card: EvolveCard, slot: bigint, p: EvolveParams) {
  if (card.pendingLevel === 0) return null;
  const hold = BigInt(p.holdSlots);
  const readyAt = card.pendingSinceSlot + hold;
  const w = fullEvolveCard(card);
  return {
    pendingLevel: card.pendingLevel,
    obs: card.pendingObs,
    obsNeeded: p.minObs,
    slotsLeft: readyAt > slot ? readyAt - slot : 0n,
    expiresAtSlot: card.pendingSinceSlot + 4n * hold,
    /** Distinct witnesses so far and the number a confirm needs (attested mode; 0 / 0 in open mode). */
    witnesses: popcount(w.observers),
    witnessesNeeded: p.minObservers ?? 0,
    /** A listing paused by this window (VOID_ON_EVOLVE at the current level) stays paused through this slot if it dips now. */
    pausedUntilSlot: slot + clampBig(slot > card.pendingSinceSlot ? slot - card.pendingSinceSlot : 0n, evolveGap(p), hold),
  };
}

/** True when two windows are identical (the crank only sends calls that change something). */
export function evolveCardEqual(a: EvolveCard, b: EvolveCard): boolean {
  const x = fullEvolveCard(a);
  const y = fullEvolveCard(b);
  return (
    x.level === y.level &&
    x.pendingLevel === y.pendingLevel &&
    x.pendingObs === y.pendingObs &&
    x.pendingSinceSlot === y.pendingSinceSlot &&
    x.pendingLastSlot === y.pendingLastSlot &&
    x.hwmUntil === y.hwmUntil &&
    x.hwmLevel === y.hwmLevel &&
    x.observers === y.observers &&
    x.epoch === y.epoch
  );
}
