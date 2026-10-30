import staged from "./pair-designs.json";
import { CARD_RENDERER_VERSION } from "./card-template";

export type PairDesignKey = `pair-${string}`;
export type PairDesign = {
  key: PairDesignKey; quoteKey: string; quoteMint: string; name: string; description: string;
  category: "stocks" | "memes" | "crypto"; materialLevel: number;
  palette: readonly [string, string, string]; finish: "holo" | "gold" | "prism";
};
type Source = {path:string;sha256:string};
type Assets = {front?:string;back?:string;front320?:string;back320?:string};
type Atlas = {designKey:string;path:string;previewPath:string;sha256:string;previewSha256:string;sourceSha256:string;rendererVersion:string;width:number;height:number};
type Reverse = {designKey:string;path:string;sha256:string;sourceSha256:string;conversionVersion:string;width:number;height:number};
export type PairDesignInstallation = {
  assets?: Assets; layout?: unknown; source?: {front:Source;back:Source};
  atlas?: Atlas; reverse?: Reverse; quoteMint?: string;
};
const hash = (value?:string) => !!value && /^[a-f0-9]{64}$/.test(value);
function measuredLayout(value:unknown):boolean {
  if(!value || typeof value!=="object")return false;
  const layout=value as {art?:unknown;mask?:{width?:number;height?:number;path?:string};prints?:Record<string,unknown>};
  const box=(value:unknown)=>{
    if(!value || typeof value!=="object")return false;
    const b=value as {x:number;y:number;w:number;h:number};
    return [b.x,b.y,b.w,b.h].every(Number.isFinite) && b.x>=0 && b.y>=0 && b.w>0 && b.h>0 && b.x+b.w<=1.001 && b.y+b.h<=1.001;
  };
  return box(layout.art) && !!layout.mask && Number.isFinite(layout.mask.width) && layout.mask.width!>0 &&
    Number.isFinite(layout.mask.height) && layout.mask.height!>0 && typeof layout.mask.path==="string" && layout.mask.path.length>0 &&
    !!layout.prints && ["name","type","text"].every(key=>box(layout.prints?.[key]));
}

/** No pending generation or incomplete conversion may expose a generic card as an identity design. */
export function isPairDesignInstalled(design:PairDesign, install:PairDesignInstallation):boolean {
  const {assets,layout,source,atlas,reverse,quoteMint}=install;
  const prefix=`/assets/carddex/higgsfield/${design.key}`;
  const atlasKey=design.key+(design.category==="stocks"?"--stock":"");
  return !!quoteMint && quoteMint===design.quoteMint && measuredLayout(layout) && !!source && !!assets && !!atlas && !!reverse &&
    assets.front===`${prefix}-front.webp` && assets.back===`${prefix}-back.webp` &&
    assets.front320===`${prefix}-front-320.webp` && assets.back320===`${prefix}-back-320.webp` &&
    source.front.path===assets.front && source.back.path===assets.back && hash(source.front.sha256) && hash(source.back.sha256) &&
    atlas.designKey===design.key && atlas.path===`/assets/carddex/render/${atlasKey}.png` &&
    atlas.previewPath===`/assets/carddex/render/preview/${atlasKey}.png` &&
    hash(atlas.sha256) && hash(atlas.previewSha256) && atlas.sourceSha256===source.front.sha256 &&
    atlas.rendererVersion===CARD_RENDERER_VERSION && atlas.width===1260 && atlas.height===1760 &&
    reverse.designKey===design.key && reverse.path===`/assets/carddex/token-backs/${design.key}.png` &&
    hash(reverse.sha256) && reverse.sourceSha256===source.back.sha256 && reverse.width===630 && reverse.height===880 &&
    reverse.conversionVersion==="launchacard-token-back-png-v1";
}

export const STAGED_PAIR_DESIGNS = Object.freeze(staged.map(design=>{
  if(design.key!==`pair-${design.quoteKey}` || !/^[a-z0-9-]+$/.test(design.quoteKey) ||
    !["stocks","memes","crypto"].includes(design.category) || !["holo","gold","prism"].includes(design.finish) ||
    design.palette.length!==3 || design.palette.some(color=>!/^#[a-fA-F0-9]{6}$/.test(color))) {
    throw new Error("Invalid staged pair-design metadata.");
  }
  return Object.freeze(design) as unknown as PairDesign;
}));
/**
 * Staged pair designs with no finished art (owner rule 4, 30 October 2026): their pairs are not offered for new
 * launches until a finished card exists. The manifests are checked in tests (pair-designs-installed.ts) instead of
 * here, so the token-back, reviewed-source and atlas manifests stay out of the browser bundle.
 */
export const WITHHELD_PAIR_DESIGNS: readonly PairDesignKey[] = Object.freeze(["pair-aave", "pair-uni"] as PairDesignKey[]);
/**
 * Installed pair designs held back for the owner's review (fix pass, 30 October 2026), treated like the withheld ones:
 * no design key, not on Designs, their pairs not offered. A coin's back becomes its public coin image for good, so
 * these wait for a yes: pair-67 shows a photoreal child (a real minor's likeness), pair-ansem a photoreal man's head on
 * a bull's body, and pair-spx's back misspells the coin ("SBP 6900"). Delivered art is untouched; deleting a key here
 * offers its pair again with that design. No coin can carry one yet, so holding them changes no stored coin.
 */
export const HELD_PAIR_DESIGNS: readonly PairDesignKey[] = Object.freeze(["pair-67", "pair-ansem", "pair-spx"] as PairDesignKey[]);
export const ACTIVE_PAIR_DESIGNS: readonly PairDesign[] = Object.freeze(STAGED_PAIR_DESIGNS.filter(design => !WITHHELD_PAIR_DESIGNS.includes(design.key) && !HELD_PAIR_DESIGNS.includes(design.key)));
export const activePairDesignForQuote = (key: string) => ACTIVE_PAIR_DESIGNS.find(design => design.quoteKey === key) ?? null;
