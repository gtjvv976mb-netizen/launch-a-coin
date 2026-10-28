// Transaction verifier: honest transactions pass, doctored ones are blocked before a wallet would open
// (devnet-plan acceptance C8: extra transfer, foreign program, changed amount, and more), plus real devnet txs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { verifyTransaction } from "../src/tx/verify.ts";
import type { TxIntent, VerifyOptions } from "../src/tx/verify.ts";
import { toWeb3Instruction } from "../src/web3.ts";
import type { Instruction } from "../src/instruction.ts";
import { pumpBuy, pumpCreateV2, pumpSell, decodePumpInstruction } from "../src/programs/pump.ts";
import { pammBuyInstructions, pammSellInstructions, decodePammInstruction } from "../src/programs/pamm.ts";
import {
  createAtaIdempotent,
  setComputeUnitLimit,
  setComputeUnitPrice,
  systemTransfer,
} from "../src/programs/system.ts";
import { buyNowIx, cancelBidIx, registerCardIx, registerCardMetaplexIx, withdrawFeesIx } from "../src/mintdex/instructions.ts";
import { coinUri } from "../src/mintdex/config.ts";
import { isMintdexAlt, mintdexAltAddresses } from "../src/mintdex/alt.ts";
import { associatedTokenAddress, cardVaultPda, coinAddresses } from "../src/pda.ts";
import { decodeAmmGlobalConfig, decodePool } from "../src/accounts/pamm.ts";
import { decodeAddressLookupTable } from "../src/accounts/alt.ts";
import {
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  TOKEN_2022_PROGRAM_ID,
} from "../src/constants.ts";
import { decodeTransaction, resolveTransaction } from "../src/tx/wire.ts";
import { fixtureAccount, fixtureTx } from "./helpers.ts";

const U64_MAX = BigInt("18446744073709551615");
const wallet = Keypair.generate();
const vanity = Keypair.generate();
const attacker = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const ALT_KEY = Keypair.generate().publicKey.toBase58();
const ALT_ADDRS = mintdexAltAddresses({ treasury });
const payer = wallet.publicKey.toBase58();
const mint = vanity.publicKey.toBase58();
const vault = cardVaultPda(mint);
const NAME = "Comet Corgi".padEnd(32, "!");
const SYMBOL = "CORGIXXXXX";
const URI = coinUri(mint);

function compile(feePayer: string, ixs: Instruction[], useAlt = true, signers: Keypair[] = []): Uint8Array {
  const alt = new AddressLookupTableAccount({
    key: new PublicKey(ALT_KEY),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: ALT_ADDRS.map((a) => new PublicKey(a)),
    },
  });
  const msg = new TransactionMessage({
    payerKey: new PublicKey(feePayer),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: ixs.map(toWeb3Instruction),
  }).compileToV0Message(useAlt ? [alt] : []);
  const tx = new VersionedTransaction(msg);
  if (signers.length) tx.sign(signers);
  return tx.serialize();
}

/** The pump recipients every pump template now requires (compat §6.2: no silent devnet default). */
const REC = { pumpFeeRecipients: DEVNET_PUMP_FEE_RECIPIENTS, pumpBuybackFeeRecipients: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS };
const opts: VerifyOptions = { lookupTables: { [ALT_KEY]: ALT_ADDRS }, allowedLookupTables: [ALT_KEY], ...REC };
const cu = () => [setComputeUnitLimit(450_000), setComputeUnitPrice(100_000n)];

function launchIxs(
  o: { creator?: string; maxSolCost?: bigint; feeRecipient?: string; treasuryOverride?: string } = {}
) {
  const ata = associatedTokenAddress(payer, mint, TOKEN_2022_PROGRAM_ID);
  return [
    ...cu(),
    pumpCreateV2({ mint, user: payer, name: NAME, symbol: SYMBOL, uri: URI, creator: o.creator ?? vault }),
    registerCardIx({ launcher: payer, mint, treasury: o.treasuryOverride ?? treasury }),
    createAtaIdempotent(payer, ata, payer, mint, TOKEN_2022_PROGRAM_ID),
    pumpBuy({
      mint,
      user: payer,
      creator: vault,
      feeRecipient: o.feeRecipient ?? DEVNET_PUMP_FEE_RECIPIENTS[3],
      buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[6],
      amount: 1_700_000_000_000n,
      maxSolCost: o.maxSolCost ?? 50_500_000n,
    }),
  ];
}

const launchIntent: TxIntent = {
  kind: "launch",
  payer,
  mint,
  name: NAME,
  symbol: SYMBOL,
  uri: URI,
  treasury,
  devBuy: { minTokens: 1_650_000_000_000n, maxSolCost: 50_500_000n },
};

const expectReject = (bytes: Uint8Array, intent: TxIntent, re: RegExp, o: VerifyOptions = opts) => {
  const r = verifyTransaction(bytes, intent, o);
  assert.equal(r.ok, false, `expected a rejection matching ${re}`);
  assert.match(r.errors.join("; "), re);
};

test("honest launch tx (ALT, dev buy) passes; size ≤ 1100 bytes as in L1 / sizes-r1", () => {
  const bytes = compile(payer, launchIxs());
  console.log(`  launch tx with ALT: ${bytes.length} bytes`);
  assert.ok(bytes.length <= 1100, `launch tx is ${bytes.length} bytes`);
  const r = verifyTransaction(bytes, launchIntent, opts);
  assert.deepEqual(r.errors, []);
  assert.equal(r.summary.computeUnitLimit, 450_000);
  assert.equal(r.summary.priorityFeeLamports, 45_000n);
  assert.equal(r.summary.maxPayerSpendLamports, 50_500_000n);
  assert.deepEqual(r.summary.signers.sort(), [payer, mint].sort());
  // server-first: the vanity mint signs first, the wallet last
  const presigned = compile(payer, launchIxs(), true, []);
  const tx = VersionedTransaction.deserialize(presigned);
  tx.sign([vanity]);
  assert.ok(verifyTransaction(tx.serialize(), launchIntent, { ...opts, requirePresignedBy: [mint] }).ok);
  expectReject(presigned, launchIntent, /missing or invalid signature/, { ...opts, requirePresignedBy: [mint] });
});

test("launch without dev buy fits without the ALT (the ALT fallback, card-program-v2 §10.1)", () => {
  const ixs = launchIxs().slice(0, 4);
  const bytes = compile(payer, ixs, false);
  console.log(`  launch tx, no ALT, no dev buy: ${bytes.length} bytes`);
  assert.ok(bytes.length <= 1232);
  assert.ok(verifyTransaction(bytes, { ...launchIntent, devBuy: null }, {}).ok);
});

test("Metaplex launch (§18.17): register_card_metaplex verifies only under cardStandard metaplex; ≤ 1,232 B with the ALT", () => {
  const ixs = launchIxs();
  ixs[3] = registerCardMetaplexIx({ launcher: payer, mint, treasury });
  const bytes = compile(payer, ixs);
  console.log(`  Metaplex launch tx with ALT: ${bytes.length} bytes`);
  assert.ok(bytes.length <= 1232, `Metaplex launch tx is ${bytes.length} bytes`);
  const ok = verifyTransaction(bytes, { ...launchIntent, cardStandard: "metaplex" }, opts);
  assert.deepEqual(ok.errors, []);
  // Metaplex only runs by CPI: it is never a top-level program of the launch
  assert.ok(!ok.summary.programs.includes("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"));
  expectReject(bytes, launchIntent, /MintDex register_card: .*account|MintDex register_card: data/);
  // and the original register_card does not pass a metaplex intent
  expectReject(compile(payer, launchIxs()), { ...launchIntent, cardStandard: "metaplex" }, /MintDex register_card_metaplex/);
  // a top-level Metaplex instruction is refused by the program allowlist
  const extra = [...ixs, { programId: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", accounts: [], data: Uint8Array.of(15) }];
  expectReject(compile(payer, extra), { ...launchIntent, cardStandard: "metaplex" }, /not allowed/);
});

test("O3: a launch whose create_v2 sets any pump flag, or drops the holder byte, is refused before the wallet opens", () => {
  const flagged: Array<[string, Partial<Parameters<typeof pumpCreateV2>[0]>]> = [
    ["holder reward", { isHolderReward: true }],
    ["mayhem", { isMayhemMode: true }],
    ["cashback", { isCashbackEnabled: true }],
    ["creator fee 100 bps", { creatorFeeBps: 100n }],
  ];
  for (const [label, flags] of flagged) {
    const ixs = launchIxs();
    ixs[2] = pumpCreateV2({ mint, user: payer, name: NAME, symbol: SYMBOL, uri: URI, creator: vault, ...flags });
    const r = verifyTransaction(compile(payer, ixs), launchIntent, opts);
    assert.equal(r.ok, false, label);
    assert.match(r.errors.join("; "), /pump create_v2: data/, label);
  }
  // the 10-byte tail (holder byte omitted) that some live mainnet creates use: pump reads it as false, MintDex never
  // sends it, so the verifier's byte comparison refuses it
  const ten = launchIxs();
  ten[2] = { ...ten[2], data: ten[2].data.subarray(0, ten[2].data.length - 1) };
  expectReject(compile(payer, ten), launchIntent, /pump create_v2: data/, opts);
  // the honest template still passes
  assert.ok(verifyTransaction(compile(payer, launchIxs()), launchIntent, opts).ok);
});

test("C8: doctored launch transactions are blocked", () => {
  const base = launchIxs();
  const extraTransfer = [...base, systemTransfer(payer, attacker, 1_000_000_000n)];
  expectReject(compile(payer, extraTransfer), launchIntent, /unexpected extra instruction/);
  const foreign: Instruction = {
    programId: Keypair.generate().publicKey.toBase58(),
    accounts: [{ address: payer, isSigner: true, isWritable: true }],
    data: Uint8Array.of(1),
  };
  expectReject(compile(payer, [...base, foreign]), launchIntent, /not allowed/);
  expectReject(compile(payer, launchIxs({ maxSolCost: 5_000_000_000n })), launchIntent, /max_sol_cost/);
  expectReject(compile(payer, launchIxs({ creator: attacker })), launchIntent, /create_v2/);
  expectReject(compile(payer, launchIxs({ feeRecipient: attacker })), launchIntent, /fee recipient/);
  expectReject(compile(payer, launchIxs({ treasuryOverride: attacker })), launchIntent, /register_card/);
  // swapped order
  const swapped = [...base];
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  expectReject(compile(payer, swapped), launchIntent, /create_v2|register_card/);
  // an extra signer slipped into register_card
  const reg = { ...base[3], accounts: base[3].accounts.map((a, i) => (i === 3 ? { ...a, isSigner: true } : a)) };
  expectReject(compile(payer, [...base.slice(0, 3), reg, ...base.slice(4)]), launchIntent, /signers/);
  // a read-only account made writable (config)
  const cfgW = { ...base[3], accounts: base[3].accounts.map((a, i) => (i === 2 ? { ...a, isWritable: true } : a)) };
  expectReject(compile(payer, [...base.slice(0, 3), cfgW, ...base.slice(4)]), launchIntent, /writable flag/);
  // someone else pays
  const other = Keypair.generate().publicKey.toBase58();
  expectReject(compile(other, base), launchIntent, /fee payer|signers/);
  // priority fee above the cap, extra compute-budget instruction
  expectReject(
    compile(payer, [setComputeUnitLimit(1_400_000), setComputeUnitPrice(9_000_000n), ...base.slice(2)]),
    launchIntent,
    /priority fee/
  );
  expectReject(compile(payer, [...cu(), setComputeUnitPrice(1n), ...base.slice(2)]), launchIntent, /compute budget/);
  // lookup tables: unknown table, contents not supplied
  expectReject(compile(payer, base), launchIntent, /not allowed/, { ...opts, allowedLookupTables: [attacker] });
  expectReject(compile(payer, base), launchIntent, /contents not provided/, { allowedLookupTables: [ALT_KEY], ...REC });
  // name or URI changed after the user approved them
  expectReject(compile(payer, base), { ...launchIntent, name: "Comet Corgi" }, /create_v2/);
  expectReject(
    compile(payer, base),
    { ...launchIntent, devBuy: { minTokens: 2_000_000_000_000n, maxSolCost: 50_500_000n } },
    /approved minimum/
  );
});

test("the MintDex ALT has the 38 §10.1 entries and isMintdexAlt recognises it", () => {
  assert.equal(ALT_ADDRS.length, 38);
  assert.ok(isMintdexAlt(ALT_ADDRS, { treasury }));
  assert.ok(isMintdexAlt([...ALT_ADDRS, attacker], { treasury }), "appended extensions are fine");
  assert.ok(!isMintdexAlt([attacker, ...ALT_ADDRS.slice(1)], { treasury }));
});

test("pump buy / sell intents: honest passes, doctored blocked", () => {
  const user = payer;
  const coin = Keypair.generate().publicKey.toBase58();
  const creator = cardVaultPda(coin);
  const ata = associatedTokenAddress(user, coin, TOKEN_2022_PROGRAM_ID);
  const buy = (amount: bigint, max: bigint, fee = DEVNET_PUMP_FEE_RECIPIENTS[0]) =>
    pumpBuy({
      mint: coin,
      user,
      creator,
      feeRecipient: fee,
      buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[1],
      amount,
      maxSolCost: max,
    });
  const intent: TxIntent = { kind: "pump_buy", user, mint: coin, creator, minTokens: 1_000n, maxSolCost: 100_000_000n };
  assert.ok(
    verifyTransaction(
      compile(user, [
        ...cu(),
        createAtaIdempotent(user, ata, user, coin, TOKEN_2022_PROGRAM_ID),
        buy(5_000n, 99_000_000n),
      ]),
      intent,
      opts
    ).ok
  );
  assert.ok(verifyTransaction(compile(user, [buy(5_000n, 99_000_000n)], false), intent, REC).ok, "ATA already exists");
  expectReject(compile(user, [buy(999n, 99_000_000n)]), intent, /approved minimum/);
  expectReject(compile(user, [buy(5_000n, 100_000_001n)]), intent, /max_sol_cost/);
  expectReject(
    compile(user, [
      createAtaIdempotent(
        user,
        associatedTokenAddress(attacker, coin, TOKEN_2022_PROGRAM_ID),
        attacker,
        coin,
        TOKEN_2022_PROGRAM_ID
      ),
      buy(5_000n, 1n),
    ]),
    intent,
    /extra instruction|pump buy/
  );
  expectReject(compile(user, [buy(5_000n, 1n), systemTransfer(user, attacker, 1n)]), intent, /extra instruction/);
  const wrongCreator = pumpBuy({
    mint: coin,
    user,
    creator: attacker,
    feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[0],
    buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[1],
    amount: 5_000n,
    maxSolCost: 1n,
  });
  expectReject(compile(user, [wrongCreator]), intent, /pump buy: account #9/);

  const sellIntent: TxIntent = {
    kind: "pump_sell",
    user,
    mint: coin,
    creator,
    amount: 7_000n,
    minSolOutput: 1_000_000n,
  };
  const sell = (amount: bigint, min: bigint) =>
    pumpSell({
      mint: coin,
      user,
      creator,
      feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[7],
      buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[0],
      amount,
      minSolOutput: min,
    });
  assert.ok(verifyTransaction(compile(user, [...cu(), sell(7_000n, 1_100_000n)]), sellIntent, opts).ok);
  expectReject(compile(user, [sell(8_000n, 1_100_000n)]), sellIntent, /amount/);
  expectReject(compile(user, [sell(7_000n, 999_999n)]), sellIntent, /min_sol_output/);
});

test("PumpSwap buy / sell intents: honest passes, doctored blocked", () => {
  const gc = decodeAmmGlobalConfig(fixtureAccount("amm_global_config").data);
  const pool = decodePool(fixtureAccount("coin1_pool").data);
  const o: VerifyOptions = {
    ...opts,
    pammProtocolFeeRecipients: gc.protocolFeeRecipients,
    pammBuybackFeeRecipients: gc.buybackFeeRecipients,
  };
  const coin = pool.baseMint;
  const swap = {
    pool: coinAddresses(coin).pool,
    user: payer,
    baseMint: coin,
    poolBaseTokenAccount: pool.poolBaseTokenAccount,
    poolQuoteTokenAccount: pool.poolQuoteTokenAccount,
    protocolFeeRecipient: gc.protocolFeeRecipients[2],
    buybackFeeRecipient: gc.buybackFeeRecipients[5],
    coinCreator: pool.coinCreator,
  };
  const state = { poolDataLength: 295, userBaseAccountExists: false, userQuoteAccountExists: false };
  const common = {
    user: payer,
    mint: coin,
    poolBaseTokenAccount: pool.poolBaseTokenAccount,
    poolQuoteTokenAccount: pool.poolQuoteTokenAccount,
    coinCreator: pool.coinCreator,
  };
  const buyIntent: TxIntent = { kind: "pamm_buy", ...common, minBaseOut: 1_000_000n, maxQuoteIn: 60_000_000n };
  const honest = pammBuyInstructions({ ...swap, ...state, baseAmountOut: 2_000_000n, maxQuoteAmountIn: 55_000_000n });
  assert.equal(honest.length, 7, "extend, WSOL ATA, wrap, sync, coin ATA, buy, close");
  const ok = verifyTransaction(compile(payer, [...cu(), ...honest]), buyIntent, o);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.summary.maxPayerSpendLamports, 55_000_000n);
  const lean = pammBuyInstructions({
    ...swap,
    poolDataLength: 301,
    userBaseAccountExists: true,
    userQuoteAccountExists: true,
    baseAmountOut: 2_000_000n,
    maxQuoteAmountIn: 55_000_000n,
  });
  assert.ok(verifyTransaction(compile(payer, lean), buyIntent, o).ok);
  expectReject(compile(payer, honest), buyIntent, /pammProtocolFeeRecipients/, opts);
  const overWrap = honest.map((ix, i) =>
    i === 2
      ? systemTransfer(payer, associatedTokenAddress(payer, "So11111111111111111111111111111111111111112"), 55_000_001n)
      : ix
  );
  expectReject(compile(payer, overWrap), buyIntent, /wrapped SOL/, o);
  const stealClose = [
    ...honest.slice(0, 6),
    { ...honest[6], accounts: honest[6].accounts.map((a, i) => (i === 1 ? { ...a, address: attacker } : a)) },
  ];
  expectReject(compile(payer, stealClose), buyIntent, /close WSOL ATA/, o);
  const badRecipient = pammBuyInstructions({
    ...swap,
    ...state,
    protocolFeeRecipient: attacker,
    baseAmountOut: 2_000_000n,
    maxQuoteAmountIn: 55_000_000n,
  });
  expectReject(compile(payer, badRecipient), buyIntent, /protocol fee recipient/, o);
  const tooMuch = pammBuyInstructions({ ...swap, ...state, baseAmountOut: 2_000_000n, maxQuoteAmountIn: 70_000_000n });
  expectReject(compile(payer, tooMuch), buyIntent, /approved/, o);

  const sellIntent: TxIntent = { kind: "pamm_sell", ...common, baseAmountIn: 9_000_000n, minQuoteOut: 100_000n };
  const sell = pammSellInstructions({ ...swap, ...state, baseAmountIn: 9_000_000n, minQuoteAmountOut: 150_000n });
  assert.ok(verifyTransaction(compile(payer, sell), sellIntent, o).ok);
  expectReject(
    compile(payer, pammSellInstructions({ ...swap, ...state, baseAmountIn: 9_000_001n, minQuoteAmountOut: 150_000n })),
    sellIntent,
    /amount/,
    o
  );
  expectReject(
    compile(payer, pammSellInstructions({ ...swap, ...state, baseAmountIn: 9_000_000n, minQuoteAmountOut: 1n })),
    sellIntent,
    /min quote/,
    o
  );
});

test("exact intents for MintDex flows (withdraw, cancel bid + buy now)", () => {
  const coin = Keypair.generate().publicKey.toBase58();
  const expected = [withdrawFeesIx({ holder: payer, mint: coin })];
  const intent: TxIntent = { kind: "exact", payer, expected };
  assert.ok(verifyTransaction(compile(payer, [setComputeUnitLimit(150_000), ...expected]), intent, opts).ok);
  const swappedHolderAccount = [withdrawFeesIx({ holder: payer, mint: coin, holderCardAccount: attacker })];
  expectReject(compile(payer, swappedHolderAccount), intent, /account #5/);
  const extraWsol = [withdrawFeesIx({ holder: payer, mint: coin, extraWsolAccounts: [attacker] })];
  expectReject(compile(payer, extraWsol), intent, /accounts, expected/);
  const seller = Keypair.generate().publicKey.toBase58();
  const launcher = Keypair.generate().publicKey.toBase58();
  const both = [
    cancelBidIx({ bidder: payer, mint: coin }),
    buyNowIx({ buyer: payer, seller, mint: coin, launcher, treasury, expectedPrice: 50_000_000n, maxTotalFeeBps: 750 }),
  ];
  assert.ok(
    verifyTransaction(
      compile(payer, [setComputeUnitLimit(250_000), ...both]),
      { kind: "exact", payer, expected: both },
      opts
    ).ok
  );
  const pricier = [
    both[0],
    buyNowIx({ buyer: payer, seller, mint: coin, launcher, treasury, expectedPrice: 60_000_000n, maxTotalFeeBps: 750 }),
  ];
  expectReject(compile(payer, pricier), { kind: "exact", payer, expected: both }, /data/);
});

test("real devnet trades verify under their intents; the pre-v2 launch fails the v2 launch template", () => {
  const sharedAlt = fixtureAccount("shared_alt");
  const tables = { [sharedAlt.address]: decodeAddressLookupTable(sharedAlt.data).addresses };
  const coin1 = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint";
  for (const name of ["coin1_buy", "coin1_complete"]) {
    const fx = fixtureTx(name);
    const r = resolveTransaction(decodeTransaction(fx.bytes), tables);
    const d = decodePumpInstruction(r.instructions.find((i) => decodePumpInstruction(i)?.name === "buy")!)!;
    if (d.name !== "buy") throw new Error("unreachable");
    const res = verifyTransaction(
      fx.bytes,
      {
        kind: "pump_buy",
        user: r.feePayer,
        mint: coin1,
        creator: cardVaultPda(coin1),
        minTokens: d.args.amount,
        maxSolCost: d.args.maxSolCost,
      },
      { lookupTables: tables, ...REC }
    );
    assert.deepEqual(res.errors, [], name);
  }
  const sellFx = fixtureTx("coin1_sell");
  const sr = resolveTransaction(decodeTransaction(sellFx.bytes));
  const sd = decodePumpInstruction(sr.instructions.find((i) => decodePumpInstruction(i)?.name === "sell")!)!;
  if (sd.name !== "sell") throw new Error("unreachable");
  assert.deepEqual(
    verifyTransaction(sellFx.bytes, {
      kind: "pump_sell",
      user: sr.feePayer,
      mint: coin1,
      creator: cardVaultPda(coin1),
      amount: sd.args.amount,
      minSolOutput: sd.args.minSolOutput,
    }, REC).errors,
    []
  );
  const ammFx = fixtureTx("coin1_amm_sell");
  const ar = resolveTransaction(decodeTransaction(ammFx.bytes));
  const ad = decodePammInstruction(ar.instructions.find((i) => decodePammInstruction(i)?.name === "sell")!)!;
  if (ad.name !== "sell") throw new Error("unreachable");
  const gc = decodeAmmGlobalConfig(fixtureAccount("amm_global_config").data);
  const ammRes = verifyTransaction(
    ammFx.bytes,
    {
      kind: "pamm_sell",
      user: ar.feePayer,
      mint: coin1,
      poolBaseTokenAccount: ad.accounts.poolBaseTokenAccount,
      poolQuoteTokenAccount: ad.accounts.poolQuoteTokenAccount,
      coinCreator: cardVaultPda(coin1),
      baseAmountIn: ad.args.baseAmountIn,
      minQuoteOut: ad.args.minQuoteAmountOut,
    },
    { pammProtocolFeeRecipients: gc.protocolFeeRecipients, pammBuybackFeeRecipients: gc.buybackFeeRecipients }
  );
  assert.deepEqual(ammRes.errors, []);
  const launch = fixtureTx("coin1_launch");
  const lr = resolveTransaction(decodeTransaction(launch.bytes));
  const cd = decodePumpInstruction(lr.instructions.find((i) => decodePumpInstruction(i)?.name === "create_v2")!)!;
  if (cd.name !== "create_v2") throw new Error("unreachable");
  const v2 = verifyTransaction(launch.bytes, {
    kind: "launch",
    payer: lr.feePayer,
    mint: coin1,
    name: cd.args.name,
    symbol: cd.args.symbol,
    uri: cd.args.uri,
    treasury,
    devBuy: { minTokens: 0n, maxSolCost: 10n ** 12n },
  }, REC);
  assert.equal(v2.ok, false);
  assert.match(v2.errors[0], /register_card/);
});
