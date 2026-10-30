import {describe,expect,test} from "bun:test";
import {ACTIVE_PAIR_DESIGNS,HELD_PAIR_DESIGNS,STAGED_PAIR_DESIGNS,WITHHELD_PAIR_DESIGNS,isHeldPairDesign,isPairDesignInstalled,type PairDesignInstallation} from "../../src/lib/carddex/pair-designs";
import {installedPairDesignKeys} from "../../src/lib/carddex/pair-designs-installed";
import {CARD_DESIGNS,LEGACY_CARD_DESIGNS,isCardDesignKey} from "../../src/lib/carddex/designs";
import {MEME_PAIR_PRESETS} from "../../src/lib/carddex/design-pairings";
import {UNPAIRED_DESIGN,getPairAsset,allowedQuotesForDesign,defaultQuoteForDesign,designForPair,pairForDesign,resolveLaunchQuote,resolveNewLaunchPair} from "../../src/lib/carddex/pairs";
import {CARD_RENDERER_VERSION} from "../../src/lib/carddex/card-template";

describe("reviewed exact pair-identity designs",()=>{
  test("the active designs are exactly the installed ones: every staged design but the two without finished art",()=>{
    expect(WITHHELD_PAIR_DESIGNS).toEqual(["pair-aave","pair-uni"]);
    expect(ACTIVE_PAIR_DESIGNS).toHaveLength(95);
    // A missing or mismatched asset or hash fails here (the gates), not on the page: the manifests stay off the client.
    expect(ACTIVE_PAIR_DESIGNS.map(d=>d.key)).toEqual(installedPairDesignKeys());
    expect(STAGED_PAIR_DESIGNS.filter(d=>!installedPairDesignKeys().includes(d.key)).map(d=>d.key)).toEqual([...WITHHELD_PAIR_DESIGNS]);
  });
  test("content holds: 21 installed identities stay design keys (existing coins keep them) and no new launch gets one",()=>{
    const held=Object.keys(HELD_PAIR_DESIGNS);
    expect(held).toHaveLength(21);
    expect(held.filter(key=>HELD_PAIR_DESIGNS[key]===null).sort()).toEqual(["pair-67","pair-agency","pair-alon","pair-biketyson","pair-claudia","pair-hodl","pair-jeanphil","pair-neet"]);
    for(const key of held){
      expect(installedPairDesignKeys()).toContain(key);
      expect(isHeldPairDesign(key)).toBe(true);
      expect(isCardDesignKey(key)).toBe(true);
      expect(pairForDesign(key)).toBeNull();
      expect(defaultQuoteForDesign(key).key).toBe(key.slice(5));
      expect(()=>resolveNewLaunchPair({cardTemplate:key})).toThrow(UNPAIRED_DESIGN);
    }
    for(const key of ["pair-doge","pair-sol","one-piece","stock-tsla","pair-aave",null,undefined,""])expect(isHeldPairDesign(key)).toBe(false);
  });
  test("the original48 identities remain valid and staged artwork never creates a placeholder option",()=>{
    expect(LEGACY_CARD_DESIGNS).toHaveLength(48);
    expect(CARD_DESIGNS).toHaveLength(48+ACTIVE_PAIR_DESIGNS.length);
    expect(new Set(STAGED_PAIR_DESIGNS.map(d=>d.key)).size).toBe(STAGED_PAIR_DESIGNS.length);
    for(const design of LEGACY_CARD_DESIGNS)expect(isCardDesignKey(design.key)).toBe(true);
    for(const design of STAGED_PAIR_DESIGNS){
      expect(design.key).toBe(`pair-${design.quoteKey}`);
      expect(design.quoteMint).toBe(getPairAsset(design.quoteKey).mint);
      const kind=getPairAsset(design.quoteKey).kind;
      expect(design.category).toBe(kind==="stock"?"stocks":["meme","collector"].includes(kind)?"memes":"crypto");
      expect(isCardDesignKey(design.key)).toBe(ACTIVE_PAIR_DESIGNS.some(active=>active.key===design.key));
    }
    expect(isCardDesignKey("pair-pending-missing-art")).toBe(false);
    expect(()=>resolveLaunchQuote("pair-pending-missing-art",{quoteAssetKey:"sol"})).toThrow("available card design");
  });
  test("all rendering derivatives, source commitments and exact mint are required together",()=>{
    const design=STAGED_PAIR_DESIGNS.find(d=>d.quoteKey==="sol")!;
    const prefix=`/assets/carddex/higgsfield/${design.key}`;
    const install:PairDesignInstallation={
      quoteMint:design.quoteMint,layout:{art:{x:.1,y:.15,w:.8,h:.44},prints:{name:{x:.1,y:.055,w:.8,h:.06},type:{x:.1,y:.615,w:.8,h:.034},text:{x:.1,y:.67,w:.8,h:.255}},mask:{width:800,height:440,path:"M0 0h800v440H0Z"}},
      assets:{front:`${prefix}-front.webp`,back:`${prefix}-back.webp`,front320:`${prefix}-front-320.webp`,back320:`${prefix}-back-320.webp`},
      source:{front:{path:`${prefix}-front.webp`,sha256:"a".repeat(64)},back:{path:`${prefix}-back.webp`,sha256:"b".repeat(64)}},
      atlas:{designKey:design.key,path:`/assets/carddex/render/${design.key}.png`,previewPath:`/assets/carddex/render/preview/${design.key}.png`,sha256:"c".repeat(64),previewSha256:"d".repeat(64),sourceSha256:"a".repeat(64),rendererVersion:CARD_RENDERER_VERSION,width:1260,height:1760},
      reverse:{designKey:design.key,path:`/assets/carddex/token-backs/${design.key}.png`,sha256:"e".repeat(64),sourceSha256:"b".repeat(64),conversionVersion:"launchacard-token-back-png-v1",width:630,height:880},
    };
    expect(isPairDesignInstalled(design,install)).toBe(true);
    for(const key of Object.keys(install) as (keyof PairDesignInstallation)[])expect(isPairDesignInstalled(design,{...install,[key]:undefined})).toBe(false);
    expect(isPairDesignInstalled(design,{...install,quoteMint:getPairAsset("usdc").mint})).toBe(false);
    expect(isPairDesignInstalled(design,{...install,layout:{}})).toBe(false);
    expect(isPairDesignInstalled(design,{...install,assets:{...install.assets,back:"https://provider.example/job-not-installed"}})).toBe(false);
    expect(isPairDesignInstalled(design,{...install,atlas:{...install.atlas!,sourceSha256:"f".repeat(64)}})).toBe(false);
    expect(isPairDesignInstalled(design,{...install,reverse:{...install.reverse!,sourceSha256:"f".repeat(64)}})).toBe(false);
    expect(isPairDesignInstalled(design,{...install,atlas:{...install.atlas!,rendererVersion:"stale"}})).toBe(false);
  });
  test("installed exact identities bind only their own pair, and are their pair's card except SOL's and USDC's",()=>{
    for(const design of ACTIVE_PAIR_DESIGNS){
      const asset=getPairAsset(design.quoteKey);
      expect(defaultQuoteForDesign(design.key)).toBe(asset);
      expect(allowedQuotesForDesign(design.key)).toEqual([asset]);
      // The owner keeps One Piece on SOL and Duel Masters on USDC: pair-sol and pair-usdc render but are never offered.
      // A held identity renders too; its pair launches with the design the hold names, or is not offered.
      if(asset.key==="sol"||asset.key==="usdc"){
        expect(designForPair(asset.key)).toBe(asset.key==="sol"?"one-piece":"duel-masters");
        expect(pairForDesign(design.key)).toBeNull();
      }else if(isHeldPairDesign(design.key)){
        expect(designForPair(asset.key)).toBe((HELD_PAIR_DESIGNS[design.key] ?? null) as never);
        expect(pairForDesign(design.key)).toBeNull();
      }else{
        expect(designForPair(asset.key)).toBe(design.key);
        expect(pairForDesign(design.key)).toBe(asset);
      }
      expect(resolveLaunchQuote(design.key,{quoteAssetKey:asset.key,quoteMint:asset.mint})).toBe(asset);
      const other=getPairAsset(asset.key==="sol"?"usdc":"sol");
      expect(()=>resolveLaunchQuote(design.key,{quoteAssetKey:other.key})).toThrow("paired with");
      expect(()=>resolveLaunchQuote(design.key,{quoteAssetKey:asset.key,quoteMint:other.mint})).toThrow("quote mint");
      // The historical presets are kept byte for byte: none names an identity design.
      expect(MEME_PAIR_PRESETS.some(p=>p.design===design.key)).toBe(false);
    }
    for(const oldNeutral of ["spark","ember","frost","obsidian-archive","pokemon-classic","pepe"]){
      expect(defaultQuoteForDesign(oldNeutral).key).toBe("sol");
      for(const key of ["sol","tslax","cards"])expect(resolveLaunchQuote(oldNeutral,{quoteAssetKey:key}).key).toBe(key);
    }
  });
});
