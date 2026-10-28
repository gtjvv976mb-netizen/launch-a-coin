//! The MintDex collection NFT and the metadata syncs (mainnet fix pack F8; refs/mainnet/fix-plan.md §2.6 items 7 to 9,
//! design-admin.md §4).
//!
//! - `init_collection(name, uri)`, admin, once: a sized Metaplex collection NFT (legacy SPL Token mint PDA
//!   `["collection-mint"]`, its single token in the ATA of the authority PDA `["collection"]`, which is also the
//!   collection's update authority and signs only `Verify` for cards being registered). The URI must be exactly
//!   `card_uri_base ‖ "collection.json"`, so even a compromised admin cannot point the collection at another domain.
//! - `sync_card_metadata()`, permissionless: rewrites a Metaplex card's URI (from `card.level`) and royalty (from
//!   `Config.outside_royalty_bps`, cards with creators only) when they differ; name, symbol, creators and collection are
//!   copied verbatim. Reaches level-14 cards that never evolve again after a royalty or card-URI base change.
//! - `sync_collection_metadata()`, permissionless (admin B14): the collection's URI follows `card_uri_base`.
//!
//! The two syncs stop while EVOLVE is paused (they share the metadata write path with `evolve`).

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount};

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::CollectionCreated;
use crate::metadata::{base58_string, card_uri};
use crate::mpl;
use crate::state::{Card, Config};

/// The collection NFT's URI: `card_uri_base ‖ "collection.json"` ("collection" contains `l`, not a base58 character,
/// so it cannot collide with a card path).
pub fn collection_uri(card_uri_base: &[u8]) -> Vec<u8> {
    let mut u = card_uri_base.to_vec();
    u.extend_from_slice(COLLECTION_URI_SUFFIX.as_bytes());
    u
}

/// `init_collection` argument rules (`InvalidConfig`): a 1..=32-byte name and exactly the collection URI.
pub fn check_collection_args(name: &str, uri: &str, card_uri_base: &[u8]) -> Result<()> {
    require!(
        (1..=mpl::MAX_NAME_LEN).contains(&name.len())
            && uri.len() <= mpl::MAX_URI_LEN
            && uri.as_bytes() == collection_uri(card_uri_base).as_slice(),
        MintdexError::InvalidConfig
    );
    Ok(())
}

// ---------------------------------------------------------------- init_collection

#[event_cpi]
#[derive(Accounts)]
pub struct InitCollection<'info> {
    /// Pays every account and Metaplex's creation fee.
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MintdexError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the collection authority PDA `["collection"]` (never an account); signs `mint_to` and `CreateV1`.
    #[account(seeds = [COLLECTION_AUTHORITY_SEED], bump)]
    pub collection_authority: UncheckedAccount<'info>,
    /// The collection mint (legacy SPL Token, decimals 0); `init` makes a second call fail.
    #[account(
        init,
        payer = admin,
        seeds = [COLLECTION_MINT_SEED],
        bump,
        mint::decimals = 0,
        mint::authority = collection_authority,
        mint::freeze_authority = collection_authority,
        mint::token_program = token_program,
    )]
    pub collection_mint: Box<InterfaceAccount<'info, Mint>>,
    /// The collection token's home: ATA(collection authority, collection mint); no MintDex instruction moves it.
    #[account(
        init,
        payer = admin,
        associated_token::mint = collection_mint,
        associated_token::authority = collection_authority,
        associated_token::token_program = token_program,
    )]
    pub collection_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Metaplex metadata of the collection mint, created by the CPI.
    #[account(mut, address = COLLECTION_METADATA @ MintdexError::CollectionAccountMismatch)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex master edition of the collection mint, created by the CPI.
    #[account(mut, address = COLLECTION_EDITION @ MintdexError::CollectionAccountMismatch)]
    pub collection_edition: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: Metaplex Token Metadata.
    #[account(address = mpl::MPL_TOKEN_METADATA_PROGRAM_ID @ MintdexError::MetaplexAccountMismatch)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (Metaplex `CreateV1` requires it).
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

pub fn init_collection(ctx: Context<InitCollection>, name: String, uri: String) -> Result<()> {
    check_collection_args(&name, &uri, ctx.accounts.config.card_uri_base())?;
    let bump = ctx.bumps.collection_authority;
    let seeds: &[&[u8]] = &[COLLECTION_AUTHORITY_SEED, &[bump]];
    let authority = ctx.accounts.collection_authority.to_account_info();
    let token_program = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.collection_mint.to_account_info();
    token_interface::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            MintTo { mint: mint.clone(), to: ctx.accounts.collection_token.to_account_info(), authority: authority.clone() },
            &[seeds],
        ),
        1,
    )?;
    let data = mpl::create_v1_data_with(&mpl::AssetFields {
        name: &name,
        symbol: CARD_NFT_SYMBOL,
        uri: &uri,
        seller_fee_basis_points: 0,
        creators: None,
        primary_sale_happened: true,
        collection: None,
        sized_collection: true,
    });
    mpl::create_v1_with(
        mpl::CreateAccounts {
            metadata: &ctx.accounts.collection_metadata.to_account_info(),
            master_edition: &ctx.accounts.collection_edition.to_account_info(),
            mint: &mint,
            authority: &authority,
            payer: &ctx.accounts.admin.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
            sysvar_instructions: &ctx.accounts.sysvar_instructions.to_account_info(),
            spl_token_program: &token_program,
            token_metadata_program: &ctx.accounts.token_metadata_program.to_account_info(),
        },
        data,
        &[seeds],
    )?;
    crate::emit_event!(ctx, CollectionCreated { collection_mint: mint.key(), collection_metadata: COLLECTION_METADATA });
    Ok(())
}

// ---------------------------------------------------------------- sync_card_metadata

#[event_cpi]
#[derive(Accounts)]
pub struct SyncCardMetadata<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// CHECK: the Metaplex metadata PDA of `card.card_mint`.
    #[account(mut, address = mpl::metadata_pda(&card.card_mint) @ MintdexError::MetaplexAccountMismatch)]
    pub card_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex Token Metadata.
    #[account(address = mpl::MPL_TOKEN_METADATA_PROGRAM_ID @ MintdexError::MetaplexAccountMismatch)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

/// What a sync must write, if anything (pure): the target URI and royalty when either differs from the account.
pub fn sync_target(view: &mpl::MetadataView, target_uri: &[u8], outside_royalty_bps: u16) -> Option<u16> {
    let sfbp = if view.creators.is_some() { outside_royalty_bps } else { 0 };
    (view.uri != target_uri || view.seller_fee_basis_points != sfbp).then_some(sfbp)
}

pub fn sync_card_metadata(ctx: Context<SyncCardMetadata>) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let card = &ctx.accounts.card;
    require!(!cfg.is_paused(PAUSE_EVOLVE), MintdexError::Paused);
    require!(card.flags & CARD_METAPLEX != 0, MintdexError::MetaplexAccountMismatch);
    let md = ctx.accounts.card_metadata.to_account_info();
    // burned by its holder (Metaplex closed the metadata): nothing to sync
    if *md.owner != mpl::MPL_TOKEN_METADATA_PROGRAM_ID || md.data_is_empty() {
        return Ok(());
    }
    let uri = card_uri(cfg.card_uri_base(), &base58_string(&card.mint), card.level);
    let needed = {
        let d = md.try_borrow_data()?;
        let v = mpl::read_metadata(&d, &card.card_mint)?;
        sync_target(&v, uri.as_bytes(), cfg.outside_royalty_bps)
    };
    if needed.is_none() {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[CARD_SEED, card.mint.as_ref(), &[card.bump]];
    mpl::rewrite_metadata(
        &md,
        &card.card_mint,
        &card.to_account_info(),
        &ctx.accounts.token_metadata_program.to_account_info(),
        None,
        None,
        uri.as_bytes(),
        cfg.outside_royalty_bps,
        &[seeds],
    )
}

// ---------------------------------------------------------------- sync_collection_metadata

#[event_cpi]
#[derive(Accounts)]
pub struct SyncCollectionMetadata<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the collection authority PDA `["collection"]`: the collection's update authority (signs via seeds).
    #[account(seeds = [COLLECTION_AUTHORITY_SEED], bump)]
    pub collection_authority: UncheckedAccount<'info>,
    /// CHECK: the collection's Metaplex metadata.
    #[account(mut, address = COLLECTION_METADATA @ MintdexError::CollectionAccountMismatch)]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex Token Metadata.
    #[account(address = mpl::MPL_TOKEN_METADATA_PROGRAM_ID @ MintdexError::MetaplexAccountMismatch)]
    pub token_metadata_program: UncheckedAccount<'info>,
}

/// Rewrites the collection URI to `card_uri_base ‖ "collection.json"` when it differs (admin B14); name, symbol,
/// royalty, creators and collection are copied verbatim. No-op otherwise.
pub fn sync_collection_metadata(ctx: Context<SyncCollectionMetadata>) -> Result<()> {
    let cfg = &ctx.accounts.config;
    require!(!cfg.is_paused(PAUSE_EVOLVE), MintdexError::Paused);
    let md = ctx.accounts.collection_metadata.to_account_info();
    require!(
        *md.owner == mpl::MPL_TOKEN_METADATA_PROGRAM_ID && !md.data_is_empty(),
        MintdexError::CollectionAccountMismatch
    );
    let target = collection_uri(cfg.card_uri_base());
    let data = {
        let d = md.try_borrow_data()?;
        let v = mpl::read_metadata(&d, &COLLECTION_MINT)?;
        if v.uri == target.as_slice() {
            return Ok(());
        }
        mpl::update_metadata_v2_data_with(v.name, v.symbol, &target, v.seller_fee_basis_points, v.creators.as_deref(), v.collection.as_ref())
    };
    let seeds: &[&[u8]] = &[COLLECTION_AUTHORITY_SEED, &[ctx.bumps.collection_authority]];
    mpl::update_metadata_v2_with(
        &md,
        &ctx.accounts.collection_authority.to_account_info(),
        &ctx.accounts.token_metadata_program.to_account_info(),
        data,
        &[seeds],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::assert_error;

    #[test]
    fn collection_args() {
        let base = b"https://mintdex.fun/c/";
        assert_eq!(collection_uri(base), b"https://mintdex.fun/c/collection.json".to_vec());
        check_collection_args("MintDex Cards", "https://mintdex.fun/c/collection.json", base).unwrap();
        for (name, uri) in [
            ("", "https://mintdex.fun/c/collection.json"),
            (&"x".repeat(33)[..], "https://mintdex.fun/c/collection.json"),
            ("MintDex Cards", "https://evil.example/c/collection.json"),
            ("MintDex Cards", "https://mintdex.fun/c/collection.json?x"),
            ("MintDex Cards", "https://mintdex.fun/c/"),
        ] {
            assert_error(check_collection_args(name, uri, base), MintdexError::InvalidConfig);
        }
        check_collection_args(&"x".repeat(32), "https://mintdex.fun/c/collection.json", base).unwrap();
    }

    #[test]
    fn sync_targets() {
        let view = |uri: &'static [u8], sfbp: u16, creators: bool| mpl::MetadataView {
            update_authority: Pubkey::default(),
            mint: Pubkey::default(),
            name: b"A",
            symbol: b"MDXCARD",
            uri,
            seller_fee_basis_points: sfbp,
            creators: creators.then(|| vec![mpl::Creator { address: Pubkey::default(), verified: false, share: 100 }]),
            primary_sale_happened: true,
            is_mutable: true,
            token_standard: Some(0),
            collection: None,
        };
        // up to date: no CPI
        assert_eq!(sync_target(&view(b"u?l=3", 0, false), b"u?l=3", 500), None);
        assert_eq!(sync_target(&view(b"u?l=3", 500, true), b"u?l=3", 500), None);
        // a royalty change reaches cards with creators only
        assert_eq!(sync_target(&view(b"u?l=3", 0, true), b"u?l=3", 500), Some(500));
        assert_eq!(sync_target(&view(b"u?l=3", 0, false), b"u?l=3", 500), None);
        // a URI change (card URI base or level)
        assert_eq!(sync_target(&view(b"old?l=3", 0, false), b"u?l=3", 500), Some(0));
    }
}
