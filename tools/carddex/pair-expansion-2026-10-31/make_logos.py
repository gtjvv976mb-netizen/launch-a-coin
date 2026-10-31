#!/usr/bin/env python3
"""Pair logos for the 31 October 2026 pairs, by make_pair_logos.py's rule ported to Pillow (no redrawing, no recolouring).

Sources: reports/pair-expansion-2026-10-31/logo-sources/<key>-<sha12>.png, each the token's own image (its metadata
image URL, recorded in token-identities.json; W's metadata image 404s, so CoinGecko's copy; MET's SVG rendered to PNG by
macOS Quick Look and cropped to its disc). A source with more than 2% transparent pixels (alpha < 250) is centred on
the bounding box of its opaque pixels (alpha > 32) and padded so its farthest pixel sits inside 92% of the circle, on a
cream plate when it is dark (alpha-weighted luminance < 0.35) or a chocolate plate otherwise; an opaque square source is
used whole. Output: app/public/assets/pairs/<key>.webp (128 px) and <key>-64.webp (64 px), WebP quality 90, and the
rows in app/src/lib/carddex/pair-logos.json. Run from the repository root: python3 tools/carddex/pair-expansion-2026-10-31/make_logos.py
"""
import hashlib, json, pathlib
import numpy as np
from PIL import Image, features

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = "reports/pair-expansion-2026-10-31"
SRC = ROOT / EVIDENCE / "logo-sources"
OUT = ROOT / "app/public/assets/pairs"
MANIFEST = ROOT / "app/src/lib/carddex/pair-logos.json"
CREAM, CHOCOLATE = "#f3e7cf", "#26120b"
ENCODER = f"Pillow {Image.__version__} libwebp {features.version('webp')} image/webp q90"


def lin(v):
    v = v / 255
    return np.where(v <= 0.03928, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def derive(im):
    im = im.convert("RGBA"); w, h = im.size; d = np.asarray(im).astype(np.float64)
    a = d[..., 3]; tf = float((a < 250).mean()); op = a > 32
    ys, xs = np.nonzero(op)
    L = float(((0.2126 * lin(d[..., 0]) + 0.7152 * lin(d[..., 1]) + 0.0722 * lin(d[..., 2])) * a)[op].sum() / a[op].sum())
    if tf > 0.02:
        cx, cy = (xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2
        r = np.sqrt(((xs + .5 - cx) ** 2 + (ys + .5 - cy) ** 2).max()); side = 2 * r / 0.92
        mode, box = "alpha-circle", (cx - side / 2, cy - side / 2, side)
    else:
        side = min(w, h); mode = "whole" if abs(w - h) / max(w, h) < 0.03 else "cover"
        box = ((w - side) / 2, (h - side) / 2, side)
    plate = (CREAM if L < 0.35 else CHOCOLATE) if tf > 0.02 else None
    return im, mode, box, plate, tf, L


def render(im, box, plate, size):
    x, y, side = box
    # Crop with transparent padding where the circle box runs past the source, then resample once.
    pad = int(np.ceil(max(0, -x, -y, x + side - im.width, y + side - im.height))) + 1
    big = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0)); big.paste(im, (pad, pad))
    tile = big.resize((size, size), Image.LANCZOS, box=(x + pad, y + pad, x + pad + side, y + pad + side))
    base = Image.new("RGBA", (size, size), plate or (0, 0, 0, 0)); base.alpha_composite(tile)
    return base if plate or tile.getextrema()[3][0] < 255 else base.convert("RGB")


def main():
    ids = json.loads((ROOT / EVIDENCE / "token-identities.json").read_text())
    raw = MANIFEST.read_text(); rows = json.loads(raw)
    for key, ident in ids.items():
        src = next(SRC.glob(f"{key}-*.png")); data = src.read_bytes(); sha = hashlib.sha256(data).hexdigest()
        assert src.stem.endswith(sha[:12]), src
        im, mode, box, plate, tf, L = derive(Image.open(src))
        row = {"logo": f"/assets/pairs/{key}.webp"}
        for size, name, field in ((128, f"{key}.webp", "w128"), (64, f"{key}-64.webp", "w64")):
            path = OUT / name; render(im, box, plate, size).save(path, "WEBP", quality=90, method=6)
            b = path.read_bytes(); row[field] = {"path": f"/assets/pairs/{name}", "sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b)}
        row["source"] = {"folder": f"{EVIDENCE}/logo-sources", "file": src.name, "sha256": sha,
                         "record": f"{EVIDENCE}/token-identities.json#{key}.logoSourceSha256", "url": ident["icon"]}
        row["derivation"] = {"mode": mode, "crop": [round(v, 2) for v in box], "plate": plate, "sourcePx": list(im.size),
                             "upscaled": im.size[0] < 128, "resample": "lanczos", "transparentFraction": round(tf, 3),
                             "luminance": round(L, 3), "encoder": ENCODER}
        rows[key] = row
        print(f"{key:<7} {mode:<12} plate {str(plate):<8} {row['w128']['bytes']:>5} B")
    MANIFEST.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""))


if __name__ == "__main__":
    main()
