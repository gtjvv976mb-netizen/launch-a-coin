// Test-only builders for wallet-returned launch messages, dependency-free so the app's browser tests use them too.
// They reproduce what a real Phantom wallet-first signing did to a two-signer v0 transaction (mainnet 4WC4bx…,
// 2026-10-28): Lighthouse assertions appended after every app instruction, the message recompiled with the Lighthouse
// program key inserted mid-way through the readonly section, so later indexes shift. Nothing here signs or sends.
import { LIGHTHOUSE_PROGRAM_ID, decodeV0Message, type MessageInstruction, type MessageLookup, type MessageView } from "../src/wallet-guards.ts";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function keyBytes(value: string): Uint8Array {
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const bytes: number[] = [];
  while (n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of value) { if (c !== "1") break; bytes.unshift(0); }
  if (bytes.length !== 32) throw new Error("Not a 32-byte key");
  return Uint8Array.from(bytes);
}
const shortVec = (n: number) => n < 0x80 ? [n] : n < 0x4000 ? [(n & 0x7f) | 0x80, n >> 7] : [(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14];
export type MessageParts = { header: MessageView["header"]; staticKeys: string[]; blockhash: string; instructions: MessageInstruction[]; lookups: MessageLookup[] };
export function encodeV0Message(m: MessageParts): Uint8Array {
  return Uint8Array.from([0x80, m.header.required, m.header.readonlySigned, m.header.readonlyUnsigned,
    ...shortVec(m.staticKeys.length), ...m.staticKeys.flatMap(key => [...keyBytes(key)]), ...keyBytes(m.blockhash),
    ...shortVec(m.instructions.length), ...m.instructions.flatMap(ix => [ix.program, ...shortVec(ix.accounts.length), ...ix.accounts, ...shortVec(ix.data.length), ...ix.data]),
    ...shortVec(m.lookups.length), ...m.lookups.flatMap(l => [...keyBytes(l.table), ...shortVec(l.writable.length), ...l.writable, ...shortVec(l.readonly.length), ...l.readonly])]);
}
/** An unsigned transaction around a v0 message, with one empty slot per required signer. */
export const unsignedTransaction = (message: Uint8Array) => Uint8Array.from([message[1], ...new Uint8Array(64 * message[1]), ...message]);
export const messageOf = (transaction: Uint8Array) => transaction.slice(1 + 64 * transaction[0]);

const u64 = (value: bigint) => Array.from({ length: 8 }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn));
/** Phantom's payer guard: AssertAccountInfoMulti, Lamports >= min, KnownOwner == System, DataLength == 0 (26 bytes). */
export const payerGuardData = (minLamports = 0n) => Uint8Array.from([6, 4, 3, 0, ...u64(minLamports), 4, 3, 0, 0, 1, ...u64(0n), 0]);
/** Phantom's token-account guard: AssertTokenAccountMulti, Amount >= min, no delegate, owner derived (27 bytes). */
export const tokenGuardData = (minAmount = 0n) => Uint8Array.from([10, 4, 4, 2, ...u64(minAmount), 4, 3, 0, 0, 6, ...u64(0n), 5, 8]);

export type Guard = { target: string; data: Uint8Array; program?: string; extraAccounts?: string[] };
/**
 * The message as Phantom returned it: `program` (Lighthouse unless a test says otherwise) inserted as a static key in
 * the middle of the readonly-unsigned section, every index remapped, then the assertions appended (or placed at
 * `at`). `newKeys` become extra readonly-unsigned keys; `writableProgram` puts the program key among writable keys.
 */
export function phantomGuarded(message: Uint8Array, guards: Guard[], options: { blockhash?: string; at?: number; newKeys?: string[]; writableProgram?: boolean } = {}): Uint8Array {
  const view = decodeV0Message(message);
  const program = guards[0]?.program ?? LIGHTHOUSE_PROGRAM_ID;
  const statics = view.staticKeys.length, readonlyStart = statics - view.header.readonlyUnsigned;
  const insertAt = options.writableProgram ? view.header.required : readonlyStart + Math.floor(view.header.readonlyUnsigned / 2);
  const added = [program, ...(options.newKeys ?? [])];
  const staticKeys = [...view.staticKeys.slice(0, insertAt), ...added, ...view.staticKeys.slice(insertAt)];
  const remap = (index: number) => index < insertAt ? index : index + added.length;
  const keys = [...staticKeys, ...view.keys.slice(statics)];
  const indexOf = (key: string) => { const at = keys.indexOf(key); if (at < 0) throw new Error(`No key ${key}`); return at; };
  const appended = guards.map(guard => ({ program: insertAt, accounts: [guard.target, ...(guard.extraAccounts ?? [])].map(indexOf), data: guard.data }));
  const planned = view.instructions.map(ix => ({ program: remap(ix.program), accounts: ix.accounts.map(remap), data: ix.data }));
  const instructions = options.at === undefined ? [...planned, ...appended] : [...planned.slice(0, options.at), ...appended, ...planned.slice(options.at)];
  return encodeV0Message({ header: { ...view.header, readonlyUnsigned: view.header.readonlyUnsigned + (options.writableProgram ? 0 : added.length) },
    staticKeys, blockhash: options.blockhash ?? view.blockhash, instructions, lookups: view.lookups });
}
/** The same decompiled message with its readonly-unsigned static keys in reverse order (a pure recompile). */
export function reordered(message: Uint8Array): Uint8Array {
  const view = decodeV0Message(message), statics = view.staticKeys.length, start = statics - view.header.readonlyUnsigned;
  const order = [...view.staticKeys.keys()].map(i => i < start ? i : statics - 1 - (i - start));
  const staticKeys = order.map(i => view.staticKeys[i]), remap = (index: number) => index < statics ? order.indexOf(index) : index;
  return encodeV0Message({ ...view, staticKeys, instructions: view.instructions.map(ix => ({ program: remap(ix.program), accounts: ix.accounts.map(remap), data: ix.data })) });
}
