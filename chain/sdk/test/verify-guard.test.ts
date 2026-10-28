// verifyTransaction `guardPrograms` (m3-contract §3.5 finalize step 4, §7.1): wallets may append guard instructions
// after the payload; they pass only when listed, after the payload, and with read-only non-signer accounts only.
// Default (no list): unchanged strict behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { verifyTransaction } from "../src/tx/verify.ts";
import type { TxIntent } from "../src/tx/verify.ts";
import { compileV0Message, serializeTransaction } from "../src/tx/compile.ts";
import { mintdexAltAddresses } from "../src/mintdex/alt.ts";
import { registerCardIx, placeBidIx } from "../src/mintdex/instructions.ts";
import { pumpBuy, pumpCreateV2 } from "../src/programs/pump.ts";
import { createAtaIdempotent, setComputeUnitLimit, setComputeUnitPrice, systemTransfer } from "../src/programs/system.ts";
import { associatedTokenAddress, cardVaultPda } from "../src/pda.ts";
import {
  DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
  DEVNET_PUMP_FEE_RECIPIENTS,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "../src/constants.ts";
import { ro, rs, wr } from "../src/instruction.ts";
import type { Instruction } from "../src/instruction.ts";

const TREASURY = "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj";
const ALT_A = "ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW";
const ALT_B = "5ZirDYYECSxPV2nxn5icHiPJqxZKQJZpt4TBVzAhqEgg";
const BLOCKHASH = "9zrUHnA1nCByPksy3aL8tQ47vqdaG2vnFs4HrxgcZj4F";
const GUARD = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"; // any non-allowlisted program id
const alt = mintdexAltAddresses({ treasury: TREASURY });
const opts = {
  lookupTables: { [ALT_A]: alt, [ALT_B]: alt },
  allowedLookupTables: [ALT_A, ALT_B],
  pumpFeeRecipients: DEVNET_PUMP_FEE_RECIPIENTS,
  pumpBuybackFeeRecipients: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS,
};

const addr = () => Keypair.generate().publicKey.toBase58();
const user = addr();
const mint = addr();
const vault = cardVaultPda(mint);
const name = "Guard";
const symbol = "GRD";
const uri = `https://mintdex.fun/m/${mint}.json`;

function payload(): Instruction[] {
  const ata = associatedTokenAddress(user, mint, TOKEN_2022_PROGRAM_ID);
  return [
    pumpCreateV2({ mint, user, name, symbol, uri, creator: vault }),
    registerCardIx({ launcher: user, mint, treasury: TREASURY }),
    createAtaIdempotent(user, ata, user, mint, TOKEN_2022_PROGRAM_ID),
    pumpBuy({
      mint,
      user,
      creator: vault,
      feeRecipient: DEVNET_PUMP_FEE_RECIPIENTS[0],
      buybackFeeRecipient: DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS[0],
      amount: 1_000_000n,
      maxSolCost: 10_000_000n,
    }),
  ];
}
const intent: TxIntent = {
  kind: "launch",
  payer: user,
  mint,
  name,
  symbol,
  uri,
  treasury: TREASURY,
  devBuy: { minTokens: 1_000_000n, maxSolCost: 10_000_000n },
};

function tx(ixs: Instruction[], price = 10_000n): Uint8Array {
  const all = [setComputeUnitLimit(400_000), setComputeUnitPrice(price), ...ixs];
  const m = compileV0Message({ payer: user, instructions: all, recentBlockhash: BLOCKHASH, lookupTables: [{ address: ALT_A, addresses: alt, usableLength: 38 }] });
  return serializeTransaction(m.bytes, m.signers.map(() => null));
}

const READONLY_EXTRA = addr();
const guard = (accounts = [ro(vault), ro(READONLY_EXTRA)]): Instruction => ({ programId: GUARD, accounts, data: Uint8Array.of(1, 2, 3) });

test("default: no guard list, the plain launch passes and an appended guard instruction is rejected", () => {
  assert.equal(verifyTransaction(tx(payload()), intent, opts).ok, true);
  const r = verifyTransaction(tx([...payload(), guard()]), intent, opts);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /not allowed/);
});

test("guardPrograms: a read-only guard after the payload passes, with a CU price rewrite inside the limits", () => {
  const r = verifyTransaction(tx([...payload(), guard()], 90_000n), intent, {
    ...opts,
    guardPrograms: [GUARD],
    maxComputeUnitPriceMicroLamports: 100_000n,
    maxPriorityFeeLamports: 5_000_000n,
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.summary.maxPayerSpendLamports, 10_000_000n, "guards add no spend");
  // two guards in a row also pass; a guard with no accounts passes
  const r2 = verifyTransaction(tx([...payload(), guard(), guard([])]), intent, { ...opts, guardPrograms: [GUARD] });
  assert.deepEqual(r2.errors, []);
});

test("guardPrograms: writable or signer accounts, a guard before the payload, or a bigger fee are rejected", () => {
  const g = { ...opts, guardPrograms: [GUARD] };
  // the payer is a writable signer at the message level
  let r = verifyTransaction(tx([...payload(), guard([ro(user)])]), intent, g);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /signer or writable/);
  r = verifyTransaction(tx([...payload(), guard([wr(addr())])]), intent, g);
  assert.match(r.errors[0], /signer or writable/);
  r = verifyTransaction(tx([...payload(), guard([rs(addr())])]), intent, g);
  assert.equal(r.ok, false, "a new signer is never accepted");
  r = verifyTransaction(tx([guard(), ...payload()]), intent, g);
  assert.equal(r.ok, false, "guard before the payload");
  r = verifyTransaction(tx([...payload().slice(0, 2), guard(), ...payload().slice(2)]), intent, g);
  assert.equal(r.ok, false, "guard in the middle of the payload");
  r = verifyTransaction(tx([...payload(), guard()], 200_000n), intent, { ...g, maxComputeUnitPriceMicroLamports: 100_000n });
  assert.match(r.errors[0], /compute unit price/);
});

test("guardPrograms never excuses an allowed payload program: an appended transfer stays rejected", () => {
  const g = { ...opts, guardPrograms: [GUARD, SYSTEM_PROGRAM_ID] };
  const r = verifyTransaction(tx([...payload(), systemTransfer(user, TREASURY, 1n)]), intent, g);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /unexpected extra instruction/);
  // exact intents behave the same
  const bid = placeBidIx({ bidder: user, mint, amount: 30_000_000n });
  const exact: TxIntent = { kind: "exact", payer: user, expected: [bid] };
  assert.equal(verifyTransaction(tx([bid, guard()]), exact, { ...opts, guardPrograms: [GUARD] }).ok, true);
  assert.equal(verifyTransaction(tx([bid, guard()]), exact, opts).ok, false);
});
