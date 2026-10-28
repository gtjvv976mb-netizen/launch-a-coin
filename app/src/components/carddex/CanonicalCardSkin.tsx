import { useId, useRef } from "react";
import { getCardDesign } from "../../lib/carddex/designs";
import { generatedCardAssets } from "../../lib/carddex/generated-assets";
import { CANONICAL_CARD_LAYOUT } from "../../lib/carddex/card-template";
import { generatedSkinSource, phoneCopy, useDeferredPlate, useReadyImage } from "./GeneratedCardArt";
import { defaultQuoteForDesign, getPairAsset } from "../../lib/carddex/pairs";

type Box = { x:number; y:number; w:number; h:number };
const WHOLE: Box = {x:0,y:0,w:1,h:1};
const RAIL = {x:.035,y:.025};
const RIM = {x:.012,y:.0086};
const PLATES = {name:CANONICAL_CARD_LAYOUT.name,type:CANONICAL_CARD_LAYOUT.type,text:CANONICAL_CARD_LAYOUT.text,"foot-a":CANONICAL_CARD_LAYOUT.footer[0],"foot-b":CANONICAL_CARD_LAYOUT.footer[1]};
const grow = (b:Box, dx:number, dy:number):Box => ({x:b.x-dx,y:b.y-dy,w:b.w+2*dx,h:b.h+2*dy});
const sealHex=(radius:number)=>Array.from({length:6},(_,i)=>{const angle=-Math.PI/2+i*Math.PI/3;return`${i?"L":"M"}${(500+Math.cos(angle)*radius).toFixed(3)} ${(882+Math.sin(angle)*radius*63/88).toFixed(3)}`}).join("")+"Z";
const SEAL_RAYS=Array.from({length:48},(_,i)=>{const angle=i*Math.PI/24;return`M${(500+Math.cos(angle)*59).toFixed(3)} ${(882+Math.sin(angle)*59*63/88).toFixed(3)}L${(500+Math.cos(angle)*69).toFixed(3)} ${(882+Math.sin(angle)*69*63/88).toFixed(3)}`}).join("");

/** Nine-slice only borders: no source center, gray aperture or old live-content layout is rendered. */
function BorderSlice({source,from,to,sourceInset,targetInset}:{source:string;from:Box;to:Box;sourceInset:{x:number;y:number};targetInset:{x:number;y:number}}) {
  const sx=[from.x,from.x+sourceInset.x,from.x+from.w-sourceInset.x,from.x+from.w];
  const sy=[from.y,from.y+sourceInset.y,from.y+from.h-sourceInset.y,from.y+from.h];
  const tx=[to.x,to.x+targetInset.x,to.x+to.w-targetInset.x,to.x+to.w];
  const ty=[to.y,to.y+targetInset.y,to.y+to.h-targetInset.y,to.y+to.h];
  return <>{[0,1,2].flatMap(y=>[0,1,2].filter(x=>x!==1||y!==1).map(x=><svg key={`${x}-${y}`} x={tx[x]*1000} y={ty[y]*1000} width={(tx[x+1]-tx[x])*1000} height={(ty[y+1]-ty[y])*1000} viewBox={`${sx[x]*1000} ${sy[y]*1000} ${(sx[x+1]-sx[x])*1000} ${(sy[y+1]-sy[y])*1000}`} preserveAspectRatio="none" overflow="hidden"><use href={`#${source}`} /></svg>))}</>;
}

const stagedIdle=()=>true;

/** Untouched Higgsfield pixels decorate the same permanent print grid in browser and exported NFTs. */
export function CanonicalCardSkin({cardTemplate,quoteAssetKey,priority=false,eager=false,lite=false,sizes}:{cardTemplate:string;quoteAssetKey?:string;priority?:boolean;eager?:boolean;lite?:boolean;sizes?:string}) {
  const id=useId().replaceAll(":", "");
  const assets=generatedCardAssets(cardTemplate);
  const imageRef=useRef<HTMLImageElement>(null);
  const image=useReadyImage(imageRef,assets.front ?? null);
  const box=useRef<HTMLDivElement>(null);
  // A staged slot (eager: a neighbour the card turns to next) and a lite miniature (the blurred neighbours beside
  // the Home card) wait for the first touch or turn, or load plus idle (PERF-1), and phones take their 320px copy;
  // the shown face and other lazy cards load as before.
  const staged=(eager||lite)&&!priority;
  const wanted=useDeferredPlate(box,!staged,stagedIdle)||!staged;
  const small=staged&&!!assets.front320&&phoneCopy();
  const ready=image.ready && !!image.decodedSource && !!generatedSkinSource(cardTemplate);
  const quote=quoteAssetKey?getPairAsset(quoteAssetKey):defaultQuoteForDesign(cardTemplate);
  return <div ref={box} className="cdx-canonical-skin" data-market-finish={quote.kind} data-card-skin-ready={ready?"":undefined} data-card-skin-source={ready?cardTemplate:undefined} aria-hidden>
    {assets.front&&wanted?<img ref={imageRef} className="cdx-canonical-skin__loader" src={small?assets.front320:assets.front} srcSet={assets.front320&&!small?`${assets.front320} 320w, ${assets.front} 1260w`:undefined} sizes={assets.front320&&!small?sizes??(priority||eager?"300px":"auto, 300px"):undefined} alt="" draggable={false} loading={priority||eager?"eager":"lazy"} decoding="async" fetchPriority={priority?"high":eager?"low":undefined} onLoad={image.onLoad} onError={image.onError} />:null}
    <CanonicalSkinSurface cardTemplate={cardTemplate} quoteAssetKey={quoteAssetKey} sourceUri={ready?image.decodedSource:undefined} id={id} />
  </div>;
}

/** Pure SVG surface shared with the trusted PNG compositor; no loading hooks or alternate print geometry. */
export function CanonicalSkinSurface({cardTemplate,quoteAssetKey,sourceUri,id="canonical"}:{cardTemplate:string;quoteAssetKey?:string;sourceUri?:string|null;id?:string}) {
  const design=getCardDesign(cardTemplate);
  const quote=quoteAssetKey?getPairAsset(quoteAssetKey):defaultQuoteForDesign(cardTemplate);
  const source=generatedSkinSource(cardTemplate);
  const ready=!!sourceUri && !!source;
  const dark=design.key==="neon-circuit";
  const raster=`${id}raster`,material=`${id}material`,mask=`${id}gray`;
  const paper=dark?"#102b30":design.palette[2];
  return (
    <svg className="cdx-canonical-skin__surface" viewBox="0 0 1000 1000" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id={`${id}base`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={design.palette[0]} /><stop offset=".5" stopColor="#121820" /><stop offset="1" stopColor={design.palette[0]} /></linearGradient>
        <linearGradient id={`${id}metal`}><stop stopColor={design.palette[2]} /><stop offset=".24" stopColor={design.palette[1]} /><stop offset=".49" stopColor={design.palette[0]} /><stop offset=".74" stopColor={design.palette[1]} /><stop offset="1" stopColor={design.palette[2]} /></linearGradient>
        <linearGradient id={`${id}paper`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={paper} /><stop offset=".5" stopColor={dark?"#1d363a":"#fff9e8"} /><stop offset="1" stopColor={paper} /></linearGradient>
        {ready&&source?<>
          <image id={raster} href={sourceUri!} x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" />
          <mask id={mask} x="0" y="0" width="1000" height="1000" maskUnits="userSpaceOnUse" style={{maskType:"luminance"}}><rect width="1000" height="1000" fill="white" /><g transform={`translate(${source.art.x*1000} ${source.art.y*1000}) scale(${source.art.w*1000/source.mask.width} ${source.art.h*1000/source.mask.height})`}><path d={source.mask.path} fill="black" /></g></mask>
          <g id={material}><use href={`#${raster}`} mask={`url(#${mask})`} /></g>
        </>:null}
      </defs>
      <rect width="1000" height="1000" rx="50" fill={`url(#${id}base)`} />
      <rect x="14" y="10" width="972" height="980" rx="40" fill="none" stroke={`url(#${id}metal)`} strokeWidth="15" />
      <rect {...{x:(CANONICAL_CARD_LAYOUT.window.x-RIM.x)*1000,y:(CANONICAL_CARD_LAYOUT.window.y-RIM.y)*1000,width:(CANONICAL_CARD_LAYOUT.window.w+RIM.x*2)*1000,height:(CANONICAL_CARD_LAYOUT.window.h+RIM.y*2)*1000}} rx="10" fill={design.palette[0]} stroke={`url(#${id}metal)`} strokeWidth="9" />
      {Object.entries(PLATES).map(([key,box])=><rect key={key} x={box.x*1000} y={box.y*1000} width={box.w*1000} height={box.h*1000} rx="6" fill={`url(#${id}paper)`} stroke={`url(#${id}metal)`} strokeWidth="4" />)}
      {ready&&source?<g className="cdx-canonical-skin__atlas">
        <BorderSlice source={material} from={WHOLE} to={WHOLE} sourceInset={RAIL} targetInset={{x:.052,y:.0372}} />
        <BorderSlice source={material} from={WHOLE} to={grow(CANONICAL_CARD_LAYOUT.window,RIM.x,RIM.y)} sourceInset={RAIL} targetInset={RIM} />
        {Object.entries(PLATES).map(([key,box])=><BorderSlice key={key} source={material} from={grow(source.plates[key],.009,.0065)} to={grow(box,RIM.x,RIM.y)} sourceInset={{x:.009,y:.0065}} targetInset={RIM} />)}
      </g>:null}
      <g className="cdx-canonical-skin__engraving" fill="none" stroke={design.palette[1]} opacity=".42" strokeWidth="1.6"><path d="M68 842V943H932V842M90 855H417M583 855H912M90 866H417M583 866H912M88 953H912" /><path d={SEAL_RAYS} /></g>
      {quote.kind==="stock"?<g data-card-decoration="market-engraving" fill="none" stroke={`url(#${id}metal)`} strokeWidth="2" opacity=".8">
        <path d="M102 883 137 880 163 869 187 875 213 860 238 866 265 854 293 863 322 848 350 858 383 847 410 851M590 851 618 861 646 846 674 856 700 846 726 861 752 850 779 862 806 851 835 868 866 860 900 871" />
        {[142,199,258,317,376,623,682,741,800,859].map((x,i)=><g key={x}><path d={`M${x} ${i%2?873:860}v15`} /><rect x={x-3} y={i%2?876:864} width="6" height="7" fill={design.palette[1]} /></g>)}
      </g>:null}
      <g className="cdx-canonical-skin__seal" data-card-decoration="seal">
        <path d={sealHex(51)} fill={`url(#${id}metal)`} stroke={design.palette[2]} strokeWidth="1.5" />
        <path d={sealHex(44)} fill={design.palette[0]} stroke={design.palette[1]} strokeWidth="2" />
        <path d={sealHex(36)} fill={`url(#${id}metal)`} />
        <path d="m500 867 5 11 16 4-16 4-5 11-5-11-16-4 16-4Z" fill={design.palette[2]} stroke={design.palette[0]} strokeWidth="1.2" />
      </g>
      <rect x="22" y="16" width="956" height="968" rx="34" fill="none" stroke={design.palette[2]} opacity=".35" strokeWidth="1.5" />
    </svg>
  );
}
