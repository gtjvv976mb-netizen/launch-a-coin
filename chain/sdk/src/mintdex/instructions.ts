// Typed MintDex instruction builders. Each one derives every PDA from the coin mint and hands the accounts
// to the active IDL by name (mintdex/program.ts): the synced `anchor build` IDL (idl/mintdex.json), or the
// placeholder in spec-idl.ts as a fallback. If the IDL renames or reorders accounts, the IDL engine throws on
// unknown/missing names and test/mintdex.test.ts lists the drift.
import { toAddress } from "../address.ts";
import type { AddressLike } from "../address.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINTDEX_PROGRAM_ID,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  SYSVAR_INSTRUCTIONS_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "../constants.ts";
import { ro, wr } from "../instruction.ts";
import type { AccountMeta, Instruction } from "../instruction.ts";
import {
  ammCreatorVaultAta,
  ammCreatorVaultAuthorityPda,
  ammEventAuthority,
  bidPda,
  cardTokenAccount,
  coinAddresses,
  configPda,
  creatorVaultPda,
  mintdexEventAuthority,
  programDataAddress,
  pumpEventAuthority,
  ticketPda,
  collectionAddresses,
  observerSetPda,
} from "../pda.ts";
import { PRICE_SOURCE } from "./config.ts";
import type { ConfigExtParams, ConfigParams, TierParams } from "./config.ts";
import { mintdexProgram } from "./program.ts";

type Accounts = Record<string, AddressLike | null | undefined>;

const eventCpi = (): Accounts => ({ event_authority: mintdexEventAuthority(), program: MINTDEX_PROGRAM_ID });
const programs = (): Accounts => ({
  token_2022_program: TOKEN_2022_PROGRAM_ID,
  associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
  system_program: SYSTEM_PROGRAM_ID,
});

/** The 10 sweep accounts of §7 for a coin (all address-checked on chain). */
export function sweepAccounts(mint: AddressLike): Accounts {
  const a = coinAddresses(mint);
  return {
    pump_creator_vault: creatorVaultPda(a.cardVault),
    pump_event_authority: pumpEventAuthority(),
    pump_program: PUMP_PROGRAM_ID,
    amm_vault_authority: ammCreatorVaultAuthorityPda(a.cardVault),
    amm_vault_ata: ammCreatorVaultAta(a.cardVault),
    wsol_mint: WSOL_MINT,
    spl_token_program: TOKEN_PROGRAM_ID,
    amm_event_authority: ammEventAuthority(),
    pamm_program: PAMM_PROGRAM_ID,
    vault_wsol_ata: a.vaultWsolAta,
  };
}

/** Extra vault-owned WSOL accounts (non-ATA griefing accounts, G12) go in as writable remaining accounts. */
const extraWsol = (accounts: AddressLike[] = []): AccountMeta[] => accounts.map((a) => wr(a));

const build = (name: string, accounts: Accounts, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []) =>
  mintdexProgram().instruction(name, { ...accounts, ...eventCpi() }, args, remaining);

// ---------------------------------------------------------------- admin (§7.1)

/**
 * `initialize`: gated by the upgrade authority; `treasury` must be `params.treasury` and hold ≥ rent(0). `priceFeed`
 * (F4): the Pyth account whose price becomes `last_pyth_sol_usd_e6`; required by the program when `params.price_source`
 * is Pyth, so it defaults to `params.pyth_price_account` then (and to none under the admin price). Pass `null` to omit.
 */
export function initializeIx(p: { admin: AddressLike; params: ConfigParams; priceFeed?: AddressLike | null }): Instruction {
  const priceFeed = p.priceFeed !== undefined ? p.priceFeed : p.params.price_source === PRICE_SOURCE.PYTH ? p.params.pyth_price_account : null;
  return build(
    "initialize",
    {
      admin: p.admin,
      config: configPda(),
      treasury: p.params.treasury,
      this_program: MINTDEX_PROGRAM_ID,
      program_data: programDataAddress(MINTDEX_PROGRAM_ID),
      system_program: SYSTEM_PROGRAM_ID,
      price_feed: priceFeed,
    },
    { params: p.params }
  );
}

/**
 * `update_config`: `treasury` must be `params.treasury` (≥ rent(0)). `priceFeed` (optional) is the current
 * `config.pyth_price_account`; when passed, the program records its price in `last_pyth_sol_usd_e6`.
 */
export const updateConfigIx = (p: { admin: AddressLike; params: ConfigParams; priceFeed?: AddressLike | null }): Instruction =>
  build(
    "update_config",
    { admin: p.admin, config: configPda(), treasury: p.params.treasury, price_feed: p.priceFeed ?? null },
    { params: p.params }
  );

export const proposeAdminIx = (p: { admin: AddressLike; newAdmin: AddressLike }): Instruction =>
  build("propose_admin", { admin: p.admin, config: configPda() }, { new_admin: toAddress(p.newAdmin) });

export const acceptAdminIx = (p: { pendingAdmin: AddressLike }): Instruction =>
  build("accept_admin", { pending_admin: p.pendingAdmin, config: configPda() });

export const setPriceIx = (p: { authority: AddressLike; solUsdE6: bigint }): Instruction =>
  build("set_price", { authority: p.authority, config: configPda() }, { sol_usd_e6: p.solUsdE6 });

/**
 * Issues tickets for up to about 20 mints per tx; `flags` bit0 = LEGACY (pre-v2 coins only, admin only). The signer
 * is the admin or the Config's ticket authority (fix pack F12; IDL account `authority`, formerly `admin`, same
 * position). `admin` is accepted as an alias of `authority` for older callers.
 */
export function issueTicketsIx(p: { authority?: AddressLike; admin?: AddressLike; mints: AddressLike[]; flags: number }): Instruction {
  const remaining = p.mints.flatMap((m) => [ro(m), wr(ticketPda(m))]);
  return build(
    "issue_tickets",
    { authority: p.authority ?? p.admin, config: configPda(), system_program: SYSTEM_PROGRAM_ID },
    { flags: p.flags },
    remaining
  );
}

/** Revokes a ticket (rent to the treasury); signer = the admin or the ticket authority (F12; `admin` = alias). */
export const revokeTicketIx = (p: { authority?: AddressLike; admin?: AddressLike; mint: AddressLike; treasury: AddressLike }): Instruction =>
  build("revoke_ticket", {
    authority: p.authority ?? p.admin,
    config: configPda(),
    mint: p.mint,
    ticket: ticketPda(p.mint),
    treasury: p.treasury,
  });

// ---------------------------------------------------------------- card lifecycle

/** `register_card` (§7.2), placed right after pump `create_v2` in the launch tx. Signers: launcher, mint. */
export function registerCardIx(p: { launcher: AddressLike; mint: AddressLike; treasury: AddressLike }): Instruction {
  const a = coinAddresses(p.mint);
  return build("register_card", {
    launcher: p.launcher,
    mint: a.mint,
    config: configPda(),
    treasury: p.treasury,
    ticket: a.ticket,
    bonding_curve: a.bondingCurve,
    card: a.card,
    card_mint: a.cardMint,
    launcher_card_account: cardTokenAccount(p.launcher, a.mint),
    ...programs(),
  });
}

/** The 4 collection accounts `register_card_metaplex` takes as remaining accounts (F8), in program order. */
export function collectionRemainingAccounts(): AccountMeta[] {
  const c = collectionAddresses();
  return [ro(c.authority), ro(c.mint), wr(c.metadata), ro(c.edition)];
}

/**
 * `register_card_metaplex` (card-program-v2 §18.17): `register_card` with a Metaplex NonFungible card NFT (metadata +
 * master edition created by CPI, update authority = the card PDA), so Phantom's Collectibles tab, DAS indexers and
 * marketplaces show the card. Same signers (launcher, mint) and the same gates. `collection` (F8) appends the 4
 * collection accounts: the card is verified into the MintDex collection (mandatory once `register_flags` bit1 is set).
 */
export function registerCardMetaplexIx(p: { launcher: AddressLike; mint: AddressLike; treasury: AddressLike; collection?: boolean }): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "register_card_metaplex",
    {
      launcher: p.launcher,
      mint: a.mint,
      config: configPda(),
      treasury: p.treasury,
      ticket: a.ticket,
      bonding_curve: a.bondingCurve,
      card: a.card,
      card_mint: a.cardMint,
      launcher_card_account: cardTokenAccount(p.launcher, a.mint),
      card_metadata: a.cardMetadata,
      card_edition: a.cardEdition,
      ...programs(),
      token_metadata_program: MPL_TOKEN_METADATA_PROGRAM_ID,
      sysvar_instructions: SYSVAR_INSTRUCTIONS_ID,
    },
    {},
    p.collection ? collectionRemainingAccounts() : []
  );
}

/**
 * Which card NFT standard a launch registers: "metaplex-collection" (register_card_metaplex verified into the MintDex
 * collection, F8; the mainnet rule), "metaplex" (register_card_metaplex without the collection) or the original
 * "token2022" (register_card; refused once `register_flags` bit0 is set, F9).
 */
export type CardStandard = "token2022" | "metaplex" | "metaplex-collection";

/** The register instruction of a launch for `standard` (default "token2022", the original `register_card`). */
export const registerIxFor = (
  standard: CardStandard | undefined,
  p: { launcher: AddressLike; mint: AddressLike; treasury: AddressLike },
): Instruction =>
  standard === "metaplex-collection"
    ? registerCardMetaplexIx({ ...p, collection: true })
    : standard === "metaplex"
      ? registerCardMetaplexIx(p)
      : registerCardIx(p);

/** The standards a Config's `register_flags` still accepts (F9: bit0 no Token-2022 cards, bit1 collection required). */
export function allowedCardStandards(registerFlags: number): CardStandard[] {
  const out: CardStandard[] = ["metaplex-collection"];
  if ((registerFlags & 2) === 0) out.push("metaplex");
  if ((registerFlags & 1) === 0) out.push("token2022");
  return out;
}

/** The price-feed facts a builder needs from the decoded Config (tier B4). */
export interface PriceFeedSource {
  price_source: number;
  pyth_price_account: AddressLike;
}

/**
 * The `price_feed` account of evolve / observe (tier B4): under the Pyth source it is required and must be the
 * Config's feed (a call without it fails on chain with `PriceFeedMismatch`, which would also make a clear impossible);
 * under the admin source it is omitted. Without a Config the explicit `priceFeed` (or none) is used.
 */
export function priceFeedFor(config: PriceFeedSource | null | undefined, priceFeed?: AddressLike | null): AddressLike | null {
  if (!config) return priceFeed ?? null;
  if (config.price_source !== PRICE_SOURCE.PYTH) return null;
  const want = toAddress(config.pyth_price_account);
  if (priceFeed && toAddress(priceFeed) !== want) throw new Error(`price feed ${toAddress(priceFeed)} is not the Config's ${want}`);
  return want;
}

/**
 * `evolve` (§7.3). Before graduation the pool accounts are omitted (passed as None); after it they are the
 * canonical pool and its two token accounts. `priceFeed` is required only with the Pyth price source.
 */
export function evolveIx(p: {
  cranker: AddressLike;
  mint: AddressLike;
  graduated: boolean;
  poolBaseTokenAccount?: AddressLike;
  poolQuoteTokenAccount?: AddressLike;
  priceFeed?: AddressLike | null;
  /** The card has `CARD_FLAG.METAPLEX`: append [Metaplex metadata (w), Metaplex program] (§18.17). */
  metaplex?: boolean;
  /** The decoded Config (price source and feed): under Pyth the feed is filled in, or a wrong one throws (tier B4). */
  config?: PriceFeedSource | null;
}): Instruction {
  const a = coinAddresses(p.mint);
  const remaining: AccountMeta[] = p.metaplex ? [wr(a.cardMetadata), ro(MPL_TOKEN_METADATA_PROGRAM_ID)] : [];
  return build("evolve", evolveAccounts(p), {}, remaining);
}

function evolveAccounts(p: {
  cranker: AddressLike;
  mint: AddressLike;
  graduated: boolean;
  poolBaseTokenAccount?: AddressLike;
  poolQuoteTokenAccount?: AddressLike;
  priceFeed?: AddressLike | null;
  config?: PriceFeedSource | null;
}): Accounts {
  const a = coinAddresses(p.mint);
  return {
    cranker: p.cranker,
    config: configPda(),
    card: a.card,
    card_mint: a.cardMint,
    mint: a.mint,
    bonding_curve: a.bondingCurve,
    pool: p.graduated ? a.pool : null,
    pool_base_ta: p.graduated ? p.poolBaseTokenAccount ?? a.poolBaseTokenAccount : null,
    pool_quote_ta: p.graduated ? p.poolQuoteTokenAccount ?? a.poolQuoteTokenAccount : null,
    price_feed: priceFeedFor(p.config, p.priceFeed),
    token_2022_program: TOKEN_2022_PROGRAM_ID,
    system_program: SYSTEM_PROGRAM_ID,
    instructions: SYSVAR_INSTRUCTIONS_ID,
  };
}

/**
 * `observe(max_live_level)` (F1): an ObserverSet member's observation capped at the level it read from committed state
 * (1..=14). evolve's 15 accounts, then remaining [ObserverSet (ro)] and, for a Metaplex card, [metadata (w), Metaplex
 * program]. `config` is required: under the Pyth source the feed goes in (tier B4).
 */
export function observeIx(p: {
  cranker: AddressLike;
  mint: AddressLike;
  graduated: boolean;
  maxLiveLevel: number;
  config: PriceFeedSource;
  metaplex?: boolean;
  priceFeed?: AddressLike | null;
  poolBaseTokenAccount?: AddressLike;
  poolQuoteTokenAccount?: AddressLike;
}): Instruction {
  if (!Number.isInteger(p.maxLiveLevel) || p.maxLiveLevel < 1 || p.maxLiveLevel > 14) {
    throw new Error(`observe cap ${p.maxLiveLevel} is not a level (1..=14)`);
  }
  const a = coinAddresses(p.mint);
  const remaining: AccountMeta[] = [ro(observerSetPda()), ...(p.metaplex ? [wr(a.cardMetadata), ro(MPL_TOKEN_METADATA_PROGRAM_ID)] : [])];
  return build("observe", evolveAccounts(p), { max_live_level: p.maxLiveLevel }, remaining);
}

/** `collect_fees` (§7.4): sweep only, permissionless. */
export function collectFeesIx(p: {
  payer: AddressLike;
  mint: AddressLike;
  extraWsolAccounts?: AddressLike[];
}): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "collect_fees",
    {
      payer: p.payer,
      config: configPda(),
      card: a.card,
      card_vault: a.cardVault,
      ...sweepAccounts(a.mint),
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SYSTEM_PROGRAM_ID,
    },
    {},
    extraWsol(p.extraWsolAccounts)
  );
}

/**
 * `withdraw_fees` (§7.5). `holderCardAccount` defaults to the holder's card ATA; pass the listing escrow while
 * listed, or the sink's token account for the launcher fallback.
 */
export function withdrawFeesIx(p: {
  holder: AddressLike;
  mint: AddressLike;
  holderCardAccount?: AddressLike;
  extraWsolAccounts?: AddressLike[];
}): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "withdraw_fees",
    {
      holder: p.holder,
      config: configPda(),
      card: a.card,
      card_vault: a.cardVault,
      card_mint: a.cardMint,
      holder_card_account: p.holderCardAccount ?? cardTokenAccount(p.holder, a.mint),
      listing: a.listing,
      ...sweepAccounts(a.mint),
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SYSTEM_PROGRAM_ID,
    },
    {},
    extraWsol(p.extraWsolAccounts)
  );
}

// ---------------------------------------------------------------- market (§7.6 to §7.9)

export function placeBidIx(p: { bidder: AddressLike; mint: AddressLike; amount: bigint }): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "place_bid",
    {
      bidder: p.bidder,
      config: configPda(),
      card: a.card,
      bid: bidPda(a.mint, p.bidder),
      system_program: SYSTEM_PROGRAM_ID,
    },
    { amount: p.amount }
  );
}

export const cancelBidIx = (p: { bidder: AddressLike; mint: AddressLike }): Instruction =>
  build("cancel_bid", { bidder: p.bidder, bid: bidPda(p.mint, p.bidder) });

/**
 * `accept_bid` (§7.7). `minFeesToSeller` is the seller's fee floor (card-program-v2 §18.9): set it to
 * `sellerFeeFloor(...)` (the §8 withdrawable total over the vault, pump's creator vault, the AMM creator-vault ATA and
 * every vault-owned WSOL account) and pass those WSOL accounts as `extraWsolAccounts`. A bidder that hides AMM fees
 * after the seller signed then makes the accept fail with `FeesBelowFloor` instead of keeping the fees. 0 = no floor.
 */
export function acceptBidIx(p: {
  seller: AddressLike;
  bidder: AddressLike;
  mint: AddressLike;
  launcher: AddressLike;
  treasury: AddressLike;
  minAmount: bigint;
  maxTotalFeeBps: number;
  minFeesToSeller: bigint;
  extraWsolAccounts?: AddressLike[];
}): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "accept_bid",
    {
      seller: p.seller,
      config: configPda(),
      treasury: p.treasury,
      card: a.card,
      card_vault: a.cardVault,
      card_mint: a.cardMint,
      launcher: p.launcher,
      bidder: p.bidder,
      bid: bidPda(a.mint, p.bidder),
      seller_card_account: cardTokenAccount(p.seller, a.mint),
      bidder_card_account: cardTokenAccount(p.bidder, a.mint),
      listing: a.listing,
      listing_escrow: a.listingEscrow,
      ...sweepAccounts(a.mint),
      ...programs(),
    },
    { min_amount: p.minAmount, max_total_fee_bps: p.maxTotalFeeBps, min_fees_to_seller: p.minFeesToSeller },
    extraWsol(p.extraWsolAccounts)
  );
}

/**
 * `list_card` (custodial): new listing or re-price. `flags` bit0 = VOID_ON_EVOLVE; `expiresAt` 0 = never.
 * `minFeesToSeller` is the fee floor `buy_now` must pay the seller (card-program-v2 §18.9): `sellerFeeFloor(...)` at
 * signing time. Re-pricing refreshes it; fees that accrue later are protected once anyone sweeps them (the crank's
 * `collect_fees`), or by a re-price.
 */
export function listCardIx(p: {
  seller: AddressLike;
  mint: AddressLike;
  price: bigint;
  expiresAt: bigint;
  flags: number;
  minFeesToSeller: bigint;
}): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "list_card",
    {
      seller: p.seller,
      config: configPda(),
      card: a.card,
      card_mint: a.cardMint,
      seller_card_account: cardTokenAccount(p.seller, a.mint),
      listing: a.listing,
      listing_escrow: a.listingEscrow,
      ...programs(),
    },
    { price: p.price, expires_at: p.expiresAt, flags: p.flags, min_fees_to_seller: p.minFeesToSeller }
  );
}

export function delistCardIx(p: { seller: AddressLike; mint: AddressLike }): Instruction {
  const a = coinAddresses(p.mint);
  return build("delist_card", {
    seller: p.seller,
    card_mint: a.cardMint,
    seller_card_account: cardTokenAccount(p.seller, a.mint),
    listing: a.listing,
    listing_escrow: a.listingEscrow,
    ...programs(),
  });
}

/** `close_expired_listing` (permissionless): a caller that re-creates the seller's card ATA is refunded its rent
 *  out of the escrow and listing refunds (card-program-v2 §18.9), so it pays only the tx fee. */
export function closeExpiredListingIx(p: { payer: AddressLike; seller: AddressLike; mint: AddressLike }): Instruction {
  const a = coinAddresses(p.mint);
  return build("close_expired_listing", {
    payer: p.payer,
    listing: a.listing,
    seller: p.seller,
    seller_card_account: cardTokenAccount(p.seller, a.mint),
    listing_escrow: a.listingEscrow,
    card_mint: a.cardMint,
    ...programs(),
  });
}

/** `buy_now` (§7.9). Pass every vault-owned WSOL account as `extraWsolAccounts`: the sale must pay the seller at
 *  least `listing.min_fees_to_seller` (card-program-v2 §18.9), or it fails with `FeesBelowFloor`. */
export function buyNowIx(p: {
  buyer: AddressLike;
  seller: AddressLike;
  mint: AddressLike;
  launcher: AddressLike;
  treasury: AddressLike;
  expectedPrice: bigint;
  maxTotalFeeBps: number;
  extraWsolAccounts?: AddressLike[];
}): Instruction {
  const a = coinAddresses(p.mint);
  return build(
    "buy_now",
    {
      buyer: p.buyer,
      config: configPda(),
      treasury: p.treasury,
      card: a.card,
      card_vault: a.cardVault,
      card_mint: a.cardMint,
      launcher: p.launcher,
      seller: p.seller,
      listing_escrow: a.listingEscrow,
      buyer_card_account: cardTokenAccount(p.buyer, a.mint),
      listing: a.listing,
      ...sweepAccounts(a.mint),
      ...programs(),
    },
    { expected_price: p.expectedPrice, max_total_fee_bps: p.maxTotalFeeBps },
    extraWsol(p.extraWsolAccounts)
  );
}

// ---------------------------------------------------------------- fix pack admin (fix-plan §2.3, §2.6)

/**
 * `set_observers` (F1): writes the 8 slots and `Config.evolve_min_observers`; every call advances the epoch.
 * `asUpgradeAuthority` passes MintDex's ProgramData (the upgrade-authority path: any valid set, also under the guard);
 * without it the signer must be the admin (any valid set while tier_guard is off, shrink only while it is on).
 */
/**
 * `set_observers` (F1). `expectedEpoch` is the live `ObserverSet.epoch` the new set was built from (0 before the set
 * exists): the program refuses anything but a shrink of the live set when the epoch moved since (review round 2,
 * `ObserverSetChanged`), so a queued growth can never re-add a key removed in the meantime.
 */
export function setObserversIx(p: {
  authority: AddressLike;
  keys: readonly AddressLike[];
  roles: readonly number[];
  minObservers: number;
  expectedEpoch: number;
  asUpgradeAuthority?: boolean;
}): Instruction {
  if (p.keys.length !== 8 || p.roles.length !== 8) throw new Error("set_observers takes exactly 8 keys and 8 roles");
  if (!Number.isInteger(p.expectedEpoch) || p.expectedEpoch < 0 || p.expectedEpoch > 255) throw new Error("set_observers needs the live epoch (0..255)");
  return build(
    "set_observers",
    {
      authority: p.authority,
      config: configPda(),
      observer_set: observerSetPda(),
      program_data: p.asUpgradeAuthority ? programDataAddress(MINTDEX_PROGRAM_ID) : null,
      system_program: SYSTEM_PROGRAM_ID,
    },
    { keys: p.keys.map((k) => toAddress(k)), roles: Uint8Array.from(p.roles), min_observers: p.minObservers, expected_epoch: p.expectedEpoch }
  );
}

/**
 * `set_paused(set, clear)`: `paused = (paused | set) & !clear` (review round 2: masks, so proposals built at different
 * times compose and never restore an old snapshot). The admin sets and clears any known bits (never the same bit in
 * both); a ROLE_PAUSE observer (`observer: true` passes the ObserverSet) may only set EVOLVE (`set: 2, clear: 0`).
 * Clearing EVOLVE records `Config.evolve_resumed_slot`: windows opened before it restart.
 */
export const setPausedIx = (p: { authority: AddressLike; set?: number; clear?: number; observer?: boolean }): Instruction => {
  const set = p.set ?? 0;
  const clear = p.clear ?? 0;
  if (!Number.isInteger(set) || !Number.isInteger(clear) || set < 0 || clear < 0 || ((set | clear) & ~7) !== 0) throw new Error("set_paused bits are 1 REGISTER, 2 EVOLVE, 4 MARKET");
  if ((set & clear) !== 0) throw new Error("set_paused: a bit cannot be both set and cleared");
  return build("set_paused", { authority: p.authority, config: configPda() }, { set_bits: set, clear_bits: clear }, p.observer ? [ro(observerSetPda())] : []);
};

/**
 * `update_tier_config` (F6): the 17 guarded fields and `tier_guard`, signed by the program's upgrade authority (the
 * time-locked multisig vault on mainnet). `priceFeed` (the Config's feed) records a fresh Pyth price first.
 */
export const updateTierConfigIx = (p: { authority: AddressLike; tier: TierParams; priceFeed?: AddressLike | null }): Instruction =>
  build(
    "update_tier_config",
    {
      authority: p.authority,
      config: configPda(),
      this_program: MINTDEX_PROGRAM_ID,
      program_data: programDataAddress(MINTDEX_PROGRAM_ID),
      price_feed: p.priceFeed ?? null,
    },
    { tier: p.tier }
  );

/**
 * `set_config_ext` (F8, F9, F12; admin B7): only the fields whose mask bit is set are written. With mask bit 4 (ticket
 * authority) the ObserverSet goes along (it may be empty), so the program can refuse an observer key.
 */
export const setConfigExtIx = (p: { admin: AddressLike; ext: ConfigExtParams }): Instruction =>
  build("set_config_ext", { admin: p.admin, config: configPda() }, { ext: { ...p.ext, ticket_authority: toAddress(p.ext.ticket_authority) } }, (p.ext.mask & 4) !== 0 ? [ro(observerSetPda())] : []);

/** `init_collection(name, uri)` (F8), once, by the admin; `uri` must be `card_uri_base ‖ "collection.json"`. */
export function initCollectionIx(p: { admin: AddressLike; name: string; uri: string }): Instruction {
  const c = collectionAddresses();
  return build(
    "init_collection",
    {
      admin: p.admin,
      config: configPda(),
      collection_authority: c.authority,
      collection_mint: c.mint,
      collection_token: c.token,
      collection_metadata: c.metadata,
      collection_edition: c.edition,
      token_program: TOKEN_PROGRAM_ID,
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SYSTEM_PROGRAM_ID,
      token_metadata_program: MPL_TOKEN_METADATA_PROGRAM_ID,
      sysvar_instructions: SYSVAR_INSTRUCTIONS_ID,
    },
    { name: p.name, uri: p.uri }
  );
}

/** `sync_card_metadata` (F8, permissionless): a Metaplex card's URI and royalty follow its level and the Config. */
export function syncCardMetadataIx(p: { mint: AddressLike }): Instruction {
  const a = coinAddresses(p.mint);
  return build("sync_card_metadata", {
    config: configPda(),
    card: a.card,
    card_metadata: a.cardMetadata,
    token_metadata_program: MPL_TOKEN_METADATA_PROGRAM_ID,
  });
}

/** `sync_collection_metadata` (F8, admin B14, permissionless): the collection URI follows `card_uri_base`. */
export function syncCollectionMetadataIx(): Instruction {
  const c = collectionAddresses();
  return build("sync_collection_metadata", {
    config: configPda(),
    collection_authority: c.authority,
    collection_metadata: c.metadata,
    token_metadata_program: MPL_TOKEN_METADATA_PROGRAM_ID,
  });
}

export type MintdexIxName =
  | "initialize"
  | "update_config"
  | "propose_admin"
  | "accept_admin"
  | "set_price"
  | "issue_tickets"
  | "revoke_ticket"
  | "register_card"
  | "register_card_metaplex"
  | "evolve"
  | "observe"
  | "set_observers"
  | "set_paused"
  | "update_tier_config"
  | "set_config_ext"
  | "init_collection"
  | "sync_card_metadata"
  | "sync_collection_metadata"
  | "collect_fees"
  | "withdraw_fees"
  | "place_bid"
  | "cancel_bid"
  | "accept_bid"
  | "list_card"
  | "delist_card"
  | "close_expired_listing"
  | "buy_now";

/** Decodes a MintDex instruction with the active IDL (null for other programs). */
export const decodeMintdexInstruction = (ix: Instruction) => mintdexProgram().decodeInstruction(ix);
