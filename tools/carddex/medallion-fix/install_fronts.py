"""Install recomposed fronts (bottom medallion fix, 1 November 2026) for existing design keys: the higgsfield front and
its 320 copy, every atlas of the key (plain and --stock) and its 320 preview, and the pins (render-assets sha256,
previewSha256, sourceSha256; integrations/pumpfun design-assets front sha256). The old 480/640 face and atlas copies
and their render-variants entries are dropped so card-skin-variants.ts and generated-face-variants.ts --missing rebuild
them. Backs, layouts and token backs are unchanged. Archive any key a launch has recorded first
(tools/carddex/archive-design-version.ts), as README "Redesigning a design that coins already use" says.
Usage: python3 install_fronts.py <dir with <designKey>-front.png> <designKey> [...]"""
import json, os, sys, hashlib
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
A = f"{ROOT}/app/public/assets/carddex"; LIB = f"{ROOT}/app/src/lib/carddex"; DA = f"{ROOT}/integrations/pumpfun/src/design-assets.json"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def load(p): raw = open(p).read(); return json.loads(raw), raw.endswith("\n")
def save(p, d, nl): open(p, "w").write(json.dumps(d, indent=2, ensure_ascii=False) + ("\n" if nl else ""))

def main(src, keys):
    ra, ra_nl = load(f"{LIB}/render-assets.json"); rv, rv_nl = load(f"{LIB}/render-variants.json"); da, da_nl = load(DA)
    for key in keys:
        front = Image.open(f"{src}/{key}-front.png").convert("RGBA"); assert front.size == (1260, 1760), key
        assert key in da, key
        fp = f"{A}/higgsfield/{key}-front.webp"
        front.save(fp, "WEBP", quality=90, method=6)
        front.resize((320, 447), Image.LANCZOS).save(f"{A}/higgsfield/{key}-front-320.webp", "WEBP", quality=80, method=6)
        for w in (480, 640):
            p = f"{A}/higgsfield/{key}-front-{w}.webp"
            if os.path.exists(p): os.remove(p)
        da[key]["front"]["sha256"] = sha(fp)
        atlases = [k for k in (key, key + "--stock") if k in ra]
        assert atlases, key
        for ak in atlases:
            atlas = f"{A}/render/{ak}.png"; preview = f"{A}/render/preview/{ak}.png"
            front.save(atlas, optimize=True); front.resize((320, 447), Image.LANCZOS).save(preview, optimize=True)
            ra[ak].update(sha256=sha(atlas), previewSha256=sha(preview), sourceSha256=sha(fp))
            for w in (480, 640):
                p = f"{A}/render/preview/{ak}-{w}.webp"
                if os.path.exists(p): os.remove(p)
            rv.pop(ak, None)
        print(key, atlases)
    save(f"{LIB}/render-assets.json", ra, ra_nl); save(f"{LIB}/render-variants.json", rv, rv_nl); save(DA, da, da_nl)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
