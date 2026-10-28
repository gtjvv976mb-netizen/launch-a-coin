//! Admin instructions (card-program-v2 §7.1): initialize (gated by the upgrade authority), update_config,
//! two-step admin transfer, set_price, issue_tickets / revoke_ticket; mainnet fix pack (fix-plan §2.6):
//! `update_tier_config` (the guarded fields, signed by the upgrade authority = the time-locked Squads), `set_config_ext`
//! (register flags, outside royalty, ticket authority and allowance, field mask), the F4 baseline at `initialize`, the
//! F6 guard in `update_config` and `set_price`, and the F12 ticket authority.

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::{ConfigExtUpdated, ConfigUpdated, PriceUpdated, TicketRevoked, TicketsIssued, TierConfigUpdated};
use crate::price::{check_set_price, feed_too_old, initial_baseline, pyth_sol_usd_e6_from_account, within_switch_band};
use crate::state::{load_observer_set, tier_fields_equal, Config, ConfigExtParams, ConfigParams, Ticket, TierParams};
use crate::utils::create_pda_account;

/// BPF upgradeable loader account layouts (bincode of `UpgradeableLoaderState`), read without bincode.
pub mod upgradeable {
    use anchor_lang::prelude::*;

    pub const LOADER_ID: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

    /// `Program { programdata_address }`: u32 tag 2, then the address.
    pub fn program_data_address_of(program: &AccountInfo) -> Option<Pubkey> {
        if *program.owner != LOADER_ID || !program.executable {
            return None;
        }
        let d = program.try_borrow_data().ok()?;
        (d.len() >= 36 && d[..4] == 2u32.to_le_bytes()).then(|| Pubkey::new_from_array(d[4..36].try_into().unwrap()))
    }

    /// `ProgramData { slot, upgrade_authority_address }`: u32 tag 3, u64 slot, u8 option tag, then the authority.
    pub fn upgrade_authority_of(program_data: &AccountInfo) -> Option<Pubkey> {
        if *program_data.owner != LOADER_ID {
            return None;
        }
        let d = program_data.try_borrow_data().ok()?;
        (d.len() >= 45 && d[..4] == 3u32.to_le_bytes() && d[12] == 1)
            .then(|| Pubkey::new_from_array(d[13..45].try_into().unwrap()))
    }
}

/// The max age used to record a Pyth price from an admin instruction (`max_price_age_secs`, or 60 s under Admin).
fn record_max_age(c: &Config) -> u32 {
    if c.max_price_age_secs > 0 {
        c.max_price_age_secs
    } else {
        PYTH_RECORD_DEFAULT_MAX_AGE_SECS
    }
}

// ---------------------------------------------------------------- initialize

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: ConfigParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::LEN, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: must be `params.treasury`; only its balance is read (≥ rent(0), §4.1).
    #[account(address = params.treasury @ MintdexError::InvalidConfig)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: the MintDex program account; its `programdata_address` must be `program_data` (R17). Parsed by hand
    /// (`upgradeable::program_data_address_of`): Anchor's `Program::programdata_address()` and `Account<ProgramData>`
    /// deserialize with bincode/serde, which pulls ~55 KB of float formatting into the .so.
    #[account(
        address = crate::ID,
        constraint = upgradeable::program_data_address_of(&this_program) == Some(program_data.key()) @ MintdexError::Unauthorized,
    )]
    pub this_program: UncheckedAccount<'info>,
    /// CHECK: the program's ProgramData account; its upgrade authority must be the signing admin (blocks the v1
    /// front-run, R17).
    #[account(
        constraint = upgradeable::upgrade_authority_of(&program_data) == Some(admin.key()) @ MintdexError::Unauthorized,
    )]
    pub program_data: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: optional (F4); required when `params.price_source` is Pyth. Its price becomes `last_pyth_sol_usd_e6`.
    #[account(
        address = params.pyth_price_account @ MintdexError::PriceFeedMismatch,
        owner = PYTH_RECEIVER_PROGRAM_ID @ MintdexError::PriceFeedMismatch,
    )]
    pub price_feed: Option<UncheckedAccount<'info>>,
}

pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
    let rent0 = Rent::get()?.minimum_balance(0);
    params.validate(rent0)?;
    require!(ctx.accounts.treasury.lamports() >= rent0, MintdexError::InvalidConfig);
    let now = Clock::get()?.unix_timestamp;
    let admin = ctx.accounts.admin.key();
    // F4: the Pyth baseline is recorded at initialize (a Pyth config cannot start without one).
    let feed = ctx.accounts.price_feed.as_ref().map(|f| f.to_account_info());
    let baseline = initial_baseline(
        params.price_source,
        feed.as_ref(),
        &params.pyth_price_account,
        now,
        params.max_price_age_secs,
        params.max_conf_bps,
    )?;
    let c = &mut ctx.accounts.config;
    c.version = Config::VERSION;
    c.bump = ctx.bumps.config;
    c.admin = admin;
    c.pending_admin = Pubkey::default();
    c.apply(&params);
    c.paused = params.paused; // the only write of `paused` outside set_paused (apply never touches it)
    c.sol_usd_updated_at = now;
    c.last_pyth_sol_usd_e6 = baseline;
    c._pad = 0;
    c.zero_ext(); // every fix-pack field off: open mode, guard off, flags 0, no ticket authority
    crate::emit_event!(ctx, ConfigUpdated { admin });
    Ok(())
}

// ---------------------------------------------------------------- update_config

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: ConfigParams)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MintdexError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: must be `params.treasury`; only its balance is read (≥ rent(0), §4.1).
    #[account(address = params.treasury @ MintdexError::InvalidConfig)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: optional; when present it must be the configured Pyth account (before this update) and its
    /// price is recorded in `last_pyth_sol_usd_e6` (§5.3: only admin instructions write it).
    #[account(
        address = config.pyth_price_account @ MintdexError::PriceFeedMismatch,
        owner = PYTH_RECEIVER_PROGRAM_ID @ MintdexError::PriceFeedMismatch,
    )]
    pub price_feed: Option<UncheckedAccount<'info>>,
}

/// Changes everything except the admin and `paused`. `sweep_flags` is set here. `params.paused` is validated but never
/// applied: pausing and unpausing go through `set_paused` (set and clear masks), so a proposal built from a Config
/// snapshot before an emergency pause cannot clear that pause when it executes (review round 2). With `tier_guard` on
/// (F6) the 17 guarded fields must stay as they are (`TierFieldsLocked`): only `update_tier_config` changes them.
pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
    let rent0 = Rent::get()?.minimum_balance(0);
    params.validate(rent0)?;
    require!(ctx.accounts.treasury.lamports() >= rent0, MintdexError::InvalidConfig);
    let now = Clock::get()?.unix_timestamp;
    let admin = ctx.accounts.admin.key();
    let c = &mut ctx.accounts.config;
    if c.tier_guard != 0 {
        require!(tier_fields_equal(c, &params), MintdexError::TierFieldsLocked);
        require!(params.guard_rules_ok(), MintdexError::InvalidConfig);
    }

    if let Some(feed) = ctx.accounts.price_feed.as_ref() {
        c.last_pyth_sol_usd_e6 =
            pyth_sol_usd_e6_from_account(&feed.to_account_info(), &c.pyth_price_account, now, record_max_age(c), c.max_conf_bps)?;
    }
    // Switching Pyth -> Admin must start within ±10% of the last Pyth price; F4: never without one.
    if c.price_source == PRICE_SOURCE_PYTH && params.price_source == PRICE_SOURCE_ADMIN {
        require!(c.last_pyth_sol_usd_e6 != 0, MintdexError::PriceBaselineMissing);
        require!(
            within_switch_band(params.sol_usd_e6, c.last_pyth_sol_usd_e6),
            MintdexError::PriceStepTooLarge
        );
    }
    let price_changed = params.sol_usd_e6 != c.sol_usd_e6 || params.price_source != c.price_source;
    c.apply(&params);
    if price_changed {
        c.sol_usd_updated_at = now;
        crate::emit_event!(ctx, PriceUpdated { sol_usd_e6: params.sol_usd_e6, by: admin });
    }
    crate::emit_event!(ctx, ConfigUpdated { admin });
    Ok(())
}

// ---------------------------------------------------------------- admin transfer

#[event_cpi]
#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MintdexError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
}

/// Step 1 of 2. `Pubkey::default()` cancels a pending proposal.
pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    crate::emit_event!(ctx, ConfigUpdated { admin: ctx.accounts.admin.key() });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin != Pubkey::default() @ MintdexError::Unauthorized,
        constraint = config.pending_admin == pending_admin.key() @ MintdexError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,
}

/// Step 2 of 2: the proposed key signs.
pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.pending_admin.key();
    c.pending_admin = Pubkey::default();
    crate::emit_event!(ctx, ConfigUpdated { admin: ctx.accounts.pending_admin.key() });
    Ok(())
}

// ---------------------------------------------------------------- set_price

#[event_cpi]
#[derive(Accounts)]
pub struct SetPrice<'info> {
    /// The admin (unbounded) or `config.price_authority` (rate- and step-limited).
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

pub fn set_price(ctx: Context<SetPrice>, sol_usd_e6: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let by = ctx.accounts.authority.key();
    let c = &mut ctx.accounts.config;
    check_set_price(c, &by, sol_usd_e6, now)?;
    c.sol_usd_e6 = sol_usd_e6;
    c.sol_usd_updated_at = now;
    crate::emit_event!(ctx, PriceUpdated { sol_usd_e6, by });
    Ok(())
}

// ---------------------------------------------------------------- tickets

/// F12: the admin, or the ticket authority when one is set.
pub fn is_ticket_signer(c: &Config, signer: &Pubkey) -> bool {
    *signer == c.admin || (c.ticket_authority != Pubkey::default() && *signer == c.ticket_authority)
}

#[event_cpi]
#[derive(Accounts)]
pub struct IssueTickets<'info> {
    /// The admin, or `config.ticket_authority` (F12). Pays the ticket rent. (Renamed from `admin`; same position.)
    #[account(mut)]
    pub authority: Signer<'info>,
    /// Writable: the ticket authority's issues are counted against `ticket_allowance` (admin B11).
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = is_ticket_signer(&config, &authority.key()) @ MintdexError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,
    pub system_program: Program<'info, System>,
}

/// Creates `Ticket` at `["vanity", mint]` for each `remaining_accounts` pair (mint [ro], ticket [w]), paid by the
/// signer. `flags` bit0 LEGACY skips the coin URI binding (only for coins created before v2; admin only). A pair whose
/// ticket already exists is skipped (idempotent re-runs); `TicketsIssued.count` counts the tickets created. The ticket
/// authority may issue at most `config.ticket_allowance` tickets in all (`TicketAllowanceExhausted`), the admin is
/// unlimited and leaves the allowance alone.
pub fn issue_tickets<'info>(ctx: Context<'_, '_, 'info, 'info, IssueTickets<'info>>, flags: u8) -> Result<()> {
    require!(flags & !TICKET_LEGACY == 0, MintdexError::InvalidConfig);
    let is_admin = ctx.accounts.authority.key() == ctx.accounts.config.admin;
    require!(flags == 0 || is_admin, MintdexError::Unauthorized);
    let rem = ctx.remaining_accounts;
    require!(
        !rem.is_empty() && rem.len() % 2 == 0 && rem.len() / 2 <= MAX_TICKETS_PER_IX,
        MintdexError::InvalidConfig
    );
    let admin = ctx.accounts.authority.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    let mut count: u16 = 0;
    for pair in rem.chunks_exact(2) {
        let (mint, ticket) = (&pair[0], &pair[1]);
        let (expected, bump) = Pubkey::find_program_address(&[TICKET_SEED, mint.key.as_ref()], &crate::ID);
        require!(*ticket.key == expected, anchor_lang::error::ErrorCode::ConstraintSeeds);
        if *ticket.owner == crate::ID {
            continue; // already issued
        }
        require!(ticket.is_writable, anchor_lang::error::ErrorCode::ConstraintMut);
        let seeds: &[&[u8]] = &[TICKET_SEED, mint.key.as_ref(), &[bump]];
        create_pda_account(&admin, ticket, &system, Ticket::LEN, &crate::ID, seeds)?;
        let mut data = ticket.try_borrow_mut_data()?;
        data[..8].copy_from_slice(Ticket::DISCRIMINATOR);
        data[8] = bump;
        data[9] = flags;
        count += 1;
    }
    if !is_admin {
        let c = &mut ctx.accounts.config;
        c.ticket_allowance = c.ticket_allowance.checked_sub(count).ok_or(MintdexError::TicketAllowanceExhausted)?;
    }
    crate::emit_event!(ctx, TicketsIssued { count, flags });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct RevokeTicket<'info> {
    /// The admin, or `config.ticket_authority` (F12). (Renamed from `admin`; same position.)
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = is_ticket_signer(&config, &authority.key()) @ MintdexError::Unauthorized,
        has_one = treasury,
    )]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the coin mint the ticket was issued for (seed only; named in `TicketRevoked`).
    pub mint: UncheckedAccount<'info>,
    #[account(mut, seeds = [TICKET_SEED, mint.key().as_ref()], bump = ticket.bump, close = treasury)]
    pub ticket: Account<'info, Ticket>,
    /// CHECK: `config.treasury` (has_one), receives the ticket rent.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}

/// For a leaked or retired vault key.
pub fn revoke_ticket(ctx: Context<RevokeTicket>) -> Result<()> {
    crate::emit_event!(ctx, TicketRevoked { mint: ctx.accounts.mint.key() });
    Ok(())
}

// ---------------------------------------------------------------- update_tier_config (F6)

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateTierConfig<'info> {
    /// MintDex's upgrade authority (on mainnet the time-locked upgrade multisig). The admin's signature is not needed.
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the MintDex program account; its `programdata_address` must be `program_data` (as in `initialize`).
    #[account(
        address = crate::ID,
        constraint = upgradeable::program_data_address_of(&this_program) == Some(program_data.key()) @ MintdexError::Unauthorized,
    )]
    pub this_program: UncheckedAccount<'info>,
    /// CHECK: MintDex's ProgramData; its upgrade authority must be `authority`.
    #[account(
        constraint = upgradeable::upgrade_authority_of(&program_data) == Some(authority.key()) @ MintdexError::Unauthorized,
    )]
    pub program_data: UncheckedAccount<'info>,
    /// CHECK: optional; `config.pyth_price_account` (before this update), Pyth-owned; its price is recorded as the
    /// baseline first (and becomes the Admin price on a Pyth → Admin switch).
    #[account(
        address = config.pyth_price_account @ MintdexError::PriceFeedMismatch,
        owner = PYTH_RECEIVER_PROGRAM_ID @ MintdexError::PriceFeedMismatch,
    )]
    pub price_feed: Option<UncheckedAccount<'info>>,
}

/// Sets the guarded fields and `tier_guard` (F6). Only path for them while the guard is on; works with it off too.
pub fn update_tier_config(ctx: Context<UpdateTierConfig>, tier: TierParams) -> Result<()> {
    let rent0 = Rent::get()?.minimum_balance(0);
    let now = Clock::get()?.unix_timestamp;
    let by = ctx.accounts.authority.key();
    let c = &mut ctx.accounts.config;
    // 1. a genuine Pyth record first (the only thing that moves the admin price anchor). The one exception: a Pyth ->
    //    Admin switch whose feed is too old by publish time is the outage this switch exists for, so the stale feed is
    //    treated as not passed and the switch falls back to the ±10% band of the recorded price (review round 2: the
    //    proposal waits out the time lock, and a still-stale feed must not revert it)
    let to_admin = c.price_source == PRICE_SOURCE_PYTH && tier.price_source == PRICE_SOURCE_ADMIN;
    let recorded = match ctx.accounts.price_feed.as_ref() {
        Some(feed) if to_admin && feed_too_old(&feed.to_account_info(), now, record_max_age(c)) => false,
        Some(feed) => {
            c.last_pyth_sol_usd_e6 =
                pyth_sol_usd_e6_from_account(&feed.to_account_info(), &c.pyth_price_account, now, record_max_age(c), c.max_conf_bps)?;
            true
        }
        None => false,
    };
    // 2. the result is validated as a whole
    let mut p = c.params()?;
    tier.overlay(&mut p);
    require!(tier.tier_guard <= 1, MintdexError::InvalidConfig);
    // 3. Pyth -> Admin: from the fresh Pyth record when a feed is passed, else within ±10% of the recorded one (F4)
    if to_admin {
        require!(c.last_pyth_sol_usd_e6 != 0, MintdexError::PriceBaselineMissing);
        if recorded {
            p.sol_usd_e6 = c.last_pyth_sol_usd_e6;
        } else {
            require!(within_switch_band(p.sol_usd_e6, c.last_pyth_sol_usd_e6), MintdexError::PriceStepTooLarge);
        }
    }
    p.validate(rent0)?;
    if tier.tier_guard == 1 {
        require!(p.guard_rules_ok(), MintdexError::InvalidConfig);
    }
    // 4. apply
    let price_changed = p.sol_usd_e6 != c.sol_usd_e6 || p.price_source != c.price_source;
    c.apply(&p);
    c.tier_guard = tier.tier_guard;
    if price_changed {
        c.sol_usd_updated_at = now;
        crate::emit_event!(ctx, PriceUpdated { sol_usd_e6: p.sol_usd_e6, by });
    }
    crate::emit_event!(ctx, TierConfigUpdated { by, tier_guard: tier.tier_guard == 1 });
    crate::emit_event!(ctx, ConfigUpdated { admin: by });
    Ok(())
}

// ---------------------------------------------------------------- set_config_ext (F8, F9, F12)

#[event_cpi]
#[derive(Accounts)]
pub struct SetConfigExt<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MintdexError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
}

/// Writes the masked ext fields (admin, instant; admin B7). remaining_accounts = `[ObserverSet PDA]` (it may not exist
/// yet) when the mask sets the ticket authority, which must not be the admin, the treasury or an observer key.
pub fn set_config_ext(ctx: Context<SetConfigExt>, ext: ConfigExtParams) -> Result<()> {
    require!(ext.is_valid(), MintdexError::InvalidConfig);
    let c = &mut ctx.accounts.config;
    if ext.mask & EXT_TICKET_AUTHORITY != 0 {
        let set_info = ctx.remaining_accounts.first().ok_or_else(|| error!(MintdexError::ObserverSetMismatch))?;
        require!(*set_info.key == OBSERVER_SET_ADDRESS, MintdexError::ObserverSetMismatch);
        let t = ext.ticket_authority;
        if t != Pubkey::default() {
            require!(t != c.admin && t != c.treasury, MintdexError::InvalidConfig);
            if !set_info.data_is_empty() {
                require!(!load_observer_set(set_info)?.contains(&t), MintdexError::InvalidConfig);
            }
        }
    }
    ext.apply(c);
    crate::emit_event!(ctx, ConfigExtUpdated {
        mask: ext.mask,
        register_flags: c.register_flags,
        outside_royalty_bps: c.outside_royalty_bps,
        ticket_authority: c.ticket_authority,
        ticket_allowance: c.ticket_allowance,
    });
    crate::emit_event!(ctx, ConfigUpdated { admin: ctx.accounts.admin.key() });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::tests::devnet_config;

    #[test]
    fn f12_ticket_signer() {
        let mut c = devnet_config();
        let t = Pubkey::new_unique();
        assert!(is_ticket_signer(&c, &c.admin.clone()));
        assert!(!is_ticket_signer(&c, &t));
        assert!(!is_ticket_signer(&c, &Pubkey::default()), "the default key is never a ticket signer");
        c.ticket_authority = t;
        assert!(is_ticket_signer(&c, &t) && is_ticket_signer(&c, &c.admin.clone()));
        assert!(!is_ticket_signer(&c, &Pubkey::new_unique()));
    }

    /// The handlers' order pins: update_config checks the guard before it records a feed or applies anything;
    /// update_tier_config records the feed before it reads params and validates after the Pyth -> Admin rule.
    #[test]
    fn guard_order_pins() {
        let src = include_str!("admin.rs");
        let uc = &src[src.find("pub fn update_config(").unwrap()..];
        let uc = &uc[..uc.find("\n}\n").unwrap()];
        assert!(uc.find("tier_fields_equal").unwrap() < uc.find("price_feed").unwrap());
        assert!(uc.find("tier_fields_equal").unwrap() < uc.find("c.apply(").unwrap());
        let ut = &src[src.find("pub fn update_tier_config(").unwrap()..];
        let ut = &ut[..ut.find("\n}\n").unwrap()];
        assert!(ut.find("pyth_sol_usd_e6_from_account").unwrap() < ut.find("c.params()").unwrap());
        // review round 2: only a Pyth -> Admin switch may skip a stale feed, and the skip comes before the full read
        assert!(ut.find("to_admin && feed_too_old(").unwrap() < ut.find("pyth_sol_usd_e6_from_account").unwrap());
        assert!(!uc.contains("c.paused"), "update_config never writes paused");
        assert!(ut.find("PriceBaselineMissing").unwrap() < ut.find("p.validate(rent0)").unwrap());
        assert!(ut.find("guard_rules_ok").unwrap() < ut.find("c.apply(").unwrap());
    }
}
