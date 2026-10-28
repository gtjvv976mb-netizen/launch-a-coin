import { describe, expect, test } from "bun:test";
import { DESIGN_ROW_SIZE, designRow, enterTarget, firstProblem, quickBuyAmounts, sameAmount } from "../../src/components/carddex/launch-form";
import { walletNoticeItems, walletNoticePreview, WALLET_NOTICE_COPY } from "../../src/components/carddex/live/wallet-notice";
import { CARD_DESIGNS, isCardDesignKey } from "../../src/lib/carddex/designs";
import { allowedQuotesForDesign, boundQuoteForDesign } from "../../src/lib/carddex/pairs";
import { maxInitialBuyQuoteAtoms } from "../../src/lib/carddex/quote-simulation";

// The one-page Launch form (routes/launch.tsx): the suggested-design row, the quick initial-buy amounts, and where
// focus goes when something is missing. Enter never submits; only the primary does.
describe("the suggested-design row", () => {
  test("seeds from the current design, then designs matched to the quote, then classics that take it, with no repeats", () => {
    const row = designRow(null, "pokemon-classic", "sol");
    expect(row.quote).toBe("sol");
    expect(row.keys[0]).toBe("pokemon-classic");
    expect(row.keys.length).toBe(DESIGN_ROW_SIZE);
    expect(new Set(row.keys).size).toBe(row.keys.length);
    for (const key of row.keys) {
      expect(isCardDesignKey(key)).toBe(true);
      expect(allowedQuotesForDesign(key).some(a => a.key === "sol")).toBe(true);
    }
    // A quote with matched designs puts them right after the current one.
    const doge = designRow(null, "pokemon-classic", "doge");
    expect(doge.keys[0]).toBe("pokemon-classic");
    expect(doge.keys[1]).toBe("doge");
    expect(boundQuoteForDesign(doge.keys[1])?.key).toBe("doge");
  });
  test("holds still while the creator picks inside it", () => {
    const row = designRow(null, "pokemon-classic", "sol");
    for (const key of row.keys) expect(designRow(row, key, "sol")).toBe(row);
  });
  test("a design from the library or the URL takes the first slot; the rest stay put", () => {
    const row = designRow(null, "pokemon-classic", "sol");
    const outside = CARD_DESIGNS.find(d => !row.keys.includes(d.key) && allowedQuotesForDesign(d.key).some(a => a.key === "sol"))!.key;
    const next = designRow(row, outside, "sol");
    expect(next.keys[0]).toBe(outside);
    expect(next.keys.slice(1)).toEqual(row.keys.slice(1));
  });
  test("a new quote seeds the row again", () => {
    const row = designRow(null, "pokemon-classic", "sol");
    const tsla = designRow(row, "stock-tsla", "tslax");
    expect(tsla).not.toBe(row);
    expect(tsla.quote).toBe("tslax");
    expect(tsla.keys[0]).toBe("stock-tsla");
    for (const key of tsla.keys) expect(allowedQuotesForDesign(key).some(a => a.key === "tslax")).toBe(true);
  });
});

describe("quick initial-buy amounts", () => {
  test("the coin page's amounts, in the quote's units, within the demo cap", () => {
    expect(quickBuyAmounts("sol")).toEqual(["0.1", "0.5", "1", "5"]);
    const cap = maxInitialBuyQuoteAtoms("sol");
    expect(quickBuyAmounts("sol", cap)).toEqual(["0.1", "0.5", "1", "5"]);
    expect(quickBuyAmounts("sol", 1_000_000_000)).toEqual(["0.1", "0.5", "1"]);
    expect(quickBuyAmounts("sol", 0)).toEqual([]);
  });
  test("an amount matches whatever way it was typed; empty and 0 are None", () => {
    expect(sameAmount("0.50", "0.5")).toBe(true);
    expect(sameAmount("1", "1")).toBe(true);
    expect(sameAmount("1.5", "1")).toBe(false);
    expect(sameAmount("", "")).toBe(true);
    expect(sameAmount("0", "")).toBe(true);
    expect(sameAmount("0.1", "")).toBe(false);
  });
});

describe("where focus goes", () => {
  const order = (over: Partial<Record<"name" | "ticker" | "art" | "website", boolean>> = {}) =>
    (["name", "ticker", "art", "website"] as const).map(key => ({ key, ok: over[key] ?? true }));
  test("the first field that needs something, in the form's order", () => {
    expect(firstProblem(order({ ticker: false, website: false }))).toBe("ticker");
    expect(firstProblem(order({ art: false }))).toBe("art");
    expect(firstProblem(order())).toBeNull();
  });
  test("Enter moves on to the next problem, or to the primary once everything passes (it never submits)", () => {
    expect(enterTarget(order({ name: false }))).toBe("name");
    expect(enterTarget(order({ art: false }))).toBe("art");
    expect(enterTarget(order())).toBe("primary");
  });
});

describe("what your wallet will show, before anything is prepared", () => {
  const coinPlan = (buy: string) => ({ kind: "token" as const, review: { networkFeeLamports: "10000", priorityFeeLamports: "500", initialBuyQuoteBaseUnits: buy } });
  const sol = { symbol: "SOL", decimals: 9, kind: "native" }, stock = { symbol: "TSLAx", decimals: 8, kind: "stock" };
  const keysOf = (items: { key: string }[]) => items.map(item => item.key);
  // The preview names the fee without its amount; every other line is one the prepared coin plan will also carry.
  const comparable = (keys: string[]) => keys.map(key => (key === "networkFeeLater" ? "networkFee" : key));
  for (const [label, hasBuy, quote] of [["no buy, SOL", false, sol], ["a buy, SOL", true, sol], ["no buy, stock", false, stock], ["a buy, stock", true, stock]] as const) {
    test(`mirrors the coin plan's list (${label})`, () => {
      const preview = keysOf(walletNoticePreview({ hasBuy, quoteKind: quote.kind, siteHost: "launchacard.fun" }));
      const plan = keysOf(walletNoticeItems(coinPlan(hasBuy ? "100000000" : "0") as never, quote, "launchacard.fun"));
      for (const key of comparable(preview)) expect(plan).toContain(key);
      expect(preview[0]).toBe("networkFeeLater");
      expect(preview.includes("stockQuote")).toBe(hasBuy && quote.kind === "stock");
      expect(preview.includes("tokenAccount")).toBe(hasBuy);
    });
  }
  test("is plain: no dashes, and the fee line points at the review", () => {
    expect(WALLET_NOTICE_COPY.networkFeeLater).toBe("A network fee. The exact amount is in your review.");
    for (const item of walletNoticePreview({ hasBuy: true, quoteKind: "stock", siteHost: "launchacard.fun" })) expect(item.text).not.toMatch(/[–—]/);
  });
});
