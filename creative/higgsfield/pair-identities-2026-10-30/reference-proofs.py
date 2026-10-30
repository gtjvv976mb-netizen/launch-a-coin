"""Contact sheets for inspecting original identity references, not card artwork."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib
import json

HERE = Path(__file__).resolve().parent
OUT = HERE / "reference-proofs"
OUT.mkdir(exist_ok=True)
source = json.loads((HERE / "research/reference-image-uris.json").read_text())
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
bold = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 21)
small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 13)
checked = []
for start in range(0, len(source["assets"]), 12):
    items = source["assets"][start:start+12]
    sheet = Image.new("RGB", (1280, 1020), "#ece7dc")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 14), f"EXACT IDENTITY SOURCES / {start+1}-{start+len(items)} / intake proof", font=bold, fill="#26231e")
    for i, asset in enumerate(items):
        x, y = (i%4)*320+16, (i//4)*320+57
        draw.rounded_rectangle((x, y, x+288, y+300), 10, fill="#ffffff")
        info = asset.get("referenceIntake", {})
        path = info.get("pngReferencePath") or info.get("path")
        try:
            if not path:
                raise ValueError("Source unresolved")
            file = HERE / path
            if info.get("sha256") and path == info.get("path"):
                assert hashlib.sha256(file.read_bytes()).hexdigest() == info["sha256"]
            image = Image.open(file).convert("RGBA")
            image.thumbnail((228, 218), Image.Resampling.LANCZOS)
            # Checkerboard reveals white marks without changing original reference files.
            for cy in range(y+10, y+234, 16):
                for cx in range(x+10, x+278, 16):
                    if ((cy-y)//16+(cx-x)//16)%2:
                        draw.rectangle((cx, cy, min(cx+15,x+278), min(cy+15,y+234)), fill="#e5e5e5")
            sheet.paste(image, (x+(288-image.width)//2, y+12+(218-image.height)//2), image)
            status = "Original image / visual review pending"
            checked.append({"key":asset["key"], "path":path, "sheet":start//12+1})
        except Exception as err:
            status = str(err)[:39]
            draw.text((x+16,y+105), status, font=font, fill="#b02e27")
        label = f"{start+i+1:02d}  {asset['symbol']} / {asset['key']}"
        draw.text((x+12, y+246), label, font=bold, fill="#26231e")
        draw.text((x+12, y+277), status, font=small, fill="#645c50")
    sheet.save(OUT / f"references-{start//12+1:02d}.jpg", quality=94, subsampling=0)
(OUT / "index.json").write_text(json.dumps({"purpose":"Source identity intake QA only; not new artwork or generation", "loadedCount":len(checked), "loaded":checked}, indent=2)+"\n")
print(json.dumps({"sheets":5, "loaded":len(checked), "pending":len(source['assets'])-len(checked)}))
