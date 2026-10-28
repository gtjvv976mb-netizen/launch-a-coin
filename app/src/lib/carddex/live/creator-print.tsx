import type { CardData } from "../../../components/mintdex/MintCard";
import { CANONICAL_CARD_LAYOUT as layout } from "../card-template";
import { getPairAsset } from "../pairs";

export const CREATOR_CARD_RENDERER_VERSION = "launchacard-canonical-v1";
export const CREATOR_IMAGE_DIMENSIONS = Object.freeze({ card: {width:1260,height:1760}, case: {width:1440,height:2240} });
const W=1260,H=1760;
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export function imageDataUri(bytes:Uint8Array,mime:string) {return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;}
// Stable width budget, with clipping as a final guard. Metadata retains the complete unabridged values.
function widthOf(s:string,size:number,mono=false) {return Array.from(s).reduce((n,c)=>n+size*(mono?.6:/[ilI.,'!| ]/.test(c)?.27:/[MW@%]/.test(c)?.87:/[^\u0000-\u024f]/.test(c)?1:.53),0);}
function fit(s:string,width:number,size:number,mono=false) {s=s.replace(/\s+/g," ").trim();if(widthOf(s,size,mono)<=width)return s;const chars=Array.from(s);while(chars.length&&widthOf(chars.join("")+"…",size,mono)>width)chars.pop();return chars.join("")+"…";}
function lines(s:string,width:number,size:number) {let remaining=s.replace(/\s+/g," ").trim();const result:string[]=[];while(remaining&&result.length<2){if(widthOf(remaining,size)<=width){result.push(remaining);break;}if(result.length===1){result.push(fit(remaining,width,size));break;}let part="";for(const c of Array.from(remaining)){if(widthOf(part+c,size)>width)break;part+=c;}const boundary=part.lastIndexOf(" ");if(boundary>part.length*.55)part=part.slice(0,boundary);result.push(part);remaining=remaining.slice(part.length).trim();}return result;}
const box=(b:{x:number;y:number;w:number;h:number})=>({x:b.x*W,y:b.y*H,w:b.w*W,h:b.h*H});

/** The approved flattened SVG skin, shared content boxes, fonts and actual creator artwork. */
export function creatorCardSvg(card:CardData,tokenMint:string,creator:string,artUri:string,atlasUri:string) {
  const a=box(layout.window),n=box(layout.name),t=box(layout.type),d=box(layout.text),fa=box(layout.footer[0]),fb=box(layout.footer[1]);
  const ink=card.cardTemplate==="neon-circuit"?"#e2f4f0":"#30251a";
  const titleSize=80.64,typeSize=36.54,loreSize=49.77,rowSize=38.43,footerSize=28.98;
  const left=d.x+47.88,right=d.x+d.w-47.88;
  const firstRow=d.y+d.h-30.24-(3*44.1945+2*8.82);
  const description=lines(card.lore||"A fresh coin in the dex. Its story is still being written.",right-left,loreSize);
  const quote=getPairAsset(card.quoteAssetKey||"sol");
  const rows=[["Token address",`${tokenMint.slice(0,5)}...${tokenMint.slice(-4)}`],["Market cap","At creation"],["Holders","0"]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1760" viewBox="0 0 1260 1760">
    <defs><clipPath id="card-edge"><rect width="1260" height="1760" rx="63.504"/></clipPath><clipPath id="art-edge"><rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="12"/></clipPath><clipPath id="name-edge"><rect x="${n.x+47.88}" y="${n.y}" width="${n.w-185}" height="${n.h}"/></clipPath></defs>
    <g clip-path="url(#card-edge)"><image width="1260" height="1760" href="${xml(atlasUri)}"/>
    <image x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#art-edge)" href="${xml(artUri)}"/>
    <g fill="${ink}" font-family="Libre Caslon Text,serif">
      <text x="${n.x+47.88}" y="${n.y+n.h/2+titleSize*.34}" font-size="${titleSize}" clip-path="url(#name-edge)">${xml(fit(card.name,n.w-190,titleSize))}</text>
      <text x="${n.x+n.w-42.84}" y="${n.y+n.h/2+46.62*.34}" text-anchor="end" font-size="46.62" font-weight="700">1/1</text>
      <text x="${t.x+37.8}" y="${t.y+t.h/2+typeSize*.34}" font-family="Courier Prime,monospace" font-size="${typeSize}">$${xml(card.ticker)}</text>
      <text x="${t.x+t.w-37.8}" y="${t.y+t.h/2+typeSize*.34}" text-anchor="end" font-style="italic" font-size="${typeSize}">${xml(quote.symbol)} pair</text>
      ${description.map((line,i)=>`<text x="${left}" y="${d.y+32.76+loreSize*.8+i*loreSize*1.3}" font-style="italic" font-size="${loreSize}">${xml(line)}</text>`).join("")}
      <path d="M${left} ${firstRow-17.64}H${right}" stroke="${ink}" stroke-opacity=".28" stroke-width="3.15"/>
      ${rows.map(([label,value],i)=>{const y=firstRow+rowSize*.8+i*(44.1945+8.82),lx=left+widthOf(label,rowSize)+15,rx=right-widthOf(value,rowSize,true)-15;return `<text x="${left}" y="${y}" font-size="${rowSize}" font-weight="600">${label}</text><path d="M${lx} ${y-5}H${rx}" stroke="${ink}" stroke-opacity=".3" stroke-dasharray="3 7" stroke-width="2"/><text x="${right}" y="${y}" text-anchor="end" font-family="Courier Prime,monospace" font-size="${rowSize}">${xml(value)}</text>`;}).join("")}
      <text x="${fa.x+32.76}" y="${fa.y+fa.h/2+footerSize*.34}" font-family="Courier Prime,monospace" font-size="${footerSize}">${xml(fit(`Owner @${creator.slice(0,4)}…${creator.slice(-4)}`,fa.w-65,footerSize,true))}</text>
      <text x="${fb.x+fb.w-32.76}" y="${fb.y+fb.h/2+footerSize*.34}" text-anchor="end" font-family="Courier Prime,monospace" font-size="${footerSize}">1 / 1</text>
    </g></g></svg>`;
}

/** Fixed collectible case: the complete canonical card, polished rounded acrylic and an honest identity label. */
export function creatorCaseSvg(cardPng:Uint8Array,tokenMint:string) {
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="2240" viewBox="0 0 720 1120">
 <defs><linearGradient id="glass" x1="0" x2="1" y2="1"><stop stop-color="#e7e2d7" stop-opacity=".58"/><stop offset=".18" stop-color="#8a8780" stop-opacity=".17"/><stop offset=".5" stop-color="#131518" stop-opacity=".82"/><stop offset=".82" stop-color="#89867c" stop-opacity=".25"/><stop offset="1" stop-color="#e4dbc4" stop-opacity=".6"/></linearGradient><linearGradient id="edge" x1="0" x2="1" y2="1"><stop stop-color="#faf5e9"/><stop offset=".2" stop-color="#b4a68d"/><stop offset=".4" stop-color="#55554f"/><stop offset=".58" stop-color="#fff8e6"/><stop offset=".78" stop-color="#7c7464"/><stop offset="1" stop-color="#e6d6b4"/></linearGradient><linearGradient id="label" x1="0" x2="1" y2=".3"><stop stop-color="#fffdf5"/><stop offset=".65" stop-color="#e7dfcc"/><stop offset="1" stop-color="#f2e1c0"/></linearGradient><linearGradient id="shine" x1="0" x2="1" y2=".3"><stop stop-color="white" stop-opacity=".3"/><stop offset=".2" stop-color="white" stop-opacity="0"/><stop offset=".87" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white" stop-opacity=".17"/></linearGradient></defs>
 <rect x="16" y="16" width="688" height="1088" rx="44" fill="#171717" fill-opacity=".94" stroke="url(#edge)" stroke-width="3"/>
 <rect x="21" y="21" width="678" height="1078" rx="40" fill="url(#glass)" stroke="#f5eedc" stroke-opacity=".52"/>
 <rect x="30" y="30" width="660" height="1060" rx="33" fill="none" stroke="#060606" stroke-opacity=".62" stroke-width="3"/>
 <rect x="42" y="38" width="636" height="88" rx="16" fill="url(#label)" stroke="#fff7e4"/>
 <text x="58" y="74" font-family="Libre Caslon Text,serif" font-weight="700" font-size="26" fill="#29231d">Launch a Card</text><text x="662" y="75" text-anchor="end" font-family="Libre Caslon Text,serif" font-weight="700" font-size="30" fill="#29231d">1/1</text>
 <text x="58" y="105" font-family="Courier Prime,monospace" font-size="15" fill="#61584a">${tokenMint.slice(0,7)}…${tokenMint.slice(-7)}</text><text x="662" y="105" text-anchor="end" font-family="Courier Prime,monospace" font-size="14" fill="#61584a">One of one</text>
 <path d="M42 144H678" stroke="url(#edge)" stroke-opacity=".65"/>
 <rect x="40" y="164" width="640" height="891" rx="35" fill="#08090a" stroke="url(#edge)" stroke-width="2"/>
 <image x="45" y="170" width="630" height="880" href="${imageDataUri(cardPng,"image/png")}"/>
 <rect x="21" y="21" width="678" height="1078" rx="40" fill="url(#shine)"/>
 <path d="M29 1081V57Q29 29 57 29H662" fill="none" stroke="white" stroke-opacity=".36" stroke-width="2"/>
 <path d="M691 59V1063Q691 1091 663 1091H58" fill="none" stroke="#faefd7" stroke-opacity=".24"/>
 </svg>`;
}
