from pathlib import Path
import argparse, json

BASE=Path(__file__).resolve().parent
PROJECT=BASE.parents[2]
OUT=PROJECT/'output/higgsfield/pair-identities-2026-10-30'

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('batch'); ap.add_argument('faces',nargs='+'); args=ap.parse_args()
    assert 1<=len(args.faces)<=2
    d=json.loads((BASE/'generation-ledger-51.json').read_text())
    refs=json.loads((BASE/'pilot/reference-media-confirmed.json').read_text())['keyToMediaId']
    for filename in ['broker-first6-confirmed-map.json','broker-remaining39-confirmed-map.json','broker-final2-confirmed-map.json']:
        for x in json.loads((OUT/filename).read_text()): refs[x['key']]=x['mediaId']
    rr=[]
    for item in args.faces:
        key,face=item.split(':'); assert face in ['front','back','frontCorrection','backCorrection']; e=next(x for x in d['entries'] if x['quoteKey']==key); q=e[face]; assert not q.get('jobId'),f'Already submitted {item}'; assert q.get('status')!='submission-outcome-unknown',f'Quarantined unknown {item}'
        p=dict(d['modelParams']); p['prompt']=q['prompt']
        if q.get('replacementReferences'): ids=q['replacementReferences']
        elif face=='front': ids=[refs['construction-front'],refs[key]]
        else:
            f=e[e.get('acceptedFrontField','front')]; assert str(f.get('visualStatus','')).startswith('accepted'),f'Front not visually accepted: {key}'; ids=[f['jobId'],refs[key],refs['construction-back']]
        p['medias']=[{'role':'image','value':i} for i in ids]; rr.append({'index':q['index'],'params':p})
    assert d['paidSubmissions']+d.get('reservedUnknownImages',0)+len(rr)<=d['maximumSubmissions']
    assert d['quotedSubmittedCredits']+d.get('reservedUnknownQuotedCredits',0)+len(rr)*2.75<=d['maximumQuotedCredits']
    dest=BASE/'batches'/f'{args.batch}-request.json'; assert not dest.exists(),f'Request already exists: {dest}'; dest.write_text(json.dumps({'requests':rr},indent=2)+'\n')
    print(json.dumps({'path':str(dest.relative_to(PROJECT)),'indices':[r['index'] for r in rr],'images':len(rr),'quotedCredits':2.75*len(rr),'faces':args.faces}))

if __name__=='__main__':main()
