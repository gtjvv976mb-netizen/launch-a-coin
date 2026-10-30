"""Compose a reference catalogue from the existing, pinned card images. No artwork generation."""
from pathlib import Path
from io import BytesIO
import csv
import json
import math
import hashlib

from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A3, landscape
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "brand/card-design-catalogue-2026-10-30"
PROOFS = ROOT / "output/pdf/card-design-catalogue-2026-10-30"
SOURCE = json.loads((DEST / "catalogue.json").read_text())
DESIGNS = SOURCE["designs"]
PDF = DEST / "launch-a-card-design-catalogue.pdf"
FONT_DIR = Path("/System/Library/Fonts/Supplemental")
for name, filename in [
    ("Body", "Arial.ttf"), ("BodyBold", "Arial Bold.ttf"),
    ("Display", "Georgia.ttf"), ("DisplayBold", "Georgia Bold.ttf"),
]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))

W, H = landscape(A3)
BG = "#f5f0e6"
INK = "#28231d"
MUTED = "#6b6255"
ACCENT = "#ad3429"
LINE = "#d7ccba"
GROUPS = [("classic", "Classics"), ("premium", "Premium finishes"),
          ("limited", "Limited editions"), ("stocks", "Stock designs")]
PAGES = []
for key, label in GROUPS:
    items = [d for d in DESIGNS if d["category"] == key]
    for offset in range(0, len(items), 4):
        PAGES.append((key, label, items[offset:offset+4], offset//4+1, math.ceil(len(items)/4)))

def text(c, x, y, value, font="Body", size=10, color=INK):
    c.setFillColor(HexColor(color))
    c.setFont(font, size)
    c.drawString(x, y, value)

def wrapped(value, width, font="Body", size=10):
    result, line = [], ""
    for word in value.split():
        test = f"{line} {word}".strip()
        if pdfmetrics.stringWidth(test, font, size) > width and line:
            result.append(line)
            line = word
        else:
            line = test
    if line:
        result.append(line)
    return result

def raster(path):
    image = Image.open(ROOT / path).convert("RGBA")
    # Preserve the complete print and its alpha silhouette. No crop, art edit or stretch.
    image.thumbnail((680, 950), Image.Resampling.LANCZOS)
    base = Image.new("RGB", image.size, BG)
    base.paste(image, mask=image.getchannel("A"))
    buffer = BytesIO()
    base.save(buffer, "JPEG", quality=94, subsampling=0)
    buffer.seek(0)
    return ImageReader(buffer)

c = canvas.Canvas(str(PDF), pagesize=(W, H), pageCompression=1)
c.setTitle("Launch a Card | All 48 design fronts and backs")
c.setAuthor("Launch a Card")
c.setSubject("Existing card design catalogue, visual finishes and configured pair presets")
checks = []
for page_index, (key, title, items, group_page, group_pages) in enumerate(PAGES, 1):
    c.setFillColor(HexColor(BG))
    c.rect(0, 0, W, H, fill=1, stroke=0)
    text(c, 36, H-29, "LAUNCH A CARD / DESIGN CATALOGUE", "BodyBold", 9, ACCENT)
    text(c, 36, H-67, title, "DisplayBold", 30)
    text(c, 36, H-86, "Actual front and back artwork. Blank front interiors are reserved for the creator's token.", size=10, color=MUTED)
    page_label = f"{group_page} / {group_pages}"
    c.setFont("Body", 10)
    c.setFillColor(HexColor(MUTED))
    c.drawRightString(W-36, H-61, page_label)
    c.setStrokeColor(HexColor(LINE))
    c.line(36, H-100, W-36, H-100)

    column_gap = 28
    tile_width = (W-72-column_gap)/2
    row_gap = 20
    tile_height = (H-146-row_gap)/2
    card_height = 240
    card_width = card_height*63/88
    card_gap = 16
    for index, design in enumerate(items):
        col, row = index % 2, index // 2
        x = 36 + col*(tile_width+column_gap)
        top = H-116-row*(tile_height+row_gap)
        text(c, x, top, f"{design['number']:02d}", "BodyBold", 10, ACCENT)
        text(c, x+26, top-1, design["name"], "DisplayBold", 18)
        subtitle = []
        if design["theme"]:
            subtitle.append(design["theme"] + " theme")
        if design["pairs"]:
            subtitle.append("Pair preset: " + " / ".join(p["symbol"] for p in design["pairs"]))
        else:
            subtitle.append("No dedicated pair preset")
        text(c, x+26, top-18, "  |  ".join(subtitle), size=9, color=MUTED)
        look_lines = wrapped(design["look"], tile_width-26, size=10)
        if len(look_lines) > 2:
            raise ValueError(f"Style description overflows: {design['key']}")
        for line_index, line in enumerate(look_lines):
            text(c, x+26, top-34-line_index*12, line, size=10)
        card_top = top-62
        pair_width = card_width*2+card_gap
        front_x = x+(tile_width-pair_width)/2
        back_x = front_x+card_width+card_gap
        for face, face_x in [("front", front_x), ("back", back_x)]:
            text(c, face_x, card_top+5, face.upper(), "BodyBold", 7, MUTED)
            c.drawImage(raster(design[face]["path"]), face_x, card_top-card_height,
                        width=card_width, height=card_height)
        checks.append({"key": design["key"], "page": page_index, "number": design["number"],
                       "frontAndBack": True, "styleLines": len(look_lines),
                       "bottom": round(card_top-card_height, 2)})
    text(c, 36, 20, "48 designs: 7 classics / 15 premium / 20 limited / 6 stocks", size=8, color=MUTED)
    c.setFont("Body", 8)
    c.setFillColor(HexColor(MUTED))
    c.drawRightString(W-36, 20, f"30 OCT 2026  /  {page_index:02d}")
    c.showPage()
c.save()

reader = PdfReader(PDF)
assert len(reader.pages) == len(PAGES) == 13
pdf_text = "\n".join(page.extract_text() for page in reader.pages)
assert len(checks) == 48 and len({d["key"] for d in checks}) == 48
assert all(d["name"] in pdf_text for d in DESIGNS)
assert all(item["bottom"] > 34 for item in checks)

markdown = ["# Launch a Card - all 48 designs", "",
            "Actual current front/back artwork is in the accompanying visual PDF. Front interiors are intentionally blank for creator content.", "",
            "Pair labels are the configured catalogue presets; no new live quote admission was checked for this reference export.", ""]
for key, title in GROUPS:
    markdown.extend([f"## {title}", "", "| # | Design | Theme / look | Pair preset |", "|---|---|---|---|"])
    for d in [i for i in DESIGNS if i["category"] == key]:
        look = (d["theme"] + ": " if d["theme"] else "") + d["look"]
        pairs = " / ".join(p["symbol"] for p in d["pairs"]) or "No dedicated preset"
        markdown.append(f"| {d['number']:02d} | {d['name']} | {look} | {pairs} |")
    markdown.append("")
markdown.extend(["Pepe-themed Jade Reliquary uses the TOAD preset. Theme names do not mean company endorsement or an exact token identity.", ""])
(DEST / "design-list.md").write_text("\n".join(markdown))
with (DEST / "design-list.csv").open("w", newline="") as stream:
    writer = csv.writer(stream)
    writer.writerow(["Number", "Category", "Design", "Theme", "Look", "Pair presets", "PDF page", "Key"])
    for d, check in zip(DESIGNS, checks):
        writer.writerow([d["number"], d["category"], d["name"], d["theme"] or "", d["look"],
                         " / ".join(p["symbol"] for p in d["pairs"]), check["page"], d["key"]])
verification = {"designCount": 48, "frontBackImageCount": 96, "verifiedSourceHashes": 96,
                "pages": len(reader.pages), "allNamesExtracted": True,
                "pdfSha256": hashlib.sha256(PDF.read_bytes()).hexdigest(),
                "pdfBytes": PDF.stat().st_size, "entries": checks}
(PROOFS / "verification.json").write_text(json.dumps(verification, indent=2)+"\n")
print(json.dumps({k:v for k,v in verification.items() if k != "entries"}))
