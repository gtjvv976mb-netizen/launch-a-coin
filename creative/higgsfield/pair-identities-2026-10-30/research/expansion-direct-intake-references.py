"""Read-only metadata/reference intake. No generated art and no app edits."""
from pathlib import Path
from urllib.parse import urlparse, unquote
import concurrent.futures
import datetime
import hashlib
import io
import json
import re
import subprocess
import urllib.request

from PIL import Image
from defusedxml import ElementTree

base = Path(__file__).parent
references = base.parent / "expansion-direct-references"
references.mkdir(exist_ok=True)
manifest_path = base / "expansion-direct-reference-image-uris.json"
manifest = json.loads(manifest_path.read_text())
maximum_bytes = 8 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 64_000_000

def ipfs_content_path(uri):
    if not uri:
        return None
    u = urlparse(uri)
    if u.scheme == "ipfs":
        value = u.netloc + u.path
    elif "/ipfs/" in u.path:
        value = u.path.split("/ipfs/", 1)[1]
    elif ".ipfs." in (u.hostname or ""):
        value = (u.hostname or "").split(".ipfs.", 1)[0] + u.path
    else:
        return None
    value = unquote(value).lstrip("/")
    cid = value.split("/", 1)[0]
    if not re.fullmatch(r"(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})", cid):
        return None
    return value

def equivalent_uris(uri):
    path = ipfs_content_path(uri)
    yield uri
    if path:
        yield "https://ipfs.filebase.io/ipfs/" + path
        yield "https://gateway.pinata.cloud/ipfs/" + path
        yield "https://pump.mypinata.cloud/ipfs/" + path
    else:
        u = urlparse(uri)
        if (u.hostname or "") in {"arweave.net", "gateway.irys.xyz"} and re.fullmatch(r"/[A-Za-z0-9_-]{40,50}", u.path):
            alternate = "gateway.irys.xyz" if u.hostname == "arweave.net" else "arweave.net"
            yield "https://" + alternate + u.path

def read(uri, limit, timeout=12):
    request = urllib.request.Request(uri, headers={"User-Agent": "LaunchACard read-only exact identity reference intake"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > limit:
            raise ValueError("Declared content exceeds allowed byte limit")
        data = response.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Content exceeds allowed byte limit")
        return data, response.url, response.headers.get("Content-Type"), response.status

def resolve_metadata(item):
    if item.get("imageUri") or not item.get("metadataUri"):
        return item
    attempts = item.setdefault("equivalentMetadataAttempts", [])
    # The original URI was already attempted; CID equivalence does not change it.
    candidates = list(equivalent_uris(item["metadataUri"]))
    if ipfs_content_path(item["metadataUri"]):
        candidates = candidates[1:]
    for uri in candidates:
        try:
            data, resolved, content_type, status = read(uri, 1024 * 1024)
            obj = json.loads(data)
            if not isinstance(obj, dict):
                raise ValueError("Metadata is not a JSON object")
            attempts.append({"uri": uri, "status": status, "contentSha256": hashlib.sha256(data).hexdigest(), "contentType": content_type})
            item.update(metadataResolvedUri=resolved, imageUri=obj.get("image"), metadataName=obj.get("name"), metadataSymbol=obj.get("symbol"), projectWebsite=obj.get("website") or obj.get("external_url"), projectTwitter=obj.get("twitter"))
            if item.get("imageUri"):
                item["imageStatus"] = "Exact on-chain metadata CID resolved through a content-equivalent public gateway; visual inspection pending"
                break
        except Exception as error:
            attempts.append({"uri": uri, "error": str(error)})
    return item

def acquire(item):
    # Preserve existing downloaded originals on repeated intake runs.
    intake = item.get("referenceIntake")
    if intake and intake.get("status") == "downloaded-pending-visual-inspection":
        local = base.parent / intake["path"]
        if local.exists() and hashlib.sha256(local.read_bytes()).hexdigest() == intake.get("sha256"):
            return item
    source = item.get("primaryBrandImageUri") if item["key"] in {"sol", "eth"} else item.get("imageUri")
    source = source or item.get("pumpImageOriginalUri")
    if not source:
        item["referenceIntake"] = {"status": "pending-reference-uri", "visualInspection": "pending"}
        return item
    attempts = []
    uris = list(equivalent_uris(source)) + item.get("additionalImageSourceUris", [])
    for uri in uris:
        try:
            data, resolved, content_type, status = read(uri, maximum_bytes)
            derived = None
            if data.lstrip().startswith((b"<svg", b"<?xml", b"<!--")):
                root = ElementTree.fromstring(data)
                if root.tag.rsplit("}", 1)[-1] != "svg":
                    raise ValueError("XML root is not SVG")
                for node in root.iter():
                    if node.tag.rsplit("}", 1)[-1] in {"script", "foreignObject"}:
                        raise ValueError("Active SVG element rejected")
                    for attr, value in node.attrib.items():
                        if attr.rsplit("}", 1)[-1].lower().startswith("on"):
                            raise ValueError("SVG event handler rejected")
                        if attr.rsplit("}", 1)[-1] == "href" and not value.startswith("#"):
                            raise ValueError("External SVG resource rejected")
                    text = (node.text or "") + " ".join(node.attrib.values())
                    if "@import" in text.lower() or any(not v.strip(" '\"").startswith("#") for v in re.findall(r"url\(([^)]*)\)", text, re.I)):
                        raise ValueError("External SVG CSS rejected")
                viewbox = [float(v) for v in re.split(r"[\s,]+", root.get("viewBox", "").strip()) if v]
                width = float(re.sub(r"px$", "", root.get("width", "0"))) if re.fullmatch(r"[0-9.]+(?:px)?", root.get("width", "")) else 0
                height = float(re.sub(r"px$", "", root.get("height", "0"))) if re.fullmatch(r"[0-9.]+(?:px)?", root.get("height", "")) else 0
                if (not width or not height) and len(viewbox) == 4:
                    width, height = viewbox[2:]
                if not (0 < width <= 16000 and 0 < height <= 16000 and width * height <= 64_000_000):
                    raise ValueError("SVG intrinsic dimensions unavailable or outside limits")
                format_, mode, frames, extension = "SVG", "vector", 1, "svg"
                output_width = 1024
                output_height = max(1, round(output_width * height / width))
                if output_height > 4096:
                    raise ValueError("SVG aspect ratio exceeds reference export limit")
                app_root = base.parents[3] / "app"
                code = 'import {Resvg,initWasm} from "@resvg/resvg-wasm";await initWasm(await Bun.file("node_modules/@resvg/resvg-wasm/index_bg.wasm").arrayBuffer());const renderer=new Resvg(await Bun.stdin.text(),{fitTo:{mode:"width",value:1024}});const output=renderer.render();await Bun.write(Bun.stdout,output.asPng());output.free();renderer.free();'
                conversion = subprocess.run([str(Path.home() / ".bun/bin/bun"), "-e", code], input=data, cwd=app_root, capture_output=True, timeout=20, check=True)
                derived = conversion.stdout
                with Image.open(io.BytesIO(derived)) as image:
                    image.verify()
            else:
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                with Image.open(io.BytesIO(data)) as image:
                    width, height, mode, format_ = image.width, image.height, image.mode, image.format
                    if not (16 <= width <= 16000 and 16 <= height <= 16000):
                        raise ValueError("Image dimensions outside16..16000")
                    if width * height > 64_000_000:
                        raise ValueError("Image exceeds64MP")
                    if format_ not in {"PNG", "JPEG", "WEBP", "GIF", "AVIF", "ICO"}:
                        raise ValueError("Unsupported or unexpected image magic")
                    frames = getattr(image, "n_frames", 1)
                extension = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp", "GIF": "gif", "AVIF": "avif", "ICO": "ico"}[format_]
                if format_ == "ICO":
                    with Image.open(io.BytesIO(data)) as image:
                        buffer = io.BytesIO()
                        image.convert("RGBA").save(buffer, format="PNG")
                        derived = buffer.getvalue()
            digest = hashlib.sha256(data).hexdigest()
            destination = references / f"{item['key']}-{digest[:12]}.{extension}"
            destination.write_bytes(data)
            attempts.append({"uri": uri, "httpStatus": status})
            item["referenceIntake"] = {
                "status": "downloaded-pending-visual-inspection", "visualInspection": "pending",
                "path": str(destination.relative_to(base.parent)), "sha256": digest,
                "bytes": len(data), "width": width, "height": height, "mode": mode,
                "format": format_, "frames": frames, "contentType": content_type,
                "referenceSourceUri": source, "downloadUri": uri, "resolvedUri": resolved,
                "attempts": attempts, "downloadPurpose": "Original exact-identity image reference intake for planned future Higgsfield artwork only",
            }
            if derived is not None:
                derivative_label = "1024" if format_ == "SVG" else "native"
                derived_path = references / f"{item['key']}-{digest[:12]}-reference-{derivative_label}.png"
                derived_path.write_bytes(derived)
                with Image.open(io.BytesIO(derived)) as image:
                    transform = "Installed ResvgWASM rasterization of validated original SVG; original retained; no new artwork" if format_ == "SVG" else "Pillow extraction of highest-resolution original ICO image to RGBA PNG at native dimensions; original retained; no new artwork"
                    item["referenceIntake"]["deterministicPngExport"] = {"path": str(derived_path.relative_to(base.parent)), "sha256": hashlib.sha256(derived).hexdigest(), "bytes": len(derived), "width": image.width, "height": image.height, "transform": transform}
            item["imageBytesDownloaded"] = True
            break
        except Exception as error:
            attempts.append({"uri": uri, "error": str(error)})
    else:
        item["referenceIntake"] = {"status": "download-failed", "visualInspection": "pending", "referenceSourceUri": source, "attempts": attempts}
    return item

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    manifest["assets"] = list(executor.map(resolve_metadata, manifest["assets"]))
manifest["scope"] = "Research-only17 direct QuoteControl-enabled meme identities; not claimed published in dated public table. Candidate original reference images may be downloaded under8MiB and validated for generation reference intake; no app registry modification, generation or visual-approval claim."
manifest["intakeUpdatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"phase": "metadata", "imageUris": sum(bool(i.get("imageUri")) for i in manifest["assets"])}), flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    manifest["assets"] = list(executor.map(acquire, manifest["assets"]))
manifest["intakeUpdatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"phase": "images", "downloaded": sum(i.get("referenceIntake", {}).get("status") == "downloaded-pending-visual-inspection" for i in manifest["assets"]), "pending": [i["key"] for i in manifest["assets"] if i.get("referenceIntake", {}).get("status") != "downloaded-pending-visual-inspection"]}), flush=True)
