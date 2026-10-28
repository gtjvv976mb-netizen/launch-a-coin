// MintDex constants, flags, URIs, the vanity residue check and a mirror of `Config::validate()`
// (card-program-v2 §4, §5.4, §7.2, §13 step 7).
import { toAddress, toAddressBytes } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import { utf8Encode } from "../bytes.ts";
import { PYTH_SOL_USD_PRICE_ACCOUNT } from "../constants.ts";
import { TIER_THRESHOLDS_USD } from "../tiers.ts";

export const PAUSE = { REGISTER: 1, EVOLVE: 2, MARKET: 4 } as const;
export const SWEEP = { CURVE: 1, AMM: 2, VAULT_WSOL: 4, ALL: 7 } as const;
/** `Card.flags`; METAPLEX = the card NFT has Metaplex metadata + master edition (register_card_metaplex, §18.17). */
export const CARD_FLAG = { GRADUATED: 1, CREATOR_LOST: 2, FEES_CHANGED: 4, LEGACY: 8, METAPLEX: 16, COLLECTION: 32 } as const;
/** `ObserverSet.roles[i]` (F1, admin B12): COUNT opens / counts / confirms (implies CAP), CAP observes with a cap, PAUSE may add the EVOLVE pause bit. */
export const ROLE = { COUNT: 1, CAP: 2, PAUSE: 4, ALL: 7 } as const;
/** The roles the fix plan gives each observer: the crank and the standby count, the watcher caps and pauses. */
export const OBSERVER_ROLES = { crank: 3, standby: 3, watcher: 6 } as const;
export const MAX_OBSERVERS = 8;
/** `Config.register_flags` (F9, F8): bit0 disables register_card (Token-2022 cards), bit1 requires the MintDex collection. */
export const REG = { NO_TOKEN2022: 1, REQUIRE_COLLECTION: 2, ALL: 3 } as const;
/** `ConfigExtParams.mask` bits (admin B7). */
export const EXT = { REGISTER_FLAGS: 1, OUTSIDE_ROYALTY: 2, TICKET_AUTHORITY: 4, TICKET_ALLOWANCE: 8, ALL: 15 } as const;
export const OUTSIDE_ROYALTY_MAX_BPS = 1_000;
/** `Config.launch_fee` ceiling, 0.1 SOL (admin B3). */
export const LAUNCH_FEE_MAX = 100_000_000n;
/** Under price_source = Pyth, max_price_age_secs must be 1..=300 (F3 bound). */
export const PYTH_MAX_AGE_CAP_SECS = 300;
/** With tier_guard on, set_price stays within +10% / -50% of the last recorded Pyth price (admin B1). */
export const ADMIN_PRICE_MAX_ABOVE_PYTH_BPS = 1_000;
export const ADMIN_PRICE_MAX_BELOW_PYTH_BPS = 5_000;
/** With tier_guard on: interval floor, step ceiling, Admin-source age margin (admin §3.4, B8). */
export const GUARD_MIN_PRICE_INTERVAL_SECS = 60;
export const GUARD_MAX_PRICE_STEP_BPS = 2_000;
export const GUARD_MAX_AGE_MARGIN_SECS = 60;
export const VANITY_MODULUS_MAX = 1n << 56n;
/** The collection NFT URI is exactly `card_uri_base ‖ "collection.json"` (admin B14). */
export const COLLECTION_URI_SUFFIX = "collection.json";
export const COLLECTION_NAME_DEFAULT = "MintDex Cards";
export const collectionUri = (cardUriBase: string = DEFAULT_CARD_URI_BASE): string => `${cardUriBase}${COLLECTION_URI_SUFFIX}`;

// Precomputed fix-pack PDAs (constants.rs; test/fixpack.test.ts re-derives every one).
export const OBSERVER_SET_ADDRESS: Address = "8WB8k8ktzztm3KRf4rDqsJ6BTtdQb9EWfAWBs47hcvFX";
export const PROGRAM_DATA_ADDRESS: Address = "5pm5stfQtipce3HLyGmnZ38Se5hY98uqMKwhNrQoNzMA";
export const COLLECTION_AUTHORITY: Address = "ARZwArLCyWco84Bemkw7DVRfJ2gXkkFqeLVCQfpHoGE2";
export const COLLECTION_MINT: Address = "8dY2mDDyJDEpVRRqhbd3UXqfTVTrgdatHMW9eMfA5X7L";
export const COLLECTION_METADATA: Address = "81ZLAWMKnJywdTBJWCE1KmjmHBrAfvXvDvJNsYQD8vVa";
export const COLLECTION_EDITION: Address = "7qUPEf9mvh3Z8ncJ1KcCrCJreSXwmun32JMMqdUL1D81";
export const LISTING_FLAG = { VOID_ON_EVOLVE: 1 } as const;
export const TICKET_FLAG = { LEGACY: 1 } as const;
export const PRICE_SOURCE = { ADMIN: 0, PYTH: 1 } as const;
export const LISTING_CLOSED_REASON = { EXPIRED: 3, SOLD_VIA_BID: 4 } as const;

/** Program floor for `evolve_hold_slots` (rev 1 removes single-step mode). */
export const HOLD_FLOOR_SLOTS = 150;
/** "…mint" suffix: N mod 58^4 == 8,725,513 (G8). A cosmetic filter, not access control. */
export const VANITY_MINT_MODULUS = 11_316_496n;
export const VANITY_MINT_RESIDUE = 8_725_513n;

export const DEFAULT_CARD_URI_BASE = "https://mintdex.fun/c/";
export const DEFAULT_COIN_URI_BASE = "https://mintdex.fun/m/";
export const CARD_NFT_SYMBOL = "MDXCARD";

/** `r = fold(r × 256 + b) mod modulus` over the 32 key bytes (§5.4). */
export function vanityResidue(mint: AddressLike, modulus: bigint = VANITY_MINT_MODULUS): bigint {
  let r = 0n;
  for (const b of toAddressBytes(mint)) r = (r * 256n + BigInt(b)) % modulus;
  return r;
}

export function passesVanityCheck(
  mint: AddressLike,
  modulus: bigint = VANITY_MINT_MODULUS,
  residue: bigint = VANITY_MINT_RESIDUE
): boolean {
  return modulus === 0n || vanityResidue(mint, modulus) === residue;
}

/** Coin metadata URI bound by `register_card` (rev 1): `coin_uri_base ‖ base58(mint) ‖ ".json"`. */
export const coinUri = (mint: AddressLike, base: string = DEFAULT_COIN_URI_BASE): string =>
  `${base}${toAddress(mint)}.json`;

/** Card NFT URI built on chain: `{card_uri_base}{mint}.json?l={level}` (§4.5). */
export const cardUri = (mint: AddressLike, level: number, base: string = DEFAULT_CARD_URI_BASE): string =>
  `${base}${toAddress(mint)}.json?l=${level}`;

/** Longest prefix of `s` with at most `maxBytes` UTF-8 bytes that does not split a character (rev 1). */
export function truncateUtf8(s: string, maxBytes: number): string {
  let out = "";
  let used = 0;
  for (const ch of s) {
    const n = utf8Encode(ch).length;
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

/** Card NFT name `"{SYMBOL} MintDex Card"`, SYMBOL cut to 10 bytes on a character boundary (§4.5). */
export const cardName = (coinSymbol: string): string => `${truncateUtf8(coinSymbol, 10)} MintDex Card`;

export interface ConfigParams {
  paused: number;
  price_source: number;
  price_authority: Address;
  treasury: Address;
  pyth_price_account: Address;
  launch_fee: bigint;
  min_bid: bigint;
  protocol_fee_bps: number;
  creator_royalty_bps: number;
  max_conf_bps: number;
  max_price_step_bps: number;
  mcap_multiplier: number;
  sweep_flags: number;
  sol_usd_e6: bigint;
  max_price_age_secs: number;
  evolve_hold_slots: number;
  vanity_modulus: bigint;
  vanity_residue: bigint;
  tier_thresholds_usd: bigint[];
  card_uri_base: string;
  coin_uri_base: string;
  evolve_min_obs: number;
  evolve_max_step: number;
  min_price_interval_secs: number;
}

const DEFAULT_KEY: Address = "11111111111111111111111111111111";

/** Devnet `initialize` values (card-program-v2 §13 step 7). `max_conf_bps` is not specified there; 200 bps is used. */
export function devnetConfigParams(treasury: AddressLike): ConfigParams {
  return {
    paused: 0,
    price_source: PRICE_SOURCE.ADMIN,
    price_authority: DEFAULT_KEY,
    treasury: toAddress(treasury),
    pyth_price_account: PYTH_SOL_USD_PRICE_ACCOUNT,
    launch_fee: 0n,
    min_bid: 30_000_000n,
    protocol_fee_bps: 250,
    creator_royalty_bps: 500,
    max_conf_bps: 200,
    max_price_step_bps: 2000,
    mcap_multiplier: 100,
    sweep_flags: SWEEP.ALL,
    sol_usd_e6: 118_000_000n,
    max_price_age_secs: 0,
    evolve_hold_slots: 150,
    vanity_modulus: VANITY_MINT_MODULUS,
    vanity_residue: VANITY_MINT_RESIDUE,
    tier_thresholds_usd: [...TIER_THRESHOLDS_USD],
    card_uri_base: DEFAULT_CARD_URI_BASE,
    coin_uri_base: DEFAULT_COIN_URI_BASE,
    evolve_min_obs: 3,
    evolve_max_step: 2,
    min_price_interval_secs: 300,
  };
}

/**
 * Mirror of `ConfigParams::is_valid` (program state.rs, fix pack included). Returns the list of violated rules (empty =
 * valid). `rent0` is `Rent::minimum_balance(0)` of the target cluster; `treasuryLamports` is checked when given.
 */
export function validateConfigParams(p: ConfigParams, rent0: bigint, treasuryLamports?: bigint): string[] {
  const errors: string[] = [];
  if ((p.paused & ~7) !== 0) errors.push("unknown paused bits");
  if ((p.sweep_flags & ~7) !== 0) errors.push("unknown sweep_flags bits");
  if (p.price_source !== PRICE_SOURCE.ADMIN && p.price_source !== PRICE_SOURCE.PYTH) errors.push("price_source must be 0 or 1");
  if (p.protocol_fee_bps + p.creator_royalty_bps > 2000) errors.push("protocol + royalty > 2000 bps");
  const t = p.tier_thresholds_usd;
  if (t.length !== 13) errors.push("need 13 thresholds");
  for (let i = 0; i < t.length; i++) {
    if (t[i] <= 0n) errors.push(`threshold ${i} must be > 0`);
    if (i > 0 && t[i] <= t[i - 1]) errors.push(`thresholds must be strictly ascending at ${i}`);
  }
  if (p.mcap_multiplier < 1 || p.mcap_multiplier > 1000) errors.push("mcap_multiplier must be 1..=1000");
  for (const [name, base] of [
    ["card_uri_base", p.card_uri_base],
    ["coin_uri_base", p.coin_uri_base],
  ] as const) {
    if (!base.startsWith("https://")) errors.push(`${name} must start with https://`);
    if (utf8Encode(base).length > 64) errors.push(`${name} longer than 64 bytes`);
  }
  if (p.price_source === PRICE_SOURCE.PYTH) {
    if (p.pyth_price_account !== PYTH_SOL_USD_PRICE_ACCOUNT) errors.push("pyth_price_account must be the pinned SOL/USD feed 7UVim…");
    if (p.max_price_age_secs < 1 || p.max_price_age_secs > PYTH_MAX_AGE_CAP_SECS) errors.push("max_price_age_secs must be 1..=300 with Pyth");
  } else if (p.sol_usd_e6 <= 0n) {
    errors.push("sol_usd_e6 must be > 0 with the admin price");
  }
  if (p.evolve_hold_slots < HOLD_FLOOR_SLOTS) errors.push(`evolve_hold_slots < ${HOLD_FLOOR_SLOTS}`);
  if (p.evolve_min_obs < 2 || p.evolve_min_obs > 8) errors.push("evolve_min_obs must be 2..=8");
  if (p.evolve_max_step < 1 || p.evolve_max_step > 13) errors.push("evolve_max_step must be 1..=13");
  if (p.price_authority !== DEFAULT_KEY && p.min_price_interval_secs < 60) {
    errors.push("min_price_interval_secs must be >= 60 with a price authority");
  }
  if (p.vanity_modulus >= VANITY_MODULUS_MAX) errors.push("vanity_modulus too large");
  if (p.vanity_modulus !== 0n && p.vanity_residue >= p.vanity_modulus) errors.push("vanity_residue must be below vanity_modulus");
  if (p.launch_fee > LAUNCH_FEE_MAX) errors.push("launch_fee above 0.1 SOL");
  if (p.protocol_fee_bps !== 0 && (p.min_bid * BigInt(p.protocol_fee_bps)) / 10_000n < rent0) errors.push("protocol fee at min_bid below rent(0)");
  if (p.creator_royalty_bps > 0 && (p.min_bid * BigInt(p.creator_royalty_bps)) / 10_000n < rent0) {
    errors.push("royalty at min_bid below rent(0)");
  }
  if (treasuryLamports !== undefined && treasuryLamports < rent0) errors.push("treasury below rent(0)");
  return errors;
}

/** `ConfigParams::guard_rules_ok` (admin §3.4 step 3, B8): what every config must keep while tier_guard is on. */
export function guardRulesOk(p: Pick<ConfigParams, "min_price_interval_secs" | "max_price_step_bps" | "price_source" | "max_price_age_secs">): boolean {
  return (
    p.min_price_interval_secs >= GUARD_MIN_PRICE_INTERVAL_SECS &&
    p.max_price_step_bps <= GUARD_MAX_PRICE_STEP_BPS &&
    (p.price_source !== PRICE_SOURCE.ADMIN || p.max_price_age_secs === 0 || p.max_price_age_secs >= p.min_price_interval_secs + GUARD_MAX_AGE_MARGIN_SECS)
  );
}

/** `update_tier_config` payload (F6): the 17 guarded fields plus the new guard value. */
export interface TierParams {
  price_source: number;
  price_authority: Address;
  pyth_price_account: Address;
  sol_usd_e6: bigint;
  max_conf_bps: number;
  max_price_step_bps: number;
  max_price_age_secs: number;
  min_price_interval_secs: number;
  mcap_multiplier: number;
  tier_thresholds_usd: bigint[];
  evolve_hold_slots: number;
  evolve_min_obs: number;
  evolve_max_step: number;
  card_uri_base: string;
  launch_fee: bigint;
  protocol_fee_bps: number;
  creator_royalty_bps: number;
  /** 0 or 1 */
  tier_guard: number;
}

/** `set_config_ext` payload (admin B7): only the fields whose mask bit is set are written. */
export interface ConfigExtParams {
  mask: number;
  register_flags: number;
  outside_royalty_bps: number;
  ticket_authority: Address;
  ticket_allowance: number;
}

/** Decoded Config shape these helpers need (a subset of ConfigAccount, kept structural to avoid an import cycle). */
type ConfigLike = Omit<ConfigParams, "card_uri_base" | "coin_uri_base"> & {
  card_uri_base: Uint8Array;
  card_uri_base_len: number;
  coin_uri_base: Uint8Array;
  coin_uri_base_len: number;
  tier_guard?: number;
};
const utf8d = new TextDecoder();
const big = (v: bigint | number) => BigInt(v);

/** The `update_config` payload that changes nothing (the live Config's own params). */
export function configParamsFromConfig(c: ConfigLike): ConfigParams {
  return {
    paused: c.paused,
    price_source: c.price_source,
    price_authority: c.price_authority,
    treasury: c.treasury,
    pyth_price_account: c.pyth_price_account,
    launch_fee: big(c.launch_fee),
    min_bid: big(c.min_bid),
    protocol_fee_bps: c.protocol_fee_bps,
    creator_royalty_bps: c.creator_royalty_bps,
    max_conf_bps: c.max_conf_bps,
    max_price_step_bps: c.max_price_step_bps,
    mcap_multiplier: c.mcap_multiplier,
    sweep_flags: c.sweep_flags,
    sol_usd_e6: big(c.sol_usd_e6),
    max_price_age_secs: c.max_price_age_secs,
    evolve_hold_slots: c.evolve_hold_slots,
    vanity_modulus: big(c.vanity_modulus),
    vanity_residue: big(c.vanity_residue),
    tier_thresholds_usd: c.tier_thresholds_usd.map(big),
    card_uri_base: utf8d.decode(c.card_uri_base.subarray(0, c.card_uri_base_len)),
    coin_uri_base: utf8d.decode(c.coin_uri_base.subarray(0, c.coin_uri_base_len)),
    evolve_min_obs: c.evolve_min_obs,
    evolve_max_step: c.evolve_max_step,
    min_price_interval_secs: c.min_price_interval_secs,
  };
}

/** The `update_tier_config` payload that changes nothing but what `over` says (default guard = the live one). */
export function tierParamsFromConfig(c: ConfigLike, over: Partial<TierParams> = {}): TierParams {
  const p = configParamsFromConfig(c);
  return {
    price_source: p.price_source,
    price_authority: p.price_authority,
    pyth_price_account: p.pyth_price_account,
    sol_usd_e6: p.sol_usd_e6,
    max_conf_bps: p.max_conf_bps,
    max_price_step_bps: p.max_price_step_bps,
    max_price_age_secs: p.max_price_age_secs,
    min_price_interval_secs: p.min_price_interval_secs,
    mcap_multiplier: p.mcap_multiplier,
    tier_thresholds_usd: p.tier_thresholds_usd,
    evolve_hold_slots: p.evolve_hold_slots,
    evolve_min_obs: p.evolve_min_obs,
    evolve_max_step: p.evolve_max_step,
    card_uri_base: p.card_uri_base,
    launch_fee: p.launch_fee,
    protocol_fee_bps: p.protocol_fee_bps,
    creator_royalty_bps: p.creator_royalty_bps,
    tier_guard: c.tier_guard ?? 0,
    ...over,
  };
}

/** `TierParams::overlay`: the guarded fields of `t` written over `p` (the result is what the program validates). */
export function overlayTierParams(p: ConfigParams, t: TierParams): ConfigParams {
  return {
    ...p,
    price_source: t.price_source,
    price_authority: t.price_authority,
    pyth_price_account: t.pyth_price_account,
    sol_usd_e6: t.sol_usd_e6,
    max_conf_bps: t.max_conf_bps,
    max_price_step_bps: t.max_price_step_bps,
    max_price_age_secs: t.max_price_age_secs,
    min_price_interval_secs: t.min_price_interval_secs,
    mcap_multiplier: t.mcap_multiplier,
    tier_thresholds_usd: t.tier_thresholds_usd,
    evolve_hold_slots: t.evolve_hold_slots,
    evolve_min_obs: t.evolve_min_obs,
    evolve_max_step: t.evolve_max_step,
    card_uri_base: t.card_uri_base,
    launch_fee: t.launch_fee,
    protocol_fee_bps: t.protocol_fee_bps,
    creator_royalty_bps: t.creator_royalty_bps,
  };
}

/**
 * `tier_fields_equal` (F6): the guarded fields of `p` equal the live Config's. With tier_guard on, update_config fails
 * `TierFieldsLocked` unless this holds; the list names the fields that differ (empty = equal).
 */
export function tierFieldsDiff(c: ConfigLike, p: ConfigParams): string[] {
  const cur = configParamsFromConfig(c);
  const out: string[] = [];
  const eq = (k: keyof ConfigParams) => {
    const a = cur[k];
    const b = p[k];
    const same = Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
    if (!same) out.push(k);
  };
  for (const k of [
    "tier_thresholds_usd",
    "mcap_multiplier",
    "price_source",
    "sol_usd_e6",
    "pyth_price_account",
    "max_price_age_secs",
    "max_conf_bps",
    "price_authority",
    "max_price_step_bps",
    "min_price_interval_secs",
    "evolve_hold_slots",
    "evolve_min_obs",
    "evolve_max_step",
    "card_uri_base",
    "launch_fee",
    "protocol_fee_bps",
    "creator_royalty_bps",
  ] as const)
    eq(k);
  return out;
}

/** `ConfigExtParams::is_valid` (the handler also checks the ticket authority against the admin, treasury and observers). */
export function validateConfigExt(e: ConfigExtParams): string[] {
  const errors: string[] = [];
  if (e.mask === 0 || (e.mask & ~EXT.ALL) !== 0) errors.push("mask must be 1..=15");
  if ((e.mask & EXT.REGISTER_FLAGS) !== 0 && (e.register_flags & ~REG.ALL) !== 0) errors.push("unknown register_flags bits");
  if ((e.mask & EXT.OUTSIDE_ROYALTY) !== 0 && e.outside_royalty_bps > OUTSIDE_ROYALTY_MAX_BPS) errors.push("outside_royalty_bps above 1,000");
  return errors;
}

/** `observer_set_valid` (F1): role bits, COUNT implies CAP, empty iff role 0, no duplicates, no operational key, min. */
export function validateObserverSet(
  keys: readonly Address[],
  roles: readonly number[],
  minObservers: number,
  forbidden: { admin: Address; treasury: Address; ticketAuthority: Address },
): string[] {
  const errors: string[] = [];
  if (keys.length !== MAX_OBSERVERS || roles.length !== MAX_OBSERVERS) return ["need exactly 8 keys and 8 roles"];
  let counters = 0;
  for (let i = 0; i < MAX_OBSERVERS; i++) {
    const k = keys[i];
    const r = roles[i];
    const empty = k === DEFAULT_KEY;
    if ((r & ~ROLE.ALL) !== 0) errors.push(`slot ${i}: unknown role bits`);
    if ((r & ROLE.COUNT) !== 0 && (r & ROLE.CAP) === 0) errors.push(`slot ${i}: COUNT needs CAP`);
    if (empty !== (r === 0)) errors.push(`slot ${i}: a key needs a role and an empty slot none`);
    if (empty) continue;
    if (k === forbidden.admin || k === forbidden.treasury || k === forbidden.ticketAuthority) errors.push(`slot ${i}: an operational key cannot observe`);
    if (keys.slice(0, i).includes(k)) errors.push(`slot ${i}: duplicate key`);
    if ((r & ROLE.COUNT) !== 0) counters++;
  }
  if (minObservers > MAX_OBSERVERS || minObservers > counters) errors.push("min_observers above the number of COUNT keys");
  return errors;
}

/** `observer_set_is_shrink` (tier B9): the admin's only change while tier_guard is on. */
export function observerSetIsShrink(
  old: { keys: readonly Address[]; roles: readonly number[]; minObservers: number },
  next: { keys: readonly Address[]; roles: readonly number[]; minObservers: number },
): boolean {
  if (next.minObservers < old.minObservers) return false;
  for (let i = 0; i < MAX_OBSERVERS; i++) {
    const emptied = next.keys[i] === DEFAULT_KEY && next.roles[i] === 0;
    const subset = next.keys[i] === old.keys[i] && (next.roles[i] & ~old.roles[i]) === 0;
    if (!emptied && !subset) return false;
  }
  return true;
}

/** The 8-slot `set_observers` arrays from a list of [key, roles] (empty slots padded). */
export function observerSlots(entries: ReadonlyArray<readonly [AddressLike, number]>): { keys: Address[]; roles: number[] } {
  if (entries.length > MAX_OBSERVERS) throw new Error("at most 8 observers");
  const keys = Array.from({ length: MAX_OBSERVERS }, (_, i) => (entries[i] ? toAddress(entries[i][0]) : DEFAULT_KEY));
  const roles = Array.from({ length: MAX_OBSERVERS }, (_, i) => (entries[i] ? entries[i][1] : 0));
  return { keys, roles };
}

/** admin B1: `last_pyth / 2 <= price <= last_pyth × 1.10` (the guarded set_price anchor). */
export function withinPythAnchor(price: bigint, lastPyth: bigint): boolean {
  if (lastPyth === 0n) return false;
  return price * 10_000n >= lastPyth * BigInt(10_000 - ADMIN_PRICE_MAX_BELOW_PYTH_BPS) && price * 10_000n <= lastPyth * BigInt(10_000 + ADMIN_PRICE_MAX_ABOVE_PYTH_BPS);
}
