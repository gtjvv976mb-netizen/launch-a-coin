import type { CardData } from "../../../components/mintdex/MintCard";
import type { LiveAssets, LiveResult } from "./types";

async function supportedArtwork(artwork:Blob):Promise<Blob> {
 const signature=new Uint8Array(await artwork.slice(0,12).arrayBuffer());
 const webp=String.fromCharCode(...signature.slice(0,4))==="RIFF"&&String.fromCharCode(...signature.slice(8,12))==="WEBP";
 const bitmap=await createImageBitmap(artwork);
 try {if(!webp&&bitmap.width<=2048&&bitmap.height<=2048)return artwork;const canvas=document.createElement("canvas");const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Your browser could not prepare this artwork. Use a PNG or JPEG.");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const mime=artwork.type==="image/jpeg"?"image/jpeg":"image/png";return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Use a PNG or JPEG artwork file.")),mime,.95));}finally{bitmap.close();}
}

/** A wallet-authenticated request to the trusted renderer; returned URLs commit the exact token and design. */
export async function composeCreatorCard({card,tokenMint,artwork,website,xUrl}:{card:CardData;tokenMint:string;artwork:Blob;website?:string;xUrl?:string}):Promise<LiveAssets> {
 const file=await supportedArtwork(artwork);
 if(file.size>4*1024*1024)throw new Error("This artwork is too large after conversion. Use a PNG or JPEG under 4 MB.");
 const form=new FormData();form.append("artwork",file,file.type==="image/jpeg"?"artwork.jpg":"artwork.png");
 form.append("input",JSON.stringify({tokenMint,name:card.name,symbol:card.ticker,description:card.lore||"",cardTemplate:card.cardTemplate,quoteAssetKey:card.quoteAssetKey,quoteMint:card.quoteMint,website,xUrl}));
 const response=await fetch("/api/live/compose",{method:"POST",credentials:"same-origin",body:form});
 const data=await response.json() as LiveResult<{assets:LiveAssets}>;
 if(!response.ok||!data.ok)throw new Error(data.ok?"The card could not be composed.":data.error);
 return data.assets;
}
