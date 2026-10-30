/** Incrementally install accepted complete Higgsfield pair identities. No generation, deployment or wallet access.
 * Run from app/: bun scripts/prepare-pair-designs.ts [--only=pair-sol,pair-doge] [--force] [--plan] [--revoke-only]
 * Preserves every legacy manifest entry and source byte. Pending/incomplete faces are never activated.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {renderToStaticMarkup} from 'react-dom/server';
import {CanonicalSkinSurface} from '../src/components/carddex/CanonicalCardSkin';
import {CARD_RENDERER_VERSION} from '../src/lib/carddex/card-template';
import type {CardDesign} from '../src/lib/carddex/designs';
import {PAIR_ACCEPTANCE_FILES,OPTIONAL_PAIR_ACCEPTANCE_FILES,TAILORING_ACCEPTANCE_FILE,previouslyInstalledTailoringKeys,selectAcceptedPairs,type AcceptanceLayer} from './lib/pair-acceptance';
import {verifyPairSourceDerivation} from './lib/pair-source-derivation';

const app=path.resolve(import.meta.dir,'..'),root=path.resolve(app,'..');
const creative=path.join(root,'creative/higgsfield/pair-identities-2026-10-30');
const out=path.join(root,'output/higgsfield/pair-identities-2026-10-30/integration');
await mkdir(out,{recursive:true});
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const json=async(file:string)=>JSON.parse(await readFile(file,'utf8'));
const manifests={layouts:path.join(app,'src/lib/carddex/generated-layouts.json'),atlases:path.join(app,'src/lib/carddex/render-assets.json'),reverses:path.join(app,'src/lib/carddex/token-back-assets.json'),reviewed:path.join(root,'integrations/pumpfun/src/design-assets.json')};
const before=Object.fromEntries(await Promise.all(Object.entries(manifests).map(async([name,file])=>[name,await json(file)])));
const staged:CardDesign[]=await json(path.join(app,'src/lib/carddex/pair-designs.json'));
const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7).split(',');
const force=process.argv.includes('--force');
const previous=await json(path.join(creative,'integration-provenance.json')).catch(()=>({pairs:{}}));
const snapshots=[];const candidates=new Map<string,any>(),layers:AcceptanceLayer[]=[];
const acceptanceFiles=PAIR_ACCEPTANCE_FILES;
async function readAcceptance(fileName:string){
 try{return await readFile(path.join(creative,fileName));}
 catch(error){if(OPTIONAL_PAIR_ACCEPTANCE_FILES.has(fileName)&&(error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
for(const fileName of acceptanceFiles){
 const file=path.join(creative,fileName),bytes=await readAcceptance(fileName);if(!bytes)continue;
 const data=JSON.parse(bytes.toString());snapshots.push({file:path.relative(root,file),sha256:hash(bytes),updatedAt:data.updatedAt});layers.push({fileName,data});
}
const processingFile=path.join(creative,'normalization-overrides.json');
const processingBytes=await readFile(processingFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const processing=processingBytes?JSON.parse(processingBytes.toString()):{sources:{}};
if(processingBytes)snapshots.push({file:path.relative(root,processingFile),sha256:hash(processingBytes),updatedAt:processing.updatedAt});
const selection=selectAcceptedPairs(layers,previouslyInstalledTailoringKeys(previous)),accepted=selection.accepted;
for(const pair of accepted.values()){
  const design=staged.find(design=>design.key===pair.designKey) as CardDesign&{quoteMint:string};
  if(!design||design.quoteMint!==pair.exactQuoteMint||!pair.front||!pair.back)throw new Error(`Invalid complete accepted identity: ${pair.designKey}`);
  for(const face of ['front','back']){
   const source=pair[face];
   const sourceCompositionEvidence=await verifyPairSourceDerivation(root,source);
   if(sourceCompositionEvidence)source.sourceCompositionEvidence=sourceCompositionEvidence;
   const override=processing.sources?.[source.sha256];
   if(override){
    if(override.designKey!==pair.designKey||override.face!==face||override.masterPath!==source.sourcePath)throw new Error('Processing override identity mismatch');
    if(override.reviewedCrop)source.reviewedCrop=override.reviewedCrop;
    if(override.edgeConnectedWhiteCleanup)source.edgeConnectedWhiteCleanup=true;
    if(override.sourcePaperPatches)source.sourcePaperPatches=override.sourcePaperPatches;
    source.normalizationOverride={...override,file:path.relative(root,processingFile),fileSha256:hash(processingBytes!)};
   }
   if(!source.visualStatus?.startsWith('accepted')||source.designKey!==pair.designKey||source.exactQuoteMint!==design.quoteMint||source.face!==face)throw new Error(`Unreviewed identity: ${pair.designKey} ${face}`);
   const sourceFile=path.resolve(root,source.sourcePath),masterDirectory=path.join(root,'output/higgsfield/pair-identities-2026-10-30/originals')+path.sep;
   const reviewedComposition=sourceCompositionEvidence&&sourceFile.startsWith(path.join(root,'output/higgsfield/pair-identities-2026-10-30')+path.sep);
   if(!sourceFile.startsWith(masterDirectory)&&!reviewedComposition||path.extname(sourceFile).toLowerCase()!=='.png'||!/^[a-f0-9]{64}$/.test(source.sha256)||!source.jobId)throw new Error(`Invalid accepted master record: ${pair.designKey} ${face}`);
  }
  const fingerprint=hash(JSON.stringify([pair.front.sha256,pair.back.sha256]));
  const complete={...pair,fingerprint,design};accepted.set(pair.designKey,complete);
  if(!only||only.includes(pair.designKey))candidates.set(pair.designKey,complete);
}
const revoked=Object.keys(previous.pairs).filter(key=>accepted.get(key)?.fingerprint!==previous.pairs[key].fingerprint);
const pairs=process.argv.includes('--revoke-only')?[]:[...candidates.values()].filter(pair=>force||previous.pairs[pair.designKey]?.fingerprint!==pair.fingerprint);
if(process.argv.includes('--plan')){
 console.log(JSON.stringify({acceptedComplete:accepted.size,selectedComplete:candidates.size,installed:Object.keys(previous.pairs).length,import:pairs.map(pair=>pair.designKey),revoke:revoked,blocked:selection.blockedDesignKeys}));process.exit(0);
}
const after=structuredClone(before);let generated=await readFile(path.join(app,'src/lib/carddex/generated-assets.ts'),'utf8');
function preserveLegacy(){
 for(const [name,entries] of Object.entries(before))for(const [key,value] of Object.entries(entries as object))if(!key.startsWith('pair-')&&JSON.stringify(after[name][key])!==JSON.stringify(value))throw new Error(`Legacy manifest changed: ${name} ${key}`);
}
async function publishIndexes(){
 preserveLegacy();
 for(const [name,file] of Object.entries(manifests))await writeFile(file,JSON.stringify(after[name],null,2)+'\n');
 await writeFile(path.join(app,'src/lib/carddex/generated-assets.ts'),generated);
 previous.snapshots=snapshots;previous.updatedAt=new Date().toISOString();
 await writeFile(path.join(creative,'integration-provenance.json'),JSON.stringify(previous,null,2)+'\n');
}
async function retireInstalled(key:string,reason:string){
 const old=previous.pairs[key];if(!old)return;
 const archivedDerivativeFiles=[];
 const oldFiles=[...Object.values(old.faces as Record<string,any>).flatMap(face=>[{path:face.path,sha256:face.sha256},{path:face.compactPath,sha256:face.compactSha256}]),{path:old.atlas.path,sha256:old.atlas.sha256},{path:old.atlas.previewPath,sha256:old.atlas.previewSha256},{path:old.reverse.path,sha256:old.reverse.sha256}];
 for(const source of oldFiles){
  const bytes=await readFile(path.join(app,'public',source.path.slice(1)));if(hash(bytes)!==source.sha256)throw new Error('Prior derivative changed before archival: '+source.path);
  const destination=path.join(out,'retired',`${key}@${old.fingerprint}`,source.path.slice(1));await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
  archivedDerivativeFiles.push({originalPath:source.path,archivePath:path.relative(root,destination),sha256:source.sha256});
 }
 previous.retired??={};
 previous.retired[`${key}@${old.fingerprint}`]={...old,archivedDerivativeFiles,retiredAt:new Date().toISOString(),reason};
 delete previous.pairs[key];delete after.layouts[key];delete after.reverses[key];delete after.reviewed[key];
 for(const atlasKey of Object.keys(after.atlases))if(after.atlases[atlasKey].designKey===key)delete after.atlases[atlasKey];
 generated=generated.replace(new RegExp(`^  "${key}": .*\\n`,'m'),'');
 if(!revoked.includes(key))revoked.push(key);
}
if(revoked.length){
 for(const key of [...revoked])await retireInstalled(key,accepted.has(key)?'accepted-master-superseded':'source-acceptance-revoked');
 // Fail closed before any new conversion: a revoked/superseded identity cannot
 // remain active if conversion later fails. Keep every old source/output file.
 await writeFile(path.join(app,'src/lib/carddex/generated-assets.ts'),generated);
 await publishIndexes();
}
if(!pairs.length){console.log(JSON.stringify({acceptedComplete:accepted.size,installed:Object.keys(previous.pairs).length,changed:0,revoked}));process.exit(0);}
const helper=Bun.spawn(['python3',path.join(creative,'prepare-pair-sources.py')],{stdin:'pipe',stdout:'pipe',stderr:'inherit'});
helper.stdin.write(JSON.stringify({root,out,pairs}));helper.stdin.end();
const prepared=JSON.parse(await new Response(helper.stdout).text()||'null');
if(await helper.exited!==0||!Array.isArray(prepared)||prepared.length!==pairs.length)throw new Error('Source normalization failed; installation manifests were not changed.');
const results=[];
for(const item of prepared){
 const pair=pairs.find(pair=>pair.designKey===item.designKey)!;
 const source={art:item.layout.art,mask:item.layout.mask,plates:item.layout.prints,...(item.layout.sourceMaterialGaps?{sourceMaterialGaps:true}:{})};
 const png=await readFile(path.join(out,`${item.designKey}-front.png`));
 const markup=renderToStaticMarkup(CanonicalSkinSurface({cardTemplate:item.designKey,id:'export',sourceUri:`data:image/png;base64,${png.toString('base64')}`,preparedSource:{design:pair.design,source}}));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="1760" viewBox="0 0 1000 1000" preserveAspectRatio="none">${markup}</svg>`;
 const atlasKey=item.designKey+(pair.design.category==='stocks'?'--stock':'');
 await writeFile(path.join(out,`${atlasKey}.svg`),svg);
 results.push({...item,atlasKey,kind:pair.design.category==='stocks'?'stock':'plain',fingerprint:pair.fingerprint,quoteMint:pair.exactQuoteMint,svgSha256:hash(svg),acceptanceManifest:pair.acceptanceManifest});
}
// Chromium flattens the exact production SVG/nine-slice surface. Resvg's nested
// <use>/<mask> expansion can exceed WASM memory for these detailed 2K sources.
const cli=process.env.PLAYWRIGHT_CLI||path.join(os.homedir(),'.codex/skills/playwright/scripts/playwright_cli.sh');
const config=process.env.PLAYWRIGHT_CONFIG||path.join(root,'output/playwright/launch-a-card-public-2026-10-28/cli.config.json');
const session='pair-design-atlases';
async function run(command:string[]){const p=Bun.spawn(command[0].endsWith('.sh')?['bash',...command]:command,{cwd:root,env:{...process.env,npm_config_offline:'true'},stdout:'inherit',stderr:'inherit'});if(await p.exited!==0)throw new Error('Failed: '+command[0]);}
const renderScript=path.join(out,'flatten.js');
await writeFile(renderScript,`async(page)=>{await page.setViewportSize({width:1260,height:1760});for(const key of ${JSON.stringify(results.map(r=>r.atlasKey))}){await page.goto(${JSON.stringify(new URL('file://'+out+'/').href)}+key+'.svg');await page.screenshot({path:${JSON.stringify(out+'/')}+key+'.png',omitBackground:true});}return {completed:${results.length}};}`);
await run([cli,'--session',session,'open','about:blank','--config',config]);
try{await run([cli,'--session',session,'run-code','--filename',renderScript]);}finally{await run([cli,'--session',session,'close']);}
const post=Bun.spawn(['python3','-c',String.raw`
from pathlib import Path
from PIL import Image
import json,sys,hashlib
s=json.load(sys.stdin);sys.path.insert(0,s['creative'])
from edge_cleanup import edge_connected_white_cleanup
root=Path(s['app']);out=Path(s['out']);rows=[]
for row in s['results']:
 key=row['atlasKey'];source=Image.open(out/(key+'.png')).convert('RGBA')
 if row.get('edgeConnectedWhiteCleanup'):source,row['canonicalEdgeCleanup']=edge_connected_white_cleanup(source)
 if source.size!=(1260,1760) or source.getpixel((0,0))[3]!=0:raise ValueError('Invalid canonical alpha '+key)
 dest=root/'public/assets/carddex/render'/(key+'.png');source.save(dest,optimize=True)
 preview=dest.parent/'preview'/dest.name;source.resize((320,447),Image.Resampling.LANCZOS).save(preview,optimize=True)
 digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 row['atlas']={'designKey':row['designKey'],'kind':row['kind'],'path':'/'+str(dest.relative_to(root/'public')),'sha256':digest(dest),'previewPath':'/'+str(preview.relative_to(root/'public')),'previewSha256':digest(preview),'sourceSha256':row['faces']['front']['sha256'],'width':1260,'height':1760,'rendererVersion':s['rendererVersion']}
 rows.append(row)
print(json.dumps(rows))
`],{stdin:'pipe',stdout:'pipe',stderr:'inherit'});
post.stdin.write(JSON.stringify({app,out,creative,results,rendererVersion:CARD_RENDERER_VERSION}));post.stdin.end();
const finalized=JSON.parse(await new Response(post.stdout).text()||'null');
if(await post.exited!==0||!Array.isArray(finalized))throw new Error('Canonical output checks failed; installation manifests were not changed.');
// Art reviewers continue in parallel. Recheck acceptance after the slow raster
// step so a face revoked/replaced during conversion cannot be newly activated.
const latestFingerprints=new Map<string,string>(),latestLayers:AcceptanceLayer[]=[];
for(const fileName of acceptanceFiles){
 const bytes=await readAcceptance(fileName);if(!bytes)continue;latestLayers.push({fileName,data:JSON.parse(bytes.toString())});
}
const latestSelection=selectAcceptedPairs(latestLayers,previouslyInstalledTailoringKeys(previous));
for(const pair of latestSelection.accepted.values()){
 const design=staged.find(design=>design.key===pair.designKey) as CardDesign&{quoteMint:string};
 if(!design||design.quoteMint!==pair.exactQuoteMint||pair.front.exactQuoteMint!==design.quoteMint||pair.back.exactQuoteMint!==design.quoteMint)continue;
 latestFingerprints.set(pair.designKey,hash(JSON.stringify([pair.front.sha256,pair.back.sha256])));
}
const lateRevocations=Object.keys(previous.pairs).filter(key=>latestFingerprints.get(key)!==previous.pairs[key].fingerprint);
for(const key of lateRevocations)await retireInstalled(key,'source-acceptance-changed-during-import');
if(lateRevocations.length){await writeFile(path.join(app,'src/lib/carddex/generated-assets.ts'),generated);await publishIndexes();}
const installedKeys:string[]=[],skippedKeys:string[]=[];
for(const item of finalized){
 const {designKey:key,faces}=item;
 if(latestFingerprints.get(key)!==item.fingerprint){skippedKeys.push(key);continue;}
 for(const face of ['front','back']){
  const pair=pairs.find(pair=>pair.designKey===key)!;
  if(hash(await readFile(path.join(root,pair[face].sourcePath)))!==faces[face].masterSha256)throw new Error('Master changed during export');
  if(hash(await readFile(path.join(app,'public',faces[face].path.slice(1))))!==faces[face].sha256)throw new Error('Derivative changed during export');
 }
 after.layouts[key]=item.layout;after.atlases[item.atlasKey]=item.atlas;after.reverses[key]=item.reverse;
 after.reviewed[key]={front:{path:faces.front.path,sha256:faces.front.sha256},back:{path:faces.back.path,sha256:faces.back.sha256}};
 const assets={front:faces.front.path,back:faces.back.path,front320:faces.front.compactPath,back320:faces.back.compactPath};
 const line=`  ${JSON.stringify(key)}: ${JSON.stringify(assets)}`;
 const existing=new RegExp(`^  "${key}": .*$`,'m');
 if(existing.test(generated))generated=generated.replace(existing,line+',');
 else generated=generated.replace('\n};',',\n'+line+'\n};').replace(/,\s*,/g,',');
 previous.pairs[key]={...item,rendererVersion:CARD_RENDERER_VERSION,measurementVersion:'pair-source-measure-v1'};
 if(item.acceptanceManifest===TAILORING_ACCEPTANCE_FILE)previous.tailoringV2DesignKeys=[...new Set([...(previous.tailoringV2DesignKeys??[]),key])];
 installedKeys.push(key);
}
// All files and hashes exist before any installation index is made visible.
await publishIndexes();
console.log(JSON.stringify({acceptedComplete:latestFingerprints.size,changed:installedKeys.length,installed:Object.keys(previous.pairs).length,revoked,keys:installedKeys,skippedKeys}));
