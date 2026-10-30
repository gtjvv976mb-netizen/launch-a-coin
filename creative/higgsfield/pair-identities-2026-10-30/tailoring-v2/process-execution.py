"""Root is sole paid writer. Adopt actual receipts and download/prove only v2 jobs; explicit native visual acceptance."""
from pathlib import Path
import concurrent.futures,datetime,hashlib,io,json,sys,urllib.request
from PIL import Image,ImageDraw,ImageChops
v=Path(__file__).parent;base=v.parent;root=base.parents[2];lp=v/'generation-ledger.json';ledger=json.loads(lp.read_text());now=datetime.datetime.now(datetime.timezone.utc).isoformat();by={e['quoteKey']:e for e in ledger['entries']};indices={301:('pepe','front'),302:('fone','front'),303:('pepe','front'),304:('fone','front'),305:('pepe','back'),306:('fone','back'),307:('fone','back'),701:('agency','front'),817:('michi','back'),818:('moodeng','back')}
for f in ['remaining-front-batches.json','remaining-back-batches.json']:
 p=v/f
 if p.exists():
  for b in json.loads(p.read_text()).get('batches',[]):
   for r in b.get('requests',[]):
    indices[r['index']]=(r['quoteKey'],r.get('face','front'if'front'in f else'back'))
    if 'front'in f:indices[r['index']+100]=(r['quoteKey'],'back')
for planPath in v.glob('ROOT-*-PLAN.json'):
 planData=json.loads(planPath.read_text())
 for r in planData.get('keyMap',[]):
  if r.get('quoteKey') in by and r.get('face') in ['front','back']:indices[r['index']]=(r['quoteKey'],r['face'])
# Preserve every prior attempt and merge by actual job ID; never count repeated receipt reads as paid work.
allattempts={(str(a.get('jobId')or a.get('job_id'))+'::derived::'+a['quoteKey']+'::'+a['face']if not a.get('countsAsNewPaidJob',True)else a.get('jobId')or a.get('job_id')):a for e in ledger['entries']for face in ['front','back']for a in e[face]['attempts']}
unmapped=[]
receiptPaths=list(v.rglob('*-receipt.json'))+[base/'batches/michi-exact-source-817-receipt.json',base/'batches/moodeng-caption-818-receipt.json']
for rp in sorted(p for p in receiptPaths if p.exists()):
 o=json.loads(rp.read_text());requestsPath=rp.with_name(rp.name.replace('-receipt.json','-request.json'));request={}
 if requestsPath.exists():request={r['index']:r for r in json.loads(requestsPath.read_text()).get('requests',[])}
 sp=rp.with_name(rp.name.replace('-receipt.json','-status.json'));statuses={}
 if sp.exists():statuses={j['index']:j for j in json.loads(sp.read_text()).get('structuredContent',{}).get('jobs',[])}
 for j in o.get('structuredContent',{}).get('jobs',[]):
  i=j['index'];jid=j['job_id'];req=request.get(i,{});pair=(req.get('quoteKey'),req.get('face'))if req.get('quoteKey')and req.get('face')else indices.get(i)
  if not pair:unmapped.append({'index':i,'jobId':jid,'receipt':str(rp.relative_to(base))});continue
  k,face=pair;f=by[k][face];a=allattempts.get(jid)
  if a is None:a={'index':i,'quoteKey':k,'face':face,'jobId':jid,'quotedCredits':0.5,'visualStatus':'not-reviewed'};f['attempts'].append(a);allattempts[jid]=a
  a.update(status=j['status'],receiptFile=str(rp.relative_to(base)),requestFile=str(requestsPath.relative_to(base)),requestParams=req.get('params',a.get('requestParams')))
  if i in statuses:
   s=statuses[i];assert s['job_id']==jid;a.update(status=s['status'],statusFile=str(sp.relative_to(base)))
   if s.get('result_url'):a['resultUrl']=s['result_url']
  # Historical first-pilot index301/302 recorded source paths remain unchanged.
  if a.get('result_url')and not a.get('resultUrl'):a['resultUrl']=a['result_url']
originals=root/'output/higgsfield/pair-identities-2026-10-30/originals/tailoring-v2';originals.mkdir(parents=True,exist_ok=True)
def get(a):
 if a.get('status')!='completed'or not a.get('resultUrl'):return
 priorPath=root/a['sourcePath']if a.get('sourcePath')else None
 if priorPath and priorPath.exists()and a.get('sha256'):
  assert hashlib.sha256(priorPath.read_bytes()).hexdigest()==a['sha256'];return
 known=root/f"output/higgsfield/pair-identities-2026-10-30/tailoring-v2/pilot-{a['face']}-{a['index']}.png"
 expected=originals/f"{a['quoteKey']}-{a['face']}-{a['index']}.png"
 if expected.exists():data=expected.read_bytes()
 elif known.exists():data=known.read_bytes()
 elif a['face']=='back' and 501<=a['index']<=530:
  return # Root owns atomic bulk-back downloads; adopt only once the master exists.
 else:
  req=urllib.request.Request(a['resultUrl'],headers={'User-Agent':'LaunchACard authorized generated-master QA intake'})
  with urllib.request.urlopen(req,timeout=25)as r:data=r.read(40*1024*1024+1);assert len(data)<=40*1024*1024
 with Image.open(io.BytesIO(data))as im:im.verify()
 with Image.open(io.BytesIO(data))as im:fmt=im.format;dims=[im.width,im.height];assert fmt in ['PNG','JPEG','WEBP']and min(dims)>=1000
 ext={'PNG':'png','JPEG':'jpg','WEBP':'webp'}[fmt];p=originals/f"{a['quoteKey']}-{a['face']}-{a['index']}.{ext}"
 if p.exists():assert p.read_bytes()==data,'Preserve existing different source master'
 else:p.write_bytes(data)
 a.update(sourcePath=str(p.relative_to(root)),sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),dimensions=dims,format=fmt,cropApplied=False,foregroundBoundsCandidate=[0,0,*dims],boundsNote='Native master retained unchanged. Canonical content-map/crop and shared rounded mask are independently verified by asset pipeline.')
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as ex:list(ex.map(get,list(allattempts.values())))
rejects={301:'Large Pepe hero occupies creator aperture.',302:'Four large monkeys invade safe content, split header and displaced grid.',306:'Invented empty laurel, royal star and crown/crest at upper edge violate specific source frame and no generic ornament requirement.',403:'Missing narrow ticker/type writing strip; only3 content panels.',409:'Bicycle-spoke lines cross both lower description writing-surface corners.',434:'Invented lettering occupies the type strip; actual-source paper repair requires canonical proof.'}
rejects.update({501:'Invented two gold symbols and PGLUK lettering absent exact67 source.',502:'Invented lower-edge wordmark absent exact ACT source.',505:'Invented63:88 label.',506:'Invented63:88 label.',508:'Invented63:88 label.',522:'Invented COBLS label absent exact GIGA source.',523:'Repeat is incidental terminal/UI text in source screenshot, not intrinsic logo lettering; preserve ASCII figure but remove prose.',525:'Two invented/altered wordmarks absent exact HODL source.',527:'Invented GEAKISS label absent exact JIMOTHY source.',529:'Invented G label absent exact KINS source.',532:'Invented embossed REVERSE caption; exact cat is altered into rounder fluffier lowered-head pose rather than thin upright source.',533:'Invented gold Lart/Lavr caption absent exact MOODENG source.',558:'Exact sparse white pixel Z replaced by dense random QR-like tile field.',560:'Source incidental five-line contract-address block copied outside intrinsic mark; remove while preserving neon figure.',817:'Still plush/round rather than exact slim natural source photo; superseded by honest exact-photo source composition.',504:'Empty header namebar carried over from front; reverse must have continuous composition.',507:'Empty front header namebar carried over.',513:'Empty front header namebar carried over.',518:'Empty front header namebar carried over.',524:'Empty front header namebar carried over.'})
for a in allattempts.values():
 if a['index']in rejects and not a.get('canonicalRemediationApproved'):a.update(visualStatus='rejected-after-actual2K-QA',rejectionReason=rejects[a['index']],visualReviewedAt=now,visualReviewer='crypto_pair_research and root')
if len(sys.argv)>1:
 assert sys.argv[1]=='accept'
 for i in map(int,sys.argv[2:]):
  a=next(a for a in allattempts.values()if a['index']==i);assert a['status']=='completed'and a.get('sha256')and(i not in rejects or a.get('canonicalRemediationApproved'));a.update(visualStatus='accepted-after-actual2K-source-QA',visualReviewedAt=now,visualReviewer='crypto_pair_research',visualCriteria='Actual full2K source and identity inspected. Source-specific distinct materials, exact identity features, blank front grid/continuous back, no invented labels or forbidden generic ornaments. Canonical crop/content/rounded-edge proof remains pipeline responsibility.')
faces=[];pairs=[]
proofdir=v/'proofs';proofdir.mkdir(exist_ok=True)
for e in ledger['entries']:
 pair={'quoteKey':e['quoteKey'],'designKey':e['designKey'],'exactQuoteMint':e['exactQuoteMint']}
 for face in ['front','back']:
  f=e[face];accepted=[a for a in f['attempts']if a.get('visualStatus','').startswith('accepted')]
  if not accepted:
   f['acceptedAttempt']=None
   if f['attempts']:
    latest=max(f['attempts'],key=lambda x:x['index'])
    f['status']='rejected-awaiting-remediation' if latest.get('visualStatus','').startswith('rejected') else 'completed-awaiting-native-review' if latest.get('status')=='completed' else latest.get('status','submitted')
   continue
  a=max(accepted,key=lambda x:x['index']);f['acceptedAttempt']=a['index'];f['status']='native-visual-accepted';rec={**pair,'face':face,**{k:a[k]for k in ['sourcePath','sha256','jobId','index','dimensions','format','cropApplied','foregroundBoundsCandidate','boundsNote','visualStatus']},'proof':str((proofdir/f"{e['quoteKey']}.png").relative_to(root))};
  for extraField in ['reviewedCrop','edgeConnectedWhiteCleanup','canonicalRemediationApproved','canonicalRemediationProof','canonicalRemediationReview','countsAsNewPaidJob','newGeneration','reusedSourceJobs','derivation','sourceOnlyComposition']:
   if extraField in a:rec[extraField]=a[extraField]
  pair[face]=rec;faces.append(rec)
 if 'front'in pair and'back'in pair:
  canvas=Image.new('RGB',(1150,850),'#ece8df');d=ImageDraw.Draw(canvas)
  for n,face in enumerate(['front','back']):
   a=pair[face];d.text((n*450+15,12),f"{e['quoteKey'].upper()} v2 {face} / actual{a['index']}",fill='black');im=Image.open(root/a['sourcePath']).convert('RGB');im.thumbnail((420,760));canvas.paste(im,(n*450+15,40))
  d.text((925,15),'Exact source',fill='black');im=Image.open(root/e['reference']['path']).convert('RGBA');im.thumbnail((200,260));panel=Image.new('RGBA',(200,260),'white');panel.alpha_composite(im,((200-im.width)//2,(260-im.height)//2));canvas.paste(panel.convert('RGB'),(925,45));canvas.save(proofdir/f"{e['quoteKey']}.png");pairs.append(pair)
paidAttempts=[a for a in allattempts.values()if a.get('countsAsNewPaidJob',True)]
ledger.update(updatedAt=now,paidSubmissions=len(paidAttempts),quotedSubmittedCredits=sum(a.get('quotedCredits',0.5)for a in paidAttempts),acceptedNativeFaces=len(faces),acceptedCompletePairs=len(pairs),unmappedReceiptJobs=unmapped);lp.write_text(json.dumps(ledger,indent=2)+'\n');(base/'accepted-pairs-tailoring-v2.json').write_text(json.dumps({'updatedAt':now,'scope':'Complete actual2K source-faithful v2 pairs only. Rejected originals retained in ledger and excluded. Native artwork QA complete; pipeline verifies canonical crop/content mapping and desktop/mobile integration.','acceptedPairCount':len(pairs),'acceptedFaceCount':len(faces),'acceptedPairs':pairs,'acceptedFaces':faces,'ledger':'tailoring-v2/generation-ledger.json'},indent=2)+'\n');print(json.dumps({'knownJobs':len(paidAttempts),'quotedKnown':sum(a.get('quotedCredits',0.5)for a in paidAttempts),'acceptedNativeFaces':len(faces),'completePairs':len(pairs),'unmapped':unmapped}))
