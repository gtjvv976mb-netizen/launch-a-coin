import { beforeAll, describe, expect, test } from "bun:test";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { creatorCardSvg, creatorCaseSvg, imageDataUri, CREATOR_CARD_RENDERER_VERSION, CREATOR_IMAGE_DIMENSIONS } from "../../src/lib/carddex/live/creator-print";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import renderVariants from "../../src/lib/carddex/render-variants.json";
import { canonicalSkinSrcSet } from "../../src/components/carddex/CanonicalCardSkin";
import reviewedDesigns from "../../../integrations/pumpfun/src/design-assets.json";
import { CANONICAL_CARD_LAYOUT, CARD_RENDERER_VERSION } from "../../src/lib/carddex/card-template";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { allowedQuotesForDesign, defaultQuoteForDesign } from "../../src/lib/carddex/pairs";
import type { CardData } from "../../src/components/mintdex/MintCard";

const wallet="11111111111111111111111111111111";
const mint="So11111111111111111111111111111111111111112";
const card=(key:string):CardData=>({name:"Silver & Scarlet <Test>",ticker:"TEST",image:"",lore:"A creator’s actual story, printed in the permanent shared template.",cardTemplate:key,quoteAssetKey:defaultQuoteForDesign(key).key,mcapUsd:null,holders:0,dexNo:0,level:1});
const data=imageDataUri(new Uint8Array([1,2,3]),"image/png");
describe("trusted creator card composition",()=>{
 test("all 48 reviewed source images and 83 admitted finish variants have pinned flattened skins",async()=>{
  expect(new Set(Object.values(renderAssets).map(asset=>asset.designKey)).size).toBe(48);
  expect(Object.keys(renderAssets)).toHaveLength(83);
  const expectedKeys=CARD_DESIGNS.flatMap(design=>[...new Set(allowedQuotesForDesign(design.key).map(quote=>quote.kind==="stock"?"stock":"plain"))].map(kind=>design.key+(kind==="stock"?"--stock":""))).sort();
  expect(Object.keys(renderAssets).sort()).toEqual(expectedKeys);
  expect(CREATOR_CARD_RENDERER_VERSION).toBe(CARD_RENDERER_VERSION);
  for(const [key,asset]of Object.entries(renderAssets)){
   const bytes=await readFile(`public${asset.path}`);
   expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
   expect(createHash("sha256").update(await readFile(`public/assets/carddex/higgsfield/${asset.designKey}-front.webp`)).digest("hex")).toBe(asset.sourceSha256);
   expect(asset.sourceSha256).toBe(reviewedDesigns[asset.designKey as keyof typeof reviewedDesigns].front.sha256);
   expect(asset.rendererVersion).toBe(CARD_RENDERER_VERSION);
   expect(asset.width).toBe(CREATOR_IMAGE_DIMENSIONS.card.width);expect(asset.height).toBe(CREATOR_IMAGE_DIMENSIONS.card.height);
   expect(Array.from(bytes.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);
   const dimensions=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   expect(dimensions.getUint32(16)).toBe(asset.width);expect(dimensions.getUint32(20)).toBe(asset.height);
   expect(asset.previewPath).toBe(`/assets/carddex/render/preview/${key}.png`);
   const preview=await readFile(`public${asset.previewPath}`);
   expect(createHash("sha256").update(preview).digest("hex")).toBe(asset.previewSha256);
   expect(Array.from(preview.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);
   const previewDimensions=new DataView(preview.buffer,preview.byteOffset,preview.byteLength);
   expect(previewDimensions.getUint32(16)).toBe(320);expect(previewDimensions.getUint32(20)).toBe(447);
   expect(preview[25]).toBe(6); // RGBA retains the rounded transparent edge.
   const quote=allowedQuotesForDesign(asset.designKey).find(quote=>(quote.kind==="stock"?"stock":"plain")===asset.kind)!;
   expect(key).toBe(asset.designKey+(asset.kind==="stock"?"--stock":""));
   const svg=creatorCardSvg({...card(asset.designKey),quoteAssetKey:quote.key},mint,wallet,data,data);
   expect(svg).toContain('width="1260" height="1760"');
   expect(svg).toContain(`x="${CANONICAL_CARD_LAYOUT.window.x*1260}" y="${CANONICAL_CARD_LAYOUT.window.y*1760}"`);
   expect(svg).toContain("Silver &amp; Scarlet &lt;");
   expect(svg).not.toContain("<Test>");
   expect(svg).toContain("At creation");
   expect(svg).toContain(`${quote.symbol} pair`);
  }
 });
 test("every flattened skin has fresh 480 and 640 px WebP copies in its srcset",async()=>{
  expect(Object.keys(renderVariants).sort()).toEqual(Object.keys(renderAssets).sort());
  for(const [key,asset]of Object.entries(renderAssets)){
   const variant=renderVariants[key as keyof typeof renderVariants];
   // Made from the current atlas: a re-rendered skin needs new copies (bun scripts/card-skin-variants.ts).
   expect(variant.atlasSha256).toBe(asset.sha256);
   for(const [width,copy]of [[480,variant.w480],[640,variant.w640]] as const){
    expect(copy.path).toBe(`/assets/carddex/render/preview/${key}-${width}.webp`);
    const bytes=await readFile(`public${copy.path}`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(copy.sha256);
    expect(new TextDecoder().decode(bytes.subarray(0,4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8,16))).toBe("WEBPVP8X");
    expect(bytes[20]&0x10).toBe(0x10); // alpha keeps the rounded transparent edge
    const canvasWidth=1+(bytes[24]|bytes[25]<<8|bytes[26]<<16),canvasHeight=1+(bytes[27]|bytes[28]<<8|bytes[29]<<16);
    expect([canvasWidth,canvasHeight]).toEqual([width,Math.round(width*asset.height/asset.width)]);
    expect([copy.width,copy.height]).toEqual([canvasWidth,canvasHeight]);
   }
   expect(canonicalSkinSrcSet(asset)).toBe(`${variant.w480.path} 480w, ${variant.w640.path} 640w, ${asset.path} 1260w`);
   // Phones stop at the 640 px copy: the 1260 px atlas PNG is never one of their candidates.
   expect(canonicalSkinSrcSet(asset,true)).toBe(`${variant.w480.path} 480w, ${variant.w640.path} 640w`);
  }
 });
 test("all 48 exported fronts omit bottom identity and serial labels while retaining one top edition",()=>{
  expect(CANONICAL_CARD_LAYOUT.footer).toEqual([]);
  for(const design of CARD_DESIGNS){
   const svg=creatorCardSvg({...card(design.key),ownerHandle:"Removed Owner",dexNo:987654,dexLabel:"Coin #987654"},mint,wallet,data,data);
   expect(svg).not.toMatch(/Owner|Removed Owner|Coin #987654|Launch a Card|1 \/ 1/);
   expect(svg.match(/>1\/1<\/text>/g)).toHaveLength(1);
   const textY=[...svg.matchAll(/<text\b[^>]*\by="([\d.]+)"/g)].map(match=>Number(match[1]));
   expect(Math.max(...textY)).toBeLessThan((CANONICAL_CARD_LAYOUT.text.y+CANONICAL_CARD_LAYOUT.text.h)*1760);
  }
  const caseSvg=creatorCaseSvg(new Uint8Array([1,2,3]),mint);
  expect(caseSvg).toContain(">Launch a Card</text>");
  expect(caseSvg).toContain(">One of one</text>");
 });
 test("every exported design keeps data labels in the browser's monospace family with room for dotted rules",()=>{
  for(const design of CARD_DESIGNS){
   const svg=creatorCardSvg(card(design.key),mint,wallet,data,data);
   const labels=[...svg.matchAll(/<text\b([^>]*)>(Token address|Market cap|Holders)<\/text>/g)];
   expect(labels).toHaveLength(3);
   for(const [,attributes]of labels){
    expect(attributes).toContain('font-family="Courier Prime,monospace"');
    expect(attributes).toContain('font-weight="600"');
   }
   const rules=[...svg.matchAll(/<path d="M([\d.]+) [\d.]+H([\d.]+)"[^>]*stroke-dasharray="3 7"/g)];
   expect(rules).toHaveLength(3);
   for(const [,start,end]of rules)expect(Number(end)-Number(start)).toBeGreaterThan(0);
  }
 });
 test("long and non-Latin creator data cannot inject markup or move the shared geometry",()=>{
  const svg=creatorCardSvg({...card("doge"),name:"🔥市場".repeat(20),lore:'<script>alert("unsafe")</script>'.repeat(15)},mint,wallet,data,data);
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain('clip-path="url(#name-edge)"');
  expect(svg).toContain('rx="63.504"');
 });
});
describe("real PNG output",()=>{
 let fonts:Uint8Array[];
 beforeAll(async()=>{
  await initWasm(await readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
  fonts=await Promise.all(["libre-caslon-text-400.woff2","libre-caslon-text-700.woff2","libre-caslon-text-400i.woff2","courier-prime-400.woff2","courier-prime-700.woff2"].map(p=>readFile(`public/fonts/${p}`)));
 });
 for(const key of ["pokemon-classic","stock-tsla","doge","neon-circuit"])test(`${key} exports the entire rounded card and marketplace case`,async()=>{
  const assetKey=key==="stock-tsla"?"stock-tsla--stock":key;
  const atlas=await readFile(`public${renderAssets[assetKey as keyof typeof renderAssets].path}`);
  const uri=imageDataUri(atlas,"image/png");
  const renderer=new Resvg(creatorCardSvg(card(key),mint,wallet,uri,uri),{font:{fontBuffers:fonts}});
  let png:Uint8Array;
  try{const image=renderer.render();try{
   expect(image.width).toBe(1260);expect(image.height).toBe(1760);
   expect(image.pixels[3]).toBe(0);
   expect(image.pixels[(880*1260+630)*4+3]).toBe(255);
   png=image.asPng().slice();expect(png.byteLength).toBeGreaterThan(100_000);
  }finally{image.free();}}finally{renderer.free();}
  const caseRenderer=new Resvg(creatorCaseSvg(png!,mint),{font:{fontBuffers:fonts}});
  try{const image=caseRenderer.render();try{expect(image.width).toBe(1440);expect(image.height).toBe(2240);expect(image.pixels[3]).toBe(0);expect(image.asPng().byteLength).toBeGreaterThan(100_000);}finally{image.free();}}finally{caseRenderer.free();}
 },30_000);
});
