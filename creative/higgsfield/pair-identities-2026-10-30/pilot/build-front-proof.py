from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import hashlib, json

PROJECT = Path(__file__).resolve().parents[4]
PILOT = Path(__file__).resolve().parent
MASTERS = PROJECT / "output/higgsfield/pair-identities-2026-10-30/originals"
KEYS = ["sol", "tslax", "doge", "pnut"]
board = Image.new("RGB", (1920, 790), "#f3eee7")
draw = ImageDraw.Draw(board)
draw.text((20, 14), "Actual Higgsfield front masters — pending parent visual review; backs not submitted", fill="#201b18")
for i, key in enumerate(KEYS):
    x = i * 480 + 20
    draw.text((x, 43), key.upper(), fill="#201b18")
    with Image.open(MASTERS / f"{key}-front.png") as source:
        thumb = ImageOps.contain(source.convert("RGB"), (440, 700), Image.Resampling.LANCZOS)
    board.paste(thumb, (x + (440 - thumb.width) // 2, 70))
output = PILOT / "front-contact-proof.png"
board.save(output)
print(json.dumps({"path": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}))
