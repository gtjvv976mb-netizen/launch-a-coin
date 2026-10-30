from pathlib import Path
from PIL import Image, ImageDraw
import argparse, concurrent.futures, datetime, hashlib, json, shutil, subprocess

BASE = Path(__file__).resolve().parent
PROJECT = BASE.parents[2]
MASTERS = PROJECT / 'output/higgsfield/pair-identities-2026-10-30/originals'

def load(path):
    return json.loads(path.read_text())

def save(path, value):
    tmp=path.with_suffix(path.suffix+'.tmp'); tmp.write_text(json.dumps(value,indent=2)+'\n'); tmp.replace(path)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('batch'); ap.add_argument('--accept', default=''); args=ap.parse_args()
    stem=BASE/'batches'/args.batch; ledger=load(BASE/'generation-ledger-51.json')
    lookup={q['index']:(e,k,q) for e in ledger['entries'] for k,q in e.items() if isinstance(q,dict) and 'index' in q}
    receipt=load(Path(str(stem)+'-receipt.json'))['structuredContent']
    actual_request=Path(str(stem)+'-canonical-request.json')
    if not actual_request.exists(): actual_request=Path(str(stem)+'-request.json')
    request_items=load(actual_request).get('requests',[]) if actual_request.exists() else []
    request_params={x['index']:x['params'] for x in request_items}
    for j in receipt['jobs']:
        if j['index'] not in lookup: continue  # A root batch may contain another owner's final8 job.
        e,k,q=lookup[j['index']]; assert q.get('jobId') in (None,j['job_id'])
        model=request_params.get(j['index'],{}).get('model',q.get('model','gpt_image_2_5'))
        assert model in ['gpt_image_2_5','seedream_5_0_flash'], f'Unknown quoted model: {model}'
        unit_cost=0.5 if model=='seedream_5_0_flash' else 2.75
        q.update(jobId=j['job_id'],status=j['status'],model=model,quotedCredits=unit_cost,requestFile=str(actual_request.relative_to(PROJECT)),receiptFile=str(Path(str(stem)+'-receipt.json').relative_to(PROJECT)))
    jobids={q['jobId'] for e in ledger['entries'] for q in e.values() if isinstance(q,dict) and q.get('jobId')}
    costs={q['jobId']:q.get('quotedCredits',2.75) for e in ledger['entries'] for q in e.values() if isinstance(q,dict) and q.get('jobId')}
    ledger['paidSubmissions']=len(jobids); ledger['quotedSubmittedCredits']=sum(costs.values())
    assert len(jobids)+ledger.get('reservedUnknownImages',0)<=ledger['maximumSubmissions']
    assert ledger['quotedSubmittedCredits']+ledger.get('reservedUnknownQuotedCredits',0)<=ledger['maximumQuotedCredits']
    save(BASE/'generation-ledger-51.json',ledger)
    statuspath=Path(str(stem)+'-status.json')
    if not statuspath.exists():
        save(BASE/'generation-ledger-51.json',ledger)
        print(json.dumps({'paid':len(jobids),'credits':ledger['quotedSubmittedCredits'],'status':'awaiting-provider-status'})); return
    jobs=[j for j in load(statuspath)['structuredContent']['jobs'] if j['index'] in lookup]
    def deliver(j):
        e,k,q=lookup[j['index']]; face='front' if k.startswith('front') else 'back'; q['status']=j['status']; q['statusReceiptFile']=str(statuspath.relative_to(PROJECT))
        if j['status']!='completed' or not j.get('result_url'): return {'index':j['index'],'key':e['quoteKey'],'face':face,'status':j['status'],'downloaded':False}
        dest=MASTERS/f"{e['quoteKey']}-{face}.png"; url=j['result_url']; q['resultUrl']=url
        if q.get('masterPath') and (PROJECT/q['masterPath']).exists() and hashlib.sha256((PROJECT/q['masterPath']).read_bytes()).hexdigest()==q.get('masterSha256'):
            return {'index':j['index'],'key':e['quoteKey'],'face':face,'status':j['status'],'downloaded':True,'masterPath':q['masterPath']}
        tmp=dest.with_suffix('.png.download')
        r=subprocess.run(['curl','--ipv4','--silent','--show-error','--fail','--connect-timeout','25','--max-time','65','--retry','1','--retry-all-errors','--retry-max-time','100','--output',str(tmp),url],capture_output=True,text=True)
        if r.returncode: return {'index':j['index'],'key':e['quoteKey'],'face':face,'downloaded':False,'error':r.stderr[:250]}
        with Image.open(tmp) as im: im.verify()
        with Image.open(tmp) as im: assert im.format=='PNG'; dimensions=[im.width,im.height]
        for other in e.values():
            if isinstance(other,dict) and other.get('jobId')!=j['job_id'] and other.get('masterPath')==str(dest.relative_to(PROJECT)) and dest.exists():
                archive=dest.with_name(f"{e['quoteKey']}-{face}-superseded-index{other['index']}.png"); shutil.copyfile(dest,archive); other['masterPath']=str(archive.relative_to(PROJECT))
        tmp.replace(dest); q.update(masterPath=str(dest.relative_to(PROJECT)),masterSha256=hashlib.sha256(dest.read_bytes()).hexdigest(),dimensions=dimensions,bytes=dest.stat().st_size,format='PNG')
        return {'index':j['index'],'key':e['quoteKey'],'face':face,'status':j['status'],'downloaded':True,'masterPath':q['masterPath']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex: results=list(ex.map(deliver,jobs))
    proof_suffix='-original51-proof.png' if args.batch.startswith('crypto11-') else '-proof.png'
    delivery_suffix='-original51-deliveries.json' if args.batch.startswith('crypto11-') else '-deliveries.json'
    proof_path=Path(str(stem)+proof_suffix)
    accepted={int(i) for i in args.accept.split(',') if i}
    for index in accepted:
        e,k,q=lookup[index]; assert q.get('masterPath'); q['visualStatus']='accepted'; q['visualReviewFile']=str(proof_path.relative_to(PROJECT)); q['visualReviewedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        if k.startswith('back') and k!='back': e['acceptedBackField']=k
        if k.startswith('front') and k!='front': e['acceptedFrontField']=k
    refs={r['key']:r for r in load(BASE/'reference-media-confirmed-51.json')['assets']}
    board=Image.new('RGB',(460*len(results),960),'#eee9e0'); draw=ImageDraw.Draw(board)
    for i,x in enumerate(results):
        draw.text((i*460+10,10),f"{x['key'].upper()} {x['face']} / actual index{x['index']}",fill='#181410')
        if x['downloaded']:
            with Image.open(PROJECT/x['masterPath']) as im:
                im=im.convert('RGB'); im.thumbnail((440,710),Image.Resampling.LANCZOS); board.paste(im,(i*460+10,36))
        else: draw.text((i*460+10,90),'NO ACCEPTED IMAGE: '+x.get('status','download failed'),fill='#983d31')
        draw.text((i*460+10,752),'Exact identity input reference',fill='#181410')
        if x['key'] in refs:
            with Image.open(PROJECT/refs[x['key']]['referencePath']) as ref:
                ref=ref.convert('RGBA'); bg=Image.new('RGBA',ref.size,'white'); bg.alpha_composite(ref); ref=bg.convert('RGB'); ref.thumbnail((420,170),Image.Resampling.LANCZOS); board.paste(ref,(i*460+10,775))
    board.save(proof_path)
    Path(str(stem)+delivery_suffix).write_text(json.dumps(results,indent=2)+'\n')
    save(BASE/'generation-ledger-51.json',ledger)
    print(json.dumps({'paid':len(jobids),'credits':ledger['quotedSubmittedCredits'],'deliveries':results,'proof':str(proof_path)}))

if __name__=='__main__': main()
