/**
 * Read-only market state for a launched coin's page (owner request 1 November 2026: price, market cap, bonding-curve
 * progress and holders on the coin page). Nothing here builds, signs or sends a transaction. The app's market endpoint
 * (app/src/lib/carddex/live/market.server.ts) calls these with the server's mainnet connection and caches the answer.
 *
 * Price in quote units: the curve's virtual reserves, vQ / vT (both scaled by their decimals). Market cap: that price
 * times the token's total supply (1B for every pump.fun coin). Progress: 1 - realTokenReserves / the Global account's
 * initialRealTokenReserves, the same figure pump.fun shows. A tokenized-stock quote carries a Token-2022 scaled-UI
 * multiplier, so a raw quote amount is worth `multiplier` UI tokens; the figures here are in UI quote tokens.
 */
import { PublicKey, type AccountInfo, type Connection, type ParsedAccountData } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getScaledUiAmountConfig, unpackAccount, unpackMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  bondingCurvePda, canonicalPumpPoolPda, canonicalPumpPoolPdaWithQuote, GLOBAL_PDA, isBondingCurveMigrated, pumpPoolAuthorityPda, PUMP_SDK,
} from "@pump-fun/pump-sdk";

export type MarketConnection = Pick<Connection, "getMultipleAccountsInfo" | "getTokenLargestAccounts" | "getMultipleParsedAccounts" | "getAccountInfo">;

/** The SOL quote as the curve stores it (the default key). */
const SOL_QUOTE = PublicKey.default.toBase58();
const TOKEN_DECIMALS = 6;

export type CurveMarket = {
  /** "curve": trading on pump.fun's bonding curve; "complete": the curve is full and waits for migration; "migrated": trading on PumpSwap. */
  status: "curve" | "complete" | "migrated";
  /** Price of one token in UI quote tokens (null once migrated: the curve no longer prices it). */
  priceQuote: number | null;
  /** Price times total supply, in UI quote tokens (null once migrated). */
  marketCapQuote: number | null;
  /** 0..1 of the way to graduation; 1 once complete or migrated. */
  progress: number;
  /** Quote tokens deposited into the curve by buyers (UI units): what it can pay out to sellers. */
  reservesQuote: number | null;
  /** Total supply in UI tokens. */
  supply: number;
  /** The pool GeckoTerminal and the trades list follow: the curve account, or the PumpSwap pool after migration. */
  pool: string;
  /** Accounts that hold the coin for the market itself (curve vault owner, pool authority): never ranked as holders. */
  marketOwners: string[];
};

const big = (value: { toString(): string }) => Number(value.toString());

/** The Token-2022 scaled-UI multiplier in force at `nowSec` (1 for a mint without the extension). */
export function quoteMultiplier(info: AccountInfo<Buffer> | null, quoteMint: PublicKey, nowSec: number): number {
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return 1;
  try {
    const config = getScaledUiAmountConfig(unpackMint(quoteMint, info, TOKEN_2022_PROGRAM_ID));
    if (!config) return 1;
    const multiplier = Number(config.newMultiplierEffectiveTimestamp) <= nowSec ? config.newMultiplier : config.multiplier;
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  } catch { return 1; }
}

/**
 * One batched read: the curve, pump.fun's Global account and the quote mint. Null when the coin has no pump.fun curve.
 * `quoteDecimals` comes from the pair the launch recorded.
 */
export async function readCurveMarket(connection: Pick<MarketConnection, "getMultipleAccountsInfo">, input: { mint: string; quoteMint: string; quoteDecimals: number; nowSec?: number }): Promise<CurveMarket | null> {
  const mint = new PublicKey(input.mint), curvePda = bondingCurvePda(mint);
  const quoteMint = new PublicKey(input.quoteMint);
  const sol = input.quoteMint === SOL_QUOTE || input.quoteMint === "So11111111111111111111111111111111111111112";
  const [curveInfo, globalInfo, quoteInfo] = await connection.getMultipleAccountsInfo([curvePda, GLOBAL_PDA, sol ? GLOBAL_PDA : quoteMint]);
  if (!curveInfo || !globalInfo) return null;
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  const global = PUMP_SDK.decodeGlobal(globalInfo);
  const multiplier = sol ? 1 : quoteMultiplier(quoteInfo, quoteMint, input.nowSec ?? Math.floor(Date.now() / 1000));
  const quoteUnit = 10 ** input.quoteDecimals / multiplier, tokenUnit = 10 ** TOKEN_DECIMALS;
  const supply = big(curve.tokenTotalSupply) / tokenUnit;
  const migrated = isBondingCurveMigrated(curve);
  const pool = migrated ? (sol ? canonicalPumpPoolPda(mint) : canonicalPumpPoolPdaWithQuote(mint, quoteMint)) : curvePda;
  const marketOwners = [...new Set([curvePda.toBase58(), pumpPoolAuthorityPda(mint).toBase58(), pool.toBase58()])];
  if (migrated) return { status: "migrated", priceQuote: null, marketCapQuote: null, progress: 1, reservesQuote: null, supply, pool: pool.toBase58(), marketOwners };
  const vT = big(curve.virtualTokenReserves), vQ = big(curve.virtualQuoteReserves);
  const priceQuote = vT > 0 ? (vQ / quoteUnit) / (vT / tokenUnit) : null;
  const initialReal = big(global.initialRealTokenReserves);
  const progress = curve.complete ? 1 : initialReal > 0 ? Math.min(1, Math.max(0, 1 - big(curve.realTokenReserves) / initialReal)) : 0;
  return {
    status: curve.complete ? "complete" : "curve",
    priceQuote,
    marketCapQuote: priceQuote === null ? null : priceQuote * supply,
    progress,
    reservesQuote: big(curve.realQuoteReserves) / quoteUnit,
    supply,
    pool: pool.toBase58(),
    marketOwners,
  };
}

export type TopHolder = { owner: string; amount: number; share: number; market: boolean };

/**
 * The 20 largest token accounts and who owns them. `market` marks the curve or pool's own account (shown, never
 * ranked). Shares are of `supply`.
 */
export async function readTopHolders(connection: Pick<MarketConnection, "getTokenLargestAccounts" | "getMultipleParsedAccounts">, input: { mint: string; supply: number; marketOwners: readonly string[] }): Promise<TopHolder[]> {
  const largest = await connection.getTokenLargestAccounts(new PublicKey(input.mint));
  const accounts = largest.value.filter(entry => (entry.uiAmount ?? 0) > 0);
  if (!accounts.length) return [];
  const parsed = await connection.getMultipleParsedAccounts(accounts.map(entry => entry.address));
  const holders: TopHolder[] = [];
  accounts.forEach((entry, index) => {
    const data = parsed.value[index]?.data as ParsedAccountData | Buffer | undefined;
    const owner = data && !Buffer.isBuffer(data) ? (data.parsed?.info?.owner as string | undefined) : undefined;
    if (!owner) return;
    const amount = entry.uiAmount ?? 0;
    holders.push({ owner, amount, share: input.supply > 0 ? amount / input.supply : 0, market: input.marketOwners.includes(owner) || input.marketOwners.includes(entry.address.toBase58()) });
  });
  return holders;
}

/**
 * How much of a quote token a wallet holds for an initial buy, in base units: the balance of its associated token
 * account, the one pump.fun's buy spends from (0 when it has none). A frozen account counts as 0: it cannot pay.
 */
export async function readQuoteBalance(connection: Pick<MarketConnection, "getAccountInfo">, input: { owner: string; quoteMint: string; tokenProgram: string }): Promise<bigint> {
  const owner = new PublicKey(input.owner), mint = new PublicKey(input.quoteMint), program = new PublicKey(input.tokenProgram);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, program);
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) return 0n;
  const account = unpackAccount(ata, info, program);
  return account.owner.equals(owner) && account.mint.equals(mint) && !account.isFrozen ? account.amount : 0n;
}
