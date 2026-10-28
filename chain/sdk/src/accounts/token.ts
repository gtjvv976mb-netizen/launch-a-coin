// SPL Token / Token-2022 readers: token accounts, mints, the Token-2022 TLV extension area and TokenMetadata
// (pump writes the coin's name, symbol and URI into the coin mint; MintDex writes the card's level there).
import { toAddress } from "../address.ts";
import type { Address } from "../address.ts";
import { ByteReader, readU16, readU32, readU64 } from "../bytes.ts";

const ZERO_KEY = "11111111111111111111111111111111";
export const TOKEN_ACCOUNT_LEN = 165;
export const MINT_LEN = 82;
/** Token-2022: extension data starts after the account-type byte at 165. */
const ACCOUNT_TYPE_OFFSET = 165;

export const EXTENSION_TYPE = {
  MintCloseAuthority: 3,
  DefaultAccountState: 6,
  ImmutableOwner: 7,
  MemoTransfer: 8,
  NonTransferable: 9,
  CpiGuard: 11,
  PermanentDelegate: 12,
  TransferHook: 14,
  MetadataPointer: 18,
  TokenMetadata: 19,
} as const;

export interface TokenAccount {
  mint: Address;
  owner: Address;
  amount: bigint;
  delegate: Address | null;
  /** 0 uninitialized, 1 initialized, 2 frozen */
  state: number;
  /** Rent-exempt reserve when the account is native (wrapped SOL), else null. */
  isNative: bigint | null;
  delegatedAmount: bigint;
  closeAuthority: Address | null;
  extensions: TlvEntry[];
}

export function decodeTokenAccount(data: Uint8Array): TokenAccount {
  if (data.length < TOKEN_ACCOUNT_LEN) throw new Error(`token account too short (${data.length})`);
  const coption = (o: number) => (readU32(data, o) === 1 ? toAddress(data.subarray(o + 4, o + 36)) : null);
  const extensions = data.length > TOKEN_ACCOUNT_LEN ? parseTlv(data, ACCOUNT_TYPE_OFFSET + 1) : [];
  if (data.length > TOKEN_ACCOUNT_LEN && data[ACCOUNT_TYPE_OFFSET] !== 2) throw new Error("not a token account");
  return {
    mint: toAddress(data.subarray(0, 32)),
    owner: toAddress(data.subarray(32, 64)),
    amount: readU64(data, 64),
    delegate: coption(72),
    state: data[108],
    isNative: readU32(data, 109) === 1 ? readU64(data, 113) : null,
    delegatedAmount: readU64(data, 121),
    closeAuthority: coption(129),
    extensions,
  };
}

export interface Mint {
  mintAuthority: Address | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: Address | null;
  extensions: TlvEntry[];
}

export function decodeMint(data: Uint8Array): Mint {
  if (data.length < MINT_LEN) throw new Error(`mint too short (${data.length})`);
  const coption = (o: number) => (readU32(data, o) === 1 ? toAddress(data.subarray(o + 4, o + 36)) : null);
  let extensions: TlvEntry[] = [];
  if (data.length > MINT_LEN) {
    if (data.length <= ACCOUNT_TYPE_OFFSET || data[ACCOUNT_TYPE_OFFSET] !== 1) throw new Error("not a Token-2022 mint");
    extensions = parseTlv(data, ACCOUNT_TYPE_OFFSET + 1);
  }
  return {
    mintAuthority: coption(0),
    supply: readU64(data, 36),
    decimals: data[44],
    isInitialized: data[45] === 1,
    freezeAuthority: coption(46),
    extensions,
  };
}

/** Live mint supply (u64 at 36); the pool market cap uses it because the boost bot burns tokens. */
export const mintSupply = (data: Uint8Array): bigint => readU64(data, 36);

export interface TlvEntry {
  type: number;
  value: Uint8Array;
}

export function parseTlv(data: Uint8Array, start: number): TlvEntry[] {
  const out: TlvEntry[] = [];
  let o = start;
  while (o + 4 <= data.length) {
    const type = readU16(data, o);
    const len = readU16(data, o + 2);
    if (type === 0 && len === 0) break; // uninitialized padding
    if (o + 4 + len > data.length) throw new Error("TLV entry runs past the account data");
    out.push({ type, value: data.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  return out;
}

export interface TokenMetadata {
  updateAuthority: Address | null;
  mint: Address;
  name: string;
  symbol: string;
  uri: string;
  additionalMetadata: [string, string][];
}

export function decodeTokenMetadata(value: Uint8Array): TokenMetadata {
  const r = new ByteReader(value);
  const ua = toAddress(r.bytes(32));
  const mint = toAddress(r.bytes(32));
  const name = r.string();
  const symbol = r.string();
  const uri = r.string();
  const n = r.u32();
  const additionalMetadata: [string, string][] = [];
  for (let i = 0; i < n; i++) additionalMetadata.push([r.string(), r.string()]);
  return { updateAuthority: ua === ZERO_KEY ? null : ua, mint, name, symbol, uri, additionalMetadata };
}

/** Reads the TokenMetadata extension of a Token-2022 mint, or null when it has none. */
export function mintTokenMetadata(data: Uint8Array): TokenMetadata | null {
  const entry = decodeMint(data).extensions.find((e) => e.type === EXTENSION_TYPE.TokenMetadata);
  return entry ? decodeTokenMetadata(entry.value) : null;
}

export interface MetadataPointer {
  authority: Address | null;
  metadataAddress: Address | null;
}

export function mintMetadataPointer(data: Uint8Array): MetadataPointer | null {
  const entry = decodeMint(data).extensions.find((e) => e.type === EXTENSION_TYPE.MetadataPointer);
  if (!entry) return null;
  const a = toAddress(entry.value.subarray(0, 32));
  const m = toAddress(entry.value.subarray(32, 64));
  return { authority: a === ZERO_KEY ? null : a, metadataAddress: m === ZERO_KEY ? null : m };
}
