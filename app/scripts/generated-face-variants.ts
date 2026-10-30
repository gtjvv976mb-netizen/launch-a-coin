/** Release utility: the 480 and 640 px WebP copies of each card face (front and back) that the srcsets ask for
 * (generated-assets.ts generatedSrcSet), written beside its 320 px copy as <face>-480.webp and <face>-640.webp. Made
 * like the earlier copies: Lanczos from the full-size WebP, WebP q80 method 6, alpha kept. Deterministic resizes of the
 * delivered pixels, not new art.
 * --missing (the only mode): a copy already on disk is never rewritten, so the earlier designs' bytes never change.
 * Requires Python/Pillow with WebP. Run from app/: bun scripts/generated-face-variants.ts --missing
 */
import { CARD_GENERATED_ASSETS } from "../src/lib/carddex/generated-assets";

if (!process.argv.includes("--missing")) throw new Error("Run with --missing: existing copies are never rewritten.");
const faces: [string, string][] = [];
for (const assets of Object.values(CARD_GENERATED_ASSETS)) {
  if (assets?.front && assets.front320) faces.push([assets.front, assets.front320]);
  if (assets?.back && assets.back320) faces.push([assets.back, assets.back320]);
}
const code = `from pathlib import Path
from PIL import Image
import json, sys
faces = json.loads(sys.stdin.read())
made = kept = 0
for full, small in faces:
    source = Path('public' + full)
    image = None
    for width in (480, 640):
        out = Path('public' + small[:-len('-320.webp')] + f'-{width}.webp')
        if out.exists():
            kept += 1
            continue
        if image is None:
            image = Image.open(source)
            image = image.convert('RGBA' if image.mode in ('RGBA', 'LA', 'P') or 'A' in image.getbands() else 'RGB')
        height = round(width * image.height / image.width)
        image.resize((width, height), Image.Resampling.LANCZOS).save(out, 'WEBP', quality=80, method=6)
        made += 1
print({'faces': len(faces), 'made': made, 'kept': kept})`;
const python = Bun.spawn(["python3", "-c", code], { stdin: new TextEncoder().encode(JSON.stringify(faces)), stdout: "inherit", stderr: "inherit" });
if (await python.exited !== 0) throw new Error("Failed: python3 (face variants)");
