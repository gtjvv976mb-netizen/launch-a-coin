// Minimal encoders/decoders for the native and SPL instructions that appear in MintDex, pump and
// PumpSwap transactions: System transfer, ComputeBudget, ATA create, SPL Token SyncNative / CloseAccount.
import { toAddress } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import { ByteReader, ByteWriter, readU32 } from "../bytes.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../constants.ts";
import { ro, rs, wr, ws } from "../instruction.ts";
import type { Instruction } from "../instruction.ts";

// ---------------------------------------------------------------- System program

export function systemTransfer(from: AddressLike, to: AddressLike, lamports: bigint): Instruction {
  return {
    programId: SYSTEM_PROGRAM_ID,
    accounts: [ws(from), wr(to)],
    data: new ByteWriter().u32(2).u64(lamports).toBytes(),
  };
}

export interface DecodedSystemTransfer {
  from: Address;
  to: Address;
  lamports: bigint;
}

/** Decodes a System `Transfer`; returns null for any other system instruction. */
export function decodeSystemTransfer(ix: Instruction): DecodedSystemTransfer | null {
  if (ix.programId !== SYSTEM_PROGRAM_ID || ix.data.length !== 12 || readU32(ix.data, 0) !== 2) return null;
  if (ix.accounts.length < 2) return null;
  return { from: ix.accounts[0].address, to: ix.accounts[1].address, lamports: new ByteReader(ix.data, 4).u64() };
}

// ---------------------------------------------------------------- Compute budget

export function setComputeUnitLimit(units: number): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: new ByteWriter().u8(2).u32(units).toBytes() };
}

export function setComputeUnitPrice(microLamports: bigint): Instruction {
  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    accounts: [],
    data: new ByteWriter().u8(3).u64(microLamports).toBytes(),
  };
}

export type DecodedComputeBudget =
  | { kind: "limit"; units: number }
  | { kind: "price"; microLamports: bigint }
  | { kind: "other"; tag: number };

export function decodeComputeBudget(ix: Instruction): DecodedComputeBudget | null {
  if (ix.programId !== COMPUTE_BUDGET_PROGRAM_ID || ix.data.length === 0) return null;
  const r = new ByteReader(ix.data);
  const tag = r.u8();
  if (tag === 2 && ix.data.length === 5) return { kind: "limit", units: r.u32() };
  if (tag === 3 && ix.data.length === 9) return { kind: "price", microLamports: r.u64() };
  return { kind: "other", tag };
}

// ---------------------------------------------------------------- Associated token account program

/** `CreateIdempotent` (data = [1]); same account order as spl-token's builder. */
export function createAtaIdempotent(
  payer: AddressLike,
  ata: AddressLike,
  owner: AddressLike,
  mint: AddressLike,
  tokenProgram: AddressLike = TOKEN_PROGRAM_ID
): Instruction {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [ws(payer), wr(ata), ro(owner), ro(mint), ro(SYSTEM_PROGRAM_ID), ro(tokenProgram)],
    data: Uint8Array.of(1),
  };
}

export interface DecodedCreateAta {
  idempotent: boolean;
  payer: Address;
  ata: Address;
  owner: Address;
  mint: Address;
  systemProgram: Address;
  tokenProgram: Address;
}

export function decodeCreateAta(ix: Instruction): DecodedCreateAta | null {
  if (ix.programId !== ASSOCIATED_TOKEN_PROGRAM_ID || ix.accounts.length !== 6) return null;
  const idempotent = ix.data.length === 1 && ix.data[0] === 1;
  const plain = ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] === 0);
  if (!idempotent && !plain) return null;
  const [payer, ata, owner, mint, systemProgram, tokenProgram] = ix.accounts.map((a) => a.address);
  return { idempotent, payer, ata, owner, mint, systemProgram, tokenProgram };
}

// ---------------------------------------------------------------- SPL Token / Token-2022

const isTokenProgram = (p: Address) => p === TOKEN_PROGRAM_ID || p === TOKEN_2022_PROGRAM_ID;

export function syncNative(account: AddressLike, tokenProgram: AddressLike = TOKEN_PROGRAM_ID): Instruction {
  return { programId: toAddress(tokenProgram), accounts: [wr(account)], data: Uint8Array.of(17) };
}

export function closeTokenAccount(
  account: AddressLike,
  destination: AddressLike,
  owner: AddressLike,
  tokenProgram: AddressLike = TOKEN_PROGRAM_ID
): Instruction {
  return {
    programId: toAddress(tokenProgram),
    accounts: [wr(account), wr(destination), rs(owner)],
    data: Uint8Array.of(9),
  };
}

export type DecodedTokenIx =
  | { kind: "syncNative"; account: Address }
  | { kind: "closeAccount"; account: Address; destination: Address; owner: Address }
  | { kind: "other"; tag: number };

export function decodeTokenInstruction(ix: Instruction): DecodedTokenIx | null {
  if (!isTokenProgram(ix.programId) || ix.data.length === 0) return null;
  const tag = ix.data[0];
  if (tag === 17 && ix.data.length === 1 && ix.accounts.length === 1) {
    return { kind: "syncNative", account: ix.accounts[0].address };
  }
  if (tag === 9 && ix.data.length === 1 && ix.accounts.length === 3) {
    return {
      kind: "closeAccount",
      account: ix.accounts[0].address,
      destination: ix.accounts[1].address,
      owner: ix.accounts[2].address,
    };
  }
  return { kind: "other", tag };
}
