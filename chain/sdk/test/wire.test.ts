// Wire decoder against web3.js and real signed devnet transactions (legacy and v0 + ALT).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeMessage,
  decodeTransaction,
  messageHash,
  resolveTransaction,
  signatureStatuses,
  UnsupportedTxVersionError,
  wireTxVersion,
} from "../src/tx/wire.ts";
import { fromBase64 } from "../src/bytes.ts";
import { decodeAddressLookupTable } from "../src/accounts/alt.ts";
import { base58Encode, concatBytes, encodeShortVec } from "../src/bytes.ts";
import { fixtureAccount, fixtureTx } from "./helpers.ts";

const TXS = [
  "coin1_launch",
  "coin1_buy",
  "coin1_sell",
  "coin1_collect",
  "coin1_complete",
  "coin1_migrate",
  "coin1_amm_sell",
  "coin1_transfer_collect",
  "coin2_launch_alt",
];
const altContents = () => {
  const alt = fixtureAccount("shared_alt");
  return { [alt.address]: decodeAddressLookupTable(alt.data).addresses };
};

test("decoded messages equal web3.js VersionedTransaction.deserialize for every fixture tx", () => {
  for (const name of TXS) {
    const fx = fixtureTx(name);
    const mine = decodeTransaction(fx.bytes);
    const w = VersionedTransaction.deserialize(fx.bytes);
    assert.equal(mine.message.version, w.version, name);
    assert.deepEqual(
      mine.message.staticAccountKeys,
      w.message.staticAccountKeys.map((k) => k.toBase58()),
      name
    );
    assert.equal(mine.message.recentBlockhash, w.message.recentBlockhash);
    assert.deepEqual(mine.message.header, w.message.header);
    assert.deepEqual(
      mine.message.compiledInstructions.map((c) => [c.programIdIndex, c.accountKeyIndexes, Array.from(c.data)]),
      w.message.compiledInstructions.map((c) => [c.programIdIndex, c.accountKeyIndexes, Array.from(c.data)])
    );
    assert.deepEqual(
      mine.message.addressTableLookups,
      w.message.addressTableLookups.map((l) => ({
        accountKey: l.accountKey.toBase58(),
        writableIndexes: l.writableIndexes,
        readonlyIndexes: l.readonlyIndexes,
      }))
    );
    assert.deepEqual(Buffer.from(mine.message.bytes), Buffer.from(w.message.serialize()));
    assert.equal(base58Encode(mine.signatures[0]), fx.signature, "first signature = tx id");
    assert.deepEqual(
      Buffer.from(messageHash(mine.message)),
      createHash("sha256").update(w.message.serialize()).digest()
    );
  }
});

test("ALT resolution reproduces the loaded addresses recorded by the RPC", () => {
  const fx = fixtureTx("coin2_launch_alt");
  assert.equal(fx.version, 0);
  const r = resolveTransaction(decodeTransaction(fx.bytes), altContents());
  const loaded = r.accounts.filter((a) => a.source !== "static");
  assert.deepEqual(
    loaded.filter((a) => a.isWritable).map((a) => a.address),
    fx.loadedAddresses.writable
  );
  assert.deepEqual(
    loaded.filter((a) => !a.isWritable).map((a) => a.address),
    fx.loadedAddresses.readonly
  );
  assert.ok(loaded.every((a) => !a.isSigner));
  assert.throws(() => resolveTransaction(decodeTransaction(fx.bytes)), /contents not provided/);
  const short = { [Object.keys(altContents())[0]]: Object.values(altContents())[0].slice(0, 3) };
  assert.throws(() => resolveTransaction(decodeTransaction(fx.bytes), short), /out of range/);
});

test("signatures of the real devnet txs verify; one flipped message byte invalidates them", () => {
  for (const name of TXS) {
    const statuses = signatureStatuses(decodeTransaction(fixtureTx(name).bytes));
    assert.ok(
      statuses.every((s) => s.status === "valid"),
      name
    );
  }
  const fx = fixtureTx("coin2_launch_alt");
  const sigs = signatureStatuses(decodeTransaction(fx.bytes));
  assert.equal(sigs.length, 2, "payer + vanity mint");
  const bad = Uint8Array.from(fx.bytes);
  bad[bad.length - 40] ^= 1;
  assert.ok(signatureStatuses(decodeTransaction(bad)).some((s) => s.status === "invalid"));
  const unsigned = Uint8Array.from(fx.bytes);
  unsigned.fill(0, 1, 65);
  assert.equal(signatureStatuses(decodeTransaction(unsigned))[0].status, "missing");
});

test("malformed transactions are rejected", () => {
  const fx = fixtureTx("coin1_buy");
  assert.throws(() => decodeTransaction(fx.bytes.subarray(0, fx.bytes.length - 1)), /truncated|trailing|past end/);
  assert.throws(() => decodeTransaction(concatBytes(fx.bytes, Uint8Array.of(0))), /trailing/);
  assert.throws(() => decodeTransaction(new Uint8Array(1233)), /max 1232/);
  const sigCount = Uint8Array.from(fx.bytes);
  const twoSigs = concatBytes(encodeShortVec(2), new Uint8Array(64), sigCount.subarray(1));
  assert.throws(() => decodeTransaction(twoSigs), /signature count|truncated|bad/);
  const v1 = Uint8Array.from(fx.bytes);
  v1[65] = 0x81; // message version 1
  assert.throws(() => decodeTransaction(v1), (e: unknown) => e instanceof UnsupportedTxVersionError && e.version === 1);
});

const isVersion = (v: number) => (e: unknown) => e instanceof UnsupportedTxVersionError && e.version === v;

test("O2: a real mainnet v1 transaction (first byte 0x81) is refused with the typed version error", () => {
  const f = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mainnet", "tx_v1_pump_trade.json"), "utf8")
  ) as { transaction: string; version: number; rpcErrorWithVersion0: { code: number } };
  const bytes = fromBase64(f.transaction);
  assert.equal(f.version, 1);
  assert.equal(bytes[0], 0x81, "the v1 envelope starts with 0x81");
  assert.equal(f.rpcErrorWithVersion0.code, -32015, "maxSupportedTransactionVersion 0 answers -32015");
  assert.equal(wireTxVersion(bytes), 1);
  assert.throws(() => decodeTransaction(bytes), isVersion(1));
  // the version is reported before the size: a larger v1 transaction still names its version
  const big = new Uint8Array(4096);
  big[0] = 0x82;
  assert.throws(() => decodeTransaction(big), isVersion(2));
  // a bare v1 message (the bytes a wallet signs) is refused the same way
  assert.throws(() => decodeMessage(Uint8Array.of(0x81, 1, 0, 0)), isVersion(1));
  // legacy and v0 fixtures keep decoding and report their version
  assert.equal(wireTxVersion(fixtureTx("coin1_buy").bytes), fixtureTx("coin1_buy").version);
  assert.equal(wireTxVersion(fixtureTx("coin2_launch_alt").bytes), 0);
  assert.equal(wireTxVersion(new Uint8Array(0)), null);
});
