"""Publish accepted master metadata only; canonical normalization belongs to the root."""
import json,datetime,hashlib
from pathlib import Path
from PIL import Image
import numpy as np
P=Path(__file__).resolve().parent
ROOT=P.parents[2]
d=json.loads((P/'generation-ledger-38.json').read_text());pairs=[];faces=[]
for e in d['entries']:
 accepted={}
 for face in ['front','back']:
  f=e[face];status=f.get('visualReview',{}).get('status','')
  if status.startswith('accepted') and f.get('status')=='completed' and f.get('originalPath'):
   path=ROOT/f['originalPath'];im=Image.open(path);sha=hashlib.sha256(path.read_bytes()).hexdigest();assert sha==f['sha256'];rgb=np.asarray(im.convert('RGB'));ys,xs=np.nonzero(rgb.min(axis=2)<240);bounds=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None
   item={'quoteKey':e['quoteKey'],'designKey':e['proposedDesignKey'],'exactQuoteMint':e['exactQuoteMint'],'face':face,'sourcePath':str(path.relative_to(ROOT)),'sha256':sha,'jobId':f['jobId'],'index':f['index'],'dimensions':list(im.size),'format':im.format,'cropApplied':False,'foregroundBoundsCandidate':bounds,'boundsNote':'Machine threshold minRGB<240; crop proposal only. Root canonical builder owns final card crop/normalization.','visualStatus':status,'proof':f['visualReview'].get('proof')};faces.append(item);accepted[face]=item
 if len(accepted)==2:pairs.append({'quoteKey':e['quoteKey'],'designKey':e['proposedDesignKey'],'exactQuoteMint':e['exactQuoteMint'],**accepted})
report={'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Progressive actual accepted extra38 source masters only; incomplete, rejected and superseded faces excluded.','acceptedPairCount':len(pairs),'acceptedFaceCount':len(faces),'acceptedPairs':pairs,'acceptedFaces':faces,'ledger':'generation-ledger-38.json'};temp=P/'accepted-pairs-38.json.tmp';temp.write_text(json.dumps(report,indent=2));temp.replace(P/'accepted-pairs-38.json');print(len(pairs),'accepted pairs,',len(faces),'accepted faces')
