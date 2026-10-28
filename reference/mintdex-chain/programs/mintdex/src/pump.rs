//! Reading pump state without CPI (card-program-v2 §5.1, §5.2), the pump / pAMM PDAs MintDex re-derives, and
//! the two fee CPI builders (§7.4). pump and pAMM are only ever invoked with plain `invoke` (§3 rule).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::constants::*;
use crate::errors::MintdexError;
use crate::math::{curve_market_cap, pool_market_cap};

// ---------------------------------------------------------------- PDAs

pub fn card_vault_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CARD_VAULT_SEED, mint.as_ref()], &crate::ID)
}

pub fn bonding_curve_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PUMP_BONDING_CURVE_SEED, mint.as_ref()], &PUMP_PROGRAM_ID).0
}

/// pump `["creator-vault", card_vault]` (curve fees accrue here).
pub fn pump_creator_vault_pda(card_vault: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PUMP_CREATOR_VAULT_SEED, card_vault.as_ref()], &PUMP_PROGRAM_ID).0
}

/// pAMM `["creator_vault", card_vault]` (underscore), the owner of the AMM creator-fee WSOL ATA.
pub fn amm_vault_authority_pda(card_vault: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PAMM_CREATOR_VAULT_SEED, card_vault.as_ref()], &PAMM_PROGRAM_ID).0
}

/// ATA(owner, WSOL, SPL Token): the AMM creator vault ATA and the card vault's own WSOL ATA.
pub fn wsol_ata(owner: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address_with_program_id(owner, &WSOL_MINT, &SPL_TOKEN_PROGRAM_ID)
}

/// The canonical PumpSwap pool: `["pool", 0u16 LE, PDA(["pool-authority", mint], pump), mint, WSOL]` under pAMM.
pub fn canonical_pool_pda(mint: &Pubkey) -> Pubkey {
    let pool_authority = Pubkey::find_program_address(&[PUMP_POOL_AUTHORITY_SEED, mint.as_ref()], &PUMP_PROGRAM_ID).0;
    Pubkey::find_program_address(
        &[PAMM_POOL_SEED, &0u16.to_le_bytes(), pool_authority.as_ref(), mint.as_ref(), WSOL_MINT.as_ref()],
        &PAMM_PROGRAM_ID,
    )
    .0
}

// ---------------------------------------------------------------- byte readers

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}

fn key_at(d: &[u8], o: usize) -> Pubkey {
    Pubkey::new_from_array(d[o..o + 32].try_into().unwrap())
}

/// SPL token account `amount` (u64 at 64); `None` if the data is too short.
pub fn token_amount(data: &[u8]) -> Option<u64> {
    (data.len() >= 72).then(|| u64_at(data, 64))
}

// ---------------------------------------------------------------- bonding curve (§5.1)

/// Minimum curve length MintDex accepts (rev 1; create_v2 curves are 174 bytes).
pub const CURVE_MIN_LEN: usize = 125;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BondingCurve {
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub token_total_supply: u64,
    pub complete: bool,
    pub creator: Pubkey,
    pub is_mayhem_mode: bool,
    pub is_cashback_coin: bool,
    pub quote_mint: Pubkey,
    pub creator_fee_bps: u64,
    pub can_edit_creator_fee: bool,
    pub is_holder_reward: bool,
}

impl BondingCurve {
    /// pump's `admin_cto` can set these without changing the creator (rev 1: evolve flags FEES_CHANGED).
    pub fn fees_changed(&self) -> bool {
        self.creator_fee_bps != 0 || self.is_holder_reward
    }
}

/// Discriminator + length checks, then the little-endian fields of §5.1.
pub fn parse_curve(data: &[u8]) -> Result<BondingCurve> {
    require!(
        data.len() >= CURVE_MIN_LEN && data[..8] == CURVE_DISC,
        MintdexError::CurveMismatch
    );
    Ok(BondingCurve {
        virtual_token_reserves: u64_at(data, 8),
        virtual_sol_reserves: u64_at(data, 16),
        real_token_reserves: u64_at(data, 24),
        real_sol_reserves: u64_at(data, 32),
        token_total_supply: u64_at(data, 40),
        complete: data[48] != 0,
        creator: key_at(data, 49),
        is_mayhem_mode: data[81] != 0,
        is_cashback_coin: data[82] != 0,
        quote_mint: key_at(data, 83),
        creator_fee_bps: u64_at(data, 115),
        can_edit_creator_fee: data[123] != 0,
        is_holder_reward: data[124] != 0,
    })
}

/// Full §5.1 check: `key == PDA(["bonding-curve", mint], pump)`, owner pump, discriminator, length.
pub fn read_curve(key: &Pubkey, owner: &Pubkey, data: &[u8], mint: &Pubkey) -> Result<BondingCurve> {
    require!(
        *key == bonding_curve_pda(mint) && *owner == PUMP_PROGRAM_ID,
        MintdexError::CurveMismatch
    );
    parse_curve(data)
}

/// `register_card` coin checks (§5.1, §7.2): creator == card vault, then not mayhem, not cashback, SOL quote,
/// `creator_fee_bps == 0` (the pump schedule) and no holder reward.
pub fn check_registrable(curve: &BondingCurve, card_vault: &Pubkey) -> Result<()> {
    require!(curve.creator == *card_vault, MintdexError::CreatorMismatch);
    require!(
        !curve.is_mayhem_mode
            && !curve.is_cashback_coin
            && curve.quote_mint == Pubkey::default()
            && curve.creator_fee_bps == 0
            && !curve.is_holder_reward,
        MintdexError::UnsupportedCoin
    );
    Ok(())
}

// ---------------------------------------------------------------- canonical pool (§5.2)

pub const POOL_MIN_LEN: usize = 243;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pool {
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub pool_base_token_account: Pubkey,
    pub pool_quote_token_account: Pubkey,
    pub coin_creator: Pubkey,
    /// i128 at 245 when the account is at least 261 bytes, else 0.
    pub virtual_quote_reserves: i128,
}

pub fn parse_pool(data: &[u8]) -> Result<Pool> {
    require!(
        data.len() >= POOL_MIN_LEN && data[..8] == POOL_DISC,
        MintdexError::PoolMismatch
    );
    let virtual_quote_reserves = if data.len() >= 261 {
        i128::from_le_bytes(data[245..261].try_into().unwrap())
    } else {
        0
    };
    Ok(Pool {
        base_mint: key_at(data, 43),
        quote_mint: key_at(data, 75),
        pool_base_token_account: key_at(data, 139),
        pool_quote_token_account: key_at(data, 171),
        coin_creator: key_at(data, 211),
        virtual_quote_reserves,
    })
}

/// Account view used by the market-cap reader (key, owner, data) so it can run on fixtures in unit tests.
#[derive(Clone, Copy)]
pub struct AccountView<'a> {
    pub key: &'a Pubkey,
    pub owner: &'a Pubkey,
    pub data: &'a [u8],
}

/// The §5.2 read: pool owner/discriminator/length, mints, the stored token-account addresses and their token
/// programs, the live coin supply, and the bounded market cap. The pool *address* is checked by the caller
/// (canonical PDA the first time, `card.pool` after that).
pub fn read_pool_mcap(
    mint: &Pubkey,
    pool: AccountView,
    base_ta: AccountView,
    quote_ta: AccountView,
    coin_mint: AccountView,
) -> Result<(u64, Pool)> {
    require!(*pool.owner == PAMM_PROGRAM_ID, MintdexError::PoolMismatch);
    let p = parse_pool(pool.data)?;
    // mints; the stored token-account addresses, owned by the right token programs, holding the right mints;
    // the coin mint itself (its live supply is the basis: the boost bot burns tokens)
    let ok = p.base_mint == *mint
        && p.quote_mint == WSOL_MINT
        && *base_ta.key == p.pool_base_token_account
        && *base_ta.owner == TOKEN_2022_PROGRAM_ID
        && *quote_ta.key == p.pool_quote_token_account
        && *quote_ta.owner == SPL_TOKEN_PROGRAM_ID
        && base_ta.data.len() >= 165
        && quote_ta.data.len() >= 165
        && key_at(base_ta.data, 0) == *mint
        && key_at(quote_ta.data, 0) == WSOL_MINT
        && *coin_mint.key == *mint
        && *coin_mint.owner == TOKEN_2022_PROGRAM_ID
        && coin_mint.data.len() >= 82;
    require!(ok, MintdexError::PoolMismatch);
    let supply = u64_at(coin_mint.data, 36);
    let base = u64_at(base_ta.data, 64);
    let quote = u64_at(quote_ta.data, 64);
    let mcap = pool_market_cap(quote, p.virtual_quote_reserves, base, supply)?;
    Ok((mcap, p))
}

/// What `evolve` learned about the coin besides the market cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct McapReading {
    pub mcap_lamports: u64,
    /// Read from the pool (the coin migrated).
    pub graduated: bool,
    /// `curve.creator` when it differs from the card vault.
    pub curve_creator_mismatch: Option<Pubkey>,
    /// `pool.coin_creator` when it differs from the card vault.
    pub pool_creator_mismatch: Option<Pubkey>,
    /// `(creator_fee_bps, is_holder_reward)` when the curve no longer has the pump schedule.
    pub fees_changed: Option<(u64, bool)>,
    /// The canonical pool to cache in `card.pool` (first verified pool read).
    pub cache_pool: Option<Pubkey>,
}

/// The evolve market-cap read (§5.1 then §5.2; fix pack F5 + tier B11). `curve.key` must already be
/// `PDA(["bonding-curve", mint], pump)` (an Anchor `address` constraint on the instruction; not re-derived here to
/// save a PDA search).
/// - A parseable pump curve (owner pump, discriminator, length) with `vTok > 0` (even complete but not migrated) →
///   the curve market cap; its creator and fee flags are reported.
/// - Anything else reads the pool: a cached `card.pool` keeps working whatever pump does to the curve account
///   (closed, emptied, shortened, re-tagged: tier B11). With nothing cached, only a parseable pump curve with
///   `vTok == 0` or a gone curve (System-owned, no data: pump closed its own PDA) may derive the canonical pool (F5);
///   any other curve state fails closed (`CurveMismatch`).
/// - Pool: `PoolRequired` if its accounts are missing; address must be `cached_pool`, or the canonical PDA
///   when nothing is cached yet (then returned in `cache_pool`).
#[allow(clippy::too_many_arguments)]
pub fn read_market_cap(
    mint: &Pubkey,
    card_vault: &Pubkey,
    cached_pool: &Pubkey,
    curve: AccountView,
    pool: Option<AccountView>,
    base_ta: Option<AccountView>,
    quote_ta: Option<AccountView>,
    coin_mint: AccountView,
) -> Result<McapReading> {
    let mut r = McapReading::default();
    let parsed = if *curve.owner == PUMP_PROGRAM_ID { parse_curve(curve.data).ok() } else { None };
    if let Some(c) = parsed {
        if c.creator != *card_vault {
            r.curve_creator_mismatch = Some(c.creator);
        }
        if c.fees_changed() {
            r.fees_changed = Some((c.creator_fee_bps, c.is_holder_reward));
        }
        if c.virtual_token_reserves > 0 {
            r.mcap_lamports = curve_market_cap(c.token_total_supply, c.virtual_sol_reserves, c.virtual_token_reserves)?;
            return Ok(r);
        }
    } else if *cached_pool == Pubkey::default() {
        // nothing cached: only a gone curve (System-owned, no data) may fall through to the canonical pool (F5)
        require!(*curve.owner == SYSTEM_PROGRAM_ID && curve.data.is_empty(), MintdexError::CurveMismatch);
    }
    let (pool, base_ta, quote_ta) = match (pool, base_ta, quote_ta) {
        (Some(p), Some(b), Some(q)) => (p, b, q),
        _ => return err!(MintdexError::PoolRequired),
    };
    if *cached_pool == Pubkey::default() {
        require!(*pool.key == canonical_pool_pda(mint), MintdexError::PoolMismatch);
        r.cache_pool = Some(*pool.key);
    } else {
        require!(*pool.key == *cached_pool, MintdexError::PoolMismatch);
    }
    let (mcap, p) = read_pool_mcap(mint, pool, base_ta, quote_ta, coin_mint)?;
    if p.coin_creator != *card_vault {
        r.pool_creator_mismatch = Some(p.coin_creator);
    }
    r.mcap_lamports = mcap;
    r.graduated = true;
    Ok(r)
}

// ---------------------------------------------------------------- fee CPIs (§7.4, facts §6)

/// pump `collect_creator_fee`: `creator [w]` (not a signer), `creator_vault [w]`, system, event authority, pump.
pub fn collect_creator_fee_ix(card_vault: &Pubkey, pump_creator_vault: &Pubkey) -> Instruction {
    Instruction {
        program_id: PUMP_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*card_vault, false),
            AccountMeta::new(*pump_creator_vault, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            AccountMeta::new_readonly(PUMP_EVENT_AUTHORITY, false),
            AccountMeta::new_readonly(PUMP_PROGRAM_ID, false),
        ],
        data: COLLECT_CREATOR_FEE_DISC.to_vec(),
    }
}

/// pAMM `transfer_creator_fees_to_pump` (v1, WSOL): no signer at all.
pub fn transfer_creator_fees_to_pump_ix(
    card_vault: &Pubkey,
    amm_vault_authority: &Pubkey,
    amm_vault_ata: &Pubkey,
    pump_creator_vault: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: PAMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(WSOL_MINT, false),
            AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            AccountMeta::new_readonly(ASSOCIATED_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(*card_vault, false),
            AccountMeta::new(*amm_vault_authority, false),
            AccountMeta::new(*amm_vault_ata, false),
            AccountMeta::new(*pump_creator_vault, false),
            AccountMeta::new_readonly(PAMM_EVENT_AUTHORITY, false),
            AccountMeta::new_readonly(PAMM_PROGRAM_ID, false),
        ],
        data: TRANSFER_CREATOR_FEES_TO_PUMP_DISC.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;

    fn coin1() -> Pubkey {
        "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint".parse().unwrap()
    }
    fn coin2() -> Pubkey {
        "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint".parse().unwrap()
    }
    fn view(f: &Fixture) -> AccountView<'_> {
        AccountView { key: &f.pubkey, owner: &f.owner, data: &f.data }
    }

    #[test]
    fn pdas_match_the_devnet_facts() {
        assert_eq!(card_vault_pda(&coin1()).0.to_string(), "CbSXLuJ78qdNNGzpNqWmdTvGdbQPvyY3LiVCijS9eKpA");
        assert_eq!(card_vault_pda(&coin2()).0.to_string(), "6DRrwVRrsnNHkYnPCK9jsbjxLQpMC8U3PZpWQcQSt26S");
        assert_eq!(canonical_pool_pda(&coin1()).to_string(), "GoNfjcoURBJwijyt5eKgU2rw82M297anFHncfw5gyNpx");
        assert_eq!(bonding_curve_pda(&coin1()), fixture!("coin1.bonding_curve").pubkey);
        assert_eq!(bonding_curve_pda(&coin2()), fixture!("coin2.bonding_curve").pubkey);
        let v1 = card_vault_pda(&coin1()).0;
        assert_eq!(pump_creator_vault_pda(&v1), fixture!("coin1.pump_creator_vault").pubkey);
        assert_eq!(wsol_ata(&amm_vault_authority_pda(&v1)), fixture!("coin1.amm_creator_vault_ata").pubkey);
        let v2 = card_vault_pda(&coin2()).0;
        assert_eq!(pump_creator_vault_pda(&v2), fixture!("coin2.pump_creator_vault").pubkey);
    }

    // ---------------------------------------------------------------- U1 (fixture part)

    #[test]
    fn u1_coin2_curve_fixture_equals_pump_sdk() {
        let f = fixture!("coin2.bonding_curve");
        let c = read_curve(&f.pubkey, &f.owner, &f.data, &coin2()).unwrap();
        assert_eq!(f.data.len(), 174);
        assert_eq!(c.virtual_token_reserves, 1_052_215_499_896_656);
        assert_eq!(c.virtual_sol_reserves, 1_019_753_084);
        assert_eq!(c.token_total_supply, 1_000_000_000_000_000);
        assert!(!c.complete);
        assert_eq!(c.creator, card_vault_pda(&coin2()).0);
        // pump-sdk bondingCurveMarketCap on these bytes: 969,148,510 lamports
        let m = curve_market_cap(c.token_total_supply, c.virtual_sol_reserves, c.virtual_token_reserves).unwrap();
        assert_eq!(m, 969_148_510);
        check_registrable(&c, &card_vault_pda(&coin2()).0).unwrap();
    }

    #[test]
    fn curve_checks_reject_substitutes() {
        let f = fixture!("coin2.bonding_curve");
        // wrong address (coin 1's curve passed for coin 2), wrong owner, short, bad discriminator
        let f1 = fixture!("coin1.bonding_curve");
        assert_error(read_curve(&f1.pubkey, &f1.owner, &f1.data, &coin2()), MintdexError::CurveMismatch);
        assert_error(read_curve(&f.pubkey, &PAMM_PROGRAM_ID, &f.data, &coin2()), MintdexError::CurveMismatch);
        assert_error(read_curve(&f.pubkey, &f.owner, &f.data[..124], &coin2()), MintdexError::CurveMismatch);
        assert!(read_curve(&f.pubkey, &f.owner, &f.data[..125], &coin2()).is_ok());
        let mut bad = f.data.clone();
        bad[0] ^= 1;
        assert_error(read_curve(&f.pubkey, &f.owner, &bad, &coin2()), MintdexError::CurveMismatch);
    }

    #[test]
    fn register_coin_checks() {
        let f = fixture!("coin2.bonding_curve");
        let base = parse_curve(&f.data).unwrap();
        let vault = card_vault_pda(&coin2()).0;
        assert_error(check_registrable(&base, &card_vault_pda(&coin1()).0), MintdexError::CreatorMismatch);
        let cases = [
            BondingCurve { is_mayhem_mode: true, ..base },
            BondingCurve { is_cashback_coin: true, ..base },
            BondingCurve { quote_mint: WSOL_MINT, ..base },
            BondingCurve { creator_fee_bps: 30, ..base },
            BondingCurve { is_holder_reward: true, ..base },
        ];
        for c in cases {
            assert_error(check_registrable(&c, &vault), MintdexError::UnsupportedCoin);
        }
        // coin 1 (graduated) registers too: any curve state is accepted
        let c1 = parse_curve(&fixture!("coin1.bonding_curve").data).unwrap();
        assert!(c1.complete && c1.virtual_token_reserves == 0);
        check_registrable(&c1, &card_vault_pda(&coin1()).0).unwrap();
    }

    // ---------------------------------------------------------------- U2 (fixture part)

    #[test]
    fn u2_coin1_pool_fixture_equals_js_formula() {
        let (pool, b, q, m) =
            (fixture!("coin1.pool"), fixture!("coin1.pool_base_token_account"), fixture!("coin1.pool_quote_token_account"), fixture!("coin1.mint"));
        let (mcap, p) = read_pool_mcap(&coin1(), view(&pool), view(&b), view(&q), view(&m)).unwrap();
        // JS: (quote 452,649,604 + virtual 583,150,127) × supply 939,948,077,289,756 / base 563,225,577,289,756
        // = 1,728,611,066 (pump-swap-sdk poolMarketCap agrees)
        assert_eq!(p.virtual_quote_reserves, 583_150_127);
        assert_eq!(mcap, 1_728_611_066);
        assert_eq!(p.coin_creator, card_vault_pda(&coin1()).0);
    }

    #[test]
    fn u2_pool_substitutes_fail() {
        let (pool, b, q, m) =
            (fixture!("coin1.pool"), fixture!("coin1.pool_base_token_account"), fixture!("coin1.pool_quote_token_account"), fixture!("coin1.mint"));
        let c1 = coin1();
        // swapped token accounts, wrong token program owner, wrong coin mint, wrong pool owner, short pool
        assert_error(read_pool_mcap(&c1, view(&pool), view(&q), view(&b), view(&m)), MintdexError::PoolMismatch);
        let q_t22 = AccountView { owner: &TOKEN_2022_PROGRAM_ID, ..view(&q) };
        assert_error(read_pool_mcap(&c1, view(&pool), view(&b), q_t22, view(&m)), MintdexError::PoolMismatch);
        let m2 = fixture!("coin2.mint");
        assert_error(read_pool_mcap(&c1, view(&pool), view(&b), view(&q), view(&m2)), MintdexError::PoolMismatch);
        let pool_wrong_owner = AccountView { owner: &PUMP_PROGRAM_ID, ..view(&pool) };
        assert_error(read_pool_mcap(&c1, pool_wrong_owner, view(&b), view(&q), view(&m)), MintdexError::PoolMismatch);
        let short = AccountView { data: &pool.data[..242], ..view(&pool) };
        assert_error(read_pool_mcap(&c1, short, view(&b), view(&q), view(&m)), MintdexError::PoolMismatch);
        // a 243..260-byte pool reads virtual_quote = 0
        assert_eq!(parse_pool(&pool.data[..243]).unwrap().virtual_quote_reserves, 0);
        // the pool for another coin
        assert_error(read_pool_mcap(&coin2(), view(&pool), view(&b), view(&q), view(&m)), MintdexError::PoolMismatch);
        // out-of-range virtual quote in the pool bytes
        let mut neg = pool.data.clone();
        neg[245..261].copy_from_slice(&(-1i128).to_le_bytes());
        let negv = AccountView { data: &neg, ..view(&pool) };
        assert_error(read_pool_mcap(&c1, negv, view(&b), view(&q), view(&m)), MintdexError::PoolMismatch);
        // thin pool
        let mut thin = b.data.clone();
        thin[64..72].copy_from_slice(&999_999_999u64.to_le_bytes());
        let thinv = AccountView { data: &thin, ..view(&b) };
        assert_error(read_pool_mcap(&c1, view(&pool), thinv, view(&q), view(&m)), MintdexError::PoolTooThin);
    }

    #[test]
    fn evolve_market_cap_read_curve_then_pool() {
        let (c2, m2) = (fixture!("coin2.bonding_curve"), fixture!("coin2.mint"));
        let v2 = card_vault_pda(&coin2()).0;
        let r = read_market_cap(&coin2(), &v2, &Pubkey::default(), view(&c2), None, None, None, view(&m2)).unwrap();
        assert_eq!(r, McapReading { mcap_lamports: 969_148_510, ..Default::default() });

        let (c1, pool, b, q, m1) = (
            fixture!("coin1.bonding_curve"),
            fixture!("coin1.pool"),
            fixture!("coin1.pool_base_token_account"),
            fixture!("coin1.pool_quote_token_account"),
            fixture!("coin1.mint"),
        );
        let v1 = card_vault_pda(&coin1()).0;
        // graduated: curve reserves 0 → pool required
        assert_error(
            read_market_cap(&coin1(), &v1, &Pubkey::default(), view(&c1), None, None, None, view(&m1)),
            MintdexError::PoolRequired,
        );
        let r = read_market_cap(
            &coin1(), &v1, &Pubkey::default(), view(&c1), Some(view(&pool)), Some(view(&b)), Some(view(&q)), view(&m1),
        )
        .unwrap();
        assert_eq!(r.mcap_lamports, 1_728_611_066);
        assert!(r.graduated);
        assert_eq!(r.cache_pool, Some(pool.pubkey));
        assert_eq!((r.curve_creator_mismatch, r.pool_creator_mismatch, r.fees_changed), (None, None, None));
        // cached pool: compared by key; a different cached key fails
        let r2 = read_market_cap(
            &coin1(), &v1, &pool.pubkey, view(&c1), Some(view(&pool)), Some(view(&b)), Some(view(&q)), view(&m1),
        )
        .unwrap();
        assert_eq!(r2.cache_pool, None);
        assert_error(
            read_market_cap(&coin1(), &v1, &v1, view(&c1), Some(view(&pool)), Some(view(&b)), Some(view(&q)), view(&m1)),
            MintdexError::PoolMismatch,
        );
        // curve closed (system-owned, empty): with nothing cached the canonical pool is derived and cached (F5)
        let gone = AccountView { key: &c1.pubkey, owner: &SYSTEM_PROGRAM_ID, data: &[] };
        let rg = read_market_cap(&coin1(), &v1, &Pubkey::default(), gone, Some(view(&pool)), Some(view(&b)), Some(view(&q)), view(&m1))
            .unwrap();
        assert_eq!((rg.mcap_lamports, rg.cache_pool, rg.graduated), (1_728_611_066, Some(pool.pubkey), true));
        let r3 = read_market_cap(
            &coin1(), &v1, &pool.pubkey, gone, Some(view(&pool)), Some(view(&b)), Some(view(&q)), view(&m1),
        )
        .unwrap();
        assert_eq!(r3.mcap_lamports, 1_728_611_066);
        // creator repointed + custom fee on the curve are reported (evolve sets CREATOR_LOST / FEES_CHANGED)
        let mut edited = c2.data.clone();
        edited[49..81].copy_from_slice(Pubkey::new_unique().as_ref());
        edited[115..123].copy_from_slice(&50u64.to_le_bytes());
        let ev = AccountView { data: &edited, ..view(&c2) };
        let r4 = read_market_cap(&coin2(), &v2, &Pubkey::default(), ev, None, None, None, view(&m2)).unwrap();
        assert!(r4.curve_creator_mismatch.is_some());
        assert_eq!(r4.fees_changed, Some((50, false)));
        // a non-canonical pool is ignored by design
        let fake = Pubkey::new_unique();
        let fake_pool = AccountView { key: &fake, ..view(&pool) };
        assert_error(
            read_market_cap(&coin1(), &v1, &Pubkey::default(), view(&c1), Some(fake_pool), Some(view(&b)), Some(view(&q)), view(&m1)),
            MintdexError::PoolMismatch,
        );
    }

    /// F5 + tier B11 (fix-plan §2.5): which curve states may read the pool, with and without a cached pool.
    #[test]
    fn f5_closed_curve_and_b11_cached_pool() {
        let (c1, pool, b, q, m1) = (
            fixture!("coin1.bonding_curve"),
            fixture!("coin1.pool"),
            fixture!("coin1.pool_base_token_account"),
            fixture!("coin1.pool_quote_token_account"),
            fixture!("coin1.mint"),
        );
        let v1 = card_vault_pda(&coin1()).0;
        let none = Pubkey::default();
        let pools = || (Some(view(&pool)), Some(view(&b)), Some(view(&q)));
        let read = |curve: AccountView, cached: &Pubkey, with_pool: bool| {
            let (p, bb, qq) = if with_pool { pools() } else { (None, None, None) };
            read_market_cap(&coin1(), &v1, cached, curve, p, bb, qq, view(&m1))
        };
        let gone = AccountView { key: &c1.pubkey, owner: &SYSTEM_PROGRAM_ID, data: &[] };
        // F5: a gone curve with nothing cached derives the canonical pool; no pool accounts -> PoolRequired;
        // a non-canonical pool -> PoolMismatch
        assert_eq!(read(gone, &none, true).unwrap().cache_pool, Some(pool.pubkey));
        assert_error(read(gone, &none, false), MintdexError::PoolRequired);
        let fake = Pubkey::new_unique();
        let fake_pool = AccountView { key: &fake, ..view(&pool) };
        assert_error(
            read_market_cap(&coin1(), &v1, &none, gone, Some(fake_pool), Some(view(&b)), Some(view(&q)), view(&m1)),
            MintdexError::PoolMismatch,
        );
        // a gone curve that still holds lamports (anyone can send some) but no data is still "gone"
        let lamports_only = AccountView { key: &c1.pubkey, owner: &SYSTEM_PROGRAM_ID, data: &[] };
        assert!(read(lamports_only, &none, true).is_ok());
        // fail closed without a cache: System-owned with data, a third-party owner, a pump-owned short or zeroed curve
        let junk = [7u8; 40];
        let sys_data = AccountView { key: &c1.pubkey, owner: &SYSTEM_PROGRAM_ID, data: &junk };
        assert_error(read(sys_data, &none, true), MintdexError::CurveMismatch);
        let third = AccountView { owner: &PAMM_PROGRAM_ID, ..view(&c1) };
        assert_error(read(third, &none, true), MintdexError::CurveMismatch);
        let short = AccountView { data: &c1.data[..100], ..view(&c1) };
        assert_error(read(short, &none, true), MintdexError::CurveMismatch);
        let zeroed = vec![0u8; c1.data.len()];
        let zero = AccountView { data: &zeroed, ..view(&c1) };
        assert_error(read(zero, &none, true), MintdexError::CurveMismatch);
        // B11: with a cached pool every one of those reads the pool
        for curve in [gone, sys_data, third, short, zero] {
            let r = read(curve, &pool.pubkey, true).unwrap();
            assert_eq!((r.mcap_lamports, r.cache_pool, r.graduated), (1_728_611_066, None, true));
            assert_eq!(r.curve_creator_mismatch, None, "no curve fields from an unparseable curve");
        }
        // a live pump curve with vTok > 0 still reads the curve even when a pool is cached
        let (c2, m2) = (fixture!("coin2.bonding_curve"), fixture!("coin2.mint"));
        let v2 = card_vault_pda(&coin2()).0;
        let r = read_market_cap(&coin2(), &v2, &pool.pubkey, view(&c2), None, None, None, view(&m2)).unwrap();
        assert_eq!(r.mcap_lamports, 969_148_510);
    }

    #[test]
    fn cpi_builders_match_the_probe() {
        let v = card_vault_pda(&coin1()).0;
        let pv = pump_creator_vault_pda(&v);
        let ix = collect_creator_fee_ix(&v, &pv);
        assert_eq!(ix.data, vec![20, 22, 86, 123, 198, 28, 219, 132]);
        assert!(ix.accounts.iter().all(|a| !a.is_signer));
        let auth = amm_vault_authority_pda(&v);
        let t = transfer_creator_fees_to_pump_ix(&v, &auth, &wsol_ata(&auth), &pv);
        assert_eq!(t.data, vec![139, 52, 134, 85, 228, 229, 108, 241]);
        assert_eq!(t.accounts.len(), 10);
        assert!(t.accounts.iter().all(|a| !a.is_signer));
    }
}
