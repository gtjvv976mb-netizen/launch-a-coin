// PumpSwap account readers at fixed offsets (facts §7; card-program-v2 §5.2).
import { toAddress } from "../address.ts";
import type { Address } from "../address.ts";
import { bytesEqual, readI128, readU16, readU64 } from "../bytes.ts";
import { ACCOUNT_DISC } from "../constants.ts";

export interface Pool {
  poolBump: number;
  index: number;
  /** pool creator; for canonical pump pools the pump `pool-authority` PDA */
  creator: Address;
  baseMint: Address;
  quoteMint: Address;
  lpMint: Address;
  poolBaseTokenAccount: Address;
  poolQuoteTokenAccount: Address;
  lpSupply: bigint;
  coinCreator: Address;
  isMayhemMode: boolean;
  isCashbackCoin: boolean;
  /** i128 at 245 when the account is at least 261 bytes, else 0. */
  virtualQuoteReserves: bigint;
  creatorFeeBps: bigint;
  canEditCreatorFee: boolean;
  isHolderReward: boolean;
  dataLength: number;
}

/** MintDex requires at least this length (through `coin_creator`, card-program-v2 §5.2). */
export const POOL_MIN_LEN = 243;

export function decodePool(data: Uint8Array): Pool {
  if (!bytesEqual(data.subarray(0, 8), ACCOUNT_DISC.pammPool)) throw new Error("not a PumpSwap Pool");
  if (data.length < POOL_MIN_LEN) throw new Error(`pool too short (${data.length})`);
  const d = new Uint8Array(Math.max(data.length, 271));
  d.set(data);
  return {
    poolBump: d[8],
    index: readU16(d, 9),
    creator: toAddress(d.subarray(11, 43)),
    baseMint: toAddress(d.subarray(43, 75)),
    quoteMint: toAddress(d.subarray(75, 107)),
    lpMint: toAddress(d.subarray(107, 139)),
    poolBaseTokenAccount: toAddress(d.subarray(139, 171)),
    poolQuoteTokenAccount: toAddress(d.subarray(171, 203)),
    lpSupply: readU64(d, 203),
    coinCreator: toAddress(d.subarray(211, 243)),
    isMayhemMode: d[243] !== 0,
    isCashbackCoin: d[244] !== 0,
    virtualQuoteReserves: data.length >= 261 ? readI128(d, 245) : 0n,
    creatorFeeBps: data.length >= 269 ? readU64(d, 261) : 0n,
    canEditCreatorFee: d[269] !== 0,
    isHolderReward: d[270] !== 0,
    dataLength: data.length,
  };
}

export interface AmmGlobalConfig {
  admin: Address;
  lpFeeBasisPoints: bigint;
  protocolFeeBasisPoints: bigint;
  disableFlags: number;
  protocolFeeRecipients: Address[];
  coinCreatorFeeBasisPoints: bigint;
  reservedFeeRecipient: Address;
  mayhemModeEnabled: boolean;
  reservedFeeRecipients: Address[];
  buybackFeeRecipients: Address[];
  boostAuthority: Address;
}

const keyAt = (d: Uint8Array, o: number) => toAddress(d.subarray(o, o + 32));
const keysAt = (d: Uint8Array, o: number, n: number) => Array.from({ length: n }, (_, i) => keyAt(d, o + 32 * i));

/** pAMM `GlobalConfig` (949 bytes). Offsets follow the IDL field order. */
export function decodeAmmGlobalConfig(data: Uint8Array): AmmGlobalConfig {
  if (!bytesEqual(data.subarray(0, 8), ACCOUNT_DISC.pammGlobalConfig)) throw new Error("not a PumpSwap GlobalConfig");
  if (data.length < 939) throw new Error(`GlobalConfig too short (${data.length})`);
  return {
    admin: keyAt(data, 8),
    lpFeeBasisPoints: readU64(data, 40),
    protocolFeeBasisPoints: readU64(data, 48),
    disableFlags: data[56],
    protocolFeeRecipients: keysAt(data, 57, 8),
    coinCreatorFeeBasisPoints: readU64(data, 313),
    reservedFeeRecipient: keyAt(data, 385),
    mayhemModeEnabled: data[417] !== 0,
    reservedFeeRecipients: keysAt(data, 418, 7),
    buybackFeeRecipients: keysAt(data, 643, 8),
    boostAuthority: keyAt(data, 907),
  };
}
