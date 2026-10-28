// v0 message compiler and transaction serializer without web3.js (refs/chain/m3-contract.md §6, §8).
// The chain Worker builds every transaction with these (no web3.js or Anchor at runtime: Workers Free 10 ms CPU),
// the M3 harness checks them byte for byte against web3.js `TransactionMessage.compileToV0Message`.
//
// Owner: worker:core (signatures frozen by the contract). Rules:
//   - same account ordering as web3.js: fee payer first, then writable signers, readonly signers, writable
//     non-signers, readonly non-signers, each group in first-seen order (payer, then per instruction its program id
//     followed by its accounts); keys found in a supplied lookup table move to the table (writable then readonly
//     indexes) unless they are signers or invoked program ids (those stay static);
//   - lookup tables are used in the order given, and only addresses inside the first `usableLength` entries
//     (the verifier resolves ALT A/B from the SDK's fixed 38-entry list);
//   - output decodes with ./wire.ts decodeTransaction and equals web3.js output for the same inputs
//     (test/compile.test.ts).
import { toAddress, toAddressBytes } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import { base58Decode, concatBytes, encodeShortVec } from "../bytes.ts";
import type { Instruction } from "../instruction.ts";
import { decodeTransaction } from "./wire.ts";

export interface LookupTableInput {
  address: AddressLike;
  /** Table contents in order (for the MintDex ALTs: mintdexAltAddresses({ treasury })). */
  addresses: readonly AddressLike[];
  /** Only entries below this index may be referenced (default: all). */
  usableLength?: number;
}

export interface CompileV0Params {
  payer: AddressLike;
  instructions: Instruction[];
  recentBlockhash: string;
  lookupTables?: LookupTableInput[];
}

export interface CompiledV0Message {
  /** The serialized v0 message (what every signature covers). */
  bytes: Uint8Array;
  staticAccountKeys: Address[];
  /** Required signers in signature-slot order (slot 0 = fee payer). */
  signers: Address[];
  /** Lookup tables the message references. */
  lookupTablesUsed: Address[];
}

interface KeyMeta {
  isSigner: boolean;
  isWritable: boolean;
  isInvoked: boolean;
}

/** Compiles a v0 message (web3.js compileToV0Message semantics). */
export function compileV0Message(p: CompileV0Params): CompiledV0Message {
  const payer = toAddress(p.payer);
  // 1. key metas in first-seen order (Map keeps insertion order, like web3.js CompiledKeys)
  const metas = new Map<Address, KeyMeta>();
  const meta = (a: Address): KeyMeta => {
    let m = metas.get(a);
    if (!m) {
      m = { isSigner: false, isWritable: false, isInvoked: false };
      metas.set(a, m);
    }
    return m;
  };
  const pm = meta(payer);
  pm.isSigner = true;
  pm.isWritable = true;
  for (const ix of p.instructions) {
    meta(ix.programId).isInvoked = true;
    for (const am of ix.accounts) {
      const m = meta(am.address);
      m.isSigner ||= am.isSigner;
      m.isWritable ||= am.isWritable;
    }
  }

  // 2. move lookup-table keys out of the static list (writable first, then readonly), table by table
  const lookups: { accountKey: Address; writableIndexes: number[]; readonlyIndexes: number[] }[] = [];
  const loadedWritable: Address[] = [];
  const loadedReadonly: Address[] = [];
  for (const t of p.lookupTables ?? []) {
    const entries = t.addresses.map(toAddress);
    const usable = Math.min(entries.length, t.usableLength ?? entries.length);
    const indexOf = new Map<Address, number>();
    for (let i = 0; i < usable; i++) if (!indexOf.has(entries[i])) indexOf.set(entries[i], i);
    const drain = (writable: boolean): [number[], Address[]] => {
      const idx: number[] = [];
      const keys: Address[] = [];
      for (const [address, m] of metas) {
        if (m.isSigner || m.isInvoked || m.isWritable !== writable) continue;
        const i = indexOf.get(address);
        if (i === undefined) continue;
        if (i >= 256) throw new Error("Max lookup table index exceeded");
        idx.push(i);
        keys.push(address);
        metas.delete(address);
      }
      return [idx, keys];
    };
    const [writableIndexes, w] = drain(true);
    const [readonlyIndexes, r] = drain(false);
    if (writableIndexes.length === 0 && readonlyIndexes.length === 0) continue;
    lookups.push({ accountKey: toAddress(t.address), writableIndexes, readonlyIndexes });
    loadedWritable.push(...w);
    loadedReadonly.push(...r);
  }

  // 3. static keys and header
  const entries = [...metas.entries()];
  if (entries.length > 256) throw new Error("Max static account keys length exceeded");
  const ws = entries.filter(([, m]) => m.isSigner && m.isWritable).map(([a]) => a);
  const rs = entries.filter(([, m]) => m.isSigner && !m.isWritable).map(([a]) => a);
  const wn = entries.filter(([, m]) => !m.isSigner && m.isWritable).map(([a]) => a);
  const rn = entries.filter(([, m]) => !m.isSigner && !m.isWritable).map(([a]) => a);
  if (ws[0] !== payer) throw new Error("Expected first writable signer key to be the fee payer");
  const staticAccountKeys = [...ws, ...rs, ...wn, ...rn];
  const header = [ws.length + rs.length, rs.length, rn.length];

  // 4. compile instructions against static + loaded keys
  const all = [...staticAccountKeys, ...loadedWritable, ...loadedReadonly];
  if (all.length > 256) throw new Error("Account index overflow encountered during compilation");
  const index = new Map<Address, number>();
  all.forEach((a, i) => index.set(a, i));
  const find = (a: Address): number => {
    const i = index.get(a);
    if (i === undefined) throw new Error("Encountered an unknown instruction account key during compilation");
    return i;
  };

  // 5. serialize (MessageV0.serialize layout)
  const blockhash = base58Decode(p.recentBlockhash);
  if (blockhash.length !== 32) throw new Error("recentBlockhash must be 32 bytes of base58");
  const parts: Uint8Array[] = [Uint8Array.of(0x80, header[0], header[1], header[2])];
  parts.push(encodeShortVec(staticAccountKeys.length));
  for (const k of staticAccountKeys) parts.push(toAddressBytes(k));
  parts.push(blockhash);
  parts.push(encodeShortVec(p.instructions.length));
  for (const ix of p.instructions) {
    const accountIdx = ix.accounts.map((m) => find(m.address));
    parts.push(Uint8Array.of(find(ix.programId)));
    parts.push(encodeShortVec(accountIdx.length), Uint8Array.from(accountIdx));
    parts.push(encodeShortVec(ix.data.length), ix.data);
  }
  parts.push(encodeShortVec(lookups.length));
  for (const l of lookups) {
    parts.push(toAddressBytes(l.accountKey));
    parts.push(encodeShortVec(l.writableIndexes.length), Uint8Array.from(l.writableIndexes));
    parts.push(encodeShortVec(l.readonlyIndexes.length), Uint8Array.from(l.readonlyIndexes));
  }
  return {
    bytes: concatBytes(...parts),
    staticAccountKeys,
    signers: staticAccountKeys.slice(0, header[0]),
    lookupTablesUsed: lookups.map((l) => l.accountKey),
  };
}

/** Wire bytes: shortvec(signature count) + 64-byte signatures (zeros for missing) + message. */
export function serializeTransaction(message: Uint8Array, signatures: ReadonlyArray<Uint8Array | null>): Uint8Array {
  const parts: Uint8Array[] = [encodeShortVec(signatures.length)];
  for (const s of signatures) {
    if (s === null) parts.push(new Uint8Array(64));
    else if (s.length !== 64) throw new Error("a signature must be 64 bytes");
    else parts.push(s);
  }
  parts.push(message);
  return concatBytes(...parts);
}

/** Returns a copy of `tx` with `signature` placed in the slot of `signer` (throws if `signer` is not required). */
export function withSignature(tx: Uint8Array, signer: AddressLike, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error("a signature must be 64 bytes");
  const decoded = decodeTransaction(tx);
  const who = toAddress(signer);
  const n = decoded.message.header.numRequiredSignatures;
  const slot = decoded.message.staticAccountKeys.slice(0, n).indexOf(who);
  if (slot < 0) throw new Error(`${who} is not a required signer of this transaction`);
  const out = Uint8Array.from(tx);
  // signatures start right after the shortvec count (1 byte for counts below 128)
  const offset = encodeShortVec(decoded.signatures.length).length + 64 * slot;
  out.set(signature, offset);
  return out;
}
