/** Release utility: 480 and 640 px WebP copies of every flattened card skin (PERF image variants), written beside its
 * 320 px preview as preview/<key>-480.webp and preview/<key>-640.webp. Made like the higgsfield copies: Lanczos from
 * the 1260 px atlas PNG, WebP q80 method 6, alpha kept for the rounded edge. The atlas PNGs and their manifest are
 * unchanged (the trusted compositor still reads only the PNG); src/lib/carddex/render-variants.json records which
 * atlas each copy was made from, so a test catches stale copies.
 * Requires Python/Pillow with WebP. Run from app/: bun scripts/card-skin-variants.ts (prepare-card-skins.ts runs it).
 */
const code = `from pathlib import Path
from PIL import Image
import json, hashlib
manifest = json.loads(Path('src/lib/carddex/render-assets.json').read_text())
variants = {}
for key, asset in manifest.items():
    atlas = Path('public' + asset['path'])
    image = Image.open(atlas).convert('RGBA')
    entry = {'atlasSha256': hashlib.sha256(atlas.read_bytes()).hexdigest()}
    for width in (480, 640):
        out = Path('public' + asset['previewPath'][:-len('.png')] + f'-{width}.webp')
        height = round(width * image.height / image.width)
        image.resize((width, height), Image.Resampling.LANCZOS).save(out, 'WEBP', quality=80, method=6)
        entry[f'w{width}'] = {'path': '/' + str(out.relative_to('public')), 'width': width, 'height': height, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}
    variants[key] = entry
Path('src/lib/carddex/render-variants.json').write_text(json.dumps(variants, indent=2) + '\\n')
print({'variants': len(variants) * 2})`;
const python = Bun.spawn(["python3", "-c", code], { stdout: "inherit", stderr: "inherit" });
if (await python.exited !== 0) throw new Error("Failed: python3 (card skin variants)");
