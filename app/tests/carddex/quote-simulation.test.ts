import { describe, expect, test } from "bun:test";
import { PAIR_ASSETS, PAIR_ASSET_KEYS } from "../../src/lib/carddex/pairs";
import { quoteCap } from "../../src/lib/carddex/quote-display";
import { demoQuoteStartBalance, formatQuoteAmount, initialQuoteReserves, isQuoteDecimal, maxInitialBuyQuoteAtoms, parseQuoteAmount, quickBuyPresets, quoteAtomsToSol, quoteMetrics, quoteUnit } from "../../src/lib/carddex/quote-simulation";
import { quoteBuy, type BuyQuote } from "../../src/lib/mintdex/curve";
import { cleanAmount, sellShare, typedAmount } from "../../src/lib/mintdex/format";
import { TOKEN_UNIT } from "../../src/lib/mintdex/constants";

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

describe("the initial-buy cap as Launch shows it", () => {
  test("typing back the cap shown is always allowed: rounded down, exact, never compact", () => {
    for (const key of PAIR_ASSET_KEYS) {
      const max = maxInitialBuyQuoteAtoms(key);
      const shown = quoteCap(max, key);
      expect(shown).not.toMatch(/[KMB]/);
      const typed = parseQuoteAmount(shown.replace(/,/g, ""), key);
      expect(typed).not.toBeNull();
      expect(typed!).toBeLessThanOrEqual(max);
    }
    expect(quoteCap(maxInitialBuyQuoteAtoms("doge"), "doge")).toBe("27,781.11");
    expect(quoteCap(maxInitialBuyQuoteAtoms("nvdax"), "nvdax")).toBe("10.10");
    expect(quoteCap(maxInitialBuyQuoteAtoms("sol"), "sol")).toBe("20.00");
    // Below 0.01: two significant digits, still rounded down.
    expect(quoteCap(1_299_999, "sol")).toBe("0.0012");
    expect(quoteCap(0, "sol")).toBe("0");
  });
  test("a plain decimal too large to count is told apart from a malformed one", () => {
    expect(isQuoteDecimal("999999999", "doge")).toBe(true);
    expect(parseQuoteAmount("999999999", "doge")).toBeNull();
    expect(isQuoteDecimal("1.123456789", "doge")).toBe(false);
    expect(isQuoteDecimal("1.2.3", "doge")).toBe(false);
    expect(isQuoteDecimal("12.5", "doge")).toBe(true);
  });
});

describe("the coin page's buy amounts are sized to the pair", () => {
  const tokensFor = (amount: string, key: string) => (quoteBuy(initialQuoteReserves(key), parseQuoteAmount(amount, key)!) as BuyQuote).tokensOut;
  test("SOL keeps 0.1 / 0.5 / 1 / 5", () => {
    expect(quickBuyPresets("sol")).toEqual(["0.1", "0.5", "1", "5"]);
  });
  test("every pair gets four ascending amounts it can hold and afford, the second buying about what 0.5 SOL buys", () => {
    const solTokens = tokensFor("0.5", "sol");
    for (const key of PAIR_ASSET_KEYS) {
      const presets = quickBuyPresets(key);
      expect(presets).toHaveLength(4);
      const atoms = presets.map(amount => parseQuoteAmount(amount, key));
      for (const a of atoms) {
        expect(a).not.toBeNull();
        expect(a!).toBeGreaterThan(0);
        expect(a!).toBeLessThanOrEqual(demoQuoteStartBalance(key));
      }
      for (let i = 1; i < atoms.length; i++) expect(atoms[i]!).toBeGreaterThan(atoms[i - 1]!);
      const share = tokensFor(presets[1]!, key) / solTokens;
      expect(share).toBeGreaterThanOrEqual(0.5);
      expect(share).toBeLessThanOrEqual(2);
    }
    expect(quickBuyPresets("toad")).toEqual(["10000", "50000", "100000", "500000"]);
  });
});

describe("the sell chips are true shares", () => {
  test("25 / 50 / 75% round down to two decimals at every size; Max is the whole holding", () => {
    expect(sellShare(19.88 * TOKEN_UNIT, 0.5)).toBe("9.94");
    expect(sellShare(2_094_660 * TOKEN_UNIT, 0.5)).toBe("1047330");
    expect(sellShare(0.5 * TOKEN_UNIT, 0.25)).toBe("0.12");
    expect(sellShare(19.88 * TOKEN_UNIT, 0.75)).toBe("14.91");
    expect(sellShare(19_880_123, 1)).toBe("19.880123");
    expect(sellShare(0, 0.5)).toBe("");
  });
});

describe("amount fields read a comma decimal", () => {
  test("one comma with one or two digits after it is the decimal point; other commas are dropped", () => {
    expect(cleanAmount("1,5")).toBe("1.5");
    expect(cleanAmount("1,50")).toBe("1.50");
    expect(cleanAmount("1,")).toBe("1");
    expect(cleanAmount("1,500")).toBe("1500");
    expect(cleanAmount("12,345,678")).toBe("12345678");
    expect(cleanAmount("1.5")).toBe("1.5");
    expect(cleanAmount("1.571.6")).toBe("1.5716");
    expect(cleanAmount("1,5", 6)).toBe("1.5");
  });
  test("typed key by key, a thousands comma stays a thousands comma (the field keeps the text; the amount reads it)", () => {
    // The ticket's onChange path: each key goes through typedAmount on what the field already holds.
    const typeKeys = (text: string, decimals = 9) => [...text].reduce((field, key) => typedAmount(field + key, decimals), "");
    expect(typeKeys("1,500")).toBe("1,500");
    expect(cleanAmount(typeKeys("1,500"))).toBe("1500");
    expect(cleanAmount(typeKeys("12,345"))).toBe("12345");
    expect(cleanAmount(typeKeys("10,000"))).toBe("10000");
    expect(cleanAmount(typeKeys("12,345,678"))).toBe("12345678");
    expect(cleanAmount(typeKeys("1,5"))).toBe("1.5");
    expect(cleanAmount(typeKeys("1,50"))).toBe("1.50");
    expect(cleanAmount(typeKeys("1,234.56", 6))).toBe("1234.56");
    // Every prefix of "10,000" reads as a number on the way ("1," is 1, "10,0" is 10.0), never a dead field.
    for (const prefix of ["1", "10", "10,", "10,0", "10,00", "10,000"]) expect(Number(cleanAmount(typeKeys(prefix)))).not.toBeNaN();
    // The point still caps decimals and drops a second point or a comma after it.
    expect(typeKeys("1.2345678", 6)).toBe("1.234567");
    expect(typeKeys("1.2.3,4")).toBe("1.234");
    expect(typeKeys("1a,5b")).toBe("1,5");
  });
});
