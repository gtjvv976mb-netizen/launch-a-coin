"""Turn a generated full-bleed card image into a canonical Launch a Card face.

front: find the generated panels (title bar, picture window, type bar, text box), remap the image piecewise so each
panel edge lands on its canonical rect (name .055-.115, art .15-.59, type .615-.649, text .67-.925; x .1-.9), then
clean each panel's inside (parchment, or a smooth tinted window) a few px inside its generated rim, and round the
card corners (radius .0504 W). Exits 2 when the panels can't be found (regenerate).
back: crop to 63:88 around the centre, resize, round the corners.
Usage: python3 compose.py front|back <in> <out.png>
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1260, 1760
CANON_Y = {"name": (.055, .115), "art": (.15, .59), "type": (.615, .649), "text": (.67, .925)}
CANON_X = (.1, .9)
RADIUS = round(.0504 * W)


def rounded_alpha(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m


def runs(mask, min_len):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s >= min_len: out.append((s, i))
            s = None
    if s is not None and len(mask) - s >= min_len: out.append((s, len(mask)))
    return out


def detect(a):
    """Panel rows and the panels' left/right edges in source pixels, or None."""
    h, w = a.shape[:2]
    lum = a @ [.299, .587, .114]
    band = lum[:, int(.32 * w):int(.68 * w)]
    rowm = np.median(band, 1)
    rowsd = band.std(1)
    bright = runs((rowm > 196) & (rowsd < 22), max(6, h // 200))
    if len(bright) < 3: return None
    # The title bar is the first bright run in the top fifth; the text box the tallest in the bottom half; the type
    # bar the last bright run above the text box.
    # A light frame can read as a bright run too; panels never touch the card's edge, so runs that do are frame.
    bright = [r for r in bright if r[0] > .015 * h and r[1] < .985 * h]
    tops = [r for r in bright if r[0] < .2 * h and r[1] - r[0] < .09 * h]
    bottoms = [r for r in bright if r[0] > .5 * h]
    if not tops or not bottoms: return None
    name = tops[0]
    text = max(bottoms, key=lambda r: r[1] - r[0])
    above = [r for r in bright if name[1] < r[0] and r[1] <= text[0] and r[0] > .4 * h]
    if not above: return None
    typ = above[-1]
    # The picture window: the longest smooth, non-bright run between the title bar and the type bar.
    mid = (rowsd < 30) & (rowm <= 196)
    win = [(s + name[1], e + name[1]) for s, e in runs(mid[name[1]:typ[0]], h // 20)]
    if not win: return None
    art = max(win, key=lambda r: r[1] - r[0])
    # Left and right panel edges along the text box's middle row (and the window's, for a check).
    def edges(y, thresh_fn):
        row = lum[y]; c = w // 2; l = c; r = c
        while l > 0 and thresh_fn(row[l]): l -= 1
        while r < w - 1 and thresh_fn(row[r]): r += 1
        return l + 1, r
    ref = np.median(lum[(text[0] + text[1]) // 2, int(.45 * w):int(.55 * w)])
    l, r = edges((text[0] + text[1]) // 2, lambda v: abs(v - ref) < 40)
    if not (.03 * w < l < .2 * w and .8 * w < r < .97 * w): return None
    return {"name": name, "art": art, "type": typ, "text": text, "x": (l, r)}


def remap_axis(src_len, src_knots, dst_len, dst_knots):
    """For each destination pixel, its source coordinate (piecewise linear through the knots)."""
    return np.interp(np.arange(dst_len) + .5, np.array(dst_knots) * 1.0, np.array(src_knots) * 1.0) - .5


def front(im):
    im = im.convert("RGB")
    a = np.asarray(im).astype(np.float32)
    d = detect(a)
    if d is None: return None
    h, w = a.shape[:2]
    # Crop around the panels so the outer border keeps its proportions (clamped to the image), then pin every panel
    # edge to its canonical row.
    sy = (d["text"][1] - d["name"][0]) / ((CANON_Y["text"][1] - CANON_Y["name"][0]) * H)
    top = max(0, d["name"][0] - CANON_Y["name"][0] * H * sy)
    bot = min(h, d["text"][1] + (1 - CANON_Y["text"][1]) * H * sy)
    sx = (d["x"][1] - d["x"][0]) / ((CANON_X[1] - CANON_X[0]) * W)
    left = max(0, d["x"][0] - CANON_X[0] * W * sx)
    right = min(w, d["x"][1] + (1 - CANON_X[1]) * W * sx)
    ys = [top]; yd = [0]
    for k in ("name", "art", "type", "text"):
        ys += list(d[k]); yd += [CANON_Y[k][0] * H, CANON_Y[k][1] * H]
    ys.append(bot); yd.append(H)
    my = remap_axis(h, ys, H, yd)
    mx = remap_axis(w, [left, d["x"][0], d["x"][1], right], W, [0, CANON_X[0] * W, CANON_X[1] * W, W])
    # Bilinear sample.
    y0 = np.clip(np.floor(my).astype(int), 0, h - 2); fy = np.clip(my - y0, 0, 1)[:, None, None]
    x0 = np.clip(np.floor(mx).astype(int), 0, w - 2); fx = np.clip(mx - x0, 0, 1)[None, :, None]
    p = (a[y0][:, x0] * (1 - fx) + a[y0][:, x0 + 1] * fx) * (1 - fy) + (a[y0 + 1][:, x0] * (1 - fx) + a[y0 + 1][:, x0 + 1] * fx) * fy
    out = Image.fromarray(np.clip(p, 0, 255).astype(np.uint8))
    return clean_panels(out)


def clean_panels(out):
    """Smooth each generated panel's own interior (the connected run of panel-coloured pixels around the canonical
    rect's centre), so its generated rim stays exactly as drawn and nothing is painted over the frame."""
    from scipy import ndimage
    a = np.asarray(out).astype(np.float32)
    res = a.copy()
    rng = np.random.default_rng(7)
    for k, (y0f, y1f) in CANON_Y.items():
        # Search a little beyond the canonical rect; the panel's own edge decides where the fill stops.
        x0, x1 = round((CANON_X[0] - .03) * W), round((CANON_X[1] + .03) * W)
        y0, y1 = max(0, round((y0f - .012) * H)), min(H, round((y1f + .012) * H))
        cy, cx = round((y0f + y1f) / 2 * H) - y0, W // 2 - x0
        reg = a[y0:y1, x0:x1]
        core = reg[max(0, cy - 6):cy + 6, cx - 150:cx + 150].reshape(-1, 3)
        ref = np.median(core, 0)
        tol = 70 if k == "art" else 26
        near = np.linalg.norm(reg - ref, axis=2) < tol
        lab, _ = ndimage.label(near)
        comp = lab == lab[cy, cx]
        if not comp[cy, cx]: return None
        comp = ndimage.binary_fill_holes(comp)
        if k == "art":
            # Generated windows are rectangles bounded by a sharp rim; a vignette is gradual. Scan out from the centre
            # to the first sharp step on each side and fill that whole rectangle, vignette included.
            L = ndimage.gaussian_filter(reg @ np.array([.299, .587, .114], np.float32), 1.2)
            def step(line, c, d):
                i = c
                while 3 <= i < len(line) - 3:
                    if abs(line[i + 3 * d] - line[i]) > 28: return i
                    i += d
                return i
            mids = [cy + o for o in (-60, 0, 60)]; midx = [cx + o for o in (-200, 0, 200)]
            left = int(np.median([step(L[y], cx, -1) for y in mids])); right = int(np.median([step(L[y], cx, 1) for y in mids]))
            top = int(np.median([step(L[:, x], cy, -1) for x in midx])); bottom = int(np.median([step(L[:, x], cy, 1) for x in midx]))
            box = np.zeros_like(comp)
            box[top + 2:bottom - 1, left + 2:right - 1] = True
            comp = box
        comp = ndimage.binary_erosion(comp, iterations=3)
        bh, bw = comp.shape
        if k == "art":
            # A smooth version of the window from its own interior only (no rim colour pulled in).
            ys, xs = np.nonzero(comp)
            q = lambda m: np.median(reg[m], 0) if m.any() else ref
            midx, midy = xs.mean(), ys.mean()
            tl = q(comp & (np.arange(bw)[None] < midx) & (np.arange(bh)[:, None] < midy))
            tr = q(comp & (np.arange(bw)[None] >= midx) & (np.arange(bh)[:, None] < midy))
            bl = q(comp & (np.arange(bw)[None] < midx) & (np.arange(bh)[:, None] >= midy))
            br = q(comp & (np.arange(bw)[None] >= midx) & (np.arange(bh)[:, None] >= midy))
            u = np.linspace(0, 1, bw)[None, :, None]; v = np.linspace(0, 1, bh)[:, None, None]
            fill = (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v
        else:
            base = ref if ref @ [.299, .587, .114] >= 222 else np.array([241, 234, 219], np.float32)
            base = np.clip(base, [226, 218, 198], 250)
            noise = rng.normal(0, 1, (bh // 4 + 1, bw // 4 + 1)).astype(np.float32)
            noise = np.asarray(Image.fromarray(noise).resize((bw, bh), Image.BICUBIC))
            fill = np.clip(base[None, None, :] + noise[..., None] * 2.0, 0, 255)
        # Feather the edge of the fill into the panel's own pixels.
        alpha = ndimage.gaussian_filter(comp.astype(np.float32), 1.5)[..., None]
        res[y0:y1, x0:x1] = res[y0:y1, x0:x1] * (1 - alpha) + fill * alpha
    return Image.fromarray(np.clip(res, 0, 255).astype(np.uint8))


def back(im):
    im = im.convert("RGB")
    w, h = im.size
    nh = round(w / (63 / 88))
    if nh <= h:
        t = (h - nh) // 2; im = im.crop((0, t, w, t + nh))
    else:
        nw = round(h * 63 / 88); l = (w - nw) // 2; im = im.crop((l, 0, l + nw, h))
    return im.resize((W, H), Image.LANCZOS)


def main():
    kind, src, dst = sys.argv[1:4]
    im = Image.open(src)
    out = front(im) if kind == "front" else back(im)
    if out is None:
        print(f"{src}: panels not found", file=sys.stderr); sys.exit(2)
    rgba = out.convert("RGBA")
    rgba.putalpha(rounded_alpha((W, H), RADIUS))
    rgba.save(dst)


if __name__ == "__main__":
    main()
