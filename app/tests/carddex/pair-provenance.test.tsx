import {describe,expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {QuoteAssetDetails,QuoteAssetPicker} from "../../src/components/carddex/QuoteAssetPicker";
import {PAIR_ASSETS,DIRECT_PAIR_NOTICE,pairListingNotice} from "../../src/lib/carddex/pairs";
import {STAGED_PAIR_DESIGNS,ACTIVE_PAIR_DESIGNS} from "../../src/lib/carddex/pair-designs";
import {LEGACY_MEME_PAIR_PRESETS,LEGACY_DESIGN_QUOTE_KEYS} from "../../src/lib/carddex/design-pairings";
import {cardMatchesCollection,designForCollection} from "../../src/lib/carddex/design-collections";
import {getCardDesign} from "../../src/lib/carddex/designs";

describe("pair catalogue provenance and current design browsing",()=>{
  test("all19 direct quotes show their non-public-table status before wallet review",()=>{
    const direct=PAIR_ASSETS.filter(asset=>asset.listingStatus==="direct-onchain");
    expect(direct).toHaveLength(19);
    for(const asset of direct){
      expect(pairListingNotice(asset)).toBe(DIRECT_PAIR_NOTICE);
      const details=renderToStaticMarkup(<QuoteAssetDetails quoteAssetKey={asset.key} live />);
      expect(details).toContain(DIRECT_PAIR_NOTICE);
      expect(details).toContain(asset.mint);
      expect(details).toContain("Pump pair rules");
      for(const viewport of [false,true]){
        const picker=renderToStaticMarkup(<QuoteAssetPicker value={asset.key} designKey="spark" onChange={()=>{}} viewport={viewport} live disabled />);
        expect(picker).toContain(DIRECT_PAIR_NOTICE);
        expect(picker.match(/Direct QuoteControl-enabled;/g)).toHaveLength(1);
        expect(picker).toContain("On-chain enabled");
      }
    }
    expect(pairListingNotice(PAIR_ASSETS.find(asset=>asset.key==="sol")!)).toBeNull();
  });
  test("staged descriptions are concise identity/material copy without production instructions",()=>{
    expect(STAGED_PAIR_DESIGNS).toHaveLength(97);
    for(const design of STAGED_PAIR_DESIGNS){
      expect(design.description.length).toBeGreaterThan(15);
      expect(design.description.length).toBeLessThan(140);
      expect(design.description).not.toMatch(/\b(source|reference|verified|aperture|must|never|confined|generation|placeholder|pending)\b/i);
    }
  });
  test("complete exact art supersedes legacy archive links while All and saved choices preserve their identity",()=>{
    for(const exact of ACTIVE_PAIR_DESIGNS){
      const previousPreset=LEGACY_MEME_PAIR_PRESETS.find(preset=>preset.quote===exact.quoteKey)?.design ??
        Object.entries(LEGACY_DESIGN_QUOTE_KEYS).find(([,quote])=>quote===exact.quoteKey)?.[0];
      const previous=previousPreset ?? "spark";
      expect(designForCollection(previous,exact.category,exact.quoteKey).key).toBe(exact.key);
      expect(cardMatchesCollection(getCardDesign(exact.key),exact.category)).toBe(true);
      if(previousPreset)expect(cardMatchesCollection(getCardDesign(previous),exact.category)).toBe(false);
      expect(designForCollection(previous,"all",exact.quoteKey).key).toBe(previous);
    }
    expect(designForCollection("ember","all","fartcoin").key).toBe("ember");
    expect(designForCollection("pepe","all","toad").key).toBe("pepe");
  });
});
