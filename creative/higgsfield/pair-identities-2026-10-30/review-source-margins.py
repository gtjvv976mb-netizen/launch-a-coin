"""Read-only crop diagnostics for complete accepted Higgsfield source pairs.

This never changes artwork, acceptance, processing overrides or public indexes.
Each proposed wider crop still requires actual visual review before installation.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib
import json
import numpy as np

creative = Path(__file__).resolve().parent
root = creative.parents[2]
out = root / 'output/higgsfield/pair-identities-2026-10-30/integration/margin-review'
out.mkdir(parents=True, exist_ok=True)
overrides = json.loads((creative / 'normalization-overrides.json').read_text())['sources']
selected = {}
for name in ('accepted-pairs-51.json', 'accepted-pairs-38.json', 'accepted-pairs-final.json', 'accepted-pairs-tailoring-v2.json'):
    path = creative / name
    if not path.exists():
        continue
    data = json.loads(path.read_text())
    for pair in data.get('acceptedPairs', []):
        selected[pair['designKey']] = pair
    for key in data.get('revokedDesignKeys', []):
        selected.pop(key, None)

rows = []
for key, pair in selected.items():
    for face in ('front', 'back'):
        record = pair[face]
        if record.get('reviewedCrop') or record['sha256'] in overrides:
            continue
        path = root / record['sourcePath']
        if hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError(f'Accepted source bytes changed: {key} {face}')
        image = Image.open(path).convert('RGB')
        a = np.asarray(image)
        h, w = a.shape[:2]
        foreground = a.min(axis=2) < 238
        xs = np.where(foreground[int(h * .1):int(h * .9)].mean(axis=0) > .04)[0]
        ys = np.where(foreground[:, int(w * .1):int(w * .9)].mean(axis=1) > .04)[0]
        box = [max(0, int(xs[0]) - 2), max(0, int(ys[0]) - 2), min(w, int(xs[-1]) + 3), min(h, int(ys[-1]) + 3)]
        if not (box[0] > w * .025 or w - box[2] > w * .025 or box[1] > h * .025 or h - box[3] > h * .04):
            continue
        proof = out / f'{key}-{face}-{record["sha256"][:12]}.jpg'
        ImageDraw.Draw(image).rectangle(box, outline='red', width=4)
        image.thumbnail((700, 1000))
        image.save(proof, quality=94)
        rows.append({'designKey': key, 'face': face, 'masterPath': record['sourcePath'], 'masterSha256': record['sha256'], 'proposedBox': box, 'masterSize': [w, h], 'proof': str(proof.relative_to(root)), 'status': 'unreviewed-diagnostic-only'})

for page in range((len(rows) + 7) // 8):
    sheet = Image.new('RGB', (1400, 1050), '#ddd')
    draw = ImageDraw.Draw(sheet)
    for index, row in enumerate(rows[page * 8:(page + 1) * 8]):
        image = Image.open(root / row['proof'])
        image.thumbnail((330, 480))
        x, y = (index % 4) * 350, (index // 4) * 525
        sheet.paste(image, (x + (350 - image.width) // 2, y + 25))
        draw.text((x + 8, y + 5), row['designKey'] + ' ' + row['face'], fill='black')
    sheet.save(out / f'sheet-{page + 1:02}.jpg', quality=94)

(out / 'candidates.json').write_text(json.dumps({'purpose': __doc__.strip(), 'algorithm': 'same conservative foreground bounds as prepare-pair-sources.py; no crop approved', 'candidates': rows}, indent=2) + '\n')
print(json.dumps({'unreviewedCandidates': len(rows), 'out': str(out)}))
