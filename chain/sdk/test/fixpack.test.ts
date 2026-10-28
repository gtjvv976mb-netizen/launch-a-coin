// Mainnet fix pack, SDK side (fix-plan §4.1): fix-pack PDAs and constants, the new accounts and fields, the eight new
// builders, the Config validation mirrors, the 43-entry lookup-table layout and the verifier's register-flag gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { findProgramAddress } from "../src/address.ts";
import {
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  MINTDEX_PROGRAM_ID,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  PYTH_SOL_USD_PRICE_ACCOUNT,
  SOL_USD_FEED_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../src/constants.ts";
import {
  clusterAltAddresses,
  clusterAltStatus,
  collectionAltExtension,
  DEVNET_PROFILE,
  isForeignOperationalKey,
  MAINNET_PROFILE,
} from "../src/cluster.ts";
import { mintdexAltAddresses } from "../src/mintdex/alt.ts";
import {
  CARD_OFFSETS,
  decodeCard,
  decodeConfig,
  decodeObserverSet,
  observerSlot,
} from "../src/mintdex/accounts.ts";
import {
  COLLECTION_AUTHORITY,
  COLLECTION_EDITION,
  COLLECTION_METADATA,
  COLLECTION_MINT,
  EXT,
  OBSERVER_SET_ADDRESS,
  PROGRAM_DATA_ADDRESS,
  PRICE_SOURCE,
  REG,
  ROLE,
  coinUri,
  collectionUri,
  configParamsFromConfig,
  devnetConfigParams,
  guardRulesOk,
  observerSetIsShrink,
  observerSlots,
  overlayTierParams,
  tierFieldsDiff,
  tierParamsFromConfig,
  validateConfigExt,
  validateConfigParams,
  validateObserverSet,
  withinPythAnchor,
} from "../src/mintdex/config.ts";
import type { ConfigParams } from "../src/mintdex/config.ts";
import * as M from "../src/mintdex/instructions.ts";
import { mintdexProgram } from "../src/mintdex/program.ts";
import { collectionAddresses, coinAddresses, observerSetPda, programDataAddress, associatedTokenAddress, cardVaultPda } from "../src/pda.ts";
import { createAtaIdempotent, setComputeUnitLimit, setComputeUnitPrice } from "../src/programs/system.ts";
import { mintdexCreateV2, pumpBuy } from "../src/programs/pump.ts";
import { verifyTransaction } from "../src/tx/verify.ts";
import type { TxIntent } from "../src/tx/verify.ts";
import { toWeb3Instruction } from "../src/web3.ts";
import type { Instruction } from "../src/instruction.ts";

const key = () => Keypair.generate().publicKey.toBase58();
const ZERO = "11111111111111111111111111111111";
const PYTH_PUSH_ORACLE = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";

test("fix-pack PDAs equal the program's precomputed constants", () => {
  assert.equal(observerSetPda(), OBSERVER_SET_ADDRESS);
  assert.equal(programDataAddress(MINTDEX_PROGRAM_ID), PROGRAM_DATA_ADDRESS);
  const c = collectionAddresses();
  assert.deepEqual([c.authority, c.mint, c.metadata, c.edition], [COLLECTION_AUTHORITY, COLLECTION_MINT, COLLECTION_METADATA, COLLECTION_EDITION]);
  // the sponsored SOL/USD feed is the push-oracle PDA [shard 0u16 LE, feed id]
  assert.equal(findProgramAddress([Uint8Array.of(0, 0), SOL_USD_FEED_ID], PYTH_PUSH_ORACLE)[0], PYTH_SOL_USD_PRICE_ACCOUNT);
  assert.equal(collectionUri(), "https://mintdex.fun/c/collection.json");
});

test("decoders: Config fix-pack fields, Card window and mark fields, ObserverSet", () => {
  const P = mintdexProgram();
  const treasury = key();
  const base = devnetConfigParams(treasury);
  const pad = (v: string) => {
    const b = new Uint8Array(64);
    b.set(new TextEncoder().encode(v));
    return b;
  };
  const ta = key();
  const cfg = {
    version: 1,
    bump: 255,
    paused: 0,
    price_source: 0,
    admin: key(),
    pending_admin: ZERO,
    price_authority: ZERO,
    treasury,
    pyth_price_account: PYTH_SOL_USD_PRICE_ACCOUNT,
    launch_fee: 0n,
    min_bid: base.min_bid,
    protocol_fee_bps: 250,
    creator_royalty_bps: 500,
    max_conf_bps: 200,
    max_price_step_bps: 2000,
    mcap_multiplier: 100,
    sweep_flags: 7,
    card_uri_base_len: 22,
    sol_usd_e6: 118_000_000n,
    sol_usd_updated_at: 0n,
    max_price_age_secs: 0,
    evolve_hold_slots: 150,
    vanity_modulus: base.vanity_modulus,
    vanity_residue: base.vanity_residue,
    tier_thresholds_usd: base.tier_thresholds_usd,
    card_uri_base: pad(base.card_uri_base),
    coin_uri_base: pad(base.coin_uri_base),
    coin_uri_base_len: 22,
    evolve_min_obs: 3,
    evolve_max_step: 2,
    _pad: 0,
    min_price_interval_secs: 300,
    last_pyth_sol_usd_e6: 0n,
    evolve_min_observers: 1,
    register_flags: 3,
    tier_guard: 1,
    outside_royalty_bps: 0,
    ticket_authority: ta,
    ticket_allowance: 300,
    evolve_resumed_slot: 0x0102030405060708n,
    reserved: new Uint8Array(17),
  };
  const bytes = P.encodeAccount("Config", cfg);
  assert.equal(bytes.length, 552);
  // byte map of fix-plan §2.2
  assert.deepEqual([bytes[488], bytes[489], bytes[490]], [1, 3, 1]);
  assert.equal(new PublicKey(bytes.subarray(493, 525)).toBase58(), ta);
  assert.equal(bytes[525] | (bytes[526] << 8), 300);
  // review round 2: the last EVOLVE unpause slot @527
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(527, true), 0x0102030405060708n);
  assert.ok(bytes.subarray(535, 552).every((b) => b === 0));
  const d = decodeConfig(bytes);
  assert.equal(d.evolve_resumed_slot, 0x0102030405060708n);
  assert.deepEqual(
    [d.evolve_min_observers, d.register_flags, d.tier_guard, d.outside_royalty_bps, d.ticket_authority, d.ticket_allowance],
    [1, 3, 1, 0, ta, 300]
  );
  // a pre-fix-pack Config (reserved bytes zero) reads as open mode, guard off, flags 0
  const old = Uint8Array.from(bytes);
  old.fill(0, 488, 552);
  const o = decodeConfig(old);
  assert.deepEqual([o.evolve_min_observers, o.register_flags, o.tier_guard, o.ticket_authority, o.evolve_resumed_slot], [0, 0, 0, ZERO, 0n]);
  assert.deepEqual(configParamsFromConfig(d), { ...base, treasury, sweep_flags: 7 });

  // Card: the window and mark offsets
  const mint = key();
  const card = P.encodeAccount("Card", {
    version: 1, bump: 255, vault_bump: 254, card_mint_bump: 253, level: 2, pending_level: 4, flags: 32 | 16, pending_obs: 1,
    mint, card_mint: key(), launcher: key(), pool: ZERO, pending_since_slot: 1000n, registered_at: 0n, evolved_at: 0n,
    peak_mcap_lamports: 0n, peak_mcap_usd_e6: 0n, fees_paid_out: 0n, last_sale_price: 0n, sales: 0, pending_last_slot: 1037n,
    pending_hwm_until: 5_000n, pending_hwm_level: 6, pending_observers: 3, pending_epoch: 2, reserved: new Uint8Array(41),
  });
  assert.equal(card.length, 264);
  assert.deepEqual(
    [card[CARD_OFFSETS.level], card[CARD_OFFSETS.pendingLevel], card[CARD_OFFSETS.flags], card[CARD_OFFSETS.pendingHwmLevel], card[CARD_OFFSETS.pendingObservers], card[CARD_OFFSETS.pendingEpoch]],
    [2, 4, 48, 6, 3, 2]
  );
  assert.equal(new DataView(card.buffer).getBigUint64(CARD_OFFSETS.pendingHwmUntil, true), 5_000n);
  assert.equal(new DataView(card.buffer).getBigUint64(CARD_OFFSETS.pendingSinceSlot, true), 1000n);
  assert.equal(new DataView(card.buffer).getBigUint64(CARD_OFFSETS.pendingLastSlot, true), 1037n);
  const c = decodeCard(card);
  assert.deepEqual([c.pending_hwm_until, c.pending_hwm_level, c.pending_observers, c.pending_epoch], [5_000n, 6, 3, 2]);

  // ObserverSet: 316 B, keys at 12, roles at 268
  const crank = key();
  const watcher = key();
  const { keys, roles } = observerSlots([
    [crank, ROLE.COUNT | ROLE.CAP],
    [key(), 3],
    [watcher, ROLE.CAP | ROLE.PAUSE],
  ]);
  const setBytes = P.encodeAccount("ObserverSet", { version: 1, bump: 254, epoch: 4, _pad: 0, keys, roles: Uint8Array.from(roles), updated_at: 9n, reserved: new Uint8Array(32) });
  assert.equal(setBytes.length, 316);
  assert.equal(setBytes[10], 4);
  assert.equal(new PublicKey(setBytes.subarray(12, 44)).toBase58(), crank);
  assert.deepEqual(Array.from(setBytes.subarray(268, 276)), [3, 3, 6, 0, 0, 0, 0, 0]);
  const set = decodeObserverSet(setBytes);
  assert.equal(set.epoch, 4);
  assert.deepEqual(observerSlot(set, watcher), { index: 2, roles: 6 });
  assert.equal(observerSlot(set, key()), null);
  assert.equal(observerSlot(set, ZERO), null, "an empty slot is never a member");
});

test("observe / evolve: 15 accounts, [ObserverSet] then the Metaplex pair; the feed is required under Pyth (tier B4)", () => {
  const cranker = key();
  const mint = key();
  const a = coinAddresses(mint);
  const admin = { price_source: PRICE_SOURCE.ADMIN, pyth_price_account: PYTH_SOL_USD_PRICE_ACCOUNT };
  const pyth = { price_source: PRICE_SOURCE.PYTH, pyth_price_account: PYTH_SOL_USD_PRICE_ACCOUNT };
  const ob = M.observeIx({ cranker, mint, graduated: false, maxLiveLevel: 5, config: admin, metaplex: true });
  assert.equal(ob.accounts.length, 18);
  assert.deepEqual(ob.accounts.slice(15).map((m) => [m.address, m.isWritable]), [
    [OBSERVER_SET_ADDRESS, false],
    [a.cardMetadata, true],
    [MPL_TOKEN_METADATA_PROGRAM_ID, false],
  ]);
  const decoded = M.decodeMintdexInstruction(ob)!;
  assert.equal(decoded.name, "observe");
  assert.deepEqual(decoded.args, { max_live_level: 5 });
  // admin source: no feed (the optional slot carries the program id)
  assert.equal(ob.accounts[9].address, MINTDEX_PROGRAM_ID);
  // Pyth: the Config's feed goes in, a wrong one throws
  const obp = M.observeIx({ cranker, mint, graduated: true, maxLiveLevel: 5, config: pyth });
  assert.equal(obp.accounts[9].address, PYTH_SOL_USD_PRICE_ACCOUNT);
  assert.equal(obp.accounts.length, 16);
  assert.throws(() => M.observeIx({ cranker, mint, graduated: true, maxLiveLevel: 5, config: pyth, priceFeed: key() }), /not the Config/);
  assert.equal(M.evolveIx({ cranker, mint, graduated: false, config: pyth }).accounts[9].address, PYTH_SOL_USD_PRICE_ACCOUNT);
  assert.equal(M.evolveIx({ cranker, mint, graduated: false, config: admin, priceFeed: key() }).accounts[9].address, MINTDEX_PROGRAM_ID);
  for (const bad of [0, 15, 2.5]) assert.throws(() => M.observeIx({ cranker, mint, graduated: false, maxLiveLevel: bad, config: admin }), /not a level/);
});

test("admin builders: set_observers (upgrade path), set_paused (observer form), set_config_ext mask, update_tier_config", () => {
  const u = key();
  const { keys, roles } = observerSlots([[key(), 3]]);
  const so = M.setObserversIx({ authority: u, keys, roles, minObservers: 1, expectedEpoch: 7, asUpgradeAuthority: true });
  const dso = M.decodeMintdexInstruction(so)!;
  assert.equal(dso.accounts.program_data, PROGRAM_DATA_ADDRESS);
  assert.equal(dso.accounts.observer_set, OBSERVER_SET_ADDRESS);
  assert.equal(dso.args.min_observers, 1);
  // review round 2: the live epoch the set was built from goes last (u8)
  assert.equal(dso.args.expected_epoch, 7);
  assert.equal(so.data.at(-1), 7);
  assert.equal(M.decodeMintdexInstruction(M.setObserversIx({ authority: u, keys, roles, minObservers: 1, expectedEpoch: 0 }))!.accounts.program_data, MINTDEX_PROGRAM_ID);
  assert.throws(() => M.setObserversIx({ authority: u, keys: keys.slice(0, 7), roles, minObservers: 0, expectedEpoch: 0 }));
  for (const bad of [-1, 256, 1.5]) assert.throws(() => M.setObserversIx({ authority: u, keys, roles, minObservers: 0, expectedEpoch: bad }), /epoch/);

  // review round 2: set_paused takes set and clear masks
  const ad = M.setPausedIx({ authority: u, set: 4, clear: 2 });
  assert.equal(ad.accounts.length, 4);
  assert.deepEqual(M.decodeMintdexInstruction(ad)!.args, { set_bits: 4, clear_bits: 2 });
  assert.deepEqual(Array.from(ad.data.subarray(8)), [4, 2]);
  assert.deepEqual(M.decodeMintdexInstruction(M.setPausedIx({ authority: u, clear: 7 }))!.args, { set_bits: 0, clear_bits: 7 });
  assert.throws(() => M.setPausedIx({ authority: u, set: 2, clear: 2 }), /both/);
  assert.throws(() => M.setPausedIx({ authority: u, set: 8 }), /bits/);
  const sp = M.setPausedIx({ authority: u, set: 2, observer: true });
  assert.equal(sp.accounts.at(-1)!.address, OBSERVER_SET_ADDRESS);
  assert.deepEqual(M.decodeMintdexInstruction(sp)!.args, { set_bits: 2, clear_bits: 0 });

  const ext = { mask: EXT.ALL, register_flags: REG.ALL, outside_royalty_bps: 0, ticket_authority: key(), ticket_allowance: 300 };
  assert.equal(M.setConfigExtIx({ admin: u, ext }).accounts.at(-1)!.address, OBSERVER_SET_ADDRESS);
  assert.equal(M.setConfigExtIx({ admin: u, ext: { ...ext, mask: EXT.REGISTER_FLAGS } }).accounts.length, 4);
  assert.deepEqual(M.decodeMintdexInstruction(M.setConfigExtIx({ admin: u, ext }))!.args.ext, ext);

  const reg = M.registerCardMetaplexIx({ launcher: u, mint: key(), treasury: key(), collection: true });
  assert.deepEqual(reg.accounts.slice(-4).map((m) => [m.address, m.isWritable]), [
    [COLLECTION_AUTHORITY, false],
    [COLLECTION_MINT, false],
    [COLLECTION_METADATA, true],
    [COLLECTION_EDITION, false],
  ]);
  assert.deepEqual(M.allowedCardStandards(0), ["metaplex-collection", "metaplex", "token2022"]);
  assert.deepEqual(M.allowedCardStandards(REG.NO_TOKEN2022), ["metaplex-collection", "metaplex"]);
  assert.deepEqual(M.allowedCardStandards(REG.ALL), ["metaplex-collection"]);
  const ic = M.decodeMintdexInstruction(M.initCollectionIx({ admin: u, name: "MintDex Cards", uri: collectionUri() }))!;
  assert.equal(ic.accounts.collection_token, associatedTokenAddress(COLLECTION_AUTHORITY, COLLECTION_MINT));
  assert.deepEqual(ic.args, { name: "MintDex Cards", uri: "https://mintdex.fun/c/collection.json" });
});

/** The mainnet Config of fix-plan §6.1 as ConfigParams. */
function mainnetParams(treasury: string): ConfigParams {
  return {
    ...devnetConfigParams(treasury),
    price_source: PRICE_SOURCE.PYTH,
    pyth_price_account: PYTH_SOL_USD_PRICE_ACCOUNT,
    sol_usd_e6: 150_000_000n,
    max_price_age_secs: 120,
    max_conf_bps: 200,
    max_price_step_bps: 2000,
    min_price_interval_secs: 300,
    launch_fee: 20_000_000n,
    min_bid: 50_000_000n,
    protocol_fee_bps: 250,
    creator_royalty_bps: 500,
    mcap_multiplier: 1,
    tier_thresholds_usd: [15_000n, 50_000n, 100_000n, 150_000n, 200_000n, 300_000n, 400_000n, 500_000n, 600_000n, 700_000n, 800_000n, 900_000n, 1_000_000n].map((x) => x * 1_000_000n),
    evolve_hold_slots: 9_000,
    evolve_min_obs: 8,
    evolve_max_step: 2,
  };
}

test("validateConfigParams mirrors is_valid (fix pack): launch fee cap, protocol fee 0, pinned feed, 1..=300 s", () => {
  const t = key();
  const rent0 = 650_240n;
  assert.deepEqual(validateConfigParams(devnetConfigParams(t), rent0), []);
  const m = mainnetParams(t);
  assert.deepEqual(validateConfigParams(m, rent0), []);
  assert.ok(guardRulesOk(m));
  assert.match(validateConfigParams({ ...m, launch_fee: 100_000_001n }, rent0).join(), /launch_fee/);
  assert.deepEqual(validateConfigParams({ ...m, launch_fee: 100_000_000n }, rent0), []);
  assert.deepEqual(validateConfigParams({ ...m, protocol_fee_bps: 0 }, rent0), [], "F11: protocol fee 0 allowed");
  assert.match(validateConfigParams({ ...m, pyth_price_account: key() }, rent0).join(), /pinned/);
  assert.match(validateConfigParams({ ...m, max_price_age_secs: 301 }, rent0).join(), /1\.\.=300/);
  assert.match(validateConfigParams({ ...m, max_price_age_secs: 0 }, rent0).join(), /1\.\.=300/);
  assert.match(validateConfigParams({ ...devnetConfigParams(t), sol_usd_e6: 0n }, rent0).join(), /sol_usd_e6/);
  assert.match(validateConfigParams({ ...m, paused: 8 }, rent0).join(), /paused/);
  assert.match(validateConfigParams({ ...m, vanity_residue: m.vanity_modulus }, rent0).join(), /vanity_residue/);
  // guard-only rules (admin B8)
  assert.ok(!guardRulesOk({ ...m, min_price_interval_secs: 59 }));
  assert.ok(!guardRulesOk({ ...m, max_price_step_bps: 2001 }));
  assert.ok(guardRulesOk({ ...m, price_source: 0, max_price_age_secs: 0 }));
  assert.ok(!guardRulesOk({ ...m, price_source: 0, max_price_age_secs: 359 }));
  assert.ok(guardRulesOk({ ...m, price_source: 0, max_price_age_secs: 360 }));
});

test("tier fields (17), the overlay, ext mask, observer set rules, the Pyth anchor", () => {
  const t = key();
  const p = devnetConfigParams(t);
  const pad = (v: string) => {
    const b = new Uint8Array(64);
    b.set(new TextEncoder().encode(v));
    return b;
  };
  const cfg = { ...p, card_uri_base: pad(p.card_uri_base), card_uri_base_len: 22, coin_uri_base: pad(p.coin_uri_base), coin_uri_base_len: 22, tier_guard: 1 };
  assert.deepEqual(tierFieldsDiff(cfg, p), []);
  assert.deepEqual(tierFieldsDiff(cfg, { ...p, min_bid: 1n, treasury: key(), coin_uri_base: "https://x.example/" }), [], "unguarded fields");
  assert.deepEqual(tierFieldsDiff(cfg, { ...p, launch_fee: 1n, protocol_fee_bps: 0, creator_royalty_bps: 1 }), ["launch_fee", "protocol_fee_bps", "creator_royalty_bps"]);
  assert.deepEqual(tierFieldsDiff(cfg, { ...p, tier_thresholds_usd: [...p.tier_thresholds_usd.slice(0, 12), 1n] }), ["tier_thresholds_usd"]);
  const tier = tierParamsFromConfig(cfg, { evolve_hold_slots: 9_000 });
  assert.equal(tier.tier_guard, 1);
  assert.equal(overlayTierParams(p, tier).evolve_hold_slots, 9_000);
  assert.equal(overlayTierParams(p, tier).min_bid, p.min_bid);

  assert.deepEqual(validateConfigExt({ mask: 15, register_flags: 3, outside_royalty_bps: 1000, ticket_authority: key(), ticket_allowance: 300 }), []);
  assert.equal(validateConfigExt({ mask: 0, register_flags: 0, outside_royalty_bps: 0, ticket_authority: ZERO, ticket_allowance: 0 }).length, 1);
  assert.equal(validateConfigExt({ mask: 16, register_flags: 0, outside_royalty_bps: 0, ticket_authority: ZERO, ticket_allowance: 0 }).length, 1);
  assert.equal(validateConfigExt({ mask: 2, register_flags: 9, outside_royalty_bps: 1001, ticket_authority: ZERO, ticket_allowance: 0 }).length, 1);

  const admin = key();
  const crank = key();
  const watcher = key();
  const forbidden = { admin, treasury: t, ticketAuthority: ZERO };
  const ok = observerSlots([[crank, 3], [key(), 3], [watcher, 6]]);
  assert.deepEqual(validateObserverSet(ok.keys, ok.roles, 1, forbidden), []);
  assert.ok(validateObserverSet(ok.keys, ok.roles, 3, forbidden).length > 0, "min above the COUNT keys");
  assert.ok(validateObserverSet(observerSlots([[crank, 1]]).keys, [1, 0, 0, 0, 0, 0, 0, 0], 0, forbidden).length > 0, "COUNT without CAP");
  assert.ok(validateObserverSet(observerSlots([[admin, 3]]).keys, observerSlots([[admin, 3]]).roles, 0, forbidden).length > 0, "admin key");
  assert.ok(validateObserverSet(observerSlots([[crank, 3], [crank, 2]]).keys, observerSlots([[crank, 3], [crank, 2]]).roles, 0, forbidden).length > 0, "duplicate");
  const old = { ...ok, minObservers: 1 };
  assert.ok(observerSetIsShrink(old, { ...observerSlots([[crank, 3], [ZERO, 0], [watcher, 2]]), minObservers: 1 }));
  assert.ok(!observerSetIsShrink(old, { ...observerSlots([[crank, 3], [key(), 3], [watcher, 6]]), minObservers: 1 }), "new key");
  assert.ok(!observerSetIsShrink(old, { ...observerSlots([[crank, 7], [ZERO, 0], [watcher, 6]]), minObservers: 1 }), "role grows");
  assert.ok(!observerSetIsShrink(old, { ...ok, minObservers: 0 }), "min decreases");

  assert.ok(withinPythAnchor(110n, 100n));
  assert.ok(!withinPythAnchor(111n, 100n));
  assert.ok(withinPythAnchor(50n, 100n));
  assert.ok(!withinPythAnchor(49n, 100n));
  assert.ok(!withinPythAnchor(100n, 0n), "no baseline");
});

test("cluster ALT layout: 43 entries = the 38 + 4 collection PDAs + the Metaplex program; status full / base / foreign", () => {
  const treasury = key();
  const dev = clusterAltAddresses(DEVNET_PROFILE, treasury);
  assert.equal(dev.length, 43);
  assert.deepEqual(dev.slice(0, 38), mintdexAltAddresses({ treasury }));
  assert.deepEqual(dev.slice(38), collectionAltExtension());
  assert.equal(new Set(dev).size, 43);
  const main = clusterAltAddresses(MAINNET_PROFILE, treasury);
  assert.deepEqual(main.slice(9, 17), [...MAINNET_PROFILE.pumpFeeRecipients]);
  assert.notDeepEqual(main.slice(9, 17), dev.slice(9, 17));
  assert.equal(clusterAltStatus(dev, DEVNET_PROFILE, treasury), "full");
  assert.equal(clusterAltStatus([...dev, key()], DEVNET_PROFILE, treasury), "full", "appended entries are fine");
  assert.equal(clusterAltStatus(dev.slice(0, 38), DEVNET_PROFILE, treasury), "base");
  assert.equal(clusterAltStatus(dev, MAINNET_PROFILE, treasury), null, "devnet recipients are not a mainnet table");
  assert.equal(clusterAltStatus(dev, DEVNET_PROFILE, key()), null, "another treasury");
  assert.ok(isForeignOperationalKey(MAINNET_PROFILE, "ELqqNK1m7nFPvV6s3maE5BYxfxgEJR5VMWqjaCgzHLD"));
  assert.ok(!isForeignOperationalKey(DEVNET_PROFILE, "ELqqNK1m7nFPvV6s3maE5BYxfxgEJR5VMWqjaCgzHLD"));
  assert.equal(MAINNET_PROFILE.siwsChainId, "mainnet");
});

test("verifier: collection launch through the 43-entry ALT; register_flags refuses disabled standards; recipients required", () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const treasury = key();
  const altKey = key();
  const altAddrs = clusterAltAddresses(DEVNET_PROFILE, treasury);
  const NAME = "Comet Corgi".padEnd(32, "!");
  const SYMBOL = "CORGIXXXXX";
  const compile = (ixs: Instruction[]) => {
    const alt = new AddressLookupTableAccount({
      key: new PublicKey(altKey),
      state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: altAddrs.map((a) => new PublicKey(a)) },
    });
    const msg = new TransactionMessage({ payerKey: new PublicKey(wallet), recentBlockhash: key(), instructions: ixs.map(toWeb3Instruction) }).compileToV0Message([alt]);
    return new VersionedTransaction(msg).serialize();
  };
  const vault = cardVaultPda(mint);
  const ata = associatedTokenAddress(wallet, mint, TOKEN_2022_PROGRAM_ID);
  const ixs = (standard: M.CardStandard, devBuy: boolean) => [
    setComputeUnitLimit(450_000),
    setComputeUnitPrice(100_000n),
    mintdexCreateV2({ mint, user: wallet, name: NAME, symbol: SYMBOL, uri: coinUri(mint) }),
    M.registerIxFor(standard, { launcher: wallet, mint, treasury }),
    ...(devBuy
      ? [
          createAtaIdempotent(wallet, ata, wallet, mint, TOKEN_2022_PROGRAM_ID),
          pumpBuy({ mint, user: wallet, creator: vault, feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[2], buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[1], amount: 1_700_000_000_000n, maxSolCost: 50_500_000n }),
        ]
      : []),
  ];
  const intent: TxIntent = { kind: "launch", payer: wallet, mint, name: NAME, symbol: SYMBOL, uri: coinUri(mint), treasury, devBuy: null, cardStandard: "metaplex-collection" };
  const opts = { lookupTables: { [altKey]: altAddrs }, allowedLookupTables: [altKey], registerFlags: REG.ALL };
  const col = compile(ixs("metaplex-collection", false));
  console.log(`  collection launch, no dev buy, 43-entry ALT: ${col.length} bytes`);
  assert.ok(col.length <= 1232);
  assert.deepEqual(verifyTransaction(col, intent, opts).errors, []);
  // the same template is refused under the plain metaplex intent (4 extra accounts), and the plain one under collection
  assert.equal(verifyTransaction(col, { ...intent, cardStandard: "metaplex" }, { ...opts, registerFlags: 0 }).ok, false);
  assert.equal(verifyTransaction(compile(ixs("metaplex", false)), intent, opts).ok, false);
  // register_flags gate (F9)
  assert.match(verifyTransaction(compile(ixs("token2022", false)), { ...intent, cardStandard: "token2022" }, { ...opts, registerFlags: REG.NO_TOKEN2022 }).errors.join(), /disabled by the Config/);
  assert.match(verifyTransaction(compile(ixs("metaplex", false)), { ...intent, cardStandard: "metaplex" }, { ...opts, registerFlags: REG.REQUIRE_COLLECTION }).errors.join(), /disabled by the Config/);
  assert.ok(verifyTransaction(compile(ixs("metaplex", false)), { ...intent, cardStandard: "metaplex" }, { ...opts, registerFlags: REG.NO_TOKEN2022 }).ok);
  // a dev buy needs the recipients: no silent devnet default
  const withBuy = compile(ixs("metaplex-collection", true));
  const buyIntent: TxIntent = { ...intent, devBuy: { minTokens: 1_650_000_000_000n, maxSolCost: 50_500_000n } };
  assert.match(verifyTransaction(withBuy, buyIntent, opts).errors.join(), /recipients are required/);
  const rec = { pumpFeeRecipients: DEVNET_PUMP_FEE_RECIPIENTS, pumpBuybackFeeRecipients: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS };
  const r = verifyTransaction(withBuy, buyIntent, { ...opts, ...rec });
  console.log(`  collection launch with dev buy: ${withBuy.length} bytes (${r.ok ? "fits" : r.errors.join()})`);
  if (withBuy.length <= 1232) assert.deepEqual(r.errors, []);
});
