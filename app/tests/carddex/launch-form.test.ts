import { describe, expect, test } from "bun:test";
import { DESIGN_ROW_SIZE, designRow, enterTarget, firstProblem, matchFamily, matchedDesignKeys, quickBuyAmounts, sameAmount } from "../../src/components/carddex/launch-form";
import { walletNoticeItems, walletNoticePreview, WALLET_NOTICE_COPY } from "../../src/components/carddex/live/wallet-notice";
import { CARD_DESIGNS, isCardDesignKey } from "../../src/lib/carddex/designs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import { PAIR_ASSETS, allowedQuotesForDesign, boundQuoteForDesign, preferredDesignForQuote } from "../../src/lib/carddex/pairs";
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

// Codex's "Matching meme designs" (the meme-pair chooser), carried by Launch's suggestion row: a stock, meme or
// collector quote names its matched designs over the row, its preferred finish comes right after the current design,
// and each matched swatch is labelled with the quote.
describe("designs matched to the quote", () => {
  const paired = PAIR_ASSETS.filter(a => a.kind === "stock" || a.kind === "meme" || a.kind === "collector");
  test("every stock, meme and collector quote has matched designs, its preferred finish first", () => {
    expect(paired.length).toBe(35);
    expect(paired.filter(a => a.kind === "meme" || a.kind === "collector").length).toBe(28);
    for (const asset of paired) {
      const keys = matchedDesignKeys(asset.key);
      expect(matchFamily(asset.key)).toBe(asset.kind as "stock" | "meme" | "collector");
      expect(keys.length).toBeGreaterThan(0);
      expect(keys[0]).toBe(preferredDesignForQuote(asset.key)!);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        expect(isCardDesignKey(key)).toBe(true);
        expect(allowedQuotesForDesign(key).some(a => a.key === asset.key)).toBe(true);
        // Bound to the quote, or one of its explicit meme-pair presets; never a guess.
        expect(boundQuoteForDesign(key)?.key === asset.key || MEME_PAIR_PRESETS.some(p => p.design === key && p.quote === asset.key)).toBe(true);
      }
    }
  });
  test("SOL, USDC and unknown quotes have none", () => {
    for (const key of ["sol", "usdc", "not-a-quote"]) {
      expect(matchFamily(key)).toBeNull();
      expect(matchedDesignKeys(key)).toEqual([]);
    }
  });
  test("the matches the meme-pair chooser offered", () => {
    expect(matchedDesignKeys("chillhouse")).toEqual(["abyssal"]);
    expect(matchedDesignKeys("cate")).toEqual(["ronin"]);
    expect(matchedDesignKeys("ansem")).toEqual(["sovereign"]);
    expect(matchedDesignKeys("usduc")).toEqual(["surge"]);
    expect(matchedDesignKeys("cards")).toEqual(["obsidian-archive", "pokemon-classic", "pokemon-full-art"]);
    expect(matchedDesignKeys("sv151")).toEqual(["pokemon-classic", "pokemon-full-art"]);
    expect(matchedDesignKeys("doge")).toEqual(["doge"]);
    expect(matchedDesignKeys("tslax")).toEqual(["stock-tsla"]);
    expect(matchFamily("cards")).toBe("collector");
    expect(matchFamily("chillhouse")).toBe("meme");
    expect(matchFamily("tslax")).toBe("stock");
  });
  test("from a design matched to nothing, the row offers every matched design right after it, preferred first", () => {
    const neutral = CARD_DESIGNS.find(d => !boundQuoteForDesign(d.key) && !MEME_PAIR_PRESETS.some(p => p.design === d.key))!.key;
    for (const asset of paired) {
      const keys = matchedDesignKeys(asset.key);
      const row = designRow(null, neutral, asset.key);
      expect(row.keys[0]).toBe(neutral);
      // Slot 2 shows at every width (the row shows 3, 5 or 6 designs).
      expect(row.keys[1]).toBe(preferredDesignForQuote(asset.key)!);
      expect(row.keys.slice(1, 1 + keys.length)).toEqual(keys);
      for (const key of row.keys) expect(allowedQuotesForDesign(key).some(a => a.key === asset.key)).toBe(true);
    }
  });
  test("a matched design already chosen keeps the first slot, and the other matches follow it", () => {
    const row = designRow(null, "pokemon-classic", "cards");
    expect(row.keys.slice(0, 3)).toEqual(["pokemon-classic", "obsidian-archive", "pokemon-full-art"]);
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
  const cardPlan = { kind: "nft" as const, review: { networkFeeLamports: "10000", priorityFeeLamports: "500", initialBuyQuoteBaseUnits: "0" } };
  const sol = { symbol: "SOL", decimals: 9, kind: "native" };
  const keysOf = (items: { key: string }[]) => items.map(item => item.key);
  // The preview names the fee without its amount; every other line is one the prepared coin plan will also carry.
  const comparable = (keys: string[]) => keys.map(key => (key === "networkFeeLater" ? "networkFee" : key));
  for (const [label, hasBuy, oneApproval] of [["no buy", false, false], ["a buy", true, false], ["no buy, one approval", false, true], ["a buy, one approval", true, true]] as const) {
    test(`mirrors the coin plan's list (${label})`, () => {
      const preview = keysOf(walletNoticePreview({ hasBuy, siteHost: "launchacard.fun", oneApproval }));
      const plan = keysOf(walletNoticeItems(coinPlan(hasBuy ? "100000000" : "0") as never, sol, "launchacard.fun", oneApproval ? cardPlan as never : null));
      expect(comparable(preview)).toEqual(plan.filter(key => key !== "initialBuy"));
      expect(preview[0]).toBe(oneApproval ? "approvalsPair" : "approvalsCoin");
      expect(preview.includes("tokenAccount")).toBe(hasBuy);
      // A tokenized-stock quote never carries a first buy on mainnet (the page turns it off), so no issuer note here.
      expect(preview.includes("stockQuote")).toBe(false);
    });
  }
  test("is plain: no dashes, and the fee line points at the review", () => {
    expect(WALLET_NOTICE_COPY.networkFeeLater).toBe("A network fee. The exact amount is in your review.");
    for (const item of walletNoticePreview({ hasBuy: true, siteHost: "launchacard.fun", oneApproval: true })) expect(item.text).not.toMatch(/[–—]/);
  });
});
