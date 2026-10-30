import { CURVE_END_TOKENS, SOL_USD, TOKEN_UNIT, TOTAL_SUPPLY_TOKENS, VIRTUAL_TOKENS } from "../mintdex/constants";
import type { Reserves } from "../mintdex/curve";
import { getPairAsset } from "./pairs";

/** Demo math only. These parameters and reference values are not live pump.fun quotes or prices. */
function assetOf(key: string) {
  const asset = getPairAsset(key);
  if (!asset) throw new Error("Choose a supported quote asset.");
  return asset;
}
export function quoteUnit(key: string): number { return 10 ** assetOf(key).decimals; }
function initialQuoteAtoms(key: string): bigint {
  const atoms = BigInt(assetOf(key).initialVirtualQuoteReserves);
  if (atoms <= 0n || atoms * 10n / 3n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The demo quote reserve is outside the safe integer range.");
  return atoms;
}
export function demoQuoteStartBalance(key: string): number { return Number(initialQuoteAtoms(key) * 10n / 3n); }
export function maxInitialBuyQuoteAtoms(key: string): number { return Number(initialQuoteAtoms(key) * 2n / 3n); }

/** The coin page's buy amounts on a SOL coin; every other pair gets the same share of its own curve. */
const SOL_QUICK_BUYS = [0.1, 0.5, 1, 5] as const;

/** A positive amount written as a plain decimal (no exponent), for amounts on the 1-2-5 grid. */
function plainDecimal(value: number, places: number): string {
  return value.toFixed(Math.max(0, places)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * The four quick buy amounts for a pair, in its own units: SOL's 0.1 / 0.5 / 1 / 5 scaled by the pair's starting
 * reserve against SOL's (so each buys about the same share of a fresh curve), each rounded to the nearest 1-2-5 step
 * the pair's decimals can hold, then kept distinct and ascending. SOL itself returns exactly 0.1, 0.5, 1 and 5.
 */
export function quickBuyPresets(key: string): string[] {
  const asset = assetOf(key);
  const scale = (Number(asset.initialVirtualQuoteReserves) / quoteUnit(key)) /
    (Number(assetOf("sol").initialVirtualQuoteReserves) / quoteUnit("sol"));
  const smallest = 10 ** -asset.decimals;
  /** The 1-2-5 steps around a value: 1, 2 and 5 times its power of ten and the next one. */
  const steps = (exp: number) => [1, 2, 5].map((m) => m * 10 ** exp);
  const out: Array<{ value: number; exp: number }> = [];
  for (const base of SOL_QUICK_BUYS) {
    const target = key === "sol" ? base : base * scale;
    const exp = Math.floor(Math.log10(target));
    const candidates = [...steps(exp - 1), ...steps(exp), ...steps(exp + 1)].filter((v) => v >= smallest - smallest / 1e6);
    let pick = candidates.reduce((best, v) => (Math.abs(Math.log(v / target)) < Math.abs(Math.log(best / target)) ? v : best), candidates[0]!);
    // Distinct and ascending: an amount that rounded onto the one before it takes the next step up.
    const previous = out[out.length - 1]?.value;
    if (previous !== undefined && pick <= previous * (1 + 1e-9)) {
      const pe = Math.floor(Math.log10(previous) + 1e-9);
      pick = [...steps(pe), ...steps(pe + 1)].find((v) => v > previous * (1 + 1e-9))!;
    }
    out.push({ value: pick, exp: Math.floor(Math.log10(pick) + 1e-9) });
  }
  return out.map(({ value, exp }) => plainDecimal(value, -exp));
}

/** Exact decimal parsing: reject excess precision and unsafe integer amounts instead of rounding money. */
export function parseQuoteAmount(text: string, key: string): number | null {
  const asset = assetOf(key);
  const input = text.trim();
  if (input.length > 100) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  const [whole = "0", fraction = ""] = input.split(".");
  if (fraction.length > asset.decimals) return null;
  const atoms = BigInt(whole || "0") * BigInt(quoteUnit(key)) + BigInt(fraction.padEnd(asset.decimals, "0") || "0");
  return atoms <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(atoms) : null;
}

/** A plain decimal the quote can hold (digits, one point, at most its decimals): what parseQuoteAmount reads, of any size. */
export function isQuoteDecimal(text: string, key: string): boolean {
  const input = text.trim();
  if (input.length > 100 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return false;
  return (input.split(".")[1] ?? "").length <= assetOf(key).decimals;
}

export function formatQuoteAmount(atoms: number, key: string, maxFractionDigits = 6): string {
  const asset = assetOf(key);
  const value = atoms / quoteUnit(key);
  const maximumFractionDigits = value !== 0 && Math.abs(value) < 10 ** -maxFractionDigits ? asset.decimals : Math.min(asset.decimals, maxFractionDigits);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

/** The legacy vSol field carries quote atoms here; no conversion or native SOL spending occurs. */
export function initialQuoteReserves(key: string): Reserves {
  return { vSol: Number(initialQuoteAtoms(key)), vTok: VIRTUAL_TOKENS };
}

export function quoteUsdReference(key: string): number | null {
  const symbol = assetOf(key).symbol;
  return symbol === "SOL" ? SOL_USD : symbol === "USDC" ? 1 : null;
}

export function quoteMetrics(reserves: Reserves, key: string) {
  const priceQuote = reserves.vSol / quoteUnit(key) / (reserves.vTok / TOKEN_UNIT);
  const mcapQuote = priceQuote * TOTAL_SUPPLY_TOKENS;
  const usdReference = quoteUsdReference(key);
  return {
    priceQuote, mcapQuote,
    mcapUsd: usdReference === null ? null : mcapQuote * usdReference,
    priceSol: usdReference === null ? null : priceQuote * usdReference / SOL_USD,
    valuationMode: usdReference === null ? "quote-native" as const : "demo-reference" as const,
  };
}

export function quoteAtomsToSol(atoms: number, key: string): number | null {
  const usdReference = quoteUsdReference(key);
  return usdReference === null ? null : Math.round(atoms / quoteUnit(key) * usdReference / SOL_USD * 1e9);
}

export function quoteCurveProgress(reserves: Reserves, key: string): number {
  const initial = initialQuoteReserves(key).vSol;
  const end = Math.round(initial * VIRTUAL_TOKENS / CURVE_END_TOKENS);
  return Math.max(0, Math.min(1, (reserves.vSol - initial) / (end - initial)));
}
