// MintDex side: the IDL engine (cross-checked with Anchor's BorshCoder on the real pump IDL and on the
// placeholder MintDex IDL), spec account layouts, instruction builders, events, config validation,
// the vanity residue (U5 mirror) and char-boundary truncation (U10 mirror).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BN, BorshCoder } from "@coral-xyz/anchor";
import type { Idl as AnchorIdl } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as pump from "@pump-fun/pump-sdk";
import { IdlProgram, anchorDiscriminator } from "../src/idl.ts";
import type { Idl } from "../src/idl.ts";
import { MINTDEX_SPEC_IDL } from "../src/mintdex/spec-idl.ts";
import { mintdexIdlIsPlaceholder, mintdexProgram, setMintdexIdl } from "../src/mintdex/program.ts";
import { MINTDEX_IDL_GENERATED } from "../src/mintdex/idl.generated.ts";
import * as M from "../src/mintdex/instructions.ts";
import { ACCOUNT_SIZE, decodeCard, decodeConfig, MEMCMP, configCoinUriBase } from "../src/mintdex/accounts.ts";
import { decodeMintdexEvent, isAuthenticEventIx } from "../src/mintdex/events.ts";
import {
  cardName,
  cardUri,
  coinUri,
  devnetConfigParams,
  passesVanityCheck,
  tierParamsFromConfig,
  truncateUtf8,
  validateConfigParams,
  vanityResidue,
} from "../src/mintdex/config.ts";
import { decodePumpGlobal } from "../src/accounts/pump.ts";
import { base58Encode, concatBytes, utf8Encode, readU64 } from "../src/bytes.ts";
import { ANCHOR_EVENT_IX_TAG, MINTDEX_PROGRAM_ID, MPL_TOKEN_METADATA_PROGRAM_ID, PYTH_SOL_USD_PRICE_ACCOUNT, SYSVAR_INSTRUCTIONS_ID } from "../src/constants.ts";
import { decodeMetaplexMasterEdition, decodeMetaplexMetadata, MPL_TOKEN_STANDARD } from "../src/accounts/metaplex.ts";
import { metaplexMasterEditionPda, metaplexMetadataPda } from "../src/pda.ts";
import { cardTokenAccount, coinAddresses, configPda, mintdexEventAuthority } from "../src/pda.ts";
import { big, fixtureAccount, fixtureAccountInfo, rng } from "./helpers.ts";

const key = () => Keypair.generate().publicKey.toBase58();

/** Converts SDK-shaped values (bigint, base58) to Anchor's (BN, PublicKey) for BorshCoder. */
function toAnchor(v: unknown): unknown {
  if (typeof v === "bigint") return new BN(v.toString());
  if (typeof v === "string" && v.length >= 32 && v.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(v))
    return new PublicKey(v);
  if (v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v.map(toAnchor);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toAnchor(x)]));
  return v;
}

/** A decoded-Config-shaped object from the devnet params (for builders that take the live Config). */
function fakeConfig(treasury: string) {
  const p = devnetConfigParams(treasury);
  const pad = (v: string) => {
    const b = new Uint8Array(64);
    b.set(utf8Encode(v));
    return b;
  };
  return {
    ...p,
    card_uri_base: pad(p.card_uri_base),
    card_uri_base_len: utf8Encode(p.card_uri_base).length,
    coin_uri_base: pad(p.coin_uri_base),
    coin_uri_base_len: utf8Encode(p.coin_uri_base).length,
    tier_guard: 0,
  };
}

test("IDL engine = Anchor BorshCoder on the real pump IDL (create_v2 / buy / sell args, Global account)", () => {
  const idl = pump.pumpIdl as unknown as Idl;
  const mine = new IdlProgram(idl);
  const anchor = new BorshCoder(pump.pumpIdl as unknown as AnchorIdl);
  const creator = key();
  const cases: [string, Record<string, unknown>][] = [
    [
      "create_v2",
      {
        name: "Noodl",
        symbol: "NOODL",
        uri: "https://mintdex.fun/m/x.json",
        creator,
        is_mayhem_mode: false,
        is_cashback_enabled: [false],
        creator_fee_bps: [0n],
        is_holder_reward: [false],
      },
    ],
    ["buy", { amount: 123n, max_sol_cost: 456n, track_volume: [true] }],
    ["sell", { amount: 789n, min_sol_output: 1n }],
  ];
  for (const [name, args] of cases) {
    assert.deepEqual(
      Buffer.from(mine.encodeArgs(name, args)),
      Buffer.from(anchor.instruction.encode(name, toAnchor(args) as never)),
      name
    );
  }
  // full account decode through the engine agrees with the SDK and with the fixed-offset reader
  const g = mine.decodeAccount<Record<string, unknown>>("Global", fixtureAccount("pump_global").data);
  const sdk = pump.PUMP_SDK.decodeGlobal(fixtureAccountInfo("pump_global"));
  assert.equal(g.withdraw_authority, sdk.withdrawAuthority.toBase58());
  assert.deepEqual(
    g.buyback_fee_recipients,
    sdk.buybackFeeRecipients.map((k) => k.toBase58())
  );
  assert.equal(g.pool_migration_fee, big(sdk.poolMigrationFee));
  assert.deepEqual(decodePumpGlobal(fixtureAccount("pump_global").data).feeRecipients, g.fee_recipients);
});

test("placeholder IDL: Anchor-rule discriminators and the spec account sizes", () => {
  for (const ix of MINTDEX_SPEC_IDL.instructions)
    assert.deepEqual(ix.discriminator, anchorDiscriminator("global", ix.name));
  const prog = new IdlProgram(MINTDEX_SPEC_IDL);
  for (const [name, size] of Object.entries(ACCOUNT_SIZE)) assert.equal(prog.accountSize(name), size, name);
  // every instruction ends with the #[event_cpi] accounts
  for (const ix of MINTDEX_SPEC_IDL.instructions) {
    assert.deepEqual(
      ix.accounts.slice(-2).map((a) => a.name),
      ["event_authority", "program"],
      ix.name
    );
  }
});

function sampleCard() {
  return {
    version: 1,
    bump: 250,
    vault_bump: 251,
    card_mint_bump: 252,
    level: 3,
    pending_level: 5,
    flags: 9,
    pending_obs: 2,
    mint: key(),
    card_mint: key(),
    launcher: key(),
    pool: key(),
    pending_since_slot: 506_740_017n,
    registered_at: 1_790_000_000n,
    evolved_at: 1_790_000_100n,
    peak_mcap_lamports: 13_696_005_619n,
    peak_mcap_usd_e6: 161_612_866_304n,
    fees_paid_out: 15_771_447n,
    last_sale_price: 30_000_000n,
    sales: 7,
    pending_last_slot: 506_740_100n,
    // mainnet fix pack (fix-plan §2.2): carved out of reserved[52] @212
    pending_hwm_until: 506_740_250n,
    pending_hwm_level: 5,
    pending_observers: 1,
    pending_epoch: 2,
    reserved: new Uint8Array(41),
  };
}

function sampleConfig() {
  const p = devnetConfigParams(key());
  const pad = (s: string) => {
    const out = new Uint8Array(64);
    out.set(utf8Encode(s));
    return out;
  };
  return {
    version: 1,
    bump: 255,
    paused: 0,
    price_source: 0,
    admin: key(),
    pending_admin: key(),
    price_authority: p.price_authority,
    treasury: p.treasury,
    pyth_price_account: p.pyth_price_account,
    launch_fee: 0n,
    min_bid: p.min_bid,
    protocol_fee_bps: 250,
    creator_royalty_bps: 500,
    max_conf_bps: 200,
    max_price_step_bps: 2000,
    mcap_multiplier: 100,
    sweep_flags: 7,
    card_uri_base_len: 22,
    sol_usd_e6: p.sol_usd_e6,
    sol_usd_updated_at: 1_790_000_000n,
    max_price_age_secs: 0,
    evolve_hold_slots: 150,
    vanity_modulus: p.vanity_modulus,
    vanity_residue: p.vanity_residue,
    tier_thresholds_usd: p.tier_thresholds_usd,
    card_uri_base: pad(p.card_uri_base),
    coin_uri_base: pad(p.coin_uri_base),
    coin_uri_base_len: 22,
    evolve_min_obs: 3,
    evolve_max_step: 2,
    _pad: 0,
    min_price_interval_secs: 300,
    last_pyth_sol_usd_e6: 117_540_000n,
    // mainnet fix pack (fix-plan §2.2): carved out of reserved[64] @488
    evolve_min_observers: 1,
    register_flags: 3,
    tier_guard: 1,
    outside_royalty_bps: 250,
    ticket_authority: key(),
    ticket_allowance: 300,
    evolve_resumed_slot: 0n,
    reserved: new Uint8Array(17),
  };
}

test("placeholder account encodings equal Anchor's and put fields at the card-program-v2 §4 offsets", async () => {
  const prog = new IdlProgram(MINTDEX_SPEC_IDL);
  const anchor = new BorshCoder(MINTDEX_SPEC_IDL as unknown as AnchorIdl);
  const card = sampleCard();
  const cardBytes = prog.encodeAccount("Card", card);
  assert.deepEqual(Buffer.from(cardBytes), await anchor.accounts.encode("Card", toAnchor(card)));
  assert.equal(base58Encode(cardBytes.subarray(MEMCMP.card.mint, MEMCMP.card.mint + 32)), card.mint);
  assert.equal(base58Encode(cardBytes.subarray(MEMCMP.card.launcher, MEMCMP.card.launcher + 32)), card.launcher);
  assert.equal(cardBytes[12], 3, "level @12");
  assert.equal(readU64(cardBytes, 144), card.pending_since_slot);
  assert.equal(readU64(cardBytes, 204), card.pending_last_slot);
  assert.equal(readU64(cardBytes, 212), card.pending_hwm_until, "pending_hwm_until @212");
  assert.deepEqual([cardBytes[220], cardBytes[221], cardBytes[222]], [5, 1, 2], "hwm level @220, observers @221, epoch @222");
  assert.deepEqual(decodeCard(cardBytes), card);

  const cfg = sampleConfig();
  const cfgBytes = prog.encodeAccount("Config", cfg);
  assert.equal(cfgBytes.length, 552);
  assert.deepEqual(Buffer.from(cfgBytes), await anchor.accounts.encode("Config", toAnchor(cfg)));
  assert.equal(base58Encode(cfgBytes.subarray(108, 140)), cfg.treasury, "treasury @108");
  assert.equal(readU64(cfgBytes, 180), cfg.min_bid, "min_bid @180");
  assert.equal(readU64(cfgBytes, 200), cfg.sol_usd_e6, "sol_usd_e6 @200");
  assert.equal(readU64(cfgBytes, 240), 15_000n, "thresholds @240");
  assert.equal(cfgBytes[472], 22, "coin_uri_base_len @472");
  assert.equal(readU64(cfgBytes, 480), cfg.last_pyth_sol_usd_e6, "last_pyth @480");
  assert.deepEqual([cfgBytes[488], cfgBytes[489], cfgBytes[490]], [1, 3, 1], "evolve_min_observers @488, register_flags @489, tier_guard @490");
  assert.equal(base58Encode(cfgBytes.subarray(493, 525)), cfg.ticket_authority, "ticket_authority @493");
  assert.equal(configCoinUriBase(decodeConfig(cfgBytes)), "https://mintdex.fun/m/");

  const bid = { version: 1, bump: 3, mint: key(), bidder: key(), amount: 30_000_000n, created_at: 1n, updated_at: 2n };
  const bidBytes = prog.encodeAccount("Bid", bid);
  assert.equal(base58Encode(bidBytes.subarray(10, 42)), bid.mint);
  assert.equal(base58Encode(bidBytes.subarray(42, 74)), bid.bidder);
  const listing = {
    version: 1,
    bump: 3,
    flags: 1,
    level_at_list: 2,
    mint: key(),
    seller: key(),
    price: 1n,
    created_at: 3n,
    expires_at: 0n,
    min_fees_to_seller: 17n,
  };
  const lb = prog.encodeAccount("Listing", listing);
  assert.equal(lb.length, 108);
  assert.equal(base58Encode(lb.subarray(12, 44)), listing.mint);
  assert.equal(base58Encode(lb.subarray(44, 76)), listing.seller);
  assert.equal(readU64(lb, 100), 17n, "min_fees_to_seller @100 (§18.9)");
  assert.deepEqual(Buffer.from(lb), await anchor.accounts.encode("Listing", toAnchor(listing)));
});

test("builders: account counts and signers follow §7 (register 14, evolve 15, accept 28, buy_now 26)", () => {
  const mint = key();
  const user = key();
  const treasury = key();
  const launcher = key();
  const signers = (ix: { accounts: { address: string; isSigner: boolean }[] }) =>
    ix.accounts.filter((a) => a.isSigner).map((a) => a.address);
  const reg = M.registerCardIx({ launcher: user, mint, treasury });
  assert.equal(reg.accounts.length, 14);
  assert.deepEqual(signers(reg), [user, mint]);
  assert.equal(reg.accounts[8].address, cardTokenAccount(user, mint));
  assert.deepEqual(Array.from(reg.data), anchorDiscriminator("global", "register_card"));
  const ev = M.evolveIx({ cranker: user, mint, graduated: false });
  assert.equal(ev.accounts.length, 15);
  assert.equal(ev.accounts[6].address, MINTDEX_PROGRAM_ID, "None pool = program id");
  assert.equal(ev.accounts[12].address, SYSVAR_INSTRUCTIONS_ID);
  const evg = M.evolveIx({ cranker: user, mint, graduated: true });
  assert.equal(evg.accounts[6].address, coinAddresses(mint).pool);
  assert.equal(
    M.acceptBidIx({ seller: user, bidder: key(), mint, launcher, treasury, minAmount: 1n, maxTotalFeeBps: 750, minFeesToSeller: 0n })
      .accounts.length,
    28
  );
  assert.equal(
    M.buyNowIx({ buyer: user, seller: key(), mint, launcher, treasury, expectedPrice: 1n, maxTotalFeeBps: 750 })
      .accounts.length,
    26
  );
  const wd = M.withdrawFeesIx({ holder: user, mint, extraWsolAccounts: [key(), key()] });
  assert.equal(wd.accounts.length, 21 + 2, "spec 20 + config (see §18) + 2 extra WSOL accounts");
  assert.ok(wd.accounts.slice(-2).every((a) => a.isWritable && !a.isSigner));
  assert.equal(M.collectFeesIx({ payer: user, mint }).accounts.length, 18);
  assert.equal(M.listCardIx({ seller: user, mint, price: 30_000_000n, expiresAt: 0n, flags: 1, minFeesToSeller: 0n }).accounts.length, 12);
  const wdListing = wd.accounts[6];
  assert.equal(wdListing.address, coinAddresses(mint).listing);
  assert.ok(wdListing.isWritable, "withdraw_fees lowers the listing's fee floor (§18.9)");
  assert.equal(M.delistCardIx({ seller: user, mint }).accounts.length, 10);
  assert.equal(M.closeExpiredListingIx({ payer: user, seller: key(), mint }).accounts.length, 11);
  assert.equal(M.placeBidIx({ bidder: user, mint, amount: 30_000_000n }).accounts.length, 7);
  assert.equal(M.cancelBidIx({ bidder: user, mint }).accounts.length, 4);
  const tickets = M.issueTicketsIx({ admin: user, mints: [mint, key()], flags: 1 });
  assert.equal(tickets.accounts.length, 5 + 4);
  const init = M.initializeIx({ admin: user, params: devnetConfigParams(treasury) });
  assert.equal(init.accounts.length, 9, "initialize: admin, config, treasury, program, program_data, system, price_feed (optional, F4) + event_cpi");
  assert.equal(init.accounts[6].address, MINTDEX_PROGRAM_ID, "absent price_feed = program id (Anchor None)");
  assert.equal(init.accounts[1].address, configPda());
  assert.equal(init.accounts[2].address, treasury, "treasury = params.treasury (its balance is checked)");
  const pythParams = { ...devnetConfigParams(treasury), price_source: 1, pyth_price_account: PYTH_SOL_USD_PRICE_ACCOUNT };
  assert.equal(M.initializeIx({ admin: user, params: pythParams }).accounts[6].address, PYTH_SOL_USD_PRICE_ACCOUNT, "F4: a Pyth config passes its feed by default");
  assert.equal(M.initializeIx({ admin: user, params: pythParams, priceFeed: null }).accounts[6].address, MINTDEX_PROGRAM_ID, "priceFeed: null omits it");
  const upd = M.updateConfigIx({ admin: user, params: devnetConfigParams(treasury) });
  assert.equal(upd.accounts.length, 6);
  assert.equal(upd.accounts[3].address, MINTDEX_PROGRAM_ID, "absent price_feed = program id (Anchor None)");
  const pyth = key();
  assert.equal(M.updateConfigIx({ admin: user, params: devnetConfigParams(treasury), priceFeed: pyth }).accounts[3].address, pyth);
  const revoke = M.revokeTicketIx({ admin: user, mint, treasury });
  assert.equal(revoke.accounts.length, 7);
  assert.deepEqual(revoke.accounts.slice(2, 5).map((a) => a.address), [mint, coinAddresses(mint).ticket, treasury]);
});

test("every builder round-trips through decodeMintdexInstruction", () => {
  const mint = key();
  const u = key();
  const ixs = [
    M.initializeIx({ admin: u, params: devnetConfigParams(u) }),
    M.updateConfigIx({ admin: u, params: devnetConfigParams(u) }),
    M.proposeAdminIx({ admin: u, newAdmin: key() }),
    M.acceptAdminIx({ pendingAdmin: u }),
    M.setPriceIx({ authority: u, solUsdE6: 118_000_000n }),
    M.issueTicketsIx({ admin: u, mints: [mint], flags: 0 }),
    M.revokeTicketIx({ admin: u, mint, treasury: key() }),
    M.registerCardIx({ launcher: u, mint, treasury: key() }),
    M.evolveIx({ cranker: u, mint, graduated: true }),
    M.collectFeesIx({ payer: u, mint }),
    M.withdrawFeesIx({ holder: u, mint }),
    M.placeBidIx({ bidder: u, mint, amount: 31_000_000n }),
    M.cancelBidIx({ bidder: u, mint }),
    M.acceptBidIx({
      seller: u,
      bidder: key(),
      mint,
      launcher: key(),
      treasury: key(),
      minAmount: 30_000_000n,
      maxTotalFeeBps: 750,
      minFeesToSeller: 2_962_963n,
    }),
    M.listCardIx({ seller: u, mint, price: 50_000_000n, expiresAt: 1_800_000_000n, flags: 1, minFeesToSeller: 1_000n }),
    M.delistCardIx({ seller: u, mint }),
    M.closeExpiredListingIx({ payer: u, seller: key(), mint }),
    M.buyNowIx({
      buyer: u,
      seller: key(),
      mint,
      launcher: key(),
      treasury: key(),
      expectedPrice: 50_000_000n,
      maxTotalFeeBps: 750,
    }),
    M.registerCardMetaplexIx({ launcher: u, mint, treasury: key() }),
    M.observeIx({ cranker: u, mint, graduated: false, maxLiveLevel: 3, config: { price_source: 0, pyth_price_account: key() } }),
    M.setObserversIx({ authority: u, keys: Array(8).fill("11111111111111111111111111111111"), roles: Array(8).fill(0), minObservers: 0, expectedEpoch: 3 }),
    M.setPausedIx({ authority: u, set: 2, clear: 4 }),
    M.updateTierConfigIx({ authority: u, tier: tierParamsFromConfig(fakeConfig(u)) }),
    M.setConfigExtIx({ admin: u, ext: { mask: 15, register_flags: 3, outside_royalty_bps: 0, ticket_authority: key(), ticket_allowance: 300 } }),
    M.initCollectionIx({ admin: u, name: "MintDex Cards", uri: "https://mintdex.fun/c/collection.json" }),
    M.syncCardMetadataIx({ mint }),
    M.syncCollectionMetadataIx(),
  ];
  assert.equal(
    new Set(ixs.map((i) => mintdexProgram().decodeInstruction(i)!.name)).size,
    MINTDEX_SPEC_IDL.instructions.length
  );
  const listed = M.decodeMintdexInstruction(ixs[14])!;
  assert.deepEqual(listed.args, { price: 50_000_000n, expires_at: 1_800_000_000n, flags: 1, min_fees_to_seller: 1_000n });
  assert.deepEqual(M.decodeMintdexInstruction(ixs[13])!.args, {
    min_amount: 30_000_000n,
    max_total_fee_bps: 750,
    min_fees_to_seller: 2_962_963n,
  });
  assert.equal(listed.accounts.listing_escrow, coinAddresses(mint).listingEscrow);
  const params = M.decodeMintdexInstruction(ixs[0])!.args.params as Record<string, unknown>;
  assert.equal(params.coin_uri_base, "https://mintdex.fun/m/");
});

test("IDL drop-in: the real anchor build IDL (when synced) carries every spec instruction, account and arg", (t) => {
  if (MINTDEX_IDL_GENERATED === null) {
    assert.equal(mintdexIdlIsPlaceholder(), true);
    t.skip("program v2 IDL not synced yet (run scripts/sync-idl.mjs after anchor build)");
    return;
  }
  const real = MINTDEX_IDL_GENERATED;
  const drift: string[] = [];
  // docs are only in the real IDL; bigints only in the placeholder
  const j = (x: unknown) => JSON.stringify(x, (k, v) => (k === "docs" ? undefined : typeof v === "bigint" ? v.toString() : v));
  assert.equal(real.instructions.length, MINTDEX_SPEC_IDL.instructions.length, "instruction count");
  for (const spec of MINTDEX_SPEC_IDL.instructions) {
    const r = real.instructions.find((i) => i.name === spec.name);
    if (!r) {
      drift.push(`missing instruction ${spec.name}`);
      continue;
    }
    const names = new IdlProgram(real).accountNames(spec.name);
    const specNames = spec.accounts.map((a) => (a as { name: string }).name);
    if (names.join(",") !== specNames.join(","))
      drift.push(`${spec.name} accounts: real [${names}] spec [${specNames}]`);
    // signer / writable / optional flags decide the AccountMeta the builders emit
    const flags = (a: unknown) => {
      const x = a as { signer?: boolean; writable?: boolean; optional?: boolean };
      return `${x.signer ? "s" : ""}${x.writable ? "w" : ""}${x.optional ? "o" : ""}`;
    };
    if (r.accounts.map(flags).join(",") !== spec.accounts.map(flags).join(","))
      drift.push(`${spec.name} account flags: real [${r.accounts.map(flags)}] spec [${spec.accounts.map(flags)}]`);
    if (j(r.discriminator) !== j(spec.discriminator)) drift.push(`${spec.name} discriminator differs`);
    if (j(r.args) !== j(spec.args)) drift.push(`${spec.name} args differ`);
  }
  // account and event discriminators, every type's fields (accounts, ConfigParams, events), error codes
  const set = (a: { name: string; discriminator?: unknown }[] = []) => a.map((x) => x.name + j(x.discriminator)).sort().join(",");
  if (set(real.accounts) !== set(MINTDEX_SPEC_IDL.accounts)) drift.push("account discriminators differ");
  if (set(real.events) !== set(MINTDEX_SPEC_IDL.events)) drift.push("event discriminators differ");
  for (const t of MINTDEX_SPEC_IDL.types ?? []) {
    const r = (real.types ?? []).find((x) => x.name === t.name);
    if (!r || j(r.type) !== j(t.type)) drift.push(`type ${t.name} differs`);
  }
  if (j((real.errors ?? []).map((e) => [e.code, e.name])) !== j((MINTDEX_SPEC_IDL.errors ?? []).map((e) => [e.code, e.name])))
    drift.push("error codes differ");
  assert.deepEqual(drift, [], "update spec-idl.ts and the builders to match the program");
  assert.equal(mintdexIdlIsPlaceholder(), false, "builders use the synced IDL");
});

test("setMintdexIdl swaps the coder; a renamed account makes the builder fail loudly", () => {
  const renamed = JSON.parse(
    JSON.stringify(MINTDEX_SPEC_IDL, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  ) as Idl;
  const reg = renamed.instructions.find((i) => i.name === "register_card")!;
  (reg.accounts[2] as { name: string }).name = "global_config";
  setMintdexIdl(renamed);
  try {
    assert.equal(mintdexIdlIsPlaceholder(), false);
    assert.throws(
      () => M.registerCardIx({ launcher: key(), mint: key(), treasury: key() }),
      /unknown accounts config|missing account global_config/
    );
  } finally {
    setMintdexIdl(null);
  }
  assert.throws(() => setMintdexIdl({ ...renamed, instructions: [] }), /not a MintDex v2 IDL/);
  assert.equal(mintdexIdlIsPlaceholder(), MINTDEX_IDL_GENERATED === null);
});

test("events decode only from MintDex's own event-authority self-CPI (authenticity rule §9)", () => {
  const prog = new IdlProgram(MINTDEX_SPEC_IDL);
  const mint = key();
  const body = prog.coder
    .encode(
      { defined: { name: "CardEvolved" } },
      {
        mint,
        from_level: 1,
        to_level: 3,
        mcap_lamports: 4_300_000_000n,
        mcap_usd_e6: 50_740_000_000n,
        sol_usd_e6: 118_000_000n,
        graduated: false,
      }
    )
    .toBytes();
  const data = concatBytes(ANCHOR_EVENT_IX_TAG, Uint8Array.from(anchorDiscriminator("event", "CardEvolved")), body);
  const ix = {
    programId: MINTDEX_PROGRAM_ID,
    accounts: [{ address: mintdexEventAuthority(), isSigner: true, isWritable: false }],
    data,
  };
  const ev = decodeMintdexEvent(ix)!;
  assert.equal(ev.name, "CardEvolved");
  assert.equal(ev.data.to_level, 3);
  assert.equal(ev.data.mint, mint);
  const forger = key();
  assert.equal(decodeMintdexEvent({ ...ix, programId: forger }), null, "other program");
  assert.equal(
    decodeMintdexEvent({ ...ix, accounts: [{ address: key(), isSigner: true, isWritable: false }] }),
    null,
    "wrong authority"
  );
  assert.equal(decodeMintdexEvent({ ...ix, accounts: [...ix.accounts, ix.accounts[0]] }), null, "extra account");
  assert.equal(isAuthenticEventIx(ix, MINTDEX_PROGRAM_ID), true);
});

test("U7 mirror: sale splits equal the program's vectors (market.rs u7_*)", async () => {
  const { saleSplits, effectiveFeeBps } = await import("../src/fees.ts");
  const v = (price: bigint, launcher: boolean) => {
    const s = saleSplits(price, 250, 500, launcher);
    return [s.protocolFee, s.royalty, s.sellerNet];
  };
  assert.deepEqual(v(30_000_000n, false), [750_000n, 1_500_000n, 27_750_000n]);
  assert.deepEqual(v(1_000_000_000_000n, true), [25_000_000_000n, 0n, 975_000_000_000n]);
  assert.deepEqual(v(30_000_039n, false), [750_000n, 1_500_001n, 27_750_038n], "floor dust stays with the seller");
  // localnet smoke (smoke-v2-market.out.txt): 0.07 by the launcher, 0.06 and 0.1 resales
  assert.deepEqual(v(70_000_000n, true), [1_750_000n, 0n, 68_250_000n]);
  assert.deepEqual(v(60_000_000n, false), [1_500_000n, 3_000_000n, 55_500_000n]);
  assert.deepEqual(v(100_000_000n, false), [2_500_000n, 5_000_000n, 92_500_000n]);
  // the max_total_fee_bps argument a client passes: 750, or 250 when the launcher sells
  assert.equal(effectiveFeeBps(250, 500, false), 750);
  assert.equal(effectiveFeeBps(250, 500, true), 250);
});

test("U5 mirror: the …mint residue agrees with base58 for the known mints and 10,000 random keys", () => {
  for (const m of [
    "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint",
    "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint",
    "DJVsyAxNpnULaP3cwoPb4jMfQjQwS9gRdPEugTzemint",
    "A1h3Bs3N4iKG5d7qGDPrZSeTzMdcuBrxhsa5xjUamint",
  ]) {
    assert.ok(passesVanityCheck(m), m);
    assert.equal(vanityResidue(m), 8_725_513n);
  }
  const r = rng(5);
  for (let i = 0; i < 10_000; i++) {
    const k = base58Encode(r.bytes(32));
    assert.equal(passesVanityCheck(k), k.endsWith("mint"));
    // single-character suffix "t" through the same arithmetic (58^1, residue of 't')
    assert.equal(vanityResidue(k, 58n) === 51n, k.endsWith("t"));
  }
  assert.ok(passesVanityCheck(key(), 0n), "modulus 0 turns the filter off");
});

test("U10 mirror: card names truncate symbols on a character boundary at 10 bytes", () => {
  assert.equal(cardName("HONK"), "HONK MintDex Card");
  assert.equal(truncateUtf8("ABCDEFGHIJK", 10), "ABCDEFGHIJ");
  assert.equal(truncateUtf8("日本語のコイン", 10), "日本語"); // 3 bytes each: 9 ≤ 10 < 12
  assert.equal(truncateUtf8("🐸🐸🐸", 10), "🐸🐸"); // 4 bytes each
  assert.equal(truncateUtf8("ab🐸cd", 5), "ab");
  for (const s of ["😀😃😄", "ééééééé", "a日b本c語"]) {
    for (let n = 0; n <= 12; n++) {
      const t = truncateUtf8(s, n);
      assert.ok(utf8Encode(t).length <= n);
      assert.ok(s.startsWith(t));
    }
  }
  assert.ok(utf8Encode(cardName("🐸🐸🐸🐸")).length <= 23);
});

test("URIs: the bound coin URI is 71 chars for a 44-char mint; the card URI carries ?l=level", () => {
  const m = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint";
  assert.equal(coinUri(m), `https://mintdex.fun/m/${m}.json`);
  assert.equal(coinUri(m).length, 71);
  assert.equal(cardUri(m, 14), `https://mintdex.fun/c/${m}.json?l=14`);
  assert.equal(cardUri(m, 14).length, 76);
});

test("U8 mirror: validateConfigParams accepts the devnet config and rejects each bad field", () => {
  const rent0 = 650_240n;
  const ok = devnetConfigParams(key());
  assert.deepEqual(validateConfigParams(ok, rent0, 1_000_000n), []);
  const bad: [string, Partial<typeof ok>][] = [
    ["hold < 150", { evolve_hold_slots: 149 }],
    ["min_bid fee < rent", { min_bid: 26_000_000n }],
    ["non-ascending thresholds", { tier_thresholds_usd: [...ok.tier_thresholds_usd.slice(0, 12), 900_000n] }],
    ["multiplier 0", { mcap_multiplier: 0 }],
    ["multiplier > 1000", { mcap_multiplier: 1001 }],
    ["uri without https", { card_uri_base: "http://mintdex.fun/c/" }],
    ["max_price_age 0 with Pyth", { price_source: 1 }],
    ["min obs 1", { evolve_min_obs: 1 }],
    ["max step 0", { evolve_max_step: 0 }],
    ["price authority with short interval", { price_authority: key(), min_price_interval_secs: 59 }],
    ["fees > 2000 bps", { protocol_fee_bps: 1500, creator_royalty_bps: 501 }],
  ];
  for (const [label, patch] of bad) assert.notDeepEqual(validateConfigParams({ ...ok, ...patch }, rent0), [], label);
  assert.notDeepEqual(validateConfigParams(ok, rent0, 1n), [], "treasury below rent");
  assert.deepEqual(validateConfigParams({ ...ok, min_bid: 26_009_600n }, rent0), [], "the exact devnet floor");
});

test("register_card_metaplex (§18.17): 18 accounts, Metaplex PDAs of the card mint, evolve remaining accounts", () => {
  const mint = key();
  const user = key();
  const treasury = key();
  const a = coinAddresses(mint);
  const ix = M.registerCardMetaplexIx({ launcher: user, mint, treasury });
  assert.equal(ix.accounts.length, 18);
  assert.deepEqual(
    ix.accounts.filter((m) => m.isSigner).map((m) => m.address),
    [user, mint]
  );
  assert.deepEqual(Array.from(ix.data), anchorDiscriminator("global", "register_card_metaplex"));
  const at = (name: string) => {
    const spec = MINTDEX_SPEC_IDL.instructions.find((i) => i.name === "register_card_metaplex")!;
    return ix.accounts[spec.accounts.findIndex((x) => x.name === name)];
  };
  assert.equal(at("card_metadata").address, metaplexMetadataPda(a.cardMint));
  assert.equal(at("card_metadata").isWritable, true);
  assert.equal(at("card_edition").address, metaplexMasterEditionPda(a.cardMint));
  assert.equal(at("token_metadata_program").address, MPL_TOKEN_METADATA_PROGRAM_ID);
  assert.equal(at("sysvar_instructions").address, SYSVAR_INSTRUCTIONS_ID);
  // the PDAs are Metaplex's documented seeds
  assert.equal(
    a.cardMetadata,
    PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(), new PublicKey(a.cardMint).toBuffer()],
      new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
    )[0].toBase58()
  );
  assert.equal(M.registerIxFor("metaplex", { launcher: user, mint, treasury }).data.join(), ix.data.join());
  assert.deepEqual(
    Array.from(M.registerIxFor(undefined, { launcher: user, mint, treasury }).data),
    anchorDiscriminator("global", "register_card")
  );
  // evolve of a Metaplex card: 15 accounts + [metadata (w), Metaplex program]
  const ev = M.evolveIx({ cranker: user, mint, graduated: false, metaplex: true });
  assert.equal(ev.accounts.length, 17);
  assert.deepEqual(ev.accounts.slice(15).map((m) => [m.address, m.isWritable, m.isSigner]), [
    [a.cardMetadata, true, false],
    [MPL_TOKEN_METADATA_PROGRAM_ID, false, false],
  ]);
  assert.equal(M.evolveIx({ cranker: user, mint, graduated: false }).accounts.length, 15);
});

test("Metaplex metadata / master edition decoders (§18.17)", () => {
  const ua = key();
  const mint = key();
  const s = (v: string, pad: number) => {
    const b = new Uint8Array(pad);
    b.set(utf8Encode(v));
    return concatBytes(new Uint8Array(new Uint32Array([pad]).buffer), b);
  };
  const data = concatBytes(
    Uint8Array.of(4),
    new PublicKey(ua).toBytes(),
    new PublicKey(mint).toBytes(),
    s("HONK MintDex Card", 32),
    s("MDXCARD", 10),
    s("https://mintdex.fun/c/x.json?l=1", 200),
    Uint8Array.of(0, 0), // sfbp
    Uint8Array.of(0), // creators None
    Uint8Array.of(0, 1), // primary sale, mutable
    Uint8Array.of(1, 254), // edition nonce
    Uint8Array.of(1, 0), // token standard NonFungible
    Uint8Array.of(0), // collection None
    new Uint8Array(40)
  );
  const md = decodeMetaplexMetadata(data);
  assert.deepEqual(
    [md.updateAuthority, md.mint, md.name, md.symbol, md.uri, md.isMutable, md.tokenStandard, md.collection],
    [ua, mint, "HONK MintDex Card", "MDXCARD", "https://mintdex.fun/c/x.json?l=1", true, MPL_TOKEN_STANDARD.NonFungible, null]
  );
  const ed = decodeMetaplexMasterEdition(concatBytes(Uint8Array.of(6), new Uint8Array(8), Uint8Array.of(1), new Uint8Array(8)));
  assert.deepEqual(ed, { supply: 0n, maxSupply: 0n });
  assert.throws(() => decodeMetaplexMetadata(Uint8Array.of(6)));
});
