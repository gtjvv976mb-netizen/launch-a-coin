import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "virtual:launchacard-resvg-wasm";
import type { CardData } from "../../../components/mintdex/MintCard";
import renderAssets from "../render-assets.json";
import { getPairAsset } from "../pairs";
import { creatorCardSvg, creatorCaseSvg, imageDataUri, CREATOR_IMAGE_DIMENSIONS } from "./creator-print";
export { CREATOR_CARD_RENDERER_VERSION } from "./creator-print";

let initialized:Promise<void>|undefined;
const FONT_PATHS=["libre-caslon-text-400.woff2","libre-caslon-text-700.woff2","libre-caslon-text-400i.woff2","courier-prime-400.woff2","courier-prime-700.woff2"];
function render(svg:string,fontBuffers:Uint8Array[]) {
 const renderer=new Resvg(svg,{font:{fontBuffers,defaultFontFamily:"Libre Caslon Text",serifFamily:"Libre Caslon Text",monospaceFamily:"Courier Prime"}});
 try {const output=renderer.render();try{return output.asPng().slice();}finally{output.free();}}finally{renderer.free();}
}
/** Trusted server output only; no external SVG, fonts, executable markup or client-supplied card image. */
export async function composeCreatorImages(input:{card:CardData;tokenMint:string;creator:string;artwork:Uint8Array;mimeType:string},dependencies:{loadAsset:(path:string)=>Promise<Uint8Array>}) {
 initialized??=initWasm(resvgWasm).catch(error=>{initialized=undefined;throw error;});
 await initialized;
 const key=(input.card.cardTemplate||"")+(getPairAsset(input.card.quoteAssetKey||"sol").kind==="stock"?"--stock":"");
 const atlas=(renderAssets as Record<string,{path:string}>)[key];
 if(!atlas)throw new Error("Choose an approved card design before composing the NFT.");
 if(input.mimeType!=="image/png"&&input.mimeType!=="image/jpeg")throw new Error("Convert artwork to PNG or JPEG before composing the card.");
 const [atlasBytes,...fonts]=await Promise.all([dependencies.loadAsset(atlas.path),...FONT_PATHS.map(path=>dependencies.loadAsset(`/fonts/${path}`))]);
 const cardImage=render(creatorCardSvg(input.card,input.tokenMint,input.creator,imageDataUri(input.artwork,input.mimeType),imageDataUri(atlasBytes,"image/png")),fonts);
 const caseImage=render(creatorCaseSvg(cardImage,input.tokenMint),fonts);
 return {cardImage,caseImage,mimeType:"image/png" as const,dimensions:CREATOR_IMAGE_DIMENSIONS};
}
