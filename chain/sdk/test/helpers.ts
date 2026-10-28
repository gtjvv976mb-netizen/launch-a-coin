// Shared test helpers: devnet fixtures (read-only snapshots from scripts/fetch-fixtures.mjs) and
// conversions between this SDK's shapes and @solana/web3.js / bn.js used by the pump SDKs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import BN from "bn.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { AccountInfo } from "@solana/web3.js";
import { fromBase64, toHex } from "../src/bytes.ts";
import type { AccountData } from "../src/accounts/types.ts";
import type { Instruction } from "../src/instruction.ts";
import { fromWeb3Instruction } from "../src/web3.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devnet");

interface AccountFixture {
  pubkey: string;
  account: { lamports: number; data: [string, string]; owner: string; executable: boolean };
}

export function fixtureAccount(name: string): AccountData & { address: string } {
  const j = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as AccountFixture;
  return {
    address: j.pubkey,
    owner: j.account.owner,
    lamports: BigInt(j.account.lamports),
    data: fromBase64(j.account.data[0]),
  };
}

/** The same fixture as a web3.js AccountInfo (for the pump SDK decoders). */
export function fixtureAccountInfo(name: string): AccountInfo<Buffer> {
  const a = fixtureAccount(name);
  return { data: Buffer.from(a.data), owner: new PublicKey(a.owner), lamports: Number(a.lamports), executable: false };
}

export interface TxFixture {
  signature: string;
  slot: number;
  version: "legacy" | 0;
  err: unknown;
  bytes: Uint8Array;
  loadedAddresses: { writable: string[]; readonly: string[] };
}

export function fixtureTx(name: string): TxFixture {
  const j = JSON.parse(readFileSync(join(FIXTURES, `tx_${name}.json`), "utf8"));
  return { ...j, bytes: fromBase64(j.transaction) };
}

export const bn = (v: bigint | number) => new BN(v.toString());
export const big = (v: BN | number | bigint) => BigInt(v.toString());
export const pk = (a: string) => new PublicKey(a);

export const fromWeb3 = (ix: TransactionInstruction): Instruction => fromWeb3Instruction(ix);

/** Asserts two instructions are identical (program, accounts with flags, data), with a readable diff. */
export function assertSameIx(actual: Instruction, expected: Instruction, label = "instruction") {
  assert.equal(actual.programId, expected.programId, `${label}: program id`);
  assert.deepEqual(
    actual.accounts.map((a, i) => `${i} ${a.address} ${a.isSigner ? "s" : "-"}${a.isWritable ? "w" : "-"}`),
    expected.accounts.map((a, i) => `${i} ${a.address} ${a.isSigner ? "s" : "-"}${a.isWritable ? "w" : "-"}`),
    `${label}: accounts`
  );
  assert.equal(toHex(actual.data), toHex(expected.data), `${label}: data`);
}

export function assertSameIxs(actual: Instruction[], expected: Instruction[], label = "instructions") {
  assert.equal(actual.length, expected.length, `${label}: count`);
  actual.forEach((ix, i) => assertSameIx(ix, expected[i], `${label}[${i}]`));
}

/** Deterministic pseudo-random bytes (xorshift), so property tests are reproducible. */
export function rng(seed = 0x9e3779b9) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  return {
    u32: next,
    bytes(n: number) {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = next() & 0xff;
      return out;
    },
    float: () => next() / 0x100000000,
    bigint(maxExclusive: bigint) {
      let v = 0n;
      for (let i = 0; i < 4; i++) v = (v << 32n) | BigInt(next());
      return v % maxExclusive;
    },
  };
}
