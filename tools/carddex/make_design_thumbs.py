#!/usr/bin/env python3
"""Launch's design chooser thumbnails: a 128 px wide WebP of the card front of each design a chooser shows: SOL's
design options, and each pair with alternates (its own card and the alternates, PAIR_ALTERNATE_DESIGNS).

Reads the installed front (app/public/assets/carddex/higgsfield/<key>-front.webp), resizes it (Lanczos, aspect kept)
and writes app/public/assets/carddex/thumbs/<key>-front-128.webp. The option list is read from
app/src/lib/carddex/design-pairings.ts (SOL_DESIGN_OPTIONS and PAIR_ALTERNATE_DESIGNS), so the files always match. No other change to the art.
Run from the repository root: python3 tools/carddex/make_design_thumbs.py
"""
import pathlib, re, sys
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "app/public/assets/carddex/higgsfield"
OUT = ROOT / "app/public/assets/carddex/thumbs"
WIDTH = 128

def options():
    text = (ROOT / "app/src/lib/carddex/design-pairings.ts").read_text()
    block = re.search(r"SOL_DESIGN_OPTIONS[^=]*=\s*Object\.freeze\(\[(.*?)\]", text, re.S)
    if not block:
        sys.exit("SOL_DESIGN_OPTIONS not found")
    keys = re.findall(r'"([a-z0-9-]+)"', block.group(1))
    # Pairs with alternates (PAIR_ALTERNATE_DESIGNS) show a chooser too: the pair's own card, then its alternates.
    alts = re.search(r"PAIR_ALTERNATE_DESIGNS[^=]*=\s*Object\.freeze\(\{(.*?)\}\s*as", text, re.S)
    if not alts:
        sys.exit("PAIR_ALTERNATE_DESIGNS not found")
    for pair, listed in re.findall(r'([a-z0-9]+): \[([^\]]*)\]', alts.group(1)):
        keys += [f"pair-{pair}", *re.findall(r'"([a-z0-9-]+)"', listed)]
    return keys

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    keys = options()
    for stale in OUT.glob("*-front-128.webp"):
        if stale.name.removesuffix("-front-128.webp") not in keys:
            stale.unlink()
    for key in keys:
        image = Image.open(SRC / f"{key}-front.webp").convert("RGB")
        height = round(image.height * WIDTH / image.width)
        image.resize((WIDTH, height), Image.Resampling.LANCZOS).save(OUT / f"{key}-front-128.webp", "WEBP", quality=82, method=6)
    total = sum((OUT / f"{key}-front-128.webp").stat().st_size for key in keys)
    print(f"{len(keys)} thumbnails, {total} bytes")

if __name__ == "__main__":
    main()
