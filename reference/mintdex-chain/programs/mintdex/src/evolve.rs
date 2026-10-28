//! The evolve state machine (card-program-v2 §7.3, mainnet fix pack: refs/mainnet/fix-plan.md §2.3) as a pure
//! function: continuous hold, `k` spaced observations across at least `hold` slots, any dip clears, a lower
//! observation lowers the pending level, pending expires after 4 × hold, at most `max_step` levels per confirm.
//!
//! Fix pack additions:
//! - **Who may count (F1).** In open mode (`Config.evolve_min_observers == 0`) every caller is `Who::Open` and the
//!   five window fields behave exactly as before. In attested mode only `ObserverSet` keys with ROLE_COUNT
//!   (`Who::Count { bit }`) open, count and confirm a window; a confirm needs `min_observers` distinct witness bits; a
//!   ROLE_CAP key without COUNT (`Who::Cap`, the watcher) may only lower or clear. A counting call whose window was
//!   opened under another `ObserverSet.epoch`, or by an open-mode caller (no witness), restarts it (tier B7, B12).
//! - **The listing-pause mark (F2).** A dip that ends a window keeps `hwm_level = max(hwm_level, pending_level)` and
//!   arms `hwm_until = slot + clamp(held, gap, hold)` (market M-2); an expiry arms a full hold (tier B6); a confirm
//!   resets the mark (the level rose, so old-level listings are voided by level). `unlocking_above` is what
//!   `buy_now` checks for VOID_ON_EVOLVE listings.
//!
//! Review round 2 additions:
//! - **No hold across an EVOLVE pause.** Every observation is refused while EVOLVE is paused, so a dip during the pause
//!   is never seen. A window opened before `Config.evolve_resumed_slot` (the last unpause) is dropped like an expired
//!   one on its next observation (mark armed for a full hold) and a counting caller opens a fresh window.
//! - **An ignored counting call still lowers to its cap** (`lower_on_ignored`): the cap is the observer's own read, so
//!   the confirmed level never exceeds a level an observer read during the window; the sandwich-prone on-chain read is
//!   not used and the call neither counts nor adds a witness.
//!
//! No accounts, so it is unit-testable; `chain/sdk/src/evolve.ts` mirrors it line by line.

use crate::state::Card;

/// Who makes an observation (fix-plan §2.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Who {
    /// Open mode: anyone, every rule as before the fix pack.
    Open,
    /// Attested mode: a ROLE_COUNT observer; `bit` = `1 << slot` (its witness bit).
    Count { bit: u8 },
    /// Attested mode: a ROLE_CAP observer without COUNT (the watcher): lower or clear only.
    Cap,
}

/// The evolve-relevant part of `Card`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Window {
    pub level: u8,
    /// 0 = nothing pending.
    pub pending_level: u8,
    pub pending_obs: u8,
    pub pending_since_slot: u64,
    pub pending_last_slot: u64,
    /// F2: VOID_ON_EVOLVE listings stay paused through this slot while `hwm_level` is above their level.
    pub hwm_until: u64,
    pub hwm_level: u8,
    /// F1: witness bits of the current window.
    pub observers: u8,
    /// F1: the `ObserverSet.epoch` the current window was opened under (0 = open mode).
    pub epoch: u8,
}

impl Window {
    pub fn from_card(c: &Card) -> Self {
        Self {
            level: c.level,
            pending_level: c.pending_level,
            pending_obs: c.pending_obs,
            pending_since_slot: c.pending_since_slot,
            pending_last_slot: c.pending_last_slot,
            hwm_until: c.pending_hwm_until,
            hwm_level: c.pending_hwm_level,
            observers: c.pending_observers,
            epoch: c.pending_epoch,
        }
    }

    pub fn write_to(&self, c: &mut Card) {
        c.level = self.level;
        c.pending_level = self.pending_level;
        c.pending_obs = self.pending_obs;
        c.pending_since_slot = self.pending_since_slot;
        c.pending_last_slot = self.pending_last_slot;
        c.pending_hwm_until = self.hwm_until;
        c.pending_hwm_level = self.hwm_level;
        c.pending_observers = self.observers;
        c.pending_epoch = self.epoch;
    }

    fn clear_pending(&mut self) {
        self.pending_level = 0;
        self.pending_obs = 0;
        self.pending_since_slot = 0;
        self.pending_last_slot = 0;
        self.observers = 0;
        self.epoch = 0;
    }

    fn start_pending(&mut self, live: u8, slot: u64, bit: u8, epoch: u8) {
        self.pending_level = live;
        self.pending_obs = 1;
        self.pending_since_slot = slot;
        self.pending_last_slot = slot;
        self.observers = bit;
        self.epoch = epoch;
    }

    /// F2: the window ends (dip or expiry) but the episode is remembered for `ttl` more slots.
    fn arm(&mut self, slot: u64, ttl: u64) {
        self.hwm_level = self.hwm_level.max(self.pending_level);
        self.hwm_until = self.hwm_until.max(slot.saturating_add(ttl));
    }

    fn reset_mark(&mut self) {
        self.hwm_level = 0;
        self.hwm_until = 0;
    }

    /// F2: the card is unlocking above `level` at `slot`: a pending level above it, or a mark above it that has not
    /// lapsed (`slot <= hwm_until`).
    pub fn unlocking_above(&self, level: u8, slot: u64) -> bool {
        self.pending_level > level || (self.hwm_level > level && slot <= self.hwm_until)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EvolveParams {
    /// `config.evolve_hold_slots` (≥ 150).
    pub hold_slots: u64,
    /// `config.evolve_min_obs` (2..=8; devnet 3, counting the confirming call).
    pub min_obs: u8,
    /// `config.evolve_max_step` (1..=13; devnet 2).
    pub max_step: u8,
    /// `config.evolve_min_observers`: 0 in open mode, else the distinct witnesses a confirm needs.
    pub min_observers: u8,
    /// `ObserverSet.epoch` in attested mode, 0 in open mode.
    pub epoch: u8,
    /// `Config.evolve_resumed_slot`: the slot of the last EVOLVE unpause (0 = never). Windows opened before it restart.
    pub resumed_slot: u64,
}

impl EvolveParams {
    /// Minimum spacing between counted observations: `hold / (k + 1)` (devnet 150 / 4 = 37 slots).
    pub fn gap(&self) -> u64 {
        self.hold_slots / (self.min_obs as u64 + 1)
    }
}

/// What one observation did, in event order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StepOutcome {
    /// A pending level older than 4 × hold was dropped (`EvolvePendingCleared`).
    pub expired: bool,
    /// The observation was at or below the current level and cleared a pending level (`EvolvePendingCleared`).
    pub dip_cleared: bool,
    /// `(pending_level, obs)` right after this observation (`EvolveObserved`); `None` when nothing was observed
    /// above the level (a dip, or a `Cap` call on an idle card).
    pub observed: Option<(u8, u8)>,
    /// `(from, to)` when the level was confirmed (`CardEvolved`).
    pub evolved: Option<(u8, u8)>,
}

/// One observation of live level `live` at `slot` by `who` (fix-plan §2.3).
pub fn step(w: &mut Window, live: u8, slot: u64, p: &EvolveParams, who: Who) -> StepOutcome {
    let mut out = StepOutcome::default();
    let hold = p.hold_slots;
    let counts = !matches!(who, Who::Cap);
    let bit = if let Who::Count { bit } = who { bit } else { 0 };
    // 0. A mark past its deadline has lapsed (lazy; `unlocking_above` also compares the deadline).
    if w.hwm_level != 0 && slot > w.hwm_until {
        w.reset_mark();
    }
    // 1. A pending level that has waited too long is dropped; the mark covers one more full hold (tier B6). So is a
    //    window opened before the last EVOLVE unpause: nobody could observe it during the pause (review round 2).
    if w.pending_level != 0
        && (slot > w.pending_since_slot.saturating_add(hold.saturating_mul(4)) || w.pending_since_slot < p.resumed_slot)
    {
        w.arm(slot, hold);
        w.clear_pending();
        out.expired = true;
    }
    // 2. Any observation at or below the current level ends the window (cheap no-op, no error); the mark covers as
    //    long as the window had been held, at least one counting gap and at most one hold (market M-2).
    if live <= w.level {
        if w.pending_level != 0 {
            let held = slot.saturating_sub(w.pending_since_slot);
            w.arm(slot, held.clamp(p.gap(), hold));
            w.clear_pending();
            out.dip_cleared = true;
        }
        return out;
    }
    // 3. Start, restart, lower, or count.
    if w.pending_level == 0 {
        if !counts {
            return out; // only counting callers open windows
        }
        w.start_pending(live, slot, bit, p.epoch);
    } else if matches!(who, Who::Count { .. }) && (w.epoch != p.epoch || w.observers == 0) {
        // no inherited counts from another epoch or from open mode (tier B7, B12)
        w.start_pending(live, slot, bit, p.epoch);
    } else {
        if live < w.pending_level {
            w.pending_level = live; // since stays valid for the lower level
        }
        if counts {
            w.observers |= bit;
            if slot >= w.pending_last_slot.saturating_add(p.gap()) {
                w.pending_obs = w.pending_obs.saturating_add(1);
                w.pending_last_slot = slot;
            }
        }
    }
    out.observed = Some((w.pending_level, w.pending_obs));
    // 4. Confirm when enough spaced observations by enough witnesses span the window.
    if counts
        && w.pending_obs >= p.min_obs
        && slot >= w.pending_since_slot.saturating_add(hold)
        && w.observers.count_ones() >= p.min_observers as u32
    {
        let to = w.pending_level.min(w.level.saturating_add(p.max_step));
        let from = w.level;
        w.level = to;
        out.evolved = Some((from, to));
        w.reset_mark(); // the level rose: listings at the old level are voided by level from now on
        if live > to {
            w.start_pending(live, slot, bit, p.epoch); // keep climbing in the next window
        } else {
            w.clear_pending();
        }
    }
    out
}

/// F1 ignore rule (tier B5): in attested mode a counting observer's call is dropped (no state change) when its cap is
/// above the card level and the on-chain read is below the cap. A sell sandwiched around the observer's transaction
/// can then neither clear nor lower a window. Clears by the watcher (`Who::Cap`) and caps at or below the level are
/// never ignored.
pub fn count_call_ignored(who: Who, cap: u8, level: u8, live_onchain: u8) -> bool {
    matches!(who, Who::Count { .. }) && cap > level && live_onchain < cap
}

/// Review round 2: what an ignored counting call (`count_call_ignored`) still does. When its cap is below the pending
/// level, the pending level drops to the cap: the cap is the observer's own read of committed state, so the confirmed
/// level never exceeds a level an observer read during the window. The on-chain read is not used (a sandwiching sell
/// could otherwise lower or clear the window), and the call neither counts nor adds a witness. Returns true when the
/// window changed.
pub fn lower_on_ignored(w: &mut Window, cap: u8) -> bool {
    if w.pending_level > cap && cap > w.level {
        w.pending_level = cap;
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::XorShift;

    const P: EvolveParams = EvolveParams { hold_slots: 150, min_obs: 3, max_step: 2, min_observers: 0, epoch: 0, resumed_slot: 0 };
    /// Attested mode: one witness needed, epoch 1.
    const A: EvolveParams = EvolveParams { min_observers: 1, epoch: 1, ..P };
    const CRANK: Who = Who::Count { bit: 1 };
    const STANDBY: Who = Who::Count { bit: 2 };

    fn card(level: u8) -> Window {
        Window { level, ..Default::default() }
    }

    /// The five pre-fix-pack window fields (the mark and the witness fields are new).
    fn five(w: &Window) -> (u8, u8, u8, u64, u64) {
        (w.level, w.pending_level, w.pending_obs, w.pending_since_slot, w.pending_last_slot)
    }

    /// Runs open-mode observations `(slot, live)` and returns the outcomes.
    fn run(w: &mut Window, obs: &[(u64, u8)]) -> Vec<StepOutcome> {
        obs.iter().map(|&(slot, live)| step(w, live, slot, &P, Who::Open)).collect()
    }

    fn run_as(w: &mut Window, p: &EvolveParams, who: Who, obs: &[(u64, u8)]) -> Vec<StepOutcome> {
        obs.iter().map(|&(slot, live)| step(w, live, slot, p, who)).collect()
    }

    #[test]
    fn gap_is_hold_over_k_plus_one() {
        assert_eq!(P.gap(), 37);
        assert_eq!(EvolveParams { hold_slots: 9_000, min_obs: 3, ..P }.gap(), 2_250);
        assert_eq!(EvolveParams { hold_slots: 9_000, min_obs: 8, ..P }.gap(), 1_000); // the mainnet setting
    }

    // ---------------------------------------------------------------- U4a..U4h: open mode, unchanged outcomes

    #[test]
    fn u4a_steady_rise_confirms_only_after_3_spaced_obs_and_hold() {
        let mut w = card(1);
        let o = run(&mut w, &[(1_000, 3)]);
        assert_eq!(o[0].observed, Some((3, 1)));
        assert_eq!((w.pending_level, w.pending_since_slot), (3, 1_000));
        let o = run(&mut w, &[(1_040, 3), (1_080, 3)]);
        assert_eq!(o[1].observed, Some((3, 3)));
        assert!(o.iter().all(|x| x.evolved.is_none()));
        assert_eq!(w.level, 1);
        assert_eq!(run(&mut w, &[(1_149, 3)])[0].evolved, None);
        let o = run(&mut w, &[(1_150, 3)]);
        assert_eq!(o[0].evolved, Some((1, 3)));
        assert_eq!(w, Window { level: 3, ..Default::default() });
    }

    #[test]
    fn u4a_hold_alone_is_not_enough() {
        let mut w = card(1);
        let o = run(&mut w, &[(0, 3), (200, 3)]);
        assert_eq!(o[1].observed, Some((3, 2)));
        assert!(o[1].evolved.is_none());
        assert_eq!(run(&mut w, &[(240, 3)])[0].evolved, Some((1, 3)));
    }

    #[test]
    fn u4b_dip_observation_clears_pending() {
        let mut w = card(1);
        run(&mut w, &[(0, 3), (40, 3)]);
        let o = run(&mut w, &[(80, 1)]);
        assert!(o[0].dip_cleared);
        assert_eq!(o[0].observed, None);
        assert_eq!(five(&w), five(&card(1)));
        let o = run(&mut w, &[(120, 3), (160, 3), (200, 3), (269, 3)]);
        assert!(o.iter().all(|x| x.evolved.is_none()));
        assert_eq!(run(&mut w, &[(270, 3)])[0].evolved, Some((1, 3)));
    }

    #[test]
    fn u4c_lower_observation_lowers_pending_and_confirm_uses_minimum() {
        let mut w = card(1);
        run(&mut w, &[(0, 5), (40, 2), (80, 5)]);
        assert_eq!(w.pending_level, 2);
        assert_eq!(w.pending_since_slot, 0);
        let o = run(&mut w, &[(150, 5)]);
        assert_eq!(o[0].evolved, Some((1, 2)));
        assert_eq!((w.level, w.pending_level, w.pending_obs, w.pending_since_slot), (2, 5, 1, 150));
    }

    #[test]
    fn u4d_pending_expires_after_4_hold() {
        let mut w = card(1);
        run(&mut w, &[(0, 3)]);
        let o = run(&mut w, &[(600, 3)]);
        assert!(!o[0].expired);
        assert_eq!(o[0].observed, Some((3, 2)));
        let mut w2 = card(1);
        run(&mut w2, &[(0, 3)]);
        let o = run(&mut w2, &[(601, 3)]);
        assert!(o[0].expired);
        assert_eq!(o[0].observed, Some((3, 1)));
        assert_eq!((w2.pending_since_slot, w2.pending_obs), (601, 1));
        assert_eq!(o[0].evolved, None);
        let mut w3 = card(1);
        run(&mut w3, &[(0, 5), (40, 5)]);
        let o = run(&mut w3, &[(10_000, 5)]);
        assert!(o[0].expired && o[0].evolved.is_none());
        let mut w4 = card(1);
        run(&mut w4, &[(0, 5)]);
        let o = run(&mut w4, &[(1_000, 1)]);
        assert!(o[0].expired && !o[0].dip_cleared);
        assert_eq!(five(&w4), five(&card(1)));
    }

    #[test]
    fn u4e_plus_two_cap_then_climbing_continues_next_window() {
        let mut w = card(1);
        let o = run(&mut w, &[(0, 9), (40, 9), (80, 9), (150, 9)]);
        assert_eq!(o[3].evolved, Some((1, 3)));
        assert_eq!((w.level, w.pending_level, w.pending_since_slot, w.pending_obs), (3, 9, 150, 1));
        let o = run(&mut w, &[(190, 9), (230, 9), (299, 9), (300, 9)]);
        assert_eq!(o[2].evolved, None);
        assert_eq!(o[3].evolved, Some((3, 5)));
        let o = run(&mut w, &[(340, 9), (380, 9), (450, 9)]);
        assert_eq!(o[2].evolved, Some((5, 7)));
        let o = run(&mut w, &[(490, 8), (530, 8), (600, 8)]);
        assert_eq!(o[2].evolved, Some((7, 8)));
        assert_eq!(w, Window { level: 8, ..Default::default() });
        let o = run(&mut w, &[(700, 1)]);
        assert_eq!((o[0], w.level), (StepOutcome::default(), 8));
    }

    #[test]
    fn u4f_observe_sell_observe_high_confirm_attack_fails() {
        let mut w = card(1);
        let attack = [(0, 5), (10, 1), (40, 5), (55, 1), (80, 5), (120, 1), (150, 5)];
        let o = run(&mut w, &attack);
        assert!(o.iter().all(|x| x.evolved.is_none()), "{o:?}");
        assert_eq!(w.level, 1);
        assert_eq!((w.pending_level, w.pending_obs, w.pending_since_slot), (5, 1, 150));
        let mut w2 = card(1);
        let o = run(&mut w2, &[(0, 5), (40, 5), (80, 5), (150, 1)]);
        assert!(o.iter().all(|x| x.evolved.is_none()));
        assert_eq!(five(&w2), five(&card(1)));
    }

    #[test]
    fn u4g_observations_closer_than_gap_do_not_count() {
        let mut w = card(1);
        let o = run(&mut w, &[(0, 3), (36, 3), (37, 3), (73, 3), (74, 3)]);
        let counted: Vec<u8> = o.iter().map(|x| x.observed.unwrap().1).collect();
        assert_eq!(counted, vec![1, 1, 2, 2, 3]);
        assert_eq!(w.pending_last_slot, 74);
        let mut w2 = card(1);
        let o = run(&mut w2, &[(0, 3), (0, 3), (0, 3), (150, 3)]);
        assert_eq!(o[2].observed, Some((3, 1)));
        assert_eq!(o[3].observed, Some((3, 2)));
        assert!(o[3].evolved.is_none());
        let mut w3 = card(1);
        let o = run(&mut w3, &[(0, 5), (1, 3)]);
        assert_eq!(o[1].observed, Some((3, 1)));
    }

    #[test]
    fn u4h_live_at_or_below_level_is_a_no_op() {
        let mut w = card(4);
        for live in [1, 2, 3, 4] {
            let before = w;
            let o = step(&mut w, live, 1_000, &P, Who::Open);
            assert_eq!(o, StepOutcome::default());
            assert_eq!(w, before);
        }
    }

    // ---------------------------------------------------------------- F1: who may count

    #[test]
    fn u4i_cap_calls_cannot_start_count_or_confirm() {
        // idle card: Cap highs leave it idle (no observed event either)
        let mut w = card(1);
        let o = run_as(&mut w, &A, Who::Cap, &[(0, 5), (40, 5), (200, 5)]);
        assert!(o.iter().all(|x| *x == StepOutcome::default()));
        assert_eq!(w, card(1));
        // a window open: Cap calls at gap spacing add no count and never confirm; they lower and clear
        let mut w = card(1);
        run_as(&mut w, &A, CRANK, &[(0, 5)]);
        let o = run_as(&mut w, &A, Who::Cap, &[(40, 5), (80, 5), (150, 5), (200, 5)]);
        assert!(o.iter().all(|x| x.evolved.is_none()));
        assert_eq!((w.pending_obs, w.pending_last_slot, w.observers), (1, 0, 1));
        let o = run_as(&mut w, &A, Who::Cap, &[(210, 3)]);
        assert_eq!(o[0].observed, Some((3, 1)));
        assert_eq!(w.pending_level, 3);
        let o = run_as(&mut w, &A, Who::Cap, &[(220, 1)]);
        assert!(o[0].dip_cleared);
        assert_eq!(w.pending_level, 0);
        // the confirming call must count too: with enough counted obs and hold, a Cap call does not confirm
        let mut w = card(1);
        run_as(&mut w, &A, CRANK, &[(0, 5), (40, 5), (80, 5)]);
        assert_eq!(run_as(&mut w, &A, Who::Cap, &[(150, 5)])[0].evolved, None);
        assert_eq!(run_as(&mut w, &A, CRANK, &[(151, 5)])[0].evolved, Some((1, 3)));
    }

    #[test]
    fn u4j_witness_bits_and_min_observers() {
        let two = EvolveParams { min_observers: 2, ..A };
        let mut w = card(1);
        run_as(&mut w, &two, CRANK, &[(0, 5), (40, 5), (80, 5)]);
        assert_eq!(w.observers, 1);
        // 3 counted, held >= 150, one witness: no confirm
        assert_eq!(run_as(&mut w, &two, CRANK, &[(150, 5)])[0].evolved, None);
        // the standby's observation adds its bit (closer than gap: no count) and confirms
        let o = run_as(&mut w, &two, STANDBY, &[(151, 5)]);
        assert_eq!(o[0].evolved, Some((1, 3)));
        // the post-confirm restart carries only the confirming caller's bit
        assert_eq!((w.pending_level, w.observers, w.epoch), (5, 2, 1));
        // bits reset on a dip, an expiry and a start
        run_as(&mut w, &two, CRANK, &[(160, 5)]);
        assert_eq!(w.observers, 3);
        run_as(&mut w, &two, Who::Cap, &[(170, 3)]);
        assert_eq!((w.pending_level, w.observers, w.epoch), (0, 0, 0));
        run_as(&mut w, &two, STANDBY, &[(180, 5)]);
        assert_eq!(w.observers, 2);
        run_as(&mut w, &two, CRANK, &[(180 + 601, 5)]);
        assert_eq!(w.observers, 1, "expired, restarted by the crank");
        // min_observers 0 (open mode) needs no bit
        let mut o = card(1);
        let r = run(&mut o, &[(0, 3), (40, 3), (150, 3)]);
        assert_eq!(r[2].evolved, Some((1, 3)));
    }

    /// The F1 finding: bundled self-observations `[buy][evolve][sell]` by someone without an observer key.
    #[test]
    fn u4k_bundle_self_observations_confirm_in_open_mode_and_never_open_in_attested_mode() {
        let slots: Vec<(u64, u8)> = (0..16).map(|i| (i * 38, 5u8)).collect(); // gap-spaced, over 4 x hold
        // open mode, no watchdog: +2 within one hold (documents the finding)
        let mut w = card(1);
        let o = run(&mut w, &slots);
        assert!(o.iter().any(|x| x.evolved == Some((1, 3))));
        // attested mode: an outsider's plain evolve is not even a step (the handler returns early, see
        // evolve_card.rs); as a Cap-class caller it can never open a window either
        let mut w = card(1);
        let o = run_as(&mut w, &A, Who::Cap, &slots);
        assert!(o.iter().all(|x| x.evolved.is_none() && x.observed.is_none()));
        assert_eq!(w, card(1));
    }

    /// A leaked COUNT key attests bundled highs; the watcher's honest reads (Cap, capped at the real level) clear them.
    #[test]
    fn u4l_leaked_count_key_vs_watcher_clears() {
        let mut w = card(1);
        let mut r = XorShift::new(41);
        for i in 0..40u64 {
            let s = i * 38;
            step(&mut w, 5, s, &A, CRANK); // the attacker's attested high
            let between = s + 1 + r.next() % 36;
            step(&mut w, 1, between, &A, Who::Cap); // the watcher reads the real level in between
        }
        assert_eq!(w.level, 1, "never confirms while the watcher reads in between");
        // without the watcher it confirms (the documented residual of a leaked COUNT key)
        let mut w = card(1);
        for i in 0..5u64 {
            step(&mut w, 5, i * 38, &A, CRANK);
        }
        assert_eq!(w.level, 3);
    }

    /// 10,000 random sequences of (who, live, slot): the level never decreases, each confirm is bounded, Cap calls never
    /// raise anything, and each confirm in attested mode has enough counted observations and witnesses.
    #[test]
    fn u4m_reference_model_fuzz() {
        let mut r = XorShift::new(2026);
        for seq in 0..10_000u64 {
            let attested = seq % 2 == 1;
            let mut p = EvolveParams {
                hold_slots: 150,
                min_obs: 2 + (r.next() % 3) as u8,
                max_step: 1 + (r.next() % 3) as u8,
                min_observers: if attested { 1 + (r.next() % 2) as u8 } else { 0 },
                epoch: if attested { 1 + (r.next() % 3) as u8 } else { 0 },
                resumed_slot: 0,
            };
            let mut w = card(1 + (r.next() % 3) as u8);
            let mut slot = r.next() % 100;
            // the minimum live level anyone observed since the current window started
            let mut min_live: u8 = u8::MAX;
            for _ in 0..60 {
                slot += r.next() % 60;
                // review round 2: now and then EVOLVE was paused and unpaused since the last call
                if r.next() % 20 == 0 {
                    p.resumed_slot = slot.saturating_sub(r.next() % 30);
                }
                let live = 1 + (r.next() % 14) as u8;
                let who = if !attested {
                    Who::Open
                } else {
                    match r.next() % 3 {
                        0 => Who::Cap,
                        1 => CRANK,
                        _ => STANDBY,
                    }
                };
                let before = w;
                let o = step(&mut w, live, slot, &p, who);
                assert!(w.level >= before.level, "level decreased");
                if let Some((from, to)) = o.evolved {
                    assert!(to > from && to <= from + p.max_step, "confirm bound");
                    assert!(to <= live && to <= min_live, "confirmed above a level observed in the window");
                    assert!(!matches!(who, Who::Cap), "a Cap call confirmed");
                    assert!(before.pending_obs + 1 >= p.min_obs, "confirm without enough counted observations");
                    assert!(slot >= before.pending_since_slot + p.hold_slots, "confirm before the hold");
                    assert!(before.pending_since_slot >= p.resumed_slot, "confirmed a window held across an EVOLVE pause");
                    if attested {
                        let bits = before.observers | if let Who::Count { bit } = who { bit } else { 0 };
                        assert!(bits.count_ones() >= p.min_observers as u32, "confirm without enough witnesses");
                    }
                } else {
                    assert_eq!(w.level, before.level);
                }
                if matches!(who, Who::Cap) {
                    assert!(w.pending_obs <= before.pending_obs, "a Cap call counted");
                    assert!(w.pending_level <= before.pending_level, "a Cap call raised or opened a window");
                }
                // window bookkeeping for the next call
                if w.pending_level == 0 {
                    min_live = u8::MAX;
                } else if w.pending_since_slot == slot
                    && (before.pending_level == 0 || before.pending_since_slot != slot || o.evolved.is_some() || o.expired)
                {
                    min_live = live;
                } else {
                    min_live = min_live.min(live);
                }
            }
        }
    }

    #[test]
    fn u4n_epoch_restart() {
        // a window opened in open mode (no witness, epoch 0) restarts on the first counting call after the switch
        let mut w = card(1);
        run(&mut w, &[(0, 5), (40, 5), (80, 5)]);
        assert_eq!((w.pending_obs, w.observers, w.epoch), (3, 0, 0));
        let o = run_as(&mut w, &A, CRANK, &[(150, 5)]);
        assert_eq!(o[0].evolved, None, "no inherited open-mode counts");
        assert_eq!((w.pending_since_slot, w.pending_obs, w.observers, w.epoch), (150, 1, 1, 1));
        // a rotation (epoch 1 -> 2) restarts the window on the next counting call, whatever its bits
        run_as(&mut w, &A, CRANK, &[(190, 5), (230, 5)]);
        assert_eq!(w.pending_obs, 3);
        let rotated = EvolveParams { epoch: 2, ..A };
        let o = run_as(&mut w, &rotated, CRANK, &[(300, 5)]);
        assert_eq!(o[0].evolved, None);
        assert_eq!((w.pending_since_slot, w.pending_obs, w.epoch), (300, 1, 2));
        // a Cap call under a new epoch does not restart (it may only lower)
        let rotated3 = EvolveParams { epoch: 3, ..A };
        run_as(&mut w, &rotated3, Who::Cap, &[(310, 4)]);
        assert_eq!((w.pending_since_slot, w.pending_level, w.epoch), (300, 4, 2));
    }

    /// Review round 2 (high): every observation is refused while EVOLVE is paused, so a window opened before the
    /// unpause restarts on its next observation; one opened after it is unaffected.
    #[test]
    fn r2_pause_restarts_windows() {
        // a window with 2 of 3 counts, then EVOLVE paused and unpaused at slot 100 (a dip in between was never seen)
        let mut w = card(1);
        run_as(&mut w, &A, CRANK, &[(0, 5), (40, 5)]);
        assert_eq!(w.pending_obs, 2);
        let resumed = EvolveParams { resumed_slot: 100, ..A };
        let o = run_as(&mut w, &resumed, CRANK, &[(160, 5)]);
        assert!(o[0].expired, "the pre-pause window is dropped");
        assert_eq!(o[0].evolved, None, "no confirm on counts gathered before the pause");
        assert_eq!((w.pending_level, w.pending_obs, w.pending_since_slot), (5, 1, 160), "a fresh window from this call");
        assert_eq!((w.hwm_level, w.hwm_until), (5, 160 + 150), "the listing mark covers a full hold");
        // the fresh window needs its own full hold and counts
        assert_eq!(run_as(&mut w, &resumed, CRANK, &[(200, 5), (240, 5)])[1].evolved, None);
        assert_eq!(run_as(&mut w, &resumed, CRANK, &[(310, 5)])[0].evolved, Some((1, 3)));
        // a Cap call after the unpause drops the stale window too (and opens nothing)
        let mut c = card(1);
        run_as(&mut c, &A, CRANK, &[(0, 5)]);
        let o = run_as(&mut c, &resumed, Who::Cap, &[(150, 5)]);
        assert!(o[0].expired && o[0].observed.is_none());
        assert_eq!(c.pending_level, 0);
        // open mode follows the same rule
        let mut op = card(1);
        run(&mut op, &[(0, 3), (40, 3), (80, 3)]);
        let o = step(&mut op, 3, 150, &EvolveParams { resumed_slot: 90, ..P }, Who::Open);
        assert!(o.expired && o.evolved.is_none());
        // a window opened at or after the unpause slot is untouched; resumed_slot 0 (never paused) changes nothing
        let mut n = card(1);
        run_as(&mut n, &resumed, CRANK, &[(100, 5), (140, 5), (180, 5)]);
        assert_eq!(run_as(&mut n, &resumed, CRANK, &[(250, 5)])[0].evolved, Some((1, 3)));
        let mut z = card(1);
        run_as(&mut z, &A, CRANK, &[(0, 5), (40, 5), (80, 5)]);
        assert_eq!(run_as(&mut z, &A, CRANK, &[(150, 5)])[0].evolved, Some((1, 3)));
    }

    /// Review round 2 (low): an ignored counting call lowers the pending level to its cap (the observer's own read),
    /// never further, never counts and never adds a witness.
    #[test]
    fn r2_ignored_call_lowers_to_its_cap() {
        let mut w = card(1);
        run_as(&mut w, &A, CRANK, &[(0, 5), (40, 5)]);
        let before = w;
        // the crank read 3 (cap 3 > level 1) while a sell put the on-chain level at 2: ignored, lowered to 3
        assert!(count_call_ignored(CRANK, 3, w.level, 2));
        assert!(lower_on_ignored(&mut w, 3));
        assert_eq!(w, Window { pending_level: 3, ..before });
        // a cap at or above the pending level, or at or below the card level, changes nothing
        for cap in [3, 4, 9, 1] {
            let b = w;
            assert!(!lower_on_ignored(&mut w, cap));
            assert_eq!(w, b);
        }
        // nothing pending: nothing to lower
        let mut idle = card(1);
        assert!(!lower_on_ignored(&mut idle, 3));
        assert_eq!(idle, card(1));
        // the confirm then uses the lowered level (max_step 4: without the lowering it would confirm 1 -> 5)
        let wide = EvolveParams { max_step: 4, ..A };
        let mut unlowered = before;
        assert_eq!(run_as(&mut unlowered, &wide, CRANK, &[(80, 5), (150, 5)])[1].evolved, Some((1, 5)));
        let o = run_as(&mut w, &wide, CRANK, &[(80, 5), (150, 5)]);
        assert_eq!(o[1].evolved, Some((1, 3)));
    }

    #[test]
    fn ignore_rule_truth_table() {
        // cap <= level: never ignored (clears and no-ops must land)
        for (cap, level, onchain) in [(1, 1, 1), (3, 3, 1), (2, 3, 9)] {
            assert!(!count_call_ignored(CRANK, cap, level, onchain));
        }
        // cap > level: a counting call is ignored only when the on-chain read is below the cap
        assert!(count_call_ignored(CRANK, 5, 1, 4));
        assert!(count_call_ignored(CRANK, 5, 1, 1));
        assert!(!count_call_ignored(CRANK, 5, 1, 5));
        assert!(!count_call_ignored(CRANK, 5, 1, 9));
        // Cap and Open callers are never ignored
        assert!(!count_call_ignored(Who::Cap, 5, 1, 1));
        assert!(!count_call_ignored(Who::Open, 5, 1, 1));
    }

    // ---------------------------------------------------------------- F2: the listing-pause mark

    #[test]
    fn f2a_dip_arms_clamp_held_gap_hold() {
        // held 80 slots (between gap 37 and hold 150): the mark covers 80 slots after the dip
        let mut w = card(1);
        run(&mut w, &[(0, 3), (40, 3)]);
        let o = run(&mut w, &[(80, 1)]);
        assert!(o[0].dip_cleared);
        assert_eq!((w.hwm_level, w.hwm_until), (3, 160));
        assert!(w.unlocking_above(1, 160));
        assert!(!w.unlocking_above(1, 161));
        assert!(!w.unlocking_above(3, 100), "only above the listing level");
        // a one-read blip pauses only one gap
        let mut b = card(1);
        run(&mut b, &[(1_000, 3), (1_001, 1)]);
        assert_eq!(b.hwm_until, 1_001 + 37);
        // a window held longer than hold pauses at most one hold
        let mut l = card(1);
        run(&mut l, &[(0, 3), (40, 3), (100, 3)]);
        l.pending_obs = 1; // not enough counts to have confirmed
        run(&mut l, &[(500, 1)]);
        assert_eq!(l.hwm_until, 650);
    }

    #[test]
    fn f2b_mark_keeps_the_max_and_survives_further_dips() {
        let mut w = card(1);
        run(&mut w, &[(0, 5), (40, 3), (60, 1)]); // pending lowered to 3 before the dip: mark level 3
        assert_eq!((w.hwm_level, w.hwm_until), (3, 60 + 60));
        run(&mut w, &[(70, 6), (75, 1)]); // a higher blip: the max is kept, the deadline never shrinks
        assert_eq!(w.hwm_level, 6);
        assert_eq!(w.hwm_until, 120.max(75 + 37));
        // a further dip with nothing pending changes nothing
        let before = w;
        run(&mut w, &[(80, 1)]);
        assert_eq!(w, before);
    }

    #[test]
    fn f2c_confirm_resets_the_mark() {
        let mut w = card(1);
        run(&mut w, &[(0, 4), (10, 1)]); // a mark at level 4
        assert_eq!(w.hwm_level, 4);
        let o = run(&mut w, &[(20, 4), (60, 4), (100, 4), (170, 4)]);
        assert_eq!(o[3].evolved, Some((1, 3)));
        assert_eq!((w.hwm_level, w.hwm_until), (0, 0));
        assert_eq!(w.pending_level, 4, "live 4 > 3: the next window starts at once");
    }

    #[test]
    fn f2d_lapse_then_fresh_episode() {
        let mut w = card(1);
        run(&mut w, &[(0, 7), (50, 1)]); // mark 7 until 100
        assert_eq!((w.hwm_level, w.hwm_until), (7, 100));
        run(&mut w, &[(101, 3)]); // step 0 lapses the old mark; a new window at 3
        assert_eq!((w.hwm_level, w.hwm_until), (0, 0));
        run(&mut w, &[(120, 1)]);
        assert_eq!(w.hwm_level, 3, "the new episode starts from its own pending level");
    }

    #[test]
    fn f2e_pre_upgrade_window_adopted() {
        // a card that was pending when the fix pack landed (mark bytes zero) still arms the mark on its dip
        let mut w = Window { level: 1, pending_level: 4, pending_obs: 2, pending_since_slot: 100, pending_last_slot: 140, ..Default::default() };
        run(&mut w, &[(200, 1)]);
        assert_eq!((w.hwm_level, w.hwm_until), (4, 300));
    }

    #[test]
    fn f2f_expiry_arms_a_full_hold() {
        let mut w = card(1);
        run(&mut w, &[(0, 5)]);
        let o = run(&mut w, &[(601, 1)]);
        assert!(o[0].expired && !o[0].dip_cleared);
        assert_eq!((w.hwm_level, w.hwm_until), (5, 751));
        // expiry followed by a new high in the same call: the mark stays armed while the new window runs
        let mut x = card(1);
        run(&mut x, &[(0, 5)]);
        run(&mut x, &[(700, 6)]);
        assert_eq!((x.hwm_level, x.hwm_until, x.pending_level), (5, 850, 6));
    }

    #[test]
    fn f2g_cap_clear_arms_like_any_dip() {
        let mut w = card(1);
        run_as(&mut w, &A, CRANK, &[(0, 5), (40, 5), (80, 5)]);
        run_as(&mut w, &A, Who::Cap, &[(100, 1)]);
        assert_eq!((w.pending_level, w.hwm_level, w.hwm_until), (0, 5, 200));
    }

    /// Random sequences: `unlocking_above(L, t)` holds at every slot inside an armed TTL unless a confirm happened.
    #[test]
    fn f2h_random_sequences_keep_the_pause() {
        let mut r = XorShift::new(99);
        for _ in 0..10_000 {
            let mut w = card(1);
            let mut slot = 0u64;
            let mut armed: Option<(u8, u64)> = None; // (level, until) of the latest arm
            for _ in 0..30 {
                slot += r.next() % 80;
                let live = 1 + (r.next() % 6) as u8;
                let before = w;
                let o = step(&mut w, live, slot, &P, Who::Open);
                if o.evolved.is_some() {
                    armed = None;
                    continue;
                }
                if o.dip_cleared || o.expired {
                    let ttl = if o.dip_cleared && !o.expired {
                        slot.saturating_sub(before.pending_since_slot).clamp(P.gap(), P.hold_slots)
                    } else {
                        P.hold_slots
                    };
                    let lvl = before.pending_level;
                    armed = Some(match armed {
                        Some((l, u)) if slot <= u => (l.max(lvl), u.max(slot + ttl)),
                        _ => (lvl, slot + ttl),
                    });
                }
                if let Some((lvl, until)) = armed {
                    if slot <= until && lvl > w.level {
                        for t in [slot, (slot + until) / 2, until] {
                            assert!(w.unlocking_above(w.level, t), "pause dropped inside the armed ttl");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn card_round_trip() {
        let mut c = Card {
            version: 1, bump: 1, vault_bump: 1, card_mint_bump: 1, level: 2, pending_level: 4, flags: 0, pending_obs: 2,
            mint: Default::default(), card_mint: Default::default(), launcher: Default::default(), pool: Default::default(),
            pending_since_slot: 10, registered_at: 0, evolved_at: 0, peak_mcap_lamports: 0, peak_mcap_usd_e6: 0,
            fees_paid_out: 0, last_sale_price: 0, sales: 0, pending_last_slot: 50, pending_hwm_until: 0,
            pending_hwm_level: 0, pending_observers: 0, pending_epoch: 0, reserved: [0; 41],
        };
        let mut w = Window::from_card(&c);
        assert_eq!(
            w,
            Window { level: 2, pending_level: 4, pending_obs: 2, pending_since_slot: 10, pending_last_slot: 50, ..Default::default() }
        );
        step(&mut w, 4, 160, &P, Who::Open);
        w.write_to(&mut c);
        assert_eq!((c.level, c.pending_level), (4, 0));
        let m = Window { hwm_until: 7, hwm_level: 8, observers: 9, epoch: 10, ..w };
        m.write_to(&mut c);
        assert_eq!((c.pending_hwm_until, c.pending_hwm_level, c.pending_observers, c.pending_epoch), (7, 8, 9, 10));
        assert_eq!(Window::from_card(&c), m);
    }
}
