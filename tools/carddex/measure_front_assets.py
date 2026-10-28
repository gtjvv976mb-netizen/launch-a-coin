"""Measure neutral creator apertures. Read-only on generated artwork; writes UI mask metadata."""
from collections import deque
from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'app/public/assets/carddex/higgsfield'
OUT = ROOT / 'app/src/lib/carddex/generated-layouts.json'
PLAN = json.loads((ROOT / 'creative/higgsfield/carddex-generation-plan.json').read_text())
keys = [entry['design_key'] for entry in PLAN['entries'] if entry.get('face') == 'front']
result = {}
for key in keys:
    path = ASSETS / f'{key}-front.webp'
    if not path.exists():
        continue
    image = Image.open(path).convert('RGB')
    image.thumbnail((512, 768))
    width, height = image.size
    pixels = image.load()
    seed = (width // 2, int(height * .30))
    target = pixels[seed]
    def neutral(x, y):
        value = pixels[x, y]
        return max(value) - min(value) < 22 and max(abs(value[n]-target[n]) for n in range(3)) < 29
    if not neutral(*seed):
        raise ValueError(f'{key}: creator-aperture seed is not neutral gray')
    seen = {seed}
    queue = deque([seed])
    while queue:
        x, y = queue.popleft()
        for xx, yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0 <= xx < width and 0 <= yy < height and (xx,yy) not in seen and neutral(xx,yy):
                seen.add((xx,yy))
                queue.append((xx,yy))
    # One measured pixel of overlap removes a gray decoding fringe under the metal lip.
    expanded = set(seen)
    for x, y in seen:
        for xx, yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0 <= xx < width and 0 <= yy < height:
                expanded.add((xx,yy))
    xs = [x for x,y in expanded]; ys = [y for x,y in expanded]
    left, top, right, bottom = min(xs), min(ys), max(xs)+1, max(ys)+1
    if len(seen) < width*height*.12 or len(seen) > width*height*.72:
        raise ValueError(f'{key}: suspicious neutral aperture area {len(seen)/width/height:.3f}')
    active, rectangles = {}, []
    row_points = {}
    for x,y in expanded:
        row_points.setdefault(y,[]).append(x)
    for y in range(top, bottom):
        points = sorted(row_points.get(y,[]))
        runs=[]
        for x in points:
            if runs and x == runs[-1][1]:
                runs[-1][1] += 1
            else:
                runs.append([x,x+1])
        current = {tuple(run) for run in runs}
        for run, start in list(active.items()):
            if run not in current:
                rectangles.append((run[0]-left,start-top,run[1]-run[0],y-start));del active[run]
        for run in current:
            if run not in active:
                active[run]=y
    for run,start in active.items():
        rectangles.append((run[0]-left,start-top,run[1]-run[0],bottom-start))
    mask_path=''.join(f'M{x} {y}h{w}v{h}h{-w}Z' for x,y,w,h in rectangles)
    result[key] = {'art': {'x':round(left/width,6),'y':round(top/height,6),'w':round((right-left)/width,6),'h':round((bottom-top)/height,6)},'mask': {'width':right-left,'height':bottom-top,'path':mask_path}}
    paper_target = pixels[width//2,int(height*.77)]
    def paper(x,y):
        value=pixels[x,y]
        return sum(value)/3 > 165 and max(abs(value[n]-paper_target[n]) for n in range(3)) < 48
    def paper_box(seed):
        if not paper(*seed): return None
        area={seed}; todo=deque([seed])
        while todo:
            x,y=todo.popleft()
            for xx,yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if 0<=xx<width and 0<=yy<height and (xx,yy) not in area and paper(xx,yy):
                    area.add((xx,yy));todo.append((xx,yy))
        xx=[x for x,y in area];yy=[y for x,y in area]
        return {'x':round(min(xx)/width,6),'y':round(min(yy)/height,6),'w':round((max(xx)-min(xx)+1)/width,6),'h':round((max(yy)-min(yy)+1)/height,6)}
    def paper_run(x,lo,hi):
        runs=[]
        for y in range(max(0,int(lo*height)),min(height,int(hi*height))):
            if paper(x,y):
                if runs and runs[-1][1]==y:runs[-1][1]+=1
                else:runs.append([y,y+1])
        if not runs:return None
        run=max(runs,key=lambda r:r[1]-r[0]);return paper_box((x,(run[0]+run[1])//2))
    text_box=paper_box((width//2,int(height*.77)))
    name_box=paper_run(width//2,.025,.115)
    type_box=paper_run(width//2,bottom/height+.005,(text_box['y'] if text_box else .65)-.005)
    footer_lo=(text_box['y']+text_box['h']+.01) if text_box else .88
    foot_a=paper_run(int(width*.22),footer_lo,.975)
    foot_b=paper_run(int(width*.78),footer_lo,.975)
    prints={name:box for name,box in [('name',name_box),('type',type_box),('text',text_box)] if box and .01<box['h']<.35 and .25<box['w']<.95}
    if foot_a and foot_b:
        if foot_a['w']>.55:
            full=foot_a
            foot_a={**full,'x':full['x']+.02,'w':full['w']*.4}
            foot_b={**full,'x':full['x']+full['w']*.6-.02,'w':full['w']*.4}
        prints['foot-a']=foot_a;prints['foot-b']=foot_b
        prints['footer']={'x':foot_a['x'],'y':foot_a['y'],'w':foot_b['x']+foot_b['w']-foot_a['x'],'h':min(foot_a['h'],foot_b['h'])}
    result[key]['prints']=prints
OUT.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(json.dumps({'measured':len(result),'metadataBytes':OUT.stat().st_size,'keys':list(result)}))
