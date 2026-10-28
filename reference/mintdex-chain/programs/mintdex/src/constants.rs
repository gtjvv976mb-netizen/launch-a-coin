//! Program ids, discriminators, PDA seeds and flag bits (card-program-v2 §3, §4).
//! The pump / PumpSwap / Pyth ids are the same on devnet and mainnet (VERIFIED in pump-devnet-facts §3).

use anchor_lang::prelude::*;

// ---------------------------------------------------------------- external programs and accounts

pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const PUMP_EVENT_AUTHORITY: Pubkey = pubkey!("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
pub const PAMM_PROGRAM_ID: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const PAMM_EVENT_AUTHORITY: Pubkey = pubkey!("GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const SYSTEM_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/// Pyth push oracle (writes the sponsored feeds through the receiver).
pub const PYTH_PUSH_ORACLE_ID: Pubkey = pubkey!("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/// The sponsored SOL/USD PriceUpdateV2 account: push-oracle PDA `[shard 0u16 LE, SOL_USD_FEED_ID]` (fix-plan §2.2,
/// admin B13). Under `price_source = Pyth`, `Config.pyth_price_account` must be exactly this account (`is_valid`).
pub const PYTH_SOL_USD_FEED: Pubkey = pubkey!("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
pub const COMPUTE_BUDGET_PROGRAM_ID: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
pub const INSTRUCTIONS_SYSVAR_ID: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
/// Burn address that no one can sign for (one of the §4.5 sinks).
pub const INCINERATOR: Pubkey = pubkey!("1nc1nerator11111111111111111111111111111111");

/// Pyth SOL/USD feed id (G6).
pub const SOL_USD_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39, 0x2a, 0x0d,
    0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];

// ---------------------------------------------------------------- discriminators (§3)

pub const CURVE_DISC: [u8; 8] = [0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60];
pub const POOL_DISC: [u8; 8] = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
pub const PRICE_UPDATE_V2_DISC: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];
pub const COLLECT_CREATOR_FEE_DISC: [u8; 8] = [0x14, 0x16, 0x56, 0x7b, 0xc6, 0x1c, 0xdb, 0x84];
pub const TRANSFER_CREATOR_FEES_TO_PUMP_DISC: [u8; 8] = [0x8b, 0x34, 0x86, 0x55, 0xe4, 0xe5, 0x6c, 0xf1];

// ---------------------------------------------------------------- PDA seeds

pub const CONFIG_SEED: &[u8] = b"config";
pub const TICKET_SEED: &[u8] = b"vanity";
/// The card vault `["card", mint]` = pump `creator` (system-owned, 0 data, lamports only).
pub const CARD_VAULT_SEED: &[u8] = b"card";
pub const CARD_SEED: &[u8] = b"card-state";
pub const CARD_MINT_SEED: &[u8] = b"card-mint";
pub const BID_SEED: &[u8] = b"bid";
pub const LISTING_SEED: &[u8] = b"listing";
/// The `ObserverSet` PDA `["observers"]` (fix-plan §2.2, F1).
pub const OBSERVERS_SEED: &[u8] = b"observers";
/// The MintDex collection (F8): authority PDA `["collection"]` (never an account, signs `Verify` / the collection's
/// own `mint_to` and `CreateV1`) and the collection mint PDA `["collection-mint"]` (legacy SPL Token, decimals 0).
pub const COLLECTION_AUTHORITY_SEED: &[u8] = b"collection";
pub const COLLECTION_MINT_SEED: &[u8] = b"collection-mint";

// pump / pAMM seeds (pump-devnet-facts §3; note the hyphen vs underscore in the two creator vaults)
pub const PUMP_BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const PUMP_CREATOR_VAULT_SEED: &[u8] = b"creator-vault";
pub const PUMP_POOL_AUTHORITY_SEED: &[u8] = b"pool-authority";
pub const PAMM_POOL_SEED: &[u8] = b"pool";
pub const PAMM_CREATOR_VAULT_SEED: &[u8] = b"creator_vault";

// ---------------------------------------------------------------- flags

/// `Config.paused` bits (§4.1). Never pausable: cancel_bid, delist_card, close_expired_listing, collect_fees,
/// withdraw_fees.
pub const PAUSE_REGISTER: u8 = 1;
pub const PAUSE_EVOLVE: u8 = 2;
pub const PAUSE_MARKET: u8 = 4;
pub const PAUSE_ALL: u8 = PAUSE_REGISTER | PAUSE_EVOLVE | PAUSE_MARKET;

/// `Config.sweep_flags` bits (§4.1, §7.4).
pub const SWEEP_CURVE: u8 = 1;
pub const SWEEP_AMM: u8 = 2;
pub const SWEEP_VAULT_WSOL: u8 = 4;
pub const SWEEP_ALL: u8 = SWEEP_CURVE | SWEEP_AMM | SWEEP_VAULT_WSOL;

/// `Config.price_source` values (§4.1).
pub const PRICE_SOURCE_ADMIN: u8 = 0;
pub const PRICE_SOURCE_PYTH: u8 = 1;

/// `Card.flags` bits (§4.2).
pub const CARD_GRADUATED: u8 = 1;
pub const CARD_CREATOR_LOST: u8 = 2;
pub const CARD_FEES_CHANGED: u8 = 4;
pub const CARD_LEGACY: u8 = 8;
/// The card NFT carries Metaplex Token Metadata (metadata + master edition, `register_card_metaplex`, §18.17) instead
/// of Token-2022's TokenMetadata extension: `evolve` rewrites the Metaplex URI.
pub const CARD_METAPLEX: u8 = 16;
/// Verified into the MintDex collection at registration (F8; informational: metadata rewrites copy the collection
/// field verbatim whatever this bit says).
pub const CARD_COLLECTION: u8 = 32;

/// `ObserverSet.roles[i]` bits (F1, admin B12): COUNT may open, count and confirm a window in attested mode (implies
/// CAP), CAP may observe with a level cap (lower or clear only without COUNT), PAUSE may add the EVOLVE pause bit.
pub const ROLE_COUNT: u8 = 1;
pub const ROLE_CAP: u8 = 2;
pub const ROLE_PAUSE: u8 = 4;
pub const ROLE_ALL: u8 = ROLE_COUNT | ROLE_CAP | ROLE_PAUSE;
/// Slots in the `ObserverSet` (the slot index is the witness bit).
pub const MAX_OBSERVERS: usize = 8;

/// `Config.register_flags` bits (F9, F8): bit0 disables `register_card` (Token-2022 cards), bit1 makes the MintDex
/// collection mandatory in `register_card_metaplex`.
pub const REG_NO_TOKEN2022: u8 = 1;
pub const REG_REQUIRE_COLLECTION: u8 = 2;
pub const REG_ALL: u8 = REG_NO_TOKEN2022 | REG_REQUIRE_COLLECTION;

/// `ConfigExtParams.mask` bits (admin B7): only the masked fields are written.
pub const EXT_REGISTER_FLAGS: u8 = 1;
pub const EXT_OUTSIDE_ROYALTY: u8 = 2;
pub const EXT_TICKET_AUTHORITY: u8 = 4;
pub const EXT_TICKET_ALLOWANCE: u8 = 8;
pub const EXT_ALL: u8 = EXT_REGISTER_FLAGS | EXT_OUTSIDE_ROYALTY | EXT_TICKET_AUTHORITY | EXT_TICKET_ALLOWANCE;

/// `Listing.flags` bits (§4.4).
pub const LISTING_VOID_ON_EVOLVE: u8 = 1;

/// `Ticket.flags` bits (§4.6).
pub const TICKET_LEGACY: u8 = 1;

/// `ListingClosed.reason` values (§9).
pub const LISTING_CLOSED_EXPIRED: u8 = 3;
pub const LISTING_CLOSED_SOLD_VIA_BID: u8 = 4;

// ---------------------------------------------------------------- limits

/// Program floor for `Config.evolve_hold_slots` (rev 1 removes single-step mode).
pub const HOLD_FLOOR_SLOTS: u32 = 150;
/// `PoolTooThin` floor: 1,000 tokens of 6 decimals (§5.2).
pub const POOL_MIN_BASE_AMOUNT: u64 = 1_000_000_000;
/// Bytes of each URI base stored in Config (§4.1).
pub const URI_BASE_MAX: usize = 64;
/// The card NFT symbol (§4.5).
pub const CARD_NFT_SYMBOL: &str = "MDXCARD";
/// Coin symbol bytes kept in the card name (§4.5, rev 1: cut on a char boundary).
pub const CARD_NAME_SYMBOL_MAX: usize = 10;
pub const CARD_NAME_SUFFIX: &str = " MintDex Card";
/// Upper bound for `Config.vanity_modulus`, so the §5.4 fold `r * 256 + b` can never overflow a u64.
pub const VANITY_MODULUS_MAX: u64 = 1 << 56;
/// Max age used when `update_config` records a Pyth price while `max_price_age_secs` is 0 (Admin mode).
pub const PYTH_RECORD_DEFAULT_MAX_AGE_SECS: u32 = 60;
/// `update_config` switching Pyth -> Admin must start within this many bps of the last Pyth price (§7.1).
pub const ADMIN_SWITCH_MAX_DEVIATION_BPS: u64 = 1_000;
/// Most (mint, ticket) pairs `issue_tickets` accepts in one call.
pub const MAX_TICKETS_PER_IX: usize = 32;
/// Metaplex `seller_fee_basis_points` ceiling for collection cards (F8, D9).
pub const OUTSIDE_ROYALTY_MAX_BPS: u16 = 1_000;
/// `Config.launch_fee` ceiling, 0.1 SOL (admin B3).
pub const LAUNCH_FEE_MAX: u64 = 100_000_000;
/// Under `price_source = Pyth`, `max_price_age_secs` must be 1..=300 (F3 bound).
pub const PYTH_MAX_AGE_CAP_SECS: u32 = 300;
/// With `tier_guard` on, the admin's `set_price` (Admin source) stays within these bands of the last Pyth price
/// (admin B1): at most +10%, at least -50%.
pub const ADMIN_PRICE_MAX_ABOVE_PYTH_BPS: u64 = 1_000;
pub const ADMIN_PRICE_MAX_BELOW_PYTH_BPS: u64 = 5_000;
/// With `tier_guard` on: the price interval floor and step ceiling every config must keep (admin §3.4 step 3), and the
/// Admin-source staleness rule `max_price_age_secs == 0 || >= min_price_interval_secs + GUARD_MAX_AGE_MARGIN_SECS`
/// (admin B8).
pub const GUARD_MIN_PRICE_INTERVAL_SECS: u32 = 60;
pub const GUARD_MAX_PRICE_STEP_BPS: u16 = 2_000;
pub const GUARD_MAX_AGE_MARGIN_SECS: u32 = 60;

// ---------------------------------------------------------------- precomputed PDAs (unit-tested against find_program_address)

/// MintDex's ProgramData under the upgradeable loader: `PDA([program id], BPFLoaderUpgradeab1e…)` (bump 252). Its upgrade
/// authority field is what `set_observers` reads for the upgrade-authority path (an optional account whose key were the
/// program id itself would read as `None` in Anchor, so the program account is not used there).
pub const PROGRAM_DATA_ADDRESS: Pubkey = pubkey!("5pm5stfQtipce3HLyGmnZ38Se5hY98uqMKwhNrQoNzMA");
/// `["observers"]` under MintDex (bump 254).
pub const OBSERVER_SET_ADDRESS: Pubkey = pubkey!("8WB8k8ktzztm3KRf4rDqsJ6BTtdQb9EWfAWBs47hcvFX");
pub const OBSERVER_SET_BUMP: u8 = 254;
/// `["collection"]` under MintDex.
pub const COLLECTION_AUTHORITY: Pubkey = pubkey!("ARZwArLCyWco84Bemkw7DVRfJ2gXkkFqeLVCQfpHoGE2");
pub const COLLECTION_AUTHORITY_BUMP: u8 = 255;
/// `["collection-mint"]` under MintDex.
pub const COLLECTION_MINT: Pubkey = pubkey!("8dY2mDDyJDEpVRRqhbd3UXqfTVTrgdatHMW9eMfA5X7L");
/// Metaplex metadata and master edition of `COLLECTION_MINT`.
pub const COLLECTION_METADATA: Pubkey = pubkey!("81ZLAWMKnJywdTBJWCE1KmjmHBrAfvXvDvJNsYQD8vVa");
pub const COLLECTION_EDITION: Pubkey = pubkey!("7qUPEf9mvh3Z8ncJ1KcCrCJreSXwmun32JMMqdUL1D81");
/// The collection NFT's URI is exactly `card_uri_base ‖ COLLECTION_URI_SUFFIX` (admin B14).
pub const COLLECTION_URI_SUFFIX: &str = "collection.json";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precomputed_pdas_match_their_seeds() {
        let mpl = crate::mpl::MPL_TOKEN_METADATA_PROGRAM_ID;
        assert_eq!(Pubkey::find_program_address(&[OBSERVERS_SEED], &crate::ID), (OBSERVER_SET_ADDRESS, OBSERVER_SET_BUMP));
        assert_eq!(
            Pubkey::find_program_address(&[crate::ID.as_ref()], &crate::instructions::admin::upgradeable::LOADER_ID).0,
            PROGRAM_DATA_ADDRESS
        );
        assert_eq!(
            Pubkey::find_program_address(&[COLLECTION_AUTHORITY_SEED], &crate::ID),
            (COLLECTION_AUTHORITY, COLLECTION_AUTHORITY_BUMP)
        );
        assert_eq!(Pubkey::find_program_address(&[COLLECTION_MINT_SEED], &crate::ID).0, COLLECTION_MINT);
        assert_eq!(
            Pubkey::find_program_address(&[b"metadata", mpl.as_ref(), COLLECTION_MINT.as_ref()], &mpl).0,
            COLLECTION_METADATA
        );
        assert_eq!(
            Pubkey::find_program_address(&[b"metadata", mpl.as_ref(), COLLECTION_MINT.as_ref(), b"edition"], &mpl).0,
            COLLECTION_EDITION
        );
        assert_eq!(crate::mpl::metadata_pda(&COLLECTION_MINT), COLLECTION_METADATA);
        assert_eq!(crate::mpl::master_edition_pda(&COLLECTION_MINT), COLLECTION_EDITION);
        // the sponsored SOL/USD feed: push-oracle PDA [shard 0u16 LE, feed id]
        assert_eq!(
            Pubkey::find_program_address(&[&0u16.to_le_bytes(), &SOL_USD_FEED_ID], &PYTH_PUSH_ORACLE_ID).0,
            PYTH_SOL_USD_FEED
        );
    }
}
