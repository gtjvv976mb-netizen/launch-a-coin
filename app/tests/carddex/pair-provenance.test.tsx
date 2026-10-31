import {describe,expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {QuoteAssetMeta} from "../../src/components/carddex/QuoteAssetMeta";
import {CONFIRMED_DIRECT_PAIRS,PAIR_ASSETS,chargesTransferFee,isDirectPair} from "../../src/lib/carddex/pairs";
import {STAGED_PAIR_DESIGNS} from "../../src/lib/carddex/pair-designs";

const DIRECT_LINE = "Not on pump.fun's public pairs list; admitted on-chain";

describe("pair catalogue provenance",()=>{
  test("the 19 direct quotes say so under the pair HUD, before wallet review; the 78 others do not",()=>{
    const direct=PAIR_ASSETS.filter(isDirectPair);
    expect(direct).toHaveLength(19);
    expect(PAIR_ASSETS.length-direct.length).toBe(78);
    for(const asset of PAIR_ASSETS){
      for(const live of [false,true]){
        const meta=renderToStaticMarkup(<QuoteAssetMeta quoteAssetKey={asset.key} live={live} />).replaceAll("&#x27;","'");
        expect(meta).toContain(asset.mint);
        expect(meta).toContain("pump.fun pairs");
        if(isDirectPair(asset)&&live&&!(CONFIRMED_DIRECT_PAIRS as readonly string[]).includes(asset.key)){
          // Mainnet mode: an unconfirmed direct pair says only that mainnet can't use it yet, and why.
          expect(meta).toContain("Mainnet launches can't use this pair yet: it isn't on pump.fun's public pairs list.");
          expect(meta).not.toContain(DIRECT_LINE);
        }else if(isDirectPair(asset)){
          // The demo, or a direct pair the owner confirmed for mainnet (HODL, SOLANGELES): the plain provenance line.
          expect(meta).toContain(`${DIRECT_LINE} (checked ${asset.verifiedAt}).`);
          expect(meta.match(/admitted on-chain/g)).toHaveLength(1);
          expect(meta).not.toContain("Mainnet launches");
        }else{
          expect(meta).not.toContain(DIRECT_LINE);
          expect(meta).not.toContain("public pairs list");
        }
        // A transfer-fee pair (ZCAT) says why mainnet can't use it, in mainnet mode only.
        expect(meta.includes("its mint charges a transfer fee")).toBe(live && chargesTransferFee(asset.key));
      }
    }
  });
  test("staged descriptions are concise identity/material copy without production instructions",()=>{
    expect(STAGED_PAIR_DESIGNS).toHaveLength(97);
    for(const design of STAGED_PAIR_DESIGNS){
      expect(design.description.length).toBeGreaterThan(15);
      expect(design.description.length).toBeLessThan(140);
      expect(design.description).not.toMatch(/\b(source|reference|verified|aperture|must|never|confined|generation|placeholder|pending)\b/i);
    }
  });
});
