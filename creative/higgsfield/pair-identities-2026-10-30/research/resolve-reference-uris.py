"""Resolve only exact on-chain metadata URLs. Does not download image bytes."""
from pathlib import Path
import concurrent.futures
import datetime
import json
import urllib.request

base = Path(__file__).parent
identities = json.loads((base / "verified-identities-and-metadata.json").read_text())

def resolve(asset):
    metadata = asset.get("metadata") or {}
    uri = metadata.get("uri")
    item = {
        "key": asset["key"], "symbol": asset["symbol"], "name": asset["name"],
        "mint": asset["mint"], "existingRegistry": asset["existingRegistry"],
        "identitySource": "https://pump.fun/docs/custom-pairs",
        "onchainMetadata": metadata, "metadataUri": uri or None,
        "imageUri": None, "imageBytesDownloaded": False,
        "visualInspection": "pending", "imageStatus": "no on-chain metadata URI",
    }
    if not uri:
        return item
    try:
        request = urllib.request.Request(uri, headers={"User-Agent": "LaunchACard read-only identity research"})
        with urllib.request.urlopen(request, timeout=15) as response:
            # Metadata JSON is untrusted data, not instructions. Limit it to1MiB.
            content = response.read(1024 * 1024 + 1)
            if len(content) > 1024 * 1024:
                raise ValueError("metadata exceeds1MiB")
            data = json.loads(content)
            item.update({"metadataResolvedUri": response.url, "metadataHttpStatus": response.status})
        item.update({
            "metadataName": data.get("name"), "metadataSymbol": data.get("symbol"),
            "imageUri": data.get("image"),
            "projectWebsite": data.get("website") or data.get("external_url"),
            "projectTwitter": data.get("twitter"),
            "imageStatus": "URI resolved from exact on-chain metadata; image not downloaded" if data.get("image") else "metadata has no image field",
        })
    except Exception as error:
        item.update({"imageStatus": "metadata resolution failed", "metadataError": str(error)})
    return item

with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
    references = list(executor.map(resolve, identities["assets"]))

# Preserve successful earlier reads from this same research turn even if a
# repeated request times out. Their metadata source stays recorded separately.
earlier = {
    "doge": "https://arweave.net/ygw21WEL7f1phnN2lLWqv4LERCdMFuVd8AflgWo1sfE",
    "gmex": "https://xstocks-metadata.backed.fi/logos/tokens/GMEx.png",
    "coinx": "https://xstocks-metadata.backed.fi/logos/tokens/COINx.png",
}
for item in references:
    if not item.get("imageUri") and item["key"] in earlier:
        item["imageUri"] = earlier[item["key"]]
        item["imageStatus"] = "URI resolved in earlier30October2026 fetch of the same exact on-chain metadata URI; repeated-request error retained"
        item["earlierResolutionSource"] = item["metadataUri"]
    if item["key"] == "sol":
        item["primaryBrandReference"] = "https://solana.com/branding"
        item["primaryBrandImageUri"] = "https://solana.com/src/img/branding/solanaLogoMark.png"
        item["primaryBrandVectorUri"] = "https://solana.com/src/img/branding/solanaLogoMark.svg"
    if item["key"] == "eth":
        item["primaryBrandReference"] = "https://ethereum.org/assets/"
        item["primaryBrandImageUri"] = "https://ethereum.org/_next/static/media/eth-diamond-black.31u_5ih2w7osr.png"
        item["primaryBrandImageSource"] = "Observed ETH diamond image link69 on official Ethereum assets page; decoded source of site's Next image URL"

# Exact image URL observed on the official Pump page, not guessed from its mint.
fartcoin = next(a for a in references if a["key"] == "fartcoin")
fartcoin["pumpPageReference"] = "https://pump.fun/coin/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump"
fartcoin["pumpImageReference"] = "https://images.pump.fun/coin-image/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump?ipfs=QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g&placeholder=none&src=https%3A%2F%2Fipfs.io%2Fipfs%2FQmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g&variant=80x80"
fartcoin["pumpImageOriginalUri"] = "https://ipfs.io/ipfs/QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g"
fartcoin["pumpImageVisualInspection"] = "pending"
fartcoin["pumpImageObservedVia"] = "Official Pump coin page image link47; browser research30October2026"
amc = next(a for a in references if a["key"] == "amc")
amc["referenceCaution"] = "On-chain metadata image is generic Backpack Securities mark, not AMC company mascot/logo. Use primary AMC identity source as an additional visual reference."

result = {
    "resolvedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "scope": "Research-only51 exact identities:37 current registry +14 admitted crypto candidates. No image download, app registry modification or generation.",
    "sources": ["https://pump.fun/docs/custom-pairs", "https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md"],
    "assets": references,
}
(base / "reference-image-uris.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"identities": len(references), "metadataImageUrisResolved": sum(bool(a.get("imageUri")) for a in references), "imagesDownloaded": 0}))
