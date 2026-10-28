//! Events (card-program-v2 §9), emitted as Anchor CPI events (`emit_event!`, byte-identical to `emit_cpi!`) so they
//! land in inner instructions as `e445a52e51cb9a1d` + event discriminator + borsh. The indexer trusts an event only when the inner
//! instruction's program is MintDex and its only account is MintDex's `["__event_authority"]` PDA.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

/// `emit_event!(ctx, Event { .. })`: byte-identical to Anchor's `emit_cpi!` (self-CPI to MintDex with data
/// `EVENT_IX_TAG_LE ‖ event discriminator ‖ borsh`, signed by `["__event_authority"]`), but the CPI is one shared
/// function instead of being inlined at every call site (saves .so bytes). Needs `#[event_cpi]` on the accounts.
#[macro_export]
macro_rules! emit_event {
    ($ctx:ident, $event:expr) => {
        $crate::events::emit_cpi_event(
            &$ctx.accounts.event_authority,
            $ctx.bumps.event_authority,
            anchor_lang::Event::data(&$event),
        )?
    };
}

/// The CPI half of `emit_event!` (see `anchor_attribute_event::emit_cpi`).
#[inline(never)]
pub fn emit_cpi_event(event_authority: &AccountInfo, bump: u8, event_data: Vec<u8>) -> Result<()> {
    let mut data = Vec::with_capacity(anchor_lang::event::EVENT_IX_TAG_LE.len() + event_data.len());
    data.extend_from_slice(anchor_lang::event::EVENT_IX_TAG_LE);
    data.extend_from_slice(&event_data);
    let ix = Instruction {
        program_id: crate::ID,
        accounts: vec![AccountMeta::new_readonly(*event_authority.key, true)],
        data,
    };
    invoke_signed(&ix, &[event_authority.clone()], &[&[b"__event_authority", &[bump]]]).map_err(Into::into)
}

#[event]
pub struct CardRegistered {
    pub mint: Pubkey,
    pub card_mint: Pubkey,
    pub vault: Pubkey,
    pub launcher: Pubkey,
    pub legacy: bool,
    pub slot: u64,
}

#[event]
pub struct TicketsIssued {
    pub count: u16,
    pub flags: u8,
}

#[event]
pub struct TicketRevoked {
    pub mint: Pubkey,
}

#[event]
pub struct EvolveObserved {
    pub mint: Pubkey,
    pub live_level: u8,
    pub pending_level: u8,
    pub obs: u8,
    pub mcap_lamports: u64,
    pub mcap_usd_e6: u64,
    pub sol_usd_e6: u64,
    pub slot: u64,
}

#[event]
pub struct EvolvePendingCleared {
    pub mint: Pubkey,
    pub live_level: u8,
    pub slot: u64,
}

#[event]
pub struct CardEvolved {
    pub mint: Pubkey,
    pub from_level: u8,
    pub to_level: u8,
    pub mcap_lamports: u64,
    pub mcap_usd_e6: u64,
    pub sol_usd_e6: u64,
    pub graduated: bool,
}

#[event]
pub struct CreatorMismatch {
    pub mint: Pubkey,
    pub found: Pubkey,
    pub on_pool: bool,
}

#[event]
pub struct CreatorFeesChanged {
    pub mint: Pubkey,
    pub creator_fee_bps: u64,
    pub is_holder_reward: bool,
}

#[event]
pub struct FeesCollected {
    pub mint: Pubkey,
    pub topup: u64,
    pub from_amm: u64,
    pub from_wsol: u64,
    pub collected: u64,
    pub vault_available: u64,
}

#[event]
pub struct FeesWithdrawn {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub amount: u64,
    pub lifetime_paid_out: u64,
}

#[event]
pub struct BidPlaced {
    pub mint: Pubkey,
    pub bidder: Pubkey,
    pub previous: u64,
    pub amount: u64,
}

#[event]
pub struct BidCancelled {
    pub mint: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CardListed {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub expires_at: i64,
    pub void_on_evolve: bool,
    /// The seller's fee floor for `buy_now` (card-program-v2 §18.9).
    pub min_fees_to_seller: u64,
}

#[event]
pub struct CardDelisted {
    pub mint: Pubkey,
    pub seller: Pubkey,
}

/// `reason`: 3 expired, 4 sold via bid (`constants::LISTING_CLOSED_*`).
#[event]
pub struct ListingClosed {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub reason: u8,
}

#[event]
pub struct CardSold {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub protocol_fee: u64,
    pub royalty: u64,
    pub seller_net: u64,
    pub fees_to_seller: u64,
    pub via_bid: bool,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
}

#[event]
pub struct PriceUpdated {
    pub sol_usd_e6: u64,
    pub by: Pubkey,
}

// ---------------------------------------------------------------- mainnet fix pack (fix-plan §2.2), appended

/// `set_observers` wrote the observer set (F1). `epoch` = the new `ObserverSet.epoch`.
#[event]
pub struct ObserversSet {
    pub keys: [Pubkey; 8],
    pub roles: [u8; 8],
    pub min_observers: u8,
    pub epoch: u8,
    pub by: Pubkey,
}

/// `observe` whose cap differs from the on-chain live level, or a counting call that the ignore rule dropped
/// (`applied == false`, F1 / tier B5).
#[event]
pub struct ObservationMismatch {
    pub mint: Pubkey,
    pub observer: Pubkey,
    pub cap: u8,
    pub live_onchain: u8,
    pub applied: bool,
    pub slot: u64,
}

/// `update_tier_config` by the upgrade authority (F6).
#[event]
pub struct TierConfigUpdated {
    pub by: Pubkey,
    pub tier_guard: bool,
}

/// `set_config_ext` (F8, F9, F12; admin B7, B11): the masked fields and their values after the write.
#[event]
pub struct ConfigExtUpdated {
    pub mask: u8,
    pub register_flags: u8,
    pub outside_royalty_bps: u16,
    pub ticket_authority: Pubkey,
    pub ticket_allowance: u16,
}

/// `init_collection` made the MintDex collection NFT (F8).
#[event]
pub struct CollectionCreated {
    pub collection_mint: Pubkey,
    pub collection_metadata: Pubkey,
}
