import { describe, expect, test } from "bun:test";
import { PAIR_ASSETS, allowedQuotesForDesign, defaultQuoteForDesign, getPairAsset, getTradingPair, matchingDesignsForQuote, recommendedMemeQuoteForDesign, resolveLaunchQuote } from "../../src/lib/carddex/pairs";
import { marketCapText, quoteAtoms } from "../../src/lib/carddex/quote-display";
import { CARD_DESIGNS, getCardDesign } from "../../src/lib/carddex/designs";

describe("reviewed pump.fun quote selection", () => {
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
      expect(allowedQuotesForDesign(design)).toHaveLength(25);
    }
    expect(resolveLaunchQuote("pokemon-classic",{quoteAssetKey:"fartcoin"}).mint).toBe("9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump");
  });
  test("unknown assets and mint substitution fail closed", () => {
    expect(PAIR_ASSETS).toHaveLength(25);
    expect(new Set(PAIR_ASSETS.map(a=>a.mint)).size).toBe(25);
    expect(()=>getPairAsset("PEPE")).toThrow();
    expect(()=>resolveLaunchQuote("pokemon-classic",{quoteAssetKey:"usdc",quoteMint:getPairAsset("sol").mint})).toThrow();
    expect(getTradingPair("$CREATOR","tslax")).toBe("CREATOR / TSLAX");
  });
  test("themed meme/collector presets preserve neutral defaults and allow exact explicit quote selection", () => {
    expect(recommendedMemeQuoteForDesign("pokemon-classic")?.key).toBe("sv151");
    expect(recommendedMemeQuoteForDesign("pokemon-classic","cards")?.key).toBe("cards");
    expect(recommendedMemeQuoteForDesign("pokemon-classic","pepe")?.key).toBe("sv151");
    expect(recommendedMemeQuoteForDesign("stock-tsla")).toBeNull();
    expect(recommendedMemeQuoteForDesign("pepe")?.key).toBe("toad");
    expect(matchingDesignsForQuote("pepe")).toEqual([]);
    expect(matchingDesignsForQuote("toad").map(design=>design.key)).toEqual(["pepe"]);
    expect(matchingDesignsForQuote("cards").map(design=>design.key)).toEqual(["pokemon-classic","pokemon-full-art","obsidian-archive"]);
    expect(matchingDesignsForQuote("sv151").map(design=>design.key)).toEqual(["pokemon-classic","pokemon-full-art"]);
    expect(matchingDesignsForQuote("tslax").map(design=>design.key)).toEqual(["stock-tsla"]);
    expect(matchingDesignsForQuote("unknown")).toEqual([]);
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
    expect(()=>getPairAsset("pepe")).toThrow();
  });
  test("stock references come from bound quote identity rather than decorative stock/SOL strings", () => {
    const stockDesigns=CARD_DESIGNS.filter(d=>d.stock);
    expect(stockDesigns).toHaveLength(10);
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
      expect(allowedQuotesForDesign(designKey)).toHaveLength(25);
      expect(recommendedMemeQuoteForDesign(designKey)?.key).toBe(quoteKey);
      expect(matchingDesignsForQuote(quoteKey).map(design=>design.key)).toContain(designKey);
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
    expect(()=>getPairAsset("pepe")).toThrow();
    expect(()=>getPairAsset("pokemon")).toThrow();
  });
  test("custom quote display never implies a SOL or dollar conversion", () => {
    expect(marketCapText({mcapUsd:null,mcapQuote:1000,quoteAssetKey:"tslax"})).toBe("1K TSLAX");
    expect(quoteAtoms(123456,"usdc")).toBe("0.123456");
    expect(quoteAtoms(123456,"bonk")).toBe("1.2346");
    expect(marketCapText({mcapUsd:null,quoteAssetKey:"doge"})).toBe("—");
  });
});
