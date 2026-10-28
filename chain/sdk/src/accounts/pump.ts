// pump account readers at fixed offsets (facts §7; the same offsets the MintDex program reads, card-program-v2 §5.1).
import { toAddress } from "../address.ts";
import type { Address } from "../address.ts";
import { bytesEqual, readU64 } from "../bytes.ts";
import { ACCOUNT_DISC } from "../constants.ts";

export interface BondingCurve {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: Address;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  /** All-zero (`11111111111111111111111111111111`) = SOL. */
  quoteMint: Address;
  creatorFeeBps: bigint;
  canEditCreatorFee: boolean;
  isHolderReward: boolean;
  /** Raw account length (create_v2 curves are 174 bytes on devnet). */
  dataLength: number;
}

/** Fields up to `is_holder_reward` end at byte 125. Older, shorter curves are read zero-padded (as the SDK does). */
export const BONDING_CURVE_MIN_FULL_LEN = 125;

export function decodeBondingCurve(data: Uint8Array): BondingCurve {
  if (data.length < 81) throw new Error(`bonding curve too short (${data.length})`);
  if (!bytesEqual(data.subarray(0, 8), ACCOUNT_DISC.pumpBondingCurve)) throw new Error("not a pump BondingCurve");
  const d = new Uint8Array(Math.max(data.length, BONDING_CURVE_MIN_FULL_LEN));
  d.set(data);
  return {
    virtualTokenReserves: readU64(d, 8),
    virtualQuoteReserves: readU64(d, 16),
    realTokenReserves: readU64(d, 24),
    realQuoteReserves: readU64(d, 32),
    tokenTotalSupply: readU64(d, 40),
    complete: d[48] !== 0,
    creator: toAddress(d.subarray(49, 81)),
    isMayhemMode: d[81] !== 0,
    isCashbackCoin: d[82] !== 0,
    quoteMint: toAddress(d.subarray(83, 115)),
    creatorFeeBps: readU64(d, 115),
    canEditCreatorFee: d[123] !== 0,
    isHolderReward: d[124] !== 0,
    dataLength: data.length,
  };
}

export interface PumpGlobal {
  authority: Address;
  feeRecipient: Address;
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  feeBasisPoints: bigint;
  withdrawAuthority: Address;
  poolMigrationFee: bigint;
  feeRecipients: Address[];
  setCreatorAuthority: Address;
  adminSetCreatorAuthority: Address;
  createV2Enabled: boolean;
  reservedFeeRecipient: Address;
  mayhemModeEnabled: boolean;
  reservedFeeRecipients: Address[];
  buybackFeeRecipients: Address[];
  /** `fee_recipient` followed by `fee_recipients`: the set pump accepts for non-mayhem trades. */
  allFeeRecipients: Address[];
}

const keyAt = (d: Uint8Array, o: number) => toAddress(d.subarray(o, o + 32));
const keysAt = (d: Uint8Array, o: number, n: number) => Array.from({ length: n }, (_, i) => keyAt(d, o + 32 * i));

/** pump `Global` (1088 bytes on devnet). Offsets follow the IDL field order; checked against the SDK decoder. */
export function decodePumpGlobal(data: Uint8Array): PumpGlobal {
  if (!bytesEqual(data.subarray(0, 8), ACCOUNT_DISC.pumpGlobal)) throw new Error("not a pump Global");
  if (data.length < 1005) throw new Error(`pump Global too short (${data.length})`);
  const feeRecipient = keyAt(data, 41);
  const feeRecipients = keysAt(data, 162, 7);
  return {
    authority: keyAt(data, 9),
    feeRecipient,
    initialVirtualTokenReserves: readU64(data, 73),
    initialVirtualSolReserves: readU64(data, 81),
    initialRealTokenReserves: readU64(data, 89),
    tokenTotalSupply: readU64(data, 97),
    feeBasisPoints: readU64(data, 105),
    withdrawAuthority: keyAt(data, 113),
    poolMigrationFee: readU64(data, 146),
    feeRecipients,
    setCreatorAuthority: keyAt(data, 386),
    adminSetCreatorAuthority: keyAt(data, 418),
    createV2Enabled: data[450] !== 0,
    reservedFeeRecipient: keyAt(data, 483),
    mayhemModeEnabled: data[515] !== 0,
    reservedFeeRecipients: keysAt(data, 516, 7),
    buybackFeeRecipients: keysAt(data, 741, 8),
    allFeeRecipients: [feeRecipient, ...feeRecipients],
  };
}
