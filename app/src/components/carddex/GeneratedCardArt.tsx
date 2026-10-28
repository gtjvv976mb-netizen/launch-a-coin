import { useEffect, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from "react";
import { generatedCardAssets } from "../../lib/carddex/generated-assets";
import measuredLayouts from "../../lib/carddex/generated-layouts.json";
import { useImageFailure } from "../mintdex/image-state";
import { CANONICAL_CARD_LAYOUT } from "../../lib/carddex/card-template";

export function useReadyImage(ref: RefObject<HTMLImageElement | null>, source: string | null) {
  const failure = useImageFailure(ref, source, source ?? "");
  const [readySource, setReadySource] = useState<string | null>(null);
  const [decodedSource, setDecodedSource] = useState<string | null>(null);
  useEffect(() => {
    const image = ref.current;
    if (source && image?.complete && image.naturalWidth > 0) { setReadySource(source); setDecodedSource(image.currentSrc || source); }
  }, [ref, source]);
  return {
    failed: failure.failed,
    ready: !!source && readySource === source && !failure.failed,
    decodedSource: source && readySource === source && !failure.failed ? decodedSource : null,
    onError: failure.onError,
    onLoad: () => { failure.onLoad(); if (source) { setReadySource(source); setDecodedSource(ref.current?.currentSrc || source); } },
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

export type GeneratedSkinSource = { art: Box; mask: {width:number;height:number;path:string}; plates: Record<string,Box> };

/** Coordinates below select pixels from immutable artwork. They never position live token content. */
export function generatedSkinSource(key?: string): GeneratedSkinSource | null {
  if (!key) return null;
  const measured = (measuredLayouts as Record<string,{art:Box;mask:{width:number;height:number;path:string};prints?:Record<string,Box>}>)[key];
  if (!measured) return null;
  const plates = { ...DEFAULT_PRINT_LAYOUT, ...PRINT_LAYOUTS[key], ...measured.prints };
  if (key === "duel-masters" || key === "one-piece") {
    plates.name = measured.prints?.type ?? PRINT_LAYOUTS[key].name;
    plates.type = plates.name;
  }
  // The original archive name bar has a large medallion through its center. Its own clean
  // companion bar supplies the same parchment/metal without covering the live token name.
  if (key === "obsidian-archive") plates.name = plates.type;
  if (key === "relic" && !measured.prints?.name) plates.name = measured.prints?.type ?? DEFAULT_PRINT_LAYOUT.name;
  return {art:measured.art,mask:measured.mask,plates};
}

function svgUrl(source:string) { return `url("data:image/svg+xml,${encodeURIComponent(source)}")`; }
const canonical = CANONICAL_CARD_LAYOUT;
const PRINT_BOXES = { art:canonical.window,name:canonical.name,type:canonical.type,text:canonical.text };
const CANONICAL_GEOMETRY: Record<string,string> = {};
for (const [name,box] of Object.entries(PRINT_BOXES)) for (const [key,value] of Object.entries(box)) CANONICAL_GEOMETRY[`--generated-${name}-${key}`] = `${value*100}%`;
CANONICAL_GEOMETRY["--generated-art-mask"] = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" rx="12" fill="white"/></svg>');
const holes = Object.values(PRINT_BOXES).map(box=>`<rect x="${box.x*1000}" y="${box.y*1000}" width="${box.w*1000}" height="${box.h*1000}" rx="5" fill="white"/>`).join("");
CANONICAL_GEOMETRY["--generated-foil-holes"] = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">${holes}</svg>`);
Object.freeze(CANONICAL_GEOMETRY);

/** Every skin gets the same geometry before decode, after decode and when its artwork fails. */
export function generatedCardStyle(cardTemplate?: string): CSSProperties {
  return { ...CANONICAL_GEOMETRY, "--generated-ink":cardTemplate === "neon-circuit" ? "#e2f4f0" : "#30251a" } as CSSProperties;
}
