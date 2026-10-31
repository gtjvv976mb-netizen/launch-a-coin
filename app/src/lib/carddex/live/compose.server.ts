import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "virtual:launchacard-resvg-wasm";
import type { CardData } from "../../../components/mintdex/MintCard";
import { creatorAtlas, creatorTokenBack } from "./compose-assets";
import { encodeIndexedTurntable, indexTokenFaces, TOKEN_ANIMATION_FORMAT } from "./token-turntable";
import { creatorCardSvg, creatorCaseSvg, creatorTokenImageSvg, imageDataUri, CREATOR_IMAGE_DIMENSIONS, TOKEN_IMAGE_FORMAT } from "./creator-print";
export { CREATOR_CARD_RENDERER_VERSION } from "./creator-print";

let initialized:Promise<void>|undefined;
const FONT_PATHS=["libre-caslon-text-400.woff2","libre-caslon-text-700.woff2","libre-caslon-text-400i.woff2","courier-prime-400.woff2","courier-prime-700.woff2"];
function render(svg:string,fontBuffers:Uint8Array[]) {
 const renderer=new Resvg(svg,{font:{fontBuffers,defaultFontFamily:"Libre Caslon Text",serifFamily:"Libre Caslon Text",monospaceFamily:"Courier Prime"}});
 try {const output=renderer.render();try{return output.asPng().slice();}finally{output.free();}}finally{renderer.free();}
}
type CreatorImageInput={card:CardData;tokenMint:string;creator:string;artwork:Uint8Array;mimeType:string};
type CreatorImageDependencies={loadAsset:(path:string)=>Promise<Uint8Array>};
async function loadRenderInput(input:CreatorImageInput,dependencies:CreatorImageDependencies) {
 initialized??=initWasm(resvgWasm).catch(error=>{initialized=undefined;throw error;});
 await initialized;
 // The card's pinned design version when it carries one (design-versions.ts), else the current atlas.
 const atlas=creatorAtlas(input.card);
 if(!atlas)throw new Error("Choose an approved card design before composing the NFT.");
 if(input.mimeType!=="image/png"&&input.mimeType!=="image/jpeg")throw new Error("Convert artwork to PNG or JPEG before composing the card.");
 const [atlasBytes,...fonts]=await Promise.all([dependencies.loadAsset(atlas.path),...FONT_PATHS.map(path=>dependencies.loadAsset(`/fonts/${path}`))]);
 return {artUri:imageDataUri(input.artwork,input.mimeType),atlasUri:imageDataUri(atlasBytes,"image/png"),fonts};
}
/** Trusted server output only; no external SVG, fonts, executable markup or client-supplied card image. */
export async function composeCreatorImages(input:CreatorImageInput,dependencies:CreatorImageDependencies) {
 const {artUri,atlasUri,fonts}=await loadRenderInput(input,dependencies);
 const cardImage=render(creatorCardSvg(input.card,input.tokenMint,input.creator,artUri,atlasUri),fonts);
 const caseImage=render(creatorCaseSvg(cardImage,input.tokenMint),fonts);
 return {cardImage,caseImage,mimeType:"image/png" as const,dimensions:CREATOR_IMAGE_DIMENSIONS};
}

function facePixels(png:Uint8Array) {
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880"><image width="630" height="880" href="${imageDataUri(png,"image/png")}"/></svg>`;
 const renderer=new Resvg(svg);
 try {const output=renderer.render();try{return {pixels:output.pixels.slice(),width:output.width,height:output.height};}finally{output.free();}}finally{renderer.free();}
}
/**
 * The still and both indexed faces. Its own function so the artwork and atlas data URIs, the fonts, the full-size
 * front print and both RGBA faces are unreachable once it returns, before the frames are encoded (memory, not output:
 * the pixels are the same as rendering everything in one function).
 */
async function tokenFacesAndStill(input:CreatorImageInput,dependencies:CreatorImageDependencies) {
 const {artUri,atlasUri,fonts}=await loadRenderInput(input,dependencies);
 const back=creatorTokenBack(input.card);
 if(!back)throw new Error("This card design has no verified token-image reverse.");
 const backPng=await dependencies.loadAsset(back.path);
 const frontPng=render(creatorCardSvg(input.card,input.tokenMint,input.creator,artUri,atlasUri,{tokenImage:true}),fonts);
 const tokenPoster=render(creatorTokenImageSvg(frontPng),fonts);
 return {tokenPoster,faces:indexTokenFaces(facePixels(frontPng),facePixels(backPng))};
}
/** Stable, paid-generation-free turntable of the exact approved artwork and normalized creator details. */
export async function composeCreatorTokenMedia(input:CreatorImageInput,dependencies:CreatorImageDependencies) {
 const {tokenPoster,faces}=await tokenFacesAndStill(input,dependencies);
 const tokenImage=encodeIndexedTurntable(faces);
 return {tokenImage,tokenPoster,mimeType:"image/gif" as const,format:TOKEN_ANIMATION_FORMAT,posterFormat:TOKEN_IMAGE_FORMAT};
}
