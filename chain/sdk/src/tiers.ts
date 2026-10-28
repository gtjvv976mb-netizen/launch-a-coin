// Tier math mirrored from card-program-v2 §6 (and v1 math.rs): 14 card designs, 13 USD thresholds for
// levels 2..14, USD = market cap × SOL/USD × multiplier, all in exact integer (u128-checked) arithmetic.
import { ChainCheckError } from "./accounts/types.ts";

export const EVOLUTIONS = 13;
export const MAX_LEVEL = 14;

/** Whole-USD thresholds for levels 2..=14, exactly as `Config.tier_thresholds_usd` stores them. */
export const TIER_THRESHOLDS_USD: readonly bigint[] = [
  15_000n,
  50_000n,
  100_000n,
  150_000n,
  200_000n,
  300_000n,
  400_000n,
  500_000n,
  600_000n,
  700_000n,
  800_000n,
  900_000n,
  1_000_000n,
];

export type TierKey =
  | "spark"
  | "surge"
  | "nova"
  | "tide"
  | "apex"
  | "ember"
  | "bloom"
  | "mythic"
  | "aurora"
  | "relic"
  | "frost"
  | "regal"
  | "celestial"
  | "legend";

export interface TierInfo {
  level: number;
  key: TierKey;
  name: string;
  /** Minimum market cap for this design in micro-USD (level 1 = 0). */
  minUsdE6: bigint;
}

const NAMES: [TierKey, string][] = [
  ["spark", "Spark"],
  ["surge", "Surge"],
  ["nova", "Nova"],
  ["tide", "Tide"],
  ["apex", "Apex"],
  ["ember", "Ember"],
  ["bloom", "Bloom"],
  ["mythic", "Mythic"],
  ["aurora", "Aurora"],
  ["relic", "Relic"],
  ["frost", "Frost"],
  ["regal", "Regal"],
  ["celestial", "Celestial"],
  ["legend", "Legend"],
];

const USD_E6 = 1_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000n;
const U128_MAX = (1n << 128n) - 1n;

/** The 14 level minimums in micro-USD (level 1 = 0), same order as the app's TIERS. */
export const TIER_MIN_USD_E6: readonly bigint[] = [0n, ...TIER_THRESHOLDS_USD.map((t) => t * USD_E6)];

export const TIERS: readonly TierInfo[] = NAMES.map(([key, name], i) => ({
  level: i + 1,
  key,
  name,
  minUsdE6: TIER_MIN_USD_E6[i],
}));

export function tierInfo(level: number): TierInfo {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new RangeError(`level out of range: ${level}`);
  return TIERS[level - 1];
}

/** `mcap_usd_e6 = mcap_lamports × sol_usd_e6 × mcap_multiplier / 1e9` (u128-checked, floor). */
export function mcapUsdE6(mcapLamports: bigint, solUsdE6: bigint, mcapMultiplier: number | bigint): bigint {
  const product = mcapLamports * solUsdE6 * BigInt(mcapMultiplier);
  if (mcapLamports < 0n || solUsdE6 < 0n || product > U128_MAX)
    throw new ChainCheckError("MathOverflow", "u128 overflow");
  return product / LAMPORTS_PER_SOL;
}

/** `live_level = 1 + count(i : tier_thresholds_usd[i] × 1e6 ≤ mcap_usd_e6)`. */
export function levelFor(usdE6: bigint, thresholdsUsd: readonly bigint[] = TIER_THRESHOLDS_USD): number {
  let level = 1;
  for (const t of thresholdsUsd) if (t * USD_E6 <= usdE6) level++;
  return level;
}

export interface PriceParams {
  /** micro-USD per SOL */
  solUsdE6: bigint;
  mcapMultiplier: number | bigint;
  tierThresholdsUsd?: readonly bigint[];
}

export const liveLevel = (mcapLamports: bigint, p: PriceParams): number =>
  levelFor(mcapUsdE6(mcapLamports, p.solUsdE6, p.mcapMultiplier), p.tierThresholdsUsd ?? TIER_THRESHOLDS_USD);

/** Smallest market cap in lamports that reaches `level` (ceil of the inverse of `mcapUsdE6`). */
export function levelMinMcapLamports(level: number, p: PriceParams): bigint {
  const thresholds = p.tierThresholdsUsd ?? TIER_THRESHOLDS_USD;
  if (level <= 1) return 0n;
  if (level > thresholds.length + 1) throw new RangeError(`level out of range: ${level}`);
  const denom = p.solUsdE6 * BigInt(p.mcapMultiplier);
  if (denom <= 0n) throw new RangeError("price × multiplier must be positive");
  const need = thresholds[level - 2] * USD_E6 * LAMPORTS_PER_SOL;
  return (need + denom - 1n) / denom;
}

/** Devnet calibration (card-program-v2 §6, §13 step 7): fixed admin price $118, multiplier 100. */
export const DEVNET_PRICE: PriceParams = { solUsdE6: 118_000_000n, mcapMultiplier: 100 };
/** The UI label devnet USD figures must carry. */
export const DEVNET_USD_LABEL = "devnet ×100 at $118";

/**
 * `price_source = Admin`: `sol_usd_e6`, rejected as stale when `now − updated_at > max_price_age_secs`
 * unless the max age is 0 (devnet).
 */
export function adminSolUsdE6(
  c: { solUsdE6: bigint; solUsdUpdatedAt: bigint; maxPriceAgeSecs: number },
  nowUnix: bigint
): bigint {
  if (c.maxPriceAgeSecs > 0 && nowUnix - c.solUsdUpdatedAt > BigInt(c.maxPriceAgeSecs)) {
    throw new ChainCheckError("StalePrice", "admin price too old");
  }
  return c.solUsdE6;
}
