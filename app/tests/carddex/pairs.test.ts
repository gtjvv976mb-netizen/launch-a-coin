import { describe, expect, test } from "bun:test";
import { CONFIRMED_DIRECT_PAIRS, DEFAULT_PAIR, DIRECT_PAIR_HELD, NOT_OFFERED_PAIR, OFFERED_PAIRS, TRADED_PAIRS, TRANSFER_FEE_PAIR, TRANSFER_FEE_PAIRS, chargesTransferFee, mainnetPairHold, mainnetPairRefusal, PAIR_ASSETS, PAIR_ASSETS_VERIFIED_AT, PAIR_ASSET_KEYS, UNPAIRED_DESIGN, allowedQuotesForDesign, completeLaunchPair, defaultQuoteForDesign, designForPair, getPairAsset, getTradingPair, isDirectPair, isOfferedPair, pairForDesign, resolveLaunchQuote, resolveNewLaunchPair } from "../../src/lib/carddex/pairs";
import { DESIGN_QUOTE_KEYS, IDENTITY_RELEASE_PAIR_DESIGNS, LEGACY_DESIGN_QUOTE_KEYS, MEME_PAIR_PRESETS, PAIR_DESIGNS, PAIR_DESIGNS_2026_10_30, PAIR_IDENTITY_DESIGNS } from "../../src/lib/carddex/design-pairings";
import { HELD_PAIR_DESIGNS } from "../../src/lib/carddex/pair-designs";
import accepted from "./fixtures/launch-quote-acceptance-f603773.json";
import { marketCapText, quoteAtoms } from "../../src/lib/carddex/quote-display";
import { CARD_DESIGNS, LEGACY_CARD_DESIGNS, getCardDesign, isCardDesignKey } from "../../src/lib/carddex/designs";
import { sortCoins, trendingScore } from "../../src/lib/mintdex/sort";
import type { CoinSummary } from "../../src/lib/mintdex/types";

/**
 * The owner's table (30 October 2026, pair identities): SOL keeps One Piece, USDC keeps Duel Masters, every other
 * installed pair takes its own identity design, and AAVE and UNI (no finished card) are not offered. Content holds
 * (HELD_PAIR_DESIGNS): eight held identities' pairs are not offered; thirteen pairs production offers today keep the
 * design production gives them.
 */
const WITHHELD = ["aave", "uni"];
const HELD_OUT = ["67", "agency", "alon", "hodl", "jeanphil", "claudia", "biketyson", "neet", "solangeles"];
const HELD_LIVE: Record<string, string> = { ansem: "sovereign", spx: "celestial", trump: "regal", giga: "mythic", gmex: "stock-gme", tslax: "stock-tsla", nvdax: "stock-nvda", aaplx: "stock-aapl", mstrx: "stock-mstr", coinx: "stock-coin", amc: "amc", sv151: "pokemon-classic", vine: "magic-etched", fartcoin: "ember" };
/** The full release's map (claude/pair-identities); this release step does not offer it. */
const RELEASE_PAIR_DESIGNS: Record<string, string> = Object.fromEntries(PAIR_ASSET_KEYS.filter(key => !WITHHELD.includes(key) && !HELD_OUT.includes(key)).map(key => [key, key === "sol" ? "one-piece" : key === "usdc" ? "duel-masters" : HELD_LIVE[key] ?? `pair-${key}`]));
/** Release step (rollback target): new launches get exactly production's 37 pairs and designs. */
const EXPECTED_PAIR_DESIGNS: Record<string, string> = {...PAIR_DESIGNS_2026_10_30};
const NOT_OFFERED = PAIR_ASSET_KEYS.filter(key => !(key in EXPECTED_PAIR_DESIGNS));
/** The 30 October map before the identity designs: these 35 designs become unpaired (One Piece and Duel Masters stay). */
const EARLIER_PAIRED = ["stock-gme", "stock-tsla", "stock-nvda", "stock-aapl", "stock-mstr", "stock-coin", "amc", "doge", "bonk", "wif", "obsidian-archive", "pokemon-classic", "pepe", "ember", "relic", "tide", "neon-circuit", "frost", "mythic", "celestial", "regal", "wildtype", "aurora", "apex", "astral", "yugioh-spell", "bloom", "magic-etched", "nova", "spark", "ronin", "sovereign", "legend", "abyssal", "surge"];
const UNPAIRED_BEFORE = ["pokemon-full-art", "yugioh-monster", "shib", "popcat", "gamestop", "blackberry", "nokia", "coinbase", "binance", "kraken", "strategy"];
const HELD_KEYS = [...HELD_OUT, ...Object.keys(HELD_LIVE)].map(key => `pair-${key}`);
const IDENTITIES = PAIR_ASSET_KEYS.filter(key => !WITHHELD.includes(key)).map(key => `pair-${key}`);
const UNPAIRED = [...UNPAIRED_BEFORE, ...IDENTITIES];

describe("the pair picks the card", () => {
  test("the map is one-to-one: 37 offered pairs, 37 distinct designs, the map equals production's", () => {
    expect({...PAIR_DESIGNS}).toEqual(EXPECTED_PAIR_DESIGNS);
    expect(Object.keys(PAIR_DESIGNS)).toHaveLength(37);
    expect({...IDENTITY_RELEASE_PAIR_DESIGNS}).toEqual(RELEASE_PAIR_DESIGNS);
    expect(Object.keys(IDENTITY_RELEASE_PAIR_DESIGNS)).toHaveLength(86);
    expect({...PAIR_IDENTITY_DESIGNS}).toEqual(Object.fromEntries(PAIR_ASSET_KEYS.filter(key => !WITHHELD.includes(key)).map(key => [key, key === "sol" ? "one-piece" : key === "usdc" ? "duel-masters" : `pair-${key}`])));
    expect(PAIR_ASSETS.map(asset => asset.key).sort()).toEqual([...PAIR_ASSET_KEYS].sort());
    const designs = Object.values(PAIR_DESIGNS);
    expect(new Set(designs).size).toBe(37);
    for (const design of designs) expect(isCardDesignKey(design)).toBe(true);
    expect(Object.isFrozen(PAIR_DESIGNS)).toBe(true);
    expect(PAIR_DESIGNS.sol).toBe("one-piece");
    expect(PAIR_DESIGNS.usdc).toBe("duel-masters");
    expect(designs.filter(design => design!.startsWith("pair-"))).toHaveLength(0);
    expect(OFFERED_PAIRS.map(asset => asset.key)).toEqual(PAIR_ASSETS.filter(asset => !NOT_OFFERED.includes(asset.key)).map(asset => asset.key));
    for (const asset of OFFERED_PAIRS) {
      const design = designForPair(asset.key)!;
      expect(design).toBe(EXPECTED_PAIR_DESIGNS[asset.key]!);
      expect(pairForDesign(design)).toBe(asset);
      expect(isOfferedPair(asset.key)).toBe(true);
    }
    expect(PAIR_ASSETS.filter(asset => !isOfferedPair(asset.key)).map(asset => asset.key)).toEqual(NOT_OFFERED);
    for (const key of NOT_OFFERED) expect(designForPair(key)).toBeNull();
    expect(DEFAULT_PAIR).toBe("sol");
    expect(designForPair("unknown")).toBeNull();
    expect(designForPair(null)).toBeNull();
    expect(isOfferedPair("unknown")).toBe(false);
  });
  test("the demo funds every pair a coin can trade in: offered now or before", () => {
    expect(TRADED_PAIRS.map(asset => asset.key)).toEqual(PAIR_ASSETS.filter(asset => isOfferedPair(asset.key) || asset.key in PAIR_DESIGNS_2026_10_30).map(asset => asset.key));
    expect(TRADED_PAIRS).toHaveLength(37);
    for (const key of ["ansem", "spx", "tslax", "sv151"]) expect(TRADED_PAIRS.map(asset => asset.key)).toContain(key);
    for (const key of NOT_OFFERED) expect(TRADED_PAIRS.map(asset => asset.key)).not.toContain(key);
  });
  test("content hold, not offered: a held identity's pair leaves new launches, and coins that carry it keep it", () => {
    for (const key of HELD_OUT) {
      expect(HELD_PAIR_DESIGNS[`pair-${key}`]).toBeNull();
      expect(isOfferedPair(key)).toBe(false);
      expect(designForPair(key)).toBeNull();
      expect(OFFERED_PAIRS.some(asset => asset.key === key)).toBe(false);
      expect(() => resolveNewLaunchPair({quoteAssetKey: key})).toThrow(NOT_OFFERED_PAIR);
      expect(() => resolveNewLaunchPair({quoteAssetKey: key, quoteMint: getPairAsset(key).mint, cardTemplate: `pair-${key}`})).toThrow(NOT_OFFERED_PAIR);
      expect(() => resolveNewLaunchPair({cardTemplate: `pair-${key}`})).toThrow(UNPAIRED_DESIGN);
      // A stored coin or saved launch on it: its design still renders and its record still resolves to its own pair.
      expect(getCardDesign(`pair-${key}`).key).toBe(`pair-${key}`);
      expect(resolveLaunchQuote(`pair-${key}`, {quoteAssetKey: key, quoteMint: getPairAsset(key).mint})).toBe(getPairAsset(key));
      expect(() => resolveLaunchQuote(`pair-${key}`, {quoteAssetKey: "sol"})).toThrow("paired with");
    }
  });
  test("content hold, live design: the pair launches with the card production gives it; the identity stays for coins", () => {
    expect(Object.keys(HELD_LIVE)).toHaveLength(14);
    for (const [key, live] of Object.entries(HELD_LIVE)) {
      expect(HELD_PAIR_DESIGNS[`pair-${key}`]).toBe(live);
      expect(PAIR_DESIGNS_2026_10_30[key as keyof typeof PAIR_DESIGNS_2026_10_30]).toBe(live as never);
      const asset = getPairAsset(key);
      expect(isOfferedPair(key)).toBe(true);
      expect(designForPair(key)).toBe(live as never);
      expect(pairForDesign(live)).toBe(asset);
      expect(resolveNewLaunchPair({quoteAssetKey: key})).toEqual({asset, designKey: live as never});
      expect(() => resolveNewLaunchPair({quoteAssetKey: key, cardTemplate: `pair-${key}`})).toThrow(UNPAIRED_DESIGN);
      expect(pairForDesign(`pair-${key}`)).toBeNull();
      expect(getCardDesign(`pair-${key}`).key).toBe(`pair-${key}`);
      expect(resolveLaunchQuote(`pair-${key}`, {quoteAssetKey: key, quoteMint: asset.mint})).toBe(asset);
    }
  });
  test("transfer-fee pairs (ZCAT; not offered in the release step); the list is the adapter's (its prepare tests prove it)", () => {
    expect([...TRANSFER_FEE_PAIRS]).toEqual(["zcat"]);
    expect(isOfferedPair("zcat")).toBe(false);
    expect(chargesTransferFee("zcat")).toBe(true);
    for (const key of ["sol", "usdc", "doge", "pepe", null, undefined, ""]) expect(chargesTransferFee(key)).toBe(false);
  });
  test("mainnet holds: ZCAT's transfer fee and every direct pair the owner has not confirmed (none is offered in the release step)", () => {
    expect([...CONFIRMED_DIRECT_PAIRS]).toEqual([]);
    const held = PAIR_ASSETS.filter(asset => mainnetPairHold(asset.key)).map(asset => asset.key);
    expect(held).toEqual(["zcat", ...PAIR_ASSETS.filter(isDirectPair).map(asset => asset.key)]);
    expect(mainnetPairRefusal("zcat")).toBe(TRANSFER_FEE_PAIR);
    for (const key of held.slice(1)) expect(mainnetPairRefusal(key)).toBe(DIRECT_PAIR_HELD);
    // Every pair production offers, which is every pair this step offers, stays open on mainnet.
    expect(OFFERED_PAIRS.filter(asset => mainnetPairHold(asset.key))).toEqual([]);
    for (const key of Object.keys(PAIR_DESIGNS_2026_10_30)) expect(mainnetPairHold(key)).toBeNull();
  });
  test("the 30 October map is kept as history, unchanged", () => {
    expect(Object.keys(PAIR_DESIGNS_2026_10_30)).toHaveLength(37);
    expect(PAIR_DESIGNS_2026_10_30.toad).toBe("pepe");
    expect(PAIR_DESIGNS_2026_10_30.doge).toBe("doge");
    expect(Object.values(PAIR_DESIGNS_2026_10_30).filter(design => !["one-piece", "duel-masters"].includes(design)).sort()).toEqual([...EARLIER_PAIRED].sort());
  });
  test("106 designs no pair has leave new launches (11 earlier ones and the 95 identities); every other has one pair", () => {
    expect(CARD_DESIGNS).toHaveLength(143);
    expect(LEGACY_CARD_DESIGNS).toHaveLength(48);
    expect(CARD_DESIGNS.filter(design => !pairForDesign(design.key)).map(design => design.key).sort()).toEqual([...UNPAIRED].sort());
    expect(UNPAIRED).toHaveLength(106);
    for (const key of UNPAIRED) expect(() => resolveNewLaunchPair({cardTemplate: key})).toThrow(UNPAIRED_DESIGN);
    expect(pairForDesign("not-a-design")).toBeNull();
  });
  test("the bindings existing coins read agree with the map wherever a bound design still has a pair", () => {
    expect({...DESIGN_QUOTE_KEYS}).toMatchObject({...LEGACY_DESIGN_QUOTE_KEYS});
    expect(Object.keys(DESIGN_QUOTE_KEYS)).toHaveLength(13 + 95);
    for (const [design, quote] of Object.entries(DESIGN_QUOTE_KEYS)) {
      const pair = pairForDesign(design);
      if (pair) expect(pair.key).toBe(quote);
      else expect([...Object.keys(LEGACY_DESIGN_QUOTE_KEYS), ...IDENTITIES]).toContain(design);
    }
    expect(DESIGN_QUOTE_KEYS["pair-sol"]).toBe("sol");
    expect(DESIGN_QUOTE_KEYS["pair-usdc"]).toBe("usdc");
  });
  test("each request shape: a pair alone, a pair with its design, a design alone, neither, and every refusal", () => {
    for (const asset of OFFERED_PAIRS) {
      const design = designForPair(asset.key)!;
      expect(resolveNewLaunchPair({quoteAssetKey: asset.key})).toEqual({asset, designKey: design});
      expect(resolveNewLaunchPair({quoteAssetKey: asset.key, quoteMint: asset.mint, cardTemplate: design})).toEqual({asset, designKey: design});
      expect(resolveNewLaunchPair({cardTemplate: design})).toEqual({asset, designKey: design});
      // Any other pair's design with this pair is refused; so is the right design with another asset's mint.
      const other = OFFERED_PAIRS.find(o => o.key !== asset.key)!;
      expect(() => resolveNewLaunchPair({quoteAssetKey: asset.key, cardTemplate: designForPair(other.key)!})).toThrow(`The ${asset.symbol} pair comes with its own card`);
      expect(() => resolveNewLaunchPair({quoteAssetKey: asset.key, quoteMint: other.mint})).toThrow("quote mint");
    }
    expect(resolveNewLaunchPair({})).toEqual({asset: getPairAsset("sol"), designKey: "one-piece"});
    expect(resolveNewLaunchPair({cardTemplate: "doge"})).toEqual({asset: getPairAsset("doge"), designKey: "doge"});
    expect(() => resolveNewLaunchPair({cardTemplate: "pair-doge"})).toThrow(UNPAIRED_DESIGN);
    expect(() => resolveNewLaunchPair({quoteAssetKey: "doge", cardTemplate: "pair-doge"})).toThrow(UNPAIRED_DESIGN);
    expect(() => resolveNewLaunchPair({quoteAssetKey: "cards", cardTemplate: "pokemon-classic"})).toThrow("The CARDS pair comes with its own card");
    expect(() => resolveNewLaunchPair({cardTemplate: "pair-sol"})).toThrow(UNPAIRED_DESIGN);
    expect(() => resolveNewLaunchPair({quoteAssetKey: "sol", cardTemplate: "pair-sol"})).toThrow(UNPAIRED_DESIGN);
    expect(() => resolveNewLaunchPair({quoteAssetKey: "usdc", cardTemplate: "pair-usdc"})).toThrow(UNPAIRED_DESIGN);
    for (const key of NOT_OFFERED) {
      expect(() => resolveNewLaunchPair({quoteAssetKey: key})).toThrow(NOT_OFFERED_PAIR);
      expect(() => resolveNewLaunchPair({quoteAssetKey: key, quoteMint: getPairAsset(key).mint, cardTemplate: "one-piece"})).toThrow(NOT_OFFERED_PAIR);
      expect(() => resolveNewLaunchPair({cardTemplate: `pair-${key}`})).toThrow(WITHHELD.includes(key) ? "available card design" : UNPAIRED_DESIGN);
    }
    expect(() => resolveNewLaunchPair({quoteAssetKey: "popcat"})).toThrow("supported pump.fun quote");
    expect(() => resolveNewLaunchPair({cardTemplate: "not-a-design"})).toThrow("available card design");
    expect(() => resolveNewLaunchPair({quoteAssetKey: "sol", cardTemplate: "not-a-design"})).toThrow("available card design");
    expect(() => resolveNewLaunchPair({quoteAssetKey: "gmex", cardTemplate: "gamestop"})).toThrow(UNPAIRED_DESIGN);
    // The earlier chooser's combinations: accepted only where the design is its pair's design again (a held identity's
    // live design, SV151 Pokemon Classic, SPX Celestial...); every other is refused for new coins.
    for (const preset of MEME_PAIR_PRESETS) {
      if (designForPair(preset.quote) === preset.design) expect(resolveNewLaunchPair({quoteAssetKey: preset.quote, cardTemplate: preset.design}).designKey).toBe(preset.design);
      else expect(() => resolveNewLaunchPair({quoteAssetKey: preset.quote, cardTemplate: preset.design})).toThrow();
    }
    expect(MEME_PAIR_PRESETS.filter(preset => designForPair(preset.quote) === preset.design)).toHaveLength(28);
  });
  test("completing a request never changes one that names all three, so saved launches keep their hashes", () => {
    const full = {cardTemplate: "pokemon-classic", quoteAssetKey: "sol", quoteMint: getPairAsset("sol").mint};
    expect(completeLaunchPair(full)).toEqual(full);
    const aave = {cardTemplate: "pokemon-classic", quoteAssetKey: "aave", quoteMint: getPairAsset("aave").mint};
    expect(completeLaunchPair(aave)).toEqual(aave);
    expect(completeLaunchPair({quoteAssetKey: "doge"})).toEqual({cardTemplate: "doge", quoteAssetKey: "doge", quoteMint: getPairAsset("doge").mint});
    expect(completeLaunchPair({cardTemplate: "stock-tsla"})).toEqual({cardTemplate: "stock-tsla", quoteAssetKey: "tslax", quoteMint: getPairAsset("tslax").mint});
    expect(() => completeLaunchPair({cardTemplate: "pair-wbtc"})).toThrow(UNPAIRED_DESIGN);
    expect(() => completeLaunchPair({cardTemplate: "pair-tslax"})).toThrow(UNPAIRED_DESIGN);
    expect(() => completeLaunchPair({cardTemplate: "kraken"})).toThrow(UNPAIRED_DESIGN);
    expect(() => completeLaunchPair({quoteAssetKey: "uni"})).toThrow(NOT_OFFERED_PAIR);
  });
  test("the 19 direct pairs are marked; the other 78 come from pump.fun's public table", () => {
    const direct = PAIR_ASSETS.filter(isDirectPair).map(asset => asset.key);
    expect(direct).toEqual(["gork", "stonk", "solangeles", "paid", "pepe", "jeanphil", "pill", "biketyson", "npc", "wojak", "eacc", "hodl", "agency", "claudia", "shib", "swordcat", "plague", "ape", "link"]);
    expect(PAIR_ASSETS.length - direct.length).toBe(78);
    expect(PAIR_ASSETS_VERIFIED_AT).toBe("2026-10-30");
  });
});

describe("every launch identity accepted before the identity designs is still accepted (saved launches, recovery)", () => {
  test("resolveLaunchQuote accepts every design x quote it accepted at f603773, with the same default", () => {
    expect(accepted.designs).toBe(48);
    expect(accepted.quotes).toBe(37);
    let n = 0;
    for (const [design, quotes] of Object.entries(accepted.accepted)) {
      expect(resolveLaunchQuote(design).key).toBe(accepted.defaults[design]!);
      for (const key of quotes) {
        const asset = getPairAsset(key);
        expect(resolveLaunchQuote(design, {quoteAssetKey: key, quoteMint: asset.mint})).toBe(asset);
        n++;
      }
    }
    expect(n).toBe(1308);
  });
});

describe("stored coins and saved launches keep their reviewed quote identity", () => {
  test("six stock finishes and their limited counterparts select exact tokenized-asset mints", () => {
    const matches = {"stock-gme":"gmex","stock-tsla":"tslax","stock-nvda":"nvdax","stock-aapl":"aaplx","stock-mstr":"mstrx","stock-coin":"coinx",gamestop:"gmex",coinbase:"coinx",strategy:"mstrx",amc:"amc"};
    for (const [design,key] of Object.entries(matches)) {
      const asset = defaultQuoteForDesign(design);
      expect(asset.key).toBe(key);
      expect(asset.kind).toBe("stock");
      expect(resolveLaunchQuote(design,{quoteAssetKey:key,quoteMint:asset.mint})).toEqual(asset);
      expect(allowedQuotesForDesign(design).map(a=>a.key)).toEqual([key]);
      expect(()=>resolveLaunchQuote(design,{quoteAssetKey:"sol"})).toThrow();
    }
    expect(getPairAsset("aaplx").mint).toBe("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
  });
  test("memecoin skins bind reviewed assets while unverified themes do not invent a pair", () => {
    for (const key of ["doge","bonk","wif"]) expect(defaultQuoteForDesign(key).key).toBe(key);
    for (const design of ["pepe","shib","blackberry","nokia"]) {
      expect(defaultQuoteForDesign(design).key).toBe("sol");
      expect(allowedQuotesForDesign(design)).toHaveLength(97);
    }
    expect(resolveLaunchQuote("pokemon-classic",{quoteAssetKey:"fartcoin"}).mint).toBe("9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump");
  });
  test("unknown assets and mint substitution fail closed", () => {
    expect(PAIR_ASSETS).toHaveLength(97);
    expect(new Set(PAIR_ASSETS.map(a=>a.mint)).size).toBe(97);
    expect(()=>getPairAsset("PEPE")).toThrow();
    expect(()=>resolveLaunchQuote("pokemon-classic",{quoteAssetKey:"usdc",quoteMint:getPairAsset("sol").mint})).toThrow();
    expect(getTradingPair("$CREATOR","tslax")).toBe("CREATOR / TSLAX");
  });
  test("themed meme/collector designs keep their stored neutral defaults and any exact quote a saved launch carries", () => {
    // One pair, one design (release step: production's): no identity design has a pair; the earlier ones keep theirs.
    for (const design of ["pair-sv151","pair-cards","pair-toad","pair-pepe","pokemon-full-art"]) expect(pairForDesign(design)).toBeNull();
    expect(pairForDesign("pokemon-classic")?.key).toBe("sv151");
    expect(pairForDesign("stock-tsla")?.key).toBe("tslax");
    expect(pairForDesign("obsidian-archive")?.key).toBe("cards");
    expect(pairForDesign("pepe")?.key).toBe("toad");
    for (const designKey of ["pepe","pokemon-classic","pokemon-full-art","obsidian-archive"]) {
      expect(defaultQuoteForDesign(designKey).key).toBe("sol");
      for (const key of ["cards","sv151","toad"]) {
        const asset=getPairAsset(key);
        expect(resolveLaunchQuote(designKey,{quoteAssetKey:key,quoteMint:asset.mint})).toBe(asset);
      }
    }
    expect(getTradingPair("TOKEN","cards")).toBe("TOKEN / CARDS");
    expect(getTradingPair("TOKEN","sv151")).toBe("TOKEN / SV151");
    expect(getTradingPair("TOKEN","toad")).toBe("TOKEN / TOAD");
    // The PEPE pair (a Solana quote mint) is a new pair, not the earlier "pepe" design.
    expect(getTradingPair("TOKEN","pepe")).toBe("TOKEN / PEPE");
    expect(isCardDesignKey("pepe")).toBe(true);
  });
  test("stock references come from bound quote identity rather than decorative stock/SOL strings", () => {
    const stockDesigns=CARD_DESIGNS.filter(d=>d.stock);
    expect(stockDesigns).toHaveLength(17);
    expect(stockDesigns.filter(d=>d.key.startsWith("pair-"))).toHaveLength(7);
    for(const design of stockDesigns){
      const quote=defaultQuoteForDesign(design.key);
      expect(quote.kind).toBe("stock");
      expect(design.stock!.ticker).toBe(quote.referenceTicker!);
      expect(design.stock!.quoteAssetKey).toBe(quote.key);
      expect(design.stock!.name).toBe(quote.name);
      expect(design.stock).not.toHaveProperty("pair");
    }
    expect(getCardDesign("blackberry").stock).toBeUndefined();
    expect(getCardDesign("nokia").stock).toBeUndefined();
  });
  test("additional meme finishes are explicit presets and preserve existing neutral defaults", () => {
    const presets={ember:"fartcoin",relic:"pnut",tide:"moodeng","neon-circuit":"troll",frost:"pengu",mythic:"giga",celestial:"spx",regal:"trump",wildtype:"useless",aurora:"chillguy"};
    for (const [designKey,quoteKey] of Object.entries(presets)) {
      const asset=getPairAsset(quoteKey);
      expect(defaultQuoteForDesign(designKey).key).toBe("sol");
      expect(allowedQuotesForDesign(designKey)).toHaveLength(97);
      expect(pairForDesign(designKey)?.key ?? null).toBe(EXPECTED_PAIR_DESIGNS[quoteKey] === designKey ? quoteKey : null);
      expect(PAIR_DESIGNS_2026_10_30[quoteKey as keyof typeof PAIR_DESIGNS_2026_10_30]).toBe(designKey);
      expect(designForPair(quoteKey)).toBe(EXPECTED_PAIR_DESIGNS[quoteKey] as never);
      expect(resolveLaunchQuote(designKey,{quoteAssetKey:quoteKey,quoteMint:asset.mint})).toBe(asset);
      expect(resolveLaunchQuote(designKey,{quoteAssetKey:"sol"}).key).toBe("sol");
      expect(resolveLaunchQuote(designKey,{quoteAssetKey:"tslax"}).key).toBe("tslax");
      // A familiar ticker never authorizes another token with different mint bytes.
      expect(()=>resolveLaunchQuote(designKey,{quoteAssetKey:quoteKey,quoteMint:getPairAsset("usdc").mint})).toThrow("quote mint");
    }
    expect(getPairAsset("spx").kind).toBe("meme");
    expect(getPairAsset("spx").referenceTicker).toBeUndefined();
    expect(getPairAsset("spx").name).toContain("Wormhole Solana representation");
    expect(()=>getPairAsset("popcat")).toThrow();
    expect(()=>getPairAsset("pokemon")).toThrow();
  });
  test("custom quote display never implies a SOL or dollar conversion", () => {
    expect(marketCapText({mcapUsd:null,mcapQuote:1000,quoteAssetKey:"tslax"})).toBe("1K TSLAX");
    expect(quoteAtoms(123456,"usdc")).toBe("0.123456");
    expect(quoteAtoms(123456,"bonk")).toBe("1.2346");
    expect(marketCapText({mcapUsd:null,quoteAssetKey:"doge"})).toBe("—");
  });
  test("twelve additional meme pairs use optional finishes without rewriting neutral or historical quotes", () => {
    const additions={apex:"goat",astral:"zerebro","yugioh-spell":"act",bloom:"pippin","magic-etched":"vine",nova:"aura",spark:"michi",ronin:"cate",sovereign:"ansem",legend:"bert",abyssal:"chillhouse",surge:"usduc"};
    expect(MEME_PAIR_PRESETS).toHaveLength(31);
    expect(new Set(MEME_PAIR_PRESETS.map(preset=>preset.design)).size).toBe(29);
    expect(new Set(MEME_PAIR_PRESETS.map(preset=>preset.quote)).size).toBe(28);
    for(const [design,key] of Object.entries(additions)){
      const quote=getPairAsset(key);
      expect(quote.kind).toBe("meme");
      expect(quote.decimals).toBe(6);
      expect(designForPair(key)).toBe(EXPECTED_PAIR_DESIGNS[key] as never);
      expect(pairForDesign(design)?.key ?? null).toBe(EXPECTED_PAIR_DESIGNS[key] === design ? key : null);
      expect(defaultQuoteForDesign(design).key).toBe("sol");
      expect(allowedQuotesForDesign(design)).toHaveLength(97);
      for(const original of ["sol","tslax","cards"]){
        expect(resolveLaunchQuote(design,{quoteAssetKey:original}).key).toBe(original);
      }
      expect(resolveLaunchQuote(design,{quoteAssetKey:key,quoteMint:quote.mint})).toBe(quote);
      expect(()=>resolveLaunchQuote(design,{quoteAssetKey:key,quoteMint:getPairAsset("usdc").mint})).toThrow("quote mint");
    }
    // A familiar dollar-like ticker must not imply stable units or a USD conversion.
    expect(getPairAsset("usduc").kind).toBe("meme");
    expect(getTradingPair("OWN","usduc")).toBe("OWN / USDUC");
    expect(marketCapText({mcapUsd:null,mcapQuote:1234,quoteAssetKey:"usduc"})).toBe("1.23K USDUC");
  });
});

describe("one fair order across pairs (Discover, Home and the server share sortCoins)", () => {
  const reserve = (key: string) => Number(getPairAsset(key).initialVirtualQuoteReserves);
  // SOL and USDC coins carry a USD reference; a TOAD coin does not (mcapUsd and volume24h are null for it).
  const coin = (id: string, key: string, over: Partial<CoinSummary>) => ({
    id, quoteAssetKey: key, mcapUsd: key === "toad" ? null : 1000, volume24h: key === "toad" ? null : 1,
    volume24hQuote: "0", curveProgress: 0, lastTradeAt: 0, createdAt: 0, level: 1, ...over,
  }) as unknown as CoinSummary;
  const coins = [
    coin("sol-quiet", "sol", { curveProgress: 0.05, volume24hQuote: "0", mcapUsd: 35_900, lastTradeAt: 5 }),
    coin("usdc-mid", "usdc", { curveProgress: 0.2, volume24hQuote: String(Math.round(reserve("usdc") * 0.1)), mcapUsd: 23_100, lastTradeAt: 4 }),
    coin("toad-busy", "toad", { curveProgress: 0.4, volume24hQuote: String(Math.round(reserve("toad") * 1.1)), lastTradeAt: 3 }),
    coin("sol-busy", "sol", { curveProgress: 0.1, volume24hQuote: String(Math.round(reserve("sol") * 0.5)), mcapUsd: 4_200, lastTradeAt: 2 }),
  ];
  test("market cap follows bonding-curve progress, whatever the pair (no USD-priced-first block)", () => {
    const order = sortCoins(coins, "mcap").map(c => c.id);
    expect(order).toEqual(["toad-busy", "usdc-mid", "sol-busy", "sol-quiet"]);
    const progress = sortCoins(coins, "mcap").map(c => c.curveProgress);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeLessThanOrEqual(progress[i - 1]!);
  });
  test("trending follows 24h volume against each pair's own curve, then the latest trade", () => {
    expect(sortCoins(coins, "trending").map(c => c.id)).toEqual(["toad-busy", "sol-busy", "usdc-mid", "sol-quiet"]);
    expect(trendingScore(coins[2]!)).toBeCloseTo(1.1, 6);
    // No volume anywhere: the most recently traded first.
    const quiet = coins.map(c => ({ ...c, volume24hQuote: "0" }));
    expect(sortCoins(quiet, "trending").map(c => c.id)).toEqual(["sol-quiet", "usdc-mid", "toad-busy", "sol-busy"]);
  });
});
