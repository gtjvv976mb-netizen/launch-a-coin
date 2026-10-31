import { describe, expect, test } from "bun:test";
import { draftDesign, draftPair, enterTarget, firstProblem, formDesign, launchDesign, pairFromSearch, pairOption, pickDesign, pickPair, sameAmount } from "../../src/components/carddex/launch-form";
import { ORDERED_PAIRS, PAIR_GROUPS, filterPairs, gridStep, groupAlias, isPairGroup, pairGroupOf, pairMonogram, pairsInGroup, shortPairName, tileName } from "../../src/components/carddex/pair-groups";
import { PAIR_DESIGNS_2026_10_30, SOL_DESIGN_OPTIONS } from "../../src/lib/carddex/design-pairings";
import { walletNoticeItems, walletNoticePreview, WALLET_NOTICE_COPY } from "../../src/components/carddex/live/wallet-notice";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { OFFERED_PAIRS, designForPair, designsForPair, getPairAsset, isOfferedPair, pairForDesign } from "../../src/lib/carddex/pairs";

// The one-page Launch form (routes/launch.tsx): the pair it opens on and the card it shows (the pair picks the card),
// the pair HUD's groups, search and arrow keys, the quick initial-buy amounts, and where focus goes when something is
// missing. Enter never submits; only the primary does.
describe("the Launch form derives its card from the pair", () => {
  test("a fresh Launch opens on SOL with SOL's own card", () => {
    expect(pairFromSearch({})).toEqual({ pair: "sol", design: null, notice: "" });
    expect(launchDesign("sol")).toBe("pair-sol");
    expect(launchDesign("usdc")).toBe("duel-masters");
  });
  test("every offered pair shows its own design, and the design changes only with the pair", () => {
    for (const asset of OFFERED_PAIRS) {
      expect(launchDesign(asset.key)).toBe(designForPair(asset.key)!);
      expect(launchDesign(asset.key, null)).toBe(designForPair(asset.key)!);
    }
    expect(launchDesign("doge")).toBe("pair-doge");
    // TSLAX's identity hold was released (31 October 2026); ANSEM's identity is still held, so ANSEM keeps its live design.
    expect(launchDesign("tslax")).toBe("pair-tslax");
    expect(launchDesign("ansem")).toBe("sovereign");
    expect(launchDesign("agency")).toBe("pair-sol");
    expect(launchDesign("cards")).toBe("pair-cards");
    expect(launchDesign("unknown")).toBe("pair-sol");
    expect(launchDesign("aave")).toBe("pair-sol");
  });
  test("a saved mainnet launch keeps the design it was saved with, even one its pair would not pick now", () => {
    expect(launchDesign("sol", "pokemon-classic")).toBe("pokemon-classic");
    expect(launchDesign("gmex", "gamestop")).toBe("gamestop");
    expect(launchDesign("doge", "doge")).toBe("doge");
    expect(launchDesign("sol", "not-a-design")).toBe("pair-sol");
    // The saved launch's design wins over a design picked in SOL's chooser.
    expect(launchDesign("sol", "pokemon-classic", "ronin")).toBe("pokemon-classic");
  });
  test("a saved launch's own design stays in mainnet mode: Demo shows and sends the pair's own card", () => {
    // Review finding 2: a pre-change SOL launch (Pokemon Classic) loaded in mainnet mode, then Demo with ?quote=sol.
    expect(formDesign("sol", "pokemon-classic", true)).toBe("pokemon-classic");
    expect(formDesign("sol", "pokemon-classic", false)).toBe("pair-sol");
    expect(formDesign("sol", "pokemon-classic", true, "ronin")).toBe("pokemon-classic");
    expect(formDesign("sol", "pokemon-classic", false, "ronin")).toBe("ronin");
    expect(formDesign("gmex", "gamestop", false)).toBe("pair-gmex");
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
    expect(formDesign(back.pair, back.savedDesign, true)).toBe("pair-sol");
  });
  test("?quote= preselects an offered pair; an old ?design= link opens on its pair (today's, then the 30 October one)", () => {
    expect(pairFromSearch({ quote: "doge" })).toEqual({ pair: "doge", design: null, notice: "" });
    expect(pairFromSearch({ quote: "pepe" })).toEqual({ pair: "pepe", design: null, notice: "" });
    // Another pair's link wins over a design it does not offer, quietly.
    expect(pairFromSearch({ quote: "tslax", design: "pepe" })).toEqual({ pair: "tslax", design: null, notice: "" });
    expect(pairFromSearch({ quote: "doge", design: "ronin" })).toEqual({ pair: "doge", design: null, notice: "" });
    for (const design of CARD_DESIGNS) {
      const pair = pairForDesign(design.key);
      if (pair) expect(pairFromSearch({ design: design.key })).toEqual({ pair: pair.key, design: pair.key === "sol" ? design.key : null, notice: "" });
    }
    // Links from before the identity designs keep their pair ("doge" DOGE's), unless the design is one of SOL's now
    // ("pepe" was TOAD's, "tide" MOODENG's): those open SOL with that design. A pair not offered now opens on SOL and
    // says so.
    const cardGone = "That card is unavailable. SOL selected.";
    for (const [pair, design] of Object.entries(PAIR_DESIGNS_2026_10_30)) {
      const sol = (SOL_DESIGN_OPTIONS as readonly string[]).includes(design);
      expect(pairFromSearch({ design })).toEqual(sol ? { pair: "sol", design, notice: "" } : isOfferedPair(pair) ? { pair, design: null, notice: "" } : { pair: "sol", design: null, notice: cardGone });
    }
    expect(pairFromSearch({ design: "sovereign" })).toEqual({ pair: "ansem", design: null, notice: "" });
    expect(pairFromSearch({ design: "celestial" })).toEqual({ pair: "spx", design: null, notice: "" });
    expect(pairFromSearch({ design: "pepe" })).toEqual({ pair: "sol", design: "pepe", notice: "" });
    expect(pairFromSearch({ design: "doge" })).toEqual({ pair: "doge", design: null, notice: "" });
    expect(pairFromSearch({ design: "stock-tsla" })).toEqual({ pair: "tslax", design: null, notice: "" });
    // pair-sol is SOL's main card; pair-usdc is bound to USDC but never offered: its link opens on USDC.
    expect(pairFromSearch({ design: "pair-sol" })).toEqual({ pair: "sol", design: "pair-sol", notice: "" });
    expect(pairFromSearch({ design: "pair-usdc" })).toEqual({ pair: "usdc", design: null, notice: "" });
    expect(pairFromSearch({ design: "gamestop" })).toEqual({ pair: "gmex", design: null, notice: "" });
    expect(pairFromSearch({ design: "pokemon-full-art" })).toEqual({ pair: "sol", design: "pokemon-full-art", notice: "" });
    // A held identity whose pair is still offered opens on that pair (and its live card), quietly; so does a released one.
    expect(pairFromSearch({ design: "pair-ansem" })).toEqual({ pair: "ansem", design: null, notice: "" });
    expect(pairFromSearch({ design: "pair-tslax" })).toEqual({ pair: "tslax", design: null, notice: "" });
    // An unknown, withheld or held-out design says so.
    for (const design of ["nope", "pair-aave", "pair-uni", "pair-agency", "pair-alon", "pair-jeanphil", "pair-claudia", "pair-biketyson", "pair-neet"]) expect(pairFromSearch({ design })).toEqual({ pair: "sol", design: null, notice: cardGone });
    for (const quote of ["aave", "uni", "popcat", "agency", "alon", "jeanphil", "claudia", "biketyson", "neet"]) expect(pairFromSearch({ quote })).toEqual({ pair: "sol", design: null, notice: "That pair is unavailable. SOL selected." });
  });
  test("a kept draft brings back its pair, if it is still offered, and SOL's chosen design", () => {
    const chosen = { designChosen: true };
    expect(draftDesign({ quoteKey: "sol", designKey: "ronin", ...chosen })).toBe("ronin");
    expect(draftDesign({ quoteKey: "sol", designKey: "pair-sol", ...chosen })).toBe("pair-sol");
    expect(draftDesign({ quoteKey: "sol", designKey: "one-piece", ...chosen })).toBe("one-piece");
    expect(draftDesign({ quoteKey: "sol", designKey: "pair-doge", ...chosen })).toBeNull();
    expect(draftDesign({ quoteKey: "sol", designKey: "doge", ...chosen })).toBeNull();
    expect(draftDesign({ quoteKey: "sol", ...chosen })).toBeNull();
    expect(draftDesign({ quoteKey: "doge", designKey: "pair-doge", ...chosen })).toBeNull();
    expect(draftDesign({ quoteKey: "doge", designKey: "ronin", ...chosen })).toBeNull();
    expect(draftDesign({ quoteKey: "aave", designKey: "ronin", ...chosen })).toBeNull();
    // A design nobody picked is not a choice: the draft reopens on SOL's main card.
    expect(draftDesign({ quoteKey: "sol", designKey: "ronin", designChosen: false })).toBeNull();
    expect(draftDesign({ quoteKey: "sol", designKey: "ronin", designChosen: "true" })).toBeNull();
    expect(draftDesign(null)).toBeNull();
    // A SOL draft the live site wrote before SOL had a chooser always holds One Piece, which nobody picked: it reopens
    // on SOL's own card (pair-sol), not on One Piece.
    const oldDraft = { name: "Old", ticker: "OLD", lore: "", website: "", xUrl: "", devBuy: "", designKey: "one-piece", quoteKey: "sol" };
    expect(draftPair(oldDraft)).toBe("sol");
    expect(draftDesign(oldDraft)).toBeNull();
    expect(formDesign("sol", null, true, draftDesign(oldDraft))).toBe("pair-sol");
    expect(draftPair({ quoteKey: "bonk" })).toBe("bonk");
    expect(draftPair({ quoteKey: "pepe" })).toBe("pepe");
    expect(draftPair({ quoteKey: "aave" })).toBeNull();
    expect(draftPair({ quoteKey: "agency" })).toBeNull();
    expect(draftPair({ quoteKey: "popcat" })).toBeNull();
    expect(draftPair({})).toBeNull();
    expect(draftPair(null)).toBeNull();
  });
});

describe("SOL's card design chooser", () => {
  test("?quote=sol&design= and an older ?design= open SOL with that design; anything else SOL's own card", () => {
    for (const design of SOL_DESIGN_OPTIONS) {
      expect(pairFromSearch({ quote: "sol", design })).toEqual({ pair: "sol", design, notice: "" });
      expect(pairFromSearch({ design })).toEqual({ pair: "sol", design, notice: "" });
      expect(formDesign("sol", null, true, pairFromSearch({ quote: "sol", design }).design)).toBe(design);
    }
    expect(pairFromSearch({ quote: "sol", design: "ronin" })).toEqual({ pair: "sol", design: "ronin", notice: "" });
    expect(pairFromSearch({ quote: "sol", design: "pair-doge" })).toEqual({ pair: "sol", design: null, notice: "That card is unavailable. SOL selected." });
    expect(pairFromSearch({ quote: "sol", design: "nope" })).toEqual({ pair: "sol", design: null, notice: "That card is unavailable. SOL selected." });
    expect(pairFromSearch({ quote: "sol" })).toEqual({ pair: "sol", design: null, notice: "" });
  });
  test("the chosen design shows only while SOL is the pair; another pair shows its one design", () => {
    expect(pairOption("sol", "ronin")).toBe("ronin");
    expect(pairOption("doge", "ronin")).toBeNull();
    expect(pairOption("doge", "pair-doge")).toBe("pair-doge");
    expect(pairOption("sol", null)).toBeNull();
    expect(formDesign("sol", null, true, "ronin")).toBe("ronin");
    expect(formDesign("doge", null, true, "ronin")).toBe("pair-doge");
    expect(formDesign("sol", null, true, "pair-doge")).toBe("pair-sol");
    expect(formDesign("sol", null, true, null)).toBe("pair-sol");
    for (const asset of OFFERED_PAIRS) {
      if (asset.key === "sol") continue;
      for (const option of SOL_DESIGN_OPTIONS) expect(formDesign(asset.key, null, true, option)).toBe(designForPair(asset.key)!);
    }
    // Only SOL has a chooser (more than one design).
    expect(OFFERED_PAIRS.filter(asset => designsForPair(asset.key).length > 1).map(asset => asset.key)).toEqual(["sol"]);
  });
  test("a design pick: one of SOL's, a change, and it ends a saved launch's own design", () => {
    expect(pickDesign({ pair: "sol", chosen: null, savedDesign: null }, "ronin")).toEqual({ chosen: "ronin", savedDesign: null });
    expect(pickDesign({ pair: "sol", chosen: "ronin", savedDesign: null }, "ronin")).toBeNull();
    expect(pickDesign({ pair: "sol", chosen: null, savedDesign: null }, "pair-sol")).toBeNull();
    expect(pickDesign({ pair: "sol", chosen: "ronin", savedDesign: null }, "pair-sol")).toEqual({ chosen: "pair-sol", savedDesign: null });
    expect(pickDesign({ pair: "sol", chosen: null, savedDesign: null }, "pair-doge")).toBeNull();
    expect(pickDesign({ pair: "doge", chosen: null, savedDesign: null }, "ronin")).toBeNull();
    expect(pickDesign({ pair: "sol", chosen: "ronin", savedDesign: "pokemon-classic" }, "ronin")).toEqual({ chosen: "ronin", savedDesign: null });
    // Picking another pair and back keeps SOL's choice; the other pair shows its own card meanwhile.
    const away = pickPair({ pair: "sol", savedDesign: null }, "doge")!;
    expect(formDesign(away.pair, away.savedDesign, true, "ronin")).toBe("pair-doge");
    const back = pickPair({ pair: "doge", savedDesign: null }, "sol")!;
    expect(formDesign(back.pair, back.savedDesign, true, "ronin")).toBe("ronin");
  });
});

describe("the pair HUD", () => {
  test("All holds every offered pair once: SOL and USDC, the stocks, memes, other crypto, then collector tokens", () => {
    expect(ORDERED_PAIRS).toHaveLength(89);
    expect(new Set(ORDERED_PAIRS.map(pair => pair.key)).size).toBe(89);
    expect(ORDERED_PAIRS.map(pair => pair.key).sort()).toEqual(OFFERED_PAIRS.map(pair => pair.key).sort());
    expect(ORDERED_PAIRS.slice(0, 4).map(pair => pair.key)).toEqual(["sol", "usdc", "gmex", "tslax"]);
    expect(ORDERED_PAIRS.findIndex(pair => pair.key === "tslax")).toBe(3);
    expect(ORDERED_PAIRS.some(pair => ["aave", "uni", "agency", "alon", "jeanphil", "claudia", "biketyson", "neet"].includes(pair.key))).toBe(false);
    expect(PAIR_GROUPS.map(group => group.name)).toEqual(["All", "Memes", "Stocks", "Crypto", "Collector"]);
    expect(pairsInGroup("crypto").slice(0, 2).map(pair => pair.key)).toEqual(["sol", "usdc"]);
    expect(pairsInGroup("crypto")).toHaveLength(22);
    expect(pairsInGroup("collector").map(pair => pair.key)).toEqual(["cards", "sv151"]);
    expect(pairsInGroup("stocks").map(pair => pair.key)).toEqual(["gmex", "tslax", "nvdax", "aaplx", "mstrx", "coinx", "amc"]);
    expect(pairsInGroup("memes")).toHaveLength(58);
    expect(pairsInGroup("memes").every(pair => pairGroupOf(pair) === "memes" && pair.kind === "meme")).toBe(true);
    const sizes = PAIR_GROUPS.filter(group => group.key !== "all").map(group => pairsInGroup(group.key).length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(89);
    // Old links named the base group (SOL and USDC): it is part of Crypto now.
    expect(groupAlias("base")).toBe("crypto");
    expect(groupAlias("memes")).toBe("memes");
    expect(isPairGroup(groupAlias("base"))).toBe(true);
    expect(isPairGroup("base")).toBe(false);
  });
  test("search finds a symbol or a name, inside the group in view, best match first", () => {
    expect(filterPairs("all", "doge").map(pair => pair.key)).toEqual(["doge"]);
    expect(filterPairs("all", "DOGE").map(pair => pair.key)).toEqual(["doge"]);
    expect(filterPairs("all", "$wif").map(pair => pair.key)).toEqual(["wif", "swordcat"]);
    expect(filterPairs("all", "tesla").map(pair => pair.key)).toEqual(["tslax"]);
    expect(filterPairs("all", "chill").map(pair => pair.key)).toEqual(["chillguy", "chillhouse"]);
    expect(filterPairs("stocks", "chill")).toEqual([]);
    expect(filterPairs("memes", "  ")).toEqual(pairsInGroup("memes"));
    // An exact symbol beats a name that contains it: "pepe" is PEPE first, then The Toad Pepe.
    expect(filterPairs("all", "pepe").map(pair => pair.key)).toEqual(["pepe", "toad"]);
    expect(filterPairs("all", "ape")[0]!.key).toBe("ape");
    expect(filterPairs("all", "aave")).toEqual([]);
    expect(filterPairs("all", "spx")[0]!.key).toBe("spx");
    for (const query of ["agency", "alon", "claudia"]) expect(filterPairs("all", query).map(pair => pair.key)).not.toContain(query);
  });
  test("ranked search: typing any offered pair's symbol puts it first, 84 or more within 4 characters", () => {
    let quick = 0;
    for (const pair of ORDERED_PAIRS) {
      expect(filterPairs("all", pair.symbol)[0]!.key).toBe(pair.key);
      const symbol = pair.symbol.toLowerCase();
      for (let n = 1; n <= symbol.length; n++) {
        if (filterPairs("all", symbol.slice(0, n))[0]?.key === pair.key) { if (n <= 4) quick++; break; }
      }
    }
    expect(quick).toBeGreaterThanOrEqual(84);
    for (const [query, key] of [["pepe", "pepe"], ["ape", "ape"], ["mon", "mon"], ["near", "near"], ["pump", "pump"], ["perc", "percolator"], ["e/a", "eacc"], ["link", "link"], ["wbtc", "wbtc"]]) {
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
