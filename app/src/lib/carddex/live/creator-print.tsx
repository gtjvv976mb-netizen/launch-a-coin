import type { CardData } from "../../../components/mintdex/MintCard";
import { CANONICAL_CARD_LAYOUT as layout, CANONICAL_CARD_PRINT as print, CANONICAL_CARD_TEMPLATE, CARD_RENDERER_VERSION } from "../card-template";
import { getPairAsset } from "../pairs";

export const CREATOR_CARD_RENDERER_VERSION = CARD_RENDERER_VERSION;
export const CREATOR_IMAGE_DIMENSIONS = Object.freeze({ card: {width:1260,height:1760}, case: {width:1440,height:2240} });
/** Independent avatar format; the collectible print and its renderer version stay unchanged. */
export const TOKEN_IMAGE_FORMAT = "launchacard-token-square-v1";
export const TOKEN_IMAGE_DIMENSIONS = Object.freeze({width:1024,height:1024});
export const TOKEN_IMAGE_LAYOUT = Object.freeze({
  background:"#f5efe2", cardHeight:.76, cardWidth:.76*(63/88),
  cardX:(1-.76*(63/88))/2, cardY:(1-.76)/2,
});
const W=1260,H=1760;
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
export function imageDataUri(bytes:Uint8Array,mime:string) {return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;}
// Stable width budget, with clipping as a final guard. Metadata retains the complete unabridged values.
function widthOf(s:string,size:number,mono=false) {return Array.from(s).reduce((n,c)=>n+size*(mono?.6:/[ilI.,'!| ]/.test(c)?.27:/[MW@%]/.test(c)?.87:/[^\u0000-\u024f]/.test(c)?1:.53),0);}
function fit(s:string,width:number,size:number,mono=false) {s=s.replace(/\s+/g," ").trim();if(widthOf(s,size,mono)<=width)return s;const chars=Array.from(s);while(chars.length&&widthOf(chars.join("")+"…",size,mono)>width)chars.pop();return chars.join("")+"…";}
function lines(s:string,width:number,size:number) {let remaining=s.replace(/\s+/g," ").trim();const result:string[]=[];while(remaining&&result.length<2){if(widthOf(remaining,size)<=width){result.push(remaining);break;}if(result.length===1){result.push(fit(remaining,width,size));break;}let part="";for(const c of Array.from(remaining)){if(widthOf(part+c,size)>width)break;part+=c;}const boundary=part.lastIndexOf(" ");if(boundary>part.length*.55)part=part.slice(0,boundary);result.push(part);remaining=remaining.slice(part.length).trim();}return result;}
const box=(b:{x:number;y:number;w:number;h:number})=>({x:b.x*W,y:b.y*H,w:b.w*W,h:b.h*H});

/** The approved flattened SVG skin, shared content boxes, fonts and actual creator artwork. */
export function creatorCardSvg(card:CardData,tokenMint:string,_creator:string,artUri:string,atlasUri:string,options:{tokenImage?:boolean}={}) {
  const a=box(layout.window),n=box(layout.name),t=box(layout.type),d=box(layout.text),unit=W/100;
  const ink=card.cardTemplate==="neon-circuit"?"#e2f4f0":"#30251a";
  const titleSize=print.title*unit,numeralSize=print.numeral*unit,typeSize=print.type*unit,loreSize=print.lore*unit,rowSize=print.row*unit;
  const nameInset=print.nameInset*unit,typeInset=print.typeInset*unit;
  const nameWidth=n.w-2*nameInset-widthOf("1/1",numeralSize)-2*unit;
  const left=d.x+print.detailsInset*unit,right=d.x+d.w-print.detailsInset*unit;
  const rowHeight=rowSize*print.rowLine,rowGap=print.rowGap*unit;
  const rows=options.tokenImage
    ? [["Token address",`${tokenMint.slice(0,5)}...${tokenMint.slice(-4)}`],["Holders","0"]]
    : [["Token address",`${tokenMint.slice(0,5)}...${tokenMint.slice(-4)}`],["Market cap","At creation"],["Holders","0"]];
  const firstRow=d.y+d.h-print.detailsBottom*unit-(rows.length*rowHeight+(rows.length-1)*rowGap);
  const description=lines(card.lore||"A fresh coin in the dex. Its story is still being written.",right-left,loreSize);
  const quote=getPairAsset(card.quoteAssetKey||"sol");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1760" viewBox="0 0 1260 1760" data-card-layout="${CANONICAL_CARD_TEMPLATE}">
    <defs><clipPath id="card-edge"><rect width="1260" height="1760" rx="${layout.radius*W}"/></clipPath><clipPath id="art-edge"><rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${print.artRadius*unit}"/></clipPath><clipPath id="name-edge"><rect x="${n.x+nameInset}" y="${n.y}" width="${nameWidth}" height="${n.h}"/></clipPath></defs>
    <g clip-path="url(#card-edge)"><image width="1260" height="1760" href="${xml(atlasUri)}"/>
    <image x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#art-edge)" href="${xml(artUri)}"/>
    <g fill="${ink}" font-family="Libre Caslon Text,serif">
      <text x="${n.x+nameInset}" y="${n.y+n.h/2+titleSize*.34}" font-size="${titleSize}" clip-path="url(#name-edge)">${xml(fit(card.name,nameWidth,titleSize))}</text>
      <text x="${n.x+n.w-nameInset}" y="${n.y+n.h/2+numeralSize*.34}" text-anchor="end" font-size="${numeralSize}" font-weight="700">1/1</text>
      <text x="${t.x+typeInset}" y="${t.y+t.h/2+typeSize*.34}" font-family="Courier Prime,monospace" font-size="${typeSize}">$${xml(card.ticker)}</text>
      <text x="${t.x+t.w-typeInset}" y="${t.y+t.h/2+typeSize*.34}" text-anchor="end" font-style="italic" font-size="${typeSize}">${xml(quote.symbol)} pair</text>
      ${description.map((line,i)=>`<text x="${left}" y="${d.y+print.detailsTop*unit+loreSize*(.8+(print.loreLine-1)/2)+i*loreSize*print.loreLine}" font-style="italic" font-size="${loreSize}">${xml(line)}</text>`).join("")}
      <path d="M${left} ${firstRow-print.rowsTop*unit-.125*unit}H${right}" stroke="${ink}" stroke-opacity=".22" stroke-width="${.25*unit}"/>
      ${rows.map(([label,value],i)=>{const y=firstRow+rowSize*(.8+(print.rowLine-1)/2)+i*(rowHeight+rowGap),lx=left+widthOf(label,rowSize,true)+1.4*unit,rx=right-widthOf(value,rowSize,true)-1.4*unit;return `<text x="${left}" y="${y}" font-family="Courier Prime,monospace" font-size="${rowSize}" font-weight="600">${label}</text><path d="M${lx} ${y-.6*unit}H${rx}" stroke="${ink}" stroke-opacity=".35" stroke-dasharray="3 7" stroke-width="${.25*unit}"/><text x="${right}" y="${y}" text-anchor="end" font-family="Courier Prime,monospace" font-size="${rowSize}" font-weight="500">${xml(value)}</text>`;}).join("")}
    </g></g></svg>`;
}

/** Full upright card on a matte square, with every corner inside circular wallet avatars. */
export function creatorTokenImageSvg(cardPng:Uint8Array) {
  const {width,height}=TOKEN_IMAGE_DIMENSIONS;
  const {background,cardX,cardY,cardWidth,cardHeight}=TOKEN_IMAGE_LAYOUT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-token-image-format="${TOKEN_IMAGE_FORMAT}">
    <rect width="${width}" height="${height}" fill="${background}"/>
    <image x="${cardX*width}" y="${cardY*height}" width="${cardWidth*width}" height="${cardHeight*height}" preserveAspectRatio="xMidYMid meet" href="${imageDataUri(cardPng,"image/png")}"/>
  </svg>`;
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
