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

  test("custom stock/meme quotes never acquire an invented SOL or USD conversion", () => {
    for (const asset of PAIR_ASSETS) {
      const metrics = quoteMetrics(initialQuoteReserves(asset.key), asset.key);
      expect(metrics.mcapQuote).toBeGreaterThan(0);
      if (asset.kind === "stock" || asset.kind === "meme") {
        expect(metrics.mcapUsd).toBeNull();
        expect(metrics.priceSol).toBeNull();
        expect(metrics.valuationMode).toBe("quote-native");
        expect(quoteAtomsToSol(quoteUnit(asset.key), asset.key)).toBeNull();
      } else expect(metrics.valuationMode).toBe("demo-reference");
    }
  });
});
