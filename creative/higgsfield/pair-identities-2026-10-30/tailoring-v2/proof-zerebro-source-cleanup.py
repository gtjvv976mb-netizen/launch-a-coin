"""Remove only incidental CA lettering with actual blank material from back560.

Isolated deterministic proof, no artwork generation or acceptance/index writes.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import hashlib
import json

creative = Path(__file__).resolve().parents[1]
root = creative.parents[2]
out = root / 'output/higgsfield/pair-identities-2026-10-30/tailoring-v2/zerebro-source-cleanup'
out.mkdir(parents=True, exist_ok=True)
ledger = json.loads((creative / 'tailoring-v2/generation-ledger.json').read_text())
def records(node):
    if isinstance(node, dict):
        if node.get('index') == 560 and node.get('sourcePath'):
            yield node
        for value in node.values():
            yield from records(value)
    elif isinstance(node, list):
        for value in node:
            yield from records(value)
record = next(records(ledger))
source_path = root / record['sourcePath']
if hashlib.sha256(source_path.read_bytes()).hexdigest() != record['sha256']:
    raise ValueError('Source560 bytes changed')
source = Image.open(source_path).convert('RGB')
assert source.size == (1664, 2496)
clean = source.copy()
sample_box = (544, 2138, 820, 2182)
target_box = (544, 2187, 820, 2355)
patch = source.crop(sample_box).resize((target_box[2] - target_box[0], target_box[3] - target_box[1]), Image.Resampling.LANCZOS)
mask = Image.new('L', patch.size, 0)
ImageDraw.Draw(mask).rectangle((4, 4, patch.width - 5, patch.height - 5), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(2))
clean.paste(patch, target_box[:2], mask)
path = out / 'zerebro-back560-ca-cleaned.png'
clean.save(path, optimize=True)
proof = Image.new('RGB', (1260, 1040), '#27231f')
for n, image in enumerate([source, clean]):
    image = image.copy()
    image.thumbnail((620, 980))
    proof.paste(image, (n * 630 + (630 - image.width) // 2, 35))
ImageDraw.Draw(proof).text((15, 10), 'Original560 - incidental CA held', fill='white')
ImageDraw.Draw(proof).text((645, 10), 'Same actual black material; CA removed', fill='white')
proof.save(out / 'before-after-proof.jpg', quality=96)
detail = Image.new('RGB', (720, 300), '#111')
for n, image in enumerate([source, clean]):
    detail.paste(image.crop((490, 2080, 850, 2380)), (n * 360, 0))
detail.save(out / 'before-after-native-detail.png')
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
report = {'status': 'ISOLATED PROOF; native CA-removal and unchanged-hero/frame QA required', 'method': 'Actual source560 blank black material crop/resize/feather over incidental CA only; no new illustration', 'sources': [{'path': record['sourcePath'], 'sha256': record['sha256'], 'jobId': record['jobId']}], 'materialSampleBox': list(sample_box), 'targetBox': list(target_box), 'mask': {'insetPixels': 4, 'featherPixels': 2}, 'derivative': {'path': str(path.relative_to(root)), 'sha256': digest(path), 'size': list(clean.size)}, 'mastersModified': False, 'newGeneration': False}
(out / 'derivation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['derivative']))
