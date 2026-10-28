// Strict decoder for serialized Solana transactions (legacy and v0) with address-lookup-table resolution. Newer
// versions (v1, first byte 0x81) are recognised and refused with UnsupportedTxVersionError.
// The browser runs it on the bytes the chain Worker returns, before asking the wallet to sign (R21).
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toAddress, toAddressBytes } from "../address.ts";
import type { Address } from "../address.ts";
import { base58Encode, decodeShortVec } from "../bytes.ts";
import type { AccountMeta, Instruction } from "../instruction.ts";

export const PACKET_DATA_SIZE = 1232;

/**
 * A transaction or message in a format newer than v0 (O2, refs/mainnet/design-compat.md §2). Mainnet already carries
 * v1 transactions (their wire bytes start with 0x81); MintDex builds and accepts v0 only, so a wallet that re-encodes
 * a signed transaction as v1 gets this typed error (the chain API answers TX_VERSION_UNSUPPORTED) instead of a
 * generic decode failure.
 */
export class UnsupportedTxVersionError extends Error {
  readonly version: number;
  constructor(version: number) {
    super(`unsupported transaction version ${version} (MintDex accepts legacy and v0)`);
    this.name = "UnsupportedTxVersionError";
    this.version = version;
  }
}

/**
 * The version a serialized transaction announces before anything else is parsed: "legacy" / 0 for the formats this
 * decoder reads, N >= 1 for the newer envelope whose first byte is 0x80 | N. A legacy or v0 transaction starts with
 * its signature count (a compact-u16), and 128 or more signatures can never fit in 1,232 bytes, so a first byte of
 * 0x80 or more is always a version prefix. Returns null for an empty buffer.
 */
export function wireTxVersion(bytes: Uint8Array): "legacy" | number | null {
  const first = bytes[0];
  if (first === undefined) return null;
  if (first & 0x80) return first & 0x7f;
  const sigs = first;
  const msgFirst = bytes[1 + 64 * sigs];
  if (msgFirst === undefined) return null;
  return msgFirst & 0x80 ? msgFirst & 0x7f : "legacy";
}

export interface MessageHeader {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
}

export interface CompiledInstruction {
  programIdIndex: number;
  accountKeyIndexes: number[];
  data: Uint8Array;
}

export interface AddressTableLookup {
  accountKey: Address;
  writableIndexes: number[];
  readonlyIndexes: number[];
}

export interface DecodedMessage {
  version: "legacy" | 0;
  header: MessageHeader;
  staticAccountKeys: Address[];
  recentBlockhash: string;
  compiledInstructions: CompiledInstruction[];
  addressTableLookups: AddressTableLookup[];
  /** The exact serialized message: the bytes every signature covers. */
  bytes: Uint8Array;
}

export interface DecodedTransaction {
  signatures: Uint8Array[];
  message: DecodedMessage;
  byteLength: number;
}

class Cursor {
  o = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  byte(): number {
    if (this.o >= this.b.length) throw new Error("transaction truncated");
    return this.b[this.o++];
  }
  take(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error("transaction truncated");
    const out = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return out;
  }
  len(): number {
    const [v, used] = decodeShortVec(this.b, this.o);
    this.o += used;
    return v;
  }
}

/** Decodes a serialized message (legacy or v0). Throws on any malformed or trailing byte. */
export function decodeMessage(bytes: Uint8Array): DecodedMessage {
  const c = new Cursor(bytes);
  let version: "legacy" | 0 = "legacy";
  const first = bytes[0];
  if (first === undefined) throw new Error("empty message");
  if (first & 0x80) {
    const v = first & 0x7f;
    if (v !== 0) throw new UnsupportedTxVersionError(v);
    version = 0;
    c.byte();
  }
  const header: MessageHeader = {
    numRequiredSignatures: c.byte(),
    numReadonlySignedAccounts: c.byte(),
    numReadonlyUnsignedAccounts: c.byte(),
  };
  const nKeys = c.len();
  const staticAccountKeys: Address[] = [];
  for (let i = 0; i < nKeys; i++) staticAccountKeys.push(base58Encode(c.take(32)));
  if (new Set(staticAccountKeys).size !== staticAccountKeys.length) throw new Error("duplicate static account key");
  if (header.numRequiredSignatures === 0 || header.numRequiredSignatures > nKeys) throw new Error("bad signer count");
  if (header.numReadonlySignedAccounts >= header.numRequiredSignatures) throw new Error("fee payer must be writable");
  if (header.numReadonlyUnsignedAccounts > nKeys - header.numRequiredSignatures) throw new Error("bad readonly count");
  const recentBlockhash = base58Encode(c.take(32));
  const nIx = c.len();
  const compiledInstructions: CompiledInstruction[] = [];
  for (let i = 0; i < nIx; i++) {
    const programIdIndex = c.byte();
    const nAcc = c.len();
    const accountKeyIndexes: number[] = [];
    for (let j = 0; j < nAcc; j++) accountKeyIndexes.push(c.byte());
    const dataLen = c.len();
    compiledInstructions.push({ programIdIndex, accountKeyIndexes, data: Uint8Array.from(c.take(dataLen)) });
  }
  const addressTableLookups: AddressTableLookup[] = [];
  if (version === 0) {
    const nLookups = c.len();
    for (let i = 0; i < nLookups; i++) {
      const accountKey = base58Encode(c.take(32));
      const nw = c.len();
      const writableIndexes: number[] = [];
      for (let j = 0; j < nw; j++) writableIndexes.push(c.byte());
      const nr = c.len();
      const readonlyIndexes: number[] = [];
      for (let j = 0; j < nr; j++) readonlyIndexes.push(c.byte());
      if (nw + nr === 0) throw new Error("empty lookup");
      addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
    }
  }
  if (c.o !== bytes.length) throw new Error(`${bytes.length - c.o} trailing bytes after message`);
  const totalKeys =
    nKeys + addressTableLookups.reduce((s, l) => s + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  if (totalKeys > 256) throw new Error("too many account keys");
  for (const ix of compiledInstructions) {
    if (ix.programIdIndex >= nKeys) throw new Error("program id must be a static key");
    if (ix.programIdIndex === 0) throw new Error("fee payer cannot be a program");
    for (const k of ix.accountKeyIndexes) if (k >= totalKeys) throw new Error("account index out of range");
  }
  return {
    version,
    header,
    staticAccountKeys,
    recentBlockhash,
    compiledInstructions,
    addressTableLookups,
    bytes: Uint8Array.from(bytes),
  };
}

/** Decodes a full serialized transaction (signatures + message). */
export function decodeTransaction(bytes: Uint8Array): DecodedTransaction {
  // the newer envelope (first byte 0x80 | version) is recognised before the size check: a v1 transaction may be
  // larger than 1,232 bytes, and the caller should learn the version, not a size
  if (bytes.length > 0 && bytes[0] & 0x80) throw new UnsupportedTxVersionError(bytes[0] & 0x7f);
  if (bytes.length > PACKET_DATA_SIZE)
    throw new Error(`transaction is ${bytes.length} bytes (max ${PACKET_DATA_SIZE})`);
  const c = new Cursor(bytes);
  const n = c.len();
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < n; i++) signatures.push(Uint8Array.from(c.take(64)));
  const message = decodeMessage(bytes.subarray(c.o));
  if (n !== message.header.numRequiredSignatures) {
    throw new Error(`signature count ${n} != required ${message.header.numRequiredSignatures}`);
  }
  return { signatures, message, byteLength: bytes.length };
}

export interface ResolvedAccount extends AccountMeta {
  /** Where the key came from: the static list, or a lookup table and index. */
  source: "static" | { table: Address; index: number };
}

export interface ResolvedTransaction {
  decoded: DecodedTransaction;
  feePayer: Address;
  signers: Address[];
  accounts: ResolvedAccount[];
  instructions: Instruction[];
}

export type LookupTableContents = Record<string, readonly string[]> | Map<string, readonly string[]>;

const lookup = (tables: LookupTableContents | undefined, key: string) =>
  tables instanceof Map ? tables.get(key) : tables?.[key];

/**
 * Resolves every account (static + lookup tables) with its message-level signer/writable flags and expands
 * the compiled instructions. Throws when a referenced lookup table is not supplied or an index is out of range.
 */
export function resolveTransaction(
  decoded: DecodedTransaction,
  lookupTables?: LookupTableContents
): ResolvedTransaction {
  const m = decoded.message;
  const h = m.header;
  const nStatic = m.staticAccountKeys.length;
  const accounts: ResolvedAccount[] = m.staticAccountKeys.map((address, i) => {
    const isSigner = i < h.numRequiredSignatures;
    const isWritable = isSigner
      ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : i < nStatic - h.numReadonlyUnsignedAccounts;
    return { address, isSigner, isWritable, source: "static" };
  });
  const loadedWritable: ResolvedAccount[] = [];
  const loadedReadonly: ResolvedAccount[] = [];
  for (const l of m.addressTableLookups) {
    const table = lookup(lookupTables, l.accountKey);
    if (!table) throw new Error(`lookup table ${l.accountKey} contents not provided`);
    const pick = (index: number, isWritable: boolean): ResolvedAccount => {
      if (index >= table.length) throw new Error(`lookup index ${index} out of range for ${l.accountKey}`);
      return { address: toAddress(table[index]), isSigner: false, isWritable, source: { table: l.accountKey, index } };
    };
    l.writableIndexes.forEach((i) => loadedWritable.push(pick(i, true)));
    l.readonlyIndexes.forEach((i) => loadedReadonly.push(pick(i, false)));
  }
  accounts.push(...loadedWritable, ...loadedReadonly);
  if (new Set(accounts.map((a) => a.address)).size !== accounts.length) {
    throw new Error("an account appears twice (static and lookup table)");
  }
  const instructions: Instruction[] = m.compiledInstructions.map((ix) => ({
    programId: accounts[ix.programIdIndex].address,
    accounts: ix.accountKeyIndexes.map((k) => ({
      address: accounts[k].address,
      isSigner: accounts[k].isSigner,
      isWritable: accounts[k].isWritable,
    })),
    data: ix.data,
  }));
  return {
    decoded,
    feePayer: accounts[0].address,
    signers: accounts.slice(0, h.numRequiredSignatures).map((a) => a.address),
    accounts,
    instructions,
  };
}

/** sha256 of the message bytes (what the chain Worker stores at prepare and compares at finalize). */
export const messageHash = (m: DecodedMessage): Uint8Array => sha256(m.bytes);

export type SignatureStatus = "valid" | "missing" | "invalid";

/** Checks each required signature against its signer key; an all-zero signature counts as missing. */
export function signatureStatuses(tx: DecodedTransaction): { signer: Address; status: SignatureStatus }[] {
  return tx.signatures.map((sig, i) => {
    const signer = tx.message.staticAccountKeys[i];
    if (sig.every((b) => b === 0)) return { signer, status: "missing" as const };
    let ok = false;
    try {
      ok = ed25519.verify(sig, tx.message.bytes, toAddressBytes(signer));
    } catch {
      ok = false;
    }
    return { signer, status: ok ? ("valid" as const) : ("invalid" as const) };
  });
}
