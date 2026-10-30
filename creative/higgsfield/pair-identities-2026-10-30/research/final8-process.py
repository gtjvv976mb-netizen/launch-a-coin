"""Final8 ledger/download/proof helper. No provider calls. Acceptance is explicit after actual image QA."""
from pathlib import Path
import concurrent.futures,datetime,hashlib,io,json,sys,urllib.request
from PIL import Image,ImageDraw
b=Path(__file__).parent.parent;root=b.parents[2];lp=b/'generation-ledger-final.json';ledger=json.loads(lp.read_text());now=datetime.datetime.now(datetime.timezone.utc).isoformat()
plans=[json.loads(p.read_text())for p in [b/'ROOT-FINAL-FRONTS-PLAN.json',b/'ROOT-CRYPTO11-FLASH-BACKS-PLAN.json']if p.exists()];records={x[face]['index']:(x,face)for x in ledger['entries']for face in ['front','back']};known={}
for plan in plans:
 for batch in plan['batches']:
  rp=b/batch['receiptFile'];sp=b/batch['statusFile']
  if rp.exists():
   receipt=json.loads(rp.read_text());jobs=receipt.get('structuredContent',{}).get('jobs',[])
   for job in jobs:
    i=job['index']
    if i not in records:continue
    e,face=records[i];f=e[face];jid=job.get('job_id');assert jid
    if f.get('jobId'):assert f['jobId']==jid
    f.update(jobId=jid,status=job.get('status','submitted'),submissionReceipt=str(rp.relative_to(b)),batchId=batch['batchId']);known[jid]=i
  if sp.exists():
   status=json.loads(sp.read_text())
   for job in status.get('structuredContent',{}).get('jobs',[]):
    i=job['index']
    if i not in records:continue
    e,face=records[i];f=e[face];assert f.get('jobId')==job['job_id'];f.update(status=job['status'],statusReceipt=str(sp.relative_to(b)))
    if job.get('result_url'):f['resultUrl']=job['result_url']
# Count job IDs retained in ledger, never duplicate attempt receipts.
paid={f['jobId']for e in ledger['entries']for face in ['front','back']if(f:=e[face]).get('jobId')};ledger['paidSubmissions']=len(paid);ledger['quotedSubmittedCredits']=sum(e[face].get('quotedCredits',2.75)for e in ledger['entries']for face in ['front','back']if e[face].get('jobId'));ledger['unsubmittedBaselineReservedImages']=16-len(paid);ledger['unsubmittedBaselineReservedCredits']=sum(e[face].get('quotedCredits',2.75)for e in ledger['entries']for face in ['front','back']if not e[face].get('jobId'))
assert ledger['paidSubmissions']<=ledger['maximumSubmissions'] and ledger['quotedSubmittedCredits']<=ledger['maximumQuotedCredits']
originals=root/'output/higgsfield/pair-identities-2026-10-30/originals';originals.mkdir(parents=True,exist_ok=True)
def acquire(f):
 e,face=f;rec=e[face]
 if rec.get('status')!='completed' or not rec.get('resultUrl'):return
 path=originals/(f"{e['quoteKey']}-{face}.png"if face=='front'else f"{e['quoteKey']}-{face}-{rec['index']}.png")
 if path.exists()and rec.get('sha256'):
  assert hashlib.sha256(path.read_bytes()).hexdigest()==rec['sha256'];return
 req=urllib.request.Request(rec['resultUrl'],headers={'User-Agent':'LaunchACard authorized generated artwork master intake'})
 with urllib.request.urlopen(req,timeout=25) as r:
  data=r.read(40*1024*1024+1);assert len(data)<=40*1024*1024
 with Image.open(io.BytesIO(data))as im:im.verify()
 with Image.open(io.BytesIO(data))as im:assert im.format=='PNG';assert 1000<=im.width<=4096 and 1500<=im.height<=4096;dims=[im.width,im.height]
 digest=hashlib.sha256(data).hexdigest()
 if path.exists():assert path.read_bytes()==data,'Never overwrite different source master'
 else:path.write_bytes(data)
 rec.update(sourcePath=str(path.relative_to(root)),sha256=digest,bytes=len(data),dimensions=dims,format='PNG',cropApplied=False,foregroundBoundsCandidate=[0,0,*dims],boundsNote='Master retained uncropped. Canonical builder owns measured content mapping and final rounded normalization.',visualStatus=rec.get('visualStatus')if rec.get('visualStatus','').startswith('accepted')else'pending-actual-source-QA')
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as x:list(x.map(acquire,[(e,face)for e in ledger['entries']for face in ['front','back']]))
for plan in plans:
 for batch in plan['batches']:
  items=[records[i]for i in batch['indices']if i in records]
  if not items:continue
  if not all(e[face].get('sourcePath')for e,face in items):continue
  proof=b/batch['proofFile'];canvas=Image.new('RGB',(len(items)*470,1000),'#eee9df');d=ImageDraw.Draw(canvas)
  for n,(e,face)in enumerate(items):
   f=e[face];x0=n*470;d.text((x0+10,12),f"{e['quoteKey'].upper()} {face} / actual index{f['index']}",fill='#24201d');im=Image.open(root/f['sourcePath']).convert('RGB');im.thumbnail((440,660));canvas.paste(im,(x0+10+(440-im.width)//2,36));d.text((x0+10,745),'Exact identity input reference',fill='#24201d')
   ref=next(x for x in json.loads((b/'expansion-final-identity-briefs.json').read_text())['entries']if x['quoteKey']==e['quoteKey'])['generationReferencePaths']['identity'];im=Image.open(b/ref).convert('RGBA');im.thumbnail((180,180));panel=Image.new('RGBA',(180,180),'white');panel.alpha_composite(im,((180-im.width)//2,(180-im.height)//2));canvas.paste(panel.convert('RGB'),(x0+10,775));f['proof']=str(proof.relative_to(root))
  canvas.save(proof)
if len(sys.argv)>1:
 assert sys.argv[1]=='accept'
 for v in sys.argv[2:]:
  i=int(v);e,face=records[i];f=e[face];assert f['status']=='completed' and f.get('sha256')and f.get('proof');f.update(visualStatus='accepted-after-actual-source-QA',visualReviewedAt=now,visualReviewer='crypto_pair_research',visualCriteria='Exact supplied source identity, authentic lettering only, premium coherent materials, rounded thin print, unobstructed creator window, light live ink surfaces on front; continuous reverse with no empty panels.')
accepted=[];faces=[]
for e in ledger['entries']:
 pair={'quoteKey':e['quoteKey'],'designKey':e['proposedDesignKey'],'exactQuoteMint':e['exactQuoteMint']}
 for face in ['front','back']:
  f=e[face]
  if not f.get('visualStatus','').startswith('accepted'):continue
  rec={**pair,'face':face,**{k:f[k]for k in ['sourcePath','sha256','jobId','index','dimensions','format','cropApplied','foregroundBoundsCandidate','boundsNote','visualStatus','proof']}};pair[face]=rec;faces.append(rec)
 if 'front'in pair and'back'in pair:accepted.append(pair)
ledger.update(updatedAt=now,acceptedPairCount=len(accepted),acceptedFaceCount=len(faces));lp.write_text(json.dumps(ledger,indent=2)+'\n');(b/'accepted-pairs-final.json').write_text(json.dumps({'updatedAt':now,'scope':'Only actual inspected final8 complete pairs for canonical import; partial faces are not activatable.','acceptedPairCount':len(accepted),'acceptedFaceCount':len(faces),'acceptedPairs':accepted,'acceptedFaces':faces,'ledger':'generation-ledger-final.json'},indent=2)+'\n')
print(json.dumps({'knownPaid':len(paid),'quotedKnown':ledger['quotedSubmittedCredits'],'downloaded':sum(bool(e[f].get('sourcePath'))for e in ledger['entries']for f in ['front','back']),'acceptedPairs':len(accepted),'acceptedFaces':len(faces)}))
