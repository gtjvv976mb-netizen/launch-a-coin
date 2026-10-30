/** Whole-pair source selection. A pending revision never replaces one face of an active pair. */
export const PAIR_ACCEPTANCE_FILES=['accepted-pairs-51.json','accepted-pairs-38.json','accepted-pairs-final.json','accepted-pairs-tailoring-v2.json'] as const;
export const TAILORING_ACCEPTANCE_FILE='accepted-pairs-tailoring-v2.json';
export const OPTIONAL_PAIR_ACCEPTANCE_FILES=new Set<string>(['accepted-pairs-final.json',TAILORING_ACCEPTANCE_FILE]);
export type AcceptanceLayer={fileName:string;data:{acceptedPairs:any[];revokedDesignKeys?:string[];[key:string]:unknown}};

export function previouslyInstalledTailoringKeys(provenance:any):string[]{
 const keys=new Set<string>(provenance.tailoringV2DesignKeys??[]);
 for(const group of [provenance.pairs,provenance.retired])for(const [key,row] of Object.entries(group??{})){
  if((row as any).acceptanceManifest===TAILORING_ACCEPTANCE_FILE)keys.add((row as any).designKey??key.split('@')[0]);
 }
 return [...keys];
}

export function selectAcceptedPairs(layers:AcceptanceLayer[],previouslyTailoredKeys:Iterable<string>=[]){
 const accepted=new Map<string,any>(),tailored=new Set<string>(),revoked=new Set<string>();
 // The explicit revision layer always wins even when a caller supplies layers out of order.
 const ordered=[...layers].sort((a,b)=>Number(a.fileName===TAILORING_ACCEPTANCE_FILE)-Number(b.fileName===TAILORING_ACCEPTANCE_FILE));
 for(const {fileName,data} of ordered){
  if(!Array.isArray(data.acceptedPairs))throw new Error('Missing complete acceptedPairs array: '+fileName);
  const seen=new Set<string>();
  for(const pair of data.acceptedPairs){
   if(!pair.designKey||seen.has(pair.designKey))throw new Error('Duplicate or missing accepted design: '+fileName);
   seen.add(pair.designKey);
   for(const face of ['front','back']){
    const source=pair[face];
    if(!source?.visualStatus?.startsWith('accepted')||source.designKey!==pair.designKey||source.exactQuoteMint!==pair.exactQuoteMint||source.face!==face)throw new Error('Incomplete or unreviewed accepted pair: '+pair.designKey+' in '+fileName);
   }
   if(accepted.has(pair.designKey)&&fileName!==TAILORING_ACCEPTANCE_FILE)throw new Error('Duplicate baseline accepted pair: '+pair.designKey);
   accepted.set(pair.designKey,{...pair,acceptanceManifest:fileName});
   if(fileName===TAILORING_ACCEPTANCE_FILE)tailored.add(pair.designKey);
  }
  if(fileName===TAILORING_ACCEPTANCE_FILE){
   if(data.revokedDesignKeys!==undefined&&!Array.isArray(data.revokedDesignKeys))throw new Error('Invalid v2 revocation list');
   for(const key of data.revokedDesignKeys??[]){if(typeof key!=='string'||!key.startsWith('pair-'))throw new Error('Invalid v2 revoked design');revoked.add(key);}
  }
 }
 // A v2 pair removed after installation is quarantined. Do not resurrect generic
 // legacy artwork merely because its original acceptance file still exists.
 for(const key of previouslyTailoredKeys)if(!tailored.has(key))revoked.add(key);
 for(const key of revoked){accepted.delete(key);tailored.delete(key);}
 return {accepted,tailoredDesignKeys:[...tailored],blockedDesignKeys:[...revoked]};
}
