from pathlib import Path
import json,sys
from PIL import Image,ImageDraw
v=Path(__file__).parent;root=v.parents[3];l=json.loads((v/'generation-ledger.json').read_text());lo=int(sys.argv[1]);hi=int(sys.argv[2]);dct={a['index']:(e,a)for e in l['entries']for a in e['front']['attempts']if lo<=a['index']<=hi and a.get('sourcePath')};canvas=Image.new('RGB',(1500,1450),'#eee9df');d=ImageDraw.Draw(canvas)
for n,i in enumerate(range(lo,hi+1)):
 x=(n%5)*300;y=(n//5)*725
 if i not in dct:d.text((x+10,y+10),f'{i} pending',fill='gray');continue
 e,a=dct[i];d.text((x+10,y+10),f"{i} {e['quoteKey']}",fill='black');im=Image.open(root/a['sourcePath']).convert('RGB');im.thumbnail((275,480));canvas.paste(im,(x+10+(275-im.width)//2,y+35));ref=Image.open(root/e['reference']['path']).convert('RGBA');ref.thumbnail((160,160));panel=Image.new('RGBA',(160,160),'white');panel.alpha_composite(ref,((160-ref.width)//2,(160-ref.height)//2));canvas.paste(panel.convert('RGB'),(x+10,y+535))
p=v/f'proofs/fronts-{lo}-{hi}.png';canvas.save(p);print(json.dumps({'path':str(p),'available':sorted(dct)}))
