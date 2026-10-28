//! Accounts (card-program-v2 §4): `Config` 552 B, `Card` 264 B, `Bid` 98 B, `Listing` 108 B (§18.9), `Ticket` 10 B,
//! `ObserverSet` 316 B (fix-plan §2.2), borsh fields in the spec order (the byte offsets in §4 include the 8-byte
//! discriminator, for memcmp filters). The mainnet fix pack carved its Config and Card fields out of the reserved
//! bytes (no realloc): every carved field reads as "off" on accounts written before it.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::math::EVOLUTIONS;

#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    pub version: u8,
    pub bump: u8,
    /// bit0 REGISTER, bit1 EVOLVE, bit2 MARKET (bids, lists, sales)
    pub paused: u8,
    /// 0 = admin price, 1 = Pyth PriceUpdateV2
    pub price_source: u8,
    pub admin: Pubkey,
    /// Two-step admin transfer (default = none).
    pub pending_admin: Pubkey,
    /// Default = none. Dedicated key, rate-limited (§7.1).
    pub price_authority: Pubkey,
    /// Protocol fees, launch fees, ticket refunds.
    pub treasury: Pubkey,
    pub pyth_price_account: Pubkey,
    pub launch_fee: u64,
    /// Also the minimum list price.
    pub min_bid: u64,
    pub protocol_fee_bps: u16,
    pub creator_royalty_bps: u16,
    /// Pyth conf / price ceiling.
    pub max_conf_bps: u16,
    /// Per allowed `set_price` by the price authority (the admin is unbounded).
    pub max_price_step_bps: u16,
    /// 1 on mainnet; 100 on devnet (§6).
    pub mcap_multiplier: u16,
    /// bit0 curve leg, bit1 AMM leg, bit2 vault-WSOL close leg.
    pub sweep_flags: u8,
    pub card_uri_base_len: u8,
    /// Admin price, micro-USD per SOL.
    pub sol_usd_e6: u64,
    pub sol_usd_updated_at: i64,
    /// 0 = no staleness check (Admin source only).
    pub max_price_age_secs: u32,
    /// ≥ HOLD_FLOOR_SLOTS (150).
    pub evolve_hold_slots: u32,
    /// 58^4 = 11,316,496 ("mint"); 0 = check off (cosmetic filter only).
    pub vanity_modulus: u64,
    pub vanity_residue: u64,
    /// Whole USD for levels 2..=14.
    pub tier_thresholds_usd: [u64; EVOLUTIONS],
    pub card_uri_base: [u8; 64],
    /// Coin metadata URI binding base (§7.2).
    pub coin_uri_base: [u8; 64],
    pub coin_uri_base_len: u8,
    /// Observations needed to confirm, including the confirming call.
    pub evolve_min_obs: u8,
    /// Max levels gained per confirm.
    pub evolve_max_step: u8,
    pub _pad: u8,
    /// The price authority may move the price at most once per interval.
    pub min_price_interval_secs: u32,
    /// Last Pyth price seen by an admin instruction; switching to Admin must start within ±10% of it.
    pub last_pyth_sol_usd_e6: u64,
    // ---- fix pack (fix-plan §2.2): carved out of `reserved: [u8; 64]` @488, all zero on older Configs
    /// @488. 0 = open mode (anyone's `evolve` counts); 1..=8 = attested mode and the distinct observers a window needs
    /// (F1). Written only by `set_observers`.
    pub evolve_min_observers: u8,
    /// @489. bit0 `REG_NO_TOKEN2022`, bit1 `REG_REQUIRE_COLLECTION` (F9, F8). `set_config_ext`.
    pub register_flags: u8,
    /// @490. 1 = the tier, price, fee and card-URI fields change only through `update_tier_config` (F6).
    pub tier_guard: u8,
    /// @491. Metaplex `seller_fee_basis_points` of collection cards, 0..=1,000 (F8). `set_config_ext`.
    pub outside_royalty_bps: u16,
    /// @493. May issue (flags 0, within `ticket_allowance`) and revoke tickets (F12). Default = none.
    pub ticket_authority: Pubkey,
    /// @525. Tickets the ticket authority may still issue (admin B11); refilled by `set_config_ext`.
    pub ticket_allowance: u16,
    /// @527. The slot of the last `set_paused` that cleared PAUSE_EVOLVE (0 = never). Every observation is refused
    /// while EVOLVE is paused, so nobody could see a dip then: a window opened before this slot restarts on its next
    /// observation instead of carrying its counts across the pause (review round 2, continuous hold).
    pub evolve_resumed_slot: u64,
    /// @535.
    pub reserved: [u8; 17],
}

const _: () = assert!(8 + Config::INIT_SPACE == Config::LEN);

impl Config {
    pub const LEN: usize = 552;
    pub const VERSION: u8 = 1;

    pub fn card_uri_base(&self) -> &[u8] {
        &self.card_uri_base[..(self.card_uri_base_len as usize).min(URI_BASE_MAX)]
    }

    pub fn coin_uri_base(&self) -> &[u8] {
        &self.coin_uri_base[..(self.coin_uri_base_len as usize).min(URI_BASE_MAX)]
    }

    pub fn is_paused(&self, flag: u8) -> bool {
        self.paused & flag != 0
    }

    /// The admin-settable fields as `ConfigParams` (the inverse of `apply`; URI bases rebuilt from their bytes).
    pub fn params(&self) -> Result<ConfigParams> {
        let s = |b: &[u8]| core::str::from_utf8(b).map(str::to_string).map_err(|_| error!(MintdexError::InvalidConfig));
        Ok(ConfigParams {
            paused: self.paused,
            price_source: self.price_source,
            price_authority: self.price_authority,
            treasury: self.treasury,
            pyth_price_account: self.pyth_price_account,
            launch_fee: self.launch_fee,
            min_bid: self.min_bid,
            protocol_fee_bps: self.protocol_fee_bps,
            creator_royalty_bps: self.creator_royalty_bps,
            max_conf_bps: self.max_conf_bps,
            max_price_step_bps: self.max_price_step_bps,
            mcap_multiplier: self.mcap_multiplier,
            sweep_flags: self.sweep_flags,
            sol_usd_e6: self.sol_usd_e6,
            max_price_age_secs: self.max_price_age_secs,
            evolve_hold_slots: self.evolve_hold_slots,
            vanity_modulus: self.vanity_modulus,
            vanity_residue: self.vanity_residue,
            tier_thresholds_usd: self.tier_thresholds_usd,
            card_uri_base: s(self.card_uri_base())?,
            coin_uri_base: s(self.coin_uri_base())?,
            evolve_min_obs: self.evolve_min_obs,
            evolve_max_step: self.evolve_max_step,
            min_price_interval_secs: self.min_price_interval_secs,
        })
    }

    /// Zeroes every field the fix pack carved out of the reserved bytes (`initialize`; `apply` never touches them).
    pub fn zero_ext(&mut self) {
        self.evolve_min_observers = 0;
        self.register_flags = 0;
        self.tier_guard = 0;
        self.outside_royalty_bps = 0;
        self.ticket_authority = Pubkey::default();
        self.ticket_allowance = 0;
        self.evolve_resumed_slot = 0;
        self.reserved = [0; 17];
    }

    /// Copies every admin-settable field (everything except version, bump, admin, pending_admin,
    /// sol_usd_updated_at, last_pyth_sol_usd_e6, the fix-pack fields and `paused`). Call `params.validate()` first.
    /// `paused` is written only by `initialize` and `set_paused` (set and clear masks): a Config snapshot taken before
    /// an emergency pause can never clear it when its proposal executes later (review round 2).
    pub fn apply(&mut self, p: &ConfigParams) {
        self.price_source = p.price_source;
        self.price_authority = p.price_authority;
        self.treasury = p.treasury;
        self.pyth_price_account = p.pyth_price_account;
        self.launch_fee = p.launch_fee;
        self.min_bid = p.min_bid;
        self.protocol_fee_bps = p.protocol_fee_bps;
        self.creator_royalty_bps = p.creator_royalty_bps;
        self.max_conf_bps = p.max_conf_bps;
        self.max_price_step_bps = p.max_price_step_bps;
        self.mcap_multiplier = p.mcap_multiplier;
        self.sweep_flags = p.sweep_flags;
        self.sol_usd_e6 = p.sol_usd_e6;
        self.max_price_age_secs = p.max_price_age_secs;
        self.evolve_hold_slots = p.evolve_hold_slots;
        self.vanity_modulus = p.vanity_modulus;
        self.vanity_residue = p.vanity_residue;
        self.tier_thresholds_usd = p.tier_thresholds_usd;
        let (card, card_len) = pad64(&p.card_uri_base);
        self.card_uri_base = card;
        self.card_uri_base_len = card_len;
        let (coin, coin_len) = pad64(&p.coin_uri_base);
        self.coin_uri_base = coin;
        self.coin_uri_base_len = coin_len;
        self.evolve_min_obs = p.evolve_min_obs;
        self.evolve_max_step = p.evolve_max_step;
        self.min_price_interval_secs = p.min_price_interval_secs;
    }
}

fn pad64(s: &str) -> ([u8; 64], u8) {
    let mut out = [0u8; 64];
    let n = s.len().min(URI_BASE_MAX);
    out[..n].copy_from_slice(&s.as_bytes()[..n]);
    (out, n as u8)
}

/// What `initialize` / `update_config` set: the Config fields an admin can change, in Config order
/// (matches the SDK placeholder IDL).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConfigParams {
    pub paused: u8,
    pub price_source: u8,
    pub price_authority: Pubkey,
    pub treasury: Pubkey,
    pub pyth_price_account: Pubkey,
    pub launch_fee: u64,
    pub min_bid: u64,
    pub protocol_fee_bps: u16,
    pub creator_royalty_bps: u16,
    pub max_conf_bps: u16,
    pub max_price_step_bps: u16,
    pub mcap_multiplier: u16,
    pub sweep_flags: u8,
    pub sol_usd_e6: u64,
    pub max_price_age_secs: u32,
    pub evolve_hold_slots: u32,
    pub vanity_modulus: u64,
    pub vanity_residue: u64,
    pub tier_thresholds_usd: [u64; EVOLUTIONS],
    pub card_uri_base: String,
    pub coin_uri_base: String,
    pub evolve_min_obs: u8,
    pub evolve_max_step: u8,
    pub min_price_interval_secs: u32,
}

impl ConfigParams {
    /// §4.1 `validate()`, plus a few range checks the spec implies (recorded in §18.2): known flag bits only,
    /// a positive admin price, and a vanity residue below its modulus. `rent0` is `Rent::minimum_balance(0)`.
    /// The treasury balance rule (≥ rent0) needs the account and is checked by the instruction.
    pub fn validate(&self, rent0: u64) -> Result<()> {
        require!(self.is_valid(rent0), MintdexError::InvalidConfig);
        Ok(())
    }

    /// Rules every config must keep while `tier_guard` is on (admin §3.4 step 3, admin B8): a price interval of at
    /// least 60 s, a step of at most 20%, and under the Admin source no staleness window shorter than one interval
    /// plus 60 s (0 = no staleness check).
    pub fn guard_rules_ok(&self) -> bool {
        self.min_price_interval_secs >= GUARD_MIN_PRICE_INTERVAL_SECS
            && self.max_price_step_bps <= GUARD_MAX_PRICE_STEP_BPS
            && (self.price_source != PRICE_SOURCE_ADMIN
                || self.max_price_age_secs == 0
                || self.max_price_age_secs as u64 >= self.min_price_interval_secs as u64 + GUARD_MAX_AGE_MARGIN_SECS as u64)
    }

    /// The rules of `validate()` as one predicate (one error site keeps the .so small).
    pub fn is_valid(&self, rent0: u64) -> bool {
        let t = &self.tier_thresholds_usd;
        let uri_ok = |b: &String| b.starts_with("https://") && b.len() <= URI_BASE_MAX;
        // Sale payouts to an empty treasury or launcher wallet must not fail the sale (G2): at min_bid both the
        // protocol fee and (when royalty > 0) the royalty are at least rent(0).
        let at_min = |bps: u16| (self.min_bid as u128 * bps as u128 / 10_000) as u64;
        self.paused & !PAUSE_ALL == 0
            && self.sweep_flags & !SWEEP_ALL == 0
            && self.price_source <= PRICE_SOURCE_PYTH
            && self.protocol_fee_bps as u32 + self.creator_royalty_bps as u32 <= 2_000
            && t[0] > 0
            && t.windows(2).all(|w| w[0] < w[1])
            && (1..=1_000).contains(&self.mcap_multiplier)
            && uri_ok(&self.card_uri_base)
            && uri_ok(&self.coin_uri_base)
            // Pyth: the pinned sponsored SOL/USD account (admin B13) and a 1..=300 s age (F3 bound)
            && if self.price_source == PRICE_SOURCE_PYTH {
                self.pyth_price_account == PYTH_SOL_USD_FEED && (1..=PYTH_MAX_AGE_CAP_SECS).contains(&self.max_price_age_secs)
            } else {
                self.sol_usd_e6 > 0
            }
            && self.evolve_hold_slots >= HOLD_FLOOR_SLOTS
            && (2..=8).contains(&self.evolve_min_obs)
            && (1..=13).contains(&self.evolve_max_step)
            && (self.price_authority == Pubkey::default() || self.min_price_interval_secs >= 60)
            && self.vanity_modulus < VANITY_MODULUS_MAX
            && (self.vanity_modulus == 0 || self.vanity_residue < self.vanity_modulus)
            && self.launch_fee <= LAUNCH_FEE_MAX
            // F11: a 0 protocol fee is allowed; otherwise its fee at min_bid must still pay an empty treasury's rent
            && (self.protocol_fee_bps == 0 || at_min(self.protocol_fee_bps) >= rent0)
            && (self.creator_royalty_bps == 0 || at_min(self.creator_royalty_bps) >= rent0)
    }
}

/// F6: true when `p` leaves every field guarded by `tier_guard` unchanged (17 fields: the tier ladder, the price
/// source and its limits, the hold rule, the card URI base and the three fees).
pub fn tier_fields_equal(c: &Config, p: &ConfigParams) -> bool {
    c.tier_thresholds_usd == p.tier_thresholds_usd
        && c.mcap_multiplier == p.mcap_multiplier
        && c.price_source == p.price_source
        && c.sol_usd_e6 == p.sol_usd_e6
        && c.pyth_price_account == p.pyth_price_account
        && c.max_price_age_secs == p.max_price_age_secs
        && c.max_conf_bps == p.max_conf_bps
        && c.price_authority == p.price_authority
        && c.max_price_step_bps == p.max_price_step_bps
        && c.min_price_interval_secs == p.min_price_interval_secs
        && c.evolve_hold_slots == p.evolve_hold_slots
        && c.evolve_min_obs == p.evolve_min_obs
        && c.evolve_max_step == p.evolve_max_step
        && c.card_uri_base() == p.card_uri_base.as_bytes()
        && c.launch_fee == p.launch_fee
        && c.protocol_fee_bps == p.protocol_fee_bps
        && c.creator_royalty_bps == p.creator_royalty_bps
}

/// `update_tier_config` (F6): the guarded fields, set by the program's upgrade authority, plus the new guard value.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct TierParams {
    pub price_source: u8,
    pub price_authority: Pubkey,
    pub pyth_price_account: Pubkey,
    pub sol_usd_e6: u64,
    pub max_conf_bps: u16,
    pub max_price_step_bps: u16,
    pub max_price_age_secs: u32,
    pub min_price_interval_secs: u32,
    pub mcap_multiplier: u16,
    pub tier_thresholds_usd: [u64; EVOLUTIONS],
    pub evolve_hold_slots: u32,
    pub evolve_min_obs: u8,
    pub evolve_max_step: u8,
    pub card_uri_base: String,
    pub launch_fee: u64,
    pub protocol_fee_bps: u16,
    pub creator_royalty_bps: u16,
    /// 0 or 1.
    pub tier_guard: u8,
}

impl TierParams {
    /// Writes the guarded fields over `p` (the current Config's params); `p` is then validated as a whole.
    pub fn overlay(&self, p: &mut ConfigParams) {
        p.price_source = self.price_source;
        p.price_authority = self.price_authority;
        p.pyth_price_account = self.pyth_price_account;
        p.sol_usd_e6 = self.sol_usd_e6;
        p.max_conf_bps = self.max_conf_bps;
        p.max_price_step_bps = self.max_price_step_bps;
        p.max_price_age_secs = self.max_price_age_secs;
        p.min_price_interval_secs = self.min_price_interval_secs;
        p.mcap_multiplier = self.mcap_multiplier;
        p.tier_thresholds_usd = self.tier_thresholds_usd;
        p.evolve_hold_slots = self.evolve_hold_slots;
        p.evolve_min_obs = self.evolve_min_obs;
        p.evolve_max_step = self.evolve_max_step;
        p.card_uri_base = self.card_uri_base.clone();
        p.launch_fee = self.launch_fee;
        p.protocol_fee_bps = self.protocol_fee_bps;
        p.creator_royalty_bps = self.creator_royalty_bps;
    }
}

/// `set_config_ext` (admin B7): only the fields whose `mask` bit is set are written (bit 1 `register_flags`, 2
/// `outside_royalty_bps`, 4 `ticket_authority`, 8 `ticket_allowance`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConfigExtParams {
    pub mask: u8,
    pub register_flags: u8,
    pub outside_royalty_bps: u16,
    pub ticket_authority: Pubkey,
    pub ticket_allowance: u16,
}

impl ConfigExtParams {
    /// Mask and range rules (the ticket authority's key-overlap rule needs the accounts; the handler checks it).
    pub fn is_valid(&self) -> bool {
        self.mask != 0
            && self.mask & !EXT_ALL == 0
            && (self.mask & EXT_REGISTER_FLAGS == 0 || self.register_flags & !REG_ALL == 0)
            && (self.mask & EXT_OUTSIDE_ROYALTY == 0 || self.outside_royalty_bps <= OUTSIDE_ROYALTY_MAX_BPS)
    }

    /// Writes the masked fields.
    pub fn apply(&self, c: &mut Config) {
        if self.mask & EXT_REGISTER_FLAGS != 0 {
            c.register_flags = self.register_flags;
        }
        if self.mask & EXT_OUTSIDE_ROYALTY != 0 {
            c.outside_royalty_bps = self.outside_royalty_bps;
        }
        if self.mask & EXT_TICKET_AUTHORITY != 0 {
            c.ticket_authority = self.ticket_authority;
        }
        if self.mask & EXT_TICKET_ALLOWANCE != 0 {
            c.ticket_allowance = self.ticket_allowance;
        }
    }
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Card {
    pub version: u8,
    pub bump: u8,
    /// `["card", mint]`
    pub vault_bump: u8,
    /// `["card-mint", mint]`
    pub card_mint_bump: u8,
    /// 1..=14, never decreases.
    pub level: u8,
    /// 0 = nothing pending.
    pub pending_level: u8,
    /// bit0 GRADUATED, bit1 CREATOR_LOST, bit2 FEES_CHANGED, bit3 LEGACY, bit4 METAPLEX (§18.17)
    pub flags: u8,
    /// Counted observations of the pending level.
    pub pending_obs: u8,
    /// pump coin mint (memcmp @16).
    pub mint: Pubkey,
    pub card_mint: Pubkey,
    /// Original launcher = royalty recipient (memcmp @80).
    pub launcher: Pubkey,
    /// Canonical PumpSwap pool, cached on the first verified read (default until then).
    pub pool: Pubkey,
    pub pending_since_slot: u64,
    pub registered_at: i64,
    pub evolved_at: i64,
    /// Market cap at the last confirmed evolve.
    pub peak_mcap_lamports: u64,
    pub peak_mcap_usd_e6: u64,
    /// Lifetime lamports out of the vault (withdrawals + sale settlements).
    pub fees_paid_out: u64,
    pub last_sale_price: u64,
    pub sales: u32,
    /// Slot of the last counted observation.
    pub pending_last_slot: u64,
    // ---- fix pack (fix-plan §2.2): carved out of `reserved: [u8; 52]` @212, all zero on older cards
    /// @212. VOID_ON_EVOLVE listings stay paused through this slot (F2 mark; 0 = no mark).
    pub pending_hwm_until: u64,
    /// @220. Highest pending level of the unlock episode that armed the mark.
    pub pending_hwm_level: u8,
    /// @221. Witness bitmask (observer-set slot bits) of the current window (F1).
    pub pending_observers: u8,
    /// @222. `ObserverSet.epoch` the current window was opened under (0 = open mode).
    pub pending_epoch: u8,
    /// @223.
    pub reserved: [u8; 41],
}

const _: () = assert!(8 + Card::INIT_SPACE == Card::LEN);

impl Card {
    pub const LEN: usize = 264;
    pub const VERSION: u8 = 1;
}

/// The observer keys of attested mode (F1), PDA `["observers"]` = `OBSERVER_SET_ADDRESS`. Created and rewritten only by
/// `set_observers`. A slot index is the witness bit of its key; an empty slot is `Pubkey::default()` with role 0.
#[account]
#[derive(InitSpace, Debug)]
pub struct ObserverSet {
    pub version: u8,
    pub bump: u8,
    /// @10. 1..=255, advanced by every `set_observers` (255 wraps to 1; 0 is never written): a window opened under an
    /// older epoch restarts on its next counting call (tier B7, B12).
    pub epoch: u8,
    pub _pad: u8,
    /// @12.
    pub keys: [Pubkey; MAX_OBSERVERS],
    /// @268. bit0 ROLE_COUNT, bit1 ROLE_CAP, bit2 ROLE_PAUSE.
    pub roles: [u8; MAX_OBSERVERS],
    /// @276.
    pub updated_at: i64,
    /// @284.
    pub reserved: [u8; 32],
}

const _: () = assert!(8 + ObserverSet::INIT_SPACE == ObserverSet::LEN);

impl ObserverSet {
    pub const LEN: usize = 316;
    pub const VERSION: u8 = 1;

    /// The slot of a non-default key, with its roles.
    pub fn find(&self, key: &Pubkey) -> Option<(usize, u8)> {
        if *key == Pubkey::default() {
            return None;
        }
        self.keys.iter().position(|k| k == key).map(|i| (i, self.roles[i]))
    }

    pub fn contains(&self, key: &Pubkey) -> bool {
        self.find(key).is_some()
    }

    /// `epoch % 255 + 1`: 1..=255, never 0.
    pub fn next_epoch(epoch: u8) -> u8 {
        epoch % 255 + 1
    }
}

/// `set_observers` validation (F1; `InvalidConfig` otherwise): known role bits, COUNT implies CAP, a key is default iff
/// its role is 0, no duplicate keys, no key equal to the admin, the treasury or the ticket authority, and
/// `min_observers <= 8` and at most the number of COUNT keys.
pub fn observer_set_valid(
    keys: &[Pubkey; MAX_OBSERVERS],
    roles: &[u8; MAX_OBSERVERS],
    min_observers: u8,
    admin: &Pubkey,
    treasury: &Pubkey,
    ticket_authority: &Pubkey,
) -> bool {
    let mut counters = 0u8;
    for i in 0..MAX_OBSERVERS {
        let (k, r) = (&keys[i], roles[i]);
        let empty = *k == Pubkey::default();
        if r & !ROLE_ALL != 0 || (r & ROLE_COUNT != 0 && r & ROLE_CAP == 0) || empty != (r == 0) {
            return false;
        }
        if empty {
            continue;
        }
        if k == admin || k == treasury || k == ticket_authority || keys[..i].contains(k) {
            return false;
        }
        if r & ROLE_COUNT != 0 {
            counters += 1;
        }
    }
    min_observers as usize <= MAX_OBSERVERS && min_observers <= counters
}

/// The admin's only change while `tier_guard` is on (tier B9): every slot keeps its key with a subset of its roles, or
/// becomes empty, and `min_observers` does not go down. Growth goes through the time-locked upgrade authority.
pub fn observer_set_is_shrink(
    old_keys: &[Pubkey; MAX_OBSERVERS],
    old_roles: &[u8; MAX_OBSERVERS],
    old_min: u8,
    keys: &[Pubkey; MAX_OBSERVERS],
    roles: &[u8; MAX_OBSERVERS],
    min_observers: u8,
) -> bool {
    min_observers >= old_min
        && (0..MAX_OBSERVERS).all(|i| {
            (keys[i] == Pubkey::default() && roles[i] == 0) || (keys[i] == old_keys[i] && roles[i] & !old_roles[i] == 0)
        })
}

/// Loads the `ObserverSet` passed as a remaining account: key `OBSERVER_SET_ADDRESS`, owner MintDex, discriminator
/// (`ObserverSetMismatch` otherwise).
pub fn load_observer_set(info: &AccountInfo) -> Result<ObserverSet> {
    require!(
        *info.key == OBSERVER_SET_ADDRESS && *info.owner == crate::ID && !info.data_is_empty(),
        MintdexError::ObserverSetMismatch
    );
    let data = info.try_borrow_data()?;
    ObserverSet::try_deserialize(&mut &data[..]).map_err(|_| error!(MintdexError::ObserverSetMismatch))
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Bid {
    pub version: u8,
    pub bump: u8,
    pub mint: Pubkey,
    pub bidder: Pubkey,
    /// Escrowed lamports held by this account on top of its rent.
    pub amount: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

const _: () = assert!(8 + Bid::INIT_SPACE == Bid::LEN);

impl Bid {
    pub const LEN: usize = 98;
    pub const VERSION: u8 = 1;
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Listing {
    pub version: u8,
    pub bump: u8,
    /// bit0 VOID_ON_EVOLVE
    pub flags: u8,
    pub level_at_list: u8,
    /// memcmp @12
    pub mint: Pubkey,
    /// memcmp @44
    pub seller: Pubkey,
    pub price: u64,
    pub created_at: i64,
    /// 0 = never
    pub expires_at: i64,
    /// The seller's floor for the fees `buy_now` must pay out of the card vault (card-program-v2 §18.9, audit A1):
    /// set by `list_card` (new listing and re-price), lowered by the seller's own `withdraw_fees` while listed.
    pub min_fees_to_seller: u64,
}

const _: () = assert!(8 + Listing::INIT_SPACE == Listing::LEN);

impl Listing {
    pub const LEN: usize = 108;
    pub const VERSION: u8 = 1;

    /// The seller withdrew `paid` while listed: those fees are no longer owed by a buyer (§18.9).
    pub fn lower_fee_floor(&mut self, paid: u64) {
        self.min_fees_to_seller = self.min_fees_to_seller.saturating_sub(paid);
    }
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Ticket {
    pub bump: u8,
    /// bit0 LEGACY: skip the coin URI binding.
    pub flags: u8,
}

const _: () = assert!(8 + Ticket::INIT_SPACE == Ticket::LEN);

impl Ticket {
    pub const LEN: usize = 10;
}

/// §7.0 row `listing`: the account at `["listing", mint]` (address checked by the caller). Empty → owner must
/// be System (`None`). With data → owner MintDex + `Listing` discriminator + `listing.mint == mint`. Never parsed
/// loosely. `ListingInvalid` otherwise. Shared with market.rs.
pub fn load_listing(info: &AccountInfo, mint: &Pubkey) -> Result<Option<Listing>> {
    if info.data_is_empty() {
        require!(*info.owner == SYSTEM_PROGRAM_ID, MintdexError::ListingInvalid);
        return Ok(None);
    }
    require!(*info.owner == crate::ID, MintdexError::ListingInvalid);
    let data = info.try_borrow_data()?;
    let listing = Listing::try_deserialize(&mut &data[..]).map_err(|_| error!(MintdexError::ListingInvalid))?;
    require!(listing.mint == *mint, MintdexError::ListingInvalid);
    Ok(Some(listing))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::math::TIER_THRESHOLDS_USD;
    use crate::test_utils::*;

    pub const DEVNET_RENT0: u64 = 650_240;
    pub const MAINNET_RENT0: u64 = 890_880;

    /// The devnet `initialize` values (card-program-v2 §13 step 7; `max_conf_bps` 200 as in the SDK).
    pub fn devnet_params(treasury: Pubkey) -> ConfigParams {
        ConfigParams {
            paused: 0,
            price_source: PRICE_SOURCE_ADMIN,
            price_authority: Pubkey::default(),
            treasury,
            pyth_price_account: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE".parse().unwrap(),
            launch_fee: 0,
            min_bid: 30_000_000,
            protocol_fee_bps: 250,
            creator_royalty_bps: 500,
            max_conf_bps: 200,
            max_price_step_bps: 2_000,
            mcap_multiplier: 100,
            sweep_flags: SWEEP_ALL,
            sol_usd_e6: 118_000_000,
            max_price_age_secs: 0,
            evolve_hold_slots: 150,
            vanity_modulus: 11_316_496,
            vanity_residue: 8_725_513,
            tier_thresholds_usd: TIER_THRESHOLDS_USD,
            card_uri_base: "https://mintdex.fun/c/".into(),
            coin_uri_base: "https://mintdex.fun/m/".into(),
            evolve_min_obs: 3,
            evolve_max_step: 2,
            min_price_interval_secs: 300,
        }
    }

    /// A Config as `initialize` would write it with the devnet params.
    pub fn devnet_config() -> Config {
        let admin: Pubkey = "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj".parse().unwrap();
        let mut c = Config {
            version: Config::VERSION,
            bump: 255,
            paused: 0,
            price_source: 0,
            admin,
            pending_admin: Pubkey::default(),
            price_authority: Pubkey::default(),
            treasury: Pubkey::default(),
            pyth_price_account: Pubkey::default(),
            launch_fee: 0,
            min_bid: 0,
            protocol_fee_bps: 0,
            creator_royalty_bps: 0,
            max_conf_bps: 0,
            max_price_step_bps: 0,
            mcap_multiplier: 0,
            sweep_flags: 0,
            card_uri_base_len: 0,
            sol_usd_e6: 0,
            sol_usd_updated_at: 0,
            max_price_age_secs: 0,
            evolve_hold_slots: 0,
            vanity_modulus: 0,
            vanity_residue: 0,
            tier_thresholds_usd: [0; EVOLUTIONS],
            card_uri_base: [0; 64],
            coin_uri_base: [0; 64],
            coin_uri_base_len: 0,
            evolve_min_obs: 0,
            evolve_max_step: 0,
            _pad: 0,
            min_price_interval_secs: 0,
            last_pyth_sol_usd_e6: 0,
            evolve_min_observers: 0,
            register_flags: 0,
            tier_guard: 0,
            outside_royalty_bps: 0,
            ticket_authority: Pubkey::default(),
            ticket_allowance: 0,
            evolve_resumed_slot: 0,
            reserved: [0; 17],
        };
        c.apply(&devnet_params(admin));
        c
    }

    #[test]
    fn account_sizes_and_offsets() {
        assert_eq!((Config::LEN, Card::LEN, Bid::LEN, Listing::LEN, Ticket::LEN), (552, 264, 98, 108, 10));
        // serialize and check a few §4 offsets (they include the 8-byte discriminator)
        let c = devnet_config();
        let mut buf = Vec::new();
        c.try_serialize(&mut buf).unwrap();
        assert_eq!(buf.len(), Config::LEN - 64 + 64); // reserved included
        assert_eq!(&buf[12..44], c.admin.as_ref());
        assert_eq!(&buf[180..188], &30_000_000u64.to_le_bytes()); // min_bid @180
        assert_eq!(&buf[196..198], &100u16.to_le_bytes()); // mcap_multiplier @196
        assert_eq!(&buf[200..208], &118_000_000u64.to_le_bytes()); // sol_usd_e6 @200
        assert_eq!(&buf[220..224], &150u32.to_le_bytes()); // evolve_hold_slots @220
        assert_eq!(&buf[240..248], &15_000u64.to_le_bytes()); // thresholds @240
        assert_eq!(&buf[344..366], b"https://mintdex.fun/c/"); // card_uri_base @344
        assert_eq!(&buf[408..430], b"https://mintdex.fun/m/"); // coin_uri_base @408
        assert_eq!(buf[472], 22); // coin_uri_base_len @472
        assert_eq!((buf[473], buf[474]), (3, 2)); // evolve_min_obs @473, max_step @474
        assert_eq!(&buf[476..480], &300u32.to_le_bytes()); // min_price_interval_secs @476
        assert_eq!(c.card_uri_base(), b"https://mintdex.fun/c/");
        assert_eq!(c.coin_uri_base(), b"https://mintdex.fun/m/");

        let mint = Pubkey::new_unique();
        let launcher = Pubkey::new_unique();
        let card = Card {
            version: 1, bump: 1, vault_bump: 2, card_mint_bump: 3, level: 4, pending_level: 5, flags: 6, pending_obs: 7,
            mint, card_mint: Pubkey::new_unique(), launcher, pool: Pubkey::default(), pending_since_slot: 8,
            registered_at: 9, evolved_at: 10, peak_mcap_lamports: 11, peak_mcap_usd_e6: 12, fees_paid_out: 13,
            last_sale_price: 14, sales: 15, pending_last_slot: 16, pending_hwm_until: 17, pending_hwm_level: 18,
            pending_observers: 19, pending_epoch: 20, reserved: [0; 41],
        };
        let mut cb = Vec::new();
        card.try_serialize(&mut cb).unwrap();
        assert_eq!(cb.len(), Card::LEN);
        assert_eq!(&cb[16..48], mint.as_ref()); // mint @16
        assert_eq!(&cb[80..112], launcher.as_ref()); // launcher @80
        assert_eq!(&cb[200..204], &15u32.to_le_bytes()); // sales @200
        assert_eq!(&cb[204..212], &16u64.to_le_bytes()); // pending_last_slot @204
        // fix pack (fix-plan §2.2)
        assert_eq!(&cb[212..220], &17u64.to_le_bytes()); // pending_hwm_until @212
        assert_eq!((cb[220], cb[221], cb[222]), (18, 19, 20)); // pending_hwm_level, pending_observers, pending_epoch
        assert!(cb[223..264].iter().all(|b| *b == 0)); // reserved @223

        let bidder = Pubkey::new_unique();
        let bid = Bid { version: 1, bump: 1, mint, bidder, amount: 5, created_at: 6, updated_at: 7 };
        let mut bb = Vec::new();
        bid.try_serialize(&mut bb).unwrap();
        assert_eq!(bb.len(), Bid::LEN);
        assert_eq!((&bb[10..42], &bb[42..74]), (mint.as_ref(), bidder.as_ref()));

        let seller = Pubkey::new_unique();
        let l = Listing {
            version: 1, bump: 1, flags: 1, level_at_list: 3, mint, seller, price: 9, created_at: 1, expires_at: 0,
            min_fees_to_seller: 17,
        };
        let mut lb = Vec::new();
        l.try_serialize(&mut lb).unwrap();
        assert_eq!(lb.len(), Listing::LEN);
        assert_eq!((&lb[12..44], &lb[44..76]), (mint.as_ref(), seller.as_ref()));
        assert_eq!(&lb[100..108], &17u64.to_le_bytes()); // min_fees_to_seller @100 (appended, §18.9)
    }

    // ---------------------------------------------------------------- U8 validate()

    #[test]
    fn u8_accepts_the_devnet_config() {
        let p = devnet_params(Pubkey::new_unique());
        p.validate(DEVNET_RENT0).unwrap();
        // devnet min_bid 0.03 SOL: protocol 750,000 and royalty 1,500,000 ≥ rent(0) 650,240 (not on mainnet rent)
        assert_error(p.validate(MAINNET_RENT0), MintdexError::InvalidConfig);
    }

    #[test]
    fn u8_rejects_bad_configs() {
        let ok = devnet_params(Pubkey::new_unique());
        let bad = |f: &dyn Fn(&mut ConfigParams)| {
            let mut p = ok.clone();
            f(&mut p);
            p.validate(DEVNET_RENT0)
        };
        // hold < 150
        assert_error(bad(&|p| p.evolve_hold_slots = 149), MintdexError::InvalidConfig);
        assert!(bad(&|p| p.evolve_hold_slots = 150).is_ok());
        // min_bid fee below rent(0): protocol leg, royalty leg
        assert_error(bad(&|p| p.min_bid = 26_009_599), MintdexError::InvalidConfig);
        assert!(bad(&|p| p.min_bid = 26_009_600).is_ok());
        assert_error(bad(&|p| p.creator_royalty_bps = 100), MintdexError::InvalidConfig);
        assert!(bad(&|p| p.creator_royalty_bps = 0).is_ok()); // no royalty leg to pay
        // F11: a 0 protocol fee is allowed now; 1 bps at a 0.05 SOL min_bid (5,000 lamports < rent(0)) is not
        assert!(bad(&|p| p.protocol_fee_bps = 0).is_ok());
        assert!(bad(&|p| {
            p.protocol_fee_bps = 0;
            p.creator_royalty_bps = 0;
        })
        .is_ok());
        assert_error(bad(&|p| {
            p.min_bid = 50_000_000;
            p.protocol_fee_bps = 1;
        }), MintdexError::InvalidConfig);
        // non-ascending / zero thresholds
        assert_error(bad(&|p| p.tier_thresholds_usd[5] = p.tier_thresholds_usd[4]), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.tier_thresholds_usd.swap(0, 1)), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.tier_thresholds_usd[0] = 0), MintdexError::InvalidConfig);
        // multiplier 0 or > 1000
        assert_error(bad(&|p| p.mcap_multiplier = 0), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.mcap_multiplier = 1_001), MintdexError::InvalidConfig);
        assert!(bad(&|p| p.mcap_multiplier = 1_000).is_ok());
        // URI bases without https or longer than 64 bytes
        assert_error(bad(&|p| p.card_uri_base = "http://mintdex.fun/c/".into()), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.coin_uri_base = "mintdex.fun/m/".into()), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.coin_uri_base = format!("https://{}/", "a".repeat(56))), MintdexError::InvalidConfig);
        assert!(bad(&|p| p.coin_uri_base = format!("https://{}/", "a".repeat(55))).is_ok());
        // max_price_age 0 with Pyth
        assert_error(bad(&|p| p.price_source = PRICE_SOURCE_PYTH), MintdexError::InvalidConfig);
        assert!(bad(&|p| {
            p.price_source = PRICE_SOURCE_PYTH;
            p.max_price_age_secs = 60;
        })
        .is_ok());
        // fees above 2,000 bps
        assert_error(bad(&|p| p.protocol_fee_bps = 1_501), MintdexError::InvalidConfig);
        // evolve observation and step bounds
        for (obs, step, okv) in [(1, 2, false), (2, 2, true), (8, 2, true), (9, 2, false), (3, 0, false), (3, 13, true), (3, 14, false)] {
            let r = bad(&|p| {
                p.evolve_min_obs = obs;
                p.evolve_max_step = step;
            });
            assert_eq!(r.is_ok(), okv, "obs {obs} step {step}");
        }
        // price authority needs an interval ≥ 60 s
        let pa = Pubkey::new_unique();
        assert_error(bad(&|p| {
            p.price_authority = pa;
            p.min_price_interval_secs = 59;
        }), MintdexError::InvalidConfig);
        assert!(bad(&|p| {
            p.price_authority = pa;
            p.min_price_interval_secs = 60;
        })
        .is_ok());
        // range checks added in §18.2
        assert_error(bad(&|p| p.paused = 8), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.sweep_flags = 8), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.price_source = 2), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.sol_usd_e6 = 0), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.vanity_residue = p.vanity_modulus), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.vanity_modulus = VANITY_MODULUS_MAX), MintdexError::InvalidConfig);
        assert!(bad(&|p| {
            p.vanity_modulus = 0;
            p.vanity_residue = 5;
        })
        .is_ok());
    }

    // ---------------------------------------------------------------- fix pack (fix-plan §2.2, §2.6, §2.8)

    /// The mainnet Config of fix-plan §6.1 as params (treasury and feed as given).
    pub fn mainnet_params(treasury: Pubkey) -> ConfigParams {
        ConfigParams {
            paused: 0,
            price_source: PRICE_SOURCE_PYTH,
            price_authority: Pubkey::default(),
            treasury,
            pyth_price_account: PYTH_SOL_USD_FEED,
            launch_fee: 20_000_000,
            min_bid: 50_000_000,
            protocol_fee_bps: 250,
            creator_royalty_bps: 500,
            max_conf_bps: 200,
            max_price_step_bps: 2_000,
            mcap_multiplier: 1,
            sweep_flags: SWEEP_ALL,
            sol_usd_e6: 121_480_000,
            max_price_age_secs: 120,
            evolve_hold_slots: 9_000,
            vanity_modulus: 11_316_496,
            vanity_residue: 8_725_513,
            tier_thresholds_usd: TIER_THRESHOLDS_USD,
            card_uri_base: "https://mintdex.fun/c/".into(),
            coin_uri_base: "https://mintdex.fun/m/".into(),
            evolve_min_obs: 8,
            evolve_max_step: 2,
            min_price_interval_secs: 300,
        }
    }

    #[test]
    fn fix_pack_offsets() {
        let mut c = devnet_config();
        c.evolve_min_observers = 1;
        c.register_flags = 3;
        c.tier_guard = 1;
        c.outside_royalty_bps = 0x0102;
        c.ticket_authority = Pubkey::new_from_array([9; 32]);
        c.ticket_allowance = 300;
        c.evolve_resumed_slot = 0x0102_0304_0506_0708;
        let mut b = Vec::new();
        c.try_serialize(&mut b).unwrap();
        assert_eq!(b.len(), Config::LEN);
        assert_eq!(&b[480..488], &0u64.to_le_bytes()); // last_pyth_sol_usd_e6 @480
        assert_eq!((b[488], b[489], b[490]), (1, 3, 1)); // evolve_min_observers, register_flags, tier_guard
        assert_eq!(&b[491..493], &0x0102u16.to_le_bytes()); // outside_royalty_bps @491
        assert_eq!(&b[493..525], &[9u8; 32]); // ticket_authority @493
        assert_eq!(&b[525..527], &300u16.to_le_bytes()); // ticket_allowance @525
        assert_eq!(&b[527..535], &0x0102_0304_0506_0708u64.to_le_bytes()); // evolve_resumed_slot @527
        assert!(b[535..552].iter().all(|x| *x == 0)); // reserved @535
        // a Config written before the fix pack (reserved all zero) decodes with every new field off
        let mut old = Vec::new();
        devnet_config().try_serialize(&mut old).unwrap();
        old[488..552].fill(0);
        let d = Config::try_deserialize(&mut &old[..]).unwrap();
        assert_eq!((d.evolve_min_observers, d.register_flags, d.tier_guard, d.outside_royalty_bps, d.ticket_allowance), (0, 0, 0, 0, 0));
        assert_eq!((d.ticket_authority, d.evolve_resumed_slot), (Pubkey::default(), 0));
        // ObserverSet
        let mut keys = [Pubkey::default(); MAX_OBSERVERS];
        keys[0] = Pubkey::new_from_array([7; 32]);
        let mut roles = [0u8; MAX_OBSERVERS];
        roles[0] = 3;
        let set = ObserverSet { version: 1, bump: 254, epoch: 5, _pad: 0, keys, roles, updated_at: 77, reserved: [0; 32] };
        let mut sb = Vec::new();
        set.try_serialize(&mut sb).unwrap();
        assert_eq!(sb.len(), ObserverSet::LEN);
        assert_eq!((sb[8], sb[9], sb[10]), (1, 254, 5)); // version, bump, epoch @10
        assert_eq!(&sb[12..44], &[7u8; 32]); // keys @12
        assert_eq!(sb[268], 3); // roles @268
        assert_eq!(&sb[276..284], &77i64.to_le_bytes()); // updated_at @276
        // rent of the 316-byte set at 5,080 lamports per byte (128 bytes of overhead)
        assert_eq!((ObserverSet::LEN as u64 + 128) * 5_080, 2_255_520);
    }

    #[test]
    fn params_round_trip() {
        for p in [devnet_params(Pubkey::new_unique()), mainnet_params(Pubkey::new_unique())] {
            let mut c = devnet_config();
            c.apply(&p);
            assert_eq!(c.params().unwrap(), p);
        }
        // a non-UTF-8 card URI base cannot be turned back into params
        let mut c = devnet_config();
        c.card_uri_base[3] = 0xff;
        assert_error(c.params(), MintdexError::InvalidConfig);
    }

    /// Review round 2: `apply` (update_config, update_tier_config) never writes `paused`, so a proposal built from a
    /// snapshot taken before an emergency pause leaves that pause in place when it executes.
    #[test]
    fn apply_never_writes_paused() {
        let mut c = devnet_config();
        c.paused = PAUSE_EVOLVE; // the watcher's auto-pause after the snapshot was taken
        let stale = ConfigParams { paused: 0, min_bid: 40_000_000, ..devnet_params(c.treasury) };
        c.apply(&stale);
        assert_eq!((c.paused, c.min_bid), (PAUSE_EVOLVE, 40_000_000));
        c.apply(&ConfigParams { paused: PAUSE_ALL, ..stale });
        assert_eq!(c.paused, PAUSE_EVOLVE);
    }

    #[test]
    fn is_valid_fix_pack_rules() {
        let r0 = DEVNET_RENT0;
        let ok = mainnet_params(Pubkey::new_unique());
        ok.validate(r0).unwrap();
        let bad = |f: &dyn Fn(&mut ConfigParams)| {
            let mut p = ok.clone();
            f(&mut p);
            p.validate(r0)
        };
        // launch fee cap 0.1 SOL (admin B3)
        assert!(bad(&|p| p.launch_fee = LAUNCH_FEE_MAX).is_ok());
        assert_error(bad(&|p| p.launch_fee = LAUNCH_FEE_MAX + 1), MintdexError::InvalidConfig);
        // Pyth: the pinned feed (admin B13) and 1..=300 s (F3 bound)
        assert_error(bad(&|p| p.pyth_price_account = Pubkey::new_unique()), MintdexError::InvalidConfig);
        assert_error(bad(&|p| p.max_price_age_secs = 0), MintdexError::InvalidConfig);
        assert!(bad(&|p| p.max_price_age_secs = 1).is_ok());
        assert!(bad(&|p| p.max_price_age_secs = 300).is_ok());
        assert_error(bad(&|p| p.max_price_age_secs = 301), MintdexError::InvalidConfig);
        // under the Admin source the feed and age are not constrained (devnet: age 0, any feed address)
        assert!(bad(&|p| {
            p.price_source = PRICE_SOURCE_ADMIN;
            p.pyth_price_account = Pubkey::new_unique();
            p.max_price_age_secs = 0;
        })
        .is_ok());
        // the devnet config passes unchanged
        devnet_params(Pubkey::new_unique()).validate(r0).unwrap();
    }

    #[test]
    fn guard_only_rules() {
        let mut p = mainnet_params(Pubkey::new_unique());
        assert!(p.guard_rules_ok());
        p.min_price_interval_secs = 59;
        assert!(!p.guard_rules_ok());
        p.min_price_interval_secs = 60;
        p.max_price_step_bps = 2_001;
        assert!(!p.guard_rules_ok());
        p.max_price_step_bps = 2_000;
        // Admin source: max age 0, or at least one interval + 60 s (admin B8)
        p.price_source = PRICE_SOURCE_ADMIN;
        p.min_price_interval_secs = 300;
        for (age, okv) in [(0, true), (359, false), (360, true), (120, false)] {
            p.max_price_age_secs = age;
            assert_eq!(p.guard_rules_ok(), okv, "age {age}");
        }
        // the devnet config (Admin, age 0, interval 300, step 2,000) can take the guard
        assert!(devnet_params(Pubkey::new_unique()).guard_rules_ok());
    }

    /// F6: each of the 17 guarded fields changed alone breaks equality; unguarded fields do not.
    #[test]
    fn tier_fields_equal_table() {
        let p = mainnet_params(Pubkey::new_unique());
        let mut c = devnet_config();
        c.apply(&p);
        assert!(tier_fields_equal(&c, &p));
        let changes: Vec<(&str, Box<dyn Fn(&mut ConfigParams)>)> = vec![
            ("thresholds[12]", Box::new(|p| p.tier_thresholds_usd[12] += 1)),
            ("thresholds[0]", Box::new(|p| p.tier_thresholds_usd[0] -= 1)),
            ("mcap_multiplier", Box::new(|p| p.mcap_multiplier = 2)),
            ("price_source", Box::new(|p| p.price_source = PRICE_SOURCE_ADMIN)),
            ("sol_usd_e6", Box::new(|p| p.sol_usd_e6 += 1)),
            ("pyth_price_account", Box::new(|p| p.pyth_price_account = Pubkey::new_unique())),
            ("max_price_age_secs", Box::new(|p| p.max_price_age_secs = 121)),
            ("max_conf_bps", Box::new(|p| p.max_conf_bps = 201)),
            ("price_authority", Box::new(|p| p.price_authority = Pubkey::new_unique())),
            ("max_price_step_bps", Box::new(|p| p.max_price_step_bps = 1_999)),
            ("min_price_interval_secs", Box::new(|p| p.min_price_interval_secs = 301)),
            ("evolve_hold_slots", Box::new(|p| p.evolve_hold_slots = 9_001)),
            ("evolve_min_obs", Box::new(|p| p.evolve_min_obs = 7)),
            ("evolve_max_step", Box::new(|p| p.evolve_max_step = 3)),
            ("card_uri_base byte", Box::new(|p| p.card_uri_base = "https://mintdex.fun/d/".into())),
            ("card_uri_base length", Box::new(|p| p.card_uri_base = "https://mintdex.fun/c".into())),
            ("launch_fee", Box::new(|p| p.launch_fee = 0)),
            ("protocol_fee_bps", Box::new(|p| p.protocol_fee_bps = 300)),
            ("creator_royalty_bps", Box::new(|p| p.creator_royalty_bps = 400)),
        ];
        for (name, f) in changes {
            let mut q = p.clone();
            f(&mut q);
            assert!(!tier_fields_equal(&c, &q), "{name} changed but compared equal");
        }
        let free: Vec<Box<dyn Fn(&mut ConfigParams)>> = vec![
            Box::new(|p| p.paused = PAUSE_ALL),
            Box::new(|p| p.treasury = Pubkey::new_unique()),
            Box::new(|p| p.min_bid = 60_000_000),
            Box::new(|p| p.sweep_flags = 0),
            Box::new(|p| p.vanity_modulus = 0),
            Box::new(|p| p.vanity_residue = 1),
            Box::new(|p| p.coin_uri_base = "https://mintdex.fun/n/".into()),
        ];
        for f in free {
            let mut q = p.clone();
            f(&mut q);
            assert!(tier_fields_equal(&c, &q));
        }
    }

    #[test]
    fn tier_params_overlay_keeps_unguarded_fields() {
        let mut c = devnet_config();
        let treasury = Pubkey::new_unique();
        c.apply(&devnet_params(treasury));
        let m = mainnet_params(treasury);
        let tier = TierParams {
            price_source: m.price_source,
            price_authority: m.price_authority,
            pyth_price_account: m.pyth_price_account,
            sol_usd_e6: m.sol_usd_e6,
            max_conf_bps: m.max_conf_bps,
            max_price_step_bps: m.max_price_step_bps,
            max_price_age_secs: m.max_price_age_secs,
            min_price_interval_secs: m.min_price_interval_secs,
            mcap_multiplier: m.mcap_multiplier,
            tier_thresholds_usd: m.tier_thresholds_usd,
            evolve_hold_slots: m.evolve_hold_slots,
            evolve_min_obs: m.evolve_min_obs,
            evolve_max_step: m.evolve_max_step,
            card_uri_base: m.card_uri_base.clone(),
            launch_fee: m.launch_fee,
            protocol_fee_bps: m.protocol_fee_bps,
            creator_royalty_bps: m.creator_royalty_bps,
            tier_guard: 1,
        };
        let mut p = c.params().unwrap();
        tier.overlay(&mut p);
        // every guarded field from the tier params, the rest (min_bid, vanity, sweep, coin URI, treasury) kept
        let mut c2 = devnet_config();
        c2.apply(&p);
        assert!(tier_fields_equal(&c2, &m));
        assert_eq!((p.min_bid, p.treasury, p.sweep_flags), (30_000_000, treasury, SWEEP_ALL));
    }

    #[test]
    fn config_ext_mask() {
        let base = ConfigExtParams { mask: EXT_ALL, register_flags: 3, outside_royalty_bps: 1_000, ticket_authority: Pubkey::new_unique(), ticket_allowance: 300 };
        assert!(base.is_valid());
        assert!(!ConfigExtParams { mask: 0, ..base.clone() }.is_valid());
        assert!(!ConfigExtParams { mask: 16, ..base.clone() }.is_valid());
        assert!(!ConfigExtParams { register_flags: 4, ..base.clone() }.is_valid());
        assert!(!ConfigExtParams { outside_royalty_bps: 1_001, ..base.clone() }.is_valid());
        // unmasked fields are neither validated nor written (admin B7)
        let only_allowance = ConfigExtParams { mask: EXT_TICKET_ALLOWANCE, register_flags: 0xff, outside_royalty_bps: 9_999, ..base.clone() };
        assert!(only_allowance.is_valid());
        let mut c = devnet_config();
        c.register_flags = 3;
        c.outside_royalty_bps = 250;
        only_allowance.apply(&mut c);
        assert_eq!((c.register_flags, c.outside_royalty_bps, c.ticket_allowance, c.ticket_authority), (3, 250, 300, Pubkey::default()));
        base.apply(&mut c);
        assert_eq!((c.register_flags, c.outside_royalty_bps, c.ticket_authority), (3, 1_000, base.ticket_authority));
    }

    fn keys_roles(entries: &[(Pubkey, u8)]) -> ([Pubkey; MAX_OBSERVERS], [u8; MAX_OBSERVERS]) {
        let mut k = [Pubkey::default(); MAX_OBSERVERS];
        let mut r = [0u8; MAX_OBSERVERS];
        for (i, (key, role)) in entries.iter().enumerate() {
            k[i] = *key;
            r[i] = *role;
        }
        (k, r)
    }

    #[test]
    fn set_observers_validation() {
        let (admin, treasury, tickets) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let (crank, standby, watcher) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let valid = |e: &[(Pubkey, u8)], min: u8| {
            let (k, r) = keys_roles(e);
            observer_set_valid(&k, &r, min, &admin, &treasury, &tickets)
        };
        assert!(valid(&[(crank, 3), (standby, 3), (watcher, 6)], 1));
        assert!(valid(&[(crank, 3), (standby, 3), (watcher, 6)], 2));
        assert!(!valid(&[(crank, 3), (standby, 3), (watcher, 6)], 3), "min above the COUNT keys");
        assert!(valid(&[], 0), "empty set, open mode");
        assert!(valid(&[(watcher, 4)], 0), "a pause-only key");
        assert!(!valid(&[(crank, 1)], 1), "COUNT without CAP");
        assert!(!valid(&[(crank, 8)], 0), "unknown role bit");
        assert!(!valid(&[(crank, 0)], 0), "key with role 0");
        assert!(!valid(&[(Pubkey::default(), 3)], 0), "role on an empty slot");
        assert!(!valid(&[(crank, 3), (crank, 2)], 1), "duplicate key");
        for k in [admin, treasury, tickets] {
            assert!(!valid(&[(k, 3)], 1), "admin, treasury or ticket authority as an observer");
        }
        assert!(!valid(&[(crank, 3)], 9));
        // a default ticket authority (none) never matches
        let (k, r) = keys_roles(&[(crank, 3)]);
        assert!(observer_set_valid(&k, &r, 1, &admin, &treasury, &Pubkey::default()));
    }

    #[test]
    fn set_observers_shrink_predicate() {
        let (crank, standby, watcher, other) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let (ok, or) = keys_roles(&[(crank, 3), (standby, 3), (watcher, 6)]);
        let shrink = |e: &[(Pubkey, u8)], min: u8| {
            let (k, r) = keys_roles(e);
            observer_set_is_shrink(&ok, &or, 1, &k, &r, min)
        };
        assert!(shrink(&[(crank, 3), (standby, 3), (watcher, 6)], 1), "unchanged");
        assert!(shrink(&[(Pubkey::default(), 0), (standby, 3), (watcher, 6)], 1), "crank removed");
        assert!(shrink(&[(crank, 3), (standby, 3), (watcher, 2)], 1), "watcher loses PAUSE");
        assert!(shrink(&[(crank, 3), (standby, 3), (watcher, 6)], 2), "min raised");
        assert!(!shrink(&[(crank, 3), (standby, 3), (watcher, 7)], 1), "watcher gains COUNT");
        assert!(!shrink(&[(crank, 3), (standby, 3), (watcher, 6), (other, 2)], 1), "a new key");
        assert!(!shrink(&[(other, 3), (standby, 3), (watcher, 6)], 1), "a key replaced");
        assert!(!shrink(&[(standby, 3), (crank, 3), (watcher, 6)], 1), "slots swapped");
        assert!(!shrink(&[(crank, 3), (standby, 3), (watcher, 6)], 0), "min lowered (back to open mode)");
    }

    #[test]
    fn observer_set_helpers() {
        let k = Pubkey::new_unique();
        let (keys, roles) = keys_roles(&[(Pubkey::new_unique(), 3), (k, 6)]);
        let set = ObserverSet { version: 1, bump: 254, epoch: 1, _pad: 0, keys, roles, updated_at: 0, reserved: [0; 32] };
        assert_eq!(set.find(&k), Some((1, 6)));
        assert_eq!(set.find(&Pubkey::default()), None);
        assert!(!set.contains(&Pubkey::new_unique()));
        assert_eq!((ObserverSet::next_epoch(0), ObserverSet::next_epoch(1), ObserverSet::next_epoch(254), ObserverSet::next_epoch(255)), (1, 2, 255, 1));
    }

    #[test]
    fn mainnet_config_validates_on_mainnet_rent() {
        // fix-plan §6.1: 0.05 SOL min_bid pays both legs above rent(0) on either rent figure
        let p = mainnet_params(Pubkey::new_unique());
        p.validate(DEVNET_RENT0).unwrap();
        p.validate(MAINNET_RENT0).unwrap();
        assert!(p.guard_rules_ok());
    }
}
