/** Read actual pinned files and preserve original48 SVG golden output. No transactions/network. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {renderToStaticMarkup} from 'react-dom/server';
import {CanonicalSkinSurface} from '../src/components/carddex/CanonicalCardSkin';
import {ACTIVE_PAIR_DESIGNS,STAGED_PAIR_DESIGNS} from '../src/lib/carddex/pair-designs';
import {CARD_GENERATED_ASSETS} from '../src/lib/carddex/generated-assets';
import layouts from '../src/lib/carddex/generated-layouts.json';
import atlases from '../src/lib/carddex/render-assets.json';
import reverses from '../src/lib/carddex/token-back-assets.json';
import reviewed from '../../integrations/pumpfun/src/design-assets.json';
import baseline from '../../output/higgsfield/pair-identities-2026-10-30/canonical-before.json';
import {PAIR_ACCEPTANCE_FILES,OPTIONAL_PAIR_ACCEPTANCE_FILES,previouslyInstalledTailoringKeys,selectAcceptedPairs,type AcceptanceLayer} from './lib/pair-acceptance';
import {verifyPairSourceDerivation} from './lib/pair-source-derivation';
const app=path.resolve(import.meta.dir,'..'),root=path.resolve(app,'..');
const digest=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
let pinnedFiles=0;const failures:string[]=[];
async function pinned(uri:string,expected:string){pinnedFiles++;const actual=digest(await readFile(path.join(app,'public',uri.slice(1))));if(actual!==expected)failures.push(uri);}
for(const item of Object.values(reviewed))for(const face of ['front','back'] as const)await pinned(item[face].path,item[face].sha256);
for(const item of Object.values(atlases)){await pinned(item.path,item.sha256);await pinned(item.previewPath,item.previewSha256);}
for(const item of Object.values(reverses))await pinned(item.path,item.sha256);
for(const row of baseline){const source=renderToStaticMarkup(CanonicalSkinSurface({cardTemplate:row.key,id:'regression',sourceUri:'data:image/png;base64,source'}));if(digest(source)!==row.hash)failures.push('legacy-svg:'+row.key);}
const provenance=JSON.parse(await readFile(path.join(root,'creative/higgsfield/pair-identities-2026-10-30/integration-provenance.json'),'utf8'));
const layers:AcceptanceLayer[]=[];
for(const fileName of PAIR_ACCEPTANCE_FILES){
 let bytes:string;try{bytes=await readFile(path.join(root,'creative/higgsfield/pair-identities-2026-10-30',fileName),'utf8');}
 catch(error){if(OPTIONAL_PAIR_ACCEPTANCE_FILES.has(fileName)&&(error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
 layers.push({fileName,data:JSON.parse(bytes)});
}
const {accepted,blockedDesignKeys}=selectAcceptedPairs(layers,previouslyInstalledTailoringKeys(provenance));
for(const design of ACTIVE_PAIR_DESIGNS){
 const row=provenance.pairs[design.key];if(!row||row.quoteMint!==design.quoteMint)throw new Error('Missing exact identity provenance: '+design.key);
 const current=accepted.get(design.key);
 if(!current||current.exactQuoteMint!==design.quoteMint||!current.front?.visualStatus?.startsWith('accepted')||!current.back?.visualStatus?.startsWith('accepted')||current.front.sha256!==row.faces.front.masterSha256||current.back.sha256!==row.faces.back.masterSha256)failures.push('current-source-acceptance:'+design.key);
 for(const face of ['front','back']){
  const data=row.faces[face];await pinned(data.compactPath,data.compactSha256);
  if(digest(await readFile(path.join(root,data.masterPath)))!==data.masterSha256)failures.push('master:'+design.key+':'+face);
  if(!data.jobId)failures.push('generation-job:'+design.key+':'+face);
  if(current?.[face]?.derivation){
   const evidence=await verifyPairSourceDerivation(root,current[face]);
   if(JSON.stringify(data.sourceCompositionEvidence)!==JSON.stringify(evidence)||data.newGeneration!==false||data.countsAsNewPaidJob!==false)failures.push('source-composition-provenance:'+design.key+':'+face);
  }
 }
 const layout=(layouts as Record<string,any>)[design.key];
 if(Object.keys(layout.prints).sort().join()!=='name,text,type')failures.push('unexpected-footer:'+design.key);
 if(Object.values(row.lightSurfaceSamples as Record<string,{p10:number}>).some(sample=>sample.p10<145))failures.push('dark-print-surface:'+design.key);
 if(!(CARD_GENERATED_ASSETS as Record<string,unknown>)[design.key])failures.push('missing-assets:'+design.key);
}
const report={staged:STAGED_PAIR_DESIGNS.length,active:ACTIVE_PAIR_DESIGNS.length,acceptedComplete:accepted.size,blockedDesignKeys,pendingComplete:[...accepted.keys()].filter(key=>!ACTIVE_PAIR_DESIGNS.some(design=>design.key===key)),legacySources:Object.keys(reviewed).filter(k=>!k.startsWith('pair-')).length,legacyAtlases:Object.keys(atlases).filter(k=>!k.startsWith('pair-')).length,legacyReverses:Object.keys(reverses).filter(k=>!k.startsWith('pair-')).length,legacySvgGoldenChecks:baseline.length,pinnedFiles,failures};
await writeFile(path.join(root,'output/higgsfield/pair-identities-2026-10-30/integration/asset-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);if(failures.length)process.exit(1);
