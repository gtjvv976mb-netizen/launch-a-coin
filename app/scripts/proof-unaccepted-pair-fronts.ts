// Needs claude/codex-identities-snapshot (Codex's evidence folder and output/, left off this branch); it does not run here.
/** Isolated canonical proof; never writes acceptance or active indexes. */
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {renderToStaticMarkup} from 'react-dom/server';
import {CanonicalSkinSurface} from '../src/components/carddex/CanonicalCardSkin';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import {creatorCardSvg,imageDataUri} from '../src/lib/carddex/live/creator-print';
import type {CardData} from '../src/components/mintdex/MintCard';
import staged from '../src/lib/carddex/pair-designs.json';
const app=path.resolve(import.meta.dir,'..'),root=path.resolve(app,'..');
const directory=process.argv.find(arg=>arg.startsWith('--directory='))?.slice(12);
const out=directory?path.resolve(directory):path.join(root,'output/higgsfield/pair-identities-2026-10-30/tailoring-v2/canonical-pilot');
if(!out.startsWith(path.join(root,'output')+path.sep))throw new Error('Proof directory must be isolated in ignored output/');
const normalized=JSON.parse(await readFile(path.join(out,'normalized.json'),'utf8'));
for(const item of normalized){
 const design=staged.find(design=>design.key===item.designKey)!;
 const png=await readFile(path.join(out,`${item.designKey}-front.png`));
 const surface=renderToStaticMarkup(CanonicalSkinSurface({cardTemplate:item.designKey,id:'offline-pilot',sourceUri:imageDataUri(png,'image/png'),preparedSource:{design:design as any,source:{art:item.layout.art,mask:item.layout.mask,plates:item.layout.prints,sourceMaterialGaps:true}}}));
 await writeFile(path.join(out,`${item.designKey}-canonical.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1760" viewBox="0 0 1000 1000" preserveAspectRatio="none">${surface}</svg>`);
}
const cli=path.join(os.homedir(),'.codex/skills/playwright/scripts/playwright_cli.sh'),session='pair-tailoring-pilots',config=path.join(root,'output/playwright/launch-a-card-public-2026-10-28/cli.config.json');
async function run(args:string[]){const p=Bun.spawn(['bash',cli,'--session',session,...args],{cwd:root,env:{...process.env,npm_config_offline:'true'},stdout:'inherit',stderr:'inherit'});if(await p.exited!==0)throw new Error('Owned isolated pilot browser failed');}
const filename=path.join(out,'flatten-pilots.js');
await writeFile(filename,`async(page)=>{await page.setViewportSize({width:1260,height:1760});for(const key of ${JSON.stringify(normalized.map((v:any)=>v.designKey))}){await page.goto(${JSON.stringify(new URL('file://'+out+'/').href)}+key+'-canonical.svg');await page.screenshot({path:${JSON.stringify(out+'/')}+key+'-canonical.png',omitBackground:true});}return {proofOnly:true,count:${normalized.length}};}`);
await run(['open','about:blank','--config',config]);try{await run(['run-code','--filename',filename]);}finally{await run(['close']);}
const cleanup=Bun.spawn(['python3','-c',`import sys,json\nfrom pathlib import Path\nfrom PIL import Image\nsys.path.insert(0,${JSON.stringify(path.join(root,'creative/higgsfield/pair-identities-2026-10-30'))})\nfrom edge_cleanup import edge_connected_white_cleanup\np=Path(${JSON.stringify(out)})\nreports={}\nfor key in ${JSON.stringify(normalized.filter((item:any)=>item.edgeConnectedWhiteCleanup).map((item:any)=>item.designKey))}:\n im,report=edge_connected_white_cleanup(Image.open(p/(key+'-canonical.png')))\n im.save(p/(key+'-canonical.png'))\n reports[key]=report\n(p/'edge-alpha-cleanup.json').write_text(json.dumps(reports,indent=2))`],{stdout:'inherit',stderr:'inherit'});if(await cleanup.exited!==0)throw new Error('Pilot edge cleanup failed');
await initWasm(await readFile(path.join(app,'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
const fonts=await Promise.all(['libre-caslon-text-400.woff2','libre-caslon-text-700.woff2','libre-caslon-text-400i.woff2','courier-prime-400.woff2','courier-prime-700.woff2'].map(p=>readFile(path.join(app,'public/fonts',p))));
const artwork=imageDataUri(await readFile(path.join(root,'output/higgsfield/pair-identities-2026-10-30/integration/proof/sample-art.png')),'image/png');
for(const item of normalized){
 const design=staged.find(design=>design.key===item.designKey)!;
 const atlas=await readFile(path.join(out,`${item.designKey}-canonical.png`));
 const card={name:'Creator Token',ticker:'TOKEN',lore:'Your token. Your card. A permanent collectible with its own signature finish.',cardTemplate:design.key,quoteAssetKey:design.quoteKey} as CardData;
 const svg=creatorCardSvg(card,'TokenPreview111111111111111111111111111111','CreatorPreview',artwork,imageDataUri(atlas,'image/png'),{tokenImage:true});
 await writeFile(path.join(out,`${item.designKey}-populated.svg`),svg);
 const renderer=new Resvg(svg,{font:{fontBuffers:fonts,defaultFontFamily:'Libre Caslon Text',serifFamily:'Libre Caslon Text',monospaceFamily:'Courier Prime'}});
 try{const rendered=renderer.render();try{await writeFile(path.join(out,`${item.designKey}-populated.png`),rendered.asPng());}finally{rendered.free();}}finally{renderer.free();}
}
console.log({proofOnly:true,completed:normalized.length,out});
