"""Exact admitted TAO silhouette in existing Higgsfield ceramic/palladium material.

Source-only isolated proof. No new illustration, glyph redraw, generation,
acceptance, installation or change to the original source files.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import hashlib
import json

creative = Path(__file__).resolve().parents[1]
root = creative.parents[2]
out = root / 'output/higgsfield/pair-identities-2026-10-30/tailoring-v2/tao-source-composition'
out.mkdir(parents=True, exist_ok=True)
entry = next(p for p in json.loads((creative / 'generation-ledger-51.json').read_text())['entries'] if p['quoteKey'] == 'tao')
front_record, frame_record = entry['front'], entry['backFlashCorrection']
records = [{'path': r['masterPath'], 'sha256': r['masterSha256'], 'jobId': r['jobId']} for r in (front_record, frame_record)]
masters = []
for record in records:
    path = root / record['path']
    if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError('Source hash changed: ' + str(path))
    masters.append(Image.open(path).convert('RGB'))
front, frame = masters
reference = creative / 'references/tao-primary-inline-432636a22810-reference-1024.png'
reference_hash = '14822972f8b7c066c75e620168f5e1bad9beb368932c5e543b14b6c9c96852a5'
if hashlib.sha256(reference.read_bytes()).hexdigest() != reference_hash:
    raise ValueError('Exact source glyph changed')
logo = Image.open(reference).convert('RGBA')
assert logo.size == (1024, 1024) and logo.getextrema()[:3] == ((0, 0), (0, 0), (0, 0))
logo_bounds = logo.getchannel('A').getbbox()
logo = logo.crop(logo_bounds)
logo_width = 860
logo = logo.resize((logo_width, round(logo.height * logo_width / logo.width)), Image.Resampling.LANCZOS)
logo_at = ((frame.width - logo.width) // 2, (frame.height - logo.height) // 2)
paper_box = (200, 1400, 1160, 1820)
paper = front.crop(paper_box).resize(frame.size, Image.Resampling.LANCZOS)
inner_box = (153, 172, 1510, 2343)
mask = Image.new('L', frame.size, 0)
ImageDraw.Draw(mask).rounded_rectangle(inner_box, radius=35, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(.6))
composite = frame.copy()
composite.paste(paper, (0, 0), mask)
composite.paste(logo, logo_at, logo)
path = out / 'tao-reverse-exact-source-composition.png'
composite.save(path, optimize=True)
logo.getchannel('A').save(out / 'exact-logo-output-mask.png')
rounded = composite.convert('RGBA').resize((630, 880), Image.Resampling.LANCZOS)
alpha = Image.new('L', (2520, 3520), 0)
ImageDraw.Draw(alpha).rounded_rectangle((0, 0, 2519, 3519), radius=630 * .0504 * 4, fill=255)
rounded.putalpha(alpha.resize(rounded.size, Image.Resampling.LANCZOS))
rounded.save(out / 'tao-reverse-rounded-proof.png', optimize=True)

proof = Image.new('RGB', (1260, 1040), '#27231f')
for n, image in enumerate([front, composite]):
    image = image.copy()
    image.thumbnail((620, 980))
    proof.paste(image, (n * 630 + (630 - image.width) // 2, 35))
ImageDraw.Draw(proof).text((15, 10), 'Existing97 Higgsfield front', fill='white')
ImageDraw.Draw(proof).text((645, 10), 'Exact-source tau; source-material-only reverse proof', fill='white')
proof.save(out / 'front-reverse-proof.jpg', quality=96)
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
report = {'status': 'ISOLATED PROOF; requires native exact-glyph/material QA', 'method': 'Exact original1024 reference alpha silhouette, uniformly resized only; actual Higgsfield frame816 and ivory material97, with wrong central glyph/contour field wholly covered', 'sources': records, 'exactIdentityReference': {'path': str(reference.relative_to(root)), 'sha256': reference_hash, 'originalSize': [1024, 1024], 'alphaCrop': list(logo_bounds), 'rgb': 'unmodified black source pixels', 'outputSize': list(logo.size), 'outputAt': list(logo_at), 'uniformScale': logo_width / (logo_bounds[2] - logo_bounds[0]), 'outputAlphaSha256': digest(out / 'exact-logo-output-mask.png')}, 'ivoryMaterialSourceBox': list(paper_box), 'coveredInteriorBox': list(inner_box), 'coveredInteriorRadius': 35, 'derivative': {'path': str(path.relative_to(root)), 'sha256': digest(path), 'size': list(composite.size)}, 'mastersModified': False, 'newGeneration': False}
(out / 'derivation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['derivative']))
