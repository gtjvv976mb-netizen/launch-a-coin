//! `register_card` (card-program-v2 §7.2), run in the launch tx right after pump `create_v2`.
//!
//! Gates: the admin-issued `["vanity", mint]` ticket (consumed), the coin URI bound to
//! `coin_uri_base ‖ mint ‖ ".json"` (LEGACY tickets skip it), the mint key's signature, the cosmetic "…mint"
//! suffix, and the pump curve checks (`creator == ["card", mint]`, no mayhem / cashback / non-SOL quote /
//! custom creator fee / holder reward). Effects: launch fee, `Card` at level 1, the Token-2022 card NFT
//! (MetadataPointer + TokenMetadata, mint authority removed, no freeze authority), and the ticket closed to the
//! treasury after the last CPI that carries the launcher or the treasury (card-program-v2 §18.13: they may be the
//! same account).

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_interface::{
    self, token_metadata_initialize, token_metadata_update_field, Mint, MintTo, SetAuthority, Token2022, TokenAccount,
    TokenMetadataInitialize, TokenMetadataUpdateField,
};
use spl_token_metadata_interface::state::Field;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::CardRegistered;
use crate::math::{passes_vanity, CARD_MINT_HEADROOM, MAX_LEVEL};
use crate::metadata::{base58_string, bound_uri_matches, card_mint_len, card_name, card_uri, parse_coin_metadata};
use crate::mpl;
use crate::pump;
use crate::state::{Card, Config, Ticket};
use crate::utils::{close_account, pay, top_up_rent_for, top_up_to_len};

#[event_cpi]
#[derive(Accounts)]
pub struct RegisterCard<'info> {
    /// Fee payer, receives the card NFT, royalty recipient.
    #[account(mut)]
    pub launcher: Signer<'info>,
    /// The coin mint. The server-held vanity key signs (gate 3). Its TokenMetadata is read in the handler.
    pub mint: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: `config.treasury`; receives the launch fee and the ticket rent.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: `["vanity", mint]`. Parsed in the handler so a missing ticket fails with `TicketMissing`
    /// (owner MintDex + `Ticket` discriminator), then closed to the treasury.
    #[account(mut, seeds = [TICKET_SEED, mint.key().as_ref()], bump)]
    pub ticket: UncheckedAccount<'info>,
    /// CHECK: §5.1: address here; owner, discriminator, length and the coin checks in the handler.
    #[account(address = pump::bonding_curve_pda(&mint.key()) @ MintdexError::CurveMismatch)]
    pub bonding_curve: UncheckedAccount<'info>,
    #[account(init, payer = launcher, space = Card::LEN, seeds = [CARD_SEED, mint.key().as_ref()], bump)]
    pub card: Box<Account<'info, Card>>,
    #[account(
        init,
        payer = launcher,
        seeds = [CARD_MINT_SEED, mint.key().as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = card,
        mint::token_program = token_2022_program,
        extensions::metadata_pointer::authority = card,
        extensions::metadata_pointer::metadata_address = card_mint,
    )]
    pub card_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = launcher,
        associated_token::mint = card_mint,
        associated_token::authority = launcher,
        associated_token::token_program = token_2022_program,
    )]
    pub launcher_card_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// `TicketMissing` unless the account is a MintDex `Ticket`; returns its flags.
fn read_ticket(ticket: &AccountInfo) -> Result<u8> {
    require!(
        *ticket.owner == crate::ID && ticket.data_len() >= Ticket::LEN,
        MintdexError::TicketMissing
    );
    let data = ticket.try_borrow_data()?;
    require!(&data[..8] == Ticket::DISCRIMINATOR, MintdexError::TicketMissing);
    Ok(data[9])
}

/// What the registration gates found (shared by `register_card` and `register_card_metaplex`).
struct Registration {
    legacy: bool,
    /// The card NFT name `"{SYMBOL} MintDex Card"`, SYMBOL read from the coin's own TokenMetadata.
    name: String,
    vault: Pubkey,
    vault_bump: u8,
}

/// F9: `register_card` (Token-2022 cards) is disabled while `register_flags` bit0 is set (`CardStandardDisabled`).
pub fn check_standard(register_flags: u8, metaplex: bool) -> Result<()> {
    require!(metaplex || register_flags & REG_NO_TOKEN2022 == 0, MintdexError::CardStandardDisabled);
    Ok(())
}

/// F8 remaining-account rule of `register_card_metaplex` (design-admin §4.2): none → today's path (refused while
/// `register_flags` bit1 requires the collection); exactly `[COLLECTION_AUTHORITY, COLLECTION_MINT,
/// COLLECTION_METADATA (writable), COLLECTION_EDITION]` → the collection path; anything else
/// `CollectionAccountMismatch`. Returns whether the collection path runs.
pub fn collection_path(remaining: &[(Pubkey, bool)], register_flags: u8) -> Result<bool> {
    if remaining.is_empty() {
        require!(register_flags & REG_REQUIRE_COLLECTION == 0, MintdexError::CollectionAccountMismatch);
        return Ok(false);
    }
    let ok = remaining.len() == 4
        && remaining[0].0 == COLLECTION_AUTHORITY
        && remaining[1].0 == COLLECTION_MINT
        && remaining[2] == (COLLECTION_METADATA, true)
        && remaining[3].0 == COLLECTION_EDITION;
    require!(ok, MintdexError::CollectionAccountMismatch);
    Ok(true)
}

/// Gates 1 to 4 of §7.2 in this order: pause, the card standard (F9), the ticket, the coin's TokenMetadata and bound
/// URI, the vanity suffix, the pump curve (`creator == ["card", mint]`, coin type checks).
fn check_registration(
    cfg: &Config,
    mint: &AccountInfo,
    ticket: &AccountInfo,
    bonding_curve: &AccountInfo,
    metaplex: bool,
) -> Result<Registration> {
    require!(!cfg.is_paused(PAUSE_REGISTER), MintdexError::Paused);
    check_standard(cfg.register_flags, metaplex)?;
    let mint_key = mint.key();

    // Gate 1: the admin-issued ticket.
    let legacy = read_ticket(ticket)? & TICKET_LEGACY != 0;

    // The coin mint is Token-2022 with TokenMetadata; gate 2: the bound URI (unless LEGACY).
    require!(*mint.owner == TOKEN_2022_PROGRAM_ID, MintdexError::NotTokenMetadataMint);
    let name = {
        let data = mint.try_borrow_data()?;
        let md = parse_coin_metadata(&data)?;
        require!(md.mint == mint_key, MintdexError::NotTokenMetadataMint);
        if !legacy {
            // pump makes the URI immutable (no update authority); the binding relies on that
            require!(
                md.update_authority == Pubkey::default() && bound_uri_matches(md.uri, cfg.coin_uri_base(), &mint_key),
                MintdexError::CoinUriMismatch
            );
        }
        let symbol = core::str::from_utf8(md.symbol).map_err(|_| error!(MintdexError::NotTokenMetadataMint))?;
        card_name(symbol)
    };

    // Cosmetic "…mint" filter (§5.4).
    require!(
        passes_vanity(&mint_key.to_bytes(), cfg.vanity_modulus, cfg.vanity_residue),
        MintdexError::NotMintdexMint
    );

    // The curve: §5.1 + creator == ["card", mint] + coin type checks.
    let (vault, vault_bump) = pump::card_vault_pda(&mint_key);
    {
        let data = bonding_curve.try_borrow_data()?;
        let c = pump::read_curve(bonding_curve.key, bonding_curve.owner, &data, &mint_key)?;
        pump::check_registrable(&c, &vault)?;
    }
    Ok(Registration { legacy, name, vault, vault_bump })
}

/// Effect 3 of §7.2: the `Card` at level 1 (never from the launch-time market cap).
fn init_card(card: &mut Card, r: &Registration, bumps: (u8, u8), mint: Pubkey, card_mint: Pubkey, launcher: Pubkey, now: i64, extra_flags: u8) {
    card.version = Card::VERSION;
    card.bump = bumps.0;
    card.vault_bump = r.vault_bump;
    card.card_mint_bump = bumps.1;
    card.level = 1;
    card.pending_level = 0;
    card.flags = if r.legacy { CARD_LEGACY } else { 0 } | extra_flags;
    card.pending_obs = 0;
    card.mint = mint;
    card.card_mint = card_mint;
    card.launcher = launcher;
    card.pool = Pubkey::default();
    card.pending_since_slot = 0;
    card.registered_at = now;
    card.evolved_at = 0;
    card.peak_mcap_lamports = 0;
    card.peak_mcap_usd_e6 = 0;
    card.fees_paid_out = 0;
    card.last_sale_price = 0;
    card.sales = 0;
    card.pending_last_slot = 0;
    card.pending_hwm_until = 0;
    card.pending_hwm_level = 0;
    card.pending_observers = 0;
    card.pending_epoch = 0;
    card.reserved = [0; 41];
}

pub fn register_card(ctx: Context<RegisterCard>) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let mint_key = ctx.accounts.mint.key();
    let reg = check_registration(
        cfg,
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.ticket.to_account_info(),
        &ctx.accounts.bonding_curve.to_account_info(),
        false,
    )?;
    let (legacy, name, vault) = (reg.legacy, reg.name.clone(), reg.vault);

    let launcher = ctx.accounts.launcher.to_account_info();
    let treasury = ctx.accounts.treasury.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    let token_program = ctx.accounts.token_2022_program.to_account_info();
    let card_info = ctx.accounts.card.to_account_info();
    let card_mint_info = ctx.accounts.card_mint.to_account_info();

    // 1. Launch fee (a system transfer, so it stays balanced when the launcher is the treasury).
    pay(&system, &launcher, &treasury, cfg.launch_fee)?;

    // 3. Card state at level 1 (never from the launch-time market cap).
    let now = Clock::get()?;
    let card_bump = ctx.bumps.card;
    let (card_mint_key, launcher_key) = (card_mint_info.key(), launcher.key());
    init_card(&mut ctx.accounts.card, &reg, (card_bump, ctx.bumps.card_mint), mint_key, card_mint_key, launcher_key, now.unix_timestamp, 0);

    // 4. The card NFT: metadata, fields, 1 token to the launcher, mint authority removed.
    let seeds: &[&[u8]] = &[CARD_SEED, mint_key.as_ref(), &[card_bump]];
    let signer = &[seeds];
    let mint_b58 = base58_string(&mint_key);
    let uri = card_uri(cfg.card_uri_base(), &mint_b58, 1);
    // Fund the final size up front (level 14: "14" in both the field and the URI), so every later evolve fits.
    let max_level_len = MAX_LEVEL.to_string().len();
    let final_len = card_mint_len(name.len(), uri.len() + max_level_len - 1, max_level_len, mint_b58.len());
    top_up_to_len(&card_mint_info, &launcher, &system, final_len)?;

    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_program.clone(),
            TokenMetadataInitialize {
                program_id: token_program.clone(),
                metadata: card_mint_info.clone(),
                update_authority: card_info.clone(),
                mint_authority: card_info.clone(),
                mint: card_mint_info.clone(),
            },
            signer,
        ),
        name,
        CARD_NFT_SYMBOL.to_string(),
        uri,
    )?;
    for (key, value) in [("level", "1".to_string()), ("coin", mint_b58)] {
        token_metadata_update_field(
            CpiContext::new_with_signer(
                token_program.clone(),
                TokenMetadataUpdateField {
                    program_id: token_program.clone(),
                    metadata: card_mint_info.clone(),
                    update_authority: card_info.clone(),
                },
                signer,
            ),
            Field::Key(key.to_string()),
            value,
        )?;
    }
    // safety net: current size + growth of "1" -> "14" in the field and the URI (a no-op after the prefund)
    top_up_rent_for(&card_mint_info, &launcher, &system, CARD_MINT_HEADROOM)?;

    token_interface::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            MintTo {
                mint: card_mint_info.clone(),
                to: ctx.accounts.launcher_card_account.to_account_info(),
                authority: card_info.clone(),
            },
            signer,
        ),
        1,
    )?;
    token_interface::set_authority(
        CpiContext::new_with_signer(
            token_program.clone(),
            SetAuthority { current_authority: card_info.clone(), account_or_mint: card_mint_info.clone() },
            signer,
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    // 2. Close the ticket to the treasury: a direct lamport move, so it runs after every CPI that carries the
    //    launcher or the treasury. A CPI syncs only its own accounts and the runtime then requires the lamport sum of
    //    this instruction's accounts to be unchanged; with launcher == treasury, a CPI after the close (the NFT
    //    top-ups) would carry the ticket rent on the launcher but not the ticket's matching decrease
    //    (`UnbalancedInstruction`, card-program-v2 §18.12 note 3 / §18.13). `emit_event!` carries only the event
    //    authority.
    close_account(&ctx.accounts.ticket.to_account_info(), &treasury)?;

    // 5.
    crate::emit_event!(ctx, CardRegistered {
        mint: mint_key,
        card_mint: card_mint_info.key(),
        vault,
        launcher: launcher.key(),
        legacy,
        slot: now.slot,
    });
    Ok(())
}

// ---------------------------------------------------------------- register_card_metaplex (§18.17)

#[event_cpi]
#[derive(Accounts)]
pub struct RegisterCardMetaplex<'info> {
    /// Fee payer, receives the card NFT, pays the Metaplex accounts and Metaplex's creation fee.
    #[account(mut)]
    pub launcher: Signer<'info>,
    /// The coin mint. The server-held vanity key signs (gate 3). Its TokenMetadata is read in the handler.
    pub mint: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: `config.treasury`; receives the launch fee and the ticket rent.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: `["vanity", mint]`, parsed in the handler (`TicketMissing`), then closed to the treasury.
    #[account(mut, seeds = [TICKET_SEED, mint.key().as_ref()], bump)]
    pub ticket: UncheckedAccount<'info>,
    /// CHECK: §5.1: address here; owner, discriminator, length and the coin checks in the handler.
    #[account(address = pump::bonding_curve_pda(&mint.key()) @ MintdexError::CurveMismatch)]
    pub bonding_curve: UncheckedAccount<'info>,
    #[account(init, payer = launcher, space = Card::LEN, seeds = [CARD_SEED, mint.key().as_ref()], bump)]
    pub card: Box<Account<'info, Card>>,
    /// The card NFT: Token-2022, decimals 0, MetadataPointer (no authority) -> the Metaplex metadata account, no
    /// TokenMetadata extension (Metaplex refuses it for a NonFungible). Mint and freeze authority start as the `card`
    /// PDA; Metaplex `CreateV1` moves both to the master edition PDA.
    #[account(
        init,
        payer = launcher,
        seeds = [CARD_MINT_SEED, mint.key().as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = card,
        mint::freeze_authority = card,
        mint::token_program = token_2022_program,
        extensions::metadata_pointer::metadata_address = card_metadata,
    )]
    pub card_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = launcher,
        associated_token::mint = card_mint,
        associated_token::authority = launcher,
        associated_token::token_program = token_2022_program,
    )]
    pub launcher_card_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Metaplex metadata PDA `["metadata", mpl, card_mint]`, created by the CPI.
    #[account(mut, address = mpl::metadata_pda(&card_mint.key()) @ MintdexError::MetaplexAccountMismatch)]
    pub card_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex master edition PDA `["metadata", mpl, card_mint, "edition"]`, created by the CPI.
    #[account(mut, address = mpl::master_edition_pda(&card_mint.key()) @ MintdexError::MetaplexAccountMismatch)]
    pub card_edition: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// CHECK: Metaplex Token Metadata.
    #[account(address = mpl::MPL_TOKEN_METADATA_PROGRAM_ID @ MintdexError::MetaplexAccountMismatch)]
    pub token_metadata_program: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (Metaplex `CreateV1` requires it).
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub sysvar_instructions: UncheckedAccount<'info>,
}

/// `register_card` with a Metaplex NonFungible card (§18.17): the same gates, launch fee, `Card` and ticket close,
/// then 1 token to the launcher and Metaplex `CreateV1` (metadata + master edition, max supply 0, update authority =
/// the `card` PDA, URI `{card_uri_base}{mint}.json?l=1`). `Card.flags` gets `CARD_METAPLEX`, so `evolve` rewrites the
/// Metaplex URI instead of Token-2022 fields.
///
/// F8: with the four MintDex collection accounts as remaining accounts the card is created with creators
/// `[launcher, treasury]` (unverified, `card_creators`), royalty `Config.outside_royalty_bps`, primary sale done and the
/// collection `COLLECTION_MINT`, then verified into the collection (Metaplex `Verify(CollectionV1)` signed by the
/// collection authority PDA); `Card.flags` also gets `CARD_COLLECTION`. Without them it is the pre-fix-pack card
/// (refused while `register_flags` bit1 requires the collection).
pub fn register_card_metaplex<'info>(ctx: Context<'_, '_, 'info, 'info, RegisterCardMetaplex<'info>>) -> Result<()> {
    let cfg = &ctx.accounts.config;
    let mint_key = ctx.accounts.mint.key();
    let reg = check_registration(
        cfg,
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.ticket.to_account_info(),
        &ctx.accounts.bonding_curve.to_account_info(),
        true,
    )?;
    let ra = ctx.remaining_accounts;
    let keys: Vec<(Pubkey, bool)> = ra.iter().map(|a| (*a.key, a.is_writable)).collect();
    let with_collection = collection_path(&keys, cfg.register_flags)?;
    let (legacy, vault) = (reg.legacy, reg.vault);

    let launcher = ctx.accounts.launcher.to_account_info();
    let treasury = ctx.accounts.treasury.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    let token_program = ctx.accounts.token_2022_program.to_account_info();
    let card_info = ctx.accounts.card.to_account_info();
    let card_mint_info = ctx.accounts.card_mint.to_account_info();

    // 1. Launch fee (a system transfer, so it stays balanced when the launcher is the treasury).
    pay(&system, &launcher, &treasury, cfg.launch_fee)?;

    // 3. Card state at level 1, flagged METAPLEX.
    let now = Clock::get()?;
    let card_bump = ctx.bumps.card;
    let (card_mint_key, launcher_key) = (card_mint_info.key(), launcher.key());
    init_card(
        &mut ctx.accounts.card,
        &reg,
        (card_bump, ctx.bumps.card_mint),
        mint_key,
        card_mint_key,
        launcher_key,
        now.unix_timestamp,
        CARD_METAPLEX | if with_collection { CARD_COLLECTION } else { 0 },
    );

    // 4. The card NFT: 1 token to the launcher while the card PDA is still the mint authority, then the Metaplex
    //    metadata + master edition (which take over the mint and freeze authorities; supply stays 1 forever).
    let seeds: &[&[u8]] = &[CARD_SEED, mint_key.as_ref(), &[card_bump]];
    let signer = &[seeds];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            MintTo {
                mint: card_mint_info.clone(),
                to: ctx.accounts.launcher_card_account.to_account_info(),
                authority: card_info.clone(),
            },
            signer,
        ),
        1,
    )?;
    let uri = card_uri(cfg.card_uri_base(), &base58_string(&mint_key), 1);
    let creators = if with_collection {
        Some(mpl::card_creators(&launcher_key, &treasury.key(), cfg.creator_royalty_bps, cfg.protocol_fee_bps))
    } else {
        None
    };
    let card_metadata = ctx.accounts.card_metadata.to_account_info();
    let sysvar_instructions = ctx.accounts.sysvar_instructions.to_account_info();
    let token_metadata_program = ctx.accounts.token_metadata_program.to_account_info();
    let data = mpl::create_v1_data_with(&mpl::AssetFields {
        name: &reg.name,
        symbol: CARD_NFT_SYMBOL,
        uri: &uri,
        seller_fee_basis_points: if with_collection { cfg.outside_royalty_bps } else { 0 },
        creators: creators.as_deref(),
        primary_sale_happened: with_collection,
        collection: with_collection.then_some(mpl::Collection { verified: false, key: COLLECTION_MINT }),
        sized_collection: false,
    });
    mpl::create_v1_with(
        mpl::CreateAccounts {
            metadata: &card_metadata,
            master_edition: &ctx.accounts.card_edition.to_account_info(),
            mint: &card_mint_info,
            authority: &card_info,
            payer: &launcher,
            system_program: &system,
            sysvar_instructions: &sysvar_instructions,
            spl_token_program: &token_program,
            token_metadata_program: &token_metadata_program,
        },
        data,
        signer,
    )?;
    if with_collection {
        // F8: verified into the sized MintDex collection by its authority PDA (carries neither launcher nor treasury)
        mpl::verify_collection_v1(
            mpl::VerifyCollectionAccounts {
                authority: &ra[0],
                metadata: &card_metadata,
                collection_mint: &ra[1],
                collection_metadata: &ra[2],
                collection_master_edition: &ra[3],
                system_program: &system,
                sysvar_instructions: &sysvar_instructions,
                token_metadata_program: &token_metadata_program,
            },
            &[&[COLLECTION_AUTHORITY_SEED, &[COLLECTION_AUTHORITY_BUMP]]],
        )?;
    }

    // 2. Close the ticket to the treasury after the last CPI that carries the launcher or the treasury (§18.13).
    close_account(&ctx.accounts.ticket.to_account_info(), &treasury)?;

    // 5.
    crate::emit_event!(ctx, CardRegistered {
        mint: mint_key,
        card_mint: card_mint_info.key(),
        vault,
        launcher: launcher.key(),
        legacy,
        slot: now.slot,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_utils::CpiLedger;

    // devnet rent (5,080 lamports per byte, 128-byte account overhead included): the ticket (10 B), Card (264 B), the
    // card NFT mint at Anchor init (MetadataPointer, 234 B) plus `top_up_to_len` to its final size (3,134,360 in
    // all for a 4-character symbol, §18.12 note 5), the launcher's card ATA (170 B)
    const TICKET: u64 = 701_040;
    const CARD: u64 = 1_991_360;
    const MINT_INIT: u64 = 1_838_960;
    const MINT_TOPUP: u64 = 1_295_400;
    const ATA: u64 = 1_513_840;
    const START: u64 = 7_000_000_000;

    /// `register_card`'s lamport steps in execution order (Anchor `init`s, then the handler) on the runtime model.
    /// `close_first` is the order before card-program-v2 §18.13: the ticket closed right after the launch fee.
    /// Account indices: launcher 0, treasury 1 (0 when `aliased`), ticket 2, card 3, card_mint 4, card ATA 5,
    /// system 6, event authority 7.
    fn register_flow(aliased: bool, close_first: bool, launch_fee: u64) -> Result<Vec<u64>, String> {
        let (launcher, treasury) = (0, if aliased { 0 } else { 1 });
        let (ticket, card, card_mint, ata, system, event_authority) = (2, 3, 4, 5, 6, 7);
        let mut l = CpiLedger::new(&[START, START, TICKET, 0, 0, 0, 1, 0]);
        // Anchor `init`: Card, the card NFT mint (+ its Token-2022 initialize CPI), the launcher's card ATA
        l.cpi(&[launcher, card, system], Some((launcher, card, CARD)))?;
        l.cpi(&[launcher, card_mint, system], Some((launcher, card_mint, MINT_INIT)))?;
        l.cpi(&[card_mint, card], None)?;
        l.cpi(&[launcher, ata, card_mint, system], Some((launcher, ata, ATA)))?;
        // the handler: 1. launch fee (`pay` skips the CPI when it is 0)
        if launch_fee > 0 {
            l.cpi(&[launcher, treasury, system], Some((launcher, treasury, launch_fee)))?;
        }
        if close_first {
            l.direct(ticket, treasury, TICKET);
        }
        // 4. `top_up_to_len`, `token_metadata_initialize`, 2 × `token_metadata_update_field`, `mint_to`,
        //    `set_authority` (`top_up_rent_for` is a no-op after the prefund: no CPI)
        l.cpi(&[launcher, card_mint, system], Some((launcher, card_mint, MINT_TOPUP)))?;
        for _ in 0..3 {
            l.cpi(&[card_mint, card], None)?;
        }
        l.cpi(&[card_mint, ata, card], None)?;
        l.cpi(&[card, card_mint], None)?;
        // 2. the ticket closes to the treasury (direct move), 5. `emit_event!`
        if !close_first {
            l.direct(ticket, treasury, TICKET);
        }
        l.cpi(&[event_authority], None)?;
        l.finish()
    }

    #[test]
    fn launcher_as_treasury_old_order_was_unbalanced() {
        // §18.12 note 3: the devnet simulation failed at the NFT top-up CPI, the launcher (= treasury) synced with the
        // ticket rent but the ticket not yet debited
        let e = register_flow(true, true, 0).unwrap_err();
        assert_eq!(e, format!("UnbalancedInstruction (off by {TICKET})"));
        // a launch fee changes nothing: the system transfer to itself is balanced
        assert_eq!(register_flow(true, true, 10_000_000).unwrap_err(), e);
        // with a separate treasury the old order was fine: neither the ticket nor the treasury is in a later CPI
        assert!(register_flow(false, true, 0).is_ok());
    }

    #[test]
    fn launcher_as_treasury_registers_and_keeps_the_ticket_rent() {
        let spent = CARD + MINT_INIT + MINT_TOPUP + ATA;
        for fee in [0, 10_000_000] {
            // launcher == treasury: the launch fee goes to itself and the ticket rent ends on the same account
            let b = register_flow(true, false, fee).unwrap();
            assert_eq!(b[0], START - spent + TICKET, "launch fee {fee}");
            assert_eq!(b[2], 0, "ticket emptied");
            assert_eq!((b[3], b[4], b[5]), (CARD, MINT_INIT + MINT_TOPUP, ATA));
            // separate treasury: fee + ticket rent to the treasury, the same result as the old order
            let s = register_flow(false, false, fee).unwrap();
            assert_eq!((s[0], s[1], s[2]), (START - spent - fee, START + fee + TICKET, 0));
            assert_eq!(s, register_flow(false, true, fee).unwrap());
        }
    }

    /// Pins the handler to the §18.13 order the model above checks: the ticket close (a direct lamport move) comes
    /// after every CPI site of `register_card`, and only `emit_event!` (event authority only) follows it.
    #[test]
    fn ticket_close_runs_after_the_last_cpi() {
        let src = include_str!("register.rs");
        let start = src.find("pub fn register_card(").unwrap();
        let body = &src[start..start + src[start..].find("\n}\n").unwrap()];
        assert_eq!(body.matches("close_account(").count(), 1);
        let close = body.find("close_account(&ctx.accounts.ticket").expect("the handler closes the ticket");
        let tail = &body[close..];
        for cpi in ["CpiContext", "invoke", "pay(", "top_up", "token_interface::", "token_metadata_"] {
            assert!(!tail.contains(cpi), "`{cpi}` after the ticket close");
        }
        assert!(tail.contains("emit_event!"));
        for cpi in [
            "pay(",
            "top_up_to_len(",
            "token_metadata_initialize(",
            "token_metadata_update_field(",
            "top_up_rent_for(",
            "mint_to(",
            "set_authority(",
        ] {
            assert!(body.rfind(cpi).expect(cpi) < close, "`{cpi}` must run before the ticket close");
        }
    }

    /// `register_card_metaplex`'s lamport steps (§18.17) on the runtime model: Anchor `init`s (Card, the card mint
    /// with MetadataPointer only, the card ATA), the launch fee, `mint_to`, Metaplex `CreateV1` (creation fee + metadata
    /// rent to the metadata account, edition rent to the edition, all from the launcher, plus the authority moves),
    /// then the ticket close and `emit_event!`. Indices: launcher 0, treasury 1 (0 when aliased), ticket 2, card 3,
    /// card_mint 4, card ATA 5, system 6, event authority 7, metadata 8, edition 9.
    fn register_metaplex_flow(aliased: bool, launch_fee: u64) -> Result<Vec<u64>, String> {
        const MD: u64 = 11_000_000; // metadata rent + Metaplex creation fee (devnet order of magnitude)
        const ED: u64 = 750_000;
        let (launcher, treasury) = (0, if aliased { 0 } else { 1 });
        let (ticket, card, card_mint, ata, system, event_authority, metadata, edition) = (2, 3, 4, 5, 6, 7, 8, 9);
        let mut l = CpiLedger::new(&[START, START, TICKET, 0, 0, 0, 1, 0, 0, 0]);
        l.cpi(&[launcher, card, system], Some((launcher, card, CARD)))?;
        l.cpi(&[launcher, card_mint, system], Some((launcher, card_mint, MINT_INIT)))?;
        l.cpi(&[card_mint, card], None)?;
        l.cpi(&[launcher, ata, card_mint, system], Some((launcher, ata, ATA)))?;
        if launch_fee > 0 {
            l.cpi(&[launcher, treasury, system], Some((launcher, treasury, launch_fee)))?;
        }
        l.cpi(&[card_mint, ata, card], None)?; // mint_to
        // CreateV1 (one CPI; its inner transfers are modelled one by one, each carrying the launcher)
        l.cpi(&[metadata, edition, card_mint, card, launcher, system], Some((launcher, metadata, MD)))?;
        l.cpi(&[metadata, edition, card_mint, card, launcher, system], Some((launcher, edition, ED)))?;
        l.direct(ticket, treasury, TICKET);
        l.cpi(&[event_authority], None)?;
        l.finish()
    }

    #[test]
    fn metaplex_register_balances_with_launcher_as_treasury() {
        for fee in [0, 10_000_000] {
            let b = register_metaplex_flow(true, fee).unwrap();
            assert_eq!(b[0], START - CARD - MINT_INIT - ATA - 11_000_000 - 750_000 + TICKET, "launch fee {fee}");
            let s = register_metaplex_flow(false, fee).unwrap();
            assert_eq!((s[1], s[2]), (START + fee + TICKET, 0));
        }
    }

    fn handler_body(src: &str, name: &str) -> String {
        let start = src.find(&format!("pub fn {name}(")).or_else(|| src.find(&format!("pub fn {name}<"))).unwrap();
        src[start..start + src[start..].find("\n}\n").unwrap()].to_string()
    }

    /// §18.17 + §18.13: `register_card_metaplex` mints the single token while the card PDA is still the mint
    /// authority (Metaplex `CreateV1` moves it to the master edition), and closes the ticket after its last CPI.
    #[test]
    fn metaplex_handler_order() {
        let body = handler_body(include_str!("register.rs"), "register_card_metaplex");
        let close = body.find("close_account(&ctx.accounts.ticket").expect("the handler closes the ticket");
        let tail = &body[close..];
        for cpi in ["CpiContext", "invoke", "pay(", "top_up", "token_interface::", "mpl::"] {
            assert!(!tail.contains(cpi), "`{cpi}` after the ticket close");
        }
        assert!(tail.contains("emit_event!"));
        let (pay, mint_to, create, verify) = (
            body.find("pay(").unwrap(),
            body.find("mint_to(").unwrap(),
            body.find("mpl::create_v1_with(").unwrap(),
            body.find("mpl::verify_collection_v1(").unwrap(),
        );
        assert!(pay < mint_to && mint_to < create && create < verify && verify < close);
        // no Token-2022 TokenMetadata on a Metaplex card (Metaplex refuses that extension for a NonFungible)
        assert!(!body.contains("token_metadata_initialize") && !body.contains("token_metadata_update_field"));
        assert!(body.contains("CARD_METAPLEX"));
    }

    /// F9: the standard gate (fix-plan §2.6).
    #[test]
    fn standard_gate_truth_table() {
        use super::check_standard;
        use crate::test_utils::assert_error;
        for flags in 0..=3u8 {
            check_standard(flags, true).unwrap(); // Metaplex is never disabled by bit0
            let t22 = check_standard(flags, false);
            if flags & 1 != 0 {
                assert_error(t22, crate::errors::MintdexError::CardStandardDisabled);
            } else {
                t22.unwrap();
            }
        }
    }

    /// F8: every row of the remaining-account table (design-admin §4.2).
    #[test]
    fn collection_remaining_account_rule() {
        use super::collection_path;
        use crate::constants::*;
        use crate::test_utils::assert_error;
        use anchor_lang::prelude::Pubkey;
        let good = [(COLLECTION_AUTHORITY, false), (COLLECTION_MINT, false), (COLLECTION_METADATA, true), (COLLECTION_EDITION, false)];
        assert!(!collection_path(&[], 0).unwrap());
        assert!(!collection_path(&[], REG_NO_TOKEN2022).unwrap());
        assert_error(collection_path(&[], REG_REQUIRE_COLLECTION), crate::errors::MintdexError::CollectionAccountMismatch);
        assert!(collection_path(&good, 0).unwrap());
        assert!(collection_path(&good, REG_ALL).unwrap());
        let mismatch = |v: &[(Pubkey, bool)]| assert_error(collection_path(v, 0), crate::errors::MintdexError::CollectionAccountMismatch);
        // 1 to 3 or 5 accounts
        for n in 1..4 {
            mismatch(&good[..n]);
        }
        let mut five = good.to_vec();
        five.push((Pubkey::new_unique(), false));
        mismatch(&five);
        // each address replaced by a look-alike; metadata read-only; two swapped
        for i in 0..4 {
            let mut v = good;
            v[i].0 = Pubkey::new_unique();
            mismatch(&v);
        }
        let mut ro = good;
        ro[2].1 = false;
        mismatch(&ro);
        let mut swapped = good;
        swapped.swap(0, 1);
        mismatch(&swapped);
    }

    /// The Metaplex card mint is initialised with exactly what Metaplex accepts for a NonFungible: MetadataPointer
    /// without authority to the metadata PDA, and a freeze authority (moved to the master edition by `CreateV1`).
    #[test]
    fn metaplex_card_mint_constraints() {
        let src = include_str!("register.rs");
        let s = &src[src.find("pub struct RegisterCardMetaplex").unwrap()..];
        let s = &s[..s.find("\n}\n").unwrap()];
        assert!(s.contains("mint::freeze_authority = card"));
        assert!(s.contains("extensions::metadata_pointer::metadata_address = card_metadata"));
        assert!(!s.contains("extensions::metadata_pointer::authority"));
        assert!(s.contains("address = mpl::metadata_pda(&card_mint.key())"));
        assert!(s.contains("address = mpl::master_edition_pda(&card_mint.key())"));
    }

}
