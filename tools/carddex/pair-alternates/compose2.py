"""compose.py plus two fallbacks: a pale picture window (panel detector expects a darker window: here the window is the
longest smooth run between the title and type bars, bright or not), and --plain-window, which refills the canonical
window rect (inset inside its rim) with a smooth gradient of its own median tones (for a starfield the step scan can't read).
Also --dark-window-prefill (fill the stars of a dark starfield window in the source before detection, so the panels
are found where they are), --keep-type (leave the type bar's generated pixels as they are), and, for every front, a
window refine that carries the window fill out to the rim through smooth rows of the window's own colour (a pale bevel
band the step scan stopped at).
Usage: python3 compose2.py front <in> <out.png> [--plain-window] [--dark-window-prefill] [--keep-type]"""
import sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "premium-redesign"))
import compose as C

_detect = C.detect
def detect(a):
    d = _detect(a)
    if d is not None: return d
    h, w = a.shape[:2]; lum = a @ [.299, .587, .114]
    # Separate panels by colour: the parchment's own tone (sampled in the text box) versus a pale tinted window.
    # Side bands only: a jewel in the middle of a bar must not hide that bar.
    band = np.concatenate([a[:, int(.2 * w):int(.4 * w)], a[:, int(.6 * w):int(.8 * w)]], 1); med = np.median(band, 1); sd = (band @ [.299, .587, .114]).std(1)
    ivory = np.median(band[int(.7 * h):int(.84 * h)].reshape(-1, 3), 0)
    parch = (np.linalg.norm(med - ivory, axis=1) < 30) & (sd < 22)
    tinted = (np.linalg.norm(med - ivory, axis=1) >= 16) & (sd < 30)
    P = [r for r in C.runs(parch, max(6, h // 200)) if r[0] > .015 * h and r[1] < .985 * h]
    tops = [r for r in P if r[0] < .2 * h and r[1] - r[0] < .09 * h]
    bottoms = [r for r in P if r[0] > .5 * h]
    if not tops or not bottoms: return None
    name = tops[0]; text = max(bottoms, key=lambda r: r[1] - r[0])
    above = [r for r in P if name[1] < r[0] and r[1] <= text[0] and r[0] > .45 * h]
    if not above: return None
    typ = above[-1]
    win = [r for r in C.runs(tinted[name[1]:typ[0]], h // 20)]
    win = [(s + name[1], e + name[1]) for s, e in win]
    if not win: return None
    art = max(win, key=lambda r: r[1] - r[0])
    # A rim between the title bar and the window is 'tinted' too: trim the run to rows of the window's own colour.
    mid = np.median(med[art[0] + (art[1] - art[0]) // 3:art[1] - (art[1] - art[0]) // 3], 0)
    near = np.linalg.norm(med[art[0]:art[1]] - mid, axis=1) < 25
    idx = np.nonzero(near)[0]
    art = (art[0] + int(idx[0]), art[0] + int(idx[-1]) + 1)
    def edges(y, f):
        row = lum[y]; c = w // 2; l = c; r = c
        while l > 0 and f(row[l]): l -= 1
        while r < w - 1 and f(row[r]): r += 1
        return l + 1, r
    ref = np.median(lum[(text[0] + text[1]) // 2, int(.45 * w):int(.55 * w)])
    l, r = edges((text[0] + text[1]) // 2, lambda v: abs(v - ref) < 40)
    if not (.03 * w < l < .2 * w and .8 * w < r < .97 * w): return None
    return {"name": name, "art": art, "type": typ, "text": text, "x": (l, r)}
C.detect = detect

def plain_window(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32); W, H = C.W, C.H
    x0, x1 = round(C.CANON_X[0] * W) + 14, round(C.CANON_X[1] * W) - 14
    y0, y1 = round(C.CANON_Y["art"][0] * H) + 14, round(C.CANON_Y["art"][1] * H) - 14
    reg = a[y0:y1, x0:x1]; hh = y1 - y0
    top = np.median(reg[:hh // 3].reshape(-1, 3), 0); bot = np.median(reg[-hh // 3:].reshape(-1, 3), 0)
    v = np.linspace(0, 1, hh)[:, None, None]
    a[y0:y1, x0:x1] = top * (1 - v) + bot * v
    # The generated window can run past the canonical bottom (the scan stopped at a star): extend the fill down
    # through any rows that are still dark window, never into the rim.
    lum = a @ np.array([.299, .587, .114], np.float32)
    y = y1
    while y < y1 + 90 and np.median(lum[y, x0 + 40:x1 - 40]) < 60:
        a[y, x0:x1] = bot; y += 1
    y = y0 - 1
    while y > y0 - 90 and np.median(lum[y, x0 + 40:x1 - 40]) < 60:
        a[y, x0:x1] = top; y -= 1
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def prefill_dark_window(im):
    """Stars in a dark window: holes in its dark mask, filled with the window's own median."""
    from scipy import ndimage
    a = np.asarray(im.convert("RGB")).astype(np.float32); h, w = a.shape[:2]
    lum = a @ np.array([.299, .587, .114], np.float32)
    dark = lum < 45
    lab, _ = ndimage.label(dark); c = lab[int(.3 * h), w // 2]
    if not c: return im
    comp = lab == c; filled = ndimage.binary_fill_holes(comp)
    # Stars touching the bottom or sides leave notches: close them first.
    filled = ndimage.binary_fill_holes(ndimage.binary_closing(filled, iterations=6)) & ndimage.binary_dilation(comp, iterations=6)
    med = np.median(a[comp], 0)
    a[filled & ~comp] = med
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

def refine_window(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32); W, H = C.W, C.H
    x0, x1 = round(C.CANON_X[0] * W) + 10, round(C.CANON_X[1] * W) - 10
    y0, y1 = round(C.CANON_Y["art"][0] * H), round(C.CANON_Y["art"][1] * H)
    mid = a[y0 + 40:y1 - 40, x0 + 40:x1 - 40]
    ref = np.median(mid.reshape(-1, 3), 0)
    rows = lambda y: a[y, x0 + 60:x1 - 60]
    def similar(y): r = rows(y); return np.linalg.norm(np.median(r, 0) - ref) < 110 and r.std(0).max() < 30
    top = y0 + 40
    while top > y0 - 50 and similar(top - 1): top -= 1
    bot = y1 - 40
    while bot < y1 + 50 and similar(bot): bot += 1
    hh = bot - top
    t = np.median(a[top + 25:top + 45, x0 + 60:x1 - 60].reshape(-1, 3), 0); b2 = np.median(a[bot - 45:bot - 25, x0 + 60:x1 - 60].reshape(-1, 3), 0)
    v = np.linspace(0, 1, hh)[:, None, None]
    # Columns: carry out to the rim the same way, row by row in the band.
    l = x0 + 40
    while l > x0 - 40 and np.linalg.norm(np.median(a[top + 20:bot - 20, l - 1], 0) - ref) < 70 and a[top + 20:bot - 20, l - 1].std(0).max() < 30: l -= 1
    r = x1 - 40
    while r < x1 + 40 and np.linalg.norm(np.median(a[top + 20:bot - 20, r], 0) - ref) < 70 and a[top + 20:bot - 20, r].std(0).max() < 30: r += 1
    grad = t * (1 - v) + b2 * v
    a[top:bot, l:r] = np.broadcast_to(grad, (hh, r - l, 3))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

if __name__ == "__main__":
    kind, src, dst = sys.argv[1:4]
    if "--keep-type" in sys.argv:
        _clean = C.clean_panels
        def clean_without_type(out):
            full = C.CANON_Y; C.CANON_Y = {k: v for k, v in full.items() if k != "type"}
            try: return _clean(out)
            finally: C.CANON_Y = full
        C.clean_panels = clean_without_type
    raw = Image.open(src)
    if "--dark-window-prefill" in sys.argv: raw = prefill_dark_window(raw)
    out = C.front(raw) if kind == "front" else C.back(raw)
    if out is None: print(f"{src}: panels not found", file=sys.stderr); sys.exit(2)
    if "--plain-window" in sys.argv: out = plain_window(out)
    if kind == "front": out = refine_window(out)
    rgba = out.convert("RGBA"); rgba.putalpha(C.rounded_alpha((C.W, C.H), C.RADIUS)); rgba.save(dst)
    print(dst, "ok")
