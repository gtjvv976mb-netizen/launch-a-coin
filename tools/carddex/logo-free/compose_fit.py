"""Compose a logo-free front (owner, 1 November 2026: no logos on front corners and borders) onto the canonical layout.
Like premium-redesign/compose.py, but the generated bottom margin is fitted whole into the canonical band below the
text box (vertical-only, no horizontal warp): with no medallion in it, the purely ornamental band never gets cut by the
card's edge and has no seam. Panels are cleaned and the window refined as compose2.py does.
Usage: python3 compose_fit.py <in> <out.png> [--dark-window-prefill] [--pale-window]"""
import os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "medallion-fix"))
argv = sys.argv; sys.argv = ["x"]
import bottom as B
sys.argv = argv
C, C2 = B.C, B.C2

def compose_fit(src, prefill=False, pale=False):
    # --pale-window: the window is as bright as the panels (brightness ~200), which the default detector reads as part
    # of the gap above it; use compose2's colour-based detection (parchment vs tinted rows) instead.
    if pale: C2._detect = lambda a: None
    a = B.source(src, prefill); d = C.detect(a)
    if d is None: return None, None
    p, ratio = B.remap(a, d, 99)
    out = C.clean_panels(Image.fromarray(np.clip(p, 0, 255).astype(np.uint8)))
    if out is None: return None, ratio
    out = C2.refine_window(out)
    rgba = out.convert("RGBA"); rgba.putalpha(C.rounded_alpha((C.W, C.H), C.RADIUS))
    return rgba, ratio

if __name__ == "__main__":
    img, ratio = compose_fit(sys.argv[1], "--dark-window-prefill" in sys.argv, "--pale-window" in sys.argv)
    if img is None: print(f"{sys.argv[1]}: panels not found", file=sys.stderr); sys.exit(2)
    img.save(sys.argv[2]); print(sys.argv[2], "ok, bottom ratio", round(ratio, 2))
