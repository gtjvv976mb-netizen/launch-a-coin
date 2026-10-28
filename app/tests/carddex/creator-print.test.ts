import { beforeAll, describe, expect, test } from "bun:test";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { creatorCardSvg, creatorCaseSvg, imageDataUri } from "../../src/lib/carddex/live/creator-print";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import { CANONICAL_CARD_LAYOUT } from "../../src/lib/carddex/card-template";
import { defaultQuoteForDesign } from "../../src/lib/carddex/pairs";
import type { CardData } from "../../src/components/mintdex/MintCard";

const wallet="11111111111111111111111111111111";
const mint="So11111111111111111111111111111111111111112";
const card=(key:string):CardData=>({name:"Silver & Scarlet <Test>",ticker:"TEST",lore:"A creator’s actual story, printed in the permanent shared template.",cardTemplate:key,quoteAssetKey:defaultQuoteForDesign(key).key,mcapUsd:null,holders:0,dexNo:0,level:1});
const data=imageDataUri(new Uint8Array([1,2,3]),"image/png");
describe("trusted creator card composition",()=>{
 test("all 48 reviewed source images and 83 admitted finish variants have pinned flattened skins",async()=>{
  expect(new Set(Object.values(renderAssets).map(asset=>asset.designKey)).size).toBe(48);
  expect(Object.keys(renderAssets)).toHaveLength(83);
  for(const [key,asset]of Object.entries(renderAssets)){
   const bytes=await readFile(`public${asset.path}`);
   expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
   expect(createHash("sha256").update(await readFile(`public/assets/carddex/higgsfield/${asset.designKey}-front.webp`)).digest("hex")).toBe(asset.sourceSha256);
   expect(asset.width).toBeGreaterThanOrEqual(1260);expect(asset.height).toBeGreaterThanOrEqual(1760);
   const svg=creatorCardSvg(card(asset.designKey),mint,wallet,data,data);
   expect(svg).toContain('width="1260" height="1760"');
   expect(svg).toContain(`x="${CANONICAL_CARD_LAYOUT.window.x*1260}" y="${CANONICAL_CARD_LAYOUT.window.y*1760}"`);
   expect(svg).toContain("Silver &amp; Scarlet &lt;");
   expect(svg).not.toContain("<Test>");
   expect(svg).toContain("At creation");
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
 for(const key of ["pokemon-classic","stock-tsla","doge"])test(`${key} exports the entire rounded card and marketplace case`,async()=>{
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
