//! Pure integer math (card-program-v2 §5, §6, §7.7): market caps, USD conversion, tier levels, the vanity
//! residue and sale splits. Everything is checked u128 arithmetic; any overflow is `MathOverflow`, never a
//! saturated value (a wrong read would make a level permanent, R9).

use anchor_lang::prelude::*;

use crate::constants::POOL_MIN_BASE_AMOUNT;
use crate::errors::MintdexError;

/// Market-cap evolutions after the starting design: levels 2..=14 (Surge … Legend), matching the app's
/// 14-design ladder. `Config::tier_thresholds_usd` has this length.
pub const EVOLUTIONS: usize = 13;
/// Highest card level (Legend).
pub const MAX_LEVEL: u8 = EVOLUTIONS as u8 + 1;

/// Bytes a decimal level can grow by after registration ("1" -> "14").
pub const LEVEL_FIELD_HEADROOM: usize = {
    let mut n = MAX_LEVEL;
    let mut digits = 0;
    while n > 0 {
        n /= 10;
        digits += 1;
    }
    digits - 1
};
/// The card NFT mint grows twice per extra digit: the `level` field and the `?l=` URI suffix (§4.5).
pub const CARD_MINT_HEADROOM: usize = 2 * LEVEL_FIELD_HEADROOM;

/// The app's design thresholds in whole USD for levels 2..=14 (§6).
pub const TIER_THRESHOLDS_USD: [u64; EVOLUTIONS] = [
    15_000, 50_000, 100_000, 150_000, 200_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000,
    1_000_000,
];

const USD_E6: u128 = 1_000_000;
const LAMPORTS_PER_SOL: u128 = 1_000_000_000;
const BPS: u128 = 10_000;

fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(MintdexError::MathOverflow))
}

/// Curve market cap in lamports: `supply × vSol / vTok` (pump-sdk `bondingCurveMarketCap`, §5.1).
/// `vTok == 0` means the coin migrated: the caller must read the pool (`PoolRequired`).
pub fn curve_market_cap(supply: u64, virtual_sol: u64, virtual_tokens: u64) -> Result<u64> {
    require!(virtual_tokens > 0, MintdexError::PoolRequired);
    let num = (supply as u128)
        .checked_mul(virtual_sol as u128)
        .ok_or(MintdexError::MathOverflow)?;
    to_u64(num / virtual_tokens as u128)
}

/// Pool market cap in lamports: `(quote_amount + virtual_quote) × supply / base_amount` (pump-swap-sdk
/// `poolMarketCap` on the effective quote, §5.2), with rev 1's bounds: `0 ≤ virtual_quote ≤ u64::MAX` and
/// `base_amount ≥ 1e9` base units.
pub fn pool_market_cap(quote_amount: u64, virtual_quote: i128, base_amount: u64, supply: u64) -> Result<u64> {
    require!(
        virtual_quote >= 0 && virtual_quote <= u64::MAX as i128,
        MintdexError::PoolMismatch
    );
    require!(base_amount >= POOL_MIN_BASE_AMOUNT, MintdexError::PoolTooThin);
    let effective_quote = (quote_amount as u128)
        .checked_add(virtual_quote as u128)
        .ok_or(MintdexError::MathOverflow)?;
    let num = effective_quote
        .checked_mul(supply as u128)
        .ok_or(MintdexError::MathOverflow)?;
    to_u64(num / base_amount as u128)
}

/// `mcap_usd_e6 = mcap_lamports × sol_usd_e6 × mcap_multiplier / 1e9` (floor, checked u128; §6).
pub fn mcap_usd_e6(mcap_lamports: u64, sol_usd_e6: u64, mcap_multiplier: u16) -> Result<u64> {
    let v = (mcap_lamports as u128)
        .checked_mul(sol_usd_e6 as u128)
        .and_then(|v| v.checked_mul(mcap_multiplier as u128))
        .ok_or(MintdexError::MathOverflow)?;
    to_u64(v / LAMPORTS_PER_SOL)
}

/// `live_level = 1 + count(i : tier_thresholds_usd[i] × 1e6 ≤ mcap_usd_e6)` (§6).
pub fn level_for(mcap_usd_e6: u64, thresholds_usd: &[u64; EVOLUTIONS]) -> u8 {
    let usd = mcap_usd_e6 as u128;
    let mut level = 1u8;
    for t in thresholds_usd.iter() {
        if (*t as u128) * USD_E6 <= usd {
            level += 1;
        }
    }
    level
}

/// §5.4: the 32 key bytes as a big-endian integer N, folded `r = (r × 256 + b) mod modulus`.
/// `modulus` must be below `VANITY_MODULUS_MAX` (2^56, enforced by `validate()`), so `r × 256 + 255` fits a u64.
pub fn vanity_residue(key: &[u8; 32], modulus: u64) -> u64 {
    if modulus == 0 {
        return 0;
    }
    let mut r: u64 = 0;
    for b in key.iter() {
        r = (r * 256 + *b as u64) % modulus;
    }
    r
}

/// The cosmetic "…mint" suffix filter (§5.4). `modulus == 0` turns it off.
pub fn passes_vanity(key: &[u8; 32], modulus: u64, residue: u64) -> bool {
    modulus == 0 || vanity_residue(key, modulus) == residue
}

pub fn bps(amount: u64, bps: u16) -> u64 {
    // amount × bps / 1e4 ≤ amount for bps ≤ 1e4; validate() caps protocol + royalty at 2,000.
    (amount as u128 * bps as u128 / BPS) as u64
}

/// Sale split (§7.7 step 4): `protocol = floor(price × protocol_bps / 1e4)`, `royalty = floor(price × royalty_bps /
/// 1e4)` (0 when the seller is the launcher), `seller_net = price − protocol − royalty`. For market.rs.
pub fn sale_splits(price: u64, protocol_fee_bps: u16, royalty_bps: u16, seller_is_launcher: bool) -> Result<(u64, u64, u64)> {
    let protocol = bps(price, protocol_fee_bps);
    let royalty = if seller_is_launcher { 0 } else { bps(price, royalty_bps) };
    let net = price
        .checked_sub(protocol)
        .and_then(|v| v.checked_sub(royalty))
        .ok_or(MintdexError::MathOverflow)?;
    Ok((protocol, royalty, net))
}

/// Fee bps a sale actually charges, compared with the `max_total_fee_bps` guard (§7.7, §7.9). For market.rs.
pub fn effective_fee_bps(protocol_fee_bps: u16, royalty_bps: u16, seller_is_launcher: bool) -> u32 {
    protocol_fee_bps as u32 + if seller_is_launcher { 0 } else { royalty_bps as u32 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;

    // ---------------------------------------------------------------- U1 curve market cap

    #[test]
    fn u1_curve_mcap_launch_and_completion() {
        // 1e15 × 1e9 / 1.073e15 = 0.932 SOL; values equal pump-sdk bondingCurveMarketCap (chain/sdk U1 mirror).
        assert_eq!(curve_market_cap(1_000_000_000_000_000, 1_000_000_000, 1_073_000_000_000_000).unwrap(), 931_966_449);
        assert_eq!(curve_market_cap(1_000_000_000_000_000, 3_833_511_973, 279_900_000_000_000).unwrap(), 13_696_005_619);
        assert_error(curve_market_cap(1_000_000_000_000_000, 1_000_000_000, 0), MintdexError::PoolRequired);
        assert_error(curve_market_cap(u64::MAX, u64::MAX, 1), MintdexError::MathOverflow);
    }

    // ---------------------------------------------------------------- U2 pool market cap

    #[test]
    fn u2_pool_mcap_right_after_migration() {
        // (2,235,361,845 + 583,150,127) × 1e15 / 206.9e12 ≈ 13.62 SOL (continuous with the curve's 13.70).
        let m = pool_market_cap(2_235_361_845, 583_150_127, 206_900_000_000_000, 1_000_000_000_000_000).unwrap();
        assert_eq!(m, 13_622_580_821);
        assert!(m > 13_620_000_000 && m < 13_630_000_000);
    }

    #[test]
    fn u2_pool_bounds() {
        let ok = |base: u64, vq: i128| pool_market_cap(2_235_361_845, vq, base, 1_000_000_000_000_000);
        assert_error(ok(999_999_999, 583_150_127), MintdexError::PoolTooThin);
        assert!(ok(1_000_000_000, 583_150_127).is_ok());
        assert_error(ok(206_900_000_000_000, -1), MintdexError::PoolMismatch);
        assert_error(ok(206_900_000_000_000, u64::MAX as i128 + 1), MintdexError::PoolMismatch);
        assert!(ok(206_900_000_000_000, 0).is_ok());
        assert_error(pool_market_cap(u64::MAX, u64::MAX as i128, 1_000_000_000, u64::MAX), MintdexError::MathOverflow);
    }

    // ---------------------------------------------------------------- U3 level_for

    #[test]
    fn u3_level_for_each_threshold_at_minus_zero_plus_one_micro_usd() {
        let t = TIER_THRESHOLDS_USD;
        assert_eq!(level_for(0, &t), 1);
        for (i, usd) in t.iter().enumerate() {
            let e6 = usd * 1_000_000;
            assert_eq!(level_for(e6 - 1, &t), i as u8 + 1, "threshold {i} minus 1");
            assert_eq!(level_for(e6, &t), i as u8 + 2, "threshold {i} exact");
            assert_eq!(level_for(e6 + 1, &t), i as u8 + 2, "threshold {i} plus 1");
        }
        assert_eq!(level_for(u64::MAX, &t), MAX_LEVEL);
    }

    #[test]
    fn u3_level_for_from_lamports_at_118_usd_times_100() {
        // Devnet calibration (§6): fixed $118, multiplier 100. For each threshold, the smallest market cap that
        // reaches it (ceil of the inverse) unlocks the level and one lamport less does not.
        let (price, mult) = (118_000_000u64, 100u16);
        let t = TIER_THRESHOLDS_USD;
        for (i, usd) in t.iter().enumerate() {
            let need = (*usd as u128) * 1_000_000 * 1_000_000_000;
            let denom = price as u128 * mult as u128;
            let min_mcap = ((need + denom - 1) / denom) as u64;
            let at = level_for(mcap_usd_e6(min_mcap, price, mult).unwrap(), &t);
            let below = level_for(mcap_usd_e6(min_mcap - 1, price, mult).unwrap(), &t);
            assert_eq!(at, i as u8 + 2, "threshold {i}");
            assert_eq!(below, i as u8 + 1, "threshold {i} minus one lamport");
        }
        // §6 table: launch 0.932 SOL = $11.0K (Spark); Surge needs ~1.27 SOL; Legend ~84.75 SOL.
        assert_eq!(level_for(mcap_usd_e6(931_966_449, price, mult).unwrap(), &t), 1);
        assert_eq!(mcap_usd_e6(931_966_449, price, mult).unwrap(), 10_997_204_098);
        assert_eq!(level_for(mcap_usd_e6(1_271_186_441, price, mult).unwrap(), &t), 2);
        assert_eq!(level_for(mcap_usd_e6(1_271_186_440, price, mult).unwrap(), &t), 1);
        assert_eq!(level_for(mcap_usd_e6(84_745_762_712, price, mult).unwrap(), &t), 14);
        // the devnet curve completion (13.696 SOL) is Apex (5)
        assert_eq!(level_for(mcap_usd_e6(13_696_005_619, price, mult).unwrap(), &t), 5);
        assert_error(mcap_usd_e6(u64::MAX, u64::MAX, 1000), MintdexError::MathOverflow);
    }

    #[test]
    fn headroom_constants() {
        assert_eq!(MAX_LEVEL, 14);
        assert_eq!(LEVEL_FIELD_HEADROOM, 1);
        assert_eq!(CARD_MINT_HEADROOM, 2);
        assert!(TIER_THRESHOLDS_USD.windows(2).all(|w| w[0] < w[1]));
    }

    // ---------------------------------------------------------------- U5 vanity residue

    const KNOWN_MINTS: [&str; 4] = [
        "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint",
        "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint",
        "DJVsyAxNpnULaP3cwoPb4jMfQjQwS9gRdPEugTzemint",
        "A1h3Bs3N4iKG5d7qGDPrZSeTzMdcuBrxhsa5xjUamint",
    ];

    fn b58_value(s: &str) -> u64 {
        const A: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        s.bytes().fold(0u64, |acc, c| acc * 58 + A.iter().position(|&x| x == c).unwrap() as u64)
    }

    #[test]
    fn u5_known_mints_pass_and_residue_is_mint() {
        let (m, r) = (58u64.pow(4), 8_725_513u64);
        assert_eq!(m, 11_316_496);
        assert_eq!(b58_value("mint"), r);
        for s in KNOWN_MINTS {
            let k = s.parse::<Pubkey>().unwrap().to_bytes();
            assert_eq!(vanity_residue(&k, m), r, "{s}");
            assert!(passes_vanity(&k, m, r));
        }
        // the program id does not end in "mint"
        assert!(!passes_vanity(&crate::ID.to_bytes(), m, r));
        // modulus 0 turns the filter off
        assert!(passes_vanity(&crate::ID.to_bytes(), 0, r));
    }

    #[test]
    fn u5_residue_agrees_with_bs58_for_10k_random_keys() {
        // For any key, N mod 58^k is the value of the last k base58 characters (k = 1, 2, 4), and the "mint"
        // check agrees with `ends_with("mint")` of the bs58 string.
        let mut rng = XorShift::new(0x5eed_0001);
        for _ in 0..10_000 {
            let k = rng.key();
            let s = Pubkey::new_from_array(k).to_string();
            for n in [1usize, 2, 4] {
                assert_eq!(vanity_residue(&k, 58u64.pow(n as u32)), b58_value(&s[s.len() - n..]), "{s} k={n}");
            }
            assert_eq!(passes_vanity(&k, 11_316_496, 8_725_513), s.ends_with("mint"), "{s}");
        }
    }

    /// F13 (document-only, design-tier §4): a WSOL donation `D` into the pool's quote account multiplies the pool market
    /// cap by `(Q + D) / Q` (linear, the WSOL is lost), a buy of `D` by about `((Q + D) / Q)^2` (quadratic, recovered by
    /// selling back minus fees). At mainnet-like reserves a donation always costs more than a round trip for the same
    /// move.
    #[test]
    fn f13_donation_is_linear_buy_is_quadratic() {
        const SOL: u64 = 1_000_000_000;
        let supply = 1_000_000_000_000_000u64; // 1e9 tokens, 6 decimals
        let virtual_quote = 17_584_505_288i128; // a fresh mainnet pool
        let (quote, base) = (85 * SOL, 206_900_000_000_000u64);
        let q = quote as u128 + virtual_quote as u128;
        let m0 = pool_market_cap(quote, virtual_quote, base, supply).unwrap();
        for d in [SOL / 10, SOL, 10 * SOL] {
            // donation: only the quote side moves
            let donated = pool_market_cap(quote + d, virtual_quote, base, supply).unwrap();
            let lin = m0 as u128 * (q + d as u128) / q;
            assert!(donated as u128 >= lin - 1 && donated as u128 <= lin + 1, "linear");
            // buy (no fee): constant product on the effective quote, so the base side shrinks too
            let k = q * base as u128;
            let base_after = (k / (q + d as u128)) as u64;
            let bought = pool_market_cap(quote + d, virtual_quote, base_after, supply).unwrap();
            let quad = m0 as u128 * (q + d as u128) * (q + d as u128) / (q * q);
            assert!((bought as u128).abs_diff(quad) * 1_000 <= quad, "quadratic within 0.1%");
            assert!(bought > donated, "a buy moves the market cap more than the same SOL donated");
            // the donation needed to match the buy's move is larger than the buy itself (and, unlike the buy, lost)
            let donation_to_match = (q as f64 * (bought as f64 / m0 as f64 - 1.0)) as u64;
            assert!(donation_to_match > d);
        }
    }
}
