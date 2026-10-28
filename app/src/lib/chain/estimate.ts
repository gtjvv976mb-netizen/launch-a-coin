// Display-only trade estimates for the devnet trade ticket and the Launch dev buy (refs/chain/m3-contract.md §2.2):
// what a buy or sell would roughly return while the person types. The transaction itself is sized by the chain
// Worker and checked by the client's verifier against the person's own bounds; nothing here reaches a transaction.
//
// Owner: app:pages. Kept apart from adapt.ts so the SDK quote math loads with the coin and launch pages only, not
// with every page's loader (main chunk budget, m3-contract §0 rule 6).

import {
  quoteCurveBuyExactSol,
  quoteCurveSell,
  quotePoolBuyExactQuote,
  quotePoolSell,
  type FeeBps,
} from "@mintdex/chain-sdk/quote";
import type { ApiCurveState, ApiPoolState } from "@mintdex/chain-sdk/api";

import { big } from "./adapt";
import { IS_MAINNET } from "../mintdex/mode";

/** A selected dev buy remains part of the signed request and cost even while its token estimate is unavailable. */
export function devBuyPlan(amount: number, maxAmount: number, slippageBps: number): { amountLamports: bigint; maxSolLamports: number } {
  const selected = Number.isSafeInteger(amount) && amount > 0 && amount <= maxAmount;
  return {
    amountLamports: selected ? BigInt(amount) : 0n,
    maxSolLamports: selected ? Math.ceil((amount * (10_000 + slippageBps)) / 10_000) : 0,
  };
}

/** pump fees on devnet (pump_fees FeeConfig 8Wf5Ti…, one tier): 0.95% protocol + 0.30% creator, display only. */
export const DEVNET_PUMP_FEES: FeeBps = { lpFeeBps: 0n, protocolFeeBps: 95n, creatorFeeBps: 30n };

/** PumpSwap fee tier by market cap (pump_fees FeeConfig 5PHirr…, pump-devnet-facts §10), display only. */
export function devnetPoolFees(mcapLamports: number): FeeBps {
  return mcapLamports < 420e9
    ? { lpFeeBps: 2n, protocolFeeBps: 93n, creatorFeeBps: 30n }
    : { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 95n };
}

// ---------------------------------------------------------------- trade estimates (display only)

export type TradeEstimate = {
  /** Tokens out (buy) or in (sell), base units. */
  tokens: number;
  /** Lamports in (buy, fees included) or out (sell, after fees). */
  sol: number;
  /** Total fee in lamports (protocol + creator + lp). */
  fee: number;
  /** The card's share of the fee (the creator fee that fills the fee vault). */
  cardFee: number;
  /** 0..1, the price move this trade causes. */
  impact: number;
  mcapAfterLamports: number;
};

export type CurveIn = {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
};

/** A launch preview needs current initial reserves; an unavailable quote never supplies a numeric market cap. */
export function estimateLaunchPreview(
  source: { reserves: CurveIn; fees: FeeBps } | null,
  devBuyLamports: number,
): { devBuy: TradeEstimate | null; mcapLamports: number | null } {
  const unavailable = { devBuy: null, mcapLamports: null };
  if (!source || !Number.isSafeInteger(devBuyLamports) || devBuyLamports < 0) return unavailable;
  const { reserves } = source;
  if (reserves.complete || reserves.virtualSolReserves <= 0n || reserves.virtualTokenReserves <= 0n || reserves.tokenTotalSupply <= 0n)
    return unavailable;
  const devBuy = devBuyLamports > 0 ? estimateCurveBuy(reserves, devBuyLamports, source.fees) : null;
  const mcapLamports = devBuyLamports > 0
    ? devBuy?.mcapAfterLamports ?? null
    : (Number(reserves.virtualSolReserves) / Number(reserves.virtualTokenReserves)) * Number(reserves.tokenTotalSupply);
  return mcapLamports !== null && Number.isFinite(mcapLamports) && mcapLamports > 0
    ? { devBuy, mcapLamports }
    : unavailable;
}

export function curveIn(c: ApiCurveState): CurveIn {
  return {
    virtualSolReserves: big(c.virtualSolReserves),
    virtualTokenReserves: big(c.virtualTokenReserves),
    realSolReserves: big(c.realSolReserves),
    realTokenReserves: big(c.realTokenReserves),
    tokenTotalSupply: big(c.tokenTotalSupply),
    complete: c.complete,
  };
}

const totalBps = (f: FeeBps) => Number(f.lpFeeBps + f.protocolFeeBps + f.creatorFeeBps);

/** Curve price impact: price after over price before, minus 1. */
function curveImpact(c: CurveIn, solDelta: number, tokDelta: number) {
  const vs = Number(c.virtualSolReserves);
  const vt = Number(c.virtualTokenReserves);
  const before = vs / vt;
  const after = (vs + solDelta) / (vt - tokDelta);
  return before > 0 && Number.isFinite(after) ? after / before - 1 : 0;
}

/**
 * A curve buy spending at most `solIn` lamports. The SDK quote (pump-sdk math, worker:core) when it is
 * available, else the constant-product estimate with the fee taken from the input. The transaction itself is
 * sized by the Worker and checked by the client's verifier against the user's own bounds; this is what the
 * ticket shows while typing.
 */
export function estimateCurveBuy(c: CurveIn, solIn: number, fees: FeeBps | null = IS_MAINNET ? null : DEVNET_PUMP_FEES): TradeEstimate | null {
  if (!fees || !(solIn > 0) || c.complete) return null;
  const bps = totalBps(fees);
  try {
    const q = quoteCurveBuyExactSol(c, fees, BigInt(Math.floor(solIn)));
    const tokens = Number(q.tokens);
    const net = Number(q.sol) - Number(q.protocolFee + q.creatorFee + q.lpFee);
    return {
      tokens,
      sol: Number(q.sol),
      fee: Number(q.protocolFee + q.creatorFee + q.lpFee),
      cardFee: Number(q.creatorFee),
      impact: q.priceImpactBps / 10_000 || curveImpact(c, net, tokens),
      mcapAfterLamports: Number(q.mcapAfterLamports),
    };
  } catch {
    if (IS_MAINNET) return null;
    // The SDK quote is not there yet (or failed): estimate.
  }
  const net = Math.floor((solIn * 10_000) / (10_000 + bps));
  const vs = Number(c.virtualSolReserves);
  const vt = Number(c.virtualTokenReserves);
  let tokens = Math.floor((net * vt) / (vs + net));
  tokens = Math.min(tokens, Number(c.realTokenReserves));
  if (tokens <= 0) return null;
  const fee = solIn - net;
  const after = { vs: vs + net, vt: vt - tokens };
  return {
    tokens,
    sol: solIn,
    fee,
    cardFee: Math.floor((fee * Number(fees.creatorFeeBps)) / Math.max(1, bps)),
    impact: curveImpact(c, net, tokens),
    mcapAfterLamports: (after.vs / after.vt) * Number(c.tokenTotalSupply),
  };
}

/** A curve sell of `tokens` base units: lamports out after fees. */
export function estimateCurveSell(c: CurveIn, tokens: number, fees: FeeBps | null = IS_MAINNET ? null : DEVNET_PUMP_FEES): TradeEstimate | null {
  if (!fees || !(tokens > 0) || c.complete) return null;
  const bps = totalBps(fees);
  try {
    const q = quoteCurveSell(c, fees, BigInt(Math.floor(tokens)));
    const fee = Number(q.protocolFee + q.creatorFee + q.lpFee);
    return {
      tokens,
      sol: Number(q.sol),
      fee,
      cardFee: Number(q.creatorFee),
      impact: q.priceImpactBps / 10_000 || Math.abs(curveImpact(c, -(Number(q.sol) + fee), -tokens)),
      mcapAfterLamports: Number(q.mcapAfterLamports),
    };
  } catch {
    if (IS_MAINNET) return null;
    // estimate below
  }
  const vs = Number(c.virtualSolReserves);
  const vt = Number(c.virtualTokenReserves);
  const gross = Math.floor((tokens * vs) / (vt + tokens));
  const fee = Math.ceil((gross * bps) / 10_000);
  const after = { vs: vs - gross, vt: vt + tokens };
  return {
    tokens,
    sol: Math.max(0, gross - fee),
    fee,
    cardFee: Math.floor((fee * Number(fees.creatorFeeBps)) / Math.max(1, bps)),
    impact: Math.abs(after.vs / after.vt / (vs / vt) - 1),
    mcapAfterLamports: (after.vs / after.vt) * Number(c.tokenTotalSupply),
  };
}

export type PoolIn = { baseAmount: bigint; quoteAmount: bigint; virtualQuoteReserves: bigint; mintSupply: bigint };

export function poolIn(p: ApiPoolState): PoolIn {
  return {
    baseAmount: big(p.baseAmount),
    quoteAmount: big(p.quoteAmount),
    virtualQuoteReserves: big(p.virtualQuoteReserves),
    mintSupply: big(p.mintSupply),
  };
}

function poolMcap(p: PoolIn) {
  const base = Number(p.baseAmount);
  const quote = Number(p.quoteAmount + p.virtualQuoteReserves);
  return base > 0 ? (quote / base) * Number(p.mintSupply) : 0;
}

/** A PumpSwap buy with `quoteIn` lamports (fees on top of the swap input, as pump-swap-sdk buyQuoteInput). */
export function estimatePoolBuy(p: PoolIn, quoteIn: number, fees: FeeBps | null = IS_MAINNET ? null : devnetPoolFees(poolMcap(p))): TradeEstimate | null {
  if (!fees || !(quoteIn > 0)) return null;
  const bps = totalBps(fees);
  try {
    const q = quotePoolBuyExactQuote(p, fees, BigInt(Math.floor(quoteIn)));
    return {
      tokens: Number(q.tokens),
      sol: Number(q.sol),
      fee: Number(q.protocolFee + q.creatorFee + q.lpFee),
      cardFee: Number(q.creatorFee),
      impact: q.priceImpactBps / 10_000,
      mcapAfterLamports: Number(q.mcapAfterLamports),
    };
  } catch {
    if (IS_MAINNET) return null;
    // estimate below
  }
  const base = Number(p.baseAmount);
  const quote = Number(p.quoteAmount + p.virtualQuoteReserves);
  const net = Math.floor((quoteIn * 10_000) / (10_000 + bps));
  const tokens = Math.floor((net * base) / (quote + net));
  if (tokens <= 0) return null;
  const fee = quoteIn - net;
  const afterPrice = (quote + net) / (base - tokens);
  return {
    tokens,
    sol: quoteIn,
    fee,
    cardFee: Math.floor((fee * Number(fees.creatorFeeBps)) / Math.max(1, bps)),
    impact: afterPrice / (quote / base) - 1,
    mcapAfterLamports: afterPrice * Number(p.mintSupply),
  };
}

/** A PumpSwap sell of `tokens` base units: lamports out after fees. */
export function estimatePoolSell(p: PoolIn, tokens: number, fees: FeeBps | null = IS_MAINNET ? null : devnetPoolFees(poolMcap(p))): TradeEstimate | null {
  if (!fees || !(tokens > 0)) return null;
  const bps = totalBps(fees);
  try {
    const q = quotePoolSell(p, fees, BigInt(Math.floor(tokens)));
    return {
      tokens,
      sol: Number(q.sol),
      fee: Number(q.protocolFee + q.creatorFee + q.lpFee),
      cardFee: Number(q.creatorFee),
      impact: Math.abs(q.priceImpactBps / 10_000),
      mcapAfterLamports: Number(q.mcapAfterLamports),
    };
  } catch {
    if (IS_MAINNET) return null;
    // estimate below
  }
  const base = Number(p.baseAmount);
  const quote = Number(p.quoteAmount + p.virtualQuoteReserves);
  const gross = Math.floor((tokens * quote) / (base + tokens));
  const fee = Math.ceil((gross * bps) / 10_000);
  const afterPrice = (quote - gross) / (base + tokens);
  return {
    tokens,
    sol: Math.max(0, gross - fee),
    fee,
    cardFee: Math.floor((fee * Number(fees.creatorFeeBps)) / Math.max(1, bps)),
    impact: Math.abs(afterPrice / (quote / base) - 1),
    mcapAfterLamports: afterPrice * Number(p.mintSupply),
  };
}
