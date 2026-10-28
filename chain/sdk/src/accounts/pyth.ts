// Pyth receiver PriceUpdateV2, parsed manually exactly as card-program-v2 §5.3 describes (no Pyth crate or SDK).
import { toAddress } from "../address.ts";
import type { Address } from "../address.ts";
import { bytesEqual, readI32, readI64, readU64 } from "../bytes.ts";
import { ACCOUNT_DISC, PYTH_RECEIVER_PROGRAM_ID, SOL_USD_FEED_ID } from "../constants.ts";
import { ChainCheckError } from "./types.ts";
import type { AccountData } from "./types.ts";

export interface PriceUpdateV2 {
  writeAuthority: Address;
  /** 1 = Full (the only level MintDex accepts). */
  verificationLevel: number;
  feedId: Uint8Array;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: bigint;
  prevPublishTime: bigint;
  emaPrice: bigint;
  emaConf: bigint;
}

export function decodePriceUpdateV2(data: Uint8Array): PriceUpdateV2 {
  if (data.length < 125) throw new Error(`PriceUpdateV2 too short (${data.length})`);
  if (!bytesEqual(data.subarray(0, 8), ACCOUNT_DISC.pythPriceUpdateV2)) throw new Error("not a PriceUpdateV2");
  if (data[40] !== 1) throw new ChainCheckError("PriceTooUncertain", "verification level is not Full");
  return {
    writeAuthority: toAddress(data.subarray(8, 40)),
    verificationLevel: data[40],
    feedId: data.subarray(41, 73),
    price: readI64(data, 73),
    conf: readU64(data, 81),
    expo: readI32(data, 89),
    publishTime: readI64(data, 93),
    prevPublishTime: readI64(data, 101),
    emaPrice: readI64(data, 109),
    emaConf: readU64(data, 117),
  };
}

/** Scales a Pyth price `p × 10^expo` to micro-USD: `p × 10^(6+expo)`, dividing when expo < −6 (floor). */
export function pythToUsdE6(price: bigint, expo: number): bigint {
  const shift = 6 + expo;
  return shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
}

export interface PythCheckParams {
  /** `config.pyth_price_account`; the account key must match. */
  expectedAccount: Address;
  nowUnix: bigint;
  /** `config.max_price_age_secs` (mainnet 60); must be > 0 with Pyth. */
  maxPriceAgeSecs: number;
  /** `config.max_conf_bps`. */
  maxConfBps: number;
}

/**
 * Mirror of the on-chain Pyth read (§5.3): address, owner, discriminator, Full verification, SOL/USD feed id,
 * positive price and ema, −12 ≤ expo ≤ 0, freshness, confidence; returns micro-USD from `min(price, ema)`.
 */
export function pythSolUsdE6(account: AccountData & { address: Address }, p: PythCheckParams): bigint {
  if (account.address !== p.expectedAccount) throw new ChainCheckError("PriceFeedMismatch", "wrong price account");
  if (account.owner !== PYTH_RECEIVER_PROGRAM_ID) throw new ChainCheckError("PriceFeedMismatch", "wrong owner");
  const u = decodePriceUpdateV2(account.data);
  if (!bytesEqual(u.feedId, SOL_USD_FEED_ID)) throw new ChainCheckError("PriceFeedMismatch", "not the SOL/USD feed");
  if (u.price <= 0n || u.emaPrice <= 0n) throw new ChainCheckError("StalePrice", "non-positive price");
  if (u.expo < -12 || u.expo > 0) throw new ChainCheckError("StalePrice", `unsupported exponent ${u.expo}`);
  if (p.maxPriceAgeSecs <= 0) throw new ChainCheckError("InvalidConfig", "max_price_age_secs must be > 0 with Pyth");
  if (p.nowUnix - u.publishTime > BigInt(p.maxPriceAgeSecs)) throw new ChainCheckError("StalePrice", "price too old");
  if (u.conf * 10_000n > u.price * BigInt(p.maxConfBps)) {
    throw new ChainCheckError("PriceTooUncertain", "confidence interval too wide");
  }
  const p0 = u.price < u.emaPrice ? u.price : u.emaPrice;
  return pythToUsdE6(p0, u.expo);
}
