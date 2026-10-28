//! The card market (card-program-v2 §7.6 to §7.9): escrowed SOL bids and custodial listings.
//!
//! - Bids: `place_bid` creates, raises or lowers a bid; the escrow is the `Bid` account's lamports above its rent and
//!   always equals `bid.amount`. `cancel_bid` returns escrow and rent (never pausable).
//! - Listings (rev 1: custodial): `list_card` moves the card into the escrow ATA(listing, card_mint, Token-2022) owned
//!   by the `["listing", mint]` PDA, so a listing exists exactly while the escrow holds the card. `delist_card`,
//!   `close_expired_listing` (never pausable), `buy_now` and `accept_bid` move it out, then close the escrow and the
//!   listing to the seller. The listing PDA signs only escrow transfers and the escrow close (§7.0 CPI rule).
//! - Sales (`accept_bid`, `buy_now`): the program sweeps the card's fees and pays the vault's available balance to the
//!   seller before the card moves (§8), then splits the price: `protocol_fee_bps` to the treasury, `creator_royalty_bps`
//!   to the launcher (0 when the launcher sells), the rest to the seller. `max_total_fee_bps` stops an admin fee change
//!   from front-running a sale; `min_amount` / `expected_price` stop a bid or listing change in flight.
//! - The seller's fee floor (card-program-v2 §18.9, audit A1): `accept_bid(.., min_fees_to_seller)` and the listing's
//!   `min_fees_to_seller` (set by `list_card`, lowered by the seller's own withdrawals while listed) make a sale fail
//!   with `FeesBelowFloor` when it would pay the seller less, e.g. because the counterparty moved the AMM creator fees
//!   into a vault-owned WSOL account and left it out of `remaining_accounts`.
//! - `close_expired_listing` refunds the permissionless caller the rent of a re-created seller card ATA out of the
//!   escrow and listing refunds (card-program-v2 §18.9, audit A2).
//! - Token-2022 account extensions that would make the card transfer fail (an enabled MemoTransfer on the receiving
//!   account, an enabled CpiGuard on an owner-signed source, anything unknown) are rejected up front with
//!   `UnsupportedTokenAccount`, because a failing CPI cannot be caught.
//! - `paused & MARKET` blocks place_bid, list_card (new and re-price), accept_bid and buy_now.
//!
//! `AcceptBid` and `BuyNow` carry the 10 sweep accounts as `instructions::fees::WithdrawFees` declares them (checked
//! inside `sweep()`).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token_2022::spl_token_2022::extension::{
    cpi_guard::CpiGuard, memo_transfer::memo_required, BaseStateWithExtensions, ExtensionType, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::{Account as T22Account, AccountState};
use anchor_spl::token_interface::{self, CloseAccount, Token2022, TransferChecked};

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::{BidCancelled, BidPlaced, CardDelisted, CardListed, CardSold, ListingClosed};
use crate::evolve::Window;
use crate::holder::card_ata;
use crate::math::{effective_fee_bps, sale_splits};
use crate::state::{load_listing, Bid, Card, Config, Listing};
use crate::sweep::{pay_vault_available, sweep, SweepAccounts};
use crate::utils::{close_account, create_pda_account, move_lamports, pay, store_account};

// ---------------------------------------------------------------- pure rules (unit-tested, U7)

/// A sale's split (§7.7 step 4): `(protocol_fee, royalty, seller_net)`, after the `max_total_fee_bps` guard
/// (`FeesChanged`). `protocol + royalty + seller_net == price` always.
pub fn price_sale(
    price: u64,
    protocol_fee_bps: u16,
    royalty_bps: u16,
    seller_is_launcher: bool,
    max_total_fee_bps: u16,
) -> Result<(u64, u64, u64)> {
    require!(
        effective_fee_bps(protocol_fee_bps, royalty_bps, seller_is_launcher) <= max_total_fee_bps as u32,
        MintdexError::FeesChanged
    );
    sale_splits(price, protocol_fee_bps, royalty_bps, seller_is_launcher)
}

/// `buy_now` step 1 listing rules: the expected price, not expired (`expires_at == 0 || now <= expires_at`), and for
/// VOID_ON_EVOLVE listings (`ListingVoided`, fix-plan §2.4): the level is still `level_at_list`, the card is not
/// unlocking above it (no pending level above it, and no unlapsed F2 mark above it: a dip cannot erase an unlock in
/// progress), and EVOLVE is not paused (admin B4: while observations are paused nothing could arm the mark).
pub fn check_buyable(l: &Listing, expected_price: u64, now: i64, slot: u64, w: &Window, paused: u8) -> Result<()> {
    require!(l.price == expected_price, MintdexError::PriceChanged);
    require!(l.expires_at == 0 || now <= l.expires_at, MintdexError::ListingExpired);
    if l.flags & LISTING_VOID_ON_EVOLVE != 0 {
        require!(
            w.level == l.level_at_list && !w.unlocking_above(l.level_at_list, slot) && paused & PAUSE_EVOLVE == 0,
            MintdexError::ListingVoided
        );
    }
    Ok(())
}

/// The seller's fee floor (card-program-v2 §18.9, audit A1): a sale must pay the seller at least the floor the seller
/// signed (`accept_bid`'s `min_fees_to_seller`, raised to the listing's floor on the escrow path) or stored in its
/// listing (`buy_now`). The program cannot list every WSOL account the card vault owns, so `remaining_accounts` can
/// never prove that no accrued fee was moved out of the sweep's sight (pAMM `collect_coin_creator_fee` into a fresh
/// non-ATA vault-owned WSOL account, then left out of the sale). With the floor such a sale fails instead of paying
/// the seller less, and the counterparty has to pass the hidden account, whose lamports then go to the seller.
/// `FeesBelowFloor` otherwise.
pub fn check_fee_floor(fees_to_seller: u64, floor: u64) -> Result<()> {
    require!(fees_to_seller >= floor, MintdexError::FeesBelowFloor);
    Ok(())
}

/// What the permissionless caller of `close_expired_listing` gets back after it re-created the seller's card ATA
/// (card-program-v2 §18.9, audit A2): the rent it paid, out of the escrow and listing refunds. Those belong to the
/// same seller and always cover it (the escrow has the same 170-byte Token-2022 ATA layout as the re-created
/// account); the cap only guarantees the never-pausable instruction cannot fail on it.
pub fn expired_close_refund(ata_rent_paid: u64, listing_lamports: u64) -> u64 {
    ata_rent_paid.min(listing_lamports)
}

/// `list_card` argument rules: `price ≥ min_bid` (`BidTooLow`), `expires_at == 0 || expires_at > now`
/// (`ListingExpired`), and only known flag bits (`ListingInvalid`).
pub fn check_list_args(price: u64, expires_at: i64, flags: u8, min_bid: u64, now: i64) -> Result<()> {
    require!(price >= min_bid, MintdexError::BidTooLow);
    require!(expires_at == 0 || expires_at > now, MintdexError::ListingExpired);
    require!(flags & !LISTING_VOID_ON_EVOLVE == 0, MintdexError::ListingInvalid);
    Ok(())
}

/// The account receives the card: an enabled MemoTransfer would fail `transfer_checked`.
pub const RECEIVES: u8 = 1;
/// The account's owner signs a transfer out through MintDex's CPI: an enabled CpiGuard would fail it.
pub const OWNER_SENDS: u8 = 2;

/// Reads a card token account for a market transfer and returns its amount. It must be owned by Token-2022, a valid
/// account of `card_mint` whose token owner is `owner` (`NotHolder` otherwise), not frozen (`CardFrozen`, F10: a
/// frozen token cannot move, so the transfer would fail anyway) and initialized (`NotHolder`). Extensions:
/// ImmutableOwner (every ATA) is fine; MemoTransfer and CpiGuard are fine while disabled, or when `role` says the
/// direction cannot trip them; any other extension fails closed. Extension failures are `UnsupportedTokenAccount`
/// (§7.7, R25).
pub fn check_card_account(owner_program: &Pubkey, data: &[u8], owner: &Pubkey, card_mint: &Pubkey, role: u8) -> Result<u64> {
    require!(*owner_program == TOKEN_2022_PROGRAM_ID, MintdexError::NotHolder);
    let s = StateWithExtensions::<T22Account>::unpack(data).map_err(|_| error!(MintdexError::NotHolder))?;
    require!(s.base.mint == *card_mint && s.base.owner == *owner, MintdexError::NotHolder);
    require!(s.base.state != AccountState::Frozen, MintdexError::CardFrozen);
    require!(s.base.state == AccountState::Initialized, MintdexError::NotHolder);
    let types = s.get_extension_types().map_err(|_| error!(MintdexError::UnsupportedTokenAccount))?;
    for t in types {
        let ok = match t {
            ExtensionType::ImmutableOwner => true,
            ExtensionType::MemoTransfer => role & RECEIVES == 0 || !memo_required(&s),
            ExtensionType::CpiGuard => {
                role & OWNER_SENDS == 0 || s.get_extension::<CpiGuard>().map(|g| !bool::from(g.lock_cpi)).unwrap_or(false)
            }
            _ => false,
        };
        require!(ok, MintdexError::UnsupportedTokenAccount);
    }
    Ok(s.base.amount)
}

// ---------------------------------------------------------------- CPI helpers

/// `check_card_account` on a live account.
fn card_amount(info: &AccountInfo, owner: &Pubkey, card_mint: &Pubkey, role: u8) -> Result<u64> {
    let data = info.try_borrow_data()?;
    check_card_account(info.owner, &data, owner, card_mint, role)
}

/// The §7.0 `addr =` rows a market instruction checks in code instead of with Anchor `address =` constraints (§7.0
/// allows either): every `(actual, expected)` pair must match, else `ConstraintAddress`. One shared error site keeps
/// the .so small; the handlers call it before they touch any account.
fn check_addresses(pairs: &[(&Pubkey, Pubkey)]) -> Result<()> {
    for (actual, expected) in pairs {
        if **actual != *expected {
            return Err(error!(anchor_lang::error::ErrorCode::ConstraintAddress).with_pubkeys((**actual, *expected)));
        }
    }
    Ok(())
}

/// The Token-2022 / ATA / System programs of a market instruction.
struct Programs<'a, 'info> {
    token_2022: &'a AccountInfo<'info>,
    ata: &'a AccountInfo<'info>,
    system: &'a AccountInfo<'info>,
}

/// `init_if_needed` for ATA(owner, card_mint, Token-2022) (the caller checked the address with `check_addresses`):
/// created through the ATA program when missing, paid by `payer`; then checked as a receiving card account.
fn ensure_receiving_ata<'info>(
    p: &Programs<'_, 'info>,
    payer: &AccountInfo<'info>,
    ata: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    card_mint: &AccountInfo<'info>,
) -> Result<()> {
    if ata.data_is_empty() {
        associated_token::create_idempotent(CpiContext::new(
            p.ata.clone(),
            associated_token::Create {
                payer: payer.clone(),
                associated_token: ata.clone(),
                authority: owner.clone(),
                mint: card_mint.clone(),
                system_program: p.system.clone(),
                token_program: p.token_2022.clone(),
            },
        ))?;
    }
    card_amount(ata, owner.key, card_mint.key, RECEIVES)?;
    Ok(())
}

/// Moves the 1 card token (`transfer_checked`, decimals 0). `signer` is empty when the owner signed the transaction.
fn transfer_card<'info>(
    p: &Programs<'_, 'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    card_mint: &AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            p.token_2022.clone(),
            TransferChecked { from: from.clone(), mint: card_mint.clone(), to: to.clone(), authority: authority.clone() },
            signer,
        ),
        1,
        0,
    )
}

/// Releases a listed card into `receiver_ata` (the caller ran `ensure_receiving_ata` on it first): transfers
/// escrow → receiver and closes the escrow to `rent_to`, both signed by the listing PDA `["listing", mint, bump]`.
/// The listing account itself is closed by the caller.
#[allow(clippy::too_many_arguments)]
fn release_escrow<'info>(
    p: &Programs<'_, 'info>,
    receiver_ata: &AccountInfo<'info>,
    escrow: &AccountInfo<'info>,
    listing: &AccountInfo<'info>,
    card_mint: &AccountInfo<'info>,
    rent_to: &AccountInfo<'info>,
    mint: &Pubkey,
    listing_bump: u8,
) -> Result<()> {
    let seeds: &[&[u8]] = &[LISTING_SEED, mint.as_ref(), &[listing_bump]];
    transfer_card(p, escrow, receiver_ata, listing, card_mint, &[seeds])?;
    token_interface::close_account(CpiContext::new_with_signer(
        p.token_2022.clone(),
        CloseAccount { account: escrow.clone(), destination: rent_to.clone(), authority: listing.clone() },
        &[seeds],
    ))
}

/// §8 / §7.7 and §7.9 step 2: pays the vault's available balance to the seller and returns it, after the seller's
/// fee floor (`check_fee_floor`). Runs right after the sweep.
fn settle_fees_to_seller<'info>(sa: &SweepAccounts<'_, 'info>, seller: &AccountInfo<'info>, mint: &Pubkey, vault_bump: u8, floor: u64) -> Result<u64> {
    let fees_to_seller = pay_vault_available(sa.card_vault, seller, sa.system_program, mint, vault_bump)?;
    check_fee_floor(fees_to_seller, floor)?;
    Ok(fees_to_seller)
}

/// Records a settled sale on the card.
fn record_sale(card: &mut Card, price: u64, fees_to_seller: u64) -> Result<()> {
    card.fees_paid_out = card.fees_paid_out.checked_add(fees_to_seller).ok_or(MintdexError::MathOverflow)?;
    card.sales = card.sales.checked_add(1).ok_or(MintdexError::MathOverflow)?;
    card.last_sale_price = price;
    Ok(())
}

// ---------------------------------------------------------------- place_bid / cancel_bid (§7.6)

#[event_cpi]
#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// CHECK: `["bid", card.mint, bidder]`: created here, or this bidder's `Bid` (owner, discriminator, bidder and mint
    /// checked in the handler).
    #[account(mut, seeds = [BID_SEED, card.mint.as_ref(), bidder.key().as_ref()], bump)]
    pub bid: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Creates a bid, or moves an existing bid to `amount` (raise: the bidder tops the escrow up; lower: the difference
/// goes back). `amount ≥ config.min_bid`.
pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.is_paused(PAUSE_MARKET), MintdexError::Paused);
    require!(amount >= a.config.min_bid, MintdexError::BidTooLow);
    let mint = a.card.mint;
    let bidder: &AccountInfo = &a.bidder;
    let bid_info = a.bid.to_account_info();
    let system: &AccountInfo = &a.system_program;
    let now = Clock::get()?.unix_timestamp;

    let mut bid = if bid_info.data_is_empty() {
        let bump = ctx.bumps.bid;
        create_pda_account(
            bidder,
            &bid_info,
            system,
            Bid::LEN,
            &crate::ID,
            &[BID_SEED, mint.as_ref(), bidder.key.as_ref(), &[bump]],
        )?;
        Bid { version: Bid::VERSION, bump, mint, bidder: *bidder.key, amount: 0, created_at: now, updated_at: now }
    } else {
        require_keys_eq!(*bid_info.owner, crate::ID, anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram);
        let b = Bid::try_deserialize(&mut &bid_info.try_borrow_data()?[..])?;
        require!(b.bidder == *bidder.key && b.mint == mint, MintdexError::BidChanged);
        b
    };

    let previous = bid.amount;
    if amount > previous {
        pay(system, bidder, &bid_info, amount - previous)?;
    } else {
        move_lamports(&bid_info, bidder, previous - amount)?;
    }
    bid.amount = amount;
    bid.updated_at = now;
    store_account(&bid_info, &bid)?;
    crate::emit_event!(ctx, BidPlaced { mint, bidder: bid.bidder, previous, amount });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct CancelBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    /// Escrow and rent go back to the bidder.
    #[account(
        mut,
        seeds = [BID_SEED, bid.mint.as_ref(), bidder.key().as_ref()],
        bump = bid.bump,
        has_one = bidder,
        close = bidder,
    )]
    pub bid: Box<Account<'info, Bid>>,
}

/// Closes the bid (escrow + rent to the bidder). Never pausable.
pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
    let bid = &ctx.accounts.bid;
    crate::emit_event!(ctx, BidCancelled { mint: bid.mint, bidder: bid.bidder, amount: bid.amount });
    Ok(())
}

// ---------------------------------------------------------------- accept_bid (§7.7)

#[event_cpi]
#[derive(Accounts)]
pub struct AcceptBid<'info> {
    /// The card holder (or `listing.seller` while listed); pays the bidder's ATA and the one-time vault top-up.
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: addr = `config.treasury` (protocol fee; checked in the handler).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// CHECK: the card vault `["card", card.mint]` = pump creator; system-owned without data (checked in `sweep()`).
    #[account(mut, seeds = [CARD_VAULT_SEED, card.mint.as_ref()], bump = card.vault_bump)]
    pub card_vault: UncheckedAccount<'info>,
    /// CHECK: the card NFT mint: addr = `card.card_mint`, owner Token-2022 (checked in the handler).
    pub card_mint: UncheckedAccount<'info>,
    /// CHECK: addr = `card.launcher` (royalty; checked in the handler).
    #[account(mut)]
    pub launcher: UncheckedAccount<'info>,
    /// CHECK: addr = `bid.bidder`: receives the card and the bid rent (checked in the handler).
    #[account(mut)]
    pub bidder: UncheckedAccount<'info>,
    #[account(mut, seeds = [BID_SEED, card.mint.as_ref(), bidder.key().as_ref()], bump = bid.bump, close = bidder)]
    pub bid: Box<Account<'info, Bid>>,
    /// CHECK: addr = ATA(seller, card_mint): holds the card unless it is listed (checked in the handler).
    #[account(mut)]
    pub seller_card_account: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(bidder, card_mint), created when missing; the seller pays (checked in the handler).
    #[account(mut)]
    pub bidder_card_account: UncheckedAccount<'info>,
    /// CHECK: `["listing", card.mint]`: empty (System) or this card's `Listing` (`load_listing`).
    #[account(mut, seeds = [LISTING_SEED, card.mint.as_ref()], bump)]
    pub listing: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(listing, card_mint): holds the card while it is listed (checked in the handler).
    #[account(mut)]
    pub listing_escrow: UncheckedAccount<'info>,
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
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// The holder sells the card to a bidder. Remaining accounts: extra vault-owned WSOL accounts. `min_fees_to_seller`
/// is the seller's fee floor (§18.9): the client sets it to the §8 withdrawable total it showed the seller, computed
/// over every vault-owned WSOL account, so a bidder that hides AMM fees right before the accept makes it fail
/// (`FeesBelowFloor`) instead of keeping them. On the escrow path the listing's own floor applies too.
pub fn accept_bid<'info>(
    ctx: Context<'_, '_, 'info, 'info, AcceptBid<'info>>,
    min_amount: u64,
    max_total_fee_bps: u16,
    min_fees_to_seller: u64,
) -> Result<()> {
    let a = &ctx.accounts;
    let cfg = &a.config;
    require!(!cfg.is_paused(PAUSE_MARKET), MintdexError::Paused);
    let mint = a.card.mint;
    let card_mint_key = a.card.card_mint;
    let seller_key = a.seller.key();
    let bidder_key = a.bidder.key();
    check_addresses(&[
        (a.treasury.key, cfg.treasury),
        (a.launcher.key, a.card.launcher),
        (a.bidder.key, a.bid.bidder),
        (a.card_mint.key, card_mint_key),
        (a.card_mint.owner, TOKEN_2022_PROGRAM_ID),
        (a.seller_card_account.key, card_ata(&seller_key, &card_mint_key)),
        (a.bidder_card_account.key, card_ata(&bidder_key, &card_mint_key)),
        (a.listing_escrow.key, card_ata(a.listing.key, &card_mint_key)),
    ])?;
    let price = a.bid.amount;
    require!(a.bid.mint == mint && price >= min_amount, MintdexError::BidChanged);
    require_keys_neq!(bidder_key, seller_key, MintdexError::SelfTrade);
    let (protocol_fee, royalty, seller_net) = price_sale(
        price,
        cfg.protocol_fee_bps,
        cfg.creator_royalty_bps,
        seller_key == a.card.launcher,
        max_total_fee_bps,
    )?;

    // 1. The seller holds 1: in the listing escrow of their own listing, or in their ATA.
    let listing = load_listing(&a.listing, &mint)?;
    let (listing_bump, fee_floor) = match &listing {
        Some(l) => {
            require_keys_eq!(l.seller, seller_key, MintdexError::NotHolder);
            require!(card_amount(&a.listing_escrow, &a.listing.key(), &card_mint_key, 0)? == 1, MintdexError::NotHolder);
            (Some(l.bump), min_fees_to_seller.max(l.min_fees_to_seller))
        }
        None => {
            require!(
                card_amount(&a.seller_card_account, &seller_key, &card_mint_key, OWNER_SENDS)? == 1,
                MintdexError::NotHolder
            );
            (None, min_fees_to_seller)
        }
    };

    let p = Programs { token_2022: &a.token_2022_program, ata: &a.associated_token_program, system: &a.system_program };
    let seller: &AccountInfo = &a.seller;
    let card_mint: &AccountInfo = &a.card_mint;

    // 2. Sweep, then the vault's available balance goes to the seller (§8), at least the seller's floor (§18.9).
    let sa = SweepAccounts {
        payer: seller,
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
        associated_token_program: p.ata,
        system_program: p.system,
    };
    let vault_bump = a.card.vault_bump;
    sweep(&sa, &mint, vault_bump, cfg.sweep_flags, ctx.remaining_accounts)?;
    let fees_to_seller = settle_fees_to_seller(&sa, seller, &mint, vault_bump, fee_floor)?;

    // 3. The card moves to the bidder (the seller pays the bidder's ATA if it is missing).
    let bidder: &AccountInfo = &a.bidder;
    let bidder_ata: &AccountInfo = &a.bidder_card_account;
    ensure_receiving_ata(&p, seller, bidder_ata, bidder, card_mint)?;
    if let Some(bump) = listing_bump {
        let listing_info: &AccountInfo = &a.listing;
        release_escrow(&p, bidder_ata, &a.listing_escrow, listing_info, card_mint, seller, &mint, bump)?;
        close_account(listing_info, seller)?;
        crate::emit_event!(ctx, ListingClosed { mint, seller: seller_key, reason: LISTING_CLOSED_SOLD_VIA_BID });
    } else {
        transfer_card(&p, &a.seller_card_account, bidder_ata, seller, card_mint, &[])?;
    }

    // 4. Split the bid escrow. 5. The bid closes to the bidder (Anchor `close`).
    let bid_info = a.bid.to_account_info();
    move_lamports(&bid_info, &a.treasury, protocol_fee)?;
    move_lamports(&bid_info, &a.launcher, royalty)?;
    move_lamports(&bid_info, seller, seller_net)?;

    record_sale(&mut ctx.accounts.card, price, fees_to_seller)?;
    // 6.
    crate::emit_event!(ctx, CardSold {
        mint,
        seller: seller_key,
        buyer: bidder_key,
        price,
        protocol_fee,
        royalty,
        seller_net,
        fees_to_seller,
        via_bid: true,
    });
    Ok(())
}

// ---------------------------------------------------------------- list_card / delist_card / close_expired_listing (§7.8)

#[event_cpi]
#[derive(Accounts)]
pub struct ListCard<'info> {
    /// Pays the listing and escrow rent (refunded when the listing closes).
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// CHECK: the card NFT mint: addr = `card.card_mint`, owner Token-2022 (checked in the handler).
    pub card_mint: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(seller, card_mint): holds the card for a new listing (checked in the handler).
    #[account(mut)]
    pub seller_card_account: UncheckedAccount<'info>,
    /// CHECK: `["listing", card.mint]`: created here (new listing) or this seller's `Listing` (re-price).
    #[account(mut, seeds = [LISTING_SEED, card.mint.as_ref()], bump)]
    pub listing: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(listing, card_mint), created when missing (checked in the handler).
    #[account(mut)]
    pub listing_escrow: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Lists the card (moves it into the escrow) or re-prices the seller's listing. `flags` bit0 = VOID_ON_EVOLVE;
/// `expires_at` 0 = never. Both paths set `level_at_list = card.level` and the seller's fee floor for `buy_now`
/// (`min_fees_to_seller`, §18.9: the client sets it to the §8 withdrawable total at signing; re-pricing refreshes it).
pub fn list_card(ctx: Context<ListCard>, price: u64, expires_at: i64, flags: u8, min_fees_to_seller: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.config.is_paused(PAUSE_MARKET), MintdexError::Paused);
    let now = Clock::get()?.unix_timestamp;
    check_list_args(price, expires_at, flags, a.config.min_bid, now)?;
    let mint = a.card.mint;
    let card_mint_key = a.card.card_mint;
    let seller_key = a.seller.key();
    let listing_info: &AccountInfo = &a.listing;
    check_addresses(&[
        (a.card_mint.key, card_mint_key),
        (a.card_mint.owner, TOKEN_2022_PROGRAM_ID),
        (a.seller_card_account.key, card_ata(&seller_key, &card_mint_key)),
        (a.listing_escrow.key, card_ata(listing_info.key, &card_mint_key)),
    ])?;

    let listing = match load_listing(listing_info, &mint)? {
        Some(mut l) => {
            // Re-price: only the seller of the active listing; the card is already in the escrow.
            require_keys_eq!(l.seller, seller_key, MintdexError::ListingExists);
            require!(card_amount(&a.listing_escrow, &listing_info.key(), &card_mint_key, 0)? == 1, MintdexError::ListingInvalid);
            l.price = price;
            l.expires_at = expires_at;
            l.flags = flags;
            l.level_at_list = a.card.level;
            l.min_fees_to_seller = min_fees_to_seller;
            l
        }
        None => {
            // New listing: the seller holds the card, and it must be able to come back (delist) to the same ATA.
            require!(
                card_amount(&a.seller_card_account, &seller_key, &card_mint_key, OWNER_SENDS | RECEIVES)? == 1,
                MintdexError::NotHolder
            );
            let p = Programs { token_2022: &a.token_2022_program, ata: &a.associated_token_program, system: &a.system_program };
            let seller: &AccountInfo = &a.seller;
            let card_mint: &AccountInfo = &a.card_mint;
            let bump = ctx.bumps.listing;
            create_pda_account(seller, listing_info, &p.system, Listing::LEN, &crate::ID, &[LISTING_SEED, mint.as_ref(), &[bump]])?;
            let escrow: &AccountInfo = &a.listing_escrow;
            ensure_receiving_ata(&p, seller, escrow, listing_info, card_mint)?;
            transfer_card(&p, &a.seller_card_account, escrow, seller, card_mint, &[])?;
            Listing {
                version: Listing::VERSION,
                bump,
                flags,
                level_at_list: a.card.level,
                mint,
                seller: seller_key,
                price,
                created_at: now,
                expires_at,
                min_fees_to_seller,
            }
        }
    };
    store_account(listing_info, &listing)?;
    crate::emit_event!(ctx, CardListed {
        mint,
        seller: seller_key,
        price,
        expires_at,
        void_on_evolve: flags & LISTING_VOID_ON_EVOLVE != 0,
        min_fees_to_seller,
    });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct DelistCard<'info> {
    /// `listing.seller`; pays its card ATA if it was closed meanwhile.
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: the card NFT mint: PDA `["card-mint", listing.mint]` (= `card.card_mint`), owner Token-2022.
    #[account(seeds = [CARD_MINT_SEED, listing.mint.as_ref()], bump, owner = TOKEN_2022_PROGRAM_ID)]
    pub card_mint: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(seller, card_mint), created when missing; receives the card (checked in the handler).
    #[account(mut)]
    pub seller_card_account: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.mint.as_ref()],
        bump = listing.bump,
        has_one = seller,
        close = seller,
    )]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: addr = ATA(listing, card_mint): closed to the seller (checked in the handler).
    #[account(mut)]
    pub listing_escrow: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Returns the card to the seller and closes the escrow and the listing to the seller. Never pausable.
pub fn delist_card(ctx: Context<DelistCard>) -> Result<()> {
    let a = &ctx.accounts;
    let (mint, bump) = (a.listing.mint, a.listing.bump);
    let p = Programs { token_2022: &a.token_2022_program, ata: &a.associated_token_program, system: &a.system_program };
    let seller: &AccountInfo = &a.seller;
    check_addresses(&[
        (a.seller_card_account.key, card_ata(seller.key, a.card_mint.key)),
        (a.listing_escrow.key, card_ata(&a.listing.key(), a.card_mint.key)),
    ])?;
    ensure_receiving_ata(&p, seller, &a.seller_card_account, seller, &a.card_mint)?;
    release_escrow(&p, &a.seller_card_account, &a.listing_escrow, &a.listing.to_account_info(), &a.card_mint, seller, &mint, bump)?;
    crate::emit_event!(ctx, CardDelisted { mint, seller: seller.key() });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct CloseExpiredListing<'info> {
    /// Anyone (the crank). Pays the seller's card ATA up front if the seller closed it, and gets that rent back
    /// out of the escrow + listing refunds (§18.9, audit A2), so it is out of pocket only its tx fee.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.mint.as_ref()],
        bump = listing.bump,
        has_one = seller,
        close = seller,
    )]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: `listing.seller`: receives the card and both rents (less a re-created card ATA's rent).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(seller, card_mint), created when missing (checked in the handler).
    #[account(mut)]
    pub seller_card_account: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(listing, card_mint): closed to the seller (checked in the handler).
    #[account(mut)]
    pub listing_escrow: UncheckedAccount<'info>,
    /// CHECK: the card NFT mint: PDA `["card-mint", listing.mint]` (= `card.card_mint`), owner Token-2022.
    #[account(seeds = [CARD_MINT_SEED, listing.mint.as_ref()], bump, owner = TOKEN_2022_PROGRAM_ID)]
    pub card_mint: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Permissionless: once `now > expires_at` (and `expires_at != 0`), returns the card to the seller and closes the
/// escrow and the listing (rent to the seller). Never pausable.
///
/// Audit A2 (§18.9): the seller decides whether its card ATA exists (it can close the empty ATA in its `list_card`
/// tx), so the caller must not be the one who ends up paying for it. When the ATA has to be re-created, the caller
/// pays the ATA program up front, the escrow closes into the listing account instead of the seller, the caller gets
/// exactly the rent it paid back from there, and the rest goes to the seller when the listing closes.
pub fn close_expired_listing(ctx: Context<CloseExpiredListing>) -> Result<()> {
    let a = &ctx.accounts;
    let l = &a.listing;
    let now = Clock::get()?.unix_timestamp;
    require!(l.expires_at != 0 && now > l.expires_at, MintdexError::ListingNotExpired);
    let (mint, bump) = (l.mint, l.bump);
    let p = Programs { token_2022: &a.token_2022_program, ata: &a.associated_token_program, system: &a.system_program };
    let seller: &AccountInfo = &a.seller;
    let payer: &AccountInfo = &a.payer;
    let listing_info = l.to_account_info();
    check_addresses(&[
        (a.seller_card_account.key, card_ata(seller.key, a.card_mint.key)),
        (a.listing_escrow.key, card_ata(&l.key(), a.card_mint.key)),
    ])?;
    let before = payer.lamports();
    ensure_receiving_ata(&p, payer, &a.seller_card_account, seller, &a.card_mint)?;
    let ata_rent_paid = before.saturating_sub(payer.lamports());
    let rent_to: &AccountInfo = if ata_rent_paid > 0 { &listing_info } else { seller };
    release_escrow(&p, &a.seller_card_account, &a.listing_escrow, &listing_info, &a.card_mint, rent_to, &mint, bump)?;
    if ata_rent_paid > 0 {
        move_lamports(&listing_info, payer, expired_close_refund(ata_rent_paid, listing_info.lamports()))?;
    }
    // The listing (and whatever the escrow left in it) closes to the seller at exit (Anchor `close = seller`).
    crate::emit_event!(ctx, ListingClosed { mint, seller: seller.key(), reason: LISTING_CLOSED_EXPIRED });
    Ok(())
}

// ---------------------------------------------------------------- buy_now (§7.9)

#[event_cpi]
#[derive(Accounts)]
pub struct BuyNow<'info> {
    /// Pays the price, the fees, its card ATA and the one-time vault top-up.
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: addr = `config.treasury` (protocol fee; checked in the handler).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// CHECK: the card vault `["card", card.mint]` = pump creator; system-owned without data (checked in `sweep()`).
    #[account(mut, seeds = [CARD_VAULT_SEED, card.mint.as_ref()], bump = card.vault_bump)]
    pub card_vault: UncheckedAccount<'info>,
    /// CHECK: the card NFT mint: addr = `card.card_mint`, owner Token-2022 (checked in the handler).
    pub card_mint: UncheckedAccount<'info>,
    /// CHECK: addr = `card.launcher` (royalty; checked in the handler).
    #[account(mut)]
    pub launcher: UncheckedAccount<'info>,
    /// CHECK: addr = `listing.seller`: receives the net price, the accrued fees and both rents (checked in the handler).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(listing, card_mint): holds the card; closed to the seller (checked in the handler).
    #[account(mut)]
    pub listing_escrow: UncheckedAccount<'info>,
    /// CHECK: addr = ATA(buyer, card_mint), created when missing; the buyer pays (checked in the handler).
    #[account(mut)]
    pub buyer_card_account: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, card.mint.as_ref()],
        bump = listing.bump,
        constraint = listing.mint == card.mint @ MintdexError::ListingInvalid,
        close = seller,
    )]
    pub listing: Box<Account<'info, Listing>>,
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
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Buys a listed card at `expected_price`. Remaining accounts: extra vault-owned WSOL accounts (every one the vault
/// owns: the sale must pay the seller at least `listing.min_fees_to_seller`, §18.9, or it fails `FeesBelowFloor`).
pub fn buy_now<'info>(
    ctx: Context<'_, '_, 'info, 'info, BuyNow<'info>>,
    expected_price: u64,
    max_total_fee_bps: u16,
) -> Result<()> {
    let a = &ctx.accounts;
    let cfg = &a.config;
    require!(!cfg.is_paused(PAUSE_MARKET), MintdexError::Paused);
    let l = &a.listing;
    let (mint, price, listing_bump, fee_floor) = (a.card.mint, l.price, l.bump, l.min_fees_to_seller);
    let card_mint_key = a.card.card_mint;
    let buyer_key = a.buyer.key();
    let seller_key = a.seller.key();
    check_addresses(&[
        (a.treasury.key, cfg.treasury),
        (a.launcher.key, a.card.launcher),
        (&seller_key, l.seller),
        (a.card_mint.key, card_mint_key),
        (a.card_mint.owner, TOKEN_2022_PROGRAM_ID),
        (a.listing_escrow.key, card_ata(&l.key(), &card_mint_key)),
        (a.buyer_card_account.key, card_ata(&buyer_key, &card_mint_key)),
    ])?;
    let clock = Clock::get()?;
    check_buyable(l, expected_price, clock.unix_timestamp, clock.slot, &Window::from_card(&a.card), cfg.paused)?;
    require_keys_neq!(buyer_key, seller_key, MintdexError::SelfTrade);
    require!(card_amount(&a.listing_escrow, &l.key(), &card_mint_key, 0)? == 1, MintdexError::ListingInvalid);
    let (protocol_fee, royalty, seller_net) = price_sale(
        price,
        cfg.protocol_fee_bps,
        cfg.creator_royalty_bps,
        seller_key == a.card.launcher,
        max_total_fee_bps,
    )?;

    let p = Programs { token_2022: &a.token_2022_program, ata: &a.associated_token_program, system: &a.system_program };
    let buyer: &AccountInfo = &a.buyer;
    let seller: &AccountInfo = &a.seller;

    // 2. Sweep (the buyer pays the one-time top-up), then the vault's available balance goes to the seller (§8), at
    //    least the listing's fee floor (§18.9).
    let sa = SweepAccounts {
        payer: buyer,
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
        associated_token_program: p.ata,
        system_program: p.system,
    };
    let vault_bump = a.card.vault_bump;
    sweep(&sa, &mint, vault_bump, cfg.sweep_flags, ctx.remaining_accounts)?;
    let fees_to_seller = settle_fees_to_seller(&sa, seller, &mint, vault_bump, fee_floor)?;

    // 3. The buyer pays the protocol fee, the royalty and the seller's net.
    pay(&p.system, buyer, &a.treasury, protocol_fee)?;
    pay(&p.system, buyer, &a.launcher, royalty)?;
    pay(&p.system, buyer, seller, seller_net)?;

    // 4. Escrow → buyer (its ATA created when missing, at its cost); the escrow closes to the seller here, the
    //    listing at exit (Anchor `close = seller`).
    ensure_receiving_ata(&p, buyer, &a.buyer_card_account, buyer, &a.card_mint)?;
    release_escrow(&p, &a.buyer_card_account, &a.listing_escrow, &l.to_account_info(), &a.card_mint, seller, &mint, listing_bump)?;

    record_sale(&mut ctx.accounts.card, price, fees_to_seller)?;
    // 5.
    crate::emit_event!(ctx, CardSold {
        mint,
        seller: seller_key,
        buyer: buyer_key,
        price,
        protocol_fee,
        royalty,
        seller_net,
        fees_to_seller,
        via_bid: false,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use anchor_lang::solana_program::program_pack::Pack;
    use anchor_spl::token_2022::spl_token_2022::extension::{BaseStateWithExtensionsMut, StateWithExtensionsMut};
    use anchor_spl::token_2022::spl_token_2022::extension::memo_transfer::MemoTransfer;
    use anchor_spl::token_2022::spl_token_2022::extension::immutable_owner::ImmutableOwner;

    const SOL: u64 = 1_000_000_000;

    // ---------------------------------------------------------------- U7 sale splits

    #[test]
    fn u7_splits_sum_to_price_for_10k_random_prices() {
        let mut r = XorShift::new(7);
        let (lo, hi) = (30_000_000u64, 1_000 * SOL); // 0.03 .. 1000 SOL
        let mut checked = 0;
        for i in 0..10_000 {
            let price = lo + r.next() % (hi - lo + 1);
            // the devnet fees, plus random fee pairs inside validate()'s 2,000 bps cap every other round
            let (pbps, rbps) = if i % 2 == 0 {
                (250u16, 500u16)
            } else {
                let p = (r.next() % 2_001) as u16;
                (p, (r.next() % (2_001 - p as u64)) as u16)
            };
            for seller_is_launcher in [false, true] {
                let (protocol, royalty, net) = price_sale(price, pbps, rbps, seller_is_launcher, 2_000).unwrap();
                assert_eq!(protocol + royalty + net, price, "price {price} bps {pbps}/{rbps}");
                assert_eq!(protocol as u128, price as u128 * pbps as u128 / 10_000);
                if seller_is_launcher {
                    assert_eq!(royalty, 0);
                } else {
                    assert_eq!(royalty as u128, price as u128 * rbps as u128 / 10_000);
                }
                checked += 1;
            }
        }
        assert_eq!(checked, 20_000);
        // the extremes of the range with the devnet fees
        assert_eq!(price_sale(lo, 250, 500, false, 750).unwrap(), (750_000, 1_500_000, 27_750_000));
        assert_eq!(price_sale(hi, 250, 500, true, 250).unwrap(), (25 * SOL, 0, 975 * SOL));
        // floor rounding leaves the dust with the seller
        assert_eq!(price_sale(30_000_039, 250, 500, false, 750).unwrap(), (750_000, 1_500_001, 27_750_038));
    }

    #[test]
    fn u7_max_total_fee_guard() {
        // 2.5% + 5% = 750 bps; the launcher selling pays only the 250 bps protocol fee
        assert!(price_sale(SOL, 250, 500, false, 750).is_ok());
        assert_error(price_sale(SOL, 250, 500, false, 749), MintdexError::FeesChanged);
        assert!(price_sale(SOL, 250, 500, true, 250).is_ok());
        assert_error(price_sale(SOL, 250, 500, true, 249), MintdexError::FeesChanged);
        // an admin fee raise after the seller signed fails instead of charging more
        assert_error(price_sale(SOL, 300, 500, false, 750), MintdexError::FeesChanged);
    }

    // ---------------------------------------------------------------- listing rules

    fn listing(flags: u8, level: u8, expires_at: i64) -> Listing {
        Listing {
            version: 1,
            bump: 254,
            flags,
            level_at_list: level,
            mint: Pubkey::new_unique(),
            seller: Pubkey::new_unique(),
            price: 50_000_000,
            created_at: 100,
            expires_at,
            min_fees_to_seller: 0,
        }
    }

    #[test]
    fn seller_fee_floor_a1() {
        // a sale pays at least the floor the seller signed or stored; anything less fails instead of paying less
        check_fee_floor(0, 0).unwrap();
        check_fee_floor(2_962_963, 2_962_963).unwrap();
        check_fee_floor(2_962_963 + 2_039_280, 2_962_963).unwrap(); // the hidden account's rent goes to the seller too
        assert_error(check_fee_floor(0, 2_962_963), MintdexError::FeesBelowFloor);
        assert_error(check_fee_floor(2_962_962, 2_962_963), MintdexError::FeesBelowFloor);
        // a withdraw while listed lowers the stored floor by what the seller received (never below 0)
        let mut l = listing(0, 1, 0);
        l.min_fees_to_seller = 5_000_000;
        l.lower_fee_floor(3_000_000);
        assert_eq!(l.min_fees_to_seller, 2_000_000);
        l.lower_fee_floor(9_000_000);
        assert_eq!(l.min_fees_to_seller, 0);
    }

    #[test]
    fn expired_close_refund_a2() {
        // local rent: re-created card ATA 2,074,080; the listing holds its rent + the closed escrow's
        let (ata, listing_rent, escrow) = (2_074_080u64, 1_642_560u64, 2_074_080u64);
        assert_eq!(expired_close_refund(ata, listing_rent + escrow), ata);
        assert_eq!(expired_close_refund(0, listing_rent), 0);
        // pre-funded ATA address: the ATA program only charged the shortfall, and only that is refunded
        assert_eq!(expired_close_refund(74_080, listing_rent + escrow), 74_080);
        // never more than the listing holds (cannot happen with a real escrow; the instruction must not fail)
        assert_eq!(expired_close_refund(ata, 1_000), 1_000);
    }

    fn win(level: u8, pending: u8) -> Window {
        Window { level, pending_level: pending, ..Default::default() }
    }

    #[test]
    fn buy_now_listing_rules() {
        let l = listing(0, 3, 0);
        check_buyable(&l, 50_000_000, 1_000_000, 0, &win(3, 0), 0).unwrap();
        assert_error(check_buyable(&l, 49_999_999, 0, 0, &win(3, 0), 0), MintdexError::PriceChanged);
        // a plain listing ignores evolves, the mark and the EVOLVE pause
        let marked = Window { hwm_level: 9, hwm_until: 1_000, ..win(5, 7) };
        check_buyable(&l, 50_000_000, 0, 10, &marked, PAUSE_EVOLVE).unwrap();
        // expiry: buyable through expires_at, not after
        let e = listing(0, 3, 1_000);
        check_buyable(&e, 50_000_000, 1_000, 0, &win(3, 0), 0).unwrap();
        assert_error(check_buyable(&e, 50_000_000, 1_001, 0, &win(3, 0), 0), MintdexError::ListingExpired);
        // VOID_ON_EVOLVE: a confirm or a pending level above level_at_list voids it
        let v = listing(LISTING_VOID_ON_EVOLVE, 3, 0);
        check_buyable(&v, 50_000_000, 0, 0, &win(3, 0), 0).unwrap();
        check_buyable(&v, 50_000_000, 0, 0, &win(3, 3), 0).unwrap(); // pending at the listing level
        assert_error(check_buyable(&v, 50_000_000, 0, 0, &win(4, 0), 0), MintdexError::ListingVoided);
        assert_error(check_buyable(&v, 50_000_000, 0, 0, &win(3, 4), 0), MintdexError::ListingVoided);
        assert_error(check_buyable(&v, 50_000_000, 0, 0, &win(5, 0), 0), MintdexError::ListingVoided);
        // F2: an active mark above level_at_list voids it through hwm_until, not after
        let m = Window { hwm_level: 5, hwm_until: 2_000, ..win(3, 0) };
        assert_error(check_buyable(&v, 50_000_000, 0, 1_500, &m, 0), MintdexError::ListingVoided);
        assert_error(check_buyable(&v, 50_000_000, 0, 2_000, &m, 0), MintdexError::ListingVoided);
        check_buyable(&v, 50_000_000, 0, 2_001, &m, 0).unwrap();
        // a mark at or below level_at_list is ignored
        let low = Window { hwm_level: 3, hwm_until: 2_000, ..win(3, 0) };
        check_buyable(&v, 50_000_000, 0, 1_500, &low, 0).unwrap();
        // admin B4: EVOLVE paused voids VOID_ON_EVOLVE listings only; MARKET / REGISTER bits do not
        assert_error(check_buyable(&v, 50_000_000, 0, 0, &win(3, 0), PAUSE_EVOLVE), MintdexError::ListingVoided);
        check_buyable(&v, 50_000_000, 0, 0, &win(3, 0), PAUSE_REGISTER).unwrap();
    }

    #[test]
    fn list_card_argument_rules() {
        let min = 30_000_000;
        check_list_args(min, 0, 0, min, 500).unwrap();
        check_list_args(min, 501, LISTING_VOID_ON_EVOLVE, min, 500).unwrap();
        assert_error(check_list_args(min - 1, 0, 0, min, 500), MintdexError::BidTooLow);
        assert_error(check_list_args(min, 500, 0, min, 500), MintdexError::ListingExpired);
        assert_error(check_list_args(min, -1, 0, min, 500), MintdexError::ListingExpired);
        assert_error(check_list_args(min, 0, 2, min, 500), MintdexError::ListingInvalid);
    }

    // ---------------------------------------------------------------- Token-2022 account extensions (L8 logic)

    fn account_len(exts: &[ExtensionType]) -> usize {
        ExtensionType::try_calculate_account_len::<T22Account>(exts).unwrap()
    }

    /// A Token-2022 account of `mint` owned by `owner` holding `amount`, with ImmutableOwner plus `exts`
    /// (MemoTransfer / CpiGuard set to `enabled`).
    fn t22_account(mint: &Pubkey, owner: &Pubkey, amount: u64, exts: &[ExtensionType], enabled: bool) -> Vec<u8> {
        let mut all = vec![ExtensionType::ImmutableOwner];
        all.extend_from_slice(exts);
        let mut data = vec![0u8; account_len(&all)];
        let mut s = StateWithExtensionsMut::<T22Account>::unpack_uninitialized(&mut data).unwrap();
        s.init_extension::<ImmutableOwner>(true).unwrap();
        for e in exts {
            match e {
                ExtensionType::MemoTransfer => {
                    s.init_extension::<MemoTransfer>(true).unwrap().require_incoming_transfer_memos = enabled.into()
                }
                ExtensionType::CpiGuard => s.init_extension::<CpiGuard>(true).unwrap().lock_cpi = enabled.into(),
                _ => unreachable!(),
            }
        }
        s.base = T22Account { mint: *mint, owner: *owner, amount, state: AccountState::Initialized, ..Default::default() };
        s.pack_base();
        s.init_account_type().unwrap();
        data
    }

    #[test]
    fn card_account_checks() {
        let (mint, owner) = (Pubkey::new_unique(), Pubkey::new_unique());
        let t22 = TOKEN_2022_PROGRAM_ID;
        let plain = t22_account(&mint, &owner, 1, &[], false);
        for role in [0, RECEIVES, OWNER_SENDS, RECEIVES | OWNER_SENDS] {
            assert_eq!(check_card_account(&t22, &plain, &owner, &mint, role).unwrap(), 1);
        }
        // a base-size account without extensions (not an ATA layout) is fine too
        let mut base = vec![0u8; T22Account::LEN];
        T22Account { mint, owner, amount: 0, state: AccountState::Initialized, ..Default::default() }.pack_into_slice(&mut base);
        assert_eq!(check_card_account(&t22, &base, &owner, &mint, RECEIVES).unwrap(), 0);
        // wrong mint, wrong owner, SPL Token program, garbage
        assert_error(check_card_account(&t22, &plain, &owner, &Pubkey::new_unique(), 0), MintdexError::NotHolder);
        assert_error(check_card_account(&t22, &plain, &Pubkey::new_unique(), &mint, 0), MintdexError::NotHolder);
        assert_error(check_card_account(&SPL_TOKEN_PROGRAM_ID, &plain, &owner, &mint, 0), MintdexError::NotHolder);
        assert_error(check_card_account(&t22, &[1u8; 40], &owner, &mint, 0), MintdexError::NotHolder);

        // MemoTransfer enabled: rejected only where the account receives the card (bidder / buyer / delist target)
        let memo_on = t22_account(&mint, &owner, 0, &[ExtensionType::MemoTransfer], true);
        assert_error(check_card_account(&t22, &memo_on, &owner, &mint, RECEIVES), MintdexError::UnsupportedTokenAccount);
        assert_eq!(check_card_account(&t22, &memo_on, &owner, &mint, OWNER_SENDS).unwrap(), 0);
        let memo_off = t22_account(&mint, &owner, 0, &[ExtensionType::MemoTransfer], false);
        assert_eq!(check_card_account(&t22, &memo_off, &owner, &mint, RECEIVES).unwrap(), 0);

        // CpiGuard enabled: rejected only where the owner signs a transfer out through MintDex (seller)
        let guard_on = t22_account(&mint, &owner, 1, &[ExtensionType::CpiGuard], true);
        assert_error(check_card_account(&t22, &guard_on, &owner, &mint, OWNER_SENDS), MintdexError::UnsupportedTokenAccount);
        assert_eq!(check_card_account(&t22, &guard_on, &owner, &mint, RECEIVES).unwrap(), 1);
        let guard_off = t22_account(&mint, &owner, 1, &[ExtensionType::CpiGuard], false);
        assert_eq!(check_card_account(&t22, &guard_off, &owner, &mint, OWNER_SENDS | RECEIVES).unwrap(), 1);

        // a new listing needs both directions (the card must be able to come back on delist)
        let both = t22_account(&mint, &owner, 1, &[ExtensionType::MemoTransfer, ExtensionType::CpiGuard], false);
        assert_eq!(check_card_account(&t22, &both, &owner, &mint, OWNER_SENDS | RECEIVES).unwrap(), 1);
        assert_error(check_card_account(&t22, &memo_on, &owner, &mint, OWNER_SENDS | RECEIVES), MintdexError::UnsupportedTokenAccount);
    }

    /// F10: a frozen account with the right mint and owner is `CardFrozen` for every role; with a wrong mint or owner
    /// it stays `NotHolder`; an uninitialized account is `NotHolder`.
    #[test]
    fn card_account_frozen_cases() {
        let (mint, owner) = (Pubkey::new_unique(), Pubkey::new_unique());
        let t22 = TOKEN_2022_PROGRAM_ID;
        let account = |state: AccountState, m: &Pubkey, o: &Pubkey| {
            let mut d = vec![0u8; T22Account::LEN];
            T22Account { mint: *m, owner: *o, amount: 1, state, ..Default::default() }.pack_into_slice(&mut d);
            d
        };
        let frozen = account(AccountState::Frozen, &mint, &owner);
        for role in [0, RECEIVES, OWNER_SENDS, RECEIVES | OWNER_SENDS] {
            assert_error(check_card_account(&t22, &frozen, &owner, &mint, role), MintdexError::CardFrozen);
        }
        assert_error(check_card_account(&t22, &frozen, &owner, &Pubkey::new_unique(), 0), MintdexError::NotHolder);
        assert_error(check_card_account(&t22, &frozen, &Pubkey::new_unique(), &mint, 0), MintdexError::NotHolder);
        let uninit = account(AccountState::Uninitialized, &mint, &owner);
        assert_error(check_card_account(&t22, &uninit, &owner, &mint, 0), MintdexError::NotHolder);
    }

    #[test]
    fn unknown_account_extensions_fail_closed() {
        let (mint, owner) = (Pubkey::new_unique(), Pubkey::new_unique());
        // a TransferFeeAmount entry (an account extension this card mint can never need) is not on the allowlist
        let exts = [ExtensionType::ImmutableOwner, ExtensionType::TransferFeeAmount];
        let mut data = vec![0u8; account_len(&exts)];
        let mut s = StateWithExtensionsMut::<T22Account>::unpack_uninitialized(&mut data).unwrap();
        s.init_extension::<ImmutableOwner>(true).unwrap();
        s.init_extension::<anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFeeAmount>(true)
            .unwrap();
        s.base = T22Account { mint, owner, amount: 1, state: AccountState::Initialized, ..Default::default() };
        s.pack_base();
        s.init_account_type().unwrap();
        assert_error(
            check_card_account(&TOKEN_2022_PROGRAM_ID, &data, &owner, &mint, 0),
            MintdexError::UnsupportedTokenAccount,
        );
    }
}
