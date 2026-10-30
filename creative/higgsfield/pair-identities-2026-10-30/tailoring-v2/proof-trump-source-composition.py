"""Isolated TRUMP reverse from existing Higgsfield hero46 and new poster rails453.

No paid generation, acceptance change or installation. Original masters unchanged.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import label, binary_dilation, find_objects
import hashlib
import json
import numpy as np

creative = Path(__file__).resolve().parents[1]
root = creative.parents[2]
out = root / 'output/higgsfield/pair-identities-2026-10-30/tailoring-v2/trump-source-composition'
out.mkdir(parents=True, exist_ok=True)
old_record = next(p['back'] for p in json.loads((creative / 'accepted-pairs-51.json').read_text())['acceptedPairs'] if p['designKey'] == 'pair-trump')
new_record = next(p for p in json.loads((creative / 'accepted-pairs-tailoring-v2.json').read_text())['acceptedFaces'] if p['designKey'] == 'pair-trump' and p['face'] == 'front')
records = [old_record, new_record]
masters = []
for record in records:
    path = root / record['sourcePath']
    if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('Source hash changed: ' + str(path))
    masters.append(Image.open(path).convert('RGB'))
old, new = masters
assert old.size == (1360, 2048) and new.size == (1664, 2496)

polygon = [(355,512),(390,500),(440,490),(485,500),(525,535),(535,580),(515,650),(455,700),(430,745),(410,785),(565,790),(590,730),(600,650),(610,570),(640,500),(700,455),(790,435),(875,450),(925,480),(942,520),(920,550),(910,650),(885,730),(850,780),(1025,755),(1040,900),(1075,1000),(1100,1200),(1080,1285),(1065,1330),(1005,1385),(890,1415),(750,1415),(540,1420),(400,1420),(340,1390),(310,1300),(280,1210),(250,1175),(215,1120),(195,1030),(195,900),(200,805),(230,755),(280,720),(305,640)]
hero_mask = Image.new('L', old.size, 0)
ImageDraw.Draw(hero_mask).polygon(polygon, fill=255)
hero_mask = hero_mask.filter(ImageFilter.GaussianBlur(1))

# Remove only detached incidental signature strokes beneath the third FIGHT.
# Exact portrait/fist/FIGHT pixels stay unchanged; the replacement is existing
# clean source marble, never newly illustrated or newly typeset lettering.
a = np.asarray(old).astype(float)
gold = (a[:,:,0] > 150) & (a[:,:,1] > 90) & (a[:,:,2] < 180) & (a[:,:,0] > a[:,:,2] * 1.25) & (a[:,:,1] > a[:,:,2] * 1.15)
roi = (450, 1340, 810, 1430)
x0, y0, x1, y1 = roi
components, count = label(gold[y0:y1,x0:x1], structure=np.ones((3,3)))
signature = np.zeros(gold.shape, dtype=bool)
removed_components = []
for component, bounds in enumerate(find_objects(components), 1):
    if bounds is None:
        continue
    ys, xs = bounds
    box = [xs.start+x0, ys.start+y0, xs.stop+x0, ys.stop+y0]
    # Real third-line letter components continue through the top of this narrow
    # region. Detached signature peaks start below it and are excluded.
    if ys.start > 0:
        region = components[bounds] == component
        signature[y0+ys.start:y0+ys.stop,x0+xs.start:x0+xs.stop] |= region
        removed_components.append({'box': box, 'pixels': int(region.sum())})
signature = binary_dilation(signature, iterations=3)
signature_mask = Image.fromarray((signature * 255).astype('uint8'))
signature_mask.save(out / 'excluded-incidental-signature-mask.png')

field_box = (980, 600, 1080, 740)
tile = old.crop(field_box).resize((140, 196), Image.Resampling.LANCZOS)
def source_field(size):
    field = Image.new('RGB', size)
    overlap = 16
    for row, y in enumerate(range(-overlap, size[1], tile.height - overlap)):
        for x in range(-tile.width + (row % 2) * tile.width // 2, size[0], tile.width - overlap):
            blend = Image.new('L', tile.size, 255)
            draw = ImageDraw.Draw(blend)
            for n in range(overlap):
                draw.line((n, 0, n, tile.height), fill=round(255 * n / overlap))
                if row:
                    draw.line((0, n, tile.width, n), fill=round(255 * n / overlap))
            field.paste(tile, (x, y), blend)
    return field
clean_hero = old.copy()
clean_hero.paste(source_field(old.size), (0, 0), signature_mask)
selection = clean_hero.convert('RGBA')
selection.putalpha(hero_mask)
hero_mask.save(out / 'hero-selection-mask.png')
selection.save(out / 'hero-selection.png')

hero_box = (180, 425, 1120, 1430)
hero = selection.crop(hero_box)
hero_width = 1280
hero = hero.resize((hero_width, round(hero.height * hero_width / hero.width)), Image.Resampling.LANCZOS)
hero_at = ((new.width - hero.width) // 2, (new.height - hero.height) // 2)
field = source_field(new.size)
field.paste(hero, hero_at, hero)
interior_box = (163, 174, 1508, 2320)
interior = Image.new('L', new.size, 0)
ImageDraw.Draw(interior).rounded_rectangle(interior_box, radius=40, fill=255)
interior = interior.filter(ImageFilter.GaussianBlur(.6))
composite = new.copy()
composite.paste(field, (0, 0), interior)
path = out / 'trump-reverse-source-composition.png'
composite.save(path, optimize=True)

rounded = composite.convert('RGBA').resize((630, 880), Image.Resampling.LANCZOS)
alpha = Image.new('L', (2520, 3520), 0)
ImageDraw.Draw(alpha).rounded_rectangle((0, 0, 2519, 3519), radius=630 * .0504 * 4, fill=255)
rounded.putalpha(alpha.resize(rounded.size, Image.Resampling.LANCZOS))
rounded.save(out / 'trump-reverse-rounded-proof.png', optimize=True)
proof = Image.new('RGB', (1260, 1040), '#27231f')
for n, image in enumerate([new, composite]):
    image = image.copy()
    image.thumbnail((620, 980))
    proof.paste(image, (n * 630 + (630 - image.width) // 2, 35))
ImageDraw.Draw(proof).text((15, 10), 'Original453 poster front rails', fill='white')
ImageDraw.Draw(proof).text((645, 10), 'Source-only reverse proof; not accepted', fill='white')
proof.save(out / 'front-reverse-proof.jpg', quality=96)
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
report = {'status': 'ISOLATED PROOF; requires complete portrait/fist/FIGHT and no-royal-ornament native QA', 'sources': [{'path': r['sourcePath'], 'sha256': r['sha256'], 'jobId': r['jobId']} for r in records], 'method': 'Actual Higgsfield source crop/alpha composition only; no new illustration or lettering', 'heroPolygon': polygon, 'heroSourceBox': list(hero_box), 'heroOutputSize': list(hero.size), 'heroAt': list(hero_at), 'fieldSourceBox': list(field_box), 'fieldMethod': {'tileSize': list(tile.size), 'overlap': 16, 'alternateRowOffset': tile.width // 2, 'noMirroring': True}, 'excludedIncidentalSignature': {'region': list(roi), 'componentRule': '8-connected gold components detached from region top; actual FIGHT letters extend through region top', 'components': removed_components, 'dilationPixels': 3, 'maskSha256': digest(out / 'excluded-incidental-signature-mask.png')}, 'railInteriorBox': list(interior_box), 'railInteriorRadius': 40, 'derivative': {'path': str(path.relative_to(root)), 'sha256': digest(path), 'size': list(composite.size)}, 'heroMaskSha256': digest(out / 'hero-selection-mask.png'), 'mastersModified': False, 'newGeneration': False}
(out / 'derivation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['derivative']))
