// Library-neutral instruction shape. `web3.ts` converts to and from @solana/web3.js when a caller needs it.
import { toAddress } from "./address.ts";
import type { Address, AddressLike } from "./address.ts";
import { bytesEqual, toHex } from "./bytes.ts";

export interface AccountMeta {
  address: Address;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Instruction {
  programId: Address;
  accounts: AccountMeta[];
  data: Uint8Array;
}

export const meta = (address: AddressLike, isWritable = false, isSigner = false): AccountMeta => ({
  address: toAddress(address),
  isSigner,
  isWritable,
});
/** read-only */
export const ro = (a: AddressLike): AccountMeta => meta(a, false, false);
/** writable */
export const wr = (a: AddressLike): AccountMeta => meta(a, true, false);
/** writable signer */
export const ws = (a: AddressLike): AccountMeta => meta(a, true, true);
/** read-only signer */
export const rs = (a: AddressLike): AccountMeta => meta(a, false, true);

export function instructionsEqual(a: Instruction, b: Instruction): boolean {
  return (
    a.programId === b.programId &&
    a.accounts.length === b.accounts.length &&
    a.accounts.every(
      (m, i) =>
        m.address === b.accounts[i].address &&
        m.isSigner === b.accounts[i].isSigner &&
        m.isWritable === b.accounts[i].isWritable
    ) &&
    bytesEqual(a.data, b.data)
  );
}

/** Human-readable first difference between two instructions, or null when equal. */
export function diffInstructions(actual: Instruction, expected: Instruction): string | null {
  if (actual.programId !== expected.programId) return `program ${actual.programId} != ${expected.programId}`;
  if (actual.accounts.length !== expected.accounts.length) {
    return `account count ${actual.accounts.length} != ${expected.accounts.length}`;
  }
  for (let i = 0; i < actual.accounts.length; i++) {
    const x = actual.accounts[i];
    const y = expected.accounts[i];
    if (x.address !== y.address) return `account #${i} ${x.address} != ${y.address}`;
    if (x.isSigner !== y.isSigner) return `account #${i} signer ${x.isSigner} != ${y.isSigner}`;
    if (x.isWritable !== y.isWritable) return `account #${i} writable ${x.isWritable} != ${y.isWritable}`;
  }
  if (!bytesEqual(actual.data, expected.data)) return `data ${toHex(actual.data)} != ${toHex(expected.data)}`;
  return null;
}
