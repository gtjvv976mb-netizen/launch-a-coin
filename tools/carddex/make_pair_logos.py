# Needs Codex's local reference folder (creative/higgsfield/pair-identities-2026-10-30), opened read-only; writes only inside this repo.
"""Pair logos for Launch's pair picker: the token's own image, cropped or padded to a circle-safe square, as WebP.

Run from the repo root with headless Python Playwright (no Pillow or cwebp needed: Chromium's canvas encodes WebP):

  perl -e 'alarm 240; exec @ARGV' python3 -I tools/carddex/make_pair_logos.py \
    --source-root ".../creative/higgsfield/pair-identities-2026-10-30" \
    --chromium ~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell \
    --out app/public/assets/pairs --manifest app/src/lib/carddex/pair-logos.json

Rule (no redrawing, no recolouring): each source's sha256 must equal the one Codex recorded or the run stops. The bytes go
to the browser as a data: URL. A source with more than 2% transparent pixels (alpha < 250) is centred on the bounding box
of its opaque pixels (alpha > 32) and padded so its farthest pixel sits inside 92% of the circle, on a cream plate when
it is dark (alpha-weighted luminance < 0.35) or a chocolate plate otherwise. An opaque square source is used whole; an
opaque non-square one gets a centred square crop of its short side. SVGs render at 1024 px on the long side. Output:
<key>.webp (128 px) and <key>-64.webp (64 px), canvas image/webp quality 0.9. PEPE (64 px pixel art) doubles with
nearest-neighbour; other sources under 128 px are smoothed up and marked upscaled. GORK, MANIFEST and FARTCOIN keep the
monogram.
"""
import argparse, base64, hashlib, json, os, sys
from pathlib import Path

FOLDER = "creative/higgsfield/pair-identities-2026-10-30"
# Default record for each reference folder: assets[key=<key>].referenceIntake.{path, sha256, referenceSourceUri}.
RECORDS = {
    "references": "research/reference-image-uris.json",
    "expansion-references": "research/expansion-reference-image-uris.json",
    "expansion-direct-references": "research/expansion-direct-reference-image-uris.json",
    "expansion-final-references": "research/expansion-final-reference-image-uris.json",
}
# The source per offered pair, in registry order: Codex's verified intake file unless an override below names another.
SOURCES = {
    "sol": "references/sol-943c48e760ec.png", "usdc": "references/usdc-token-list-6d14601d0b11.png",
    "gmex": "references/gmex-709f953a1655.png", "tslax": "references/tslax-42cb949ac9a7.png",
    "nvdax": "references/nvdax-6b639eff0158.png", "aaplx": "references/aaplx-930db1995149.png",
    "mstrx": "references/mstrx-1456e378930a.png", "coinx": "references/coinx-7b028dd20902.png",
    "amc": "references/amc-d865497a68ea.png", "doge": "references/doge-06183873aff4.svg",
    "fartcoin": None, "pnut": "references/pnut-7b8c1825d78c.jpg",
    "moodeng": "references/moodeng-7f4f147ab9ea.png", "troll": "references/troll-5e3348ca8d09.png",
    "bonk": "references/bonk-498ca3589dbe.jpg", "wif": "references/wif-2ad89d597573.jpg",
    "cards": "references/cards-241bcf8ee4f8.svg", "sv151": "references/sv151-3ffeea5b7f58.png",
    "toad": "references/toad-80464cc13949.png", "pengu": "references/pengu-0b6260425d58.png",
    "giga": "references/giga-61b9c55c37cd.png", "spx": "references/spx-0e35c0c102cc.png",
    "trump": "references/trump-9b6c706e030b.jpg", "useless": "references/useless-f21ba0a63e3d.png",
    "chillguy": "references/chillguy-441a9eb33c81.jpg", "goat": "references/goat-4015c971963a.jpg",
    "zerebro": "references/zerebro-a8216adfc8b0.png", "act": "references/act-90309845b93a.jpg",
    "pippin": "references/pippin-03111311888d.png", "vine": "references/vine-f8bc16ff3c5f.png",
    "aura": "references/aura-e4e149c6b5fb.png", "michi": "references/michi-aa8e56a3812970fb-higher-pump-reference.png",
    "cate": "references/cate-a4c0d4c03864.jpg", "ansem": "references/ansem-d330339eb3aef602-higher-pump-reference.jpg",
    "bert": "references/bert-f670e4bb1e68.png", "chillhouse": "references/chillhouse-d61002d28888.jpg",
    "usduc": "references/usduc-bd7806798bd1.png", "wbtc": "references/wbtc-token-list-4b2b394a8a1a.png",
    "eth": "references/eth-836339466e52.png", "hype": "references/hype-4d210e44f273.png",
    "zec": "references/zec-c202292c3633.svg", "near": "references/near-8ab8ebca5d9f.svg",
    "xrp": "references/xrp-40c7dd792c5f.svg", "xmr": "references/xmr-26f020ea2c78.png",
    "sui": "references/sui-5351dc0dbefb.svg", "arb": "references/arb-e5d53dd5c7f9.svg",
    "tao": "references/tao-primary-inline-432636a22810.svg", "peaq": "references/peaq-c1f813eb9e81.png",
    "mon": "references/mon-3625ee5cdc35.png", "cashcat": "expansion-references/cashcat-9ea26bf56766.jpg",
    "otc": "expansion-references/otc-d6bd73eeed43.jpg", "fone": "expansion-references/fone-08061211879a.jpg",
    "buttcoin": "expansion-references/buttcoin-b337d4bf1f40.jpg", "triplet": "expansion-references/triplet-40b03cc789ee.jpg",
    "cupsey": "expansion-references/cupsey-63b8c11aa5ab.png", "jimothy": "expansion-references/jimothy-d8e5e31f43da.jpg",
    "lmao": "expansion-references/lmao-5a57ab0ec5d1.jpg", "bobo": "expansion-references/bobo-064db424e413.png",
    "tokabu": "expansion-references/tokabu-511a368112d4.jpg", "manifest": None,
    "baton": "expansion-references/baton-45d46d18d4a6.webp", "claw": "expansion-references/claw-f5546a3e2e71.png",
    "zauth": "expansion-references/zauth-3add66529015.png", "kins": "expansion-references/kins-fd8bdc66f477.png",
    "percolator": "expansion-references/percolator-fd19ec09ef1b.jpg", "jotchua": "expansion-references/jotchua-c3c31b4fd97d.jpg",
    "zcat": "expansion-references/zcat-og-identity-crop.png", "gork": None,
    "stonk": "expansion-direct-references/stonk-primary-7417b870b953.svg", "paid": "expansion-direct-references/paid-primary-7fe42e316e42.svg",
    "pepe": "expansion-direct-references/pepe-ec537de040a7.png", "pill": "expansion-direct-references/pill-primary-b90d439fa4d9.jpg",
    "npc": "expansion-direct-references/npc-fcdab23761ce.png", "wojak": "expansion-direct-references/wojak-c7064f9b7d48.jpg",
    "eacc": "expansion-direct-references/eacc-4f83e5b63bcd.webp", "shib": "expansion-direct-references/shib-primary-emblem-crop.svg",
    "swordcat": "expansion-direct-references/swordcat-9b3a8b914ce0.webp", "plague": "expansion-direct-references/plague-68bb5af167cd.jpg",
    "pump": "expansion-final-references/pump-380ece26fcc6.png", "alch": "expansion-final-references/alch-d8434afffbae.jpg",
    "pumpcade": "expansion-final-references/pumpcade-7986d3ba9bc6.jpg", "codec": "expansion-final-references/codec-84b41e87625c.png",
    "ape": "expansion-final-references/ape-40c62c5756b7.png", "link": "expansion-final-references/link-878946df941b.svg",
    "ore": "expansion-final-references/ore-ca2410840b70.png", "skr": "expansion-final-references/skr-14d4f9e9944c.png",
}
# Sources other than the intake file, each recorded by Codex: (record, JSON path to the file, to its sha256, to its URL).
OVERRIDES = {
    # The same exact-mint image at 600 px (the intake file is 80 px).
    "ansem": ("research/ansem-higher-source-followup.json", "image.path", "image.sha256", "image.uri"),
    "michi": ("research/michi-higher-source-followup.json", "image.path", "image.sha256", "image.uri"),
    # The token portrait cropped from the 1200x630 page card (the intake file).
    "zcat": ("research/expansion-reference-image-uris.json", "referenceIntake.deterministicIdentityCrop.path",
             "referenceIntake.deterministicIdentityCrop.sha256", "referenceIntake.referenceSourceUri"),
    # The SHIB emblem from the Shib.io wordmark SVG (viewport cropped, paths untouched).
    "shib": ("research/expansion-direct-reference-image-uris.json", "referenceIntake.deterministicIdentityCrop.cropSourceSvgPath",
             "referenceIntake.deterministicIdentityCrop.cropSourceSvgSha256", "referenceIntake.referenceSourceUri"),
}
MONOGRAMS = {
    "gork": "token image is a screenshot of a social profile with a default avatar and a person's name, not a logo",
    "manifest": "token image is a 2522x834 banner with a small figure; no logo to crop",
    # Fix pass (visual check LOGO-1): pump.fun's 80 px square of it read as an empty near-black disc at 24 px.
    "fartcoin": "token image is a screenshot of a terminal chat (text and an ASCII wordmark), not a logo; its 80 px "
                "square crop reads as an empty dark disc at tile size",
}
NEAREST = {"pepe"}  # 64 px pixel art: the 128 px file is an exact 2x
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml"}
CREAM, CHOCOLATE = "#f3e7cf", "#26120b"

JS = r"""async ([src, isSvg, nearest, cream, chocolate]) => {
  const img = new Image(); img.src = src; await img.decode();
  let w = img.naturalWidth, h = img.naturalHeight;
  if (isSvg) { const s = 1024 / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  let transparent = 0, minX = w, minY = h, maxX = -1, maxY = -1, lum = 0, wsum = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const a = d[i + 3]; if (a < 250) transparent++;
    if (a > 32) { const px = p % w, py = (p / w) | 0;
      if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
      lum += (0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])) * a; wsum += a; } }
  if (maxX < 0) throw new Error('no opaque pixels');
  const tf = transparent / (w * h), L = wsum ? lum / wsum : 0;
  let box;
  if (tf > 0.02) {
    const cx = (minX + maxX + 1) / 2, cy = (minY + maxY + 1) / 2; let r = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) if (d[i + 3] > 32) {
      const dx = (p % w) + 0.5 - cx, dy = ((p / w) | 0) + 0.5 - cy, q = dx * dx + dy * dy; if (q > r) r = q; }
    const side = 2 * Math.sqrt(r) / 0.92; box = { mode: 'alpha-circle', x: cx - side / 2, y: cy - side / 2, side };
  } else {
    const side = Math.min(w, h);
    box = { mode: Math.abs(w - h) / Math.max(w, h) < 0.03 ? 'whole' : 'cover', x: (w - side) / 2, y: (h - side) / 2, side };
  }
  const plate = tf > 0.02 ? (L < 0.35 ? cream : chocolate) : null;
  const out = {};
  for (const size of [128, 64]) {
    const o = new OffscreenCanvas(size, size), ox = o.getContext('2d');
    if (plate) { ox.fillStyle = plate; ox.fillRect(0, 0, size, size); }
    if (nearest) ox.imageSmoothingEnabled = false; else ox.imageSmoothingQuality = 'high';
    ox.drawImage(c, box.x, box.y, box.side, box.side, 0, 0, size, size);
    const blob = await o.convertToBlob({ type: 'image/webp', quality: 0.9 });
    if (blob.type !== 'image/webp') throw new Error('encoder gave ' + blob.type);
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const b of buf) s += String.fromCharCode(b);
    out[size] = { b64: btoa(s), type: blob.type };
  }
  return { natural: [img.naturalWidth, img.naturalHeight], rendered: [w, h], transparentFraction: tf, lum: L, plate,
           mode: box.mode, crop: [box.x, box.y, box.side], out };
}"""


def dig(obj, dotted):
    for part in dotted.split("."):
        obj = obj[part]
    return obj


def record_entry(root, key, rel):
    """(record file, field, recorded sha256, url) for a source, read from Codex's own records; stops on any mismatch."""
    if key in OVERRIDES:
        rec, path_f, sha_f, url_f = OVERRIDES[key]
        data = json.loads((root / rec).read_text())
        if "assets" in data:
            data = next(a for a in data["assets"] if a["key"] == key)
    else:
        rec = RECORDS[rel.split("/")[0]]
        data = next(a for a in json.loads((root / rec).read_text())["assets"] if a["key"] == key)
        path_f, sha_f, url_f = "referenceIntake.path", "referenceIntake.sha256", "referenceIntake.referenceSourceUri"
    recorded_path = dig(data, path_f)
    if not (recorded_path == rel or recorded_path.endswith("/" + rel)):
        sys.exit(f"{key}: record {rec} names {recorded_path}, not {rel}")
    return rec, sha_f, dig(data, sha_f), dig(data, url_f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-root", required=True)
    ap.add_argument("--chromium", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", required=True)
    a = ap.parse_args()
    repo = Path(__file__).resolve().parents[2]
    root = Path(a.source_root).resolve()
    out, manifest = Path(a.out).resolve(), Path(a.manifest).resolve()
    for target in (out, manifest):
        if repo not in target.parents or root == target or root in target.parents:
            sys.exit(f"refusing to write outside the repo or into the source folder: {target}")
    if set(SOURCES) - set(MONOGRAMS) != {k for k, v in SOURCES.items() if v} or len(SOURCES) != 86:
        sys.exit("source table and monogram list disagree")

    from playwright.sync_api import sync_playwright
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.webp"):
        stale.unlink()
    result, matches = {}, 0
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=a.chromium)
        encoder = f"chrome-headless-shell {browser.version} (playwright build 1243) canvas image/webp q0.9"
        page = browser.new_page()
        page.set_content("<!doctype html><title>pair logos</title>")
        for key, rel in SOURCES.items():
            if rel is None:
                result[key] = {"logo": None, "reason": MONOGRAMS[key]}
                print(f"{key:<11} monogram  {MONOGRAMS[key]}")
                continue
            if not os.path.basename(rel).startswith(key + "-"):
                sys.exit(f"{key}: source file does not start with the pair key")
            data = (root / rel).read_bytes()
            sha = hashlib.sha256(data).hexdigest()
            rec, field, recorded, url = record_entry(root, key, rel)
            if sha != recorded:
                sys.exit(f"{key}: sha256 {sha} != recorded {recorded} ({rec} {field})")
            matches += 1
            ext = os.path.splitext(rel)[1]
            info = page.evaluate(JS, [f"data:{MIME[ext]};base64,{base64.b64encode(data).decode()}", ext == ".svg",
                                      key in NEAREST, CREAM, CHOCOLATE])
            files = {}
            for size, name in ((128, f"{key}.webp"), (64, f"{key}-64.webp")):
                blob = base64.b64decode(info["out"][str(size)]["b64"])
                if blob[:4] != b"RIFF" or blob[8:12] != b"WEBP":
                    sys.exit(f"{key}: {size}px output is not WebP")
                (out / name).write_bytes(blob)
                files[size] = {"path": f"/assets/pairs/{name}", "sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob)}
            side = info["crop"][2]
            result[key] = {
                "logo": files[128]["path"],
                "w128": files[128], "w64": files[64],
                "source": {"folder": FOLDER, "file": rel, "sha256": sha, "record": f"{rec}#{field}", "url": url},
                "derivation": {
                    "mode": info["mode"], "crop": [round(v, 2) for v in info["crop"]], "plate": info["plate"],
                    "sourcePx": info["natural"], **({"renderedPx": info["rendered"]} if ext == ".svg" else {}),
                    "upscaled": ext != ".svg" and side < 128, "resample": "nearest" if key in NEAREST else "high",
                    "transparentFraction": round(info["transparentFraction"], 3), "luminance": round(info["lum"], 3),
                    "encoder": encoder,
                },
            }
            d = result[key]["derivation"]
            print(f"{key:<11} {d['mode']:<12} plate {str(d['plate']):<8} side {round(side):>5} up {str(d['upscaled']):<5} "
                  f"{files[128]['bytes']:>6} {files[64]['bytes']:>6} sha-match")
        browser.close()
    manifest.write_text(json.dumps(result, indent=1) + "\n")
    logos = sum(1 for v in result.values() if v["logo"])
    total = sum(v["w128"]["bytes"] + v["w64"]["bytes"] for v in result.values() if v["logo"])
    print(f"source sha256 matches {matches}/{logos}; logos {logos}; monograms {len(result) - logos}; files {2 * logos}; "
          f"bytes {total}; every blob image/webp")


if __name__ == "__main__":
    main()
