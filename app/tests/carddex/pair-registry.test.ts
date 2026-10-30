import { describe, expect, test } from "bun:test";
import appAssets from "../../src/lib/carddex/pair-assets.json";
import adapterCatalog from "../../../reports/pump-pair-assets-2026-10-28.json";
import legacyAssets from "./fixtures/legacy-pair-assets-2026-10-29.json";
import cryptoSnapshot from "../../../creative/higgsfield/pair-identities-2026-10-30/research/verified-identities-and-metadata.json";
import expansionSnapshot from "../../../creative/higgsfield/pair-identities-2026-10-30/research/expansion-verified-identities-and-metadata.json";
import directSnapshot from "../../../creative/higgsfield/pair-identities-2026-10-30/research/expansion-direct-verified-identities-and-metadata.json";
import previous72 from "./fixtures/legacy-pair-assets-72-2026-10-30.json";
import previous89 from "./fixtures/legacy-pair-assets-89-2026-10-30.json";
import previousDesigns89 from "./fixtures/legacy-pair-designs-89-2026-10-30.json";
import stagedDesigns from "../../src/lib/carddex/pair-designs.json";
import finalSnapshot from "../../../creative/higgsfield/pair-identities-2026-10-30/research/expansion-final-identities-and-metadata.json";

type RegistryAsset = {
  key: string; symbol: string; mint: string; decimals: number;
  tokenProgram: string; kind: string; referenceTicker?: string;
};
const identity = (asset: RegistryAsset) => ({
  key: asset.key, symbol: asset.symbol, mint: asset.mint, decimals: asset.decimals,
  tokenProgram: asset.tokenProgram, kind: asset.kind, referenceTicker: asset.referenceTicker ?? null,
});

describe("browser and official-SDK quote registries", () => {
  test("eight exact platform/community/crypto identities preserve the previous89 without inventing issuer or Ethereum identity",()=>{
    expect(appAssets.slice(0,89)).toEqual(previous89);
    // Owner-approved v2 copy follows the actual new materials; all identity,
    // structural and binding fields remain identical to the original registry.
    const structuralDesign=({description,...design}:{description:string;[key:string]:unknown})=>design;
    expect(stagedDesigns.slice(0,89).map(structuralDesign)).toEqual(previousDesigns89.map(structuralDesign));
    expect(finalSnapshot.assets).toHaveLength(8);
    const publicKeys=["pump","alch","pumpcade","codec","ore","skr"];
    for(const snapshot of finalSnapshot.assets){
      const app=appAssets.find(asset=>asset.key===snapshot.key)!;
      const adapter=adapterCatalog.assets.find(asset=>asset.key===snapshot.key)!;
      expect(app).toMatchObject({key:snapshot.key,symbol:snapshot.symbol,mint:snapshot.mint,kind:"crypto",decimals:snapshot.admission.decimals,tokenProgram:snapshot.admission.tokenProgram,initialVirtualQuoteReserves:snapshot.admission.initialVirtualQuoteReserves,admission:"quoteControl",verificationSlot:snapshot.accountSlot});
      expect(adapter).toMatchObject({mint:app.mint,kind:"crypto",decimals:app.decimals,tokenProgram:app.tokenProgram,mintVerificationSlot:snapshot.accountSlot,admissionVerificationSlot:snapshot.accountSlot});
      expect(stagedDesigns.find(design=>design.quoteKey===snapshot.key)).toMatchObject({key:`pair-${snapshot.key}`,category:"crypto",quoteMint:snapshot.mint});
      expect(app.issuerTerms).toBeNull();
      if(publicKeys.includes(snapshot.key)){
        expect(app.sourceUrls).toContain("https://pump.fun/docs/custom-pairs");
        expect(app).not.toHaveProperty("listingStatus");
      }else{
        expect(app.listingStatus).toBe("direct-onchain");
        expect(app.sourceUrls).not.toContain("https://pump.fun/docs/custom-pairs");
        expect(app.issuer).toBeNull();expect(app).not.toHaveProperty("listingProvider");
      }
    }
    expect(appAssets.find(asset=>asset.key==="ape")).toMatchObject({name:"ApeCoin (Solana quote)",mint:"C1MHyoTJpRTeS9AQCyspNVu2EWAYCZwmJ1jNkEArFP1f",decimals:9});
    expect(appAssets.find(asset=>asset.key==="link")).toMatchObject({name:"Chainlink Token (Solana)",mint:"LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L",decimals:9});
    expect(appAssets.find(asset=>asset.key==="pump")?.issuer).toBe("Golden Fields Partners, Ltd.");
    expect(appAssets.find(asset=>asset.key==="ore")?.decimals).toBe(11);
  });
  test("direct-onchain additions preserve the previous72 and never claim public-table inclusion or a guessed issuer",()=>{
    expect(appAssets.slice(0,72)).toEqual(previous72);
    expect(directSnapshot.assets).toHaveLength(17);
    for(const snapshot of directSnapshot.assets){
      const app=appAssets.find(asset=>asset.key===snapshot.key)!;
      const adapter=adapterCatalog.assets.find(asset=>asset.key===snapshot.key)!;
      expect(app).toMatchObject({key:snapshot.key,symbol:snapshot.symbol,mint:snapshot.mint,kind:"meme",decimals:snapshot.admission.decimals,tokenProgram:snapshot.admission.tokenProgram,initialVirtualQuoteReserves:snapshot.admission.initialVirtualQuoteReserves,admission:"quoteControl",verificationSlot:snapshot.accountSlot,listingStatus:"direct-onchain",listingNotice:"Direct QuoteControl-enabled; not found in the checked dated public table."});
      expect(adapter).toMatchObject({mint:app.mint,decimals:app.decimals,tokenProgram:app.tokenProgram,mintVerificationSlot:snapshot.accountSlot,admissionVerificationSlot:snapshot.accountSlot,listingStatus:app.listingStatus,listingNotice:app.listingNotice});
      expect(app.issuer).toBeNull();expect(app.issuerTerms).toBeNull();
      expect(app).not.toHaveProperty("listingProvider");expect(app).not.toHaveProperty("listingProviderTerms");
      expect(app.sourceUrls).toContain(`https://solscan.io/token/${app.mint}`);
    }
    for(const key of ["pepe","shib"]){
      const asset=appAssets.find(asset=>asset.key===key)!;
      expect(asset.decimals).toBe(4);expect(asset.name).toContain("Solana quote");
    }
  });
  test("the original37 quote objects remain byte-for-byte compatible while reviewed crypto quotes append",()=>{
    expect(appAssets.slice(0,37)).toEqual(legacyAssets);
    const crypto=cryptoSnapshot.assets.filter(asset=>!asset.existingRegistry);
    expect(crypto).toHaveLength(14);
    for(const snapshot of crypto){
      const app=appAssets.find(asset=>asset.key===snapshot.key)!;
      const adapter=adapterCatalog.assets.find(asset=>asset.key===snapshot.key)!;
      expect(app).toMatchObject({key:snapshot.key,symbol:snapshot.symbol,mint:snapshot.mint,kind:"crypto",decimals:snapshot.admission.decimals,tokenProgram:snapshot.admission.tokenProgram,initialVirtualQuoteReserves:snapshot.admission.initialVirtualQuoteReserves,admission:"quoteControl",verificationSlot:snapshot.accountSlot});
      expect(adapter).toMatchObject({mint:snapshot.mint,decimals:app.decimals,tokenProgram:app.tokenProgram,mintVerificationSlot:snapshot.accountSlot,admissionVerificationSlot:snapshot.accountSlot});
      expect(app.listingProvider).toBeTruthy();expect(app.listingProviderTerms).toStartWith("https://");
      expect(app.sourceUrls).toContain("https://pump.fun/docs/custom-pairs");
    }
    expect(appAssets.find(asset=>asset.key==="wbtc")).toMatchObject({symbol:"WBTC",name:"Wrapped BTC (Wormhole Solana representation)",mint:"3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",decimals:8,listingProvider:"Wormhole Portal"});
    expect(appAssets.find(asset=>asset.key==="eth")?.name).toContain("Wormhole Solana representation");
    expect(appAssets.find(asset=>asset.key==="xmr")?.decimals).toBe(12);
    expect(appAssets.some(asset=>asset.key==="etc")).toBe(false);
  });
  test("every reviewed asset has the same exact identity in both registries", () => {
    expect(appAssets.length).toBeGreaterThanOrEqual(89);
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
  test("the21 extra meme identities use their decoded exact mint units and direct admission",()=>{
    expect(expansionSnapshot.assets).toHaveLength(21);
    for(const snapshot of expansionSnapshot.assets){
      const app=appAssets.find(asset=>asset.key===snapshot.key)!;
      const adapter=adapterCatalog.assets.find(asset=>asset.key===snapshot.key)!;
      expect(app).toMatchObject({key:snapshot.key,symbol:snapshot.symbol,mint:snapshot.mint,kind:"meme",decimals:snapshot.admission.decimals,tokenProgram:snapshot.admission.tokenProgram,initialVirtualQuoteReserves:snapshot.admission.initialVirtualQuoteReserves,admission:"quoteControl",verificationSlot:snapshot.accountSlot});
      expect(adapter).toMatchObject({mint:app.mint,decimals:app.decimals,tokenProgram:app.tokenProgram,mintVerificationSlot:snapshot.accountSlot,admissionVerificationSlot:snapshot.accountSlot});
      expect(app.issuer).toBeNull();expect(app.issuerTerms).toBeNull();
      expect(app.sourceUrls).toContain("https://pump.fun/docs/custom-pairs");
    }
    expect(appAssets.find(asset=>asset.key==="cashcat")).toMatchObject({name:"Cash Cat (Sunrise Solana representation)",listingProvider:"Sunrise (Wormhole Labs)",listingProviderTerms:"https://sunrise.xyz/terms-of-service"});
  });
  test("published collector quotes carry exact public identity provenance while ambiguous unreviewed candidates stay excluded", () => {
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
    expect(appAssets.find(asset => asset.key === "pepe")?.listingStatus).toBe("direct-onchain");
    expect(appAssets.find(asset => asset.key === "pepe")?.mint).toBe("PEPEqnuuCDbBC89p1u9vpnP1KQ2oj1xTcQBsjt9X55m");
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
  test("twelve further published meme quotes retain independently reviewed identities, programs and unit snapshots", () => {
    const expected=[
      ["goat","CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump","233175635887"],
      ["zerebro","8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn","109231897567"],
      ["act","GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump","379840212990"],
      ["pippin","Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump","208254365784"],
      ["vine","6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump","461532103258"],
      ["aura","DtR4D9FtVoTX2569gaL837ZgrB6wNjj6tkmnX9Rdk9B2","426470201898"],
      ["michi","AywAYdNJnSLSXwKWYxDciPjqGRnwp4iZdQptuuQTpump","1284214290492"],
      ["cate","Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump","66439760654"],
      ["ansem","9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump","50650546667"],
      ["bert","HgBRWfYxEfvPhtqkaeymCQtHCrKE46qQ43pKe8HCpump","278902341021"],
      ["chillhouse","GkyPYa7NnCFbduLknCfBfP7p8564X1VZhwZYJ6CZpump","3802387072666"],
      ["usduc","CB9dDufT3ZuQXqqSfa1c5kY935TEreyBw9XJXxHKpump","1412752265704"],
    ];
    for(const [key,mint,initialVirtualQuoteReserves] of expected){
      const asset=appAssets.find(item=>item.key===key)!;
      const adapter=adapterCatalog.assets.find(item=>item.key===key)!;
      const tokenProgram=["cate","ansem"].includes(key)?"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
      expect(asset).toMatchObject({key,mint,initialVirtualQuoteReserves,tokenProgram,kind:"meme",decimals:6,admission:"quoteControl",verificationSlot:462558257});
      expect(adapter).toMatchObject({key,mint,initialVirtualQuoteReserves,tokenProgram,kind:"meme",decimals:6,mintVerificationSlot:462558257,admissionVerificationSlot:462558257});
      expect(asset.sourceUrls).toContain("https://pump.fun/docs/custom-pairs");
      expect(adapter.sourceUrls).toEqual(asset.sourceUrls);
      expect(asset).not.toHaveProperty("referenceTicker");
      expect(asset.symbol.length).toBeGreaterThan(0);
    }
    expect(appAssets.find(asset=>asset.key==="usduc")?.kind).toBe("meme");
  });
});
