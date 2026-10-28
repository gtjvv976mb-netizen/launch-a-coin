//! The observer set and the emergency pause (mainnet fix pack: refs/mainnet/fix-plan.md §2.3, F1 + admin B9, B12).
//!
//! - `set_observers(keys, roles, min_observers, expected_epoch)` writes the `ObserverSet` PDA and
//!   `Config.evolve_min_observers` in one instruction (mode and set never disagree) and advances `ObserverSet.epoch`,
//!   so every open window restarts on its next counting call. The program's upgrade authority (the time-locked
//!   multisig on mainnet) may write any valid set; the admin may write any valid set while `tier_guard` is off and only
//!   shrink it while it is on (tier B9): adding a COUNT key or lowering `min_observers` would re-open what F1 closes.
//!   Review round 2: a write that is not a shrink of the LIVE set must name the live epoch (`expected_epoch`), so a
//!   growth proposal built before a removal (and queued behind the time lock) can never re-add the removed key
//!   (`ObserverSetChanged`); a shrink of the live set only removes keys or roles, so it applies whatever it was built
//!   from (prepared emergency removals keep working).
//! - `set_paused(set_bits, clear_bits)`: the admin sets and clears any known pause bits (a bit in both is invalid); the
//!   result is `(paused | set_bits) & !clear_bits`, so two proposals built at different times compose instead of the
//!   later one restoring an old snapshot (review round 2). An observer with ROLE_PAUSE (the watcher) may only set the
//!   EVOLVE bit (admin B12): never clear a bit, never touch MARKET or REGISTER, so a hot key cannot freeze trading.
//!   Clearing EVOLVE records `Config.evolve_resumed_slot` (windows opened before it restart).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::{ConfigUpdated, ObserversSet};
use crate::instructions::admin::upgradeable;
use crate::state::{load_observer_set, observer_set_is_shrink, observer_set_valid, Config, ObserverSet};

// ---------------------------------------------------------------- set_observers

#[event_cpi]
#[derive(Accounts)]
pub struct SetObservers<'info> {
    /// The upgrade authority, or `config.admin` (see the rules above). Pays the set's rent on first use.
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(init_if_needed, payer = authority, space = ObserverSet::LEN, seeds = [OBSERVERS_SEED], bump)]
    pub observer_set: Box<Account<'info, ObserverSet>>,
    /// CHECK: optional; MintDex's ProgramData (`PROGRAM_DATA_ADDRESS`, owner the upgradeable loader): when present and
    /// its upgrade authority is `authority`, the upgrade-authority path applies.
    pub program_data: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

/// The upgrade-authority path of `set_observers`: MintDex's ProgramData (by address; the loader owns it) names `signer`
/// as the upgrade authority.
pub fn is_program_upgrade_authority(program_data: &AccountInfo, signer: &Pubkey) -> bool {
    *program_data.key == PROGRAM_DATA_ADDRESS && upgradeable::upgrade_authority_of(program_data) == Some(*signer)
}

/// Who may write the set (pure, unit-tested): `Ok(())`, `TierFieldsLocked` (the admin growing it under the guard) or
/// `Unauthorized`.
pub fn check_set_observers_authority(
    is_upgrade_authority: bool,
    is_admin: bool,
    tier_guard: u8,
    is_shrink: bool,
) -> Result<()> {
    if is_upgrade_authority || (is_admin && tier_guard == 0) {
        return Ok(());
    }
    require!(is_admin, MintdexError::Unauthorized);
    require!(is_shrink, MintdexError::TierFieldsLocked);
    Ok(())
}

/// Review round 2: a write that grows (or keeps) the set must be built from the live epoch; a shrink of the live set
/// applies whatever epoch it was built from (pure, unit-tested).
pub fn check_observer_epoch(is_shrink: bool, live_epoch: u8, expected_epoch: u8) -> Result<()> {
    require!(is_shrink || live_epoch == expected_epoch, MintdexError::ObserverSetChanged);
    Ok(())
}

pub fn set_observers(
    ctx: Context<SetObservers>,
    keys: [Pubkey; MAX_OBSERVERS],
    roles: [u8; MAX_OBSERVERS],
    min_observers: u8,
    expected_epoch: u8,
) -> Result<()> {
    let by = ctx.accounts.authority.key();
    let is_upgrade_authority =
        ctx.accounts.program_data.as_ref().is_some_and(|d| is_program_upgrade_authority(&d.to_account_info(), &by));
    let c = &mut ctx.accounts.config;
    let set = &mut ctx.accounts.observer_set;
    require!(
        observer_set_valid(&keys, &roles, min_observers, &c.admin, &c.treasury, &c.ticket_authority),
        MintdexError::InvalidConfig
    );
    let is_shrink = observer_set_is_shrink(&set.keys, &set.roles, c.evolve_min_observers, &keys, &roles, min_observers);
    check_set_observers_authority(is_upgrade_authority, by == c.admin, c.tier_guard, is_shrink)?;
    check_observer_epoch(is_shrink, set.epoch, expected_epoch)?;

    set.version = ObserverSet::VERSION;
    set.bump = ctx.bumps.observer_set;
    set.epoch = ObserverSet::next_epoch(set.epoch);
    set._pad = 0;
    set.keys = keys;
    set.roles = roles;
    set.updated_at = Clock::get()?.unix_timestamp;
    set.reserved = [0; 32];
    c.evolve_min_observers = min_observers;
    let epoch = set.epoch;
    crate::emit_event!(ctx, ObserversSet { keys, roles, min_observers, epoch, by });
    crate::emit_event!(ctx, ConfigUpdated { admin: by });
    Ok(())
}

// ---------------------------------------------------------------- set_paused

#[event_cpi]
#[derive(Accounts)]
pub struct SetPaused<'info> {
    /// `config.admin`, or an observer with ROLE_PAUSE (then remaining_accounts = `[ObserverSet]`).
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

/// The pause rule (pure, unit-tested); returns the new `paused`. The admin: any known bits to set and to clear, never
/// the same bit in both (`InvalidConfig`). A ROLE_PAUSE observer: `set_bits` exactly EVOLVE and nothing to clear.
/// Anyone else: `Unauthorized`.
pub fn check_set_paused(is_admin: bool, observer_roles: Option<u8>, current: u8, set_bits: u8, clear_bits: u8) -> Result<u8> {
    if is_admin {
        require!((set_bits | clear_bits) & !PAUSE_ALL == 0 && set_bits & clear_bits == 0, MintdexError::InvalidConfig);
        return Ok((current | set_bits) & !clear_bits);
    }
    let roles = observer_roles.ok_or_else(|| error!(MintdexError::Unauthorized))?;
    require!(roles & ROLE_PAUSE != 0 && set_bits == PAUSE_EVOLVE && clear_bits == 0, MintdexError::Unauthorized);
    Ok(current | PAUSE_EVOLVE)
}

/// Review round 2: the slot to record as `Config.evolve_resumed_slot` when a pause change clears EVOLVE (pure).
pub fn resumed_slot_after(old_paused: u8, new_paused: u8, slot: u64, recorded: u64) -> u64 {
    if old_paused & PAUSE_EVOLVE != 0 && new_paused & PAUSE_EVOLVE == 0 {
        slot
    } else {
        recorded
    }
}

pub fn set_paused(ctx: Context<SetPaused>, set_bits: u8, clear_bits: u8) -> Result<()> {
    let by = ctx.accounts.authority.key();
    let is_admin = by == ctx.accounts.config.admin;
    let observer_roles = if is_admin {
        None
    } else {
        match ctx.remaining_accounts.first() {
            Some(info) => load_observer_set(info)?.find(&by).map(|(_, r)| r),
            None => None,
        }
    };
    let c = &mut ctx.accounts.config;
    let paused = check_set_paused(is_admin, observer_roles, c.paused, set_bits, clear_bits)?;
    c.evolve_resumed_slot = resumed_slot_after(c.paused, paused, Clock::get()?.slot, c.evolve_resumed_slot);
    c.paused = paused;
    crate::emit_event!(ctx, ConfigUpdated { admin: by });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;

    #[test]
    fn set_observers_authority_table() {
        // upgrade authority: always (it can replace the program anyway)
        for guard in [0, 1] {
            for shrink in [false, true] {
                check_set_observers_authority(true, false, guard, shrink).unwrap();
            }
        }
        // admin: anything with the guard off, shrink only with it on (tier B9)
        check_set_observers_authority(false, true, 0, false).unwrap();
        check_set_observers_authority(false, true, 1, true).unwrap();
        assert_error(check_set_observers_authority(false, true, 1, false), MintdexError::TierFieldsLocked);
        // anyone else
        for guard in [0, 1] {
            assert_error(check_set_observers_authority(false, false, guard, true), MintdexError::Unauthorized);
        }
    }

    /// The upgrade-authority path reads MintDex's ProgramData by address: the loader-owned account at
    /// `PROGRAM_DATA_ADDRESS` naming the signer; any other address, owner or authority does not qualify.
    #[test]
    fn upgrade_authority_by_program_data() {
        let auth = Pubkey::new_unique();
        let pd = |authority: Option<Pubkey>| {
            let mut d = vec![0u8; 45];
            d[..4].copy_from_slice(&3u32.to_le_bytes());
            if let Some(a) = authority {
                d[12] = 1;
                d[13..45].copy_from_slice(a.as_ref());
            }
            d
        };
        let check = |key: Pubkey, owner: Pubkey, mut data: Vec<u8>, signer: Pubkey| {
            let mut lamports = 1u64;
            let info = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &owner, false, 0);
            is_program_upgrade_authority(&info, &signer)
        };
        let loader = upgradeable::LOADER_ID;
        assert!(check(PROGRAM_DATA_ADDRESS, loader, pd(Some(auth)), auth));
        assert!(!check(PROGRAM_DATA_ADDRESS, loader, pd(Some(auth)), Pubkey::new_unique()), "another signer");
        assert!(!check(PROGRAM_DATA_ADDRESS, loader, pd(None), auth), "immutable program (no authority)");
        assert!(!check(Pubkey::new_unique(), loader, pd(Some(auth)), auth), "another program's ProgramData");
        assert!(!check(PROGRAM_DATA_ADDRESS, crate::ID, pd(Some(auth)), auth), "not owned by the loader");
    }

    #[test]
    fn set_paused_rules() {
        // the admin: any known bits to set and clear; the result composes with the live value
        for current in 0..=PAUSE_ALL {
            for set in 0..=PAUSE_ALL {
                for clear in 0..=PAUSE_ALL {
                    let r = check_set_paused(true, None, current, set, clear);
                    if set & clear != 0 {
                        assert_error(r, MintdexError::InvalidConfig);
                    } else {
                        assert_eq!(r.unwrap(), (current | set) & !clear);
                    }
                }
            }
        }
        assert_error(check_set_paused(true, None, 0, 8, 0), MintdexError::InvalidConfig);
        assert_error(check_set_paused(true, None, 0, 0, 8), MintdexError::InvalidConfig);
        // review round 2: the watcher paused EVOLVE (2); a MARKET pause proposal built before it keeps EVOLVE
        assert_eq!(check_set_paused(true, None, PAUSE_EVOLVE, PAUSE_MARKET, 0).unwrap(), PAUSE_EVOLVE | PAUSE_MARKET);
        // and an unpause of MARKET only leaves EVOLVE alone
        assert_eq!(check_set_paused(true, None, PAUSE_EVOLVE | PAUSE_MARKET, 0, PAUSE_MARKET).unwrap(), PAUSE_EVOLVE);
        // a ROLE_PAUSE observer (the watcher, roles CAP | PAUSE) may only set EVOLVE
        let w = Some(ROLE_CAP | ROLE_PAUSE);
        assert_eq!(check_set_paused(false, w, 0, PAUSE_EVOLVE, 0).unwrap(), PAUSE_EVOLVE);
        assert_eq!(check_set_paused(false, w, PAUSE_MARKET, PAUSE_EVOLVE, 0).unwrap(), PAUSE_MARKET | PAUSE_EVOLVE);
        assert_eq!(check_set_paused(false, w, PAUSE_EVOLVE, PAUSE_EVOLVE, 0).unwrap(), PAUSE_EVOLVE); // idempotent
        assert_error(check_set_paused(false, w, PAUSE_EVOLVE, 0, PAUSE_EVOLVE), MintdexError::Unauthorized); // clearing
        assert_error(check_set_paused(false, w, PAUSE_EVOLVE, PAUSE_EVOLVE, PAUSE_MARKET), MintdexError::Unauthorized);
        assert_error(check_set_paused(false, w, 0, PAUSE_MARKET, 0), MintdexError::Unauthorized); // MARKET
        assert_error(check_set_paused(false, w, 0, PAUSE_REGISTER | PAUSE_EVOLVE, 0), MintdexError::Unauthorized);
        assert_error(check_set_paused(false, w, 0, 0, 0), MintdexError::Unauthorized); // a no-op is not allowed either
        // an observer without ROLE_PAUSE (the crank) and a stranger
        assert_error(check_set_paused(false, Some(ROLE_COUNT | ROLE_CAP), 0, PAUSE_EVOLVE, 0), MintdexError::Unauthorized);
        assert_error(check_set_paused(false, None, 0, PAUSE_EVOLVE, 0), MintdexError::Unauthorized);
    }

    /// Review round 2: only a change that clears EVOLVE records the resume slot.
    #[test]
    fn resume_slot_recorded_on_evolve_unpause_only() {
        assert_eq!(resumed_slot_after(PAUSE_EVOLVE, 0, 900, 5), 900);
        assert_eq!(resumed_slot_after(PAUSE_ALL, PAUSE_MARKET, 900, 5), 900);
        assert_eq!(resumed_slot_after(0, PAUSE_EVOLVE, 900, 5), 5); // pausing
        assert_eq!(resumed_slot_after(PAUSE_EVOLVE, PAUSE_EVOLVE, 900, 5), 5); // still paused
        assert_eq!(resumed_slot_after(PAUSE_MARKET, 0, 900, 5), 5); // MARKET only
        assert_eq!(resumed_slot_after(0, 0, 900, 5), 5);
    }

    /// Review round 2: a growth (or same-size rewrite) needs the live epoch; a shrink of the live set does not.
    #[test]
    fn observer_epoch_rule() {
        check_observer_epoch(false, 4, 4).unwrap();
        assert_error(check_observer_epoch(false, 5, 4), MintdexError::ObserverSetChanged);
        check_observer_epoch(true, 5, 4).unwrap();
        check_observer_epoch(true, 5, 5).unwrap();
        // first creation: the set does not exist yet (epoch 0)
        check_observer_epoch(false, 0, 0).unwrap();
        assert_error(check_observer_epoch(false, 0, 1), MintdexError::ObserverSetChanged);
        // the runbook race: the admin removed the leaked crank (epoch 4 -> 5) while a growth built at epoch 4 waited in
        // the time lock; the growth (which still lists the crank) is not a shrink of the live set, so it fails
        let (crank, standby, watcher, fresh) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let mut old_keys = [Pubkey::default(); MAX_OBSERVERS];
        let mut old_roles = [0u8; MAX_OBSERVERS];
        (old_keys[0], old_keys[1], old_keys[2]) = (crank, standby, watcher);
        (old_roles[0], old_roles[1], old_roles[2]) = (3, 3, 6);
        let mut live_keys = old_keys;
        let mut live_roles = old_roles;
        live_keys[0] = Pubkey::default();
        live_roles[0] = 0;
        let mut growth_keys = old_keys;
        let mut growth_roles = old_roles;
        growth_keys[3] = fresh;
        growth_roles[3] = 3;
        let shrink = crate::state::observer_set_is_shrink(&live_keys, &live_roles, 1, &growth_keys, &growth_roles, 1);
        assert!(!shrink);
        assert_error(check_observer_epoch(shrink, 5, 4), MintdexError::ObserverSetChanged);
        // the prepared removal of the crank (built at epoch 3) still applies at epoch 4: it shrinks the live set
        let removal = crate::state::observer_set_is_shrink(&old_keys, &old_roles, 1, &live_keys, &live_roles, 1);
        assert!(removal);
        check_observer_epoch(removal, 4, 3).unwrap();
    }
}
