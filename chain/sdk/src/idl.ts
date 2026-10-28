// A small Anchor (0.30+ spec) IDL engine: types, borsh encode/decode driven by IDL type definitions,
// discriminators, and instruction building/decoding by account name. It lets the MintDex encoders switch
// from the placeholder spec IDL to the real `anchor build` IDL without code changes (see mintdex/program.ts).
import { sha256 } from "@noble/hashes/sha2.js";
import { toAddress, toAddressBytes } from "./address.ts";
import type { Address, AddressLike } from "./address.ts";
import { ByteReader, ByteWriter, bytesEqual, utf8Encode } from "./bytes.ts";
import type { AccountMeta, Instruction } from "./instruction.ts";

export type IdlPrimitive =
  | "bool"
  | "u8"
  | "i8"
  | "u16"
  | "i16"
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "u128"
  | "i128"
  | "bytes"
  | "string"
  | "pubkey";

export type IdlType =
  | IdlPrimitive
  | { array: [IdlType, number] }
  | { vec: IdlType }
  | { option: IdlType }
  | { coption: IdlType }
  | { defined: { name: string } };

export interface IdlField {
  name: string;
  type: IdlType;
  docs?: string[];
}

export type IdlTypeDefBody =
  | { kind: "struct"; fields?: IdlField[] | IdlType[] }
  | { kind: "enum"; variants: { name: string; fields?: IdlField[] | IdlType[] }[] }
  | { kind: "type"; alias: IdlType };

export interface IdlTypeDef {
  name: string;
  type: IdlTypeDefBody;
  docs?: string[];
}

export interface IdlInstructionAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  docs?: string[];
  pda?: unknown;
  relations?: string[];
}

export interface IdlInstructionAccounts {
  name: string;
  accounts: IdlInstructionAccountItem[];
}

export type IdlInstructionAccountItem = IdlInstructionAccount | IdlInstructionAccounts;

export interface IdlInstruction {
  name: string;
  discriminator: number[];
  accounts: IdlInstructionAccountItem[];
  args: IdlField[];
  docs?: string[];
}

export interface Idl {
  address: string;
  metadata: { name: string; version: string; spec: string; description?: string };
  instructions: IdlInstruction[];
  accounts?: { name: string; discriminator: number[] }[];
  events?: { name: string; discriminator: number[] }[];
  errors?: { code: number; name: string; msg?: string }[];
  types?: IdlTypeDef[];
  docs?: string[];
}

/** Anchor discriminator: first 8 bytes of sha256("<namespace>:<name>"), namespaces "global", "account", "event". */
export function anchorDiscriminator(namespace: "global" | "account" | "event", name: string): number[] {
  return Array.from(sha256(utf8Encode(`${namespace}:${name}`)).subarray(0, 8));
}

/** Flattens nested account groups into the on-the-wire order. */
export function flattenAccounts(items: IdlInstructionAccountItem[]): IdlInstructionAccount[] {
  const out: IdlInstructionAccount[] = [];
  for (const it of items) {
    if ("accounts" in it && Array.isArray((it as IdlInstructionAccounts).accounts)) {
      out.push(...flattenAccounts((it as IdlInstructionAccounts).accounts));
    } else out.push(it as IdlInstructionAccount);
  }
  return out;
}

const isNamedFields = (f: IdlField[] | IdlType[] | undefined): f is IdlField[] =>
  !!f &&
  f.length > 0 &&
  typeof f[0] === "object" &&
  f[0] !== null &&
  "name" in (f[0] as object) &&
  "type" in (f[0] as object);

/** JS values: integers ≤ 32 bits are numbers, wider ones bigint; pubkey = base58; [u8; N] / Vec<u8> / bytes = Uint8Array. */
export class IdlCoder {
  private readonly types = new Map<string, IdlTypeDef>();

  constructor(types: IdlTypeDef[] = []) {
    for (const t of types) this.types.set(t.name, t);
  }

  typeDef(name: string): IdlTypeDef {
    const t = this.types.get(name);
    if (!t) throw new Error(`IDL type ${name} not found`);
    return t;
  }

  encode(type: IdlType, value: unknown, w: ByteWriter = new ByteWriter()): ByteWriter {
    if (typeof type === "string") {
      switch (type) {
        case "bool":
          return w.bool(value as boolean);
        case "u8":
          return w.u8(value as number);
        case "i8": {
          const v = value as number;
          if (!Number.isInteger(v) || v < -128 || v > 127) throw new RangeError(`i8 out of range: ${v}`);
          return w.u8(v & 0xff);
        }
        case "u16":
          return w.u16(value as number);
        case "i16": {
          const v = value as number;
          if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new RangeError(`i16 out of range: ${v}`);
          return w.u16(v & 0xffff);
        }
        case "u32":
          return w.u32(value as number);
        case "i32":
          return w.i32(value as number);
        case "u64":
          return w.u64(BigInt(value as bigint));
        case "i64":
          return w.i64(BigInt(value as bigint));
        case "u128":
          return w.u128(BigInt(value as bigint));
        case "i128":
          return w.i128(BigInt(value as bigint));
        case "string":
          return w.string(value as string);
        case "pubkey":
          return w.bytes(toAddressBytes(value as AddressLike));
        case "bytes": {
          const b = Uint8Array.from(value as Uint8Array);
          return w.u32(b.length).bytes(b);
        }
      }
      throw new Error(`unsupported IDL type ${type}`);
    }
    if ("array" in type) {
      const [inner, len] = type.array;
      const arr = value as ArrayLike<unknown>;
      if (!arr || arr.length !== len) throw new Error(`array length ${arr?.length} != ${len}`);
      for (let i = 0; i < len; i++) this.encode(inner, arr[i], w);
      return w;
    }
    if ("vec" in type) {
      const arr = value as ArrayLike<unknown>;
      w.u32(arr.length);
      for (let i = 0; i < arr.length; i++) this.encode(type.vec, arr[i], w);
      return w;
    }
    if ("option" in type) {
      if (value === null || value === undefined) return w.u8(0);
      w.u8(1);
      return this.encode(type.option, value, w);
    }
    if ("coption" in type) {
      if (value === null || value === undefined) return w.u32(0).bytes(new Uint8Array(this.sizeOf(type.coption)));
      w.u32(1);
      return this.encode(type.coption, value, w);
    }
    if ("defined" in type) return this.encodeDefined(this.typeDef(type.defined.name), value, w);
    throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
  }

  private encodeFields(fields: IdlField[] | IdlType[] | undefined, value: unknown, w: ByteWriter) {
    if (!fields || fields.length === 0) return;
    if (isNamedFields(fields)) {
      const obj = value as Record<string, unknown>;
      if (!obj || typeof obj !== "object") throw new Error("struct value must be an object");
      for (const f of fields) {
        if (!(f.name in obj)) throw new Error(`missing field ${f.name}`);
        this.encode(f.type, obj[f.name], w);
      }
    } else {
      const arr = value as unknown[];
      (fields as IdlType[]).forEach((t, i) => this.encode(t, arr[i], w));
    }
  }

  private encodeDefined(def: IdlTypeDef, value: unknown, w: ByteWriter): ByteWriter {
    const body = def.type;
    if (body.kind === "struct") {
      this.encodeFields(body.fields, value, w);
      return w;
    }
    if (body.kind === "enum") {
      const obj = value as Record<string, unknown>;
      const key = Object.keys(obj)[0];
      const idx = body.variants.findIndex((v) => v.name === key);
      if (idx < 0) throw new Error(`unknown enum variant ${key} of ${def.name}`);
      w.u8(idx);
      this.encodeFields(body.variants[idx].fields, obj[key], w);
      return w;
    }
    return this.encode(body.alias, value, w);
  }

  decode(type: IdlType, r: ByteReader): unknown {
    if (typeof type === "string") {
      switch (type) {
        case "bool":
          return r.bool();
        case "u8":
          return r.u8();
        case "i8": {
          const v = r.u8();
          return v >= 128 ? v - 256 : v;
        }
        case "u16":
          return r.u16();
        case "i16": {
          const v = r.u16();
          return v >= 32768 ? v - 65536 : v;
        }
        case "u32":
          return r.u32();
        case "i32":
          return r.i32();
        case "u64":
          return r.u64();
        case "i64":
          return r.i64();
        case "u128":
          return r.u128();
        case "i128":
          return r.i128();
        case "string":
          return r.string();
        case "pubkey":
          return toAddress(Uint8Array.from(r.bytes(32)));
        case "bytes":
          return Uint8Array.from(r.bytes(r.u32()));
      }
      throw new Error(`unsupported IDL type ${type}`);
    }
    if ("array" in type) {
      const [inner, len] = type.array;
      if (inner === "u8") return Uint8Array.from(r.bytes(len));
      return Array.from({ length: len }, () => this.decode(inner, r));
    }
    if ("vec" in type) {
      const len = r.u32();
      if (type.vec === "u8") return Uint8Array.from(r.bytes(len));
      return Array.from({ length: len }, () => this.decode(type.vec, r));
    }
    if ("option" in type) return r.u8() === 0 ? null : this.decode(type.option, r);
    if ("coption" in type) {
      const tag = r.u32();
      if (tag === 0) {
        r.bytes(this.sizeOf(type.coption));
        return null;
      }
      return this.decode(type.coption, r);
    }
    if ("defined" in type) return this.decodeDefined(this.typeDef(type.defined.name), r);
    throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
  }

  private decodeFields(fields: IdlField[] | IdlType[] | undefined, r: ByteReader): unknown {
    if (!fields || fields.length === 0) return {};
    if (isNamedFields(fields)) {
      const out: Record<string, unknown> = {};
      for (const f of fields) out[f.name] = this.decode(f.type, r);
      return out;
    }
    return (fields as IdlType[]).map((t) => this.decode(t, r));
  }

  private decodeDefined(def: IdlTypeDef, r: ByteReader): unknown {
    const body = def.type;
    if (body.kind === "struct") return this.decodeFields(body.fields, r);
    if (body.kind === "enum") {
      const idx = r.u8();
      const v = body.variants[idx];
      if (!v) throw new Error(`invalid enum tag ${idx} for ${def.name}`);
      return { [v.name]: this.decodeFields(v.fields, r) };
    }
    return this.decode(body.alias, r);
  }

  /** Fixed byte size of a type; throws for variable-size types. */
  sizeOf(type: IdlType): number {
    if (typeof type === "string") {
      const sizes: Record<string, number> = {
        bool: 1,
        u8: 1,
        i8: 1,
        u16: 2,
        i16: 2,
        u32: 4,
        i32: 4,
        u64: 8,
        i64: 8,
        u128: 16,
        i128: 16,
        pubkey: 32,
      };
      if (!(type in sizes)) throw new Error(`${type} has no fixed size`);
      return sizes[type];
    }
    if ("array" in type) return this.sizeOf(type.array[0]) * type.array[1];
    if ("coption" in type) return 4 + this.sizeOf(type.coption);
    if ("defined" in type) {
      const body = this.typeDef(type.defined.name).type;
      if (body.kind === "struct") {
        const fields = body.fields ?? [];
        return isNamedFields(fields)
          ? fields.reduce((s, f) => s + this.sizeOf(f.type), 0)
          : (fields as IdlType[]).reduce((s, t) => s + this.sizeOf(t), 0);
      }
      if (body.kind === "type") return this.sizeOf(body.alias);
    }
    throw new Error(`${JSON.stringify(type)} has no fixed size`);
  }
}

/** Instruction/account/event coder for one program IDL. */
export class IdlProgram {
  readonly idl: Idl;
  readonly programId: Address;
  readonly coder: IdlCoder;

  constructor(idl: Idl, programId?: AddressLike) {
    this.idl = idl;
    this.programId = toAddress(programId ?? idl.address);
    this.coder = new IdlCoder(idl.types ?? []);
  }

  ix(name: string): IdlInstruction {
    const ix = this.idl.instructions.find((i) => i.name === name);
    if (!ix) throw new Error(`instruction ${name} not in IDL ${this.idl.metadata.name}`);
    return ix;
  }

  /** Account names in wire order (nested groups flattened). */
  accountNames(name: string): string[] {
    return flattenAccounts(this.ix(name).accounts).map((a) => a.name);
  }

  encodeArgs(name: string, args: Record<string, unknown> = {}): Uint8Array {
    const ix = this.ix(name);
    const w = new ByteWriter().bytes(Uint8Array.from(ix.discriminator));
    for (const a of ix.args) {
      if (!(a.name in args)) throw new Error(`${name}: missing arg ${a.name}`);
      this.coder.encode(a.type, args[a.name], w);
    }
    const extra = Object.keys(args).filter((k) => !ix.args.some((a) => a.name === k));
    if (extra.length) throw new Error(`${name}: unknown args ${extra.join(", ")}`);
    return w.toBytes();
  }

  /**
   * Builds an instruction. `accounts` maps IDL account names to addresses; accounts with a fixed IDL `address`
   * may be omitted; an omitted optional account is passed as the program id (Anchor's convention for None).
   */
  instruction(
    name: string,
    accounts: Record<string, AddressLike | null | undefined>,
    args: Record<string, unknown> = {},
    remainingAccounts: AccountMeta[] = []
  ): Instruction {
    const defs = flattenAccounts(this.ix(name).accounts);
    const known = new Set(defs.map((d) => d.name));
    const unknown = Object.keys(accounts).filter((k) => !known.has(k));
    if (unknown.length) throw new Error(`${name}: unknown accounts ${unknown.join(", ")}`);
    const metas: AccountMeta[] = defs.map((d) => {
      const given = accounts[d.name];
      if (given === null || given === undefined) {
        if (d.address) return { address: toAddress(d.address), isSigner: !!d.signer, isWritable: !!d.writable };
        if (d.optional) return { address: this.programId, isSigner: false, isWritable: false };
        throw new Error(`${name}: missing account ${d.name}`);
      }
      const address = toAddress(given);
      if (d.address && d.address !== address) throw new Error(`${name}: ${d.name} must be ${d.address}`);
      return { address, isSigner: !!d.signer, isWritable: !!d.writable };
    });
    return { programId: this.programId, accounts: [...metas, ...remainingAccounts], data: this.encodeArgs(name, args) };
  }

  decodeInstruction(ix: Instruction): {
    name: string;
    args: Record<string, unknown>;
    accounts: Record<string, Address>;
    remaining: AccountMeta[];
  } | null {
    if (ix.programId !== this.programId || ix.data.length < 8) return null;
    const def = this.idl.instructions.find((d) => bytesEqual(Uint8Array.from(d.discriminator), ix.data.subarray(0, 8)));
    if (!def) return null;
    const r = new ByteReader(ix.data, 8);
    const args: Record<string, unknown> = {};
    for (const a of def.args) args[a.name] = this.coder.decode(a.type, r);
    if (r.remaining !== 0) throw new Error(`${def.name}: ${r.remaining} trailing bytes`);
    const names = flattenAccounts(def.accounts).map((a) => a.name);
    if (ix.accounts.length < names.length) throw new Error(`${def.name}: expected ${names.length} accounts`);
    const accounts: Record<string, Address> = {};
    names.forEach((n, i) => (accounts[n] = ix.accounts[i].address));
    return { name: def.name, args, accounts, remaining: ix.accounts.slice(names.length) };
  }

  accountDiscriminator(accountName: string): Uint8Array {
    const a = (this.idl.accounts ?? []).find((x) => x.name === accountName);
    if (!a) throw new Error(`account ${accountName} not in IDL`);
    return Uint8Array.from(a.discriminator);
  }

  /** Decodes an account's data (discriminator checked). */
  decodeAccount<T = Record<string, unknown>>(accountName: string, data: Uint8Array): T {
    if (!bytesEqual(data.subarray(0, 8), this.accountDiscriminator(accountName))) {
      throw new Error(`not a ${accountName} account`);
    }
    return this.coder.decode({ defined: { name: accountName } }, new ByteReader(data, 8)) as T;
  }

  encodeAccount(accountName: string, value: unknown): Uint8Array {
    const w = new ByteWriter().bytes(this.accountDiscriminator(accountName));
    return this.coder.encode({ defined: { name: accountName } }, value, w).toBytes();
  }

  /** Byte size of an account including the 8-byte discriminator (fixed-size layouts only). */
  accountSize(accountName: string): number {
    return 8 + this.coder.sizeOf({ defined: { name: accountName } });
  }

  /** Decodes event bytes = event discriminator ‖ borsh (i.e. emit_cpi data after the 8-byte tag). */
  decodeEvent(data: Uint8Array): { name: string; data: Record<string, unknown> } | null {
    if (data.length < 8) return null;
    const ev = (this.idl.events ?? []).find((e) => bytesEqual(Uint8Array.from(e.discriminator), data.subarray(0, 8)));
    if (!ev) return null;
    const r = new ByteReader(data, 8);
    return { name: ev.name, data: this.coder.decode({ defined: { name: ev.name } }, r) as Record<string, unknown> };
  }

  errorByCode(code: number): { code: number; name: string; msg?: string } | undefined {
    return (this.idl.errors ?? []).find((e) => e.code === code);
  }
}
