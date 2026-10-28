import { useEffect, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from "react";
import { generatedCardAssets } from "../../lib/carddex/generated-assets";
import measuredLayouts from "../../lib/carddex/generated-layouts.json";
import { useImageFailure } from "../mintdex/image-state";

function useReadyImage(ref: RefObject<HTMLImageElement | null>, source: string | null) {
  const failure = useImageFailure(ref, source, source ?? "");
  const [readySource, setReadySource] = useState<string | null>(null);
  useEffect(() => {
    const image = ref.current;
    if (source && image?.complete && image.naturalWidth > 0) setReadySource(source);
  }, [ref, source]);
  return {
    failed: failure.failed,
    ready: !!source && readySource === source && !failure.failed,
    onError: failure.onError,
    onLoad: () => { failure.onLoad(); if (source) setReadySource(source); },
  };
}

/** Generated decoration is one clipped plane under the creator's opaque art and readable identity. */
export function GeneratedCardFront({ cardTemplate, priority = false }: { cardTemplate?: string; priority?: boolean }) {
  const assets = generatedCardAssets(cardTemplate);
  const source = assets.front ?? null;
  const ref = useRef<HTMLImageElement>(null);
  const image = useReadyImage(ref, source);
  if (!source) return null;
  return <img ref={ref} className="cdx-generated-front" data-generated-front-ready={image.ready ? "" : undefined} src={source} srcSet={assets.front320 ? `${assets.front320} 320w, ${source} 1260w` : undefined} sizes={assets.front320 ? "auto, (max-width: 767px) 72vw, 400px" : undefined} alt="" hidden={image.failed} draggable={false} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : undefined} onLoad={image.onLoad} onError={image.onError} />;
}

/** A measured metal-only laminate. It shares the physical engine's light without painting over live ink. */
export function GeneratedCardFinish({ cardTemplate }: { cardTemplate?: string }) {
  if (!generatedCardAssets(cardTemplate).front) return null;
  return <div className="cdx-generated-finish" aria-hidden><i className="cdx-generated-finish__spectrum" /><i className="cdx-generated-finish__glint" /></div>;
}

/** A verified wordless reverse replaces the native engraving after decode; errors retain the native back. */
export function GeneratedCardReverse({ cardTemplate, children }: { cardTemplate?: string; children: ReactNode }) {
  const assets = generatedCardAssets(cardTemplate);
  const source = assets.back ?? null;
  const ref = useRef<HTMLImageElement>(null);
  const image = useReadyImage(ref, source);
  if (!source) return <>{children}</>;
  return <div className="cdx-generated-reverse" data-generated-back-ready={image.ready ? "" : undefined}>
    {!image.ready ? children : null}
    <img ref={ref} src={source} srcSet={assets.back320 ? `${assets.back320} 320w, ${source} 1260w` : undefined} sizes={assets.back320 ? "auto, (max-width: 767px) 72vw, 400px" : undefined} alt="" hidden={image.failed} draggable={false} loading="eager" decoding="async" onLoad={image.onLoad} onError={image.onError} />
  </div>;
}

type Box = { x: number; y: number; w: number; h: number };
const DEFAULT_PRINT_LAYOUT: Record<string, Box> = {
  name: { x: .11, y: .045, w: .78, h: .05 },
  type: { x: .11, y: .55, w: .78, h: .04 },
  text: { x: .09, y: .62, w: .82, h: .25 },
  "foot-a": { x: .11, y: .91, w: .33, h: .03 },
  "foot-b": { x: .56, y: .91, w: .33, h: .03 },
  footer: { x: .11, y: .91, w: .78, h: .03 },
};
const PRINT_LAYOUTS: Record<string, Record<string, Box>> = {
  "pokemon-classic": { name: {x:.08,y:.043,w:.78,h:.048}, type:{x:.085,y:.504,w:.83,h:.035}, text:{x:.085,y:.574,w:.83,h:.295}, footer:{x:.085,y:.914,w:.83,h:.025} },
  "pokemon-full-art": { name:{x:.09,y:.028,w:.77,h:.043}, type:{x:.085,y:.645,w:.83,h:.035}, text:{x:.085,y:.731,w:.83,h:.147}, footer:{x:.09,y:.934,w:.82,h:.025} },
  "yugioh-monster": { name:{x:.12,y:.044,w:.76,h:.05}, type:{x:.12,y:.617,w:.76,h:.035}, text:{x:.12,y:.693,w:.76,h:.188}, footer:{x:.12,y:.923,w:.76,h:.025} },
  "yugioh-spell": { name:{x:.115,y:.041,w:.77,h:.05}, type:{x:.12,y:.649,w:.76,h:.043}, text:{x:.12,y:.738,w:.76,h:.166}, footer:{x:.12,y:.935,w:.76,h:.025} },
  "magic-etched": { name:{x:.11,y:.054,w:.78,h:.045}, type:{x:.11,y:.527,w:.78,h:.04}, text:{x:.11,y:.61,w:.78,h:.267}, footer:{x:.11,y:.923,w:.78,h:.025} },
  "duel-masters": { name:{x:.12,y:.535,w:.76,h:.05}, type:{x:.12,y:.601,w:.76,h:.03}, text:{x:.12,y:.666,w:.76,h:.221}, footer:{x:.12,y:.929,w:.76,h:.025} },
  "one-piece": { name:{x:.10,y:.651,w:.8,h:.041}, type:{x:.10,y:.718,w:.8,h:.026}, text:{x:.105,y:.785,w:.79,h:.107}, footer:{x:.10,y:.939,w:.8,h:.022} },
  "obsidian-archive": { name:{x:.13,y:.051,w:.74,h:.045}, type:{x:.13,y:.584,w:.74,h:.043}, text:{x:.13,y:.678,w:.74,h:.19}, footer:{x:.13,y:.932,w:.74,h:.022} },
  "neon-circuit": { name:{x:.12,y:.045,w:.76,h:.045}, type:{x:.12,y:.529,w:.76,h:.04}, text:{x:.11,y:.615,w:.78,h:.255}, "foot-a":{x:.13,y:.907,w:.30,h:.028}, "foot-b":{x:.57,y:.907,w:.30,h:.028}, footer:{x:.13,y:.907,w:.74,h:.028} },
};

/** UI masks are measured from the untouched neutral aperture, including curved edges and interior plaques. */
export function generatedCardStyle(cardTemplate?: string): CSSProperties {
  if (!cardTemplate || !generatedCardAssets(cardTemplate).front) return {};
  const measured = (measuredLayouts as Record<string,{art:Box;mask:{width:number;height:number;path:string};prints?:Record<string,Box>}>)[cardTemplate];
  if (!measured) return {};
  const vars: Record<string,string> = {};
  vars["--generated-ink"] = cardTemplate === "neon-circuit" ? "#e2f4f0" : "#30251a";
  const box = (name:string, value:Box) => { for (const [key,number] of Object.entries(value)) vars[`--generated-${name}-${key}`] = `${number*100}%`; };
  box("art", measured.art);
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${measured.mask.width} ${measured.mask.height}"><path fill="white" d="${measured.mask.path}"/></svg>`;
  vars["--generated-art-mask"] = `url("data:image/svg+xml,${encodeURIComponent(mask)}")`;
  const print = { ...DEFAULT_PRINT_LAYOUT, ...measured.prints, ...PRINT_LAYOUTS[cardTemplate] };
  // The authoring model can move its lower wells. Keep the live print inside the actual paper.
  if (measured.prints?.text) {
    const paper = measured.prints.text;
    print.text = { x: paper.x + .008, y: paper.y + .005, w: paper.w - .016, h: paper.h - .01 };
  }
  if (measured.prints?.footer) print.footer = measured.prints.footer;
  vars["--generated-stock-lore-size"] = print.text.h < .23 ? "3.2cqw" : "3.7cqw";
  vars["--generated-stock-data-size"] = print.text.h < .23 ? "2.9cqw" : "3.2cqw";
  const paperHoles = Object.values(print).map(paper => `<rect x="${paper.x*1000}" y="${paper.y*1000}" width="${paper.w*1000}" height="${paper.h*1000}" rx="5" fill="white"/>`).join("");
  const artHole = `<g transform="translate(${measured.art.x*1000} ${measured.art.y*1000}) scale(${measured.art.w*1000/measured.mask.width} ${measured.art.h*1000/measured.mask.height})"><path fill="white" d="${measured.mask.path}"/></g>`;
  const finishMask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">${artHole}${paperHoles}</svg>`;
  vars["--generated-foil-holes"] = `url("data:image/svg+xml,${encodeURIComponent(finishMask)}")`;
  for (const [name,value] of Object.entries(print)) box(name,value);
  return vars as CSSProperties;
}
