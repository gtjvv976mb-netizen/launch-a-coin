/** Verify transparent source-only composition provenance; no artwork generation. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export async function verifyPairSourceDerivation(root:string,source:any){
 if(!source.derivation)return undefined;
 if(source.newGeneration!==false||source.countsAsNewPaidJob!==false)throw new Error('Source composition must explicitly exclude new paid generation');
 const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 async function pinned(record:any){
  const uri=record?.path,expected=record?.sha256;
  if(typeof uri!=='string'||!uri.startsWith('output/higgsfield/pair-identities-2026-10-30/')&&!uri.startsWith('creative/higgsfield/pair-identities-2026-10-30/')||!/^[a-f0-9]{64}$/.test(expected??''))throw new Error('Invalid source-composition input');
  const file=path.resolve(root,uri);if(!file.startsWith(path.resolve(root)+path.sep)||hash(await readFile(file))!==expected)throw new Error('Source-composition hash changed: '+uri);
  return {path:uri,sha256:expected,...(record.jobId?{jobId:record.jobId}:{})};
 }
 const derivation=await pinned(source.derivation);
 const document=JSON.parse(await readFile(path.join(root,derivation.path),'utf8'));
 const records:any[]=[];
 function collect(value:any){
  if(!value||typeof value!=='object')return;
  if(value.path&&value.sha256)records.push(value);
  for(const child of Object.values(value))collect(child);
 }
 collect(document);collect(source.reusedSourceJobs);
 const inputs=[];const seen=new Set<string>();
 for(const record of records){if(seen.has(record.path))continue;seen.add(record.path);inputs.push(await pinned(record));}
 if(!inputs.length)throw new Error('Source composition has no pinned input artwork');
 return {derivation,inputs,newGeneration:false as const};
}
