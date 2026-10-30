import { describe, expect, test } from "bun:test";
import { draftPair, enterTarget, firstProblem, formDesign, launchDesign, pairFromSearch, pickPair, sameAmount } from "../../src/components/carddex/launch-form";
import { ORDERED_PAIRS, PAIR_GROUPS, filterPairs, gridStep, groupAlias, isPairGroup, pairGroupOf, pairMonogram, pairsInGroup, shortPairName, tileName } from "../../src/components/carddex/pair-groups";
import { PAIR_DESIGNS_2026_10_30 } from "../../src/lib/carddex/design-pairings";
import { walletNoticeItems, walletNoticePreview, WALLET_NOTICE_COPY } from "../../src/components/carddex/live/wallet-notice";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { OFFERED_PAIRS, designForPair, getPairAsset, isOfferedPair, pairForDesign } from "../../src/lib/carddex/pairs";

// The one-page Launch form (routes/launch.tsx): the pair it opens on and the card it shows (the pair picks the card),
// the pair HUD's groups, search and arrow keys, the quick initial-buy amounts, and where focus goes when something is
// missing. Enter never submits; only the primary does.
describe("the Launch form derives its card from the pair", () => {
  test("a fresh Launch opens on SOL with the One Piece card", () => {
    expect(pairFromSearch({})).toEqual({ pair: "sol", notice: "" });
    expect(launchDesign("sol")).toBe("one-piece");
    expect(launchDesign("usdc")).toBe("duel-masters");
  });
  test("every offered pair shows its own design, and the design changes only with the pair", () => {
    for (const asset of OFFERED_PAIRS) {
      expect(launchDesign(asset.key)).toBe(designForPair(asset.key)!);
      expect(launchDesign(asset.key, null)).toBe(designForPair(asset.key)!);
    }
    expect(launchDesign("doge")).toBe("doge");
    // TSLAX's identity is held (content holds): the pair keeps the design production gives it.
    expect(launchDesign("tslax")).toBe("stock-tsla");
    expect(launchDesign("agency")).toBe("one-piece");
    expect(launchDesign("cards")).toBe("obsidian-archive");
    expect(launchDesign("unknown")).toBe("one-piece");
    expect(launchDesign("aave")).toBe("one-piece");
  });
  test("a saved mainnet launch keeps the design it was saved with, even one its pair would not pick now", () => {
    expect(launchDesign("sol", "pokemon-classic")).toBe("pokemon-classic");
    expect(launchDesign("gmex", "gamestop")).toBe("gamestop");
    expect(launchDesign("doge", "doge")).toBe("doge");
    expect(launchDesign("sol", "not-a-design")).toBe("one-piece");
  });
  test("a saved launch's own design stays in mainnet mode: Demo shows and sends the pair's own card", () => {
    // Review finding 2: a pre-change SOL launch (Pokemon Classic) loaded in mainnet mode, then Demo with ?quote=sol.
    expect(formDesign("sol", "pokemon-classic", true)).toBe("pokemon-classic");
    expect(formDesign("sol", "pokemon-classic", false)).toBe("one-piece");
    expect(formDesign("gmex", "gamestop", false)).toBe("stock-gme");
    expect(formDesign("tslax", "stock-tsla", true)).toBe("stock-tsla");
    for (const asset of OFFERED_PAIRS) {
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
  test("?quote= preselects an offered pair; an old ?design= link opens on its pair (today's, then the 30 October one)", () => {
    expect(pairFromSearch({ quote: "doge" })).toEqual({ pair: "doge", notice: "" });
    expect(pairFromSearch({ quote: "toad" })).toEqual({ pair: "toad", notice: "" });
    expect(pairFromSearch({ quote: "pepe" })).toEqual({ pair: "sol", notice: "That pair is unavailable. SOL selected." });
    expect(pairFromSearch({ quote: "tslax", design: "pepe" })).toEqual({ pair: "tslax", notice: "" });
    for (const design of CARD_DESIGNS) {
      const pair = pairForDesign(design.key);
      if (pair) expect(pairFromSearch({ design: design.key })).toEqual({ pair: pair.key, notice: "" });
    }
    // Links from before the identity designs keep their pair: design "pepe" was TOAD's card, "doge" DOGE's.
    // A pair not offered now opens on SOL and says so.
    const cardGone = "That card is unavailable. SOL selected.";
    for (const [pair, design] of Object.entries(PAIR_DESIGNS_2026_10_30)) expect(pairFromSearch({ design })).toEqual(isOfferedPair(pair) ? { pair, notice: "" } : { pair: "sol", notice: cardGone });
    expect(pairFromSearch({ design: "sovereign" })).toEqual({ pair: "ansem", notice: "" });
    expect(pairFromSearch({ design: "celestial" })).toEqual({ pair: "spx", notice: "" });
    expect(pairFromSearch({ design: "pepe" })).toEqual({ pair: "toad", notice: "" });
    expect(pairFromSearch({ design: "doge" })).toEqual({ pair: "doge", notice: "" });
    expect(pairFromSearch({ design: "stock-tsla" })).toEqual({ pair: "tslax", notice: "" });
    // pair-sol and pair-usdc are bound to their pairs but never offered: their links open on SOL and USDC.
    expect(pairFromSearch({ design: "pair-sol" })).toEqual({ pair: "sol", notice: "" });
    expect(pairFromSearch({ design: "pair-usdc" })).toEqual({ pair: "usdc", notice: "" });
    expect(pairFromSearch({ design: "gamestop" })).toEqual({ pair: "gmex", notice: "" });
    expect(pairFromSearch({ design: "pokemon-full-art" })).toEqual({ pair: "sol", notice: "" });
    // A held identity whose pair is still offered opens on that pair (and its live card), quietly.
    expect(pairFromSearch({ design: "pair-ansem" })).toEqual({ pair: "ansem", notice: "" });
    expect(pairFromSearch({ design: "pair-tslax" })).toEqual({ pair: "tslax", notice: "" });
    // An unknown, withheld or held-out design says so; a known design no pair ever had (pokemon-full-art) stays quiet.
    for (const design of ["nope", "pair-aave", "pair-uni", "pair-67", "pair-agency", "pair-alon", "pair-hodl", "pair-jeanphil", "pair-claudia", "pair-biketyson", "pair-neet"]) expect(pairFromSearch({ design })).toEqual({ pair: "sol", notice: cardGone });
    for (const quote of ["aave", "uni", "popcat", "67", "agency", "alon", "hodl", "jeanphil", "claudia", "biketyson", "neet"]) expect(pairFromSearch({ quote })).toEqual({ pair: "sol", notice: "That pair is unavailable. SOL selected." });
  });
  test("a kept draft brings back its pair only, if it is still offered (an older draft's separate design is not used)", () => {
    expect(draftPair({ quoteKey: "bonk" })).toBe("bonk");
    expect(draftPair({ quoteKey: "toad" })).toBe("toad");
    expect(draftPair({ quoteKey: "pepe" })).toBeNull();
    expect(draftPair({ quoteKey: "aave" })).toBeNull();
    expect(draftPair({ quoteKey: "agency" })).toBeNull();
    expect(draftPair({ quoteKey: "popcat" })).toBeNull();
    expect(draftPair({})).toBeNull();
    expect(draftPair(null)).toBeNull();
  });
});

describe("the pair HUD", () => {
  test("All holds every offered pair once: SOL and USDC, the stocks, memes, other crypto, then collector tokens", () => {
    expect(ORDERED_PAIRS).toHaveLength(37);
    expect(new Set(ORDERED_PAIRS.map(pair => pair.key)).size).toBe(37);
    expect(ORDERED_PAIRS.map(pair => pair.key).sort()).toEqual(OFFERED_PAIRS.map(pair => pair.key).sort());
    expect(ORDERED_PAIRS.slice(0, 4).map(pair => pair.key)).toEqual(["sol", "usdc", "gmex", "tslax"]);
    expect(ORDERED_PAIRS.findIndex(pair => pair.key === "tslax")).toBe(3);
    expect(ORDERED_PAIRS.some(pair => ["aave", "uni", "67", "agency", "alon", "hodl", "jeanphil", "claudia", "biketyson", "neet", "solangeles"].includes(pair.key))).toBe(false);
    expect(PAIR_GROUPS.map(group => group.name)).toEqual(["All", "Memes", "Stocks", "Crypto", "Collector"]);
    expect(pairsInGroup("crypto").slice(0, 2).map(pair => pair.key)).toEqual(["sol", "usdc"]);
    expect(pairsInGroup("crypto")).toHaveLength(2);
    expect(pairsInGroup("collector").map(pair => pair.key)).toEqual(["cards", "sv151"]);
    expect(pairsInGroup("stocks").map(pair => pair.key)).toEqual(["gmex", "tslax", "nvdax", "aaplx", "mstrx", "coinx", "amc"]);
    expect(pairsInGroup("memes")).toHaveLength(26);
    expect(pairsInGroup("memes").every(pair => pairGroupOf(pair) === "memes" && pair.kind === "meme")).toBe(true);
    const sizes = PAIR_GROUPS.filter(group => group.key !== "all").map(group => pairsInGroup(group.key).length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(37);
    // Old links named the base group (SOL and USDC): it is part of Crypto now.
    expect(groupAlias("base")).toBe("crypto");
    expect(groupAlias("memes")).toBe("memes");
    expect(isPairGroup(groupAlias("base"))).toBe(true);
    expect(isPairGroup("base")).toBe(false);
  });
  test("search finds a symbol or a name, inside the group in view, best match first", () => {
    expect(filterPairs("all", "doge").map(pair => pair.key)).toEqual(["doge"]);
    expect(filterPairs("all", "DOGE").map(pair => pair.key)).toEqual(["doge"]);
    expect(filterPairs("all", "$wif").map(pair => pair.key)).toEqual(["wif"]);
    expect(filterPairs("all", "tesla").map(pair => pair.key)).toEqual(["tslax"]);
    expect(filterPairs("all", "chill").map(pair => pair.key)).toEqual(["chillguy", "chillhouse"]);
    expect(filterPairs("stocks", "chill")).toEqual([]);
    expect(filterPairs("memes", "  ")).toEqual(pairsInGroup("memes"));
    // Release step: PEPE and APE are not offered, so "pepe" finds The Toad Pepe only and "ape" nothing.
    expect(filterPairs("all", "pepe").map(pair => pair.key)).toEqual(["toad"]);
    expect(filterPairs("all", "ape")).toEqual([]);
    expect(filterPairs("all", "usd").map(pair => pair.key)).toEqual(["usdc", "usduc"]);
    expect(filterPairs("all", "aave")).toEqual([]);
    expect(filterPairs("all", "spx")[0]!.key).toBe("spx");
    for (const query of ["67", "agency", "hodl", "claudia"]) expect(filterPairs("all", query).map(pair => pair.key)).not.toContain(query);
  });
  test("ranked search: typing any offered pair's symbol puts it first, 36 or more within 4 characters", () => {
    let quick = 0;
    for (const pair of ORDERED_PAIRS) {
      expect(filterPairs("all", pair.symbol)[0]!.key).toBe(pair.key);
      const symbol = pair.symbol.toLowerCase();
      for (let n = 1; n <= symbol.length; n++) {
        if (filterPairs("all", symbol.slice(0, n))[0]?.key === pair.key) { if (n <= 4) quick++; break; }
      }
    }
    expect(quick).toBeGreaterThanOrEqual(36);
    for (const [query, key] of [["toad", "toad"], ["doge", "doge"], ["tsla", "tslax"], ["sv", "sv151"], ["bon", "bonk"], ["usdc", "usdc"]]) {
      expect(filterPairs("all", query!)[0]!.key).toBe(key!);
    }
  });
  test("tiles read as a symbol, a short name (unless it only repeats the symbol) and a monogram, never a design", () => {
    expect(tileName(getPairAsset("doge"))).toBe("Dogecoin");
    expect(tileName(getPairAsset("tslax"))).toBe("Tesla");
    // Pairs whose short names only repeat their symbol show the symbol alone (the earlier seven among them).
    const repeats = ORDERED_PAIRS.filter(pair => tileName(pair) === null).map(pair => pair.key);
    expect(repeats).toEqual(expect.arrayContaining(["aura", "bonk", "fartcoin", "michi", "pippin", "troll", "zerebro"]));
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
    // 95 tiles in 5 columns: 19 full rows.
    expect(gridStep("ArrowRight", 0, 95, 5)).toBe(1);
    expect(gridStep("ArrowRight", 94, 95, 5)).toBe(0);
    expect(gridStep("ArrowLeft", 0, 95, 5)).toBe(94);
    expect(gridStep("ArrowDown", 2, 95, 5)).toBe(7);
    expect(gridStep("ArrowDown", 92, 95, 5)).toBe(3);
    expect(gridStep("ArrowDown", 94, 95, 5)).toBe(0);
    expect(gridStep("ArrowUp", 7, 95, 5)).toBe(2);
    expect(gridStep("ArrowUp", 0, 95, 5)).toBe(94);
    expect(gridStep("ArrowUp", 3, 95, 5)).toBe(92);
    expect(gridStep("ArrowUp", 1, 95, 5)).toBe(90);
    expect(gridStep("Home", 20, 95, 5)).toBe(0);
    expect(gridStep("End", 2, 95, 5)).toBe(94);
    // 37 tiles in 5 columns (a filtered list): the last row holds 2.
    expect(gridStep("ArrowDown", 32, 37, 5)).toBe(3);
    expect(gridStep("ArrowDown", 34, 37, 5)).toBe(0);
    expect(gridStep("ArrowUp", 3, 37, 5)).toBe(32);
    expect(gridStep("ArrowUp", 1, 37, 5)).toBe(35);
    expect(gridStep("Enter", 2, 37, 5)).toBeNull();
    expect(gridStep("ArrowDown", 0, 1, 5)).toBe(0);
    expect(gridStep("ArrowRight", 0, 0, 5)).toBeNull();
    // One column (a narrow screen): up and down are the previous and next tile.
    expect(gridStep("ArrowDown", 3, 7, 1)).toBe(4);
    expect(gridStep("ArrowUp", 0, 7, 1)).toBe(6);
  });
});

describe("quick initial-buy amounts", () => {
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
