import { describe, expect, test } from "bun:test";
import { draftPair, enterTarget, firstProblem, formDesign, launchDesign, pairFromSearch, pickPair, quickBuyAmounts, sameAmount, signedOutPress } from "../../src/components/carddex/launch-form";
import { ORDERED_PAIRS, PAIR_GROUPS, filterPairs, gridStep, pairGroupOf, pairMonogram, pairsInGroup, shortPairName, tileName } from "../../src/components/carddex/pair-groups";
import { walletNoticeItems, walletNoticePreview, WALLET_NOTICE_COPY } from "../../src/components/carddex/live/wallet-notice";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { PAIR_ASSETS, designForPair, getPairAsset, pairForDesign } from "../../src/lib/carddex/pairs";
import { maxInitialBuyQuoteAtoms } from "../../src/lib/carddex/quote-simulation";

// The one-page Launch form (routes/launch.tsx): the pair it opens on and the card it shows (the pair picks the card),
// the pair HUD's groups, search and arrow keys, the quick initial-buy amounts, and where focus goes when something is
// missing. Enter never submits; only the primary does.
describe("the Launch form derives its card from the pair", () => {
  test("a fresh Launch opens on SOL with the One Piece card", () => {
    expect(pairFromSearch({})).toEqual({ pair: "sol", notice: "" });
    expect(launchDesign("sol")).toBe("one-piece");
    expect(launchDesign("usdc")).toBe("duel-masters");
  });
  test("every pair shows its own design, and the design changes only with the pair", () => {
    for (const asset of PAIR_ASSETS) {
      expect(launchDesign(asset.key)).toBe(designForPair(asset.key)!);
      expect(launchDesign(asset.key, null)).toBe(designForPair(asset.key)!);
    }
    expect(launchDesign("doge")).toBe("doge");
    expect(launchDesign("tslax")).toBe("stock-tsla");
    expect(launchDesign("cards")).toBe("obsidian-archive");
    expect(launchDesign("unknown")).toBe("one-piece");
  });
  test("a saved mainnet launch keeps the design it was saved with, even one its pair would not pick now", () => {
    expect(launchDesign("sol", "pokemon-classic")).toBe("pokemon-classic");
    expect(launchDesign("gmex", "gamestop")).toBe("gamestop");
    expect(launchDesign("sol", "not-a-design")).toBe("one-piece");
  });
  test("a saved launch's own design stays in mainnet mode: Demo shows and sends the pair's own card", () => {
    // Review finding 2: a pre-change SOL launch (Pokemon Classic) loaded in mainnet mode, then Demo with ?quote=sol.
    expect(formDesign("sol", "pokemon-classic", true)).toBe("pokemon-classic");
    expect(formDesign("sol", "pokemon-classic", false)).toBe("one-piece");
    expect(formDesign("gmex", "gamestop", false)).toBe("stock-gme");
    for (const asset of PAIR_ASSETS) {
      expect(formDesign(asset.key, null, true)).toBe(designForPair(asset.key)!);
      expect(formDesign(asset.key, "pokemon-full-art", false)).toBe(designForPair(asset.key)!);
    }
  });
  test("tapping the checked pair brings back its own card after a saved launch showed another", () => {
    expect(pickPair({ pair: "sol", savedDesign: "pokemon-classic" }, "sol")).toEqual({ pair: "sol", savedDesign: null, changed: false });
    expect(pickPair({ pair: "sol", savedDesign: null }, "sol")).toBeNull();
    expect(pickPair({ pair: "sol", savedDesign: null }, "doge")).toEqual({ pair: "doge", savedDesign: null, changed: true });
    expect(pickPair({ pair: "gmex", savedDesign: "gamestop" }, "doge")).toEqual({ pair: "doge", savedDesign: null, changed: true });
    const back = pickPair({ pair: "sol", savedDesign: "pokemon-classic" }, "sol")!;
    expect(formDesign(back.pair, back.savedDesign, true)).toBe("one-piece");
  });
  test("?quote= preselects its pair; an old ?design= link opens on that design's pair, or on SOL without an error", () => {
    expect(pairFromSearch({ quote: "doge" })).toEqual({ pair: "doge", notice: "" });
    expect(pairFromSearch({ quote: "tslax", design: "pepe" })).toEqual({ pair: "tslax", notice: "" });
    for (const design of CARD_DESIGNS) {
      const pair = pairForDesign(design.key);
      expect(pairFromSearch({ design: design.key })).toEqual({ pair: pair?.key ?? "sol", notice: "" });
    }
    expect(pairFromSearch({ design: "gamestop" })).toEqual({ pair: "sol", notice: "" });
    expect(pairFromSearch({ design: "nope" })).toEqual({ pair: "sol", notice: "" });
    expect(pairFromSearch({ quote: "pepe" })).toEqual({ pair: "sol", notice: "That pair is unavailable. SOL selected." });
  });
  test("a kept draft brings back its pair only (an older draft's separate design is not used)", () => {
    expect(draftPair({ quoteKey: "bonk" })).toBe("bonk");
    expect(draftPair({ quoteKey: "pepe" })).toBeNull();
    expect(draftPair({})).toBeNull();
    expect(draftPair(null)).toBeNull();
  });
});

describe("the pair HUD", () => {
  test("All holds every pair once: SOL first, then memes, stocks and collector tokens", () => {
    expect(ORDERED_PAIRS).toHaveLength(37);
    expect(new Set(ORDERED_PAIRS.map(pair => pair.key)).size).toBe(37);
    expect(ORDERED_PAIRS[0]!.key).toBe("sol");
    expect(PAIR_GROUPS.map(group => group.name)).toEqual(["All", "Memes", "Stocks", "Collector", "Base"]);
    expect(pairsInGroup("base").map(pair => pair.key)).toEqual(["sol", "usdc"]);
    expect(pairsInGroup("collector").map(pair => pair.key)).toEqual(["cards", "sv151"]);
    expect(pairsInGroup("stocks").map(pair => pair.key)).toEqual(["gmex", "tslax", "nvdax", "aaplx", "mstrx", "coinx", "amc"]);
    expect(pairsInGroup("memes")).toHaveLength(26);
    expect(pairsInGroup("memes").every(pair => pairGroupOf(pair) === "memes" && pair.kind === "meme")).toBe(true);
    const sizes = PAIR_GROUPS.filter(group => group.key !== "all").map(group => pairsInGroup(group.key).length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(37);
  });
  test("search finds a symbol or a name, inside the group in view", () => {
    expect(filterPairs("all", "doge").map(pair => pair.key)).toEqual(["doge"]);
    expect(filterPairs("all", "DOGE").map(pair => pair.key)).toEqual(["doge"]);
    expect(filterPairs("all", "$wif").map(pair => pair.key)).toEqual(["wif"]);
    expect(filterPairs("all", "tesla").map(pair => pair.key)).toEqual(["tslax"]);
    expect(filterPairs("all", "chill").map(pair => pair.key)).toEqual(["chillguy", "chillhouse"]);
    expect(filterPairs("stocks", "chill")).toEqual([]);
    expect(filterPairs("memes", "  ")).toEqual(pairsInGroup("memes"));
  });
  test("tiles read as a symbol, a short name (unless it only repeats the symbol) and a monogram, never a design", () => {
    expect(tileName(getPairAsset("doge"))).toBe("Dogecoin");
    expect(tileName(getPairAsset("tslax"))).toBe("Tesla");
    // Seven pairs' short names only repeat their symbol: their tiles show the symbol alone.
    const repeats = ORDERED_PAIRS.filter(pair => tileName(pair) === null).map(pair => pair.key);
    expect(repeats.sort()).toEqual(["aura", "bonk", "fartcoin", "michi", "pippin", "troll", "zerebro"]);
    for (const pair of ORDERED_PAIRS) {
      const name = tileName(pair);
      if (name !== null) expect(name.toLowerCase()).not.toBe(pair.symbol.toLowerCase());
    }
    expect(shortPairName(getPairAsset("doge"))).toBe("Dogecoin");
    expect(shortPairName(getPairAsset("tslax"))).toBe("Tesla");
    expect(shortPairName(getPairAsset("amc"))).toBe("AMC Entertainment");
    expect(shortPairName(getPairAsset("spx"))).toBe("SPX6900");
    expect(pairMonogram(getPairAsset("pippin"))).toBe("P");
    expect(pairMonogram(getPairAsset("sv151"))).toBe("S");
    const names = new Set(CARD_DESIGNS.map(design => design.name));
    for (const pair of ORDERED_PAIRS) expect(names.has(shortPairName(pair))).toBe(false);
  });
  test("arrow keys move one tile or one row and wrap at the ends, as a radio group does", () => {
    // 37 tiles in 5 columns: the last row holds 2.
    expect(gridStep("ArrowRight", 0, 37, 5)).toBe(1);
    expect(gridStep("ArrowRight", 36, 37, 5)).toBe(0);
    expect(gridStep("ArrowLeft", 0, 37, 5)).toBe(36);
    expect(gridStep("ArrowDown", 2, 37, 5)).toBe(7);
    expect(gridStep("ArrowDown", 32, 37, 5)).toBe(3);
    expect(gridStep("ArrowDown", 34, 37, 5)).toBe(0);
    expect(gridStep("ArrowUp", 7, 37, 5)).toBe(2);
    expect(gridStep("ArrowUp", 0, 37, 5)).toBe(36);
    expect(gridStep("ArrowUp", 3, 37, 5)).toBe(32);
    expect(gridStep("ArrowUp", 1, 37, 5)).toBe(35);
    expect(gridStep("Home", 20, 37, 5)).toBe(0);
    expect(gridStep("End", 2, 37, 5)).toBe(36);
    expect(gridStep("Enter", 2, 37, 5)).toBeNull();
    expect(gridStep("ArrowDown", 0, 1, 5)).toBe(0);
    expect(gridStep("ArrowRight", 0, 0, 5)).toBeNull();
    // One column (a narrow screen): up and down are the previous and next tile.
    expect(gridStep("ArrowDown", 3, 7, 1)).toBe(4);
    expect(gridStep("ArrowUp", 0, 7, 1)).toBe(6);
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
  test("signed-out art is kept until the demo starts: the demo prompt opens only once name, ticker and art are in", () => {
    const all = { nameOk: true, tickerOk: true, hasArt: true };
    // Art picked while signed out is held in the page, so it counts: the one prompt opens at Create.
    expect(signedOutPress(all)).toBe("enter");
    // Anything missing takes focus instead of opening a dialog, in the form's order.
    expect(signedOutPress({ ...all, hasArt: false })).toBe("art");
    expect(signedOutPress({ ...all, tickerOk: false, hasArt: false })).toBe("ticker");
    expect(signedOutPress({ nameOk: false, tickerOk: false, hasArt: false })).toBe("name");
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
