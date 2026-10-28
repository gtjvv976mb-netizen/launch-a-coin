// Address lookup table account reader (needed to resolve v0 transactions before verifying them).
import { toAddress } from "../address.ts";
import type { Address } from "../address.ts";
import { readU32, readU64 } from "../bytes.ts";

export const LOOKUP_TABLE_META_SIZE = 56;
const U64_MAX = (1n << 64n) - 1n;

export interface AddressLookupTable {
  deactivationSlot: bigint;
  lastExtendedSlot: bigint;
  lastExtendedSlotStartIndex: number;
  authority: Address | null;
  addresses: Address[];
  /** deactivation_slot == u64::MAX */
  isActive: boolean;
}

export function decodeAddressLookupTable(data: Uint8Array): AddressLookupTable {
  if (data.length < LOOKUP_TABLE_META_SIZE || (data.length - LOOKUP_TABLE_META_SIZE) % 32 !== 0) {
    throw new Error(`invalid lookup table length ${data.length}`);
  }
  if (readU32(data, 0) !== 1) throw new Error("not an initialized address lookup table");
  const deactivationSlot = readU64(data, 4);
  const addresses: Address[] = [];
  for (let o = LOOKUP_TABLE_META_SIZE; o < data.length; o += 32) addresses.push(toAddress(data.subarray(o, o + 32)));
  return {
    deactivationSlot,
    lastExtendedSlot: readU64(data, 12),
    lastExtendedSlotStartIndex: data[20],
    authority: data[21] === 1 ? toAddress(data.subarray(22, 54)) : null,
    addresses,
    isActive: deactivationSlot === U64_MAX,
  };
}
