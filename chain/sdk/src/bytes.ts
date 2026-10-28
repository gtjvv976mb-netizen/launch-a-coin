// Byte helpers with no runtime dependencies: base58, hex, little-endian integers, a borsh-style
// writer/reader and Solana's compact-u16 ("shortvec"). Everything works on Uint8Array, so the same
// code runs in Node, browsers and Workers (Buffer is a Uint8Array subclass and is accepted too).

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58_ALPHABET.length; i++) B58_MAP[B58_ALPHABET[i]] = i;

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Repeated division of a base-256 big number by 58, digits collected little-endian.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < text.length; i++) {
    const value = B58_MAP[text[i]];
    if (value === undefined) throw new Error(`invalid base58 character ${JSON.stringify(text[i])}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i];
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    const v = BASE64_ALPHABET.indexOf(ch === "-" ? "+" : ch === "_" ? "/" : ch);
    if (v < 0) throw new Error("invalid base64");
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[n & 63] : "=";
  }
  return out;
}

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export const utf8Encode = (text: string): Uint8Array => encoder.encode(text);
/** Strict UTF-8 decode: throws on invalid sequences instead of inserting U+FFFD. */
export const utf8Decode = (bytes: Uint8Array): string => strictDecoder.decode(bytes);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function need(b: Uint8Array, offset: number, len: number) {
  if (offset < 0 || offset + len > b.length) {
    throw new RangeError(`read of ${len} bytes at offset ${offset} past end (${b.length})`);
  }
}

export function readU8(b: Uint8Array, o: number): number {
  need(b, o, 1);
  return b[o];
}
export function readU16(b: Uint8Array, o: number): number {
  need(b, o, 2);
  return view(b).getUint16(o, true);
}
export function readU32(b: Uint8Array, o: number): number {
  need(b, o, 4);
  return view(b).getUint32(o, true);
}
export function readI32(b: Uint8Array, o: number): number {
  need(b, o, 4);
  return view(b).getInt32(o, true);
}
export function readU64(b: Uint8Array, o: number): bigint {
  need(b, o, 8);
  return view(b).getBigUint64(o, true);
}
export function readI64(b: Uint8Array, o: number): bigint {
  need(b, o, 8);
  return view(b).getBigInt64(o, true);
}
export function readU128(b: Uint8Array, o: number): bigint {
  return readU64(b, o) | (readU64(b, o + 8) << 64n);
}
export function readI128(b: Uint8Array, o: number): bigint {
  const u = readU128(b, o);
  return u >= 1n << 127n ? u - (1n << 128n) : u;
}

export const U64_MAX = (1n << 64n) - 1n;
export const I64_MIN = -(1n << 63n);
export const I64_MAX = (1n << 63n) - 1n;

function checkRange(value: bigint, min: bigint, max: bigint, what: string) {
  if (typeof value !== "bigint") throw new TypeError(`${what} must be a bigint`);
  if (value < min || value > max) throw new RangeError(`${what} out of range: ${value}`);
}

/** Borsh-compatible little-endian writer. */
export class ByteWriter {
  private chunks: Uint8Array[] = [];

  bytes(b: Uint8Array): this {
    this.chunks.push(Uint8Array.from(b));
    return this;
  }
  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new RangeError(`u8 out of range: ${v}`);
    return this.bytes(Uint8Array.of(v));
  }
  bool(v: boolean): this {
    if (typeof v !== "boolean") throw new TypeError("bool expected");
    return this.u8(v ? 1 : 0);
  }
  u16(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new RangeError(`u16 out of range: ${v}`);
    const b = new Uint8Array(2);
    view(b).setUint16(0, v, true);
    return this.bytes(b);
  }
  u32(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError(`u32 out of range: ${v}`);
    const b = new Uint8Array(4);
    view(b).setUint32(0, v, true);
    return this.bytes(b);
  }
  i32(v: number): this {
    if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) throw new RangeError(`i32 out of range: ${v}`);
    const b = new Uint8Array(4);
    view(b).setInt32(0, v, true);
    return this.bytes(b);
  }
  u64(v: bigint): this {
    checkRange(v, 0n, U64_MAX, "u64");
    const b = new Uint8Array(8);
    view(b).setBigUint64(0, v, true);
    return this.bytes(b);
  }
  i64(v: bigint): this {
    checkRange(v, I64_MIN, I64_MAX, "i64");
    const b = new Uint8Array(8);
    view(b).setBigInt64(0, v, true);
    return this.bytes(b);
  }
  u128(v: bigint): this {
    checkRange(v, 0n, (1n << 128n) - 1n, "u128");
    return this.u64(v & U64_MAX).u64(v >> 64n);
  }
  i128(v: bigint): this {
    checkRange(v, -(1n << 127n), (1n << 127n) - 1n, "i128");
    return this.u128(v < 0n ? v + (1n << 128n) : v);
  }
  /** Borsh string: u32 byte length + UTF-8. */
  string(s: string): this {
    const b = utf8Encode(s);
    return this.u32(b.length).bytes(b);
  }
  toBytes(): Uint8Array {
    return concatBytes(...this.chunks);
  }
}

/** Bounds-checked borsh-style reader. */
export class ByteReader {
  readonly data: Uint8Array;
  offset: number;
  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
    this.offset = offset;
  }
  get remaining(): number {
    return this.data.length - this.offset;
  }
  bytes(n: number): Uint8Array {
    need(this.data, this.offset, n);
    const out = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0];
  }
  bool(): boolean {
    const v = this.u8();
    if (v > 1) throw new Error(`invalid bool byte ${v}`);
    return v === 1;
  }
  u16(): number {
    const v = readU16(this.data, this.offset);
    this.offset += 2;
    return v;
  }
  u32(): number {
    const v = readU32(this.data, this.offset);
    this.offset += 4;
    return v;
  }
  i32(): number {
    const v = readI32(this.data, this.offset);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    const v = readU64(this.data, this.offset);
    this.offset += 8;
    return v;
  }
  i64(): bigint {
    const v = readI64(this.data, this.offset);
    this.offset += 8;
    return v;
  }
  u128(): bigint {
    const v = readU128(this.data, this.offset);
    this.offset += 16;
    return v;
  }
  i128(): bigint {
    const v = readI128(this.data, this.offset);
    this.offset += 16;
    return v;
  }
  string(): string {
    const len = this.u32();
    return utf8Decode(this.bytes(len));
  }
}

/** Solana compact-u16 ("shortvec") length prefix. */
export function encodeShortVec(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`shortvec out of range: ${n}`);
  const out: number[] = [];
  let rem = n;
  for (;;) {
    let elem = rem & 0x7f;
    rem >>= 7;
    if (rem === 0) {
      out.push(elem);
      break;
    }
    elem |= 0x80;
    out.push(elem);
  }
  return Uint8Array.from(out);
}

/** Decodes a compact-u16 at `offset`; returns [value, bytesUsed]. Rejects non-canonical encodings. */
export function decodeShortVec(b: Uint8Array, offset: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    need(b, offset + i, 1);
    const elem = b[offset + i];
    value |= (elem & 0x7f) << (7 * i);
    if ((elem & 0x80) === 0) {
      if (i > 0 && elem === 0) throw new Error("non-canonical shortvec");
      if (value > 0xffff) throw new Error("shortvec overflow");
      return [value, i + 1];
    }
  }
  throw new Error("shortvec too long");
}
