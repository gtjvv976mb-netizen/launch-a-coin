import { test } from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  base58Decode,
  base58Encode,
  ByteReader,
  ByteWriter,
  decodeShortVec,
  encodeShortVec,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
} from "../src/bytes.ts";
import { findProgramAddress, isAddress, isOnCurve, toAddress } from "../src/address.ts";
import { associatedTokenAddress } from "../src/pda.ts";
import { rng } from "./helpers.ts";

test("base58 matches bs58 on random inputs, including leading zero bytes", () => {
  const r = rng(1);
  for (let i = 0; i < 3000; i++) {
    const len = r.u32() % 70;
    const b = r.bytes(len);
    const zeros = r.u32() % 4;
    for (let z = 0; z < Math.min(zeros, len); z++) b[z] = 0;
    const enc = base58Encode(b);
    assert.equal(enc, bs58.encode(b));
    assert.deepEqual(base58Decode(enc), Uint8Array.from(b));
  }
  assert.throws(() => base58Decode("0OIl"));
});

test("base64 and hex round-trip like Buffer", () => {
  const r = rng(2);
  for (let i = 0; i < 500; i++) {
    const b = r.bytes(r.u32() % 300);
    assert.equal(toBase64(b), Buffer.from(b).toString("base64"));
    assert.deepEqual(fromBase64(Buffer.from(b).toString("base64")), b);
    assert.deepEqual(fromHex(toHex(b)), b);
  }
});

test("shortvec encodes like web3.js and rejects non-canonical forms", () => {
  for (const n of [0, 1, 127, 128, 255, 256, 16383, 16384, 65535]) {
    const enc = encodeShortVec(n);
    assert.deepEqual(decodeShortVec(enc, 0), [n, enc.length]);
  }
  assert.deepEqual(Array.from(encodeShortVec(128)), [0x80, 0x01]);
  assert.throws(() => decodeShortVec(Uint8Array.of(0x80, 0x00), 0));
});

test("writer/reader round-trip and range checks", () => {
  const w = new ByteWriter()
    .u8(7)
    .u16(65535)
    .u32(4294967295)
    .u64(18446744073709551615n)
    .i64(-5n)
    .string("héllo")
    .bool(true);
  w.i128(-2n);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), 7);
  assert.equal(r.u16(), 65535);
  assert.equal(r.u32(), 4294967295);
  assert.equal(r.u64(), 18446744073709551615n);
  assert.equal(r.i64(), -5n);
  assert.equal(r.string(), "héllo");
  assert.equal(r.bool(), true);
  assert.equal(r.i128(), -2n);
  assert.equal(r.remaining, 0);
  assert.throws(() => new ByteWriter().u64(-1n));
  assert.throws(() => new ByteWriter().u8(256));
  assert.throws(() => new ByteReader(new Uint8Array(3)).u32());
});

test("isOnCurve agrees with web3.js on random bytes and real keys", () => {
  const r = rng(3);
  let on = 0;
  for (let i = 0; i < 2000; i++) {
    const b = i % 2 ? r.bytes(32) : Keypair.generate().publicKey.toBytes();
    const mine = isOnCurve(b);
    assert.equal(mine, PublicKey.isOnCurve(b));
    if (mine) on++;
  }
  assert.ok(on > 1000 && on < 2000);
});

test("findProgramAddress equals web3.js findProgramAddressSync", () => {
  const r = rng(4);
  for (let i = 0; i < 300; i++) {
    const program = Keypair.generate().publicKey;
    const seeds = [Buffer.from("card"), Buffer.from(r.bytes(r.u32() % 33))];
    const [a, bump] = findProgramAddress(seeds, program.toBase58());
    const [b, bumpB] = PublicKey.findProgramAddressSync(seeds, program);
    assert.equal(a, b.toBase58());
    assert.equal(bump, bumpB);
  }
});

test("associated token addresses equal spl-token's (on- and off-curve owners, both token programs)", () => {
  for (let i = 0; i < 100; i++) {
    const owner =
      i % 2 ? Keypair.generate().publicKey : PublicKey.findProgramAddressSync([Buffer.from([i])], TOKEN_PROGRAM_ID)[0];
    const mint = Keypair.generate().publicKey;
    for (const prog of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      assert.equal(
        associatedTokenAddress(owner.toBase58(), mint.toBase58(), prog.toBase58()),
        getAssociatedTokenAddressSync(mint, owner, true, prog).toBase58()
      );
    }
  }
});

test("address helpers accept PublicKey-like inputs and reject bad lengths", () => {
  const k = Keypair.generate().publicKey;
  assert.equal(toAddress(k), k.toBase58());
  assert.equal(toAddress(k.toBytes()), k.toBase58());
  assert.ok(isAddress(k.toBase58()));
  assert.ok(!isAddress("abc"));
  assert.throws(() => toAddress(new Uint8Array(31)));
});
