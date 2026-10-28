// Byte-equality of the hand-encoded PumpSwap instructions with PUMP_AMM_SDK (pump-swap-sdk 1.20.0 as
// shipped with pump-sdk 2.0.0), using the real coin 1 pool from devnet as the swap state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  MintLayout,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as amm from "@pump-fun/pump-swap-sdk";
import type { SwapSolanaState } from "@pump-fun/pump-swap-sdk";
import {
  decodePammInstruction,
  pammBuyExactQuoteIn,
  pammBuyInstructions,
  pammCollectCoinCreatorFee,
  pammExtendAccount,
  pammSellInstructions,
  pammTransferCreatorFeesToPump,
} from "../src/programs/pamm.ts";
import { pumpCollectCreatorFee } from "../src/programs/pump.ts";
import { decodeAmmGlobalConfig, decodePool } from "../src/accounts/pamm.ts";
import { canonicalPoolPda, cardVaultPda, vaultWsolAta } from "../src/pda.ts";
import { readU64 } from "../src/bytes.ts";
import { decodeTransaction, resolveTransaction } from "../src/tx/wire.ts";
import {
  assertSameIx,
  assertSameIxs,
  big,
  bn,
  fixtureAccount,
  fixtureAccountInfo,
  fixtureTx,
  fromWeb3,
} from "./helpers.ts";

const COIN1 = new PublicKey("GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint");
const sdk = amm.PUMP_AMM_SDK;
const globalConfig = sdk.decodeGlobalConfig(fixtureAccountInfo("amm_global_config"));
const feeConfig = sdk.decodeFeeConfig(fixtureAccountInfo("amm_fee_config"));
const poolInfo = fixtureAccountInfo("coin1_pool");
const pool = sdk.decodePool(poolInfo);
const amountOf = (name: string) => readU64(fixtureAccount(name).data, 64);

function state(
  user: PublicKey,
  opts: { baseExists: boolean; quoteExists: boolean; poolLen?: number }
): SwapSolanaState {
  const userBase = getAssociatedTokenAddressSync(COIN1, user, true, TOKEN_2022_PROGRAM_ID);
  const userQuote = getAssociatedTokenAddressSync(NATIVE_MINT, user, true, TOKEN_PROGRAM_ID);
  const fakeTa = (owner: PublicKey) => ({ data: Buffer.alloc(165), owner, lamports: 1, executable: false });
  const info = opts.poolLen ? { ...poolInfo, data: poolInfo.data.subarray(0, opts.poolLen) } : poolInfo;
  return {
    globalConfig,
    feeConfig,
    poolKey: new PublicKey(fixtureAccount("coin1_pool").address),
    poolAccountInfo: info,
    pool,
    poolBaseAmount: bn(amountOf("coin1_pool_base_ta")),
    poolQuoteAmount: bn(amountOf("coin1_pool_quote_ta")),
    baseTokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
    baseMint: COIN1,
    baseMintAccount: MintLayout.decode(Buffer.from(fixtureAccount("coin1_mint").data).subarray(0, 82)),
    user,
    userBaseTokenAccount: userBase,
    userQuoteTokenAccount: userQuote,
    userBaseAccountInfo: opts.baseExists ? fakeTa(TOKEN_2022_PROGRAM_ID) : null,
    userQuoteAccountInfo: opts.quoteExists ? fakeTa(TOKEN_PROGRAM_ID) : null,
  } as SwapSolanaState;
}

const swapBase = (user: PublicKey, idx: number) => ({
  pool: fixtureAccount("coin1_pool").address,
  user: user.toBase58(),
  baseMint: COIN1.toBase58(),
  poolBaseTokenAccount: pool.poolBaseTokenAccount.toBase58(),
  poolQuoteTokenAccount: pool.poolQuoteTokenAccount.toBase58(),
  protocolFeeRecipient: globalConfig.protocolFeeRecipients[idx].toBase58(),
  buybackFeeRecipient: globalConfig.buybackFeeRecipients[idx].toBase58(),
  coinCreator: pool.coinCreator.toBase58(),
});

test("GlobalConfig and Pool decoders agree with PUMP_AMM_SDK on the devnet fixtures", () => {
  const gc = decodeAmmGlobalConfig(fixtureAccount("amm_global_config").data);
  assert.deepEqual(
    gc.protocolFeeRecipients,
    globalConfig.protocolFeeRecipients.map((k) => k.toBase58())
  );
  assert.deepEqual(
    gc.buybackFeeRecipients,
    globalConfig.buybackFeeRecipients.map((k) => k.toBase58())
  );
  assert.deepEqual(
    gc.reservedFeeRecipients,
    globalConfig.reservedFeeRecipients.map((k) => k.toBase58())
  );
  assert.equal(gc.reservedFeeRecipient, globalConfig.reservedFeeRecipient.toBase58());
  assert.equal(gc.boostAuthority, globalConfig.boostAuthority.toBase58());
  assert.equal(gc.lpFeeBasisPoints, big(globalConfig.lpFeeBasisPoints));
  const p = decodePool(fixtureAccount("coin1_pool").data);
  assert.equal(p.baseMint, pool.baseMint.toBase58());
  assert.equal(p.quoteMint, pool.quoteMint.toBase58());
  assert.equal(p.coinCreator, pool.coinCreator.toBase58());
  assert.equal(p.creator, pool.creator.toBase58());
  assert.equal(p.lpMint, pool.lpMint.toBase58());
  assert.equal(p.lpSupply, big(pool.lpSupply));
  assert.equal(p.index, pool.index);
  assert.equal(p.virtualQuoteReserves, big(pool.virtualQuoteReserves));
  assert.equal(p.creatorFeeBps, big(pool.creatorFeeBps));
  assert.equal(p.isMayhemMode, pool.isMayhemMode);
  assert.equal(p.coinCreator, cardVaultPda(COIN1.toBase58()));
});

test("buyInstructions and sellInstructions equal the composites in every ATA/pool-size combination", async (t) => {
  let n = 0;
  for (const rv of [0.01, 0.37, 0.93]) {
    t.mock.method(Math, "random", () => rv);
    const idx = Math.floor(rv * 8);
    for (const baseExists of [false, true]) {
      for (const quoteExists of [false, true]) {
        for (const poolLen of [undefined, 295]) {
          const user = Keypair.generate().publicKey;
          const st = state(user, { baseExists, quoteExists, poolLen });
          const flags = {
            poolDataLength: st.poolAccountInfo!.data.length,
            userBaseAccountExists: baseExists,
            userQuoteAccountExists: quoteExists,
          };
          const buy = await sdk.buyInstructions(st, bn(12_345_678_901n), bn(50_000_000n));
          const mineBuy = pammBuyInstructions({
            ...swapBase(user, idx),
            ...flags,
            baseAmountOut: 12_345_678_901n,
            maxQuoteAmountIn: 50_000_000n,
          });
          assertSameIxs(mineBuy, buy.map(fromWeb3), `buy ${rv} ${baseExists} ${quoteExists} ${poolLen}`);
          const sell = await sdk.sellInstructions(st, bn(9_000_000_000n), bn(1_000_000n));
          const mineSell = pammSellInstructions({
            ...swapBase(user, idx),
            ...flags,
            baseAmountIn: 9_000_000_000n,
            minQuoteAmountOut: 1_000_000n,
          });
          assertSameIxs(mineSell, sell.map(fromWeb3), `sell ${rv} ${baseExists} ${quoteExists} ${poolLen}`);
          n++;
        }
      }
    }
    t.mock.restoreAll();
  }
  assert.equal(n, 24);
});

test("buyQuoteInput / sellBaseInput (SDK fee math) produce the same instructions given their amounts", async (t) => {
  t.mock.method(Math, "random", () => 0.5);
  const user = Keypair.generate().publicKey;
  const st = state(user, { baseExists: true, quoteExists: false });
  const quoteIn = bn(100_000_000n);
  const { base, maxQuote } = amm.buyQuoteInput({
    quote: quoteIn,
    slippage: 1,
    baseReserve: st.poolBaseAmount,
    quoteReserve: st.poolQuoteAmount,
    virtualQuoteReserves: pool.virtualQuoteReserves,
    baseMintAccount: st.baseMintAccount,
    baseMint: COIN1,
    coinCreator: pool.coinCreator,
    creator: pool.creator,
    feeConfig,
    globalConfig,
    quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode,
    creatorFeeBps: pool.creatorFeeBps,
  });
  const sdkIxs = await sdk.buyQuoteInput(st, quoteIn, 1);
  const flags = {
    poolDataLength: st.poolAccountInfo!.data.length,
    userBaseAccountExists: true,
    userQuoteAccountExists: false,
  };
  const mine = pammBuyInstructions({
    ...swapBase(user, 4),
    ...flags,
    baseAmountOut: big(base),
    maxQuoteAmountIn: big(maxQuote),
  });
  assertSameIxs(mine, sdkIxs.map(fromWeb3), "buyQuoteInput");

  const baseIn = bn(25_000_000_000n);
  const { minQuote } = amm.sellBaseInput({
    base: baseIn,
    slippage: 1,
    baseReserve: st.poolBaseAmount,
    quoteReserve: st.poolQuoteAmount,
    virtualQuoteReserves: pool.virtualQuoteReserves,
    baseMintAccount: st.baseMintAccount,
    baseMint: COIN1,
    coinCreator: pool.coinCreator,
    creator: pool.creator,
    feeConfig,
    globalConfig,
    quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode,
    creatorFeeBps: pool.creatorFeeBps,
  });
  const sdkSell = await sdk.sellBaseInput(st, baseIn, 1);
  const mineSell = pammSellInstructions({
    ...swapBase(user, 4),
    ...flags,
    baseAmountIn: big(baseIn),
    minQuoteAmountOut: big(minQuote),
  });
  assertSameIxs(mineSell, sdkSell.map(fromWeb3), "sellBaseInput");
});

test("transfer_creator_fees_to_pump, collect_coin_creator_fee and extend_account equal the SDK builders", async () => {
  const program = amm.getPumpAmmProgram(null as never);
  for (const mint of [COIN1, Keypair.generate().publicKey]) {
    const vault = new PublicKey(cardVaultPda(mint.toBase58()));
    const sdkTransfer = await program.methods
      .transferCreatorFeesToPump()
      .accountsPartial({ wsolMint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID, coinCreator: vault })
      .instruction();
    assertSameIx(
      pammTransferCreatorFeesToPump({ coinCreator: vault.toBase58() }),
      fromWeb3(sdkTransfer),
      "transfer_creator_fees_to_pump"
    );
    // the griefing path of G12: AMM fees pushed into the card vault's own WSOL ATA (recovered by sweep leg 3)
    const dest = new PublicKey(vaultWsolAta(mint.toBase58()));
    const collect = await sdk.collectCoinCreatorFee(
      {
        coinCreator: vault,
        quoteMint: NATIVE_MINT,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
        coinCreatorVaultAuthority: amm.coinCreatorVaultAuthorityPda(vault),
        coinCreatorVaultAta: amm.coinCreatorVaultAtaPda(
          amm.coinCreatorVaultAuthorityPda(vault),
          NATIVE_MINT,
          TOKEN_PROGRAM_ID
        ),
        coinCreatorTokenAccount: dest,
        coinCreatorVaultAtaAccountInfo: {
          data: Buffer.alloc(165),
          owner: TOKEN_PROGRAM_ID,
          lamports: 1,
          executable: false,
        },
        coinCreatorTokenAccountInfo: {
          data: Buffer.alloc(165),
          owner: TOKEN_PROGRAM_ID,
          lamports: 1,
          executable: false,
        },
      },
      Keypair.generate().publicKey
    );
    assert.equal(collect.length, 1);
    assertSameIx(
      pammCollectCoinCreatorFee({ coinCreator: vault.toBase58(), coinCreatorTokenAccount: dest.toBase58() }),
      fromWeb3(collect[0]),
      "collect_coin_creator_fee"
    );
    const user = Keypair.generate().publicKey;
    const pk = new PublicKey(canonicalPoolPda(mint.toBase58()));
    assertSameIx(
      pammExtendAccount({ account: pk.toBase58(), user: user.toBase58() }),
      fromWeb3(await sdk.extendAccount(pk, user)),
      "extend_account"
    );
  }
});

test("buy_exact_quote_in equals the IDL-built instruction with the SDK's swap accounts", async (t) => {
  t.mock.method(Math, "random", () => 0.2);
  const user = Keypair.generate().publicKey;
  const st = state(user, { baseExists: true, quoteExists: true });
  const accounts = (sdk as unknown as { swapAccounts(s: SwapSolanaState): Record<string, PublicKey> }).swapAccounts(st);
  const program = amm.getPumpAmmProgram(null as never);
  const remaining = [
    { pubkey: amm.poolV2Pda(COIN1), isWritable: false, isSigner: false },
    { pubkey: accounts.buybackFeeRecipient, isWritable: false, isSigner: false },
    { pubkey: accounts.buybackFeeRecipientTokenAccount, isWritable: true, isSigner: false },
  ];
  const ix = await program.methods
    .buyExactQuoteIn(bn(10_000_000n), bn(1n), { 0: true } as never)
    .accounts(accounts as never)
    .remainingAccounts(remaining)
    .instruction();
  const mine = pammBuyExactQuoteIn({
    ...swapBase(user, Math.floor(0.2 * 8)),
    spendableQuoteIn: 10_000_000n,
    minBaseAmountOut: 1n,
  });
  assertSameIx(mine, fromWeb3(ix), "buy_exact_quote_in");
});

test("real devnet PumpSwap sell and transfer+collect txs re-encode byte for byte", () => {
  const fx = fixtureTx("coin1_amm_sell");
  const tx = resolveTransaction(decodeTransaction(fx.bytes));
  const sellIx = tx.instructions.find((i) => decodePammInstruction(i)?.name === "sell")!;
  const d = decodePammInstruction(sellIx)!;
  if (d.name !== "sell") throw new Error("unreachable");
  const buyback = d.remaining[d.remaining.length - 2].address;
  const extendPresent = tx.instructions.some((i) => decodePammInstruction(i)?.name === "extend_account");
  const rebuilt = pammSellInstructions({
    pool: d.accounts.pool,
    user: d.accounts.user,
    baseMint: d.accounts.baseMint,
    poolBaseTokenAccount: d.accounts.poolBaseTokenAccount,
    poolQuoteTokenAccount: d.accounts.poolQuoteTokenAccount,
    protocolFeeRecipient: d.accounts.protocolFeeRecipient,
    buybackFeeRecipient: buyback,
    coinCreator: cardVaultPda(d.accounts.baseMint),
    baseAmountIn: d.args.baseAmountIn,
    minQuoteAmountOut: d.args.minQuoteAmountOut,
    poolDataLength: extendPresent ? 295 : 301,
    userBaseAccountExists: true,
    userQuoteAccountExists: !tx.instructions.some(
      (i) => i.programId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    ),
  });
  const payload = tx.instructions.filter((i) => i.programId !== "ComputeBudget111111111111111111111111111111");
  assert.equal(payload.length, rebuilt.length);
  payload.forEach((ix, i) => {
    assert.equal(ix.programId, rebuilt[i].programId);
    assert.deepEqual(
      ix.accounts.map((a) => a.address),
      rebuilt[i].accounts.map((a) => a.address),
      `ix ${i}`
    );
    assert.deepEqual(Array.from(ix.data), Array.from(rebuilt[i].data), `ix ${i} data`);
  });
  assert.ok(globalConfig.protocolFeeRecipients.some((k) => k.toBase58() === d.accounts.protocolFeeRecipient));

  const tc = resolveTransaction(decodeTransaction(fixtureTx("coin1_transfer_collect").bytes));
  const p2 = tc.instructions.filter((i) => i.programId !== "ComputeBudget111111111111111111111111111111");
  const vault = cardVaultPda(COIN1.toBase58());
  const expected = [pammTransferCreatorFeesToPump({ coinCreator: vault }), pumpCollectCreatorFee({ creator: vault })];
  p2.forEach((ix, i) => {
    assert.deepEqual(
      ix.accounts.map((a) => a.address),
      expected[i].accounts.map((a) => a.address)
    );
    assert.deepEqual(Array.from(ix.data), Array.from(expected[i].data));
  });
});
