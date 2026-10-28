//! SOL/USD (card-program-v2 §5.3) and the `set_price` rules (§7.1). Pyth PriceUpdateV2 is parsed by hand
//! (no Pyth crate, so no new dependency pins on rust 1.79).

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::state::Config;

/// The fields of a Pyth receiver PriceUpdateV2 account MintDex reads (verification level Full only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PythPrice {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub ema_price: i64,
}

/// Discriminator, `data[40] == 1` (Full; a Partial level shifts every later offset), SOL/USD feed id at 41..73,
/// then `price i64@73`, `conf u64@81`, `expo i32@89`, `publish_time i64@93`, `ema_price i64@109`.
pub fn parse_price_update_v2(data: &[u8]) -> Result<PythPrice> {
    require!(
        data.len() >= 117 && data[..8] == PRICE_UPDATE_V2_DISC,
        MintdexError::PriceFeedMismatch
    );
    require!(data[40] == 1, MintdexError::PriceTooUncertain);
    require!(data[41..73] == SOL_USD_FEED_ID, MintdexError::PriceFeedMismatch);
    let i64_at = |o: usize| i64::from_le_bytes(data[o..o + 8].try_into().unwrap());
    Ok(PythPrice {
        price: i64_at(73),
        conf: u64::from_le_bytes(data[81..89].try_into().unwrap()),
        expo: i32::from_le_bytes(data[89..93].try_into().unwrap()),
        publish_time: i64_at(93),
        ema_price: i64_at(109),
    })
}

/// `p × 10^(6+expo)` micro-USD; divides when `expo < −6` (floor). `expo` is within −12..=0.
pub fn scale_to_usd_e6(price: u64, expo: i32) -> Result<u64> {
    let shift = 6 + expo;
    if shift >= 0 {
        price
            .checked_mul(10u64.pow(shift as u32))
            .ok_or_else(|| error!(MintdexError::MathOverflow))
    } else {
        Ok(price / 10u64.pow((-shift) as u32))
    }
}

/// §5.3 checks on a decoded update; returns micro-USD from `min(price, ema_price)` (rev 1: the caller cannot pick
/// a favourable spot price out of the allowed window).
pub fn pyth_sol_usd_e6(p: &PythPrice, now: i64, max_age_secs: u32, max_conf_bps: u16) -> Result<u64> {
    require!(p.price > 0 && p.ema_price > 0, MintdexError::StalePrice);
    require!((-12..=0).contains(&p.expo), MintdexError::StalePrice);
    require!(max_age_secs > 0, MintdexError::InvalidConfig);
    require!(
        now.saturating_sub(p.publish_time) <= max_age_secs as i64,
        MintdexError::StalePrice
    );
    require!(
        (p.conf as u128) * 10_000 <= (p.price as u128) * (max_conf_bps as u128),
        MintdexError::PriceTooUncertain
    );
    scale_to_usd_e6(p.price.min(p.ema_price) as u64, p.expo)
}

/// The full Pyth read from an account: address = `expected` (config.pyth_price_account), owner = Pyth receiver.
pub fn pyth_sol_usd_e6_from_account(
    feed: &AccountInfo,
    expected: &Pubkey,
    now: i64,
    max_age_secs: u32,
    max_conf_bps: u16,
) -> Result<u64> {
    require!(
        feed.key == expected && *feed.owner == PYTH_RECEIVER_PROGRAM_ID,
        MintdexError::PriceFeedMismatch
    );
    let data = feed.try_borrow_data()?;
    let p = parse_price_update_v2(&data)?;
    pyth_sol_usd_e6(&p, now, max_age_secs, max_conf_bps)
}

/// True when a decodable SOL/USD PriceUpdateV2 at `feed` was published more than `max_age_secs` before `now` (review
/// round 2: a Pyth -> Admin switch during an outage treats such a feed as not passed). Anything else (an undecodable
/// account, a fresh but uncertain price) is false, so the caller's full read reports the precise error.
pub fn feed_too_old(feed: &AccountInfo, now: i64, max_age_secs: u32) -> bool {
    let Ok(data) = feed.try_borrow_data() else { return false };
    match parse_price_update_v2(&data) {
        Ok(p) => now.saturating_sub(p.publish_time) > max_age_secs as i64,
        Err(_) => false,
    }
}

/// `price_source = Admin`: `sol_usd_e6`, stale when `now − updated_at > max_price_age_secs` unless that is 0
/// (devnet: fixed $118, age 0).
pub fn admin_sol_usd_e6(cfg: &Config, now: i64) -> Result<u64> {
    require!(
        cfg.max_price_age_secs == 0 || now.saturating_sub(cfg.sol_usd_updated_at) <= cfg.max_price_age_secs as i64,
        MintdexError::StalePrice
    );
    require!(cfg.sol_usd_e6 > 0, MintdexError::StalePrice);
    Ok(cfg.sol_usd_e6)
}

/// The evolve price (§5.3): the admin price, or Pyth (feed required; `PriceFeedMismatch` when absent).
pub fn sol_usd_e6(cfg: &Config, price_feed: Option<&AccountInfo>, now: i64) -> Result<u64> {
    if cfg.price_source == PRICE_SOURCE_PYTH {
        let feed = price_feed.ok_or_else(|| error!(MintdexError::PriceFeedMismatch))?;
        pyth_sol_usd_e6_from_account(feed, &cfg.pyth_price_account, now, cfg.max_price_age_secs, cfg.max_conf_bps)
    } else {
        admin_sol_usd_e6(cfg, now)
    }
}

/// `set_price` rules (§7.1, rev 1; fix pack F6 + admin B1). With `tier_guard` off the admin is unbounded (devnet).
/// Otherwise the signer is the admin or the `price_authority` (when set), the source must be Admin, the price may
/// move at most once per `min_price_interval_secs` and by at most `max_price_step_bps` of the current price, and
/// with the guard on it must also stay within +10% / -50% of the last recorded Pyth price (`PriceBaselineMissing`
/// when none is recorded), so bounded steps cannot compound away from the market. A zero price is never accepted.
pub fn check_set_price(cfg: &Config, signer: &Pubkey, new_price: u64, now: i64) -> Result<()> {
    require!(new_price > 0, MintdexError::InvalidConfig);
    let is_admin = *signer == cfg.admin;
    if is_admin && cfg.tier_guard == 0 {
        return Ok(());
    }
    require!(
        is_admin || (cfg.price_authority != Pubkey::default() && *signer == cfg.price_authority),
        MintdexError::Unauthorized
    );
    require!(cfg.price_source == PRICE_SOURCE_ADMIN, MintdexError::Unauthorized);
    // the missing baseline first: unlike the interval, it does not go away by waiting
    require!(cfg.tier_guard == 0 || cfg.last_pyth_sol_usd_e6 != 0, MintdexError::PriceBaselineMissing);
    require!(
        now.saturating_sub(cfg.sol_usd_updated_at) >= cfg.min_price_interval_secs as i64,
        MintdexError::PriceTooSoon
    );
    let diff = cfg.sol_usd_e6.abs_diff(new_price) as u128;
    require!(
        diff * 10_000 <= cfg.sol_usd_e6 as u128 * cfg.max_price_step_bps as u128,
        MintdexError::PriceStepTooLarge
    );
    if cfg.tier_guard != 0 {
        require!(within_pyth_anchor(new_price, cfg.last_pyth_sol_usd_e6), MintdexError::PriceStepTooLarge);
    }
    Ok(())
}

/// admin B1: `last_pyth / 2 <= price <= last_pyth × 1.10` (in bps of the last recorded Pyth price).
pub fn within_pyth_anchor(price: u64, last_pyth: u64) -> bool {
    let (p, l) = (price as u128 * 10_000, last_pyth as u128);
    p <= l * (10_000 + ADMIN_PRICE_MAX_ABOVE_PYTH_BPS as u128) && p >= l * (10_000 - ADMIN_PRICE_MAX_BELOW_PYTH_BPS as u128)
}

/// Switching Pyth → Admin must start within ±10% of the last recorded Pyth price. F4: false when no Pyth price is
/// recorded (the caller reports `PriceBaselineMissing` first).
pub fn within_switch_band(new_price: u64, last_pyth: u64) -> bool {
    last_pyth != 0
        && (new_price.abs_diff(last_pyth) as u128) * 10_000 <= last_pyth as u128 * ADMIN_SWITCH_MAX_DEVIATION_BPS as u128
}

/// The baseline `initialize` records (F4): the feed's price when one is passed (owner, address, discriminator, Full
/// level, feed id, age, confidence, `min(price, ema)`), else 0, and under the Pyth source a feed is required
/// (`PriceFeedMismatch`).
pub fn initial_baseline(price_source: u8, feed: Option<&AccountInfo>, feed_address: &Pubkey, now: i64, max_age_secs: u32, max_conf_bps: u16) -> Result<u64> {
    match feed {
        Some(f) => {
            let max_age = if max_age_secs > 0 { max_age_secs } else { PYTH_RECORD_DEFAULT_MAX_AGE_SECS };
            pyth_sol_usd_e6_from_account(f, feed_address, now, max_age, max_conf_bps)
        }
        None => {
            require!(price_source != PRICE_SOURCE_PYTH, MintdexError::PriceFeedMismatch);
            Ok(0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::tests::devnet_config;
    use crate::test_utils::*;

    // ---------------------------------------------------------------- U6 Pyth decode

    #[test]
    fn u6_pyth_fixture_decode() {
        let f = fixture!("pyth.sol_usd");
        assert_eq!(f.pubkey.to_string(), "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
        assert_eq!(f.owner, PYTH_RECEIVER_PROGRAM_ID);
        assert_eq!(f.data.len(), 134);
        let p = parse_price_update_v2(&f.data).unwrap();
        assert_eq!(
            p,
            PythPrice { price: 11_803_980_193, conf: 2_061_007, expo: -8, publish_time: 1_790_971_315, ema_price: 11_831_752_120 }
        );
        // min(price, ema) = price here: $118.03980193 → 118,039,801 micro-USD (floor)
        let now = p.publish_time + 30;
        assert_eq!(pyth_sol_usd_e6(&p, now, 60, 200).unwrap(), 118_039_801);
        // ema below price: ema wins
        let low_ema = PythPrice { ema_price: 11_700_000_000, ..p };
        assert_eq!(pyth_sol_usd_e6(&low_ema, now, 60, 200).unwrap(), 117_000_000);
    }

    #[test]
    fn u6_stale_and_wide_conf_rejected() {
        let p = parse_price_update_v2(&fixture!("pyth.sol_usd").data).unwrap();
        let t = p.publish_time;
        assert!(pyth_sol_usd_e6(&p, t + 60, 60, 200).is_ok());
        assert_error(pyth_sol_usd_e6(&p, t + 61, 60, 200), MintdexError::StalePrice);
        // conf 2,061,007 × 1e4 vs price × bps: 1 bp is too tight, 2 bps is enough
        assert_error(pyth_sol_usd_e6(&p, t, 60, 1), MintdexError::PriceTooUncertain);
        assert!(pyth_sol_usd_e6(&p, t, 60, 2).is_ok());
        assert_error(pyth_sol_usd_e6(&PythPrice { price: 0, ..p }, t, 60, 200), MintdexError::StalePrice);
        assert_error(pyth_sol_usd_e6(&PythPrice { ema_price: -1, ..p }, t, 60, 200), MintdexError::StalePrice);
        assert_error(pyth_sol_usd_e6(&PythPrice { expo: 1, ..p }, t, 60, 200), MintdexError::StalePrice);
        assert_error(pyth_sol_usd_e6(&PythPrice { expo: -13, ..p }, t, 60, 200), MintdexError::StalePrice);
        assert_error(pyth_sol_usd_e6(&p, t, 0, 200), MintdexError::InvalidConfig);
    }

    #[test]
    fn u6_bad_accounts_rejected() {
        let f = fixture!("pyth.sol_usd");
        let mut partial = f.data.clone();
        partial[40] = 0;
        assert_error(parse_price_update_v2(&partial), MintdexError::PriceTooUncertain);
        let mut feed = f.data.clone();
        feed[41] ^= 1;
        assert_error(parse_price_update_v2(&feed), MintdexError::PriceFeedMismatch);
        let mut disc = f.data.clone();
        disc[0] ^= 1;
        assert_error(parse_price_update_v2(&disc), MintdexError::PriceFeedMismatch);
        assert_error(parse_price_update_v2(&f.data[..116]), MintdexError::PriceFeedMismatch);
    }

    /// Review round 2: a Pyth -> Admin switch treats a feed older than the max age as not passed; anything else that
    /// is wrong with the feed is left to the full read (false here).
    #[test]
    fn feed_too_old_only_by_publish_time() {
        let f = fixture!("pyth.sol_usd");
        let t = parse_price_update_v2(&f.data).unwrap().publish_time;
        let check = |mut data: Vec<u8>, now: i64| {
            let mut lamports = 1u64;
            let info = AccountInfo::new(&f.pubkey, false, false, &mut lamports, &mut data, &f.owner, false, 0);
            feed_too_old(&info, now, 120)
        };
        assert!(!check(f.data.clone(), t + 120));
        assert!(check(f.data.clone(), t + 121));
        // an undecodable account or a Partial verification is never "too old" (the full read reports it)
        let mut partial = f.data.clone();
        partial[40] = 0;
        assert!(!check(partial, t + 10_000));
        assert!(!check(f.data[..100].to_vec(), t + 10_000));
        assert!(!check(Vec::new(), t + 10_000));
    }

    #[test]
    fn scaling() {
        assert_eq!(scale_to_usd_e6(11_803_980_193, -8).unwrap(), 118_039_801);
        assert_eq!(scale_to_usd_e6(118, 0).unwrap(), 118_000_000);
        assert_eq!(scale_to_usd_e6(118_000_000, -6).unwrap(), 118_000_000);
        assert_eq!(scale_to_usd_e6(1_180_000_000_000, -10).unwrap(), 118_000_000);
        assert_eq!(scale_to_usd_e6(u64::MAX, -12).unwrap(), u64::MAX / 1_000_000);
        assert_error(scale_to_usd_e6(u64::MAX, 0), MintdexError::MathOverflow);
    }

    #[test]
    fn admin_price_staleness() {
        let mut c = devnet_config();
        c.sol_usd_updated_at = 1_000;
        assert_eq!(admin_sol_usd_e6(&c, 1_000_000_000).unwrap(), 118_000_000); // age 0 = no check (devnet)
        c.max_price_age_secs = 60;
        assert!(admin_sol_usd_e6(&c, 1_060).is_ok());
        assert_error(admin_sol_usd_e6(&c, 1_061), MintdexError::StalePrice);
        assert_error(sol_usd_e6(&Config { price_source: PRICE_SOURCE_PYTH, ..c.clone() }, None, 1_000), MintdexError::PriceFeedMismatch);
    }

    // ---------------------------------------------------------------- U9 set_price

    fn with_price_authority() -> (Config, Pubkey) {
        let mut c = devnet_config();
        let pa = Pubkey::new_unique();
        c.price_authority = pa;
        c.min_price_interval_secs = 300;
        c.max_price_step_bps = 2_000;
        c.sol_usd_updated_at = 10_000;
        (c, pa)
    }

    /// What the instruction does after the check passes.
    fn apply(c: &mut Config, p: u64, now: i64) {
        c.sol_usd_e6 = p;
        c.sol_usd_updated_at = now;
    }

    #[test]
    fn u9_admin_is_unbounded() {
        let (mut c, _) = with_price_authority();
        let admin = c.admin;
        for (i, p) in [1u64, 10_000_000_000, 5].into_iter().enumerate() {
            check_set_price(&c, &admin, p, 10_000 + i as i64).unwrap();
            apply(&mut c, p, 10_000 + i as i64);
        }
        c.price_source = PRICE_SOURCE_PYTH;
        check_set_price(&c, &admin, 7, 10_010).unwrap();
        assert_error(check_set_price(&c, &admin, 0, 10_010), MintdexError::InvalidConfig);
    }

    #[test]
    fn u9_price_authority_rules() {
        let (c, pa) = with_price_authority();
        // rejected while Pyth is the source
        let pyth = Config { price_source: PRICE_SOURCE_PYTH, ..c.clone() };
        assert_error(check_set_price(&pyth, &pa, 118_000_000, 20_000), MintdexError::Unauthorized);
        // rejected within min_price_interval_secs of the last update
        assert_error(check_set_price(&c, &pa, 120_000_000, 10_299), MintdexError::PriceTooSoon);
        assert!(check_set_price(&c, &pa, 120_000_000, 10_300).is_ok());
        // limited per step: 20% of 118 = 23.6
        assert!(check_set_price(&c, &pa, 141_600_000, 10_300).is_ok());
        assert_error(check_set_price(&c, &pa, 141_600_001, 10_300), MintdexError::PriceStepTooLarge);
        assert!(check_set_price(&c, &pa, 94_400_000, 10_300).is_ok());
        assert_error(check_set_price(&c, &pa, 94_399_999, 10_300), MintdexError::PriceStepTooLarge);
        // anyone else, or no price authority configured
        assert_error(check_set_price(&c, &Pubkey::new_unique(), 118_000_000, 20_000), MintdexError::Unauthorized);
        let none = Config { price_authority: Pubkey::default(), ..c.clone() };
        assert_error(check_set_price(&none, &Pubkey::default(), 118_000_000, 20_000), MintdexError::Unauthorized);
    }

    #[test]
    fn u9_twenty_calls_in_one_tx_move_at_most_one_step() {
        let (mut c, pa) = with_price_authority();
        let now = 50_000; // one tx: every call sees the same clock
        let start = c.sol_usd_e6;
        let mut accepted = 0;
        for _ in 0..20 {
            let next = c.sol_usd_e6 * 12 / 10; // +20% each time
            if check_set_price(&c, &pa, next, now).is_ok() {
                apply(&mut c, next, now);
                accepted += 1;
            }
        }
        assert_eq!(accepted, 1);
        assert_eq!(c.sol_usd_e6, start * 12 / 10);
        // the next step needs another interval
        assert_error(check_set_price(&c, &pa, c.sol_usd_e6, now + 299), MintdexError::PriceTooSoon);
        assert!(check_set_price(&c, &pa, c.sol_usd_e6, now + 300).is_ok());
    }

    #[test]
    fn switch_band() {
        // F4: no recorded baseline fails closed
        assert!(!within_switch_band(118_000_000, 0));
        assert!(within_switch_band(110_000_000, 100_000_000));
        assert!(within_switch_band(90_000_000, 100_000_000));
        assert!(!within_switch_band(110_000_001, 100_000_000));
        assert!(!within_switch_band(89_999_999, 100_000_000));
    }

    // ---------------------------------------------------------------- F6 / admin B1: set_price under the guard

    fn guarded() -> Config {
        let mut c = devnet_config();
        c.tier_guard = 1;
        c.price_source = PRICE_SOURCE_ADMIN;
        c.min_price_interval_secs = 300;
        c.max_price_step_bps = 2_000;
        c.sol_usd_e6 = 120_000_000;
        c.last_pyth_sol_usd_e6 = 120_000_000;
        c.sol_usd_updated_at = 10_000;
        c
    }

    #[test]
    fn set_price_under_the_guard() {
        let c = guarded();
        let admin = c.admin;
        // the admin is bounded now: interval, step, anchor
        assert_error(check_set_price(&c, &admin, 130_000_000, 10_299), MintdexError::PriceTooSoon);
        assert!(check_set_price(&c, &admin, 132_000_000, 10_300).is_ok()); // +10% = the anchor's top
        assert_error(check_set_price(&c, &admin, 132_000_001, 10_300), MintdexError::PriceStepTooLarge);
        assert!(check_set_price(&c, &admin, 96_000_000, 10_300).is_ok()); // -20% step
        assert_error(check_set_price(&c, &admin, 95_999_999, 10_300), MintdexError::PriceStepTooLarge);
        // under the Pyth source nobody sets the price
        let pyth = Config { price_source: PRICE_SOURCE_PYTH, ..c.clone() };
        assert_error(check_set_price(&pyth, &admin, 120_000_000, 20_000), MintdexError::Unauthorized);
        // no recorded Pyth price: no anchor, no set_price
        let nobase = Config { last_pyth_sol_usd_e6: 0, ..c.clone() };
        assert_error(check_set_price(&nobase, &admin, 120_000_000, 20_000), MintdexError::PriceBaselineMissing);
        // reported before a transient PriceTooSoon
        assert_error(check_set_price(&nobase, &admin, 120_000_000, 10_001), MintdexError::PriceBaselineMissing);
        // a stranger stays unauthorized
        assert_error(check_set_price(&c, &Pubkey::new_unique(), 120_000_000, 20_000), MintdexError::Unauthorized);
        // the anchor's bottom: 50% of the last Pyth price, reachable only in 20% steps
        let low = Config { sol_usd_e6: 70_000_000, ..c.clone() };
        assert!(check_set_price(&low, &admin, 60_000_000, 10_300).is_ok());
        assert_error(check_set_price(&low, &admin, 59_999_999, 10_300), MintdexError::PriceStepTooLarge);
    }

    #[test]
    fn anchored_steps_never_exceed_last_pyth_plus_10_percent() {
        // 12 bounded calls over 3,600 s, each asking +20%: the price never passes last_pyth x 1.10
        let mut c = guarded();
        let admin = c.admin;
        let cap = c.last_pyth_sol_usd_e6 * 11 / 10;
        for i in 1..=12 {
            let now = 10_000 + 300 * i;
            let ask = c.sol_usd_e6 * 12 / 10;
            let next = if check_set_price(&c, &admin, ask, now).is_ok() { ask } else { cap.min(ask) };
            if check_set_price(&c, &admin, next, now).is_ok() {
                apply(&mut c, next, now);
            }
            assert!(c.sol_usd_e6 <= cap, "call {i}: {} > {cap}", c.sol_usd_e6);
        }
        assert_eq!(c.sol_usd_e6, cap);
        // 20 calls in one tx (one clock) move at most one step, still under the anchor
        let mut d = guarded();
        let mut accepted = 0;
        for _ in 0..20 {
            let next = d.sol_usd_e6 * 105 / 100;
            if check_set_price(&d, &admin, next, 50_000).is_ok() {
                apply(&mut d, next, 50_000);
                accepted += 1;
            }
        }
        assert_eq!(accepted, 1);
        assert!(d.sol_usd_e6 <= d.last_pyth_sol_usd_e6 * 11 / 10);
    }

    #[test]
    fn f4_initial_baseline() {
        let f = fixture!("pyth.sol_usd");
        let p = parse_price_update_v2(&f.data).unwrap();
        // Admin source without a feed: baseline 0; Pyth without a feed: PriceFeedMismatch
        assert_eq!(initial_baseline(PRICE_SOURCE_ADMIN, None, &f.pubkey, 0, 0, 200).unwrap(), 0);
        assert_error(initial_baseline(PRICE_SOURCE_PYTH, None, &f.pubkey, 0, 120, 200), MintdexError::PriceFeedMismatch);
        // with the fixture (min(price, ema)) and a fresh clock; stale -> StalePrice
        let (mut lamports, mut data) = (f.lamports, f.data.clone());
        let info = AccountInfo::new(&f.pubkey, false, false, &mut lamports, &mut data, &f.owner, false, 0);
        assert_eq!(initial_baseline(PRICE_SOURCE_PYTH, Some(&info), &f.pubkey, p.publish_time + 10, 120, 200).unwrap(), 118_039_801);
        assert_error(
            initial_baseline(PRICE_SOURCE_PYTH, Some(&info), &f.pubkey, p.publish_time + 121, 120, 200),
            MintdexError::StalePrice,
        );
        // max age 0 (Admin source) records with the 60 s default
        assert!(initial_baseline(PRICE_SOURCE_ADMIN, Some(&info), &f.pubkey, p.publish_time + 60, 0, 200).is_ok());
        assert_error(initial_baseline(PRICE_SOURCE_ADMIN, Some(&info), &f.pubkey, p.publish_time + 61, 0, 200), MintdexError::StalePrice);
        // a feed at another address
        assert_error(
            initial_baseline(PRICE_SOURCE_PYTH, Some(&info), &Pubkey::new_unique(), p.publish_time, 120, 200),
            MintdexError::PriceFeedMismatch,
        );
    }

    #[test]
    fn u6_mainnet_age_120() {
        let p = parse_price_update_v2(&fixture!("pyth.sol_usd").data).unwrap();
        assert!(pyth_sol_usd_e6(&p, p.publish_time + 120, 120, 200).is_ok());
        assert_error(pyth_sol_usd_e6(&p, p.publish_time + 121, 120, 200), MintdexError::StalePrice);
    }

    #[test]
    fn anchor_band_edges() {
        assert!(within_pyth_anchor(110, 100) && !within_pyth_anchor(111, 100));
        assert!(within_pyth_anchor(50, 100) && !within_pyth_anchor(49, 100));
        assert!(!within_pyth_anchor(1, 0) && within_pyth_anchor(0, 0));
    }
}
