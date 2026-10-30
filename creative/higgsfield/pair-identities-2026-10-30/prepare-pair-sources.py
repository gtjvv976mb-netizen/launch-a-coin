"""Deterministic derivatives of accepted Higgsfield masters; no generated decoration.

Run only through app/scripts/prepare-pair-designs.ts. Surface measurements select
existing artwork pixels. They do not define a second creator-content layout.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageFilter
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks
import hashlib, io, json, sys
import numpy as np
from edge_cleanup import edge_connected_white_cleanup

settings=json.load(sys.stdin)
root=Path(settings['root']);out=Path(settings['out'])
public=Path(settings.get('publicDirectory',root/'app/public'))
if 'publicDirectory' in settings and not public.resolve().is_relative_to(out.resolve()):
    raise ValueError('Offline proof publicDirectory must stay inside its isolated output directory')
out.mkdir(parents=True,exist_ok=True)
sha=lambda data:hashlib.sha256(data).hexdigest()

def spans(mask):
    edges=np.diff(np.r_[False,mask,False].astype(int))
    return list(zip(np.where(edges==1)[0],np.where(edges==-1)[0]))

def crop_background(image,reviewed_crop=None):
    """Remove only complete near-white outside rows/columns, never card ornaments."""
    a=np.asarray(image.convert('RGB'));h,w=a.shape[:2]
    foreground=(a.min(axis=2)<238)
    xs=np.where(foreground[int(h*.1):int(h*.9)].mean(axis=0)>.04)[0]
    ys=np.where(foreground[:,int(w*.1):int(w*.9)].mean(axis=1)>.04)[0]
    x0,x1=max(0,int(xs[0])-2),min(w,int(xs[-1])+3)
    y0,y1=max(0,int(ys[0])-2),min(h,int(ys[-1])+3)
    # Refuse a surprising crop. It needs individual review, not a destructive guess.
    if reviewed_crop:
        box=reviewed_crop.get('box')
        if not reviewed_crop.get('reviewNote') or not isinstance(box,list) or len(box)!=4 or any(not isinstance(v,int) for v in box):
            raise ValueError('Invalid individually reviewed source crop')
        rx0,ry0,rx1,ry1=box
        if not (0<=rx0<rx1<=w and 0<=ry0<ry1<=h):raise ValueError('Reviewed crop outside source')
        # Individual review may approve a wider blank margin, but it cannot
        # silently trim farther into the automatically detected foreground.
        if rx0>x0 or ry0>y0 or rx1<x1 or ry1<y1:
            guard=reviewed_crop.get('neutralExteriorGuard')
            if not guard:raise ValueError('Reviewed crop clips detected foreground')
            minimum=guard.get('minimumChannel');spread=guard.get('maximumChannelSpread')
            if not isinstance(minimum,(int,float)) or not 175<=minimum<=238 or not isinstance(spread,(int,float)) or not 0<=spread<=24:
                raise ValueError('Unreviewed exterior-background crop limits')
            outside=np.ones((h,w),dtype=bool);outside[ry0:ry1,rx0:rx1]=False
            pixels=a[outside].astype(int)
            if pixels.min()<minimum or np.ptp(pixels,axis=1).max()>spread:
                raise ValueError('Reviewed exterior crop would discard dark or colored frame pixels')
        return image.crop(box),box
    if x0>w*.025 or w-x1>w*.025 or y0>h*.025 or h-y1>h*.04:
        raise ValueError('Unexpected external margin; inspect before cropping')
    return image.crop((x0,y0,x1,y1)),[x0,y0,x1,y1]

def measure(image):
    w,h=510,768
    a=np.asarray(image.convert('RGB').resize((w,h),Image.Resampling.LANCZOS)).astype(float)
    center=np.median(a[:,int(w*.35):int(w*.65)],axis=1)
    gradient=gaussian_filter1d(np.linalg.norm(np.diff(center,axis=0),axis=1),1)
    def panel(lo,hi,light=True,min_height=.015):
        lo,hi=int(lo*h),int(hi*h)
        if light:
            mask=(center.mean(axis=1)>175)&(gradient.tolist()+[0]<np.array([45]*h))
            runs=[(s,e) for s,e in spans(mask[lo:hi]) if e-s>=h*min_height]
            if not runs:raise ValueError('No light content panel in '+str((lo/h,hi/h)))
            s,e=max(runs,key=lambda r:r[1]-r[0]);s+=lo;e+=lo
        else:
            peaks,_=find_peaks(gradient[lo:hi],distance=6,prominence=40)
            boundaries=[lo]+[int(p+lo) for p in peaks]+[hi]
            s,e=max(zip(boundaries,boundaries[1:]),key=lambda r:r[1]-r[0])
            s+=3;e-=2
        y=(s+e)//2
        reference=np.median(a[y,int(w*.35):int(w*.65)],axis=0)
        distance=np.linalg.norm(a[y]-reference,axis=1)
        mask=distance<55
        candidates=[(x0,x1) for x0,x1 in spans(mask) if x0<w*.5<x1]
        if not candidates:raise ValueError('No continuous panel center')
        x0,x1=max(candidates,key=lambda r:r[1]-r[0]);x0+=2;x1-=2
        if x1-x0<w*.55:raise ValueError('Narrow surface needs review')
        return {'x':round(x0/w,6),'y':round(s/h,6),'w':round((x1-x0)/w,6),'h':round((e-s)/h,6)}
    art=panel(.112,.60,False,.28)
    name=panel(.028,.128,True,.025)
    kind=panel(max(.55,art['y']+art['h']+.003),.665,True,.015)
    text=panel(max(.64,kind['y']+kind['h']+.004),.94,True,.15)
    # The aperture is a measured pixel region, represented as a compact clip.
    mw,mh=round(art['w']*w),round(art['h']*h)
    mask={'width':mw,'height':mh,'path':f'M0 0H{mw}V{mh}H0Z'}
    boxes={'art':art,'name':name,'type':kind,'text':text}
    diagnostic=image.convert('RGB').resize((680,1024),Image.Resampling.LANCZOS)
    d=ImageDraw.Draw(diagnostic)
    for key,box in boxes.items():
        x,y,bw,bh=[box[k] for k in ('x','y','w','h')]
        d.rectangle((x*680,y*1024,(x+bw)*680,(y+bh)*1024),outline={'art':'#fe3060','name':'#00bfff','type':'#00bfff','text':'#00bfff'}[key],width=3)
        d.text((x*680+5,y*1024+5),key,fill='#ff3060')
    # Dark ink must have light name/type/details surfaces, sampled away from edges.
    samples={}
    for key,box in [('name',name),('type',kind),('text',text)]:
        x0,x1=round((box['x']+.02)*w),round((box['x']+box['w']-.02)*w)
        y0,y1=round((box['y']+.003)*h),round((box['y']+box['h']-.003)*h)
        luminance=a[y0:y1,x0:x1].mean(axis=2)
        samples[key]={'median':round(float(np.median(luminance)),2),'p10':round(float(np.percentile(luminance,10)),2)}
        if samples[key]['p10']<145:raise ValueError('Dark content surface: '+key)
    return {'art':art,'mask':mask,'prints':{'name':name,'type':kind,'text':text}},diagnostic,samples

results=[]
for pair in settings['pairs']:
    key=pair['designKey'];entry={'designKey':key,'faces':{}}
    for face in ('front','back'):
        record=pair[face];src=root/record['sourcePath'];data=src.read_bytes()
        if sha(data)!=record['sha256']:raise ValueError('Accepted master hash changed: '+key+' '+face)
        image=Image.open(io.BytesIO(data)).convert('RGB')
        try:
            normalized,crop=crop_background(image,record.get('reviewedCrop'))
        except ValueError as error:
            raise ValueError(f'{key} {face}: {error}') from error
        normalized=normalized.resize((1260,1897),Image.Resampling.LANCZOS)
        composition=[]
        if record.get('sourcePaperPatches'):
            original_normalized=normalized.copy()
            for patch in record['sourcePaperPatches']:
                if not patch.get('reviewNote'):raise ValueError('Source-paper composition needs individual review')
                def pixels(box):
                    if len(box)!=4 or any(not isinstance(v,(int,float)) for v in box):raise ValueError('Invalid source-paper box')
                    x,y,bw,bh=box
                    if min(x,y)<0 or min(bw,bh)<=0 or x+bw>1 or y+bh>1:raise ValueError('Source-paper patch outside image')
                    return [round(x*1260),round(y*1897),round((x+bw)*1260),round((y+bh)*1897)]
                source_box,target_box=pixels(patch['from']),pixels(patch['to'])
                source_patch=original_normalized.crop(source_box)
                resized_patch=source_patch.resize((target_box[2]-target_box[0],target_box[3]-target_box[1]),Image.Resampling.LANCZOS)
                patch_mask=None
                if patch.get('cornerRadiusPixels'):
                    radius=patch['cornerRadiusPixels']
                    if not isinstance(radius,(int,float)) or not 0<radius<=40:raise ValueError('Unreviewed paper corner radius')
                    patch_mask=Image.new('L',resized_patch.size,0)
                    ImageDraw.Draw(patch_mask).rounded_rectangle((0,0,resized_patch.width-1,resized_patch.height-1),radius=radius,fill=255)
                    feather=patch.get('featherPixels',0)
                    if not isinstance(feather,(int,float)) or not 0<=feather<=2:raise ValueError('Unreviewed paper feather')
                    if feather:patch_mask=patch_mask.filter(ImageFilter.GaussianBlur(feather))
                normalized.paste(resized_patch,(target_box[0],target_box[1]),patch_mask)
                composition.append({**patch,'sourcePixels':source_box,'targetPixels':target_box,'sourcePatchPixelSha256':sha(source_patch.tobytes()),'method':'reuse-actual-blank-source-paper-v1'})
        cleanup_requested=bool(record.get('edgeConnectedWhiteCleanup'))
        # Front atlas cleanup happens after the SVG is flattened, so its palette
        # base cannot refill the removed outside pixels. Back sources are direct.
        cleanup=cleanup_requested and face=='back'
        if cleanup:normalized,cleanup_report=edge_connected_white_cleanup(normalized)
        if face=='front':entry['edgeConnectedWhiteCleanup']=cleanup_requested
        destination=public/'assets/carddex/higgsfield'/f'{key}-{face}.webp'
        destination.parent.mkdir(parents=True,exist_ok=True)
        normalized.save(destination,'WEBP',quality=94,method=6)
        decoded=Image.open(destination).convert('RGBA' if cleanup else 'RGB')
        compact=destination.with_name(f'{key}-{face}-320.webp')
        decoded.resize((320,482),Image.Resampling.LANCZOS).save(compact,'WEBP',quality=88,method=6)
        entry['faces'][face]={'path':'/'+str(destination.relative_to(public)),'sha256':sha(destination.read_bytes()),'compactPath':'/'+str(compact.relative_to(public)),'compactSha256':sha(compact.read_bytes()),'masterSha256':record['sha256'],'masterPath':record['sourcePath'],'jobId':record['jobId'],'masterSize':list(image.size),'sourceCrop':crop,'normalizedSize':[1260,1897]}
        if record.get('normalizationOverride'):entry['faces'][face]['normalizationOverride']=record['normalizationOverride']
        for field in ('countsAsNewPaidJob','newGeneration','reusedSourceJobs','derivation','sourceOnlyComposition','sourceCompositionEvidence'):
            if field in record:entry['faces'][face][field]=record[field]
        if composition:entry['faces'][face]['sourcePaperComposition']=composition
        if cleanup:entry['faces'][face]['edgeConnectedWhiteCleanup']=cleanup_report
        if face=='front':
            layout,proof,samples=measure(decoded)
            if pair.get('acceptanceManifest')=='accepted-pairs-tailoring-v2.json' or settings.get('sourceMaterialGaps'):
                layout['sourceMaterialGaps']=True
            entry['layout']=layout;entry['lightSurfaceSamples']=samples
            proof.save(out/f'{key}-measurement.jpg',quality=93)
            decoded.save(out/f'{key}-front.png',optimize=True)
        else:
            reverse=decoded.convert('RGBA').resize((630,880),Image.Resampling.LANCZOS)
            mask=Image.new('L',(630*4,880*4),0)
            ImageDraw.Draw(mask).rounded_rectangle((0,0,630*4,880*4),radius=630*.0504*4,fill=255)
            rounded=mask.resize((630,880),Image.Resampling.LANCZOS)
            reverse.putalpha(ImageChops.multiply(reverse.getchannel('A'),rounded) if cleanup else rounded)
            reversePath=public/'assets/carddex/token-backs'/f'{key}.png'
            reversePath.parent.mkdir(parents=True,exist_ok=True)
            reverse.save(reversePath,optimize=True)
            entry['reverse']={'designKey':key,'path':'/'+str(reversePath.relative_to(public)),'sha256':sha(reversePath.read_bytes()),'sourceSha256':entry['faces']['back']['sha256'],'width':630,'height':880,'conversionVersion':'launchacard-token-back-png-v1'}
    results.append(entry)
print(json.dumps(results))
