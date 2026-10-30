"""Offline ledgers and proofs only. Paid generation runs exclusively via connected Higgsfield tools."""
import json,sys,datetime,hashlib,subprocess,concurrent.futures
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
P=Path(__file__).resolve().parent
ROOT=P.parents[2]
# P=project/creative/higgsfield/pair-identities-date; project root is parents[2].
LEDGER=P/'generation-ledger-38.json'
OUT=ROOT/'output/higgsfield/pair-identities-2026-10-30'
def read(p):return json.loads(p.read_text())
def write(p,d):
 temp=p.with_name(p.name+'.tmp');temp.write_text(json.dumps(d,indent=2));temp.replace(p)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def fields(d):
 for e in d['entries']:
  for face in ['front','back']:yield e,face,e[face]
 for c in d.get('corrections',[]):yield next(e for e in d['entries']if e['quoteKey']==c['quoteKey']),'correction',c
def counts(d):
 ids={f['jobId']for e,face,f in fields(d)if f.get('jobId')}
 for e in d['entries']:
  for face in ['front','back']:
   for old in e[face].get('priorVersions',[]):
    if old.get('jobId'):ids.add(old['jobId'])
 d['paidSubmissions']=len(ids);d['quotedSubmittedCredits']=len(ids)*2.75
 reserved=sum(x.get('maximumPotentialImages',0)for x in d.get('pendingUnknownSubmissions',[])if x.get('recoveryRequiredBeforeRetry'))
 d['reservedUnknownImages']=reserved;d['reservedUnknownQuotedCredits']=reserved*2.75
 assert len(ids)+reserved<=d['maximumSubmissions'] and d['quotedSubmittedCredits']+reserved*2.75<=d['maximumQuotedCredits']
def prepare(batch,n=2):
 assert 1<=n<=2,'Root reduced all future paid batches to two jobs maximum after transport failures'
 d=read(LEDGER);lease=P/'generation-batch-lease.json';quarantined=read(lease).get('quarantinedBatches',[])if lease.exists()else[]
 if lease.exists():assert read(lease).get('status')in ['terminal','rejected','idle','released','quarantined-unknown'],read(lease)
 candidates=[]
 for c in d.get('corrections',[]):
  if not c.get('jobId')and c.get('status')=='prepared':candidates.append((next(e for e in d['entries']if e['quoteKey']==c['quoteKey']),'correction'))
 for e in d['entries']:
  if not e.get('generationBlocked') and not e['back'].get('jobId') and e['back'].get('status')!='submission-outcome-unknown'and e['front'].get('status')=='completed':candidates.append((e,'back'))
 for e in d['entries']:
  if not e['front'].get('jobId')and e['front'].get('status')!='submission-outcome-unknown':candidates.append((e,'front'))
 req=[]
 for e,face in candidates[:n]:
  f=next(c for c in d['corrections']if c['quoteKey']==e['quoteKey']and not c.get('jobId')and c.get('status')=='prepared')if face=='correction'else e[face];medias=[{'role':'image','value':'22e58a58-0eca-4a2d-889f-c28a8b121ea0'},{'role':'image','value':e['confirmedReference']['mediaId']}]
  if face=='correction':medias=[{'role':'image','value':f['replacesJobId']},{'role':'image','value':'22e58a58-0eca-4a2d-889f-c28a8b121ea0'if f['face']=='front'else e['front']['jobId']},{'role':'image','value':e['confirmedReference']['mediaId']}]
  if face=='correction'and f.get('replacementReferences'):medias=f['replacementReferences']
  if face=='back':medias=[{'role':'image','value':e['front']['jobId']},{'role':'image','value':e['confirmedReference']['mediaId']},{'role':'image','value':'8b191aa7-1070-43c4-9622-7d5a65508019'}]
  req.append({'index':f['index'],'params':{'model':'gpt_image_2_5','variant':'flare','quality':'high','resolution':'2k','aspect_ratio':'2:3','count':1,'medias':medias,'prompt':f['prompt']}})
 assert req
 write(P/(batch+'-request.json'),{'requests':req});write(lease,{'owner':'extra_pair_art','status':'submitting','batchId':batch,'maximumJobs':n,'createdAt':now(),'quarantinedBatches':quarantined});print(json.dumps({'batchId':batch,'indices':[x['index']for x in req]}))
def submitted(batch):
 r=read(P/(batch+'-submission.json'));d=read(LEDGER);jobs=r.get('structuredContent',{}).get('jobs',[])
 for j in jobs:
  e,face,f=next(t for t in fields(d)if t[2]['index']==j['index']);f.update(j);f['receiptFile']=batch+'-submission.json';f['submittedAt']=now()
  if j.get('job_id'):f['jobId']=j['job_id'];f['quotedCredits']=2.75
 counts(d);write(LEDGER,d);lease=read(P/'generation-batch-lease.json');assert lease['owner']=='extra_pair_art';lease.update({'status':'active'if any(x.get('job_id')for x in jobs)else'rejected','jobs':jobs});write(P/'generation-batch-lease.json',lease);print(json.dumps({'jobs':d['paidSubmissions'],'credits':d['quotedSubmittedCredits'],'newJobs':[(j['index'],j['status'])for j in jobs]}))
def collect(batch):
 r=read(P/(batch+'-status.json'));d=read(LEDGER);jobs=r.get('structuredContent',{}).get('jobs',[]);OUT.mkdir(parents=True,exist_ok=True);(OUT/'originals').mkdir(exist_ok=True)
 def download(t):
  e,face,f,j=t
  if not j.get('result_url'):return
  filename=e['quoteKey']+'-'+(f['face']+'-revision'+str(f['index'])if face=='correction'else face)+'.png';path=OUT/'originals'/filename
  if not path.exists():subprocess.run(['curl','--fail','--silent','--show-error','--connect-timeout','25','--max-time','120',j['result_url'],'--output',str(path)],check=True)
  im=Image.open(path);im.verify();return str(path.relative_to(ROOT)),hashlib.sha256(path.read_bytes()).hexdigest(),path.stat().st_size,Image.open(path).size
 tasks=[]
 for j in jobs:
  e,face,f=next(t for t in fields(d)if t[2]['index']==j['index']);f.update(j)
  if j['status']=='completed'and not f.get('originalPath'):tasks.append((e,face,f,j))
 with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
  for task,result in zip(tasks,pool.map(download,tasks)):
   if result:
    e,face,f,j=task;f.update({'originalPath':result[0],'sha256':result[1],'bytes':result[2],'dimensions':result[3]})
    if face=='correction':
     target=f['face'];old=dict(e[target]);prior=old.pop('priorVersions',[]);e[target]={**f,'priorVersions':prior+[old],'correctedFrom':old['jobId'],'index':f['index']};f['installedAsAcceptedFace']=True
     if target=='front':e['generationBlocked']=False
    print(e['quoteKey'],face,result[2],flush=True)
 counts(d);write(LEDGER,d)
 if r.get('structuredContent',{}).get('all_terminal'):
  lease=read(P/'generation-batch-lease.json');assert lease['owner']=='extra_pair_art';lease.update({'status':'terminal','finishedAt':now(),'jobs':jobs});write(P/'generation-batch-lease.json',lease)
  d.setdefault('completedBatches',[])
  if batch not in d['completedBatches']:d['completedBatches'].append(batch)
  write(LEDGER,d)
def proof(batch):
 d=read(LEDGER);r=read(P/(batch+'-status.json'));keys=[]
 for j in r['structuredContent']['jobs']:
  e,face,f=next(t for t in fields(d)if t[2]['index']==j['index'])
  if e['quoteKey']not in keys:keys.append(e['quoteKey'])
 width=1120;row=540;im=Image.new('RGB',(width,row*len(keys)),'#eee8dc');draw=ImageDraw.Draw(im);font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22)
 for i,key in enumerate(keys):
  e=next(x for x in d['entries']if x['quoteKey']==key);y=i*row;draw.text((20,y+12),e['symbol']+' — EXACT SOURCE / FRONT / BACK',fill='#26211c',font=font)
  src=ImageOps.contain(Image.open(P/e['referencePath']).convert('RGBA'),(240,380),Image.Resampling.LANCZOS);base=Image.new('RGBA',src.size,'#eee8dc');base.alpha_composite(src);im.paste(base.convert('RGB'),(20+(240-src.width)//2,y+90+(380-src.height)//2))
  for j,face in enumerate(['front','back']):
   f=e[face];path=ROOT/f['originalPath']if f.get('originalPath')else None
   if path:
    a=Image.open(path).convert('RGB');a.thumbnail((375,480));im.paste(a,(280+j*410,y+47))
   else:draw.text((300+j*410,y+230),'Not generated yet',fill='#71675b',font=font)
 path=OUT/(batch+'-proof.jpg');im.save(path,quality=94);print(path)
def accept(batch,indices=None):
 d=read(LEDGER);r=read(P/(batch+'-status.json'));accepted=[]
 for j in r['structuredContent']['jobs']:
  if indices is not None and j['index'] not in indices:continue
  if j['status']!='completed':continue
  e,face,f=next(t for t in fields(d)if t[2]['index']==j['index'])
  if not f.get('originalPath'):continue
  f['visualReview']={'status':'accepted-by-subagent','proof':'output/higgsfield/pair-identities-2026-10-30/'+batch+'-proof.jpg','scope':'Actual source and generated front/back visually compared; recognizable exact identity, clear shared front fields, coherent materials and contained rounded print. Canonical/browser QA separate.'}
  accepted.append((e['quoteKey'],face))
 write(LEDGER,d);print(json.dumps(accepted))
if __name__=='__main__':
 op=sys.argv[1];batch=sys.argv[2]
 if op=='prepare':prepare(batch,int(sys.argv[3])if len(sys.argv)>3 else 2)
 elif op=='submitted':submitted(batch)
 elif op=='collect':collect(batch)
 elif op=='proof':proof(batch)
 elif op=='accept':accept(batch,{int(x)for x in sys.argv[3].split(',')}if len(sys.argv)>3 else None)
