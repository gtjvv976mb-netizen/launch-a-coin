//! The permissionless fee sweep (card-program-v2 §7.4) and the vault payout (§7.5, §8).
//!
//! Legs run in the order 0, 3, 2, 1 so the vault is rent-exempt before anything lands in it:
//! 0. lazy prefund: the instruction's signer tops the card vault up to rent(0) (once per card);
//! 3. close every vault-owned WSOL token account into the vault (vault seeds sign `CloseAccount`, dest = vault);
//! 2. pAMM `transfer_creator_fees_to_pump` when the AMM creator-vault ATA exists with a balance;
//! 1. pump `collect_creator_fee` when pump's creator vault holds more than rent(0).
//! A leg is skipped (never fails the instruction) when its accounts say there is nothing to do, or when the admin
//! switched it off in `sweep_flags`.
//!
//! Callers (withdraw_fees, collect_fees, and market.rs's accept_bid / buy_now) declare the 10 sweep accounts as
//! unconstrained `UncheckedAccount`s (only `mut` where the sweep writes), in the order of `WithdrawFees`. `sweep()`
//! checks every §7.0 sweep row itself before it touches anything: the pump creator vault and the pAMM creator-vault
//! authority PDAs of the card vault, both WSOL ATAs, and the constant programs, event authorities and WSOL mint.
//! One shared check instead of four copies of the Anchor constraints keeps the .so small (card-program-v2 §18.3).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::system_program;
use anchor_spl::token::spl_token;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::pump;
use crate::utils::pay;

/// The accounts the sweep touches, borrowed from the instruction's accounts (no clones until a CPI needs one).
pub struct SweepAccounts<'a, 'info> {
    /// Signer that pays the one-time vault top-up.
    pub payer: &'a AccountInfo<'info>,
    /// `["card", mint]`, system-owned, no data.
    pub card_vault: &'a AccountInfo<'info>,
    pub pump_creator_vault: &'a AccountInfo<'info>,
    pub pump_event_authority: &'a AccountInfo<'info>,
    pub pump_program: &'a AccountInfo<'info>,
    pub amm_vault_authority: &'a AccountInfo<'info>,
    pub amm_vault_ata: &'a AccountInfo<'info>,
    pub wsol_mint: &'a AccountInfo<'info>,
    pub spl_token_program: &'a AccountInfo<'info>,
    pub amm_event_authority: &'a AccountInfo<'info>,
    pub pamm_program: &'a AccountInfo<'info>,
    pub vault_wsol_ata: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SweepResult {
    /// Lamports the payer added to bring the vault to rent(0).
    pub topup: u64,
    /// Lamports pAMM moved into pump's creator vault (0 when skipped; measured, not the ATA amount).
    pub from_amm: u64,
    /// Lamports recovered by closing vault-owned WSOL accounts.
    pub from_wsol: u64,
    /// Total that landed in the vault after the top-up (WSOL leg + curve leg).
    pub collected: u64,
}

/// Seeds of the card vault for `invoke_signed`.
#[macro_export]
macro_rules! vault_seeds {
    ($mint:expr, $bump:expr) => {
        &[$crate::constants::CARD_VAULT_SEED, $mint.as_ref(), &[$bump]]
    };
}

/// A WSOL token account the vault may close (leg 3): SPL Token owned, 165 bytes, initialized, mint WSOL, token
/// owner = vault, native, no close authority, and passed writable. Anything else is skipped.
pub fn closable_vault_wsol(acc: &AccountInfo, card_vault: &Pubkey) -> bool {
    if *acc.owner != SPL_TOKEN_PROGRAM_ID || acc.data_len() != spl_token::state::Account::LEN || !acc.is_writable {
        return false;
    }
    let Ok(data) = acc.try_borrow_data() else { return false };
    match spl_token::state::Account::unpack(&data) {
        Ok(t) => {
            t.mint == WSOL_MINT
                && t.owner == *card_vault
                && t.is_native.is_some()
                && t.close_authority.is_none()
                && t.state == spl_token::state::AccountState::Initialized
        }
        Err(_) => false,
    }
}

/// Runs the sweep. `extra_wsol` are additional vault-owned WSOL accounts (the instruction's remaining accounts).
pub fn sweep<'info>(
    a: &SweepAccounts<'_, 'info>,
    mint: &Pubkey,
    vault_bump: u8,
    sweep_flags: u8,
    extra_wsol: &[AccountInfo<'info>],
) -> Result<SweepResult> {
    // §7.0 sweep rows: the PDA-derived accounts and the constants (the callers do not constrain them)
    let vault_key = *a.card_vault.key;
    let amm_vault_authority = pump::amm_vault_authority_pda(&vault_key);
    let constants_ok = *a.pump_creator_vault.key == pump::pump_creator_vault_pda(&vault_key)
        && *a.amm_vault_authority.key == amm_vault_authority
        && *a.amm_vault_ata.key == pump::wsol_ata(&amm_vault_authority)
        && *a.vault_wsol_ata.key == pump::wsol_ata(&vault_key)
        && *a.pump_program.key == PUMP_PROGRAM_ID
        && *a.pump_event_authority.key == PUMP_EVENT_AUTHORITY
        && *a.pamm_program.key == PAMM_PROGRAM_ID
        && *a.amm_event_authority.key == PAMM_EVENT_AUTHORITY
        && *a.wsol_mint.key == WSOL_MINT
        && *a.spl_token_program.key == SPL_TOKEN_PROGRAM_ID
        && *a.associated_token_program.key == ASSOCIATED_TOKEN_PROGRAM_ID
        && *a.system_program.key == SYSTEM_PROGRAM_ID;
    require!(constants_ok, anchor_lang::error::ErrorCode::ConstraintAddress);
    require!(
        *a.card_vault.owner == SYSTEM_PROGRAM_ID && a.card_vault.data_is_empty(),
        MintdexError::InvalidVault
    );

    let rent0 = Rent::get()?.minimum_balance(0);
    let mut r = SweepResult::default();

    // 0. Lazy prefund (rev 1): pump's collect can never silently no-op and the vault can always pay out.
    r.topup = rent0.saturating_sub(a.card_vault.lamports());
    if r.topup > 0 {
        pay(a.system_program, a.payer, a.card_vault, r.topup)?;
    }
    let before = a.card_vault.lamports();

    // 3. Vault-owned WSOL accounts (G12 griefing path, pump admin_cto payouts).
    if sweep_flags & SWEEP_VAULT_WSOL != 0 {
        let seeds: &[&[u8]] = vault_seeds!(mint, vault_bump);
        for acc in core::iter::once(a.vault_wsol_ata).chain(extra_wsol.iter()) {
            if !closable_vault_wsol(acc, &vault_key) {
                continue;
            }
            r.from_wsol = r
                .from_wsol
                .checked_add(acc.lamports())
                .ok_or(MintdexError::MathOverflow)?;
            anchor_spl::token::close_account(CpiContext::new_with_signer(
                a.spl_token_program.clone(),
                anchor_spl::token::CloseAccount {
                    account: acc.clone(),
                    destination: a.card_vault.clone(),
                    authority: a.card_vault.clone(),
                },
                &[seeds],
            ))?;
        }
    }

    // 2. AMM leg (G1, G3: skip when the ATA does not exist, G4).
    if sweep_flags & SWEEP_AMM != 0 && *a.amm_vault_ata.owner == SPL_TOKEN_PROGRAM_ID {
        let amount = {
            let data = a.amm_vault_ata.try_borrow_data()?;
            if data.len() >= spl_token::state::Account::LEN {
                pump::token_amount(&data).unwrap_or(0)
            } else {
                0
            }
        };
        if amount > 0 {
            let pump_vault_before = a.pump_creator_vault.lamports();
            let ix = pump::transfer_creator_fees_to_pump_ix(
                &vault_key,
                a.amm_vault_authority.key,
                a.amm_vault_ata.key,
                a.pump_creator_vault.key,
            );
            invoke(
                &ix,
                &[
                    a.wsol_mint.clone(),
                    a.spl_token_program.clone(),
                    a.system_program.clone(),
                    a.associated_token_program.clone(),
                    a.card_vault.clone(),
                    a.amm_vault_authority.clone(),
                    a.amm_vault_ata.clone(),
                    a.pump_creator_vault.clone(),
                    a.amm_event_authority.clone(),
                    a.pamm_program.clone(),
                ],
            )?;
            r.from_amm = a.pump_creator_vault.lamports().saturating_sub(pump_vault_before);
        }
    }

    // 1. Curve leg (G1). Skipped when pump's creator vault holds only its rent (saves ~6k CU).
    if sweep_flags & SWEEP_CURVE != 0 && a.pump_creator_vault.lamports() > rent0 {
        let ix = pump::collect_creator_fee_ix(&vault_key, a.pump_creator_vault.key);
        invoke(
            &ix,
            &[
                a.card_vault.clone(),
                a.pump_creator_vault.clone(),
                a.system_program.clone(),
                a.pump_event_authority.clone(),
                a.pump_program.clone(),
            ],
        )?;
    }

    r.collected = a.card_vault.lamports().saturating_sub(before);
    Ok(r)
}

/// Lamports the vault can pay out right now: everything above rent(0).
pub fn vault_available(card_vault: &AccountInfo) -> Result<u64> {
    let rent0 = Rent::get()?.minimum_balance(0);
    Ok(card_vault.lamports().saturating_sub(rent0))
}

/// System transfer out of the card vault, signed with the vault seeds (the only vault-signed transfer, §3 rule).
pub fn pay_from_vault<'info>(
    card_vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    mint: &Pubkey,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = vault_seeds!(mint, vault_bump);
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.clone(),
            system_program::Transfer { from: card_vault.clone(), to: to.clone() },
            &[seeds],
        ),
        amount,
    )
}

/// Pays everything above rent(0) from the vault to `to` and returns the amount (0 = nothing paid). For sales
/// (§7.7 / §7.9 step 2): the seller's payout always includes the price, so it cannot end below rent.
pub fn pay_vault_available<'info>(
    card_vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    mint: &Pubkey,
    vault_bump: u8,
) -> Result<u64> {
    let amount = vault_available(card_vault)?;
    pay_from_vault(card_vault, to, system_program, mint, vault_bump, amount)?;
    Ok(amount)
}
