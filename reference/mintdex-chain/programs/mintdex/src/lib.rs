//! MintDex card program v2 (card-program-v2.md revision 1).
//!
//! MintDex has no bonding curve of its own: pump.fun owns the coin, the curve, the PumpSwap pool and the fees.
//! MintDex owns the card: registration (ticket + bound coin URI + vanity key signature), the Token-2022
//! one-of-one card NFT whose design level only rises (continuous-hold `evolve`), the creator-fee vault
//! `["card", mint]` (pump's `creator`) with a permissionless three-leg sweep and holder withdrawals, and the card
//! market (escrowed bids, custodial listings; `instructions::market`).
//!
//! Mainnet fix pack (refs/mainnet/fix-plan.md, card-program-v2 §18.18): attested observations (`observe`,
//! `set_observers`, F1), the listing-pause mark (F2), the guarded tier / price / fee settings behind the upgrade
//! authority (`update_tier_config`, F6), the instant pause (`set_paused`), the ext settings (`set_config_ext`: register
//! flags F9, outside royalty F8, ticket authority F12), the verified MintDex collection (`init_collection`,
//! `sync_card_metadata`, `sync_collection_metadata`, F8), frozen-holder withdrawals (F10), the Pyth baseline at
//! `initialize` (F4), the closed-curve pool fallback (F5) and security.txt (F14).

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod evolve;
pub mod holder;
pub mod instructions;
pub mod math;
pub mod metadata;
pub mod mpl;
pub mod price;
pub mod pump;
pub mod state;
pub mod sweep;
pub mod utils;

#[cfg(test)]
pub(crate) mod test_utils;

use instructions::*;
use state::{ConfigExtParams, ConfigParams, TierParams};

declare_id!("4HTSBYfgm5os2kBwFVBv5cd4mPetNmS32Cb4r3YViDon");

// F14 (design-admin §8.1): source_code / source_revision are added once the repository is public; auditors after the
// external audit.
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "MintDex",
    project_url: "https://mintdex.fun",
    contacts: "email:security@mintdex.fun,link:https://mintdex.fun/security,twitter:mintdexdotfun",
    policy: "https://mintdex.fun/security",
    preferred_languages: "en",
    auditors: "None"
}

#[program]
pub mod mintdex {
    use super::*;

    // ---------------------------------------------------------------- admin (§7.1)

    /// Creates Config. Gated by the program's upgrade authority. Optional `price_feed` (required under Pyth): its price
    /// becomes the Pyth baseline (F4).
    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        instructions::admin::initialize(ctx, params)
    }

    /// Changes everything except the admin (`paused` and `sweep_flags` included). With `tier_guard` on the guarded
    /// fields must stay as they are (`TierFieldsLocked`, F6).
    pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
        instructions::admin::update_config(ctx, params)
    }

    /// F6: the guarded tier, price, fee and card-URI fields and `tier_guard`, signed by the program's upgrade authority
    /// (the time-locked multisig on mainnet).
    pub fn update_tier_config(ctx: Context<UpdateTierConfig>, tier: TierParams) -> Result<()> {
        instructions::admin::update_tier_config(ctx, tier)
    }

    /// F8 / F9 / F12: register flags, outside royalty, ticket authority and allowance (field mask). remaining_accounts
    /// = [ObserverSet PDA] when the mask sets the ticket authority.
    pub fn set_config_ext(ctx: Context<SetConfigExt>, ext: ConfigExtParams) -> Result<()> {
        instructions::admin::set_config_ext(ctx, ext)
    }

    /// The instant pause: the admin sets and clears any bits (`paused = (paused | set_bits) & !clear_bits`); a
    /// ROLE_PAUSE observer (remaining_accounts = [ObserverSet]) may only set the EVOLVE bit. Clearing EVOLVE records
    /// `Config.evolve_resumed_slot` (review round 2).
    pub fn set_paused(ctx: Context<SetPaused>, set_bits: u8, clear_bits: u8) -> Result<()> {
        instructions::observers::set_paused(ctx, set_bits, clear_bits)
    }

    /// F1: writes the observer set and `Config.evolve_min_observers` (upgrade authority: any valid set; admin: any
    /// valid set while `tier_guard` is off, shrink only while it is on). Every call advances the set's epoch. Review
    /// round 2: anything but a shrink of the live set must pass the live epoch as `expected_epoch`.
    pub fn set_observers(
        ctx: Context<SetObservers>,
        keys: [Pubkey; 8],
        roles: [u8; 8],
        min_observers: u8,
        expected_epoch: u8,
    ) -> Result<()> {
        instructions::observers::set_observers(ctx, keys, roles, min_observers, expected_epoch)
    }

    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn set_price(ctx: Context<SetPrice>, sol_usd_e6: u64) -> Result<()> {
        instructions::admin::set_price(ctx, sol_usd_e6)
    }

    /// remaining_accounts = pairs (mint [ro], ticket [w]). Signer: the admin, or the ticket authority (flags 0, within
    /// its allowance; F12).
    pub fn issue_tickets<'info>(ctx: Context<'_, '_, 'info, 'info, IssueTickets<'info>>, flags: u8) -> Result<()> {
        instructions::admin::issue_tickets(ctx, flags)
    }

    pub fn revoke_ticket(ctx: Context<RevokeTicket>) -> Result<()> {
        instructions::admin::revoke_ticket(ctx)
    }

    // ---------------------------------------------------------------- cards (§7.2 to §7.5)

    pub fn register_card(ctx: Context<RegisterCard>) -> Result<()> {
        instructions::register::register_card(ctx)
    }

    /// `register_card` with a Metaplex NonFungible card NFT (metadata + master edition by CPI; card-program-v2
    /// §18.17), so wallets, DAS indexers and marketplaces list the card as an NFT. remaining_accounts (optional, F8) =
    /// [collection authority, collection mint, collection metadata (writable), collection master edition]: the card
    /// joins the verified MintDex collection.
    pub fn register_card_metaplex<'info>(ctx: Context<'_, '_, 'info, 'info, RegisterCardMetaplex<'info>>) -> Result<()> {
        instructions::register::register_card_metaplex(ctx)
    }

    /// remaining_accounts (cards registered with `register_card_metaplex` only, needed on a confirm) =
    /// [Metaplex metadata PDA (writable), Metaplex Token Metadata program]. In attested mode (F1) it changes no window.
    pub fn evolve<'info>(ctx: Context<'_, '_, 'info, 'info, Evolve<'info>>) -> Result<()> {
        instructions::evolve_card::evolve(ctx)
    }

    /// F1: an observer-set member's observation capped at `max_live_level` (the level it read from committed state).
    /// remaining_accounts = [ObserverSet], then on a Metaplex confirm [metadata (writable), Metaplex program].
    pub fn observe<'info>(ctx: Context<'_, '_, 'info, 'info, Evolve<'info>>, max_live_level: u8) -> Result<()> {
        instructions::evolve_card::observe(ctx, max_live_level)
    }

    /// F8: the sized MintDex collection NFT, once (admin). `uri` must be `card_uri_base ‖ "collection.json"`.
    pub fn init_collection(ctx: Context<InitCollection>, name: String, uri: String) -> Result<()> {
        instructions::collection::init_collection(ctx, name, uri)
    }

    /// F8: permissionless; a Metaplex card's URI and royalty follow its level and the Config (creators and collection
    /// copied verbatim). No-op when they already match.
    pub fn sync_card_metadata(ctx: Context<SyncCardMetadata>) -> Result<()> {
        instructions::collection::sync_card_metadata(ctx)
    }

    /// F8 (admin B14): permissionless; the collection URI follows `card_uri_base`. No-op when it already matches.
    pub fn sync_collection_metadata(ctx: Context<SyncCollectionMetadata>) -> Result<()> {
        instructions::collection::sync_collection_metadata(ctx)
    }

    /// remaining_accounts = extra vault-owned WSOL accounts (writable).
    pub fn collect_fees<'info>(ctx: Context<'_, '_, 'info, 'info, CollectFees<'info>>) -> Result<()> {
        instructions::fees::collect_fees(ctx)
    }

    /// remaining_accounts = extra vault-owned WSOL accounts (writable).
    pub fn withdraw_fees<'info>(ctx: Context<'_, '_, 'info, 'info, WithdrawFees<'info>>) -> Result<()> {
        instructions::fees::withdraw_fees(ctx)
    }

    // ---------------------------------------------------------------- market (§7.6 to §7.9)

    /// Creates, raises or lowers a bid (`amount ≥ config.min_bid`; the escrow moves by the difference).
    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        instructions::market::place_bid(ctx, amount)
    }

    /// Escrow and rent back to the bidder. Never pausable.
    pub fn cancel_bid(ctx: Context<CancelBid>) -> Result<()> {
        instructions::market::cancel_bid(ctx)
    }

    /// The holder (or `listing.seller`) sells to a bidder. remaining_accounts = extra vault-owned WSOL accounts.
    /// `min_fees_to_seller`: the seller's floor for the accrued fees the sale pays it (§18.9; `FeesBelowFloor`).
    pub fn accept_bid<'info>(
        ctx: Context<'_, '_, 'info, 'info, AcceptBid<'info>>,
        min_amount: u64,
        max_total_fee_bps: u16,
        min_fees_to_seller: u64,
    ) -> Result<()> {
        instructions::market::accept_bid(ctx, min_amount, max_total_fee_bps, min_fees_to_seller)
    }

    /// Custodial listing (the card moves into the listing escrow) or re-price. `flags` bit0 = VOID_ON_EVOLVE;
    /// `expires_at` 0 = never; `min_fees_to_seller` = the seller's fee floor for `buy_now` (§18.9).
    pub fn list_card(
        ctx: Context<ListCard>,
        price: u64,
        expires_at: i64,
        flags: u8,
        min_fees_to_seller: u64,
    ) -> Result<()> {
        instructions::market::list_card(ctx, price, expires_at, flags, min_fees_to_seller)
    }

    /// The card goes back to the seller; escrow and listing close to the seller. Never pausable.
    pub fn delist_card(ctx: Context<DelistCard>) -> Result<()> {
        instructions::market::delist_card(ctx)
    }

    /// Permissionless after `expires_at`: the card goes back to the seller; the caller is refunded a re-created seller
    /// card ATA's rent out of the escrow and listing refunds (§18.9). Never pausable.
    pub fn close_expired_listing(ctx: Context<CloseExpiredListing>) -> Result<()> {
        instructions::market::close_expired_listing(ctx)
    }

    /// Buys a listed card. remaining_accounts = extra vault-owned WSOL accounts (the sale must pay the seller at least
    /// `listing.min_fees_to_seller`, §18.9).
    pub fn buy_now<'info>(
        ctx: Context<'_, '_, 'info, 'info, BuyNow<'info>>,
        expected_price: u64,
        max_total_fee_bps: u16,
    ) -> Result<()> {
        instructions::market::buy_now(ctx, expected_price, max_total_fee_bps)
    }
}
