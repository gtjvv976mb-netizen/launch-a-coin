//! Token-2022 TokenMetadata reading (the coin mint, §7.2), base58 on chain, the bound coin URI, the card NFT
//! name / URI and its final account size (§4.5). Pure functions over byte slices so they are unit-testable.

use anchor_lang::prelude::*;

use crate::constants::{CARD_NAME_SUFFIX, CARD_NAME_SYMBOL_MAX, CARD_NFT_SYMBOL};
use crate::errors::MintdexError;

// ---------------------------------------------------------------- base58

const B58_ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/// 58^5, the largest power of 58 below 2^32: the key is divided by it, five base58 digits at a time.
const B58_POW5: u64 = 656_356_768;

/// Base58 of a 32-byte key (bitcoin alphabet, as `bs58` / `Pubkey::to_string`), without allocating.
/// Returns the buffer and the length (32..=44).
pub fn base58_32(key: &[u8; 32]) -> ([u8; 44], usize) {
    let mut limbs = [0u32; 8];
    for (i, limb) in limbs.iter_mut().enumerate() {
        *limb = u32::from_be_bytes([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    }
    // little-endian base58 digits; 2^256 < 58^45, so at most 9 groups of 5
    let mut digits = [0u8; 45];
    let mut n = 0usize;
    let mut start = limbs.iter().position(|&l| l != 0).unwrap_or(8);
    while start < 8 {
        let mut rem: u64 = 0;
        for limb in limbs[start..].iter_mut() {
            let cur = (rem << 32) | *limb as u64; // rem < 58^5 < 2^30: no overflow
            *limb = (cur / B58_POW5) as u32;
            rem = cur % B58_POW5;
        }
        for _ in 0..5 {
            digits[n] = (rem % 58) as u8;
            rem /= 58;
            n += 1;
        }
        while start < 8 && limbs[start] == 0 {
            start += 1;
        }
    }
    while n > 0 && digits[n - 1] == 0 {
        n -= 1;
    }
    let zeros = key.iter().take_while(|&&b| b == 0).count();
    let mut out = [0u8; 44];
    for o in out.iter_mut().take(zeros) {
        *o = b'1';
    }
    for i in 0..n {
        out[zeros + i] = B58_ALPHABET[digits[n - 1 - i] as usize];
    }
    (out, zeros + n)
}

/// Base58 string of a pubkey (ASCII by construction).
pub fn base58_string(key: &Pubkey) -> String {
    let (buf, len) = base58_32(&key.to_bytes());
    buf[..len].iter().map(|&b| b as char).collect()
}

// ---------------------------------------------------------------- URIs and names

/// Rev 1 coin URI binding (§7.2): `uri == coin_uri_base ‖ base58(mint) ‖ ".json"`, byte for byte.
pub fn bound_uri_matches(uri: &[u8], coin_uri_base: &[u8], mint: &Pubkey) -> bool {
    let (b58, n) = base58_32(&mint.to_bytes());
    let suffix = b".json";
    uri.len() == coin_uri_base.len() + n + suffix.len()
        && uri.starts_with(coin_uri_base)
        && &uri[coin_uri_base.len()..coin_uri_base.len() + n] == &b58[..n]
        && uri.ends_with(suffix)
}

/// Card NFT URI built on chain: `{card_uri_base}{mint}.json?l={level}` (§4.5).
pub fn card_uri(card_uri_base: &[u8], mint_b58: &str, level: u8) -> String {
    // the base is validated to be "https://…" (ASCII prefix) and ≤ 64 bytes; it is stored as UTF-8 by update_config
    let base = core::str::from_utf8(card_uri_base).unwrap_or("");
    format!("{base}{mint_b58}.json?l={level}")
}

/// Longest prefix of `s` with at most `max_bytes` bytes that ends on a char boundary (rev 1: never panics in the
/// middle of a multibyte character, unlike v1's `String::truncate`).
pub fn truncate_utf8(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Card NFT name `"{SYMBOL} MintDex Card"` with SYMBOL cut to 10 bytes on a char boundary (≤ 23 bytes, §4.5).
pub fn card_name(coin_symbol: &str) -> String {
    format!("{}{}", truncate_utf8(coin_symbol, CARD_NAME_SYMBOL_MAX), CARD_NAME_SUFFIX)
}

/// Token-2022 mint length with the MetadataPointer extension only (what Anchor's `init` allocates):
/// 82 base + 83 padding + 1 account type + 4 TLV header + 64 pointer.
pub const MINT_WITH_POINTER_LEN: usize = 234;

/// Final card NFT mint length (§4.5) for the given name, URI and `level` value, with the `level` and `coin`
/// fields: `MINT_WITH_POINTER_LEN + 4 (TLV header) + TokenMetadata`. 495 bytes at level 14 with a 10-byte symbol
/// and a 44-character mint.
pub fn card_mint_len(name_len: usize, uri_len: usize, level_len: usize, mint_b58_len: usize) -> usize {
    let metadata = 32 // update authority
        + 32 // mint
        + 4 + name_len
        + 4 + CARD_NFT_SYMBOL.len()
        + 4 + uri_len
        + 4 // additional_metadata vec length
        + (4 + "level".len() + 4 + level_len)
        + (4 + "coin".len() + 4 + mint_b58_len);
    MINT_WITH_POINTER_LEN + 4 + metadata
}

// ---------------------------------------------------------------- TokenMetadata TLV

/// Token-2022 extension type numbers used here.
pub const EXT_TOKEN_METADATA: u16 = 19;
const MINT_BASE_LEN: usize = 82;
const ACCOUNT_TYPE_OFFSET: usize = 165;
const ACCOUNT_TYPE_MINT: u8 = 1;

/// The parts of a coin's TokenMetadata that `register_card` reads (borrowed from the mint data).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoinMetadata<'a> {
    /// `Pubkey::default()` = no update authority (pump create_v2 coins are immutable).
    pub update_authority: Pubkey,
    pub mint: Pubkey,
    pub name: &'a [u8],
    pub symbol: &'a [u8],
    pub uri: &'a [u8],
}

fn read_u16(d: &[u8], o: usize) -> Option<u16> {
    d.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn read_u32(d: &[u8], o: usize) -> Option<u32> {
    d.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn read_borsh_bytes<'a>(d: &'a [u8], o: &mut usize) -> Option<&'a [u8]> {
    let len = read_u32(d, *o)? as usize;
    let start = o.checked_add(4)?;
    let end = start.checked_add(len)?;
    let out = d.get(start..end)?;
    *o = end;
    Some(out)
}

fn parse_token_metadata_value(v: &[u8]) -> Option<CoinMetadata<'_>> {
    let update_authority = Pubkey::new_from_array(v.get(0..32)?.try_into().ok()?);
    let mint = Pubkey::new_from_array(v.get(32..64)?.try_into().ok()?);
    let mut o = 64;
    let name = read_borsh_bytes(v, &mut o)?;
    let symbol = read_borsh_bytes(v, &mut o)?;
    let uri = read_borsh_bytes(v, &mut o)?;
    Some(CoinMetadata { update_authority, mint, name, symbol, uri })
}

/// Reads the TokenMetadata extension stored in a Token-2022 mint's own data (pump create_v2 coins: MetadataPointer
/// to itself + TokenMetadata). `NotTokenMetadataMint` when the data is not an initialized Token-2022 mint with
/// extensions, the TLV area is malformed, or there is no TokenMetadata entry.
pub fn parse_coin_metadata(data: &[u8]) -> Result<CoinMetadata<'_>> {
    let parsed = (|| {
        if data.len() <= ACCOUNT_TYPE_OFFSET + 1 || data[45] != 1 || data[ACCOUNT_TYPE_OFFSET] != ACCOUNT_TYPE_MINT {
            return None;
        }
        // bytes 82..165 of an extended mint are zero padding
        if data[MINT_BASE_LEN..ACCOUNT_TYPE_OFFSET].iter().any(|&b| b != 0) {
            return None;
        }
        let mut o = ACCOUNT_TYPE_OFFSET + 1;
        while o + 4 <= data.len() {
            let ty = read_u16(data, o)?;
            let len = read_u16(data, o + 2)? as usize;
            if ty == 0 {
                return None; // uninitialized: no more extensions
            }
            let value = data.get(o + 4..o + 4 + len)?;
            if ty == EXT_TOKEN_METADATA {
                return parse_token_metadata_value(value);
            }
            o += 4 + len;
        }
        None
    })();
    parsed.ok_or_else(|| error!(MintdexError::NotTokenMetadataMint))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{
            metadata_pointer::MetadataPointer, BaseStateWithExtensions, BaseStateWithExtensionsMut, ExtensionType,
            StateWithExtensionsMut,
        },
        state::Mint,
    };
    use spl_token_metadata_interface::state::TokenMetadata;

    // ---------------------------------------------------------------- U12 base58

    #[test]
    fn u12_base58_equals_bs58_for_10k_random_keys() {
        let mut rng = XorShift::new(0x5eed_0012);
        for _ in 0..10_000 {
            let k = rng.key();
            let (buf, n) = base58_32(&k);
            assert_eq!(&buf[..n], Pubkey::new_from_array(k).to_string().as_bytes());
        }
    }

    #[test]
    fn u12_base58_edge_cases() {
        let mut keys: Vec<[u8; 32]> = vec![[0u8; 32], [0xff; 32], [1u8; 32]];
        let mut one = [0u8; 32];
        one[31] = 1;
        keys.push(one);
        let mut lead = [0u8; 32];
        lead[3] = 7;
        lead[31] = 0xab;
        keys.push(lead);
        let mut top = [0u8; 32];
        top[0] = 1;
        keys.push(top);
        // random keys with 1..=31 leading zero bytes
        let mut rng = XorShift::new(7);
        for z in 1..32 {
            let mut k = rng.key();
            for b in k.iter_mut().take(z) {
                *b = 0;
            }
            keys.push(k);
        }
        for k in keys {
            let (buf, n) = base58_32(&k);
            assert_eq!(&buf[..n], Pubkey::new_from_array(k).to_string().as_bytes(), "{k:?}");
            assert_eq!(base58_string(&Pubkey::new_from_array(k)), Pubkey::new_from_array(k).to_string());
        }
        assert_eq!(base58_32(&[0u8; 32]).1, 32);
        assert_eq!(base58_string(&crate::ID), "4HTSBYfgm5os2kBwFVBv5cd4mPetNmS32Cb4r3YViDon");
    }

    // ---------------------------------------------------------------- U10 truncation

    #[test]
    fn u10_truncation_on_char_boundaries() {
        // ASCII
        assert_eq!(truncate_utf8("HONK", 10), "HONK");
        assert_eq!(truncate_utf8("ABCDEFGHIJKL", 10), "ABCDEFGHIJ");
        // 4-byte emoji: "AB" + 2 emoji = 10 bytes fits; a third emoji would cross the boundary at byte 10
        assert_eq!(truncate_utf8("AB🚀🚀🚀", 10), "AB🚀🚀");
        assert_eq!(truncate_utf8("ABC🚀🚀🚀", 10), "ABC🚀");
        // 3-byte CJK: three fit in 9 bytes, the fourth would end at 12
        assert_eq!(truncate_utf8("猫猫猫猫", 10), "猫猫猫");
        assert_eq!(truncate_utf8("A猫猫猫猫", 10), "A猫猫猫");
        // every cut of a mixed string is valid UTF-8 and within the limit
        let s = "a猫🚀é∂ß🙂x";
        for max in 0..=s.len() + 2 {
            let t = truncate_utf8(s, max);
            assert!(t.len() <= max);
            assert!(s.starts_with(t));
            assert!(core::str::from_utf8(t.as_bytes()).is_ok());
        }
        assert_eq!(truncate_utf8("🚀", 3), "");
        // card name: ≤ 23 bytes and the suffix intact
        assert_eq!(card_name("HONK"), "HONK MintDex Card");
        assert_eq!(card_name("🚀🚀🚀"), "🚀🚀 MintDex Card");
        assert_eq!(card_name("猫猫猫猫"), "猫猫猫 MintDex Card");
        assert!(card_name("ABCDEFGHIJKLMNOP").len() <= 23);
        assert_eq!(card_name("ABCDEFGHIJKLMNOP").len(), 23);
    }

    // ---------------------------------------------------------------- U11 TokenMetadata TLV + URI binding

    #[test]
    fn u11_parses_coin_2_mint_with_200_char_uri() {
        let f = fixture!("coin2.mint");
        assert_eq!(f.owner, crate::constants::TOKEN_2022_PROGRAM_ID);
        let md = parse_coin_metadata(&f.data).unwrap();
        assert_eq!(md.mint, f.pubkey);
        assert_eq!(md.update_authority, Pubkey::default());
        assert_eq!(md.name, b"MintDex ALT Test");
        assert_eq!(md.symbol, b"MDXA");
        assert_eq!(md.uri.len(), 200);
        assert!(md.uri.starts_with(b"https://mintdex.fun/site.webmanifest?pad=xxxx"));
        // coin 1 (36-char URI) too
        let f1 = fixture!("coin1.mint");
        let md1 = parse_coin_metadata(&f1.data).unwrap();
        assert_eq!(md1.uri, b"https://mintdex.fun/site.webmanifest");
        assert_eq!(md1.symbol, b"MDXT");
        assert_eq!(md1.mint, f1.pubkey);
        // neither is bound to the MintDex coin URI (they are legacy coins)
        assert!(!bound_uri_matches(md.uri, b"https://mintdex.fun/m/", &f.pubkey));
        assert!(!bound_uri_matches(md1.uri, b"https://mintdex.fun/m/", &f1.pubkey));
    }

    /// A Token-2022 mint (MetadataPointer to itself + TokenMetadata) packed by spl-token-2022 itself, so the bytes
    /// are independent of the parser under test. Trimmed to the exact length Token-2022 reports.
    fn pack_mint_with_metadata(md: &TokenMetadata) -> Vec<u8> {
        let base = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MetadataPointer]).unwrap();
        // tlv_size_of() uses the 12-byte spl-tlv header, more than Token-2022's 4: an upper bound
        let mut data = vec![0u8; base + md.tlv_size_of().unwrap()];
        let len = {
            let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();
            let ptr = state.init_extension::<MetadataPointer>(true).unwrap();
            ptr.metadata_address = Some(md.mint).try_into().unwrap();
            state.base = Mint { decimals: 6, is_initialized: true, supply: 1_000_000_000_000_000, ..Default::default() };
            state.pack_base();
            state.init_account_type().unwrap();
            state.init_variable_len_extension(md, false).unwrap();
            state.try_get_account_len().unwrap()
        };
        assert!(data[len..].iter().all(|&b| b == 0));
        data.truncate(len);
        data
    }

    fn synthetic_mint(mint: &Pubkey, name: &str, symbol: &str, uri: &str) -> Vec<u8> {
        pack_mint_with_metadata(&TokenMetadata {
            update_authority: Default::default(),
            mint: *mint,
            name: name.to_string(),
            symbol: symbol.to_string(),
            uri: uri.to_string(),
            additional_metadata: vec![("k".to_string(), "v".to_string())],
        })
    }

    #[test]
    fn u11_synthetic_bound_uri_mint() {
        let mint: Pubkey = "DJVsyAxNpnULaP3cwoPb4jMfQjQwS9gRdPEugTzemint".parse().unwrap();
        let bound = format!("https://mintdex.fun/m/{mint}.json");
        assert_eq!(bound.len(), 71);
        let data = synthetic_mint(&mint, "Honk", "HONK", &bound);
        let md = parse_coin_metadata(&data).unwrap();
        assert_eq!((md.name, md.symbol, md.uri), (&b"Honk"[..], &b"HONK"[..], bound.as_bytes()));
        assert_eq!(md.mint, mint);
        let base = b"https://mintdex.fun/m/";
        assert!(bound_uri_matches(md.uri, base, &mint));
        // exactly that URI and nothing else
        let other: Pubkey = "A1h3Bs3N4iKG5d7qGDPrZSeTzMdcuBrxhsa5xjUamint".parse().unwrap();
        for bad in [
            format!("https://mintdex.fun/m/{other}.json"),
            format!("https://mintdex.fun/m/{mint}.json?x=1"),
            format!("https://mintdex.fun/m/{mint}.JSON"),
            format!("http://mintdex.fun/m/{mint}.json"),
            format!("https://mintdex.fun/m/{mint}"),
            format!("https://mintdex.fun/m//{mint}.json"),
            format!("https://mintdex.fun/c/{mint}.json"),
            format!(" https://mintdex.fun/m/{mint}.json"),
            format!("https://mintdex.fun/m/{}.json", &mint.to_string()[1..]),
            String::new(),
        ] {
            assert!(!bound_uri_matches(bad.as_bytes(), base, &mint), "{bad}");
        }
        // a different base is honoured
        assert!(bound_uri_matches(
            format!("https://x.example/{mint}.json").as_bytes(),
            b"https://x.example/",
            &mint
        ));
        // emoji symbol round-trips through the parser
        let emoji = synthetic_mint(&mint, "Rocket", "🚀🚀🚀", &bound);
        assert_eq!(parse_coin_metadata(&emoji).unwrap().symbol, "🚀🚀🚀".as_bytes());
    }

    #[test]
    fn u11_rejects_non_metadata_mints() {
        // plain 82-byte SPL mint, a token account, truncated TLV
        assert_error(parse_coin_metadata(&[0u8; 82]), MintdexError::NotTokenMetadataMint);
        let mint: Pubkey = "DJVsyAxNpnULaP3cwoPb4jMfQjQwS9gRdPEugTzemint".parse().unwrap();
        let mut data = synthetic_mint(&mint, "Honk", "HONK", "https://mintdex.fun/m/x.json");
        let full = data.clone();
        data.truncate(data.len() - 3);
        assert_error(parse_coin_metadata(&data), MintdexError::NotTokenMetadataMint);
        let mut wrong_type = full.clone();
        wrong_type[165] = 2; // account, not mint
        assert_error(parse_coin_metadata(&wrong_type), MintdexError::NotTokenMetadataMint);
        let mut uninit = full.clone();
        uninit[45] = 0;
        assert_error(parse_coin_metadata(&uninit), MintdexError::NotTokenMetadataMint);
        // a mint with only the MetadataPointer extension (no TokenMetadata)
        let base = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::MetadataPointer]).unwrap();
        assert_eq!(base, MINT_WITH_POINTER_LEN);
        let ptr_only = full[..base].to_vec();
        assert_error(parse_coin_metadata(&ptr_only), MintdexError::NotTokenMetadataMint);
    }

    #[test]
    fn card_uri_and_final_mint_len() {
        let mint: Pubkey = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint".parse().unwrap();
        let b58 = base58_string(&mint);
        let uri14 = card_uri(b"https://mintdex.fun/c/", &b58, 14);
        assert_eq!(uri14, format!("https://mintdex.fun/c/{mint}.json?l=14"));
        assert_eq!(uri14.len(), 76);
        assert_eq!(card_uri(b"https://mintdex.fun/c/", &b58, 1), format!("https://mintdex.fun/c/{mint}.json?l=1"));
        // §4.5: 495 bytes at level 14 with a 10-byte symbol (23-byte name) and a 44-char mint
        assert_eq!(card_mint_len(23, 76, 2, 44), 495);
        // cross-check with spl-token-2022's own packing of the same metadata
        let name = card_name("ABCDEFGHIJ");
        let md = TokenMetadata {
            update_authority: Some(crate::ID).try_into().unwrap(),
            mint,
            name: name.clone(),
            symbol: CARD_NFT_SYMBOL.to_string(),
            uri: uri14.clone(),
            additional_metadata: vec![("level".into(), "14".into()), ("coin".into(), b58.clone())],
        };
        let packed = pack_mint_with_metadata(&md);
        assert_eq!(card_mint_len(name.len(), uri14.len(), 2, b58.len()), packed.len());
        assert_eq!(packed.len(), 495);
        // and the parser reads the card's own metadata back
        let back = parse_coin_metadata(&packed).unwrap();
        assert_eq!(back.symbol, CARD_NFT_SYMBOL.as_bytes());
        assert_eq!(back.uri, uri14.as_bytes());
        assert_eq!(back.update_authority, crate::ID);
    }
}
