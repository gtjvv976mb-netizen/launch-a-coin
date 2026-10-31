import { beforeAll, describe, expect, test } from "bun:test";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { creatorCardSvg, creatorCaseSvg, creatorTokenImageSvg, imageDataUri, CREATOR_CARD_RENDERER_VERSION, CREATOR_IMAGE_DIMENSIONS, TOKEN_IMAGE_FORMAT, TOKEN_IMAGE_DIMENSIONS, TOKEN_IMAGE_LAYOUT } from "../../src/lib/carddex/live/creator-print";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import renderVariants from "../../src/lib/carddex/render-variants.json";
import { canonicalSkinSrcSet } from "../../src/components/carddex/CanonicalCardSkin";
import reviewedDesigns from "../../../integrations/pumpfun/src/design-assets.json";
import { CANONICAL_CARD_LAYOUT, CARD_RENDERER_VERSION } from "../../src/lib/carddex/card-template";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { allowedQuotesForDesign, defaultQuoteForDesign } from "../../src/lib/carddex/pairs";
import type { CardData } from "../../src/components/mintdex/MintCard";
import { execFileSync } from "node:child_process";
import { designVersionId } from "../../src/lib/carddex/design-versions";
import { creatorAtlas, creatorTokenBack } from "../../src/lib/carddex/live/compose-assets";

const wallet="11111111111111111111111111111111";
const mint="So11111111111111111111111111111111111111112";
const card=(key:string):CardData=>({name:"Silver & Scarlet <Test>",ticker:"TEST",image:"",lore:"A creator’s actual story, printed in the permanent shared template.",cardTemplate:key,quoteAssetKey:defaultQuoteForDesign(key).key,mcapUsd:null,holders:0,dexNo:0,level:1});
const data=imageDataUri(new Uint8Array([1,2,3]),"image/png");
describe("trusted creator card composition",()=>{
 test("every reviewed source and admitted finish has a pinned flattened skin",async()=>{
  // Held pair designs (pair-designs.ts) are design keys with their pinned skins: coins that carry one keep rendering.
  expect(new Set(Object.values(renderAssets).map(asset=>asset.designKey)).size).toBe(CARD_DESIGNS.length);
  const expectedKeys=[...CARD_DESIGNS.flatMap(design=>[...new Set(allowedQuotesForDesign(design.key).map(quote=>quote.kind==="stock"?"stock":"plain"))].map(kind=>design.key+(kind==="stock"?"--stock":"")))].sort();
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
 test("all token-image prints omit market cap and close the remaining data rows without changing NFT prints",()=>{
  const rowY=(svg:string,label:string)=>Number(svg.match(new RegExp(`<text\\b[^>]*\\by="([\\d.]+)"[^>]*>${label}<\\/text>`))?.[1]);
  for(const design of CARD_DESIGNS){
   const normal=creatorCardSvg(card(design.key),mint,wallet,data,data);
   const token=creatorCardSvg(card(design.key),mint,wallet,data,data,{tokenImage:true});
   expect(normal).toContain(">Market cap</text>");expect(normal).toContain(">At creation</text>");
   expect(token).not.toContain(">Market cap</text>");expect(token).not.toContain(">At creation</text>");
   expect(token).toContain(">Token address</text>");expect(token).toContain(">Holders</text>");
   expect(token).toContain(">1/1</text>");expect(token).toContain(">$TEST</text>");
   expect(token).toContain(`${defaultQuoteForDesign(design.key).symbol} pair`);
   expect(token.match(/stroke-dasharray="3 7"/g)).toHaveLength(2);
   expect(rowY(token,"Token address")).toBe(rowY(normal,"Market cap"));
   expect(rowY(token,"Holders")).toBe(rowY(normal,"Holders"));
   expect(creatorCardSvg(card(design.key),mint,wallet,data,data,{})).toBe(normal);
  }
 });
 test("the independent square format embeds the supplied full PNG without extra labels, clipping or a case",()=>{
  const png=new Uint8Array([137,80,78,71,13,10,26,10]);
  const svg=creatorTokenImageSvg(png);
  expect(TOKEN_IMAGE_DIMENSIONS).toEqual({width:1024,height:1024});
  expect(TOKEN_IMAGE_LAYOUT.cardWidth/TOKEN_IMAGE_LAYOUT.cardHeight).toBeCloseTo(63/88,12);
  expect(TOKEN_IMAGE_LAYOUT.cardHeight).toBe(.76);
  expect(TOKEN_IMAGE_LAYOUT.cardX+TOKEN_IMAGE_LAYOUT.cardWidth/2).toBe(.5);
  expect(TOKEN_IMAGE_LAYOUT.cardY+TOKEN_IMAGE_LAYOUT.cardHeight/2).toBe(.5);
  const cornerRadius=Math.hypot(TOKEN_IMAGE_LAYOUT.cardWidth/2,TOKEN_IMAGE_LAYOUT.cardHeight/2);
  expect(cornerRadius).toBeLessThan(.47);
  expect(svg).toContain(`data-token-image-format="${TOKEN_IMAGE_FORMAT}"`);
  expect(svg).toContain('width="1024" height="1024"');
  expect(svg).toContain(`fill="${TOKEN_IMAGE_LAYOUT.background}"`);
  expect(svg).toContain(`href="${imageDataUri(png,"image/png")}"`);
  expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  expect(svg.match(/<image\b/g)).toHaveLength(1);
  expect(svg).not.toMatch(/<text\b|clip-path|transform=|<filter\b/);
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
 // Testcard (launch a965ba32, card NFT minted) recorded pair-cards' art before the 31 October redesign (dc57e17) replaced
 // it: its pinned version composes on the archived atlas and token back, the same bytes as at dc57e17^ (387fb951).
 test("a launch's pinned earlier version composes exactly as before the redesign, on its archived files",async()=>{
  const before="387fb951e0fe498ea94b77f502e786da3ca0989d";
  const testcard:CardData={...card("pair-cards"),designVersion:designVersionId("0fab1e5bae070412f65fcf0ddc5c935fdf4e1c06db0f23b1e40cd23b09b5190d","b901b5f8852cb0936ae7a7d81438a8cd30817b142e3ba727adb0db8761aeae63")};
  const atlasPath=creatorAtlas(testcard)!.path,backPath=creatorTokenBack(testcard)!.path;
  expect(atlasPath).toStartWith("/assets/carddex/archive/pair-cards/");expect(backPath).toStartWith("/assets/carddex/archive/pair-cards/");
  const atlas=await readFile(`public${atlasPath}`);
  expect(createHash("sha256").update(atlas).digest("hex")).toBe("36cae41d86530adacce13ba8aa0174a5ee0815d50abec7cc7b4d78c1e8a3b841");
  expect(createHash("sha256").update(await readFile(`public${backPath}`)).digest("hex")).toBe("264f2dadd94eaf407d6313f9a9fae6b7936c2f01bc6212cb6a6e7cd817a2da1a");
  const compose=(bytes:Uint8Array)=>{const uri=imageDataUri(bytes,"image/png");const renderer=new Resvg(creatorCardSvg(testcard,mint,wallet,data,uri),{font:{fontBuffers:fonts}});
   try{const image=renderer.render();try{return createHash("sha256").update(image.asPng()).digest("hex");}finally{image.free();}}finally{renderer.free();}};
  const archived=compose(atlas);
  let original:Uint8Array|null=null;
  try{original=execFileSync("git",["show",`${before}:app/public/assets/carddex/render/pair-cards.png`],{maxBuffer:64<<20,stdio:["ignore","pipe","ignore"]});}catch{/* a shallow checkout: the hash above pins the same bytes */}
  if(original)expect(compose(original)).toBe(archived);
  // The current art composes differently: the version is what keeps the minted card's art.
  expect(compose(await readFile(`public${creatorAtlas(card("pair-cards"))!.path}`))).not.toBe(archived);
 },30_000);
 for(const key of ["pokemon-classic","stock-tsla","doge","neon-circuit"])test(`${key} token image is opaque, square and fully safe inside a circular avatar`,async()=>{
  const assetKey=key==="stock-tsla"?"stock-tsla--stock":key;
  const atlas=await readFile(`public${renderAssets[assetKey as keyof typeof renderAssets].path}`);
  const uri=imageDataUri(atlas,"image/png");
  const cardRenderer=new Resvg(creatorCardSvg(card(key),mint,wallet,uri,uri,{tokenImage:true}),{font:{fontBuffers:fonts}});
  let cardPng:Uint8Array;
  try{const image=cardRenderer.render();try{cardPng=image.asPng().slice();}finally{image.free();}}finally{cardRenderer.free();}
  const squareRenderer=new Resvg(creatorTokenImageSvg(cardPng!),{font:{fontBuffers:fonts}});
  try{const image=squareRenderer.render();try{
   expect(image.width).toBe(1024);expect(image.height).toBe(1024);
   expect(image.asPng().byteLength).toBeGreaterThan(50_000);
   const pixels=image.pixels,bg=[245,239,226];
   let minX=1024,minY=1024,maxX=-1,maxY=-1,minAlpha=255,maxRadius=0,foreground=0;
   for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){
    const i=(y*1024+x)*4;minAlpha=Math.min(minAlpha,pixels[i+3]);
    if(pixels[i]===bg[0]&&pixels[i+1]===bg[1]&&pixels[i+2]===bg[2])continue;
    foreground++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
    maxRadius=Math.max(maxRadius,Math.hypot(x+.5-512,y+.5-512));
   }
   expect(minAlpha).toBe(255);expect(foreground).toBeGreaterThan(300_000);
   expect(minX).toBeGreaterThanOrEqual(Math.floor(TOKEN_IMAGE_LAYOUT.cardX*1024)-1);
   expect(minY).toBeGreaterThanOrEqual(Math.floor(TOKEN_IMAGE_LAYOUT.cardY*1024)-1);
   expect(maxX).toBeLessThanOrEqual(Math.ceil((TOKEN_IMAGE_LAYOUT.cardX+TOKEN_IMAGE_LAYOUT.cardWidth)*1024));
   expect(maxY).toBeLessThanOrEqual(Math.ceil((TOKEN_IMAGE_LAYOUT.cardY+TOKEN_IMAGE_LAYOUT.cardHeight)*1024));
   expect(maxX-minX).toBeGreaterThan(550);expect(maxY-minY).toBeGreaterThan(770);
   expect(maxRadius).toBeLessThan(482); // At least30px clearance from a512px-radius crop.
   for(const [x,y]of [[0,0],[1023,0],[0,1023],[1023,1023]]){
    const i=(y*1024+x)*4;expect(Array.from(pixels.subarray(i,i+4))).toEqual([...bg,255]);
   }
  }finally{image.free();}}finally{squareRenderer.free();}
 },30_000);
});
