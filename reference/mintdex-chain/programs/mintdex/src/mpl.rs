//! Metaplex Token Metadata for the card NFT (card-program-v2 §18.17).
//!
//! Wallets (Phantom's Collectibles tab), DAS indexers, Magic Eden, Tensor and explorers recognise an NFT through its
//! Metaplex metadata account and master edition, not through Token-2022's own TokenMetadata extension. Metaplex
//! Token Metadata accepts a Token-2022 mint for a `NonFungible` asset only when the mint's extensions are a subset of
//! {MintCloseAuthority, NonTransferable, MetadataPointer}, the MetadataPointer has no authority and points at the
//! Metaplex metadata PDA, and the mint has a freeze authority (both authorities move to the master edition PDA)
//! (mpl-token-metadata `utils/token.rs::validate_mint`, `utils/mod.rs::transfer_mint_authority`; checked against the
//! program deployed on devnet, last deployed in slot 363,279,440). So a card registered with
//! `register_card_metaplex` has no Token-2022 TokenMetadata extension: its name, symbol and URI live in the Metaplex
//! metadata account, whose update authority is the `card` PDA so `evolve` can rewrite the URI.
//!
//! The two instructions are encoded here by hand (borsh, as mpl-token-metadata 1.14+ / `programs/token-metadata`
//! `instruction/mod.rs` defines them) instead of pulling the mpl crate and its dependency tree into the program.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

pub const MPL_TOKEN_METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

pub const METADATA_SEED: &[u8] = b"metadata";
pub const EDITION_SEED: &[u8] = b"edition";

/// `MetadataInstruction` variant indices (mpl-token-metadata `instruction/mod.rs`).
pub const IX_PUFF_METADATA: u8 = 14;
pub const IX_UPDATE_METADATA_ACCOUNT_V2: u8 = 15;
pub const IX_CREATE: u8 = 42;
/// `Verify(VerificationArgs)`; `VerificationArgs::CollectionV1 = 1` (F8).
pub const IX_VERIFY: u8 = 52;
pub const VERIFY_COLLECTION_V1: u8 = 1;
/// `Key::MetadataV1`.
pub const METADATA_KEY_V1: u8 = 4;
/// Metaplex limits (`state/metadata.rs`).
pub const MAX_CREATORS: usize = 5;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
/// `TokenStandard::NonFungible`.
pub const TOKEN_STANDARD_NON_FUNGIBLE: u8 = 0;
/// `PrintSupply::Zero`: a one-of-one master edition (max supply 0, no prints).
pub const PRINT_SUPPLY_ZERO: u8 = 0;

/// Offset of `Metadata.mint` in a Metaplex metadata account (key u8, update_authority).
pub const METADATA_MINT_OFFSET: usize = 1 + 32;

/// `["metadata", mpl, mint]` under Metaplex Token Metadata.
pub fn metadata_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[METADATA_SEED, MPL_TOKEN_METADATA_PROGRAM_ID.as_ref(), mint.as_ref()],
        &MPL_TOKEN_METADATA_PROGRAM_ID,
    )
    .0
}

/// `["metadata", mpl, mint, "edition"]`: the master edition (and, after `CreateV1`, the mint and freeze authority).
pub fn master_edition_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[METADATA_SEED, MPL_TOKEN_METADATA_PROGRAM_ID.as_ref(), mint.as_ref(), EDITION_SEED],
        &MPL_TOKEN_METADATA_PROGRAM_ID,
    )
    .0
}

fn put_str(out: &mut Vec<u8>, s: &[u8]) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s);
}

/// Metaplex `Creator { address, verified, share }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Creator {
    pub address: Pubkey,
    pub verified: bool,
    pub share: u8,
}

/// Metaplex `Collection { verified, key }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Collection {
    pub verified: bool,
    pub key: Pubkey,
}

fn put_creators(d: &mut Vec<u8>, creators: Option<&[Creator]>) {
    match creators {
        None => d.push(0),
        Some(cs) => {
            d.push(1);
            d.extend_from_slice(&(cs.len() as u32).to_le_bytes());
            for c in cs {
                d.extend_from_slice(c.address.as_ref());
                d.push(c.verified as u8);
                d.push(c.share);
            }
        }
    }
}

fn put_collection(d: &mut Vec<u8>, collection: Option<&Collection>) {
    match collection {
        None => d.push(0),
        Some(c) => {
            d.push(1);
            d.push(c.verified as u8);
            d.extend_from_slice(c.key.as_ref());
        }
    }
}

/// The `AssetData` fields MintDex varies in a `CreateV1` (everything else is fixed: mutable, NonFungible, no uses,
/// no rule set, decimals None, print supply Zero).
pub struct AssetFields<'a> {
    pub name: &'a str,
    pub symbol: &'a str,
    pub uri: &'a str,
    pub seller_fee_basis_points: u16,
    pub creators: Option<&'a [Creator]>,
    pub primary_sale_happened: bool,
    pub collection: Option<Collection>,
    /// `collection_details: Some(V1 { size: 0 })` (a sized collection parent, F8).
    pub sized_collection: bool,
}

/// `Create(CreateArgs::V1 { asset_data, decimals: None, print_supply: Some(PrintSupply::Zero) })`.
pub fn create_v1_data_with(a: &AssetFields) -> Vec<u8> {
    let mut d = Vec::with_capacity(2 + 12 + a.name.len() + a.symbol.len() + a.uri.len() + 24 + 34 * MAX_CREATORS + 34 + 10);
    d.push(IX_CREATE);
    d.push(0); // CreateArgs::V1
    put_str(&mut d, a.name.as_bytes());
    put_str(&mut d, a.symbol.as_bytes());
    put_str(&mut d, a.uri.as_bytes());
    d.extend_from_slice(&a.seller_fee_basis_points.to_le_bytes());
    put_creators(&mut d, a.creators);
    d.push(a.primary_sale_happened as u8);
    d.push(1); // is_mutable: true
    d.push(TOKEN_STANDARD_NON_FUNGIBLE);
    put_collection(&mut d, a.collection.as_ref());
    d.push(0); // uses: None
    if a.sized_collection {
        d.extend_from_slice(&[1, 0]); // collection_details: Some(CollectionDetails::V1 { size: 0 })
        d.extend_from_slice(&0u64.to_le_bytes());
    } else {
        d.push(0); // collection_details: None
    }
    d.push(0); // rule_set: None
    d.push(0); // decimals: None (the mint already exists)
    d.extend_from_slice(&[1, PRINT_SUPPLY_ZERO]); // print_supply: Some(Zero)
    d
}

/// `Create(CreateArgs::V1 { asset_data, decimals: None, print_supply: Some(PrintSupply::Zero) })` with
/// `AssetData { name, symbol, uri, seller_fee_basis_points: 0, creators: None, primary_sale_happened: false,
/// is_mutable: true, token_standard: NonFungible, collection: None, uses: None, collection_details: None,
/// rule_set: None }` (cards registered without the collection, as before the fix pack).
pub fn create_v1_data(name: &str, symbol: &str, uri: &str) -> Vec<u8> {
    create_v1_data_with(&AssetFields {
        name,
        symbol,
        uri,
        seller_fee_basis_points: 0,
        creators: None,
        primary_sale_happened: false,
        collection: None,
        sized_collection: false,
    })
}

/// `UpdateMetadataAccountV2 { data: Some(DataV2 { name, symbol, uri, seller_fee_basis_points, creators, collection,
/// uses: None }), update_authority: None, primary_sale_happened: None, is_mutable: None }`.
pub fn update_metadata_v2_data_with(
    name: &[u8],
    symbol: &[u8],
    uri: &[u8],
    seller_fee_basis_points: u16,
    creators: Option<&[Creator]>,
    collection: Option<&Collection>,
) -> Vec<u8> {
    let mut d = Vec::with_capacity(2 + 12 + name.len() + symbol.len() + uri.len() + 8 + 34 * MAX_CREATORS + 34);
    d.push(IX_UPDATE_METADATA_ACCOUNT_V2);
    d.push(1); // data: Some
    put_str(&mut d, name);
    put_str(&mut d, symbol);
    put_str(&mut d, uri);
    d.extend_from_slice(&seller_fee_basis_points.to_le_bytes());
    put_creators(&mut d, creators);
    put_collection(&mut d, collection);
    d.push(0); // uses: None
    d.push(0); // update_authority: None
    d.push(0); // primary_sale_happened: None
    d.push(0); // is_mutable: None
    d
}

/// `UpdateMetadataAccountV2` with no creators, no collection and royalty 0 (the bytes `evolve` sent before the fix
/// pack; a card without creators or collection still gets exactly these, pinned by a unit test).
pub fn update_metadata_v2_data(name: &str, symbol: &str, uri: &str) -> Vec<u8> {
    update_metadata_v2_data_with(name.as_bytes(), symbol.as_bytes(), uri.as_bytes(), 0, None, None)
}

/// The fields of a Metaplex `Metadata` account MintDex reads (F8). Strings are the stored bytes with Metaplex's NUL
/// padding trimmed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataView<'a> {
    pub update_authority: Pubkey,
    pub mint: Pubkey,
    pub name: &'a [u8],
    pub symbol: &'a [u8],
    pub uri: &'a [u8],
    pub seller_fee_basis_points: u16,
    pub creators: Option<Vec<Creator>>,
    pub primary_sale_happened: bool,
    pub is_mutable: bool,
    pub token_standard: Option<u8>,
    pub collection: Option<Collection>,
}

fn trim_nul(b: &[u8]) -> &[u8] {
    let end = b.iter().rposition(|c| *c != 0).map_or(0, |i| i + 1);
    &b[..end]
}

/// Bounds-checked borsh reader over a Metaplex account (any failure = `MetaplexAccountMismatch`).
struct Reader<'a> {
    d: &'a [u8],
    o: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.o.checked_add(n).filter(|e| *e <= self.d.len()).ok_or_else(|| error!(crate::errors::MintdexError::MetaplexAccountMismatch))?;
        let b = &self.d[self.o..end];
        self.o = end;
        Ok(b)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn bool(&mut self) -> Result<bool> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => err!(crate::errors::MintdexError::MetaplexAccountMismatch),
        }
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn key(&mut self) -> Result<Pubkey> {
        Ok(Pubkey::new_from_array(self.take(32)?.try_into().unwrap()))
    }
    fn string(&mut self, max: usize) -> Result<&'a [u8]> {
        let n = self.u32()? as usize;
        let b = trim_nul(self.take(n)?);
        require!(b.len() <= max, crate::errors::MintdexError::MetaplexAccountMismatch);
        Ok(b)
    }
}

/// Parses a Metaplex `Metadata` account up to its `collection` field: `key (= MetadataV1)`, `update_authority`,
/// `mint (= card_mint)`, `name`, `symbol`, `uri`, `seller_fee_basis_points`, `creators` (≤ 5), `primary_sale_happened`,
/// `is_mutable`, `edition_nonce`, `token_standard`, `collection`.
pub fn read_metadata<'a>(data: &'a [u8], card_mint: &Pubkey) -> Result<MetadataView<'a>> {
    use crate::errors::MintdexError;
    let mut r = Reader { d: data, o: 0 };
    require!(r.u8()? == METADATA_KEY_V1, MintdexError::MetaplexAccountMismatch);
    let update_authority = r.key()?;
    let mint = r.key()?;
    require!(mint == *card_mint, MintdexError::MetaplexAccountMismatch);
    let name = r.string(MAX_NAME_LEN)?;
    let symbol = r.string(MAX_SYMBOL_LEN)?;
    let uri = r.string(MAX_URI_LEN)?;
    let seller_fee_basis_points = u16::from_le_bytes(r.take(2)?.try_into().unwrap());
    let creators = if r.bool()? {
        let n = r.u32()? as usize;
        require!(n <= MAX_CREATORS, MintdexError::MetaplexAccountMismatch);
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            v.push(Creator { address: r.key()?, verified: r.bool()?, share: r.u8()? });
        }
        Some(v)
    } else {
        None
    };
    let primary_sale_happened = r.bool()?;
    let is_mutable = r.bool()?;
    if r.bool()? {
        r.u8()?; // edition_nonce
    }
    let token_standard = if r.bool()? { Some(r.u8()?) } else { None };
    let collection = if r.bool()? { Some(Collection { verified: r.bool()?, key: r.key()? }) } else { None };
    Ok(MetadataView {
        update_authority,
        mint,
        name,
        symbol,
        uri,
        seller_fee_basis_points,
        creators,
        primary_sale_happened,
        is_mutable,
        token_standard,
        collection,
    })
}

/// F8 creators of a collection card: the launcher and the treasury, splitting 100 in the ratio of the MintDex sale
/// split (`round(100 × royalty / (royalty + protocol))` to the launcher), all unverified; a zero share is dropped;
/// no fees or `launcher == treasury` → the treasury alone (Metaplex refuses duplicate creators).
pub fn card_creators(launcher: &Pubkey, treasury: &Pubkey, royalty_bps: u16, protocol_bps: u16) -> Vec<Creator> {
    let (r, p) = (royalty_bps as u32, protocol_bps as u32);
    let alone = || vec![Creator { address: *treasury, verified: false, share: 100 }];
    if r + p == 0 || launcher == treasury {
        return alone();
    }
    let sl = ((100 * r + (r + p) / 2) / (r + p)) as u8;
    match sl {
        0 => alone(),
        100 => vec![Creator { address: *launcher, verified: false, share: 100 }],
        _ => vec![
            Creator { address: *launcher, verified: false, share: sl },
            Creator { address: *treasury, verified: false, share: 100 - sl },
        ],
    }
}

/// The accounts of Metaplex `CreateV1` for an existing mint (mpl-token-metadata `instruction/metadata.rs`).
pub struct CreateAccounts<'a, 'info> {
    pub metadata: &'a AccountInfo<'info>,
    pub master_edition: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    /// The mint authority; also the update authority here (the `card` PDA, signs with `signer_seeds`).
    pub authority: &'a AccountInfo<'info>,
    pub payer: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub sysvar_instructions: &'a AccountInfo<'info>,
    pub spl_token_program: &'a AccountInfo<'info>,
    pub token_metadata_program: &'a AccountInfo<'info>,
}

/// Metaplex `CreateV1`: metadata + master edition (max supply 0) for `mint`; moves the mint and freeze authorities
/// to the master edition PDA. The mint must already hold its single token (supply ≤ 1).
pub fn create_v1(a: CreateAccounts, name: &str, symbol: &str, uri: &str, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    create_v1_with(a, create_v1_data(name, symbol, uri), signer_seeds)
}

/// `CreateV1` with prepared data (`create_v1_data_with`).
pub fn create_v1_with(a: CreateAccounts, data: Vec<u8>, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let ix = Instruction {
        program_id: MPL_TOKEN_METADATA_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*a.metadata.key, false),
            AccountMeta::new(*a.master_edition.key, false),
            AccountMeta::new(*a.mint.key, false),
            AccountMeta::new_readonly(*a.authority.key, true),
            AccountMeta::new(*a.payer.key, true),
            AccountMeta::new_readonly(*a.authority.key, true), // update authority
            AccountMeta::new_readonly(*a.system_program.key, false),
            AccountMeta::new_readonly(*a.sysvar_instructions.key, false),
            AccountMeta::new_readonly(*a.spl_token_program.key, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.metadata.clone(),
            a.master_edition.clone(),
            a.mint.clone(),
            a.authority.clone(),
            a.payer.clone(),
            a.system_program.clone(),
            a.sysvar_instructions.clone(),
            a.spl_token_program.clone(),
            a.token_metadata_program.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}

/// Metaplex `UpdateMetadataAccountV2` (accounts: metadata [w], update authority [s]) with prepared data
/// (`update_metadata_v2_data_with`).
pub fn update_metadata_v2_with<'info>(
    metadata: &AccountInfo<'info>,
    update_authority: &AccountInfo<'info>,
    token_metadata_program: &AccountInfo<'info>,
    data: Vec<u8>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = Instruction {
        program_id: MPL_TOKEN_METADATA_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*metadata.key, false), AccountMeta::new_readonly(*update_authority.key, true)],
        data,
    };
    invoke_signed(&ix, &[metadata.clone(), update_authority.clone(), token_metadata_program.clone()], signer_seeds)
        .map_err(Into::into)
}

/// The accounts of Metaplex `Verify(CollectionV1)` (F8; mpl-token-metadata `instruction/verification.rs`).
pub struct VerifyCollectionAccounts<'a, 'info> {
    /// The collection's update authority (`COLLECTION_AUTHORITY`, signs with `signer_seeds`).
    pub authority: &'a AccountInfo<'info>,
    pub metadata: &'a AccountInfo<'info>,
    pub collection_mint: &'a AccountInfo<'info>,
    pub collection_metadata: &'a AccountInfo<'info>,
    pub collection_master_edition: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub sysvar_instructions: &'a AccountInfo<'info>,
    /// Also the "none" placeholder of the optional delegate record.
    pub token_metadata_program: &'a AccountInfo<'info>,
}

/// `Verify(CollectionV1)` metas: authority (s), delegate record = Metaplex program ("none"), metadata (w), collection
/// mint, collection metadata (w), collection master edition, system program, instructions sysvar.
pub fn verify_collection_v1_metas(
    authority: &Pubkey,
    metadata: &Pubkey,
    collection_mint: &Pubkey,
    collection_metadata: &Pubkey,
    collection_master_edition: &Pubkey,
    system_program: &Pubkey,
    sysvar_instructions: &Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(*authority, true),
        AccountMeta::new_readonly(MPL_TOKEN_METADATA_PROGRAM_ID, false),
        AccountMeta::new(*metadata, false),
        AccountMeta::new_readonly(*collection_mint, false),
        AccountMeta::new(*collection_metadata, false),
        AccountMeta::new_readonly(*collection_master_edition, false),
        AccountMeta::new_readonly(*system_program, false),
        AccountMeta::new_readonly(*sysvar_instructions, false),
    ]
}

/// Metaplex `Verify(CollectionV1)`: marks the card's collection verified and (sized collection) increments its size.
pub fn verify_collection_v1(a: VerifyCollectionAccounts, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let ix = Instruction {
        program_id: MPL_TOKEN_METADATA_PROGRAM_ID,
        accounts: verify_collection_v1_metas(
            a.authority.key,
            a.metadata.key,
            a.collection_mint.key,
            a.collection_metadata.key,
            a.collection_master_edition.key,
            a.system_program.key,
            a.sysvar_instructions.key,
        ),
        data: vec![IX_VERIFY, VERIFY_COLLECTION_V1],
    };
    invoke_signed(
        &ix,
        &[
            a.authority.clone(),
            a.token_metadata_program.clone(),
            a.metadata.clone(),
            a.collection_mint.clone(),
            a.collection_metadata.clone(),
            a.collection_master_edition.clone(),
            a.system_program.clone(),
            a.sysvar_instructions.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}

/// The metadata rewrite every MintDex instruction makes (F8, admin §4.4): name, symbol, URI and royalty as given,
/// creators (with their verified flags) and the collection copied verbatim from the account, so a creator who verified
/// itself or a verified collection can never make the rewrite fail. Royalty: `outside_royalty_bps` for metadata that
/// has creators, 0 without (pre-collection cards keep today's exact bytes). Reads `metadata` (must be the Metaplex
/// metadata of `card_mint`, not closed).
pub fn rewrite_metadata<'info>(
    metadata: &AccountInfo<'info>,
    card_mint: &Pubkey,
    update_authority: &AccountInfo<'info>,
    token_metadata_program: &AccountInfo<'info>,
    name: Option<&[u8]>,
    symbol: Option<&[u8]>,
    uri: &[u8],
    outside_royalty_bps: u16,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let data = {
        let d = metadata.try_borrow_data()?;
        let v = read_metadata(&d, card_mint)?;
        let sfbp = if v.creators.is_some() { outside_royalty_bps } else { 0 };
        update_metadata_v2_data_with(
            name.unwrap_or(v.name),
            symbol.unwrap_or(v.symbol),
            uri,
            sfbp,
            v.creators.as_deref(),
            v.collection.as_ref(),
        )
    };
    update_metadata_v2_with(metadata, update_authority, token_metadata_program, data, signer_seeds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::assert_error;

    #[test]
    fn create_v1_layout() {
        let d = create_v1_data("HONK MintDex Card", "MDXCARD", "https://mintdex.fun/c/x.json?l=1");
        let mut want = vec![42u8, 0];
        for s in ["HONK MintDex Card", "MDXCARD", "https://mintdex.fun/c/x.json?l=1"] {
            want.extend_from_slice(&(s.len() as u32).to_le_bytes());
            want.extend_from_slice(s.as_bytes());
        }
        // sfbp 0, creators None, primary sale false, mutable, NonFungible, collection/uses/details/rule_set None,
        // decimals None, print supply Some(Zero)
        want.extend_from_slice(&[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
        assert_eq!(d, want);
    }

    #[test]
    fn update_v2_layout() {
        let d = update_metadata_v2_data("A", "MDXCARD", "u");
        let mut want = vec![15u8, 1, 1, 0, 0, 0, b'A', 7, 0, 0, 0];
        want.extend_from_slice(b"MDXCARD");
        want.extend_from_slice(&[1, 0, 0, 0, b'u']);
        want.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(d, want);
    }

    fn put(d: &mut Vec<u8>, s: &[u8], pad: usize) {
        d.extend_from_slice(&(pad as u32).to_le_bytes());
        d.extend_from_slice(s);
        d.extend(std::iter::repeat(0u8).take(pad - s.len()));
    }

    /// A Metaplex `Metadata` account as `CreateV1` writes it (strings padded to their maximum).
    fn metadata_account(mint: &Pubkey, creators: Option<&[Creator]>, collection: Option<Collection>) -> Vec<u8> {
        let mut d = vec![METADATA_KEY_V1];
        d.extend_from_slice(Pubkey::new_unique().as_ref());
        d.extend_from_slice(mint.as_ref());
        put(&mut d, b"HONK MintDex Card", 32);
        put(&mut d, b"MDXCARD", 10);
        put(&mut d, b"https://mintdex.fun/c/x.json?l=1", 200);
        d.extend_from_slice(&0u16.to_le_bytes());
        put_creators(&mut d, creators);
        d.extend_from_slice(&[1, 1]); // primary sale, mutable
        d.extend_from_slice(&[1, 255]); // edition nonce
        d.extend_from_slice(&[1, TOKEN_STANDARD_NON_FUNGIBLE]);
        put_collection(&mut d, collection.as_ref());
        d.extend_from_slice(&[0, 0, 0]); // uses, collection details, programmable config
        d.resize(679, 0);
        d
    }

    #[test]
    fn create_v1_collection_layouts() {
        let (l, t) = (Pubkey::new_unique(), Pubkey::new_unique());
        let creators = card_creators(&l, &t, 500, 250);
        let d = create_v1_data_with(&AssetFields {
            name: "A",
            symbol: "MDXCARD",
            uri: "u",
            seller_fee_basis_points: 500,
            creators: Some(&creators),
            primary_sale_happened: true,
            collection: Some(Collection { verified: false, key: crate::constants::COLLECTION_MINT }),
            sized_collection: false,
        });
        let mut want = vec![42u8, 0, 1, 0, 0, 0, b'A', 7, 0, 0, 0];
        want.extend_from_slice(b"MDXCARD");
        want.extend_from_slice(&[1, 0, 0, 0, b'u']);
        want.extend_from_slice(&500u16.to_le_bytes());
        want.extend_from_slice(&[1, 2, 0, 0, 0]);
        want.extend_from_slice(l.as_ref());
        want.extend_from_slice(&[0, 67]);
        want.extend_from_slice(t.as_ref());
        want.extend_from_slice(&[0, 33]);
        want.extend_from_slice(&[1, 1, 0]); // primary sale true, mutable, NonFungible
        want.extend_from_slice(&[1, 0]);
        want.extend_from_slice(crate::constants::COLLECTION_MINT.as_ref());
        want.extend_from_slice(&[0, 0, 0, 0, 1, 0]); // uses, details, rule set None; decimals None; print Some(Zero)
        assert_eq!(d, want);
        // the collection parent: no creators, sized collection (tag 1, variant V1, size 0)
        let p = create_v1_data_with(&AssetFields {
            name: "MintDex Cards",
            symbol: "MDXCARD",
            uri: "u",
            seller_fee_basis_points: 0,
            creators: None,
            primary_sale_happened: true,
            collection: None,
            sized_collection: true,
        });
        let tail = &p[p.len() - 18..];
        // mutable, NonFungible, collection None, uses None, details Some(V1 { size: 0 }), rule set None, decimals None,
        // print supply Some(Zero)
        assert_eq!(tail, &[1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0][..]);
        // without the collection the card bytes are exactly the pre-fix-pack ones
        assert_eq!(create_v1_data("HONK MintDex Card", "MDXCARD", "https://mintdex.fun/c/x.json?l=1").len(), 2 + 4 + 17 + 4 + 7 + 4 + 32 + 13);
    }

    #[test]
    fn verify_layout() {
        let metas = verify_collection_v1_metas(
            &crate::constants::COLLECTION_AUTHORITY,
            &Pubkey::new_from_array([1; 32]),
            &crate::constants::COLLECTION_MINT,
            &crate::constants::COLLECTION_METADATA,
            &crate::constants::COLLECTION_EDITION,
            &crate::constants::SYSTEM_PROGRAM_ID,
            &crate::constants::INSTRUCTIONS_SYSVAR_ID,
        );
        let flags: Vec<(bool, bool)> = metas.iter().map(|m| (m.is_signer, m.is_writable)).collect();
        assert_eq!(flags, vec![(true, false), (false, false), (false, true), (false, false), (false, true), (false, false), (false, false), (false, false)]);
        assert_eq!(metas[1].pubkey, MPL_TOKEN_METADATA_PROGRAM_ID); // the "none" delegate record
        assert_eq!((IX_VERIFY, VERIFY_COLLECTION_V1), (52, 1));
    }

    #[test]
    fn card_creators_split() {
        let (l, t) = (Pubkey::new_unique(), Pubkey::new_unique());
        let shares = |r, p| card_creators(&l, &t, r, p).iter().map(|c| (c.address, c.share)).collect::<Vec<_>>();
        assert_eq!(shares(500, 250), vec![(l, 67), (t, 33)]);
        assert_eq!(shares(500, 0), vec![(l, 100)]);
        assert_eq!(shares(0, 250), vec![(t, 100)]);
        assert_eq!(shares(0, 0), vec![(t, 100)]);
        assert_eq!(card_creators(&t, &t, 500, 250).iter().map(|c| (c.address, c.share)).collect::<Vec<_>>(), vec![(t, 100)]);
        for r in (0..=2_000u16).step_by(50) {
            for p in (0..=2_000u16 - r).step_by(50) {
                let cs = card_creators(&l, &t, r, p);
                assert_eq!(cs.iter().map(|c| c.share as u32).sum::<u32>(), 100, "{r}/{p}");
                assert!(cs.iter().all(|c| c.share > 0 && !c.verified));
                assert!(cs.len() < 2 || cs[0].address != cs[1].address);
            }
        }
    }

    #[test]
    fn read_metadata_and_rewrite_bytes() {
        let mint = Pubkey::new_unique();
        // a pre-collection card: no creators, no collection -> today's exact update bytes
        let plain = metadata_account(&mint, None, None);
        let v = read_metadata(&plain, &mint).unwrap();
        assert_eq!((v.name, v.symbol, v.uri), (&b"HONK MintDex Card"[..], &b"MDXCARD"[..], &b"https://mintdex.fun/c/x.json?l=1"[..]));
        assert_eq!((v.creators.clone(), v.collection, v.token_standard), (None, None, Some(0)));
        assert_eq!(
            update_metadata_v2_data_with(v.name, v.symbol, b"https://mintdex.fun/c/x.json?l=3", 0, v.creators.as_deref(), v.collection.as_ref()),
            update_metadata_v2_data("HONK MintDex Card", "MDXCARD", "https://mintdex.fun/c/x.json?l=3")
        );
        // a collection card whose launcher verified itself: copied with verified = 1
        let (l, t) = (Pubkey::new_unique(), Pubkey::new_unique());
        let cs = [Creator { address: l, verified: true, share: 67 }, Creator { address: t, verified: false, share: 33 }];
        let col = Collection { verified: true, key: crate::constants::COLLECTION_MINT };
        let acc = metadata_account(&mint, Some(&cs), Some(col));
        let v = read_metadata(&acc, &mint).unwrap();
        assert_eq!(v.creators.as_deref(), Some(&cs[..]));
        assert_eq!(v.collection, Some(col));
        let upd = update_metadata_v2_data_with(v.name, v.symbol, b"u", 250, v.creators.as_deref(), v.collection.as_ref());
        let tail = &upd[upd.len() - (2 + 1 + 4 + 2 * 34 + 1 + 1 + 32 + 4)..];
        assert_eq!(&tail[..2], &250u16.to_le_bytes());
        assert_eq!(tail[3 + 4 + 32], 1, "the launcher stays verified");
        // failures: wrong key, wrong mint, 6 creators, truncation anywhere before the collection field
        let mut bad = acc.clone();
        bad[0] = 5;
        assert_error(read_metadata(&bad, &mint), crate::errors::MintdexError::MetaplexAccountMismatch);
        assert_error(read_metadata(&acc, &Pubkey::new_unique()), crate::errors::MintdexError::MetaplexAccountMismatch);
        let six = [Creator { address: l, verified: false, share: 10 }; 6];
        let mut many = metadata_account(&mint, None, None);
        let at = 1 + 32 + 32 + 36 + 14 + 204 + 2;
        many.splice(at..at + 1, {
            let mut c = Vec::new();
            put_creators(&mut c, Some(&six));
            c
        });
        assert_error(read_metadata(&many, &mint), crate::errors::MintdexError::MetaplexAccountMismatch);
        let end = 1 + 32 + 32 + 36 + 14 + 204 + 2 + (1 + 4 + 2 * 34) + 2 + 2 + 2 + 34;
        for cut in 0..end {
            assert!(read_metadata(&acc[..cut], &mint).is_err(), "truncated at {cut}");
        }
        assert!(read_metadata(&acc[..end], &mint).is_ok());
    }

    #[test]
    fn pdas_match_metaplex_seeds() {
        // a known devnet NFT is not needed: the seeds are the documented ones; check they are distinct and stable
        let mint = Pubkey::new_from_array([7; 32]);
        let m = metadata_pda(&mint);
        let e = master_edition_pda(&mint);
        assert_ne!(m, e);
        assert_eq!(
            m,
            Pubkey::find_program_address(&[b"metadata", MPL_TOKEN_METADATA_PROGRAM_ID.as_ref(), mint.as_ref()], &MPL_TOKEN_METADATA_PROGRAM_ID).0
        );
    }
}
