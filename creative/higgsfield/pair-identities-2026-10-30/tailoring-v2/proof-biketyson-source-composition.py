"""Isolated source-pixel-only BIKE reverse assessment; no acceptance/installation.

Uses approved Higgsfield186 bronze hero/interior material and409 bicycle rails.
The masters are unchanged. This derivation remains a proof until native QA passes.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math
import hashlib
import json

creative = Path(__file__).resolve().parents[1]
root = creative.parents[2]
out = root / 'output/higgsfield/pair-identities-2026-10-30/tailoring-v2/biketyson-source-composition'
out.mkdir(parents=True, exist_ok=True)
old_record = next(p['back'] for p in json.loads((creative / 'accepted-pairs-38.json').read_text())['acceptedPairs'] if p['designKey'] == 'pair-biketyson')
new_record = next(p for p in json.loads((creative / 'accepted-pairs-tailoring-v2.json').read_text())['acceptedFaces'] if p['designKey'] == 'pair-biketyson' and p['face'] == 'front')
records = [old_record, new_record]
masters = []
for record in records:
    path = root / record['sourcePath']
    if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('Source hash changed: ' + str(path))
    masters.append(Image.open(path).convert('RGB'))
old, new = masters
assert old.size == (1360, 2048) and new.size == (1664, 2496)

# Polygon selects the complete source hero, keeping its dark immediate field
# while excluding the old outer laurels, stars and medallion rim.
polygons = [
    [(330,650),(350,600),(390,575),(460,575),(510,595),(540,640),(550,700),(620,730),(700,750),(820,750),(900,745),(960,770),(1000,820),(1025,890),(1040,990),(1080,1100),(1120,1230),(1080,1260),(1050,1310),(960,1320),(880,1320),(820,1310),(780,1270),(765,1220),(780,1100),(790,1000),(780,950),(760,920),(660,940),(610,980),(580,1060),(550,1160),(510,1240),(470,1260),(430,1245),(435,1200),(450,1130),(470,1030),(490,940),(500,900),(450,910),(410,940),(370,960),(320,960),(340,900),(350,850),(340,810),(330,780),(320,750),(325,700)],
    [(232,600),(325,597),(350,615),(349,658),(320,671),(300,681),(250,685),(244,670),(273,655),(232,649)],
    [(515,619),(560,589),(616,573),(648,563),(813,561),(830,578),(826,615),(789,626),(650,625),(618,615),(587,626),(570,643),(530,645)],
    [(875,652),(927,636),(1067,636),(1094,653),(1093,690),(1066,716),(1000,724),(986,786),(929,792),(930,732),(885,711)],
    [(600,780),(1070,780),(1070,1330),(600,1330)],
]
wheel_ellipses = [(400, 1220, 218, 283, 9), (1070, 1195, 151, 267, 9)]
for cx, cy, rx, ry, degrees in wheel_ellipses:
    phi = math.radians(degrees)
    polygons.append([(round(cx + rx * math.cos(t) * math.cos(phi) - ry * math.sin(t) * math.sin(phi)), round(cy + rx * math.cos(t) * math.sin(phi) + ry * math.sin(t) * math.cos(phi))) for t in [n * math.tau / 240 for n in range(240)]])
mask = Image.new('L', old.size, 0)
for polygon in polygons:
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1))
mask.save(out / 'hero-selection-mask.png')
selection = old.convert('RGBA')
selection.putalpha(mask)
selection.save(out / 'hero-selection.png')

# Actual fine interior grain, repeated without reflection/kaleidoscope effects.
# Row staggering and a small feather avoid visible rectangular crop boundaries.
field_box = (650, 950, 770, 1120)
tile = old.crop(field_box).resize((144, 204), Image.Resampling.LANCZOS)
field = Image.new('RGB', new.size)
overlap = 16
for row, y in enumerate(range(-overlap, new.height, tile.height - overlap)):
    for col, x in enumerate(range(-tile.width + (row % 2) * tile.width // 2, new.width, tile.width - overlap)):
        blend = Image.new('L', tile.size, 255)
        draw = ImageDraw.Draw(blend)
        for n in range(overlap):
            draw.line((n, 0, n, tile.height), fill=round(255 * n / overlap))
            if row:
                draw.line((0, n, tile.width, n), fill=round(255 * n / overlap))
        field.paste(tile, (x, y), blend)

hero_box = (155, 540, 1250, 1530)
hero = selection.crop(hero_box)
hero_width = 1280
hero = hero.resize((hero_width, round(hero.height * hero_width / hero.width)), Image.Resampling.LANCZOS)
hero_at = ((new.width - hero.width) // 2, (new.height - hero.height) // 2)
field.paste(hero, hero_at, hero)
interior = Image.new('L', new.size, 0)
interior_box = (164, 148, 1501, 2345)
ImageDraw.Draw(interior).rounded_rectangle(interior_box, radius=44, fill=255)
interior = interior.filter(ImageFilter.GaussianBlur(.6))
composite = new.copy()
composite.paste(field, (0, 0), interior)
path = out / 'biketyson-reverse-source-composition.png'
composite.save(path, optimize=True)

rounded = composite.convert('RGBA').resize((630, 880), Image.Resampling.LANCZOS)
alpha = Image.new('L', (2520, 3520), 0)
ImageDraw.Draw(alpha).rounded_rectangle((0, 0, 2519, 3519), radius=630 * .0504 * 4, fill=255)
rounded.putalpha(alpha.resize(rounded.size, Image.Resampling.LANCZOS))
rounded.save(out / 'biketyson-reverse-rounded-proof.png', optimize=True)

proof = Image.new('RGB', (1260, 1040), '#27231f')
for n, image in enumerate([new, composite]):
    image = image.copy()
    image.thumbnail((620, 980))
    proof.paste(image, (n * 630 + (630 - image.width) // 2, 35))
ImageDraw.Draw(proof).text((15, 10), 'Original409 front rails', fill='white')
ImageDraw.Draw(proof).text((645, 10), 'Source-only reverse proof; not accepted', fill='white')
proof.save(out / 'front-reverse-proof.jpg', quality=96)
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
report = {'status': 'ISOLATED PROOF; needs complete-hero and no-laurel native visual QA before acceptance', 'sources': [{'path': r['sourcePath'], 'sha256': r['sha256'], 'jobId': r['jobId']} for r in records], 'method': 'Actual Higgsfield source crops, resize and alpha composition only; no new illustration or provider call', 'heroPolygons': polygons, 'wheelEllipseMasks': wheel_ellipses, 'heroSourceBox': list(hero_box), 'heroOutputSize': list(hero.size), 'heroAt': list(hero_at), 'fieldSourceBox': list(field_box), 'fieldMethod': {'tileSize': list(tile.size), 'overlap': overlap, 'alternateRowOffset': tile.width // 2, 'noMirroring': True}, 'railInteriorBox': list(interior_box), 'railInteriorRadius': 44, 'derivative': {'path': str(path.relative_to(root)), 'sha256': digest(path), 'size': list(composite.size)}, 'heroMaskSha256': digest(out / 'hero-selection-mask.png'), 'mastersModified': False, 'newGeneration': False}
(out / 'derivation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['derivative']))
