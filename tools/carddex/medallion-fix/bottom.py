"""Recompose only the bottom border of a composed front from its source, with the whole medallion kept round:
the source's full bottom margin is fitted into the canonical .925-1.0 band (vertical factor 1/ratio) and the band's
centre zone is narrowed by the same factor (round_medallion), ramped in under the text box's rim. Rows above the band
are the installed front's, untouched."""
import sys, os, json, numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ.get("CARD_SOURCES", os.path.dirname(HERE))  # the session folder that holds hf/, pairs/, alts/ raw and out
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pair-alternates"))
argv = sys.argv; sys.argv = ["x"]
import compose2 as C2
sys.argv = argv
C = C2.C
H, W = C.H, C.W
YT = round(C.CANON_Y["text"][1] * H)

def remap(a, d, k):
    h, w = a.shape[:2]
    sy = (d["text"][1] - d["name"][0]) / ((C.CANON_Y["text"][1] - C.CANON_Y["name"][0]) * H)
    top = max(0, d["name"][0] - C.CANON_Y["name"][0] * H * sy)
    bot = min(h, d["text"][1] + k * (1 - C.CANON_Y["text"][1]) * H * sy)
    sx = (d["x"][1] - d["x"][0]) / ((C.CANON_X[1] - C.CANON_X[0]) * W)
    left = max(0, d["x"][0] - C.CANON_X[0] * W * sx); right = min(w, d["x"][1] + (1 - C.CANON_X[1]) * W * sx)
    ys = [top]; yd = [0]
    for kk in ("name", "art", "type", "text"): ys += list(d[kk]); yd += [C.CANON_Y[kk][0] * H, C.CANON_Y[kk][1] * H]
    ys.append(bot); yd.append(H)
    my = C.remap_axis(h, ys, H, yd); mx = C.remap_axis(w, [left, d["x"][0], d["x"][1], right], W, [0, C.CANON_X[0] * W, C.CANON_X[1] * W, W])
    y0 = np.clip(np.floor(my).astype(int), 0, h - 2); fy = np.clip(my - y0, 0, 1)[:, None, None]
    x0 = np.clip(np.floor(mx).astype(int), 0, w - 2); fx = np.clip(mx - x0, 0, 1)[None, :, None]
    p = (a[y0][:, x0] * (1 - fx) + a[y0][:, x0 + 1] * fx) * (1 - fy) + (a[y0 + 1][:, x0] * (1 - fx) + a[y0 + 1][:, x0 + 1] * fx) * fy
    ratio = (h - d["text"][1]) / ((1 - C.CANON_Y["text"][1]) * H * sy)
    return p, ratio

def round_medallion(a, ratio, c=1.15, ramp=24):
    a = a.copy(); band = H - YT; s = 1 / ratio; cx = W / 2
    Rd = min(cx - 40, band / 2 / s * c); Rc = Rd * s
    x = np.arange(W, dtype=np.float32)
    g = np.where(np.abs(x - cx) <= Rc, cx + (x - cx) / s, np.where(x < cx, x * (cx - Rd) / (cx - Rc), W - (W - x) * (cx - Rd) / (cx - Rc)))
    for y in range(YT, H):
        b = min(1.0, (y - YT) / ramp); xs = (1 - b) * x + b * g
        x0 = np.clip(np.floor(xs).astype(int), 0, W - 2); fx = (xs - x0)[:, None]
        a[y] = a[y, x0] * (1 - fx) + a[y, x0 + 1] * fx
    return a

def source(raw, prefill):
    im = Image.open(raw)
    if prefill: im = C2.prefill_dark_window(im)
    return np.asarray(im.convert("RGB")).astype(np.float32)

def fixed_front(raw, installed_png, prefill=False):
    a = source(raw, prefill); d = C.detect(a)
    if d is None: raise SystemExit(f"{raw}: panels not found")
    old = np.asarray(Image.open(installed_png).convert("RGBA")).astype(np.float32)
    cur, _ = remap(a, d, 1.0)
    # The seam check: below the text box's cleaned edge, the replayed current band must be the installed one.
    y = round(.94 * H); seam = float(np.abs(cur[y:y + 12] - old[y:y + 12, :, :3]).mean())
    full, ratio = remap(a, d, 99)
    band = round_medallion(full, ratio)
    out = old.copy(); out[YT:, :, :3] = band[YT:]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA"), seam, ratio

if __name__ == "__main__":
    # map.json: [source folder, source name, design key, status] per composed front (each composed out/<name>-front.png
    # matched against its pinned front); outputs go to $CARD_SOURCES/medal/fixed.
    OUT = f"{S}/medal"; rows = json.load(open(f"{OUT}/map.json")); res = []
    os.makedirs(f"{OUT}/fixed", exist_ok=True)
    for src, n, key, status in rows:
        raw = f"{S}/{src}/raw/{n}-front.png"; inst = f"{S}/{src}/out/{n}-front.png"
        img, seam, ratio = fixed_front(raw, inst, prefill=(n == "doge-alt-2"))
        img.putalpha(C.rounded_alpha((W, H), C.RADIUS)); img.save(f"{OUT}/fixed/{key}-front.png")
        res.append((key, round(seam, 2), round(ratio, 2)))
        print(key, round(seam, 2), round(ratio, 2), flush=True)
    json.dump(res, open(f"{OUT}/fixed.json", "w"))
