// Constant-product bonding curve over virtual reserves (pump-style).
// Every coin starts at VIRTUAL_SOL / VIRTUAL_TOKENS; buys add SOL and remove
// tokens, sells do the reverse. Rounding always favors the curve.

import {
  CURVE_END_TOKENS,
  LAMPORTS,
  OWNER_FEE_BPS,
  SOL_USD,
  TOKEN_UNIT,
  TOTAL_SUPPLY_TOKENS,
  TRADE_FEE_BPS,
  VIRTUAL_SOL,
  VIRTUAL_TOKENS,
} from "./constants";

export type Reserves = { vSol: number; vTok: number };

export const INITIAL_RESERVES: Reserves = { vSol: VIRTUAL_SOL, vTok: VIRTUAL_TOKENS };

const B = BigInt;

function ceilDiv(a: bigint, b: bigint) {
  return (a + b - 1n) / b;
}

/** Price in SOL per whole token. */
export function priceSol(r: Reserves) {
  return r.vSol / LAMPORTS / (r.vTok / TOKEN_UNIT);
}

export function mcapSol(r: Reserves) {
  return priceSol(r) * TOTAL_SUPPLY_TOKENS;
}

export function mcapUsd(r: Reserves) {
  return mcapSol(r) * SOL_USD;
}

/** Virtual SOL reserve at curve completion. */
export const CURVE_END_VSOL = Math.round((VIRTUAL_SOL * VIRTUAL_TOKENS) / CURVE_END_TOKENS);
/** SOL raised when the curve completes and the coin graduates to a DEX pool. */
export const GRADUATION_SOL = CURVE_END_VSOL - VIRTUAL_SOL;

/** Real SOL raised so far (lamports). */
export function solRaised(r: Reserves) {
  return Math.max(0, r.vSol - VIRTUAL_SOL);
}

/** Graduation progress by SOL raised, 0..1. */
export function curveProgress(r: Reserves) {
  return Math.min(1, solRaised(r) / GRADUATION_SOL);
}

/** Graduated: the pump.fun curve sold out and liquidity moved to PumpSwap. */
export function isGraduated(r: Reserves) {
  return r.vTok <= CURVE_END_TOKENS;
}

export type BuyQuote = {
  ok: boolean;
  reason?: string;
  solIn: number; // total lamports charged (incl. fee)
  fee: number;
  ownerFee: number;
  protocolFee: number;
  tokensOut: number;
  after: Reserves;
  capped: boolean;
};

export function quoteBuy(r: Reserves, solInLamports: number): BuyQuote {
  const empty = {
    solIn: 0,
    fee: 0,
    ownerFee: 0,
    protocolFee: 0,
    tokensOut: 0,
    after: r,
    capped: false,
  };
  if (!Number.isFinite(solInLamports) || solInLamports <= 0) {
    return { ok: false, reason: "Enter an amount", ...empty };
  }

  const vSol = B(r.vSol);
  const vTok = B(r.vTok);
  const k = vSol * vTok;
  const solIn = B(Math.floor(solInLamports));
  const fee = (solIn * B(TRADE_FEE_BPS)) / 10000n;
  const net = solIn - fee;
  const newVSol = vSol + net;
  const newVTok = ceilDiv(k, newVSol);
  const capped = false;

  const tokensOut = vTok - newVTok;
  if (tokensOut <= 0n) return { ok: false, reason: "Amount too small", ...empty };
  const ownerFee = (solIn * B(OWNER_FEE_BPS)) / 10000n;

  return {
    ok: true,
    solIn: Number(solIn),
    fee: Number(fee),
    ownerFee: Number(ownerFee),
    protocolFee: Number(fee - ownerFee),
    tokensOut: Number(tokensOut),
    after: { vSol: Number(newVSol), vTok: Number(newVTok) },
    capped,
  };
}

export type SellQuote = {
  ok: boolean;
  reason?: string;
  tokensIn: number;
  gross: number;
  fee: number;
  ownerFee: number;
  protocolFee: number;
  solOut: number;
  after: Reserves;
};

export function quoteSell(r: Reserves, tokensIn: number): SellQuote {
  const empty = { tokensIn: 0, gross: 0, fee: 0, ownerFee: 0, protocolFee: 0, solOut: 0, after: r };
  if (!Number.isFinite(tokensIn) || tokensIn <= 0) {
    return { ok: false, reason: "Enter an amount", ...empty };
  }
  const vSol = B(r.vSol);
  const vTok = B(r.vTok);
  const k = vSol * vTok;
  const tin = B(Math.floor(tokensIn));
  const newVTok = vTok + tin;
  if (newVTok > B(VIRTUAL_TOKENS)) return { ok: false, reason: "More than the curve holds", ...empty };
  const newVSol = ceilDiv(k, newVTok);
  const gross = vSol - newVSol;
  if (gross <= 0n) return { ok: false, reason: "Amount too small", ...empty };
  const fee = (gross * B(TRADE_FEE_BPS)) / 10000n;
  const ownerFee = (gross * B(OWNER_FEE_BPS)) / 10000n;
  return {
    ok: true,
    tokensIn: Number(tin),
    gross: Number(gross),
    fee: Number(fee),
    ownerFee: Number(ownerFee),
    protocolFee: Number(fee - ownerFee),
    solOut: Number(gross - fee),
    after: { vSol: Number(newVSol), vTok: Number(newVTok) },
  };
}

/** Virtual SOL reserve that corresponds to a USD market cap (for seeding / previews). */
export function vSolForMcapUsd(usd: number) {
  const k = (VIRTUAL_SOL / LAMPORTS) * (VIRTUAL_TOKENS / TOKEN_UNIT);
  const mcapSolTarget = usd / SOL_USD;
  // mcap = vSol^2 / k * supply  (vSol in SOL, vTok = k / vSol)
  const vSol = Math.sqrt((mcapSolTarget * k) / TOTAL_SUPPLY_TOKENS);
  return Math.round(vSol * LAMPORTS);
}

/** Market cap (USD) reached at curve completion. */
export const CURVE_END_MCAP_USD = mcapUsd({ vSol: CURVE_END_VSOL, vTok: CURVE_END_TOKENS });
