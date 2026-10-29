import { describe, expect, test } from "bun:test";
import { PAIR_ASSETS } from "../../src/lib/carddex/pairs";
import { demoQuoteStartBalance, formatQuoteAmount, initialQuoteReserves, maxInitialBuyQuoteAtoms, parseQuoteAmount, quoteAtomsToSol, quoteMetrics, quoteUnit } from "../../src/lib/carddex/quote-simulation";

function decimal(atoms: bigint, unit: bigint, decimals: number) {
  return `${atoms / unit}.${String(atoms % unit).padStart(decimals, "0")}`;
}

describe("quote-native simulation units", () => {
  test("every verified quote parses exact atom precision and rejects overflow or excess precision", () => {
    for (const asset of PAIR_ASSETS) {
      const unit = BigInt(quoteUnit(asset.key));
      const oneAtom = `0.${"0".repeat(asset.decimals - 1)}1`;
      expect(parseQuoteAmount(oneAtom, asset.key)).toBe(1);
      expect(parseQuoteAmount(`1.${"0".repeat(asset.decimals - 1)}1`, asset.key)).toBe(Number(unit) + 1);
      expect(parseQuoteAmount(`${oneAtom}1`, asset.key)).toBeNull();
      expect(parseQuoteAmount("1e3", asset.key)).toBeNull();
      expect(parseQuoteAmount("-1", asset.key)).toBeNull();
      expect(parseQuoteAmount(decimal(BigInt(Number.MAX_SAFE_INTEGER), unit, asset.decimals), asset.key)).toBe(Number.MAX_SAFE_INTEGER);
      expect(parseQuoteAmount(decimal(BigInt(Number.MAX_SAFE_INTEGER) + 1n, unit, asset.decimals), asset.key)).toBeNull();
      expect(formatQuoteAmount(1, asset.key)).not.toBe("0");
    }
    expect(quoteUnit("bonk")).toBe(100_000);
    expect(quoteUnit("usdc")).toBe(1_000_000);
  });

  test("reviewed reserve snapshots and demo grants/caps stay within safe integer accounting", () => {
    for (const asset of PAIR_ASSETS) {
      expect(initialQuoteReserves(asset.key).vSol).toBe(Number(asset.initialVirtualQuoteReserves));
      expect(Number.isSafeInteger(demoQuoteStartBalance(asset.key))).toBe(true);
      expect(Number.isSafeInteger(maxInitialBuyQuoteAtoms(asset.key))).toBe(true);
      expect(maxInitialBuyQuoteAtoms(asset.key)).toBeLessThan(demoQuoteStartBalance(asset.key));
    }
  });

  test("custom stock, meme and collector quotes never acquire an invented SOL or USD conversion", () => {
    for (const asset of PAIR_ASSETS) {
      const metrics = quoteMetrics(initialQuoteReserves(asset.key), asset.key);
      expect(metrics.mcapQuote).toBeGreaterThan(0);
      if (asset.kind === "stock" || asset.kind === "meme" || asset.kind === "collector") {
        expect(metrics.mcapUsd).toBeNull();
        expect(metrics.priceSol).toBeNull();
        expect(metrics.valuationMode).toBe("quote-native");
        expect(quoteAtomsToSol(quoteUnit(asset.key), asset.key)).toBeNull();
      } else expect(metrics.valuationMode).toBe("demo-reference");
    }
  });
  test("collector atom precision stays exact without an invented SOL conversion", () => {
    for (const key of ["cards","sv151"]) {
      expect(parseQuoteAmount("123.000001",key)).toBe(123_000_001);
      expect(parseQuoteAmount("0.0000001",key)).toBeNull();
      expect(formatQuoteAmount(1,key)).toBe("0.000001");
      expect(quoteAtomsToSol(1_000_000,key)).toBeNull();
    }
  });
  test("new meme balances use their actual quote units rather than SOL lamports", () => {
    for (const [key, decimals] of [["pengu", 6], ["giga", 5], ["spx", 8], ["trump", 6], ["useless", 6], ["chillguy", 6]] as const) {
      const unit = 10 ** decimals;
      const amount = `123.${"0".repeat(decimals - 1)}1`;
      expect(quoteUnit(key)).toBe(unit);
      expect(parseQuoteAmount(amount, key)).toBe(123 * unit + 1);
      expect(formatQuoteAmount(1, key)).toBe(`0.${"0".repeat(decimals - 1)}1`);
      expect(parseQuoteAmount(`0.${"0".repeat(decimals)}1`, key)).toBeNull();
      expect(quoteAtomsToSol(123 * unit + 1, key)).toBeNull();
      expect(quoteMetrics(initialQuoteReserves(key), key)).toMatchObject({mcapUsd: null, priceSol: null, valuationMode: "quote-native"});
    }
  });
});
