// Needs claude/codex-identities-snapshot (Codex's evidence folder and output/, left off this branch); it does not run here.
/** Visual proof of actual shared creator print, without wallet or launch side effects. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import {creatorCardSvg,imageDataUri} from '../src/lib/carddex/live/creator-print';
import type {CardData} from '../src/components/mintdex/MintCard';
import staged from '../src/lib/carddex/pair-designs.json';
import atlases from '../src/lib/carddex/render-assets.json';
const app=path.resolve(import.meta.dir,'..'),out=path.resolve(app,'../output/higgsfield/pair-identities-2026-10-30/integration/proof');
await mkdir(out,{recursive:true});
await initWasm(await readFile(path.join(app,'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
const fonts=await Promise.all(['libre-caslon-text-400.woff2','libre-caslon-text-700.woff2','libre-caslon-text-400i.woff2','courier-prime-400.woff2','courier-prime-700.woff2'].map(p=>readFile(path.join(app,'public/fonts',p))));
const p=Bun.spawn(['python3','-c',`from PIL import Image\nImage.open(${JSON.stringify(path.join(app,'public/assets/creatures/glorb.webp'))}).convert('RGB').save(${JSON.stringify(path.join(out,'sample-art.png'))})`],{stdout:'inherit',stderr:'inherit'});
if(await p.exited!==0)throw new Error('Sample art conversion failed');
const artwork=imageDataUri(await readFile(path.join(out,'sample-art.png')),'image/png');
const only=process.argv.find(s=>s.startsWith('--only='))?.slice(7).split(',');let completed=0;
for(const design of staged){
 if(only&&!only.includes(design.key))continue;
 const key=design.key+(design.category==='stocks'?'--stock':'');
 const atlas=(atlases as Record<string,{path:string}>)[key];if(!atlas)continue;
 const card={name:'Creator Token',ticker:'TOKEN',lore:'Your token. Your card. A permanent collectible with its own signature finish.',cardTemplate:design.key,quoteAssetKey:design.quoteKey} as CardData;
 const svg=creatorCardSvg(card,'TokenPreview111111111111111111111111111111','CreatorPreview',artwork,imageDataUri(await readFile(path.join(app,'public',atlas.path.slice(1))),'image/png'),{tokenImage:true});
 const renderer=new Resvg(svg,{font:{fontBuffers:fonts,defaultFontFamily:'Libre Caslon Text',serifFamily:'Libre Caslon Text',monospaceFamily:'Courier Prime'}});
 try{const rendered=renderer.render();try{await writeFile(path.join(out,`${design.key}.png`),rendered.asPng());}finally{rendered.free();}}finally{renderer.free();}
 completed++;
}
console.log({completed,out});
