/** Release utility: regenerate trusted flattened skins and compact browser PNGs without changing the original Higgsfield assets.
 * Requires Python/Pillow and installed Playwright CLI; optional PLAYWRIGHT_CONFIG points at a browser config.
 * Run from app/: bun scripts/prepare-card-skins.ts. This does not spend generation credits or touch a wallet.
 */
import {renderToStaticMarkup} from 'react-dom/server';
import {CanonicalSkinSurface} from '../src/components/carddex/CanonicalCardSkin';
import {CARD_DESIGNS} from '../src/lib/carddex/designs';
import {allowedQuotesForDesign} from '../src/lib/carddex/pairs';
import {CARD_RENDERER_VERSION} from '../src/lib/carddex/card-template';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const directory=path.resolve('../output/creator-skins');await mkdir(directory,{recursive:true});
async function run(command:string[]){const process=Bun.spawn(command,{stdout:'inherit',stderr:'inherit'});if(await process.exited!==0)throw new Error(`Failed: ${command[0]}`);}
await run(['python3','-c',`from PIL import Image\nfrom pathlib import Path\nout=Path(${JSON.stringify(directory)});out.mkdir(exist_ok=True)\nfor src in Path('public/assets/carddex/higgsfield').glob('*-front.webp'): Image.open(src).convert('RGB').save(out/src.with_suffix('.png').name)`]);
const inputs=[];
for(const design of CARD_DESIGNS){
 const image=await readFile(`${directory}/${design.key}-front.png`);
 const kinds=new Set(allowedQuotesForDesign(design.key).map(q=>q.kind==='stock'?'stock':'plain'));
 for(const kind of kinds){
  const key=design.key+(kind==='stock'?'--stock':'');
  const source=renderToStaticMarkup(CanonicalSkinSurface({cardTemplate:design.key,quoteAssetKey:kind==='stock'?'tslax':'sol',sourceUri:`data:image/png;base64,${image.toString('base64')}`,id:'export'}));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1760" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><clipPath id="edge"><rect width="1000" height="1000" rx="50.4" ry="36.0818"/></clipPath></defs><g clip-path="url(#edge)">${source}</g></svg>`;
  await writeFile(`${directory}/${key}.svg`,svg);
  inputs.push({key,designKey:design.key,kind,input:`${key}.svg`,output:`${key}.png`});
 }
}
await writeFile(`${directory}/inputs.json`,JSON.stringify(inputs));
await writeFile(`${directory}/render.js`,`async(page)=>{await page.setViewportSize({width:1260,height:1760});for(const input of ${JSON.stringify(inputs)}){await page.goto(${JSON.stringify(new URL(`file://${directory}/`).href)}+input.input);await page.screenshot({path:${JSON.stringify(directory+'/')}+input.output,omitBackground:true});}return {completed:${inputs.length}};}`);
const cli=process.env.PLAYWRIGHT_CLI||'playwright-cli';const config=process.env.PLAYWRIGHT_CONFIG?['--config',path.resolve(process.env.PLAYWRIGHT_CONFIG)]:[];
await run([cli,'--session','creator-skins','open','about:blank',...config]);
try{await run([cli,'--session','creator-skins','run-code','--filename',`${directory}/render.js`]);}finally{await run([cli,'--session','creator-skins','close']);}
await run(['python3','-c',`from pathlib import Path\nfrom PIL import Image\nimport json,hashlib\nbase=Path(${JSON.stringify(directory)});dest=Path('public/assets/carddex/render');dest.mkdir(exist_ok=True);previews=dest/'preview';previews.mkdir(exist_ok=True);manifest={}\nfor item in json.loads((base/'inputs.json').read_text()):\n out=dest/item['output'];image=Image.open(base/item['output']).convert('RGBA');image.save(out,optimize=True)\n preview=previews/item['output'];image.resize((320,447),Image.Resampling.LANCZOS).save(preview,optimize=True)\n original=Path('public/assets/carddex/higgsfield')/(item['designKey']+'-front.webp')\n manifest[item['key']]={'path':'/'+str(out.relative_to('public')),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'previewPath':'/'+str(preview.relative_to('public')),'previewSha256':hashlib.sha256(preview.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(original.read_bytes()).hexdigest(),'designKey':item['designKey'],'kind':item['kind'],'width':1260,'height':1760,'rendererVersion':${JSON.stringify(CARD_RENDERER_VERSION)}}\nPath('src/lib/carddex/render-assets.json').write_text(json.dumps(manifest,indent=2)+'\\n')\nprint({'count':len(manifest)})`]);
