"""Install composed faces for NEW pair designs: like hf/install.py, but creates the manifest entries (render atlas, with
--stock for stock pairs; token back; reviewed design assets; canonical-source layout) from pair-eth's / pair-aaplx's.
Usage: python3 install2.py <key> [<key> ...]   (reads out/<key>-front.png and out/<key>-back.png)"""
import json, os, sys, copy
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "premium-redesign"))
from install import A, LIB, DESIGN_ASSETS, sha, load, save, webp
from meta import PAIRS
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))

def main(keys):
    ra, ra_nl = load(f"{LIB}/render-assets.json"); tb, tb_nl = load(f"{LIB}/token-back-assets.json")
    gl, gl_nl = load(f"{LIB}/generated-layouts.json"); da, da_nl = load(DESIGN_ASSETS)
    for key in keys:
        design = f"pair-{key}"; stock = PAIRS[key][2] == "stock"
        atlas_key = design + ("--stock" if stock else "")
        front = Image.open(f"{HERE}/out/{key}-front.png").convert("RGBA"); back = Image.open(f"{HERE}/out/{key}-back.png").convert("RGBA")
        assert front.size == back.size == (1260, 1760)
        fp = f"{A}/higgsfield/{design}-front.webp"; bp = f"{A}/higgsfield/{design}-back.webp"
        webp(front, fp); webp(front, f"{A}/higgsfield/{design}-front-320.webp", (320, 447), 80)
        webp(back, bp); webp(back, f"{A}/higgsfield/{design}-back-320.webp", (320, 447), 80)
        for side in ("front", "back"):
            for w in (480, 640):
                p = f"{A}/higgsfield/{design}-{side}-{w}.webp"
                if os.path.exists(p): os.remove(p)
        atlas = f"{A}/render/{atlas_key}.png"; preview = f"{A}/render/preview/{atlas_key}.png"
        front.save(atlas, optimize=True); front.resize((320, 447), Image.LANCZOS).save(preview, optimize=True)
        tmpl = copy.deepcopy(ra["pair-aaplx--stock" if stock else "pair-eth"])
        tmpl.update(designKey=design, path=f"/assets/carddex/render/{atlas_key}.png", previewPath=f"/assets/carddex/render/preview/{atlas_key}.png",
                    sha256=sha(atlas), previewSha256=sha(preview), sourceSha256=sha(fp), width=1260, height=1760)
        ra[atlas_key] = tmpl
        tp = f"{A}/token-backs/{design}.png"; back.resize((630, 880), Image.LANCZOS).save(tp, optimize=True)
        t = copy.deepcopy(tb["pair-eth"]); t.update(designKey=design, path=f"/assets/carddex/token-backs/{design}.png", sha256=sha(tp), sourceSha256=sha(bp), width=630, height=880)
        tb[design] = t
        da[design] = {"front": {"path": f"/assets/carddex/higgsfield/{design}-front.webp", "sha256": sha(fp)},
                      "back": {"path": f"/assets/carddex/higgsfield/{design}-back.webp", "sha256": sha(bp)}}
        gl[design] = copy.deepcopy(gl["pair-eth"]); assert gl[design].get("canonicalSource") is True
        print(key, atlas_key)
    save(f"{LIB}/render-assets.json", ra, ra_nl); save(f"{LIB}/token-back-assets.json", tb, tb_nl)
    save(f"{LIB}/generated-layouts.json", gl, gl_nl); save(DESIGN_ASSETS, da, da_nl)

if __name__ == "__main__":
    main(sys.argv[1:])
