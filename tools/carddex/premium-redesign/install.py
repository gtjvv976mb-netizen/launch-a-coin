"""Install composed premium faces into the worktree as canonical-source pair designs.

For each key with out/<key>-front.png (and optionally out/<key>-back.png):
  higgsfield/pair-<key>-front.webp (+ -320), render/pair-<key>[--stock].png (+ preview 320), and with a back:
  higgsfield/pair-<key>-back.webp (+ -320) and token-backs/pair-<key>.png (630x880).
  The old 480/640 copies of each replaced face are removed (the variant scripts rebuild them).
  Pins: render-assets.json, token-back-assets.json, integrations/pumpfun/src/design-assets.json; layout:
  generated-layouts.json gets pair-eth's canonical-source entry.
Usage: python3 install.py <key> [<key> ...]
"""
import hashlib, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.expanduser("~/code/lac-wt-designs/app")
A = f"{APP}/public/assets/carddex"
LIB = f"{APP}/src/lib/carddex"
DESIGN_ASSETS = os.path.expanduser("~/code/lac-wt-designs/integrations/pumpfun/src/design-assets.json")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()


def load(p):
    raw = open(p).read(); return json.loads(raw), raw.endswith("\n")


def save(p, data, nl):
    open(p, "w").write(json.dumps(data, indent=2, ensure_ascii=False) + ("\n" if nl else ""))


def webp(im, path, size=None, quality=90):
    if size: im = im.resize(size, Image.LANCZOS)
    im.save(path, "WEBP", quality=quality, method=6)


def main(keys):
    ra, ra_nl = load(f"{LIB}/render-assets.json")
    tb, tb_nl = load(f"{LIB}/token-back-assets.json")
    gl, gl_nl = load(f"{LIB}/generated-layouts.json")
    da, da_nl = load(DESIGN_ASSETS)
    canonical = gl["pair-eth"]
    assert canonical.get("canonicalSource") is True
    for key in keys:
        design = f"pair-{key}"
        front = Image.open(f"{HERE}/out/{key}-front.png").convert("RGBA")
        assert front.size == (1260, 1760), (key, front.size)
        atlas_key = design + "--stock" if f"{design}--stock" in ra else design
        assert atlas_key in ra and design in tb and design in da and design in gl, key
        # Front face and its 320 copy; drop the stale 480/640 copies.
        fp = f"{A}/higgsfield/{design}-front.webp"
        webp(front, fp); webp(front, f"{A}/higgsfield/{design}-front-320.webp", (320, 447), 80)
        for w in (480, 640):
            p = f"{A}/higgsfield/{design}-front-{w}.webp"
            if os.path.exists(p): os.remove(p)
        # The flattened atlas the browser and the trusted compositor read, and its 320 preview.
        atlas = f"{A}/render/{atlas_key}.png"; preview = f"{A}/render/preview/{atlas_key}.png"
        front.save(atlas, optimize=True)
        front.resize((320, 447), Image.LANCZOS).save(preview, optimize=True)
        e = ra[atlas_key]
        e.update(sha256=sha(atlas), previewSha256=sha(preview), sourceSha256=sha(fp), width=1260, height=1760)
        da[design]["front"]["sha256"] = sha(fp)
        gl[design] = json.loads(json.dumps(canonical))
        bpath = f"{HERE}/out/{key}-back.png"
        if os.path.exists(bpath):
            back = Image.open(bpath).convert("RGBA")
            assert back.size == (1260, 1760), (key, back.size)
            bp = f"{A}/higgsfield/{design}-back.webp"
            webp(back, bp); webp(back, f"{A}/higgsfield/{design}-back-320.webp", (320, 447), 80)
            for w in (480, 640):
                p = f"{A}/higgsfield/{design}-back-{w}.webp"
                if os.path.exists(p): os.remove(p)
            tp = f"{A}/token-backs/{design}.png"
            back.resize((630, 880), Image.LANCZOS).save(tp, optimize=True)
            tb[design].update(sha256=sha(tp), sourceSha256=sha(bp), width=630, height=880)
            da[design]["back"]["sha256"] = sha(bp)
        print(key, "front", "back" if os.path.exists(bpath) else "(back kept)")
    save(f"{LIB}/render-assets.json", ra, ra_nl); save(f"{LIB}/token-back-assets.json", tb, tb_nl)
    save(f"{LIB}/generated-layouts.json", gl, gl_nl); save(DESIGN_ASSETS, da, da_nl)


if __name__ == "__main__":
    main(sys.argv[1:])
