// Market-cap readers. The formulas match pump-sdk `bondingCurveMarketCap` and pump-swap-sdk `poolMarketCap`
// (effective quote = real quote + virtual quote); the account checks mirror the MintDex program's
// on-chain reads (card-program-v2 §5.1 and §5.2), so the UI, the crank and the program agree on the level.
import { toAddress } from "./address.ts";
import type { Address, AddressLike } from "./address.ts";
import { bytesEqual, readU64, U64_MAX } from "./bytes.ts";
import {
  ACCOUNT_DISC,
  MINTDEX_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "./constants.ts";
import { BONDING_CURVE_MIN_FULL_LEN, decodeBondingCurve } from "./accounts/pump.ts";
import type { BondingCurve } from "./accounts/pump.ts";
import { decodePool, POOL_MIN_LEN } from "./accounts/pamm.ts";
import type { Pool } from "./accounts/pamm.ts";
import { ChainCheckError } from "./accounts/types.ts";
import type { AccountData } from "./accounts/types.ts";
import { bondingCurvePda, canonicalPoolPda, cardVaultPda } from "./pda.ts";

const U128_MAX = (1n << 128n) - 1n;
const ZERO_KEY = "11111111111111111111111111111111";
/** `PoolTooThin` floor: 1,000 tokens of 6 decimals (card-program-v2 §5.2). */
export const POOL_MIN_BASE_AMOUNT = 1_000_000_000n;

function checkedU128(v: bigint): bigint {
  if (v < 0n || v > U128_MAX) throw new ChainCheckError("MathOverflow", "u128 overflow");
  return v;
}

/** Curve market cap in lamports: `supply × vSol / vTok` (pump-sdk `bondingCurveMarketCap`). */
export function curveMarketCapLamports(c: {
  tokenTotalSupply: bigint;
  virtualQuoteReserves: bigint;
  virtualTokenReserves: bigint;
}): bigint {
  if (c.virtualTokenReserves === 0n) throw new ChainCheckError("PoolRequired", "curve has migrated (vTok = 0)");
  return checkedU128(c.tokenTotalSupply * c.virtualQuoteReserves) / c.virtualTokenReserves;
}

/** Pool market cap in lamports: `(quote + virtual quote) × live supply / base`, with MintDex's sanity bounds. */
export function poolMarketCapLamports(p: {
  quoteAmount: bigint;
  virtualQuoteReserves: bigint;
  baseAmount: bigint;
  mintSupply: bigint;
}): bigint {
  if (p.virtualQuoteReserves < 0n || p.virtualQuoteReserves > U64_MAX) {
    throw new ChainCheckError("PoolMismatch", "virtual_quote_reserves out of range");
  }
  if (p.baseAmount < POOL_MIN_BASE_AMOUNT) throw new ChainCheckError("PoolTooThin", "pool base below 1e9 units");
  return checkedU128((p.quoteAmount + p.virtualQuoteReserves) * p.mintSupply) / p.baseAmount;
}

// ---------------------------------------------------------------- full readers with on-chain checks

/** §5.1 checks: address = PDA(["bonding-curve", mint]), owner pump, discriminator, length ≥ 125. */
export function readCurveAccount(mint: AddressLike, account: AccountData & { address: Address }): BondingCurve {
  if (account.address !== bondingCurvePda(mint)) throw new ChainCheckError("CurveMismatch", "wrong curve address");
  if (account.owner !== PUMP_PROGRAM_ID) throw new ChainCheckError("CurveMismatch", "curve not owned by pump");
  if (!bytesEqual(account.data.subarray(0, 8), ACCOUNT_DISC.pumpBondingCurve)) {
    throw new ChainCheckError("CurveMismatch", "bad curve discriminator");
  }
  if (account.data.length < BONDING_CURVE_MIN_FULL_LEN) throw new ChainCheckError("CurveMismatch", "curve too short");
  return decodeBondingCurve(account.data);
}

export type RegisterCurveError = "CreatorMismatch" | "UnsupportedCoin";

/**
 * `register_card` coin checks (§5.1 / §7.2): creator == card vault, not mayhem, not cashback, SOL quote,
 * creator_fee_bps == 0 and no holder reward. Returns the failing reasons (empty when registrable).
 */
export function registerCurveProblems(
  mint: AddressLike,
  curve: BondingCurve,
  programId: AddressLike = MINTDEX_PROGRAM_ID
): { code: RegisterCurveError; reason: string }[] {
  const out: { code: RegisterCurveError; reason: string }[] = [];
  if (curve.creator !== cardVaultPda(mint, programId))
    out.push({ code: "CreatorMismatch", reason: "creator != card vault" });
  if (curve.isMayhemMode) out.push({ code: "UnsupportedCoin", reason: "mayhem coin" });
  if (curve.isCashbackCoin) out.push({ code: "UnsupportedCoin", reason: "cashback coin" });
  if (curve.quoteMint !== ZERO_KEY) out.push({ code: "UnsupportedCoin", reason: "non-SOL quote" });
  if (curve.creatorFeeBps !== 0n) out.push({ code: "UnsupportedCoin", reason: "custom creator fee" });
  if (curve.isHolderReward) out.push({ code: "UnsupportedCoin", reason: "holder-reward coin" });
  return out;
}

export interface PoolAccounts {
  pool: AccountData & { address: Address };
  poolBaseTokenAccount: AccountData & { address: Address };
  poolQuoteTokenAccount: AccountData & { address: Address };
  /** The coin mint (Token-2022): its live supply is the market-cap basis. */
  mint: AccountData & { address: Address };
}

export interface PoolReading {
  pool: Pool;
  mcapLamports: bigint;
  baseAmount: bigint;
  quoteAmount: bigint;
  supply: bigint;
  /** `pool.coin_creator` differs from the card vault (sets CREATOR_LOST on chain). */
  creatorLost: boolean;
}

/** §5.2 checks and market cap for the canonical PumpSwap pool. */
export function readPool(
  mintLike: AddressLike,
  a: PoolAccounts,
  programId: AddressLike = MINTDEX_PROGRAM_ID
): PoolReading {
  const mint = toAddress(mintLike);
  if (a.pool.address !== canonicalPoolPda(mint)) throw new ChainCheckError("PoolMismatch", "not the canonical pool");
  if (a.pool.owner !== PAMM_PROGRAM_ID) throw new ChainCheckError("PoolMismatch", "pool not owned by pAMM");
  if (a.pool.data.length < POOL_MIN_LEN || !bytesEqual(a.pool.data.subarray(0, 8), ACCOUNT_DISC.pammPool)) {
    throw new ChainCheckError("PoolMismatch", "bad pool discriminator or length");
  }
  const pool = decodePool(a.pool.data);
  if (pool.baseMint !== mint) throw new ChainCheckError("PoolMismatch", "pool base mint != coin");
  if (pool.quoteMint !== WSOL_MINT) throw new ChainCheckError("PoolMismatch", "pool quote mint != WSOL");
  if (
    a.poolBaseTokenAccount.address !== pool.poolBaseTokenAccount ||
    a.poolBaseTokenAccount.owner !== TOKEN_2022_PROGRAM_ID
  ) {
    throw new ChainCheckError("PoolMismatch", "pool base token account mismatch");
  }
  if (
    a.poolQuoteTokenAccount.address !== pool.poolQuoteTokenAccount ||
    a.poolQuoteTokenAccount.owner !== TOKEN_PROGRAM_ID
  ) {
    throw new ChainCheckError("PoolMismatch", "pool quote token account mismatch");
  }
  if (a.mint.address !== mint || a.mint.owner !== TOKEN_2022_PROGRAM_ID) {
    throw new ChainCheckError("PoolMismatch", "coin mint mismatch");
  }
  const baseAmount = readU64(a.poolBaseTokenAccount.data, 64);
  const quoteAmount = readU64(a.poolQuoteTokenAccount.data, 64);
  const supply = readU64(a.mint.data, 36);
  const mcapLamports = poolMarketCapLamports({
    quoteAmount,
    virtualQuoteReserves: pool.virtualQuoteReserves,
    baseAmount,
    mintSupply: supply,
  });
  return {
    pool,
    mcapLamports,
    baseAmount,
    quoteAmount,
    supply,
    creatorLost: pool.coinCreator !== cardVaultPda(mint, programId),
  };
}

export interface MarketCapReading {
  mcapLamports: bigint;
  source: "curve" | "pool";
  /** Reads come from the pool (the coin graduated). */
  graduated: boolean;
  creatorLost: boolean;
  /** Curve `creator_fee_bps` or `is_holder_reward` became non-zero (sets FEES_CHANGED on chain). */
  feesChanged: boolean;
  curve: BondingCurve | null;
  pool: PoolReading | null;
  /** The canonical pool the program would cache in `card.pool` on this call (no pool cached yet), else null. */
  cachePool?: Address | null;
}

/** True when `data` parses as a pump bonding curve the way pump.rs `parse_curve` does (length and discriminator). */
export function parsesAsCurve(data: Uint8Array): boolean {
  return data.length >= BONDING_CURVE_MIN_FULL_LEN && bytesEqual(data.subarray(0, 8), ACCOUNT_DISC.pumpBondingCurve);
}

/**
 * The evolve market-cap read, exactly as pump.rs `read_market_cap` after the fix pack (fix-plan §2.5, F5 + tier B11):
 * - a pump-owned account that parses as a curve with `vTok > 0` is read as the curve (a complete but unmigrated curve
 *   still counts);
 * - otherwise the pool is read: the cached `card.pool` when there is one (whatever pump did to the curve account),
 *   or, with nothing cached, the canonical pool, but only when the curve is gone (a missing account, or System-owned
 *   with no data); anything else fails closed with `CurveMismatch`;
 * - pool accounts are required on the pool path (`PoolRequired`), and the pool must be the cached one, or the canonical
 *   PDA when nothing is cached (`PoolMismatch`).
 * `bondingCurve` is the raw account at the curve PDA (any owner), or null when it does not exist. `cachePool` is set
 * when the program would cache the pool on this call.
 */
export function readMarketCap(p: {
  mint: AddressLike;
  bondingCurve: (AccountData & { address: Address }) | null;
  pool?: PoolAccounts | null;
  /** `Card.pool` once cached (default address = none). */
  cachedPool?: Address | null;
  programId?: AddressLike;
}): MarketCapReading {
  const programId = p.programId ?? MINTDEX_PROGRAM_ID;
  const mint = toAddress(p.mint);
  const vault = cardVaultPda(mint, programId);
  const cached = p.cachedPool && p.cachedPool !== ZERO_KEY ? p.cachedPool : null;
  const c = p.bondingCurve;
  if (c && c.address !== bondingCurvePda(mint)) throw new ChainCheckError("CurveMismatch", "wrong curve address");
  const parsed = c && c.owner === PUMP_PROGRAM_ID && parsesAsCurve(c.data) ? decodeBondingCurve(c.data) : null;
  if (parsed) {
    if (parsed.virtualTokenReserves > 0n) {
      return {
        mcapLamports: curveMarketCapLamports(parsed),
        source: "curve",
        graduated: false,
        creatorLost: parsed.creator !== vault,
        feesChanged: parsed.creatorFeeBps !== 0n || parsed.isHolderReward,
        curve: parsed,
        pool: null,
        cachePool: null,
      };
    }
  } else if (!cached) {
    // nothing cached: only a gone curve (missing, or System-owned with no data) may fall through to the canonical pool
    const gone = c === null || (c.owner === SYSTEM_PROGRAM_ID && c.data.length === 0);
    if (!gone) throw new ChainCheckError("CurveMismatch", "curve unusable and no cached pool");
  }
  if (!p.pool) throw new ChainCheckError("PoolRequired", "coin migrated: pool accounts required");
  if (cached && p.pool.pool.address !== cached) throw new ChainCheckError("PoolMismatch", "pool is not the cached card.pool");
  const pool = readPool(mint, p.pool, programId);
  return {
    mcapLamports: pool.mcapLamports,
    source: "pool",
    graduated: true,
    creatorLost: pool.creatorLost || (parsed !== null && parsed.creator !== vault),
    feesChanged: parsed !== null && (parsed.creatorFeeBps !== 0n || parsed.isHolderReward),
    curve: parsed,
    pool,
    cachePool: cached ? null : p.pool.pool.address,
  };
}
