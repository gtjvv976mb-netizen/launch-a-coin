"""Offline known-job lease bookkeeping only; no network or paid calls.
Root permits one paid writer, two jobs/call and at most two acknowledged batches.
"""
import datetime,json,sys
from pathlib import Path
P=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text())
def save(p,d):
    t=p.with_name(p.name+'.tmp');t.write_text(json.dumps(d,indent=2));t.replace(p)
def main():
    op,batch=sys.argv[1:3];path=P/'generation-batch-lease.json';old=read(path);stem=P/'batches'/batch
    active=old.get('activeBatches')
    if active is None:
        active=[{k:old[k]for k in ['batchId','status','jobs']if k in old}]if old['status']=='active'else[]
    if op=='acquire':
        assert old['status']!='submitting','Previous paid call has no acknowledged receipt yet'
        assert len(active)<2 and sum(len(x.get('jobs',[]))for x in active)<=2
        assert all(x['status']=='active'and all(j.get('job_id')for j in x['jobs'])for x in active)
        assert not Path(str(stem)+'-receipt.json').exists(),'Existing outcome must be recovered, never resubmitted'
        request=read(Path(str(stem)+'-request.json'));ledger=read(P/'generation-ledger-51.json');lookup={v['index']:v for e in ledger['entries']for v in e.values()if isinstance(v,dict)and'index'in v}
        n=len(request['requests']);assert 1<=n<=2
        assert ledger['paidSubmissions']+ledger.get('reservedUnknownImages',0)+n<=ledger['maximumSubmissions']
        assert ledger['quotedSubmittedCredits']+ledger.get('reservedUnknownQuotedCredits',0)+n*2.75<=ledger['maximumQuotedCredits']
        for r in request['requests']:
            assert not lookup[r['index']].get('jobId'),'Already submitted index'
            assert lookup[r['index']].get('status')!='submission-outcome-unknown','Quarantined unknown index'
            assert all(m['role']=='image'for m in r['params']['medias'])
        active.append({'batchId':batch,'status':'submitting','maximumJobs':n,'jobs':[],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
        old.update(owner='extra_pair_art',scope='original51',status='submitting',batchId=batch,activeBatches=active,maximumKnownInFlightJobs=4,maximumImagesPerCall=2)
    else:
        item=next((x for x in active if x['batchId']==batch),None)
        if item is None and old.get('batchId')==batch:item={'batchId':batch,'status':old['status'],'jobs':old.get('jobs',[])};active.append(item)
        assert item is not None,(batch,active)
        data=read(Path(str(stem)+('-receipt.json'if op=='active'else'-status.json')))['structuredContent']
        if op=='active':
            assert 1<=len(data['jobs'])<=2 and all(j.get('job_id')for j in data['jobs'])
            item.update(status='active',jobs=data['jobs'])
        else:
            assert data['all_terminal'];active.remove(item)
            old.setdefault('completedBatchLeases',[]).append({'batchId':batch,'terminalAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
        old.update(activeBatches=active,status='active'if active else'terminal',jobs=[j for x in active for j in x['jobs']]if active else data['jobs'])
        old['batchId']=active[-1]['batchId']if active else batch
        assert sum(len(x['jobs'])for x in active)<=4
    save(path,old);print(batch,op,'known in flight',sum(len(x.get('jobs',[]))for x in active))
if __name__=='__main__':main()
