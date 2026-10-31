"""Install alternate pair cards (owner, 1 November 2026): for each alternate in plan.py, the composed faces in
<out>/<pair>-alt-<n>-{front,back}.png become design pair-<pair>-alt<n>: higgsfield front/back (+ 320), the flat atlas
and its 320 preview (plain key: alternates are meme pairs), the 630x880 token back, and new entries in render-assets,
token-back-assets, generated-layouts (pair-eth's canonical-source layout), integrations/pumpfun design-assets, a
pair-designs.json row (appended, bound to the pair; palette = [the window's colour, an accent, the text box's paper]
sampled from the front) and generated-assets.ts paths. It only creates: a key already in any manifest stops the run.
List the keys in design-pairings.ts PAIR_ALTERNATE_DESIGNS in the same commit, then run app/scripts/card-skin-variants.ts
--missing, generated-face-variants.ts --missing and tools/carddex/make_design_thumbs.py.
Usage: python3 install.py <composed-out-dir>
"""
import json, os, sys, copy
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "premium-redesign"))
from install import webp, sha, load, save
from alt_plan import ALTS, WHO
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
A = f"{ROOT}/app/public/assets/carddex"; LIB = f"{ROOT}/app/src/lib/carddex"
DESIGN_ASSETS = f"{ROOT}/integrations/pumpfun/src/design-assets.json"
W, H = 1260, 1760
hexc = lambda c: "#%02X%02X%02X" % tuple(int(round(v)) for v in c)


def main(out):
    ra, ra_nl = load(f"{LIB}/render-assets.json"); tb, tb_nl = load(f"{LIB}/token-back-assets.json")
    gl, gl_nl = load(f"{LIB}/generated-layouts.json"); da, da_nl = load(DESIGN_ASSETS)
    pd, pd_nl = load(f"{LIB}/pair-designs.json"); staged = {d["key"]: d for d in pd}
    ga_path = f"{LIB}/generated-assets.ts"; ga = open(ga_path).read()
    for (pair, n), (style, materials, *_rest) in ALTS.items():
        key = f"pair-{pair}-alt{n}"
        assert key not in ra and key not in tb and key not in gl and key not in da and key not in staged and f'"{key}":' not in ga, key
        main_row = staged[f"pair-{pair}"]
        front = Image.open(f"{out}/{pair}-alt-{n}-front.png").convert("RGBA"); back = Image.open(f"{out}/{pair}-alt-{n}-back.png").convert("RGBA")
        assert front.size == back.size == (W, H), key
        fp = f"{A}/higgsfield/{key}-front.webp"; bp = f"{A}/higgsfield/{key}-back.webp"
        webp(front, fp); webp(front, f"{A}/higgsfield/{key}-front-320.webp", (320, 447), 80)
        webp(back, bp); webp(back, f"{A}/higgsfield/{key}-back-320.webp", (320, 447), 80)
        atlas = f"{A}/render/{key}.png"; preview = f"{A}/render/preview/{key}.png"
        front.save(atlas, optimize=True); front.resize((320, 447), Image.LANCZOS).save(preview, optimize=True)
        e = copy.deepcopy(ra["pair-eth"]); e.update(designKey=key, path=f"/assets/carddex/render/{key}.png", previewPath=f"/assets/carddex/render/preview/{key}.png",
                                                  sha256=sha(atlas), previewSha256=sha(preview), sourceSha256=sha(fp), width=W, height=H)
        ra[key] = e
        tp = f"{A}/token-backs/{key}.png"; back.resize((630, 880), Image.LANCZOS).save(tp, optimize=True)
        t = copy.deepcopy(tb["pair-eth"]); t.update(designKey=key, path=f"/assets/carddex/token-backs/{key}.png", sha256=sha(tp), sourceSha256=sha(bp), width=630, height=880)
        tb[key] = t
        da[key] = {"front": {"path": f"/assets/carddex/higgsfield/{key}-front.webp", "sha256": sha(fp)},
                   "back": {"path": f"/assets/carddex/higgsfield/{key}-back.webp", "sha256": sha(bp)}}
        gl[key] = copy.deepcopy(gl["pair-eth"]); assert gl[key].get("canonicalSource") is True
        a = np.asarray(front.convert("RGB")).astype(float)
        win = np.median(a[int(.2 * H):int(.54 * H), int(.15 * W):int(.85 * W)].reshape(-1, 3), 0)
        paper = np.median(a[int(.72 * H):int(.88 * H), int(.2 * W):int(.8 * W)].reshape(-1, 3), 0)
        prefix = main_row["name"].removesuffix(" Signature")
        pd.append({"key": key, "quoteKey": pair, "name": f"{prefix} {style}", "description": f"{prefix} in {materials}.",
                   "category": "memes", "materialLevel": 14, "palette": [hexc(win), main_row["palette"][1], hexc(paper)],
                   "finish": "holo", "quoteMint": main_row["quoteMint"]})
        line = f'  "{key}": {{"front":"/assets/carddex/higgsfield/{key}-front.webp","back":"/assets/carddex/higgsfield/{key}-back.webp","front320":"/assets/carddex/higgsfield/{key}-front-320.webp","back320":"/assets/carddex/higgsfield/{key}-back-320.webp"}},'
        # Append inside CARD_GENERATED_ASSETS, before its closing "};", keeping a comma after every entry but the last.
        head, sep, tail = ga.partition("\n};\n")
        assert sep, "CARD_GENERATED_ASSETS end not found"
        ga = head.rstrip(",") + ",\n" + line.rstrip(",") + sep + tail
        print(key, pd[-1]["name"])
    save(f"{LIB}/render-assets.json", ra, ra_nl); save(f"{LIB}/token-back-assets.json", tb, tb_nl)
    save(f"{LIB}/generated-layouts.json", gl, gl_nl); save(DESIGN_ASSETS, da, da_nl); save(f"{LIB}/pair-designs.json", pd, pd_nl)
    open(ga_path, "w").write(ga)


if __name__ == "__main__":
    main(sys.argv[1])
