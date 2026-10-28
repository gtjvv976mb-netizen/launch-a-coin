//! `collect_fees` (§7.4) and `withdraw_fees` (§7.5). Neither is pausable: holders can always get their fees out.
//!
//! The 10 "sweep accounts" (§7) are declared field by field, unconstrained except for `mut`; `sweep()` checks every
//! §7.0 sweep row (PDAs, ATAs, constants) before it runs. market.rs's `accept_bid` and `buy_now` declare the same
//! block and build `SweepAccounts` the same way.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::{FeesCollected, FeesWithdrawn};
use crate::holder::{check_withdraw_holder, CardKeys, HolderPath};
use crate::state::{load_listing, Card, Config};
use crate::sweep::{pay_from_vault, sweep, vault_available, SweepAccounts};
use crate::utils::store_account;

// ---------------------------------------------------------------- collect_fees

#[event_cpi]
#[derive(Accounts)]
pub struct CollectFees<'info> {
    /// Pays the one-time vault top-up, if any.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// The card vault `["card", card.mint]` = pump creator: system-owned, no data.
    #[account(
        mut,
        seeds = [CARD_VAULT_SEED, card.mint.as_ref()],
        bump = card.vault_bump,
        constraint = card_vault.data_is_empty() @ MintdexError::InvalidVault,
    )]
    pub card_vault: SystemAccount<'info>,
    // ---- sweep accounts (§7.0 rows checked inside `sweep()`: PDAs, ATAs and constants)
    /// CHECK: pump `["creator-vault", card_vault]` (checked in `sweep()`).
    #[account(mut)]
    pub pump_creator_vault: UncheckedAccount<'info>,
    /// CHECK: pump event authority `Ce6TQq…` (checked in `sweep()`).
    pub pump_event_authority: UncheckedAccount<'info>,
    /// CHECK: pump program (checked in `sweep()`).
    pub pump_program: UncheckedAccount<'info>,
    /// CHECK: pAMM `["creator_vault", card_vault]` (checked in `sweep()`).
    #[account(mut)]
    pub amm_vault_authority: UncheckedAccount<'info>,
    /// CHECK: ATA(amm_vault_authority, WSOL, SPL Token); may not exist, then the AMM leg is skipped (checked in `sweep()`).
    #[account(mut)]
    pub amm_vault_ata: UncheckedAccount<'info>,
    /// CHECK: WSOL mint (checked in `sweep()`).
    pub wsol_mint: UncheckedAccount<'info>,
    /// CHECK: SPL Token program (checked in `sweep()`).
    pub spl_token_program: UncheckedAccount<'info>,
    /// CHECK: pAMM event authority `GS4CU5…` (checked in `sweep()`).
    pub amm_event_authority: UncheckedAccount<'info>,
    /// CHECK: pAMM program (checked in `sweep()`).
    pub pamm_program: UncheckedAccount<'info>,
    /// CHECK: ATA(card_vault, WSOL, SPL Token); closed by sweep leg 3 when it holds WSOL (checked in `sweep()`).
    #[account(mut)]
    pub vault_wsol_ata: UncheckedAccount<'info>,
    // ----
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Sweep only (optional: withdrawals and sales sweep by themselves). Smart-wallet holders send it as a separate
/// top-level tx first, to stay inside the CPI depth limit. Remaining accounts: extra vault-owned WSOL accounts.
pub fn collect_fees<'info>(ctx: Context<'_, '_, 'info, 'info, CollectFees<'info>>) -> Result<()> {
    let a = &ctx.accounts;
    let sa = SweepAccounts {
        payer: &a.payer,
        card_vault: &a.card_vault,
        pump_creator_vault: &a.pump_creator_vault,
        pump_event_authority: &a.pump_event_authority,
        pump_program: &a.pump_program,
        amm_vault_authority: &a.amm_vault_authority,
        amm_vault_ata: &a.amm_vault_ata,
        wsol_mint: &a.wsol_mint,
        spl_token_program: &a.spl_token_program,
        amm_event_authority: &a.amm_event_authority,
        pamm_program: &a.pamm_program,
        vault_wsol_ata: &a.vault_wsol_ata,
        associated_token_program: &a.associated_token_program,
        system_program: &a.system_program,
    };
    let mint = a.card.mint;
    let r = sweep(&sa, &mint, a.card.vault_bump, a.config.sweep_flags, ctx.remaining_accounts)?;
    let vault_available = vault_available(sa.card_vault)?;
    crate::emit_event!(ctx, FeesCollected {
        mint,
        topup: r.topup,
        from_amm: r.from_amm,
        from_wsol: r.from_wsol,
        collected: r.collected,
        vault_available,
    });
    Ok(())
}

// ---------------------------------------------------------------- withdraw_fees

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    /// The card holder, `listing.seller` while listed, or the launcher (fallback); pays the one-time top-up.
    #[account(mut)]
    pub holder: Signer<'info>,
    /// Read for `sweep_flags` (not in the §7.5 list; §7.0 row "config (all)", §18.4 note 3).
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// The card vault `["card", card.mint]` = pump creator: system-owned, no data.
    #[account(
        mut,
        seeds = [CARD_VAULT_SEED, card.mint.as_ref()],
        bump = card.vault_bump,
        constraint = card_vault.data_is_empty() @ MintdexError::InvalidVault,
    )]
    pub card_vault: SystemAccount<'info>,
    /// addr = `card.card_mint`, owner Token-2022 (closes the fake-empty-mint hole in the burned-card path).
    #[account(address = card.card_mint, owner = TOKEN_2022_PROGRAM_ID)]
    pub card_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: the token account holding the card (§7.0 row `holder_card_account`); checked in the handler.
    pub holder_card_account: UncheckedAccount<'info>,
    /// CHECK: `["listing", card.mint]`; empty (System) or a MintDex `Listing` for this mint (`load_listing`).
    /// Writable: a withdraw by the listed seller lowers `listing.min_fees_to_seller` by the amount paid (§18.9).
    #[account(mut, seeds = [LISTING_SEED, card.mint.as_ref()], bump)]
    pub listing: UncheckedAccount<'info>,
    // ---- sweep accounts (§7.0 rows checked inside `sweep()`: PDAs, ATAs and constants)
    /// CHECK: pump `["creator-vault", card_vault]` (checked in `sweep()`).
    #[account(mut)]
    pub pump_creator_vault: UncheckedAccount<'info>,
    /// CHECK: pump event authority `Ce6TQq…` (checked in `sweep()`).
    pub pump_event_authority: UncheckedAccount<'info>,
    /// CHECK: pump program (checked in `sweep()`).
    pub pump_program: UncheckedAccount<'info>,
    /// CHECK: pAMM `["creator_vault", card_vault]` (checked in `sweep()`).
    #[account(mut)]
    pub amm_vault_authority: UncheckedAccount<'info>,
    /// CHECK: ATA(amm_vault_authority, WSOL, SPL Token); may not exist, then the AMM leg is skipped (checked in `sweep()`).
    #[account(mut)]
    pub amm_vault_ata: UncheckedAccount<'info>,
    /// CHECK: WSOL mint (checked in `sweep()`).
    pub wsol_mint: UncheckedAccount<'info>,
    /// CHECK: SPL Token program (checked in `sweep()`).
    pub spl_token_program: UncheckedAccount<'info>,
    /// CHECK: pAMM event authority `GS4CU5…` (checked in `sweep()`).
    pub amm_event_authority: UncheckedAccount<'info>,
    /// CHECK: pAMM program (checked in `sweep()`).
    pub pamm_program: UncheckedAccount<'info>,
    /// CHECK: ATA(card_vault, WSOL, SPL Token); closed by sweep leg 3 when it holds WSOL (checked in `sweep()`).
    #[account(mut)]
    pub vault_wsol_ata: UncheckedAccount<'info>,
    // ----
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Sweeps, then pays everything above rent(0) in the vault to the holder. Remaining accounts: extra vault-owned
/// WSOL accounts.
pub fn withdraw_fees<'info>(ctx: Context<'_, '_, 'info, 'info, WithdrawFees<'info>>) -> Result<()> {
    let a = &ctx.accounts;
    let mint = a.card.mint;
    let holder_key = a.holder.key();

    // 1. Holder check (§7.0 row holder_card_account).
    let listing_info = a.listing.to_account_info();
    let listing = load_listing(&listing_info, &mint)?;
    let path = {
        let keys = CardKeys {
            card: &a.card.key(),
            card_vault: &a.card_vault.key(),
            card_mint: &a.card.card_mint,
            config: &a.config.key(),
            listing: &a.listing.key(),
            launcher: &a.card.launcher,
        };
        let supply = a.card_mint.supply;
        let ta = a.holder_card_account.to_account_info();
        if supply == 0 {
            check_withdraw_holder(&holder_key, &keys, 0, ta.key, ta.owner, &[], listing.as_ref())?
        } else {
            let data = ta.try_borrow_data()?;
            check_withdraw_holder(&holder_key, &keys, supply, ta.key, ta.owner, &data, listing.as_ref())?
        }
    };

    // 2. Sweep (the holder pays the one-time vault top-up, if any).
    let sa = SweepAccounts {
        payer: &a.holder,
        card_vault: &a.card_vault,
        pump_creator_vault: &a.pump_creator_vault,
        pump_event_authority: &a.pump_event_authority,
        pump_program: &a.pump_program,
        amm_vault_authority: &a.amm_vault_authority,
        amm_vault_ata: &a.amm_vault_ata,
        wsol_mint: &a.wsol_mint,
        spl_token_program: &a.spl_token_program,
        amm_event_authority: &a.amm_event_authority,
        pamm_program: &a.pamm_program,
        vault_wsol_ata: &a.vault_wsol_ata,
        associated_token_program: &a.associated_token_program,
        system_program: &a.system_program,
    };
    let vault_bump = a.card.vault_bump;
    sweep(&sa, &mint, vault_bump, a.config.sweep_flags, ctx.remaining_accounts)?;

    // 3. Everything above rent(0).
    let amount = vault_available(sa.card_vault)?;
    require!(amount > 0, MintdexError::NothingToWithdraw);
    // 4. Clear error instead of the runtime's rent failure (G2); always holds for a fee-paying signer.
    let rent0 = Rent::get()?.minimum_balance(0);
    require!(
        sa.payer.lamports().saturating_add(amount) >= rent0,
        MintdexError::PayoutBelowRent
    );
    // 5. Vault-signed system transfer (G1).
    pay_from_vault(sa.card_vault, sa.payer, sa.system_program, &mint, vault_bump, amount)?;
    // The listed seller took these fees itself, so a buyer no longer owes them under the listing's floor (§18.9).
    if let (HolderPath::ListedSeller, Some(mut l)) = (path, listing) {
        if l.min_fees_to_seller > 0 {
            l.lower_fee_floor(amount);
            store_account(&listing_info, &l)?;
        }
    }

    // 6.
    let card = &mut ctx.accounts.card;
    card.fees_paid_out = card.fees_paid_out.checked_add(amount).ok_or(MintdexError::MathOverflow)?;
    let lifetime_paid_out = card.fees_paid_out;
    crate::emit_event!(ctx, FeesWithdrawn { mint, holder: holder_key, amount, lifetime_paid_out });
    Ok(())
}
