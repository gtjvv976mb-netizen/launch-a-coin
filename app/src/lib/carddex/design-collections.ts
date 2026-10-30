import {CARD_DESIGNS,DEFAULT_CARD_DESIGN,getCardDesign,isCardDesignKey,type CardDesign} from "./designs";
import {boundQuoteForDesign,preferredDesignForQuote,recommendedMemeQuoteForDesign} from "./pairs";
import {activePairDesignForQuote} from "./pair-designs";

export function cardMatchesCollection(design:CardDesign,group:string):boolean {
  if(group==="all")return true;
  if(group==="stocks"){
    const quote=boundQuoteForDesign(design.key);
    const exact=quote && activePairDesignForQuote(quote.key);
    return quote?.kind==="stock" && (!exact || exact.key===design.key);
  }
  if(group==="memes")return !!recommendedMemeQuoteForDesign(design.key);
  return design.category===group;
}

/** Archive browsing follows current complete artwork; this never changes a saved launch or coin record. */
export function designForCollection(designKey:string|undefined,collection:string,quoteKey?:string):CardDesign {
  const selected=isCardDesignKey(designKey)?getCardDesign(designKey):null;
  const paired=["stocks","memes","crypto"].includes(collection);
  const exact=quoteKey?activePairDesignForQuote(quoteKey):null;
  if(paired && exact && cardMatchesCollection(getCardDesign(exact.key),collection))return getCardDesign(exact.key);
  if(selected && (!paired || cardMatchesCollection(selected,collection)))return selected;
  const preferred=quoteKey?preferredDesignForQuote(quoteKey):null;
  return (paired ? CARD_DESIGNS.find(design=>design.key===preferred && cardMatchesCollection(design,collection)) ??
    CARD_DESIGNS.find(design=>cardMatchesCollection(design,collection)) : null) ?? getCardDesign(DEFAULT_CARD_DESIGN);
}
