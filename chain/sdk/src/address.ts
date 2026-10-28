// Addresses are base58 strings throughout the SDK (JSON-safe, comparable with ===). Inputs also accept
// 32 raw bytes or anything with toBase58() (a web3.js PublicKey), without importing web3.js.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58Decode, base58Encode, concatBytes, toHex, utf8Encode } from "./bytes.ts";

export type Address = string;
export type AddressLike = Address | Uint8Array | { toBase58(): string };

export function toAddressBytes(a: AddressLike): Uint8Array {
  let bytes: Uint8Array;
  if (typeof a === "string") bytes = base58Decode(a);
  else if (a instanceof Uint8Array) bytes = a;
  else if (a && typeof (a as { toBase58?: unknown }).toBase58 === "function") {
    bytes = base58Decode((a as { toBase58(): string }).toBase58());
  } else throw new TypeError("not an address");
  if (bytes.length !== 32) throw new Error(`address must be 32 bytes, got ${bytes.length}`);
  return bytes;
}

/** Canonical base58 form of any address input; throws when it is not 32 bytes. */
export function toAddress(a: AddressLike): Address {
  if (typeof a === "string") {
    toAddressBytes(a);
    return a;
  }
  return base58Encode(toAddressBytes(a));
}

export function isAddress(a: unknown): a is Address {
  if (typeof a !== "string") return false;
  try {
    return base58Decode(a).length === 32 && base58Encode(base58Decode(a)) === a;
  } catch {
    return false;
  }
}

export const sameAddress = (a: AddressLike, b: AddressLike): boolean => toAddress(a) === toAddress(b);

/** Same semantics as web3.js `PublicKey.isOnCurve` (noble ed25519 point decompression). */
export function isOnCurve(a: AddressLike): boolean {
  try {
    ed25519.Point.fromHex(toAddressBytes(a));
    return true;
  } catch {
    return false;
  }
}

export type Seed = Uint8Array | string;
const seedBytes = (s: Seed): Uint8Array => (typeof s === "string" ? utf8Encode(s) : s);
const PDA_MARKER = utf8Encode("ProgramDerivedAddress");
const MAX_SEED_LENGTH = 32;
const MAX_SEEDS = 16;

export function createProgramAddress(seeds: Seed[], programId: AddressLike): Address {
  if (seeds.length > MAX_SEEDS) throw new Error("too many seeds");
  const parts = seeds.map(seedBytes);
  for (const p of parts) if (p.length > MAX_SEED_LENGTH) throw new Error("seed longer than 32 bytes");
  const hash = sha256(concatBytes(...parts, toAddressBytes(programId), PDA_MARKER));
  if (isOnCurve(hash)) throw new Error("invalid seeds: address is on the curve");
  return base58Encode(hash);
}

const pdaCache = new Map<string, [Address, number]>();
const PDA_CACHE_MAX = 4096;

/** web3.js `findProgramAddressSync`: bump searched from 255 down. Returns [address, bump]. */
export function findProgramAddress(seeds: Seed[], programId: AddressLike): [Address, number] {
  const parts = seeds.map(seedBytes);
  const key = toAddress(programId) + ":" + parts.map(toHex).join(",");
  const hit = pdaCache.get(key);
  if (hit) return hit;
  for (let bump = 255; bump >= 0; bump--) {
    try {
      const address = createProgramAddress([...parts, Uint8Array.of(bump)], programId);
      const out: [Address, number] = [address, bump];
      if (pdaCache.size >= PDA_CACHE_MAX) pdaCache.clear();
      pdaCache.set(key, out);
      return out;
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("invalid seeds")) throw e;
    }
  }
  throw new Error("no viable bump");
}

export const pda = (seeds: Seed[], programId: AddressLike): Address => findProgramAddress(seeds, programId)[0];

/** Raw 32 bytes of an address, for use as a PDA seed. */
export const seedOf = (a: AddressLike): Uint8Array => toAddressBytes(a);
