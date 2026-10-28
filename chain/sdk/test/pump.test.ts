// Byte-equality of the hand-encoded pump instructions with @pump-fun/pump-sdk 2.0.0, plus re-encoding of
// real devnet transactions from the facts run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import * as pump from "@pump-fun/pump-sdk";
import {
  createV2Tail,
  decodePumpInstruction,
  MINTDEX_CREATE_V2_TAIL,
  mintdexCreateV2,
  pumpBuy,
  pumpBuyExactSolIn,
  pumpBuyInstructions,
  pumpCollectCreatorFee,
  pumpCreateV2,
  pumpCreateV2AndBuyInstructions,
  pumpExtendAccount,
  pumpMigrate,
  pumpSell,
  slippageDown,
  slippageUp,
} from "../src/programs/pump.ts";
import { decodePumpGlobal } from "../src/accounts/pump.ts";
import { cardVaultPda, creatorVaultPda } from "../src/pda.ts";
import {
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  DEVNET_PUMP_WITHDRAW_AUTHORITY,
} from "../src/constants.ts";
import { decodeTransaction, resolveTransaction } from "../src/tx/wire.ts";
import { decodeAddressLookupTable } from "../src/accounts/alt.ts";
import type { Instruction } from "../src/instruction.ts";
import {
  assertSameIx,
  assertSameIxs,
  big,
  bn,
  fixtureAccount,
  fixtureAccountInfo,
  fixtureTx,
  fromWeb3,
  rng,
} from "./helpers.ts";

const offlinePump = pump.getPumpProgram(null as never);
const T22 = TOKEN_2022_PROGRAM_ID.toBase58();
const key = () => Keypair.generate().publicKey;
const MAINNET_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mainnet");
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const global = pump.PUMP_SDK.decodeGlobal(fixtureAccountInfo("pump_global"));

test("devnet Global fee recipients match the constants used as verifier defaults", () => {
  const g = decodePumpGlobal(fixtureAccount("pump_global").data);
  assert.deepEqual(g.allFeeRecipients, [...DEVNET_PUMP_FEE_RECIPIENTS]);
  assert.deepEqual(g.buybackFeeRecipients, [...DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS]);
  assert.equal(g.withdrawAuthority, DEVNET_PUMP_WITHDRAW_AUTHORITY);
  assert.equal(g.feeRecipient, global.feeRecipient.toBase58());
  assert.deepEqual(
    g.feeRecipients,
    global.feeRecipients.map((k) => k.toBase58())
  );
  assert.deepEqual(
    g.buybackFeeRecipients,
    global.buybackFeeRecipients.map((k) => k.toBase58())
  );
  assert.equal(g.initialVirtualSolReserves, big(global.initialVirtualSolReserves));
  assert.equal(g.initialVirtualTokenReserves, big(global.initialVirtualTokenReserves));
  assert.equal(g.createV2Enabled, global.createV2Enabled);
});

test("create_v2 is byte-equal to PUMP_SDK.createV2Instruction", async () => {
  const r = rng(11);
  const names = ["MintDex Test", "A".repeat(32), "Comet Corgi", "日本語のコイン", "🐸 frog"];
  for (let i = 0; i < names.length * 3; i++) {
    const mint = key();
    const user = key();
    const creator = new PublicKey(cardVaultPda(mint.toBase58()));
    const name = names[i % names.length];
    const symbol = ["MDXT", "B".repeat(10), "HONK"][i % 3];
    const uri = i % 2 ? `https://mintdex.fun/m/${mint.toBase58()}.json` : "https://x.io/" + "y".repeat(r.u32() % 180);
    const extra =
      i % 3 === 0
        ? {}
        : { creatorFeeBps: bn(i % 2 ? 0 : 25), holderReward: i % 2 === 0, mayhemMode: i % 4 === 1, cashback: false };
    const sdk = await pump.PUMP_SDK.createV2Instruction({
      mint,
      name,
      symbol,
      uri,
      creator,
      user,
      mayhemMode: false,
      ...extra,
    });
    const mine = pumpCreateV2({
      mint: mint.toBase58(),
      user: user.toBase58(),
      name,
      symbol,
      uri,
      creator: creator.toBase58(),
      isMayhemMode: (extra as { mayhemMode?: boolean }).mayhemMode ?? false,
      isCashbackEnabled: false,
      creatorFeeBps: extra.creatorFeeBps ? big(extra.creatorFeeBps) : 0n,
      isHolderReward: (extra as { holderReward?: boolean }).holderReward ?? false,
    });
    assertSameIx(mine, fromWeb3(sdk), `create_v2 #${i}`);
  }
});

test("O3: mintdexCreateV2 pins the 11-byte zero tail and equals pumpCreateV2 defaults and PUMP_SDK.createV2Instruction", async () => {
  assert.equal(toHex(MINTDEX_CREATE_V2_TAIL), "0000000000000000000000");
  for (const [name, symbol] of [
    ["MintDex Test", "MDXT"],
    ["A".repeat(32), "B".repeat(10)],
    ["日本語のコイン", "JP"],
  ]) {
    const mint = key();
    const user = key();
    const uri = `https://mintdex.fun/m/${mint.toBase58()}.json`;
    const vault = cardVaultPda(mint.toBase58());
    const mine = mintdexCreateV2({ mint: mint.toBase58(), user: user.toBase58(), name, symbol, uri });
    assert.equal(toHex(createV2Tail(mine.data)!), "0000000000000000000000", "golden tail");
    const d = decodePumpInstruction(mine);
    if (!d || d.name !== "create_v2") throw new Error("not a create_v2");
    assert.equal(d.args.creator, vault, "creator = card vault");
    assert.deepEqual(
      [d.args.isMayhemMode, d.args.isCashbackEnabled, d.args.creatorFeeBps, d.args.isHolderReward],
      [false, false, 0n, false]
    );
    // byte-identical to the instruction the live devnet Worker builds today (pumpCreateV2 with defaults)
    assertSameIx(mine, pumpCreateV2({ mint: mint.toBase58(), user: user.toBase58(), name, symbol, uri, creator: vault }), "defaults");
    const sdk = await pump.PUMP_SDK.createV2Instruction({
      mint,
      name,
      symbol,
      uri,
      creator: new PublicKey(vault),
      user,
      mayhemMode: false,
      cashback: false,
    });
    assertSameIx(mine, fromWeb3(sdk), "pump-sdk 2.0.0");
  }
  // a foreign program id derives its own vault (the O4 contingency), the tail stays pinned
  const m = key().toBase58();
  const other = key().toBase58();
  const ix = mintdexCreateV2({ mint: m, user: key().toBase58(), name: "X", symbol: "XX", uri: "u", programId: other });
  const od = decodePumpInstruction(ix);
  if (!od || od.name !== "create_v2") throw new Error("not a create_v2");
  assert.equal(od.args.creator, cardVaultPda(m, other));
  assert.equal(createV2Tail(Uint8Array.of(1, 2, 3)), null);
});

test("O3: the pinned tail matches live mainnet creates whose curves came out with every flag 0 (read-only fixture)", () => {
  const f = JSON.parse(readFileSync(join(MAINNET_FIXTURES, "create_v2_tails.json"), "utf8")) as {
    pumpDeploySlot: number;
    creates: Array<{
      sig: string;
      tail: string;
      tailLen: number;
      creator: string;
      curveCreator: string;
      curveLen: number;
      isMayhem: number;
      isCashback: number;
      quoteMint: string;
      creatorFeeBps: number;
      isHolderReward: number;
    }>;
  };
  assert.equal(f.pumpDeploySlot, 454_596_459, "the mainnet pump ELF PROFILE=mainnet reran on (2026-10-08 redeploy)");
  const pinned = toHex(MINTDEX_CREATE_V2_TAIL);
  const clean = f.creates.filter((c) => c.tail === pinned);
  assert.ok(clean.length >= 3, "at least three live creates used exactly MintDex's tail");
  for (const c of clean) {
    assert.deepEqual([c.isMayhem, c.isCashback, c.creatorFeeBps, c.isHolderReward], [0, 0, 0, 0], c.sig);
    assert.equal(c.quoteMint, "11111111111111111111111111111111", c.sig);
    assert.equal(c.curveLen, 166, `${c.sig}: fresh mainnet curves are 166 B since the 2026-10-08 pump redeploy (141 or 151 B before)`);
  }
  // and the creator stuck unless the same transaction moved it to a fee-sharing config (a separate pump_fees call)
  assert.ok(clean.filter((c) => c.curveCreator === c.creator).length >= 2);
  // the flags pump reads from the tail: byte 0 mayhem, byte 10 holder
  for (const c of f.creates) {
    const t = Buffer.from(c.tail, "hex");
    assert.equal(c.isMayhem, t[0], `${c.sig}: mayhem byte`);
    if (c.creator === c.curveCreator) assert.equal(c.isHolderReward, t.length === 11 ? t[10] : 0, `${c.sig}: holder byte`);
  }
});

test("buy and sell are byte-equal to getBuyInstructionRaw / getSellInstructionRaw", async () => {
  const r = rng(12);
  for (let i = 0; i < 16; i++) {
    const mint = key();
    const user = key();
    const creator = new PublicKey(cardVaultPda(mint.toBase58()));
    const feeRecipient = new PublicKey(DEVNET_PUMP_FEE_RECIPIENTS[i % 8]);
    const buyback = new PublicKey(DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[(i + 3) % 8]);
    const amount = r.bigint(10n ** 15n);
    const sol = r.bigint(10n ** 10n);
    const sdkBuy = await pump.PUMP_SDK.getBuyInstructionRaw({
      user,
      mint,
      creator,
      amount: bn(amount),
      solAmount: bn(sol),
      feeRecipient,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      buybackFeeRecipient: buyback,
    });
    const mineBuy = pumpBuy({
      mint: mint.toBase58(),
      user: user.toBase58(),
      creator: creator.toBase58(),
      feeRecipient: feeRecipient.toBase58(),
      buybackFeeRecipient: buyback.toBase58(),
      amount,
      maxSolCost: sol,
    });
    assertSameIx(mineBuy, fromWeb3(sdkBuy), `buy #${i}`);
    const sdkSell = await pump.PUMP_SDK.getSellInstructionRaw({
      user,
      mint,
      creator,
      amount: bn(amount),
      solAmount: bn(sol),
      feeRecipient,
      buybackFeeRecipient: buyback,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      cashback: i % 5 === 0,
    });
    const mineSell = pumpSell({
      mint: mint.toBase58(),
      user: user.toBase58(),
      creator: creator.toBase58(),
      feeRecipient: feeRecipient.toBase58(),
      buybackFeeRecipient: buyback.toBase58(),
      amount,
      minSolOutput: sol,
      cashback: i % 5 === 0,
    });
    assertSameIx(mineSell, fromWeb3(sdkSell), `sell #${i}`);
  }
});

test("buyInstructions / sellInstructions (with SDK slippage and random recipients) match the composites", async (t) => {
  const curveInfo = fixtureAccountInfo("coin2_curve");
  const curve = pump.PUMP_SDK.decodeBondingCurve(curveInfo);
  const mint = new PublicKey("DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint");
  for (const [ri, rv] of [0.05, 0.42, 0.99].entries()) {
    t.mock.method(Math, "random", () => rv);
    const idx = Math.floor(rv * 8);
    const user = key();
    for (const ataExists of [false, true]) {
      const sdk = await pump.PUMP_SDK.buyInstructions({
        global,
        bondingCurveAccountInfo: curveInfo,
        bondingCurve: curve,
        associatedUserAccountInfo: ataExists ? curveInfo : null,
        mint,
        user,
        amount: bn(123_456_789_000n),
        solAmount: bn(50_000_000n),
        slippage: 1.5,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });
      const mine = pumpBuyInstructions({
        mint: mint.toBase58(),
        user: user.toBase58(),
        creator: curve.creator.toBase58(),
        feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[idx],
        buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[idx],
        amount: 123_456_789_000n,
        maxSolCost: slippageUp(50_000_000n, 1.5),
        userAtaExists: ataExists,
      });
      assertSameIxs(mine, sdk.map(fromWeb3), `buyInstructions r=${ri} ata=${ataExists}`);
    }
    const sdkSell = await pump.PUMP_SDK.sellInstructions({
      global,
      bondingCurveAccountInfo: curveInfo,
      bondingCurve: curve,
      mint,
      user,
      amount: bn(99_000_000_000n),
      solAmount: bn(30_000_000n),
      slippage: 2,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      mayhemMode: false,
    });
    const mineSell = pumpSell({
      mint: mint.toBase58(),
      user: user.toBase58(),
      creator: curve.creator.toBase58(),
      feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[idx],
      buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[idx],
      amount: 99_000_000_000n,
      minSolOutput: slippageDown(30_000_000n, 2),
    });
    assertSameIxs([mineSell], sdkSell.map(fromWeb3), `sellInstructions r=${ri}`);
    t.mock.restoreAll();
  }
});

test("createV2AndBuyInstructions (SOL quote) matches the launch composite", async (t) => {
  t.mock.method(Math, "random", () => 0.6);
  const idx = Math.floor(0.6 * 8);
  const mint = key();
  const user = key();
  const creator = new PublicKey(cardVaultPda(mint.toBase58()));
  const uri = `https://mintdex.fun/m/${mint.toBase58()}.json`;
  const sdk = await pump.PUMP_SDK.createV2AndBuyInstructions({
    global,
    mint,
    name: "A".repeat(32),
    symbol: "B".repeat(10),
    uri,
    creator,
    user,
    amount: bn(1_000_000_000_000n),
    solAmount: bn(50_000_000n),
    mayhemMode: false,
  });
  const mine = pumpCreateV2AndBuyInstructions({
    mint: mint.toBase58(),
    user: user.toBase58(),
    name: "A".repeat(32),
    symbol: "B".repeat(10),
    uri,
    creator: creator.toBase58(),
    feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[idx],
    buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[idx],
    amount: 1_000_000_000_000n,
    maxSolCost: slippageUp(50_000_000n, 1),
  });
  assertSameIxs(mine, sdk.map(fromWeb3), "createV2AndBuy");
});

test("collect_creator_fee, migrate and extend_account are byte-equal to the SDK", async () => {
  for (let i = 0; i < 5; i++) {
    const mint = key();
    const user = key();
    const vault = new PublicKey(cardVaultPda(mint.toBase58()));
    const sdkCollect = await offlinePump.methods.collectCreatorFee().accountsPartial({ creator: vault }).instruction();
    assertSameIx(pumpCollectCreatorFee({ creator: vault.toBase58() }), fromWeb3(sdkCollect), "collect_creator_fee");
    const sdkMigrate = await pump.PUMP_SDK.migrateInstruction({
      withdrawAuthority: global.withdrawAuthority,
      mint,
      user,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    assertSameIx(
      pumpMigrate({
        mint: mint.toBase58(),
        user: user.toBase58(),
        withdrawAuthority: global.withdrawAuthority.toBase58(),
      }),
      fromWeb3(sdkMigrate),
      "migrate"
    );
    const sdkExtend = await pump.PUMP_SDK.extendAccountInstruction({ account: pump.bondingCurvePda(mint), user });
    assertSameIx(
      pumpExtendAccount({ account: pump.bondingCurvePda(mint).toBase58(), user: user.toBase58() }),
      fromWeb3(sdkExtend),
      "extend_account"
    );
  }
  // the hand-built collect from chain/scripts/devnet/04-collect.js (creator vault derived from the creator)
  const c = key().toBase58();
  assert.equal(pumpCollectCreatorFee({ creator: c }).accounts[1].address, creatorVaultPda(c));
});

test("buy_exact_sol_in is byte-equal to the IDL-built instruction (IDL-only on devnet)", async () => {
  const mint = key();
  const user = key();
  const vault = new PublicKey(cardVaultPda(mint.toBase58()));
  const fee = new PublicKey(DEVNET_PUMP_FEE_RECIPIENTS[2]);
  const buyback = new PublicKey(DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[5]);
  const sdk = await offlinePump.methods
    .buyExactSolIn(bn(77_000_000n), bn(1_000_000n), { 0: true } as never)
    .accountsPartial({
      feeRecipient: fee,
      mint,
      associatedUser: getAssociatedTokenAddressSync(mint, user, true, TOKEN_2022_PROGRAM_ID),
      user,
      creatorVault: pump.creatorVaultPda(vault),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts([
      { pubkey: pump.bondingCurveV2Pda(mint), isWritable: false, isSigner: false },
      { pubkey: buyback, isWritable: true, isSigner: false },
    ])
    .instruction();
  const mine = pumpBuyExactSolIn({
    mint: mint.toBase58(),
    user: user.toBase58(),
    creator: vault.toBase58(),
    feeRecipient: fee.toBase58(),
    buybackFeeRecipient: buyback.toBase58(),
    spendableSolIn: 77_000_000n,
    minTokensOut: 1_000_000n,
  });
  assertSameIx(mine, fromWeb3(sdk), "buy_exact_sol_in");
});

// ---------------------------------------------------------------- real devnet transactions

function resolved(name: string) {
  const fx = fixtureTx(name);
  const decoded = decodeTransaction(fx.bytes);
  const tables: Record<string, string[]> = {};
  for (const l of decoded.message.addressTableLookups) {
    const alt = fixtureAccount("shared_alt");
    assert.equal(l.accountKey, alt.address);
    tables[l.accountKey] = decodeAddressLookupTable(alt.data).addresses;
  }
  return resolveTransaction(decoded, tables);
}

/** Program + addresses + data must match exactly; flags are message-level merges, so only addresses/data here. */
function assertSameShape(actual: Instruction, expected: Instruction, label: string) {
  assert.equal(actual.programId, expected.programId, `${label}: program`);
  assert.deepEqual(
    actual.accounts.map((a) => a.address),
    expected.accounts.map((a) => a.address),
    `${label}: accounts`
  );
  assert.deepEqual(Array.from(actual.data), Array.from(expected.data), `${label}: data`);
}

test("real devnet buy / sell / complete txs re-encode byte for byte", () => {
  for (const name of ["coin1_buy", "coin1_sell", "coin1_complete"]) {
    const tx = resolved(name);
    const ix = tx.instructions.find((i) => i.programId === pump.PUMP_PROGRAM_ID.toBase58())!;
    const d = decodePumpInstruction(ix)!;
    assert.ok(d.name === "buy" || d.name === "sell", name);
    const common = {
      mint: d.accounts.mint,
      user: d.accounts.user,
      creator: cardVaultPda(d.accounts.mint),
      feeRecipient: d.accounts.feeRecipient,
      buybackFeeRecipient: d.remaining[1].address,
      tokenProgram: T22,
    };
    const rebuilt =
      d.name === "buy"
        ? pumpBuy({
            ...common,
            amount: d.args.amount,
            maxSolCost: d.args.maxSolCost,
            trackVolume: d.args.trackVolume ?? true,
          })
        : pumpSell({
            ...common,
            amount: (d.args as { amount: bigint }).amount,
            minSolOutput: (d.args as { minSolOutput: bigint }).minSolOutput,
          });
    assertSameShape(ix, rebuilt, name);
    // the creator vault is pump's PDA of the MintDex card vault
    assert.equal(d.accounts.creatorVault, creatorVaultPda(cardVaultPda(d.accounts.mint)));
  }
});

test("real devnet launch txs (legacy and ALT) re-encode create_v2 + ATA + buy byte for byte", () => {
  for (const name of ["coin1_launch", "coin2_launch_alt"]) {
    const tx = resolved(name);
    const ixs = tx.instructions.filter((i) => i.programId !== "ComputeBudget111111111111111111111111111111");
    const create = decodePumpInstruction(ixs[0])!;
    assert.equal(create.name, "create_v2");
    const buy = decodePumpInstruction(ixs[2])!;
    assert.equal(buy.name, "buy");
    if (create.name !== "create_v2" || buy.name !== "buy") throw new Error("unreachable");
    assert.equal(create.args.creator, cardVaultPda(create.accounts.mint), "creator = card vault");
    const rebuilt = pumpCreateV2AndBuyInstructions({
      mint: create.accounts.mint,
      user: create.accounts.user,
      ...create.args,
      feeRecipient: buy.accounts.feeRecipient,
      buybackFeeRecipient: buy.remaining[1].address,
      amount: buy.args.amount,
      maxSolCost: buy.args.maxSolCost,
    });
    rebuilt.forEach((ix, i) => assertSameShape(ixs[i], ix, `${name}[${i}]`));
  }
});

test("real devnet migrate and collect txs re-encode byte for byte", () => {
  const mig = resolved("coin1_migrate");
  const ix = mig.instructions.find((i) => decodePumpInstruction(i)?.name === "migrate")!;
  const d = decodePumpInstruction(ix)!;
  assertSameShape(
    ix,
    pumpMigrate({ mint: d.accounts.mint, user: d.accounts.user, withdrawAuthority: d.accounts.withdrawAuthority }),
    "migrate"
  );
  const col = resolved("coin1_collect");
  const c = col.instructions.find((i) => decodePumpInstruction(i)?.name === "collect_creator_fee")!;
  assertSameShape(
    c,
    pumpCollectCreatorFee({ creator: cardVaultPda("GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint") }),
    "collect"
  );
});

test("decoder rejects trailing bytes and foreign programs", () => {
  const ix = pumpCollectCreatorFee({ creator: key().toBase58() });
  assert.equal(decodePumpInstruction({ ...ix, programId: key().toBase58() }), null);
  assert.throws(() => decodePumpInstruction({ ...ix, data: Uint8Array.from([...ix.data, 0]) }));
});
