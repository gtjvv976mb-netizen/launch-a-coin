#!/usr/bin/env python3
"""Freeze existing confirmed media references and unsubmitted two-front batches; no network or spend."""
import hashlib,json
from pathlib import Path
P=Path(__file__).resolve().parent;BASE=P.parent;ROOT=BASE.parents[2]
def rel(p):return str(p.relative_to(ROOT))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
plan=json.loads((P/'plan.json').read_text());media={};confirmed={};inputs=[P/'plan.json',BASE/'reference-media-confirmed-51.json',BASE/'generation-ledger-38.json',P/'pilot-2-request.json',BASE/'research/ansem-higher-source-followup.json']
for f in list(BASE.glob('extra-reference-confirmation*.json'))+[BASE/'extra-pilot/reference-confirmation.json']:
 inputs.append(f)
 for row in json.loads(f.read_text()).get('structuredContent',{}).get('results',[]):
  if row.get('status')=='uploaded':confirmed[row['media_id']]=rel(f)
for row in json.loads((BASE/'reference-media-confirmed-51.json').read_text())['assets']:
 if row.get('confirmed'):
  media[row['key']]={'mediaId':row['mediaId'],'uploadedReferencePath':row['referencePath'],'sha256':row['sha256'],'confirmationEvidence':rel(BASE/'reference-media-confirmed-51.json'),'confirmed':True}
for row in json.loads((BASE/'generation-ledger-38.json').read_text())['entries']:
 v=row['confirmedReference'];isconfirmed=bool(v.get('confirmed')) or v['mediaId'] in confirmed
 media[row['quoteKey']]={'mediaId':v['mediaId'],'uploadedReferencePath':v['path'],'sha256':v['sha256'],'confirmationEvidence':confirmed.get(v['mediaId'],rel(BASE/'generation-ledger-38.json')),'confirmed':isconfirmed}
ansem=json.loads((BASE/'research/ansem-higher-source-followup.json').read_text())['image'];refs={};requests=[]
pilot=json.loads((P/'pilot-2-request.json').read_text())['requests'];guideids={v['params']['medias'][0]['value'] for v in pilot};assert len(guideids)==1;guideid=next(iter(guideids));guide=plan['canonicalLayout']['files']['canonical-front-wireframe.png'];assert sha(ROOT/guide['path'])==guide['sha256']
for entry in plan['entries']:
 k=entry['quoteKey'];reference=entry['reference'];source=ROOT/reference['path'];assert sha(source)==reference['sha256']
 if k=='ansem':
  assert reference['sha256']==ansem['sha256'];m={'source':'autoimport-public-official-url','value':ansem['uri'],'sha256':ansem['sha256'],'referencePath':reference['path'],'confirmationEvidence':rel(BASE/'research/ansem-higher-source-followup.json'),'confirmedMediaId':False,'note':'Parent explicitly authorized exact official600px source URL; do not reuse stale80px mediaId.'}
 else:
  v=media[k];assert v['confirmed'] and v['sha256']==reference['sha256'],k;assert sha(ROOT/v['uploadedReferencePath'])==v['sha256'];m={'source':'reused-confirmed-mediaId','value':v['mediaId'],'referencePath':reference['path'],**v}
 refs[k]=m
 if k in ['pepe','fone']:continue
 index=401+len(requests);params={'model':'seedream_5_0_flash','resolution':'2k','aspect_ratio':'2:3','count':1,'medias':[{'role':'image','value':guideid},{'role':'image','value':m['value']}],'prompt':entry['frontPrompt']}
 requests.append({'index':index,'requestId':f'tailoring-v2-{k}-front','quoteKey':k,'designKey':entry['designKey'],'exactQuoteMint':entry['exactQuoteMint'],'face':'front','referenceSha256':reference['sha256'],'params':params})
assert len(refs)==62 and len(requests)==60
batches=[{'batchKey':f'meme-tailoring-v2-fronts-{i//2+1:03}','requests':requests[i:i+2],'status':'frozen but unsubmitted; parent quality/budget gate required'} for i in range(0,len(requests),2)]
base={'status':'PREPARED ONLY. No new uploads, paid calls, acceptance writes, asset changes or deployment.','planSha256':sha(P/'plan.json'),'frozenInputHashes':{rel(f):sha(f) for f in inputs},'guide':{**guide,'mediaId':guideid,'confirmationEvidence':rel(P/'pilot-2-request.json'),'note':'Same geometry-guide mediaId used as IMAGE1 in parent strict retry303/304.'},'mediaReferences':refs}
(P/'confirmed-media-map.json').write_text(json.dumps(base,indent=2)+'\n');frozen={'status':base['status'],'planSha256':base['planSha256'],'confirmedMediaMapSha256':sha(P/'confirmed-media-map.json'),'pilotIndicesExcluded':[301,302,303,304],'submissionGate':'BLOCKED pending parent strict retry303/304 aperture/grid pass. Never autoexecute this preparation.','remainingFrontCount':60,'batchSize':2,'batchCount':30,'estimatedCreditsAtParentVerifiedHalfCreditQuote':30,'spendingAuthorizedByThisFile':False,'batches':batches};(P/'remaining-front-batches.json').write_text(json.dumps(frozen,indent=2)+'\n')
print(json.dumps({'sourceReferences':len(refs),'confirmedExactReusedMediaIds':sum(v['source']=='reused-confirmed-mediaId' for v in refs.values()),'publicOfficialAutoimport':['ansem'],'remainingFronts':len(requests),'twoRequestBatches':len(batches),'guideMediaId':guideid,'frozenBatchesSha256':sha(P/'remaining-front-batches.json')},indent=2))
