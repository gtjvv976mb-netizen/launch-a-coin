/** Deterministic PNG compatibility copies of all reviewed Higgsfield card backs.
 * Run from app/: bun scripts/prepare-token-backs.ts. Requires Python/Pillow.
 * Preserves the browser's full-image object-fit:fill at 63:88, then clips the same
 * rounded card silhouette. No generated artwork, credit spend or source changes.
 */
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {CANONICAL_CARD_LAYOUT} from "../src/lib/carddex/card-template";
import reviewedDesigns from "../../integrations/pumpfun/src/design-assets.json";

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const publicRoot=path.join(appRoot,"public");
const conversionVersion="launchacard-token-back-png-v1";
const width=630,height=880;
const sha256=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const reviewedKeys=Object.keys(reviewedDesigns);
if(!reviewedKeys.length || new Set(reviewedKeys).size!==reviewedKeys.length)throw new Error("Review a nonempty unique source design manifest before converting token backs.");
const inputs=[];
for(const key of reviewedKeys){
  if(!/^[a-z0-9-]+$/.test(key))throw new Error("Invalid design key.");
  const source=reviewedDesigns[key as keyof typeof reviewedDesigns]?.back;
  if(!source||source.path!==`/assets/carddex/higgsfield/${key}-back.webp`|| !/^[a-f0-9]{64}$/.test(source.sha256))throw new Error(`Missing reviewed Higgsfield back: ${key}`);
  const sourceFile=path.join(publicRoot,source.path.slice(1));
  if(sha256(await readFile(sourceFile))!==source.sha256)throw new Error(`Original Higgsfield back differs from its reviewed hash: ${key}`);
  inputs.push({designKey:key,sourceFile,sourceSha256:source.sha256});
}
const command=Bun.spawn(["python3","-c",String.raw`
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import hashlib, io, json, sys

settings=json.load(sys.stdin)
width,height=settings['width'],settings['height']
scale=4
mask=Image.new('L',(width*scale,height*scale),0)
ImageDraw.Draw(mask).rounded_rectangle((0,0,width*scale,height*scale),radius=width*settings['radius']*scale,fill=255)
mask=mask.resize((width,height),Image.Resampling.LANCZOS)
outputs=[]
manifest={}
for item in settings['inputs']:
    original=Path(item['sourceFile']).read_bytes()
    if hashlib.sha256(original).hexdigest()!=item['sourceSha256']:
        raise ValueError('Source changed during conversion: '+item['designKey'])
    with Image.open(io.BytesIO(original)) as source:
        if source.format!='WEBP' or source.width<width or source.height<height:
            raise ValueError('Invalid approved source dimensions or format: '+item['designKey'])
        # Match GeneratedCardReverse object-fit:fill; retain every source edge.
        image=source.convert('RGBA').resize((width,height),Image.Resampling.LANCZOS)
    image.putalpha(ImageChops.multiply(image.getchannel('A'),mask))
    encoded=io.BytesIO()
    image.save(encoded,format='PNG',optimize=True,compress_level=9)
    data=encoded.getvalue()
    # Validate before writing any output, retaining deterministic pixel formats.
    with Image.open(io.BytesIO(data)) as decoded:
        if decoded.size!=(width,height) or decoded.mode!='RGBA' or decoded.getpixel((0,0))[3]!=0 or decoded.getpixel((width//2,height//2))[3]!=255:
            raise ValueError('Invalid PNG output: '+item['designKey'])
    relative='/assets/carddex/token-backs/'+item['designKey']+'.png'
    outputs.append((Path(settings['publicRoot'])/relative[1:],data))
    manifest[item['designKey']]={
        'designKey':item['designKey'],'path':relative,
        'sha256':hashlib.sha256(data).hexdigest(),'sourceSha256':item['sourceSha256'],
        'width':width,'height':height,'conversionVersion':settings['conversionVersion'],
    }
for destination,data in outputs:
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(data)
print(json.dumps(manifest,indent=2))
`],{stdin:"pipe",stdout:"pipe",stderr:"inherit"});
command.stdin.write(JSON.stringify({inputs,width,height,radius:CANONICAL_CARD_LAYOUT.radius,conversionVersion,publicRoot}));
command.stdin.end();
const output=await new Response(command.stdout).text();
if(await command.exited!==0)throw new Error("Token-back conversion failed; the trusted manifest was not replaced.");
const manifest=JSON.parse(output) as Record<string,{path:string;sha256:string;sourceSha256:string;width:number;height:number;conversionVersion:string}>;
if(Object.keys(manifest).sort().join()!==reviewedKeys.sort().join())throw new Error("Token-back conversion did not produce every reviewed design.");
let bytes=0;
for(const item of inputs){
  const asset=manifest[item.designKey];
  if(asset.sourceSha256!==item.sourceSha256||asset.width!==width||asset.height!==height||asset.conversionVersion!==conversionVersion)throw new Error(`Token-back manifest mismatch: ${item.designKey}`);
  const file=await readFile(path.join(publicRoot,asset.path.slice(1)));
  if(sha256(file)!==asset.sha256)throw new Error(`Token-back output hash mismatch: ${item.designKey}`);
  if(sha256(await readFile(item.sourceFile))!==item.sourceSha256)throw new Error(`Original source changed: ${item.designKey}`);
  bytes+=file.byteLength;
}
await writeFile(path.join(appRoot,"src/lib/carddex/token-back-assets.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({count:Object.keys(manifest).length,bytes,conversionVersion,width,height}));
