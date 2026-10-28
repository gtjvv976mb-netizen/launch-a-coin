import { describe, expect, test } from "bun:test";
import appAssets from "../../src/lib/carddex/pair-assets.json";
import adapterCatalog from "../../../reports/pump-pair-assets-2026-10-28.json";

type RegistryAsset = {
  key: string; symbol: string; mint: string; decimals: number;
  tokenProgram: string; kind: string; referenceTicker?: string;
};
const identity = (asset: RegistryAsset) => ({
  key: asset.key, symbol: asset.symbol, mint: asset.mint, decimals: asset.decimals,
  tokenProgram: asset.tokenProgram, kind: asset.kind, referenceTicker: asset.referenceTicker ?? null,
});

describe("browser and official-SDK quote registries", () => {
  test("every reviewed asset has the same exact identity in both registries", () => {
    expect(appAssets).toHaveLength(25);
    expect(adapterCatalog.assets).toHaveLength(appAssets.length);
    expect(new Set(appAssets.map(asset => asset.key)).size).toBe(appAssets.length);
    expect(new Set(adapterCatalog.assets.map(asset => asset.key)).size).toBe(adapterCatalog.assets.length);
    expect(new Set(appAssets.map(asset => asset.mint)).size).toBe(appAssets.length);
    const adapterByKey = new Map(adapterCatalog.assets.map(asset => [asset.key, asset]));
    for (const asset of appAssets) {
      const adapterAsset = adapterByKey.get(asset.key);
      expect(adapterAsset).toBeDefined();
      expect(identity(adapterAsset!)).toEqual(identity(asset));
    }
  });
  test("published collector quotes carry exact public identity provenance while unlisted candidates stay excluded", () => {
    const expected = [
      {key:"cards",symbol:"CARDS",name:"Collector Crypt",mint:"CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp",decimals:6,kind:"collector"},
      {key:"sv151",symbol:"SV151",name:"Scarlet & Violet 151",mint:"SV151D5pjygAKA8aJJcKzm4wFnRX5G92Fye94jQJk7g",decimals:6,kind:"collector"},
    ];
    for (const identity of expected) {
      const asset = appAssets.find(asset => asset.key === identity.key)!;
      expect(asset).toMatchObject({...identity,tokenProgram:"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",admission:"quoteControl",verificationSlot:462491739});
      expect(BigInt(asset.initialVirtualQuoteReserves)).toBeGreaterThan(0n);
      expect(asset.sourceUrls!.length).toBeGreaterThan(0);
    }
    expect(appAssets.some(asset => String(asset.key) === "pepe")).toBe(false);
    expect(appAssets.some(asset => asset.mint === "PEPEqnuuCDbBC89p1u9vpnP1KQ2oj1xTcQBsjt9X55m")).toBe(false);
    expect(appAssets.some(asset => asset.mint === "D42TjMjz5H7toPu5md5KBXreZkCSdZMEfLQwmBhJXvb1")).toBe(false);
  });
  test("the jade frog preset uses exact supported TOAD rather than the unlisted PEPE mint", () => {
    const asset=appAssets.find(asset=>asset.key==="toad")!;
    expect(asset).toMatchObject({symbol:"TOAD",name:"The Toad Pepe",mint:"A13oRB9FFaiUjfi6LdCg6p9ka1u8SfGkUFs4SKvPpump",decimals:6,tokenProgram:"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",kind:"meme",admission:"quoteControl"});
    expect(asset.verificationSlot).toBeGreaterThan(462491739);
    expect(BigInt(asset.initialVirtualQuoteReserves)).toBeGreaterThan(0n);
    expect(asset.sourceUrls).toContain("https://pump.fun/docs/custom-pairs");
  });
  test("six additional published meme quotes retain exact mint units and provenance", () => {
    const expected=[
      {key:"pengu",symbol:"PENGU",mint:"2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",decimals:6,initialVirtualQuoteReserves:"427226896490"},
      {key:"giga",symbol:"GIGA",mint:"63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9",decimals:5,initialVirtualQuoteReserves:"177226405970"},
      {key:"spx",symbol:"SPX",mint:"J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr",decimals:8,initialVirtualQuoteReserves:"867941152165"},
      {key:"trump",symbol:"TRUMP",mint:"6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",decimals:6,initialVirtualQuoteReserves:"1930184077"},
      {key:"useless",symbol:"USELESS",mint:"Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk",decimals:6,initialVirtualQuoteReserves:"20424896024"},
      {key:"chillguy",symbol:"CHILLGUY",mint:"Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump",decimals:6,initialVirtualQuoteReserves:"333070045599"},
    ];
    for (const identity of expected) {
      const app=appAssets.find(asset=>asset.key===identity.key)!;
      const adapter=adapterCatalog.assets.find(asset=>asset.key===identity.key)!;
      expect(app).toMatchObject({...identity,kind:"meme",tokenProgram:"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",admission:"quoteControl",verificationSlot:462497910});
      expect(adapter).toMatchObject({...identity,kind:"meme",mintVerificationSlot:462497910,admissionVerificationSlot:462497910});
      expect(app.sourceUrls).toContain("https://pump.fun/docs/custom-pairs");
      expect(adapter.sourceUrls).toEqual(app.sourceUrls);
      expect(BigInt(app.initialVirtualQuoteReserves)).toBeGreaterThan(0n);
      expect("referenceTicker" in app).toBe(false);
    }
    const spx=appAssets.find(asset=>asset.key==="spx")!;
    expect(spx.name).toBe("SPX6900 (Wormhole Solana representation)");
    expect(spx.listingProvider).toBe("Wormhole Portal");
    expect(spx.listingProviderTerms).toBe("https://portalbridge.com/");
    expect(appAssets.some(asset=>String(asset.key)==="popcat")).toBe(false);
  });
});
