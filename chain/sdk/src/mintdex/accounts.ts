// MintDex account decoders (layouts from card-program-v2 §4, through the active IDL) and the
// getProgramAccounts memcmp offsets of §11.2.
import type { Address } from "../address.ts";
import { mintdexProgram } from "./program.ts";

export interface CardAccount {
  version: number;
  bump: number;
  vault_bump: number;
  card_mint_bump: number;
  level: number;
  pending_level: number;
  flags: number;
  pending_obs: number;
  mint: Address;
  card_mint: Address;
  launcher: Address;
  pool: Address;
  pending_since_slot: bigint;
  registered_at: bigint;
  evolved_at: bigint;
  peak_mcap_lamports: bigint;
  peak_mcap_usd_e6: bigint;
  fees_paid_out: bigint;
  last_sale_price: bigint;
  sales: number;
  pending_last_slot: bigint;
  /** Fix pack (fix-plan §2.2), @212: VOID_ON_EVOLVE listings stay paused through this slot (F2 mark; 0 = none). */
  pending_hwm_until: bigint;
  /** @220: highest pending level of the episode that armed the mark. */
  pending_hwm_level: number;
  /** @221: witness bits of the current window (F1). */
  pending_observers: number;
  /** @222: ObserverSet.epoch the window was opened under (0 = open mode). */
  pending_epoch: number;
  reserved: Uint8Array;
}

export interface BidAccount {
  version: number;
  bump: number;
  mint: Address;
  bidder: Address;
  amount: bigint;
  created_at: bigint;
  updated_at: bigint;
}

export interface ListingAccount {
  version: number;
  bump: number;
  flags: number;
  level_at_list: number;
  mint: Address;
  seller: Address;
  price: bigint;
  created_at: bigint;
  expires_at: bigint;
  /** The seller's fee floor for `buy_now` (card-program-v2 §18.9); lowered by the seller's withdrawals while listed. */
  min_fees_to_seller: bigint;
}

export interface TicketAccount {
  bump: number;
  flags: number;
}

export interface ConfigAccount {
  version: number;
  bump: number;
  paused: number;
  price_source: number;
  admin: Address;
  pending_admin: Address;
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
  card_uri_base_len: number;
  sol_usd_e6: bigint;
  sol_usd_updated_at: bigint;
  max_price_age_secs: number;
  evolve_hold_slots: number;
  vanity_modulus: bigint;
  vanity_residue: bigint;
  tier_thresholds_usd: bigint[];
  card_uri_base: Uint8Array;
  coin_uri_base: Uint8Array;
  coin_uri_base_len: number;
  evolve_min_obs: number;
  evolve_max_step: number;
  min_price_interval_secs: number;
  last_pyth_sol_usd_e6: bigint;
  // ---- fix pack (fix-plan §2.2), carved out of the reserved bytes @488 (all 0 on older Configs)
  /** @488: 0 = open mode; else attested mode and the distinct witnesses a confirm needs (F1). */
  evolve_min_observers: number;
  /** @489: bit0 REG.NO_TOKEN2022, bit1 REG.REQUIRE_COLLECTION (F9, F8). */
  register_flags: number;
  /** @490: 1 = the 17 guarded fields change only through update_tier_config (F6). */
  tier_guard: number;
  /** @491: Metaplex seller_fee_basis_points of collection cards (0..=1,000; F8). */
  outside_royalty_bps: number;
  /** @493: may issue tickets (flags 0) within `ticket_allowance` (F12). */
  ticket_authority: Address;
  /** @525 */
  ticket_allowance: number;
  /**
   * @527 (review round 2): the slot of the last set_paused that cleared EVOLVE (0 = never). A window opened before it
   * restarts on its next observation. Undefined only when decoded with an IDL older than the round-2 program.
   */
  evolve_resumed_slot?: bigint;
}

/** The observer keys of attested mode (F1), PDA `["observers"]` (8WB8k8…), 316 B. Slot index = witness bit. */
export interface ObserverSetAccount {
  version: number;
  bump: number;
  /** 1..=255, advanced by every set_observers. */
  epoch: number;
  keys: Address[];
  /** bit0 ROLE.COUNT, bit1 ROLE.CAP, bit2 ROLE.PAUSE */
  roles: number[];
  updated_at: bigint;
}

export const decodeConfig = (data: Uint8Array) => mintdexProgram().decodeAccount<ConfigAccount>("Config", data);
export const decodeCard = (data: Uint8Array) => mintdexProgram().decodeAccount<CardAccount>("Card", data);
export const decodeBid = (data: Uint8Array) => mintdexProgram().decodeAccount<BidAccount>("Bid", data);
export const decodeListing = (data: Uint8Array) => mintdexProgram().decodeAccount<ListingAccount>("Listing", data);
export const decodeTicket = (data: Uint8Array) => mintdexProgram().decodeAccount<TicketAccount>("Ticket", data);
export const decodeObserverSet = (data: Uint8Array) => mintdexProgram().decodeAccount<ObserverSetAccount>("ObserverSet", data);

const DEFAULT_ADDRESS: Address = "11111111111111111111111111111111";

/** The slot and roles of `key` in the set (null for an empty key or a non-member). */
export function observerSlot(set: Pick<ObserverSetAccount, "keys" | "roles">, key: Address): { index: number; roles: number } | null {
  if (key === DEFAULT_ADDRESS) return null;
  const index = set.keys.findIndex((k) => k === key);
  return index < 0 ? null : { index, roles: set.roles[index] ?? 0 };
}

const utf8 = new TextDecoder();
/** The URI bases are fixed [u8; 64] arrays with a separate length byte. */
export const configCardUriBase = (c: ConfigAccount): string =>
  utf8.decode(c.card_uri_base.subarray(0, c.card_uri_base_len));
export const configCoinUriBase = (c: ConfigAccount): string =>
  utf8.decode(c.coin_uri_base.subarray(0, c.coin_uri_base_len));

/** memcmp offsets (with the 8-byte discriminator) for getProgramAccounts (§11.2, rev 1). */
export const MEMCMP = {
  card: { mint: 16, launcher: 80 },
  bid: { mint: 10, bidder: 42 },
  listing: { mint: 12, seller: 44 },
} as const;

/** Spec account sizes (bytes including the discriminator). Listing grew from 100 to 108 with `min_fees_to_seller`
 *  (card-program-v2 §18.9); the memcmp offsets did not move. */
export const ACCOUNT_SIZE = { Config: 552, Card: 264, Bid: 98, Listing: 108, Ticket: 10, ObserverSet: 316 } as const;

/** Byte offsets (with the discriminator) of the Card window and mark fields, for getProgramAccounts dataSlice scans. */
export const CARD_OFFSETS = {
  level: 12,
  pendingLevel: 13,
  flags: 14,
  pendingObs: 15,
  mint: 16,
  pendingSinceSlot: 144,
  pendingLastSlot: 204,
  pendingHwmUntil: 212,
  pendingHwmLevel: 220,
  pendingObservers: 221,
  pendingEpoch: 222,
} as const;
