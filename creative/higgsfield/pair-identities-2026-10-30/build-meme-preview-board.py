"""Display existing reviewed card assets; this does not generate decorative art."""
from pathlib import Path
import json
import hashlib
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'brand/card-design-catalogue-2026-10-30'
OUT.mkdir(parents=True, exist_ok=True)
samples = [
    ('pepe', 'PEPE', 'Flowing green enamel'),
    ('bonk', 'BONK', 'Orange impact cuts'),
    ('fartcoin', 'Fartcoin', 'ASCII terminal glass'),
    ('chillguy', 'CHILLGUY', 'Knit and denim'),
    ('moodeng', 'Moo Deng', 'Plum enamel and silver droplets'),
    ('triplet', 'TRIPLET', 'Carved timber and bat motifs'),
    ('fone', 'FONE', 'Telephone glass and bronze'),
    ('zauth', 'ZAUTH', 'Exact pixel matrix and palladium'),
]
def font(size):
    return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', size)

board = Image.new('RGB', (1776, 980), '#eee9df')
d = ImageDraw.Draw(board)
d.text((40, 26), 'A different identity. A consistent card.', font=font(36), fill='#2d251f')
d.text((40, 77), 'Selected meme pairs · Front frames and matching reverses · Local preview', font=font(19), fill='#675c50')
sources = []
for i, (key, label, detail) in enumerate(samples):
    x = 40 + (i % 4) * 434
    y = 130 + (i // 4) * 408
    d.text((x, y), label, font=font(25), fill='#2d251f')
    d.text((x, y + 35), detail, font=font(16), fill='#675c50')
    for face, offset in [('front', 0), ('back', 204)]:
        p = ROOT / ('app/public/assets/carddex/render/preview/pair-' + key + '.png' if face == 'front' else 'app/public/assets/carddex/token-backs/pair-' + key + '.png')
        im = Image.open(p).convert('RGBA')
        thumb = ImageOps.contain(im, (192, 300), Image.Resampling.LANCZOS)
        board.paste(thumb, (x + offset, y + 80 + (300 - thumb.height) // 2), thumb)
        sources.append({'design': 'pair-' + key, 'face': face, 'path': str(p.relative_to(ROOT)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
target = OUT / 'meme-identity-v2-final-preview.jpg'
board.save(target, quality=94)
(OUT / 'meme-identity-v2-final-preview-sources.json').write_text(json.dumps({'artifact': str(target.relative_to(ROOT)), 'sourceOnlyDisplay': True, 'sources': sources}, indent=2) + '\n')
print(target)
