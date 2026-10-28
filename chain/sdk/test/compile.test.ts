// compileV0Message / serializeTransaction / withSignature against web3.js TransactionMessage.compileToV0Message:
// byte-equal messages for launch, trade, market and evolve batches, with and without the MintDex ALT (m3-contract §6.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { compileV0Message, serializeTransaction, withSignature } from "../src/tx/compile.ts";
import { decodeTransaction, resolveTransaction, signatureStatuses } from "../src/tx/wire.ts";
import { toWeb3Instructions } from "../src/web3.ts";
import { base58Encode } from "../src/bytes.ts";
import { mintdexAltAddresses } from "../src/mintdex/alt.ts";
import { pumpBuy, pumpCreateV2, pumpSell } from "../src/programs/pump.ts";
import { pammBuyInstructions } from "../src/programs/pamm.ts";
import { createAtaIdempotent, setComputeUnitLimit, setComputeUnitPrice } from "../src/programs/system.ts";
import {
  acceptBidIx,
  buyNowIx,
  cancelBidIx,
  collectFeesIx,
  delistCardIx,
  evolveIx,
  listCardIx,
  placeBidIx,
  registerCardIx,
  withdrawFeesIx,
} from "../src/mintdex/instructions.ts";
import { associatedTokenAddress, canonicalPoolPda, cardVaultPda, coinAddresses } from "../src/pda.ts";
import {
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  TOKEN_2022_PROGRAM_ID,
} from "../src/constants.ts";
import { decodeAmmGlobalConfig } from "../src/accounts/pamm.ts";
import type { Instruction } from "../src/instruction.ts";
import { fixtureAccount } from "./helpers.ts";

const TREASURY = "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj";
const ALT_A = "ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW";
const ALT_B = "5ZirDYYECSxPV2nxn5icHiPJqxZKQJZpt4TBVzAhqEgg";
const BLOCKHASH = "9zrUHnA1nCByPksy3aL8tQ47vqdaG2vnFs4HrxgcZj4F";
const altEntries = mintdexAltAddresses({ treasury: TREASURY });

const kp = () => Keypair.generate();
const addr = () => kp().publicKey.toBase58();
const cu = (limit = 400_000): Instruction[] => [setComputeUnitLimit(limit), setComputeUnitPrice(10_000n)];

/** web3.js serializes into a 1,232-byte buffer: null when the message does not fit a packet. */
function web3Compile(payer: string, ixs: Instruction[], alt: boolean): Uint8Array | null {
  const tables = alt
    ? [
        new AddressLookupTableAccount({
          key: new PublicKey(ALT_A),
          state: {
            deactivationSlot: BigInt("18446744073709551615"),
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
            authority: new PublicKey(TREASURY),
            addresses: altEntries.map((a) => new PublicKey(a)),
          },
        }),
      ]
    : [];
  const msg = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: BLOCKHASH,
    instructions: toWeb3Instructions(ixs),
  }).compileToV0Message(tables);
  try {
    return msg.serialize();
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

function mine(payer: string, ixs: Instruction[], alt: boolean) {
  return compileV0Message({
    payer,
    instructions: ixs,
    recentBlockhash: BLOCKHASH,
    lookupTables: alt ? [{ address: ALT_A, addresses: altEntries, usableLength: 38 }] : [],
  });
}

function check(label: string, payer: string, ixs: Instruction[]) {
  for (const alt of [false, true]) {
    const a = mine(payer, ixs, alt);
    const b = web3Compile(payer, ixs, alt);
    if (b === null) {
      assert.ok(a.bytes.length > 1232 - 1 - 64 * a.signers.length, `${label}: web3.js overflowed but ours is small`);
      continue;
    }
    assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b), `${label} (alt ${alt}): message bytes`);
    const decoded = decodeTransaction(serializeTransaction(a.bytes, a.signers.map(() => null)));
    assert.deepEqual(decoded.message.staticAccountKeys, a.staticAccountKeys);
    const resolved = resolveTransaction(decoded, { [ALT_A]: altEntries });
    assert.equal(resolved.instructions.length, ixs.length);
    resolved.instructions.forEach((ix, i) => {
      assert.equal(ix.programId, ixs[i].programId, `${label}: program ${i}`);
      assert.deepEqual(ix.accounts.map((m) => m.address), ixs[i].accounts.map((m) => m.address), `${label}: accounts ${i}`);
      assert.deepEqual(Buffer.from(ix.data), Buffer.from(ixs[i].data));
    });
    if (alt) assert.deepEqual(a.lookupTablesUsed, [ALT_A]);
  }
}

const fee = DEVNET_PUMP_FEE_RECIPIENTS[2];
const buyback = DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[6];

test("launch tx (create_v2, register_card, ATA, pump buy) compiles byte-equal to web3.js", () => {
  const user = addr();
  const mint = addr();
  const vault = cardVaultPda(mint);
  const ata = associatedTokenAddress(user, mint, TOKEN_2022_PROGRAM_ID);
  const ixs = [
    ...cu(450_000),
    pumpCreateV2({ mint, user, name: "M3 Test", symbol: "MTEST", uri: `https://mintdex.fun/m/${mint}.json`, creator: vault }),
    registerCardIx({ launcher: user, mint, treasury: TREASURY }),
    createAtaIdempotent(user, ata, user, mint, TOKEN_2022_PROGRAM_ID),
    pumpBuy({ mint, user, creator: vault, feeRecipient: fee, buybackFeeRecipient: buyback, amount: 1_000_000n, maxSolCost: 50_500_000n }),
  ];
  check("launch", user, ixs);
  const m = mine(user, ixs, true);
  assert.deepEqual(m.signers, [user, mint], "payer then mint");
  // no-dev-buy launch without an ALT fits (card-program-v2 §10.1: 1,209 B at max name/symbol)
  const big = [
    ...cu(),
    pumpCreateV2({ mint, user, name: "N".repeat(32), symbol: "S".repeat(10), uri: `https://mintdex.fun/m/${mint}.json`, creator: vault }),
    registerCardIx({ launcher: user, mint, treasury: TREASURY }),
  ];
  const bytes = serializeTransaction(mine(user, big, false).bytes, [null, null]);
  assert.ok(bytes.length <= 1232, `no-ALT launch ${bytes.length} B`);
});

test("trade txs (pump buy / sell, PumpSwap buy composite) compile byte-equal to web3.js", () => {
  const user = addr();
  const mint = addr();
  const vault = cardVaultPda(mint);
  const ata = associatedTokenAddress(user, mint, TOKEN_2022_PROGRAM_ID);
  check("pump buy", user, [
    ...cu(),
    createAtaIdempotent(user, ata, user, mint, TOKEN_2022_PROGRAM_ID),
    pumpBuy({ mint, user, creator: vault, feeRecipient: fee, buybackFeeRecipient: buyback, amount: 9n, maxSolCost: 10n }),
  ]);
  check("pump sell", user, [
    ...cu(),
    pumpSell({ mint, user, creator: vault, feeRecipient: fee, buybackFeeRecipient: buyback, amount: 9n, minSolOutput: 1n }),
  ]);
  const g = decodeAmmGlobalConfig(fixtureAccount("amm_global_config").data);
  const pool = canonicalPoolPda(mint);
  check("pamm buy", user, [
    ...cu(),
    ...pammBuyInstructions({
      pool,
      user,
      baseMint: mint,
      poolBaseTokenAccount: associatedTokenAddress(pool, mint, TOKEN_2022_PROGRAM_ID),
      poolQuoteTokenAccount: addr(),
      protocolFeeRecipient: g.protocolFeeRecipients[0],
      buybackFeeRecipient: g.buybackFeeRecipients[0],
      coinCreator: vault,
      baseAmountOut: 5n,
      maxQuoteAmountIn: 7n,
      poolDataLength: 295,
      userBaseAccountExists: false,
      userQuoteAccountExists: false,
    }),
  ]);
});

test("market txs (bid, cancel, accept with extras, list, delist, cancel + buy now, withdraw, collect) compile byte-equal", () => {
  const mint = addr();
  const seller = addr();
  const bidder = addr();
  const launcher = addr();
  const extras = [addr(), addr()];
  check("bid", bidder, [...cu(), placeBidIx({ bidder, mint, amount: 30_000_000n })]);
  check("cancel", bidder, [...cu(), cancelBidIx({ bidder, mint })]);
  check("accept", seller, [
    ...cu(),
    acceptBidIx({ seller, bidder, mint, launcher, treasury: TREASURY, minAmount: 1n, maxTotalFeeBps: 750, minFeesToSeller: 5n, extraWsolAccounts: extras }),
  ]);
  check("list", seller, [...cu(), listCardIx({ seller, mint, price: 40_000_000n, expiresAt: 0n, flags: 1, minFeesToSeller: 0n })]);
  check("delist", seller, [...cu(), delistCardIx({ seller, mint })]);
  check("buy now", bidder, [
    ...cu(),
    cancelBidIx({ bidder, mint }),
    buyNowIx({ buyer: bidder, seller, mint, launcher, treasury: TREASURY, expectedPrice: 40_000_000n, maxTotalFeeBps: 750, extraWsolAccounts: extras }),
  ]);
  check("withdraw", seller, [...cu(), withdrawFeesIx({ holder: seller, mint, extraWsolAccounts: extras })]);
  check("collect", seller, [...cu(), collectFeesIx({ payer: seller, mint })]);
  // launcher == treasury (the seed coins): a signer that is also in the ALT stays static
  check("accept launcher=treasury", TREASURY, [
    ...cu(),
    acceptBidIx({ seller: TREASURY, bidder, mint, launcher: TREASURY, treasury: TREASURY, minAmount: 1n, maxTotalFeeBps: 250, minFeesToSeller: 0n }),
  ]);
});

test("evolve batches (6 curve cards, 3 pool cards) compile byte-equal", () => {
  const cranker = addr();
  const curve = Array.from({ length: 6 }, () => evolveIx({ cranker, mint: addr(), graduated: false }));
  check("evolve x6", cranker, [setComputeUnitLimit(660_000), setComputeUnitPrice(10_000n), ...curve]);
  const pool = Array.from({ length: 3 }, () => evolveIx({ cranker, mint: addr(), graduated: true }));
  check("evolve x3 pool", cranker, [setComputeUnitLimit(330_000), setComputeUnitPrice(10_000n), ...pool]);
});

test("usableLength limits which table entries may be referenced; ALT order is respected", () => {
  const user = addr();
  const mint = addr();
  const ixs = [...cu(), collectFeesIx({ payer: user, mint })];
  const none = compileV0Message({ payer: user, instructions: ixs, recentBlockhash: BLOCKHASH, lookupTables: [{ address: ALT_A, addresses: altEntries, usableLength: 0 }] });
  assert.deepEqual(none.lookupTablesUsed, []);
  const two = compileV0Message({
    payer: user,
    instructions: ixs,
    recentBlockhash: BLOCKHASH,
    lookupTables: [
      { address: ALT_B, addresses: altEntries },
      { address: ALT_A, addresses: altEntries },
    ],
  });
  assert.deepEqual(two.lookupTablesUsed, [ALT_B], "first table drains every key, the second is unused");
  // a key at index ≥ usableLength stays static
  const capped = compileV0Message({ payer: user, instructions: ixs, recentBlockhash: BLOCKHASH, lookupTables: [{ address: ALT_A, addresses: altEntries, usableLength: 20 }] });
  const full = mine(user, ixs, true);
  assert.ok(capped.staticAccountKeys.length > full.staticAccountKeys.length);
});

test("serializeTransaction + withSignature: signatures land in the right slots and verify; web3.js agrees", () => {
  const payer = kp();
  const mintKp = kp();
  const mint = mintKp.publicKey.toBase58();
  const user = payer.publicKey.toBase58();
  const ixs = [
    ...cu(),
    pumpCreateV2({ mint, user, name: "Sig", symbol: "SIG", uri: `https://mintdex.fun/m/${mint}.json`, creator: cardVaultPda(mint) }),
    registerCardIx({ launcher: user, mint, treasury: TREASURY }),
  ];
  const m = mine(user, ixs, true);
  const unsigned = serializeTransaction(m.bytes, [null, null]);
  const w = new VersionedTransaction(
    new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: BLOCKHASH, instructions: toWeb3Instructions(ixs) }).compileToV0Message([
      new AddressLookupTableAccount({
        key: new PublicKey(ALT_A),
        state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: altEntries.map((a) => new PublicKey(a)) },
      }),
    ])
  );
  w.sign([mintKp]); // web3.js partial-signs the mint slot
  const mintSig = w.signatures[1];
  const partial = withSignature(unsigned, mint, mintSig);
  assert.deepEqual(signatureStatuses(decodeTransaction(partial)).map((s) => s.status), ["missing", "valid"]);
  w.sign([payer]);
  const full = withSignature(partial, user, w.signatures[0]);
  assert.deepEqual(Buffer.from(full), Buffer.from(w.serialize()), "same wire bytes as web3.js");
  assert.equal(base58Encode(decodeTransaction(full).signatures[0]), base58Encode(w.signatures[0]));
  assert.throws(() => withSignature(full, addr(), mintSig), /not a required signer/);
  assert.throws(() => serializeTransaction(m.bytes, [new Uint8Array(3)]), /64 bytes/);
  assert.equal(coinAddresses(mint).mint, mint);
});
