// Trade quotes for pump curves and the canonical PumpSwap pool (refs/chain/m3-contract.md §3.6, §7.3).
// The chain Worker sizes trade instructions with these, and the app shows live quotes and checks the Worker's
// amounts against the user's bounds. card-program-v2 §18.4 note 12: pump-sdk's quote math was not ported in M1.
//
// Owner: worker:core (signatures frozen by the contract). Rules:
//   - import only from ./bytes.ts (this module is allowed in the app's main chunk: no noble, PDAs or IDL);
//   - results equal @pump-fun/pump-sdk 2.0.0 (getBuyTokenAmountFromSolAmount, getBuySolAmountFromTokenAmount,
//     getSellSolAmountFromTokenAmount with the live Global + FeeConfig) and @pump-fun/pump-swap-sdk 1.20.0
//     (buyQuoteInput / sellBaseInput math, fee tiers by market cap) on recorded fixtures, to the lamport
//     (test/quote.test.ts);
//   - fees come from the pump_fees FeeConfig accounts (pump 8Wf5Ti…: one tier lp 0 / protocol 95 / creator 30 on
//     devnet; pAMM 5PHirr…: tiers by market cap, refs/chain/pump-devnet-facts.md §4 and §10);
//   - MintDex coins always have a creator (the card vault), so the creator fee is always charged (pump-sdk charges
//     it when the curve's creator is set or the curve is new; pump-swap-sdk when the pool's coin_creator is set).
import { ByteReader, bytesEqual } from "./bytes.ts";

export interface FeeBps {
  lpFeeBps: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
}

export interface FeeTier extends FeeBps {
  /** Market cap in lamports from which this tier applies. */
  marketCapLamportsThreshold: bigint;
}

/** pump_fees `FeeConfig` (one account for pump, one for PumpSwap). */
export interface FeeConfigAccount {
  flatFees: FeeBps;
  feeTiers: FeeTier[];
}

export interface CurveReserves {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export interface PoolReserves {
  baseAmount: bigint;
  quoteAmount: bigint;
  virtualQuoteReserves: bigint;
  /** Live coin mint supply (the boost bot burns tokens). */
  mintSupply: bigint;
}

export interface QuoteResult {
  /** Tokens (base units) the user receives (buys) or gives (sells). */
  tokens: bigint;
  /** Lamports the user pays including fees (buys) or receives after fees (sells). */
  sol: bigint;
  protocolFee: bigint;
  creatorFee: bigint;
  lpFee: bigint;
  priceImpactBps: number;
  mcapAfterLamports: bigint;
}

/** pump_fees FeeConfig account discriminator (sha256("account:FeeConfig")[0..8]). */
export const FEE_CONFIG_DISCRIMINATOR = Uint8Array.of(143, 52, 146, 187, 219, 123, 76, 155);
/** pump-sdk ONE_BILLION_SUPPLY: the market-cap basis of non-mayhem curve fees. */
export const PUMP_FEE_SUPPLY_BASIS = 1_000_000_000_000_000n;

const BPS = 10_000n;
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
/** pump / pAMM fee: ceil(amount × bps / 10000). */
const feeOf = (amount: bigint, bps: bigint): bigint => ceilDiv(amount * bps, BPS);
const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);

function readFees(r: ByteReader): FeeBps {
  return { lpFeeBps: r.u64(), protocolFeeBps: r.u64(), creatorFeeBps: r.u64() };
}

/** Decodes a pump_fees FeeConfig account. */
export function decodeFeeConfig(data: Uint8Array): FeeConfigAccount {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), FEE_CONFIG_DISCRIMINATOR)) {
    throw new Error("not a pump_fees FeeConfig");
  }
  const r = new ByteReader(data, 8);
  r.u8(); // bump
  r.bytes(32); // admin
  const flatFees = readFees(r);
  const n = r.u32();
  if (n > 64) throw new Error(`FeeConfig has ${n} tiers`);
  const feeTiers: FeeTier[] = [];
  for (let i = 0; i < n; i++) {
    const marketCapLamportsThreshold = r.u128();
    feeTiers.push({ marketCapLamportsThreshold, ...readFees(r) });
  }
  return { flatFees, feeTiers };
}

/** Fee bps that apply at `mcapLamports` (tier lookup, same rule as pump-sdk computeFeesBps / calculateFeeTier). */
export function feesForMarketCap(cfg: FeeConfigAccount, mcapLamports: bigint): FeeBps {
  const tiers = cfg.feeTiers;
  if (tiers.length === 0) return { ...cfg.flatFees };
  const pick = (t: FeeTier): FeeBps => ({
    lpFeeBps: t.lpFeeBps,
    protocolFeeBps: t.protocolFeeBps,
    creatorFeeBps: t.creatorFeeBps,
  });
  if (mcapLamports < tiers[0].marketCapLamportsThreshold) return pick(tiers[0]);
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (mcapLamports >= tiers[i].marketCapLamportsThreshold) return pick(tiers[i]);
  }
  return pick(tiers[0]);
}

/** The market cap pump's fee tier uses for a non-mayhem curve: 1e15 × vSol / vTok (pump-sdk getFee). */
export function curveFeeMarketCap(c: Pick<CurveReserves, "virtualSolReserves" | "virtualTokenReserves">): bigint {
  if (c.virtualTokenReserves === 0n) return 0n;
  return (PUMP_FEE_SUPPLY_BASIS * c.virtualSolReserves) / c.virtualTokenReserves;
}

/** The market cap pAMM's fee tier uses: (quote + virtual quote) × live supply / base (pump-swap-sdk poolMarketCap). */
export function poolFeeMarketCap(p: PoolReserves): bigint {
  if (p.baseAmount === 0n) return 0n;
  return ((p.quoteAmount + p.virtualQuoteReserves) * p.mintSupply) / p.baseAmount;
}

const curveMcap = (supply: bigint, vSol: bigint, vTok: bigint): bigint => (vTok === 0n ? 0n : (supply * vSol) / vTok);

/** Price impact in bps of paying `sol` for `tokens` against the spot price vSol / vTok (positive = worse than spot). */
function impactBps(sol: bigint, tokens: bigint, vSol: bigint, vTok: bigint, side: "buy" | "sell"): number {
  if (tokens === 0n || vTok === 0n || vSol === 0n) return 0;
  // avg = sol / tokens, spot = vSol / vTok; impact = (avg − spot) / spot = sol × vTok / (tokens × vSol) − 1
  const ratio = (sol * vTok * BPS) / (tokens * vSol);
  const bps = side === "buy" ? ratio - BPS : BPS - ratio;
  return Number(bps < 0n ? 0n : bps > 1_000_000n ? 1_000_000n : bps);
}

function assertCurve(c: CurveReserves) {
  if (c.virtualTokenReserves === 0n) throw new Error("curve has migrated (virtual token reserves are 0)");
}

/** Lamports (fees included) to buy exactly `tokens` from the curve (pump-sdk getBuySolAmountFromTokenAmount). */
export function quoteCurveBuyTokens(c: CurveReserves, fees: FeeBps, tokens: bigint): QuoteResult {
  assertCurve(c);
  const amount = minBig(tokens, c.realTokenReserves);
  if (amount <= 0n) {
    return { tokens: 0n, sol: 0n, protocolFee: 0n, creatorFee: 0n, lpFee: 0n, priceImpactBps: 0, mcapAfterLamports: curveMcap(c.tokenTotalSupply, c.virtualSolReserves, c.virtualTokenReserves) };
  }
  const solCost = (amount * c.virtualSolReserves) / (c.virtualTokenReserves - amount) + 1n;
  const protocolFee = feeOf(solCost, fees.protocolFeeBps);
  const creatorFee = feeOf(solCost, fees.creatorFeeBps);
  return {
    tokens: amount,
    sol: solCost + protocolFee + creatorFee,
    protocolFee,
    creatorFee,
    lpFee: 0n,
    priceImpactBps: impactBps(solCost, amount, c.virtualSolReserves, c.virtualTokenReserves, "buy"),
    mcapAfterLamports: curveMcap(c.tokenTotalSupply, c.virtualSolReserves + solCost, c.virtualTokenReserves - amount),
  };
}

/** Curve buy spending at most `solIn` lamports (fees included): tokens out (pump-sdk getBuyTokenAmountFromSolAmount). */
export function quoteCurveBuyExactSol(c: CurveReserves, fees: FeeBps, solIn: bigint): QuoteResult {
  assertCurve(c);
  if (solIn <= 0n) return quoteCurveBuyTokens(c, fees, 0n);
  const totalFeeBps = fees.protocolFeeBps + fees.creatorFeeBps;
  const inputAmount = ((solIn - 1n) * BPS) / (totalFeeBps + BPS);
  const tokensOut = (inputAmount * c.virtualTokenReserves) / (c.virtualSolReserves + inputAmount);
  return quoteCurveBuyTokens(c, fees, minBig(tokensOut, c.realTokenReserves));
}

/** Lamports after fees for selling `tokens` to the curve (pump-sdk getSellSolAmountFromTokenAmount). */
export function quoteCurveSell(c: CurveReserves, fees: FeeBps, tokens: bigint): QuoteResult {
  assertCurve(c);
  if (tokens <= 0n) {
    return { tokens: 0n, sol: 0n, protocolFee: 0n, creatorFee: 0n, lpFee: 0n, priceImpactBps: 0, mcapAfterLamports: curveMcap(c.tokenTotalSupply, c.virtualSolReserves, c.virtualTokenReserves) };
  }
  const solOut = (tokens * c.virtualSolReserves) / (c.virtualTokenReserves + tokens);
  const protocolFee = feeOf(solOut, fees.protocolFeeBps);
  const creatorFee = feeOf(solOut, fees.creatorFeeBps);
  const net = solOut - protocolFee - creatorFee;
  return {
    tokens,
    sol: net > 0n ? net : 0n,
    protocolFee,
    creatorFee,
    lpFee: 0n,
    priceImpactBps: impactBps(solOut, tokens, c.virtualSolReserves, c.virtualTokenReserves, "sell"),
    mcapAfterLamports: curveMcap(c.tokenTotalSupply, c.virtualSolReserves - solOut, c.virtualTokenReserves + tokens),
  };
}

function assertPool(p: PoolReserves) {
  if (p.baseAmount === 0n || p.quoteAmount === 0n) throw new Error("pool reserves cannot be zero");
}

/** Cost (fees included) of buying exactly `base` tokens from the pool (pump-swap-sdk buyBaseInput uiQuote). */
function poolBuyBaseCost(p: PoolReserves, fees: FeeBps, base: bigint) {
  const effQuote = p.quoteAmount + p.virtualQuoteReserves;
  if (base >= p.baseAmount) throw new Error("cannot buy more tokens than the pool holds");
  const quoteIn = ceilDiv(effQuote * base, p.baseAmount - base);
  const lpFee = feeOf(quoteIn, fees.lpFeeBps);
  const protocolFee = feeOf(quoteIn, fees.protocolFeeBps);
  const creatorFee = feeOf(quoteIn, fees.creatorFeeBps);
  return { quoteIn, lpFee, protocolFee, creatorFee, total: quoteIn + lpFee + protocolFee + creatorFee };
}

/** PumpSwap buy with `quoteIn` lamports of WSOL (pump-swap-sdk buyQuoteInput). */
export function quotePoolBuyExactQuote(p: PoolReserves, fees: FeeBps, quoteIn: bigint): QuoteResult {
  assertPool(p);
  const effQuote = p.quoteAmount + p.virtualQuoteReserves;
  const totalFeeBps = fees.lpFeeBps + fees.protocolFeeBps + fees.creatorFeeBps;
  let effective = (quoteIn * BPS) / (BPS + totalFeeBps);
  const withFees =
    effective + feeOf(effective, fees.lpFeeBps) + feeOf(effective, fees.protocolFeeBps) + feeOf(effective, fees.creatorFeeBps);
  if (withFees > quoteIn) effective -= withFees - quoteIn;
  const input = effective - 1n;
  const base = input > 0n ? (p.baseAmount * input) / (effQuote + input) : 0n;
  if (base <= 0n) {
    return { tokens: 0n, sol: 0n, protocolFee: 0n, creatorFee: 0n, lpFee: 0n, priceImpactBps: 0, mcapAfterLamports: poolFeeMarketCap(p) };
  }
  const cost = poolBuyBaseCost(p, fees, base);
  return {
    tokens: base,
    sol: cost.total,
    protocolFee: cost.protocolFee,
    creatorFee: cost.creatorFee,
    lpFee: cost.lpFee,
    priceImpactBps: impactBps(cost.quoteIn, base, effQuote, p.baseAmount, "buy"),
    mcapAfterLamports: poolFeeMarketCap({
      ...p,
      baseAmount: p.baseAmount - base,
      quoteAmount: p.quoteAmount + cost.quoteIn + cost.lpFee,
    }),
  };
}

/** PumpSwap sell of `baseIn` tokens (pump-swap-sdk sellBaseInput). Throws when the pool's real quote cannot pay it. */
export function quotePoolSell(p: PoolReserves, fees: FeeBps, baseIn: bigint): QuoteResult {
  assertPool(p);
  const effQuote = p.quoteAmount + p.virtualQuoteReserves;
  if (baseIn <= 0n) {
    return { tokens: 0n, sol: 0n, protocolFee: 0n, creatorFee: 0n, lpFee: 0n, priceImpactBps: 0, mcapAfterLamports: poolFeeMarketCap(p) };
  }
  const quoteOut = (effQuote * baseIn) / (p.baseAmount + baseIn);
  const lpFee = feeOf(quoteOut, fees.lpFeeBps);
  const protocolFee = feeOf(quoteOut, fees.protocolFeeBps);
  const creatorFee = feeOf(quoteOut, fees.creatorFeeBps);
  if (p.quoteAmount < quoteOut - lpFee) throw new Error("Insufficient real quote reserves to cover the sell output.");
  const net = quoteOut - lpFee - protocolFee - creatorFee;
  if (net < 0n) throw new Error("Fees exceed total output; final quote is negative.");
  return {
    tokens: baseIn,
    sol: net,
    protocolFee,
    creatorFee,
    lpFee,
    priceImpactBps: impactBps(quoteOut, baseIn, effQuote, p.baseAmount, "sell"),
    mcapAfterLamports: poolFeeMarketCap({
      ...p,
      baseAmount: p.baseAmount + baseIn,
      quoteAmount: p.quoteAmount - (quoteOut - lpFee),
    }),
  };
}

/** floor(x × (10000 − bps) / 10000). */
export function slippageFloor(x: bigint, bps: number): bigint {
  return (x * BigInt(10_000 - bps)) / 10_000n;
}

/** ceil(x × (10000 + bps) / 10000). */
export function slippageCeil(x: bigint, bps: number): bigint {
  return (x * BigInt(10_000 + bps) + 9_999n) / 10_000n;
}

/** Devnet create_v2 initial real token reserves (793.1M tokens, 6 decimals). */
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

/** 0..10000: share of the curve's initial real tokens sold (10000 once complete). */
export function curveProgressBps(c: Pick<CurveReserves, "realTokenReserves" | "complete">): number {
  if (c.complete || c.realTokenReserves <= 0n) return 10_000;
  if (c.realTokenReserves >= INITIAL_REAL_TOKEN_RESERVES) return 0;
  return Number(((INITIAL_REAL_TOKEN_RESERVES - c.realTokenReserves) * 10_000n) / INITIAL_REAL_TOKEN_RESERVES);
}
