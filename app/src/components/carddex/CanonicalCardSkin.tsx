import { useId, useRef } from "react";
import { getCardDesign, type CardDesign } from "../../lib/carddex/designs";
import renderAssets from "../../lib/carddex/render-assets.json";
import { CANONICAL_CARD_LAYOUT, CARD_RENDERER_VERSION } from "../../lib/carddex/card-template";
import { generatedSkinSource, phoneCopy, useDeferredPlate, useReadyImage, type GeneratedSkinSource } from "./GeneratedCardArt";
import { defaultQuoteForDesign, getPairAsset } from "../../lib/carddex/pairs";
import { useFreshMount } from "../mintdex/card3d/motion3d";

type Box = { x:number; y:number; w:number; h:number };
type Insets = { x:number; y?:number; top?:number; bottom?:number };
type RenderAsset = {path:string;previewPath?:string;rendererVersion:string};
const WHOLE: Box = {x:0,y:0,w:1,h:1};
// The bottom crop starts below every old footer plate; its continuous material fills the new base.
const SOURCE_RAIL = {x:.12,top:.035,bottom:.022};
const TARGET_RAIL = {x:.09,y:.065};
const SOURCE_RIM = {x:.009,y:.0065};
const RIM = {x:.012,y:.0086};
const PLATES = {name:CANONICAL_CARD_LAYOUT.name,type:CANONICAL_CARD_LAYOUT.type,text:CANONICAL_CARD_LAYOUT.text};
const grow = (b:Box, dx:number, dy:number):Box => ({x:b.x-dx,y:b.y-dy,w:b.w+2*dx,h:b.h+2*dy});

/** Preserve native corners and rails; plates include their original textured center as well. */
function SurfaceSlice({source,from,to,sourceInset,targetInset,center=false}:{source:string;from:Box;to:Box;sourceInset:Insets;targetInset:Insets;center?:boolean}) {
  const sx=[from.x,from.x+sourceInset.x,from.x+from.w-sourceInset.x,from.x+from.w];
  const sy=[from.y,from.y+(sourceInset.top??sourceInset.y??0),from.y+from.h-(sourceInset.bottom??sourceInset.y??0),from.y+from.h];
  const tx=[to.x,to.x+targetInset.x,to.x+to.w-targetInset.x,to.x+to.w];
  const ty=[to.y,to.y+(targetInset.top??targetInset.y??0),to.y+to.h-(targetInset.bottom??targetInset.y??0),to.y+to.h];
  return <>{[0,1,2].flatMap(y=>[0,1,2].filter(x=>center||x!==1||y!==1).map(x=>{
    // Subpixel overlaps keep adjacent crops continuous at small browser sizes and in PNG exports.
    const left=x>0?.3:0,right=x<2?.3:0,top=y>0?.3:0,bottom=y<2?.3:0;
    return <svg key={`${x}-${y}`} x={tx[x]*1000-left} y={ty[y]*1000-top} width={(tx[x+1]-tx[x])*1000+left+right} height={(ty[y+1]-ty[y])*1000+top+bottom} viewBox={`${sx[x]*1000} ${sy[y]*1000} ${(sx[x+1]-sx[x])*1000} ${(sy[y+1]-sy[y])*1000}`} preserveAspectRatio="none" overflow="hidden"><use href={`#${source}`} /></svg>;
  }))}</>;
}

/** Browser and exported NFTs use the same locally flattened original-art surface. */
export function canonicalSkinAsset(cardTemplate:string,quoteAssetKey?:string) {
  const quote=quoteAssetKey?getPairAsset(quoteAssetKey):defaultQuoteForDesign(cardTemplate);
  const key=cardTemplate+(quote.kind==="stock"?"--stock":"");
  const candidate=(renderAssets as Record<string,RenderAsset>)[key];
  return candidate?.rendererVersion===CARD_RENDERER_VERSION?candidate:null;
}

/** Phones and tablets: their skin candidates stop at the 640 px copy (the 1260 px atlas is a 2 MB PNG). */
export const SKIN_PHONE_MEDIA="(max-width: 1023px)";
export function phoneSkin() {
  return typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia(SKIN_PHONE_MEDIA).matches;
}

/** A skin's srcset: the 480 and 640 px WebP copies written beside its preview (preview/<key>-480.webp and
 * preview/<key>-640.webp, by scripts/card-skin-variants.ts), then the 1260 px atlas except on phones (`phone`).
 * The 320 px preview PNG is left out where the copies exist: it weighs about seven 480 px WebP copies. */
export function canonicalSkinSrcSet(atlas:RenderAsset,phone=false) {
  if(!atlas.previewPath) return `${atlas.path} 1260w`;
  const base=atlas.previewPath.replace(/\.png$/,"");
  if(base===atlas.previewPath) return `${atlas.previewPath} 320w, ${atlas.path} 1260w`;
  const copies=`${base}-480.webp 480w, ${base}-640.webp 640w`;
  return phone?copies:`${copies}, ${atlas.path} 1260w`;
}

/** The small copy a staged or miniature plate takes on a phone: the 480 px WebP where it exists. */
function smallSkin(atlas:RenderAsset) {
  const base=atlas.previewPath!.replace(/\.png$/,"");
  return base!==atlas.previewPath?`${base}-480.webp`:atlas.previewPath!;
}

const stagedIdle=()=>true;

/** `full`: a viewer opened to look closely (Inspect, the 3D turntable) keeps the 1260 px atlas on phones and tablets too. */
export function CanonicalCardSkin({cardTemplate,quoteAssetKey,priority=false,eager=false,lite=false,full=false,sizes}:{cardTemplate:string;quoteAssetKey?:string;priority?:boolean;eager?:boolean;lite?:boolean;full?:boolean;sizes?:string}) {
  const id=useId().replaceAll(":", "");
  const quote=quoteAssetKey?getPairAsset(quoteAssetKey):defaultQuoteForDesign(cardTemplate);
  const atlas=canonicalSkinAsset(cardTemplate,quoteAssetKey);
  const box=useRef<HTMLDivElement>(null);
  // A staged slot (eager: a neighbour the card turns to next) and a lite miniature (the blurred neighbours beside
  // the Home card) wait for the first touch or turn, or load plus idle (PERF-1), and phones take the 480px copy;
  // the shown face and other lazy cards load as before.
  const staged=(eager||lite)&&!priority;
  const wanted=useDeferredPlate(box,!staged,stagedIdle)||!staged;
  const small=staged&&!!atlas?.previewPath&&phoneCopy();
  const src=atlas&&wanted?(small?smallSkin(atlas):atlas.path):null;
  const imageRef=useRef<HTMLImageElement>(null);
  const image=useReadyImage(imageRef,src);
  const ready=!!src && image.ready;
  // The skin the server HTML painted shows as soon as the browser decodes it: it is the page's LCP and must not wait
  // for hydration. A face mounted on the client, or a skin that changes later, stays hidden until it has loaded.
  const fresh=useFreshMount();
  const painted=useRef<string|null|undefined>(undefined);
  if(painted.current===undefined) painted.current=fresh?null:src;
  const shown=ready||(!!src&&src===painted.current);
  const imageSizes=small?undefined:sizes??(priority||eager?"300px":"auto, 300px");
  const skin=atlas&&src?<img ref={imageRef} className="cdx-canonical-skin__image" src={src} srcSet={small?undefined:canonicalSkinSrcSet(atlas)} sizes={imageSizes} style={shown?undefined:{opacity:0}} alt="" hidden={image.failed} draggable={false} loading={priority||eager?"eager":"lazy"} decoding="async" fetchPriority={priority?"high":eager?"low":undefined} onLoad={image.onLoad} onError={image.onError} />:null;
  return <div ref={box} className="cdx-canonical-skin" data-market-finish={quote.kind} data-card-skin-ready={ready?"":undefined} data-card-skin-source={ready?cardTemplate:undefined} aria-hidden>
    <CanonicalSkinSurface cardTemplate={cardTemplate} quoteAssetKey={quoteAssetKey} id={id} />
    {skin&&atlas?(small||full?skin:<picture><source media={SKIN_PHONE_MEDIA} srcSet={canonicalSkinSrcSet(atlas,true)} sizes={imageSizes} />{skin}</picture>):null}
  </div>;
}

/** Pure SVG surface shared with the trusted PNG compositor; no loading hooks or alternate print geometry. */
export function CanonicalSkinSurface({cardTemplate,sourceUri,id="canonical",preparedSource}:{cardTemplate:string;quoteAssetKey?:string;sourceUri?:string|null;id?:string;preparedSource?:{design:Pick<CardDesign,"key"|"palette">;source:GeneratedSkinSource}}) {
  // Offline preparation uses explicit reviewed inputs before the complete-install gate can activate a new design.
  const design=preparedSource?.design??getCardDesign(cardTemplate);
  const source=preparedSource?.source??generatedSkinSource(cardTemplate);
  const ready=!!sourceUri && !!source;
  const dark=design.key==="neon-circuit";
  const raster=`${id}raster`,material=`${id}material`,mask=`${id}material-mask`,edge=`${id}edge`;
  const paper=dark?"#102b30":design.palette[2];
  const pairSource=design.key.startsWith("pair-")&&source;
  // New masters have no footer holes. Select only their native outer ornament,
  // excluding the measured content rims so the shared print has no double frame.
  const rails=pairSource?{
    x:Math.max(.025,Math.min(source.art.x,...Object.values(source.plates).map(b=>b.x),1-source.art.x-source.art.w,...Object.values(source.plates).map(b=>1-b.x-b.w))-.012),
    top:Math.max(.02,source.plates.name.y-.0065),
    bottom:Math.max(.022,1-source.plates.text.y-source.plates.text.h-.0065),
  }:SOURCE_RAIL;
  const targetRails=pairSource?{x:.088,top:.0485,bottom:.0685}:TARGET_RAIL;
  // Some new skins share a single native line between panels. Never grow a
  // sampled rim far enough to borrow pixels from the neighboring aperture.
  const sourceRim=pairSource&&source.sourceMaterialGaps?{...SOURCE_RIM,y:Math.min(SOURCE_RIM.y,Math.max(.001,Math.min(
    source.art.y-source.plates.name.y-source.plates.name.h,
    source.plates.type.y-source.art.y-source.art.h,
    source.plates.text.y-source.plates.type.y-source.plates.type.h,
  )*.45))}:SOURCE_RIM;
  const sourceMaterialGaps=pairSource&&source.sourceMaterialGaps?[
    [source.plates.name,source.art,CANONICAL_CARD_LAYOUT.name,CANONICAL_CARD_LAYOUT.window],
    [source.art,source.plates.type,CANONICAL_CARD_LAYOUT.window,CANONICAL_CARD_LAYOUT.type],
    [source.plates.type,source.plates.text,CANONICAL_CARD_LAYOUT.type,CANONICAL_CARD_LAYOUT.text],
  ].map(([above,below,targetAbove,targetBelow])=>{
    const center=(above.y+above.h+below.y)/2;
    const height=Math.max(.001,Math.min(.004,(below.y-above.y-above.h)*.35));
    const left=Math.max(above.x,below.x),right=Math.min(above.x+above.w,below.x+below.w);
    return {from:{x:left,y:center-height/2,w:right-left,h:height},to:{x:.088,y:targetAbove.y+targetAbove.h+RIM.y,w:.824,h:targetBelow.y-targetAbove.y-targetAbove.h-2*RIM.y}};
  }).filter(gap=>gap.from.h>0&&gap.to.h>0):[];
  return (
    <svg className="cdx-canonical-skin__surface" viewBox="0 0 1000 1000" preserveAspectRatio="none" focusable="false">
      <defs>
        <clipPath id={edge}><rect width="1000" height="1000" rx={CANONICAL_CARD_LAYOUT.radius*1000} ry={CANONICAL_CARD_LAYOUT.radius*1000*63/88} /></clipPath>
        <linearGradient id={`${id}base`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={design.palette[0]} /><stop offset=".5" stopColor={design.palette[0]} /><stop offset="1" stopColor={design.palette[1]} /></linearGradient>
        <linearGradient id={`${id}metal`}><stop stopColor={design.palette[2]} /><stop offset=".24" stopColor={design.palette[1]} /><stop offset=".49" stopColor={design.palette[0]} /><stop offset=".74" stopColor={design.palette[1]} /><stop offset="1" stopColor={design.palette[2]} /></linearGradient>
        <linearGradient id={`${id}paper`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={paper} /><stop offset="1" stopColor={paper} /></linearGradient>
        {ready&&source?<>
          <image id={raster} href={sourceUri!} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" />
          <mask id={mask} x="0" y="0" width="1000" height="1000" maskUnits="userSpaceOnUse" style={{maskType:"luminance"}}>
            <rect width="1000" height="1000" fill="white" />
            <g transform={`translate(${source.art.x*1000} ${source.art.y*1000}) scale(${source.art.w*1000/source.mask.width} ${source.art.h*1000/source.mask.height})`}><path d={source.mask.path} fill="black" /></g>
            {Object.entries(source.plates).map(([key,plate])=>{
              const box=key.startsWith("foot")?grow(plate,SOURCE_RIM.x,SOURCE_RIM.y):plate;
              return <rect key={key} x={box.x*1000} y={box.y*1000} width={box.w*1000} height={box.h*1000} fill="black" />;
            })}
          </mask>
          <g id={material}><use href={`#${raster}`} mask={`url(#${mask})`} /></g>
        </>:null}
      </defs>
      <g clipPath={`url(#${edge})`}>
        <rect width="1000" height="1000" fill={`url(#${id}base)`} />
        {ready&&source?<g className="cdx-canonical-skin__atlas">
          {sourceMaterialGaps.map(({from,to},index)=><svg key={`material-gap-${index}`} x={to.x*1000} y={to.y*1000} width={to.w*1000} height={to.h*1000} viewBox={`${from.x*1000} ${from.y*1000} ${from.w*1000} ${from.h*1000}`} preserveAspectRatio="none" overflow="hidden"><use href={`#${raster}`} /></svg>)}
          <SurfaceSlice source={material} from={WHOLE} to={WHOLE} sourceInset={rails} targetInset={targetRails} />
          <SurfaceSlice source={material} from={grow(source.art,sourceRim.x,sourceRim.y)} to={grow(CANONICAL_CARD_LAYOUT.window,RIM.x,RIM.y)} sourceInset={sourceRim} targetInset={RIM} />
          {Object.entries(PLATES).map(([key,box])=><SurfaceSlice key={key} source={raster} from={grow(source.plates[key],sourceRim.x,sourceRim.y)} to={grow(box,RIM.x,RIM.y)} sourceInset={sourceRim} targetInset={RIM} center />)}
        </g>:<>
          <rect x="14" y="10" width="972" height="980" rx="40" fill="none" stroke={`url(#${id}metal)`} strokeWidth="15" />
          <rect {...{x:(CANONICAL_CARD_LAYOUT.window.x-RIM.x)*1000,y:(CANONICAL_CARD_LAYOUT.window.y-RIM.y)*1000,width:(CANONICAL_CARD_LAYOUT.window.w+RIM.x*2)*1000,height:(CANONICAL_CARD_LAYOUT.window.h+RIM.y*2)*1000}} rx="10" fill={design.palette[0]} stroke={`url(#${id}metal)`} strokeWidth="9" />
          {Object.entries(PLATES).map(([key,box])=><rect key={key} x={box.x*1000} y={box.y*1000} width={box.w*1000} height={box.h*1000} rx="6" fill={`url(#${id}paper)`} stroke={`url(#${id}metal)`} strokeWidth="4" />)}
        </>}
      </g>
    </svg>
  );
}
