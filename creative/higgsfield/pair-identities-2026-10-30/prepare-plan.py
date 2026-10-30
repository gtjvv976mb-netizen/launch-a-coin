"""Prepare exact-identity briefs and a quoted, unsubmitted Higgsfield batch."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
existing = json.loads((HERE / "identity-briefs.json").read_text())["entries"]
candidates = json.loads((HERE / "research/crypto-candidates.json").read_text())
evidence = json.loads((HERE / "research/verified-identities-and-metadata.json").read_text())
references = json.loads((HERE / "research/reference-image-uris.json").read_text())
by_key = {d["key"]: d for d in evidence["assets"]}
image_refs = {d["key"]: d for d in references["assets"]}
crypto = {
    "wbtc": ("Bitcoin Signature", "Bitcoin / Wrapped BTC", ["#211a14", "#F7931A", "#EDD8AC"], "burnished orange enamel, warm palladium and a precisely struck coin relief"),
    "eth": ("Ethereum Signature", "Ethereum", ["#211f35", "#8A92B2", "#DADDF4"], "smoked quartz, faceted silver and translucent lilac enamel"),
    "hype": ("Hyperliquid Signature", "Hyperliquid", ["#0c302b", "#97FCE4", "#E5F8EF"], "deep green ceramic, mint enamel and polished liquid-metal channels"),
    "zec": ("Zcash Signature", "Zcash", ["#252320", "#F4B728", "#F7E5A5"], "charcoal ceramic, saffron enamel and satin platinum"),
    "near": ("NEAR Signature", "NEAR Protocol", ["#171c1b", "#9AE6BC", "#F0F4EC"], "obsidian ceramic, pale green enamel and precise silver inlays"),
    "xrp": ("XRP Signature", "XRP", ["#17232c", "#E9ECEE", "#6DA6C5"], "black glass, silver-white ceramic and restrained steel-blue channels"),
    "xmr": ("Monero Signature", "Monero", ["#252b2b", "#FF6600", "#E5E6E2"], "graphite ceramic, orange enamel and brushed white metal"),
    "sui": ("Sui Signature", "Sui", ["#0b3047", "#6FBCF0", "#E5F5FE"], "deep blue glass, pale blue enamel and polished palladium"),
    "arb": ("Arbitrum Signature", "Arbitrum", ["#142133", "#28A0F0", "#E6EBF1"], "navy ceramic, ice-blue enamel and faceted titanium"),
    "aave": ("Aave Signature", "Aave", ["#392747", "#B7A2E9", "#9BE6D8"], "lavender porcelain, iridescent mint enamel and satin silver"),
    "uni": ("Uniswap Signature", "Uniswap", ["#3a1530", "#FF007A", "#F6DAEC"], "deep plum ceramic, vivid pink enamel and rose-palladium"),
    "tao": ("Bittensor Signature", "Bittensor", ["#151515", "#ECEAE4", "#919493"], "black ceramic, ivory enamel and brushed platinum"),
    "peaq": ("peaq Signature", "peaq", ["#192225", "#BBD9CB", "#DCE7E1"], "graphite ceramic, soft green enamel and polished silver"),
    "mon": ("Monad Signature", "Monad", ["#201744", "#836EF9", "#E3DEFF"], "midnight violet ceramic, lavender enamel and luminous palladium"),
}
entries = list(existing)
for design in entries:
    # Use the approved v2 print, not the original generated front with retired footer slots.
    design["constructionReference"] = {
        "front": "app/public/assets/carddex/render/doge.png",
        "back": "app/public/assets/carddex/token-backs/doge.png",
        "purpose": "Current approved shared grid and construction only; do not transfer Doge identity.",
    }
    if design["quoteKey"] in ("gmex", "amc", "mstrx"):
        design["reverseHero"] = (
            "The exact verified company logo from the accepted source, including only its authentic on-reference lettering "
            "if that scoped lettering is approved; never substitute an invented emblem, generic industry object or unrelated mascot."
        )
for candidate in candidates:
    key = candidate["key"]
    name, identity, palette, materials = crypto[key]
    account = by_key[key]
    assert account["mint"] == candidate["mint"] and account["admission"]["initialized"]
    assert not account["admission"]["paused"] and not account["admission"]["defaultFrozen"]
    entries.append({
        "quoteKey": key, "proposedDesignKey": "pair-"+key, "name": name,
        "exactIdentity": identity, "symbol": candidate["symbol"], "kind": "crypto",
        "exactQuoteMint": candidate["mint"], "listingProvider": candidate["listingProvider"],
        "recognizableIdentityMotif": "The exact project emblem in the verified image reference. Preserve its silhouette, negative space, orientation and original identity colors; do not invent a related pictogram.",
        "palette": {"proposedMaterialColors": palette, "identityColorRule": "Sample and preserve final accepted reference colors."},
        "frontBorderTheme": f"Use {materials}. Integrate small exact {identity} identity reliefs into the perimeter only, outside every creator-content surface.",
        "reverseHero": f"The exact {identity} emblem from the accepted image reference, centered as a premium enamel-and-metal relief. Surrounding material: {materials}. No generic coin, orbital symbol or unrelated mascot.",
        "sourceReferences": image_refs[key],
        "generationGate": "Exact reference must be visually inspected, linked to the exact mint/company, saved with a hash and supplied to Higgsfield before submission.",
        "onChainIdentityEvidence": account,
    })
assert len(entries) == 51 and len({d["proposedDesignKey"] for d in entries}) == 51

common = (
    "Generate ONE straight-on portrait card print for Launch a Card, premium collector quality. "
    "Use the supplied existing site card only as physical-construction and shared-template reference, never copy its mascot. "
    "Use the separate exact-identity source image as identity authority. Preserve recognizable facial features, emblem contours, "
    "pose, colors and negative space; a related generic symbol is unacceptable. "
    "Thin 63:88 card with smooth rounded corners, all fittings contained inside the silhouette; no slab, case, pedestal, surrounding scene or perspective distortion. "
    "Sculpted metal, enamel and tactile material depth, precise bevels, controlled studio light, fine foil microtexture and clean material separation. "
    "No theme titles, ticker labels, numbers, tier, serial, platform name, footer slots or invented lettering. "
    "Only exact on-reference logo lettering may appear if its scoped inclusion is approved. "
)
front = (
    "FRONT: preserve the common creator print grid exactly: x10%-90% width for content; name y5.5%-11.5%, "
    "creator art x10%-90%, y15%-59%; type y61.5%-64.9%; details y67%-92.5%. "
    "All these surfaces stay completely clear of decorative identity imagery. Use uniform neutral cutout guides for the content zones; "
    "the actual creator art and live text are composed in code. Identity details live only in the perimeter. "
    "Carry continuous matching material to the bottom rounded edge, with no empty footer boxes. "
)
back = (
    "BACK: a full, text-free identity composition, with the same palette, edge profile, metal/enamel/paper family, "
    "lighting direction, foil treatment and ornament density as its matching front. The exact identity reference is the central hero. "
    "Keep fine decoration legible at phone thumbnail size, with no clipped relief, sharp protrusions, excessive bloom or unresolved marks. "
)
requests = []
for design in entries:
    for face in ("front", "back"):
        request = {
            "index": len(requests), "id": f"{len(requests):03d}-{design['proposedDesignKey']}-{face}",
            "designKey": design["proposedDesignKey"], "quoteKey": design["quoteKey"], "face": face,
            "status": "prepared_not_submitted",
            "referenceIntake": image_refs[design["quoteKey"]],
            "requiredReferenceRoles": ["approved site face construction", "exact quote identity"],
            "params": {
                "model": "gpt_image_2_5", "variant": "flare", "quality": "high", "resolution": "2k",
                "aspect_ratio": "2:3", "count": 1,
                "prompt": common + (front if face == "front" else back) +
                    f"EXACT PAIR IDENTITY: {design['exactIdentity']}; exact Solana mint: {design['exactQuoteMint']}. " +
                    (design["frontBorderTheme"] if face == "front" else design["reverseHero"]),
            },
        }
        requests.append(request)
plan = {
    "preparedDate": "2026-10-30", "status": "prepared_awaiting_new_credit_allocation_and_exact_reference_intake",
    "provider": "Higgsfield", "designCount": 51, "imageCount": len(requests),
    "scope": {"currentReviewedQuotes": 37, "additionalDirectlyAdmittedCryptoCandidates": 14},
    "quote": {"creditsPerImage": 2.75, "totalCredits": 280.5, "date": "2026-10-30", "source": "live Higgsfield estimate_image_cost; no job submitted"},
    "allocation": {"approvedCredits": None, "paidSubmissions": 0, "automaticPaidRetries": False, "automaticPurchases": False},
    "identityLetteringDecision": "Pending owner answer for logos whose authentic artwork contains letters; never invent a replacement emblem.",
    "unsupportedRequestedIdentity": {"symbol": "ETC", "name": "Ethereum Classic", "status": "Not in checked Pump supported-pair table; not installed or enabled."},
    "historyRule": "Keep all48 existing keys, source images, saved launch quotes and immutable output URLs.",
    "designs": entries, "requests": requests,
}
(HERE / "generation-plan.json").write_text(json.dumps(plan, indent=2)+"\n")
rows = ["# Pair-specific design plan", "", "51 planned designs / 102 new Higgsfield images / quoted280.5 credits. No jobs submitted.", "",
        "| Pair | Proposed design | Front identity / materials | Back identity |", "|---|---|---|---|"]
for d in entries:
    rows.append(f"| {d['symbol']} | {d['name']} | {d['frontBorderTheme']} | {d['reverseHero']} |")
(HERE / "DESIGN-LIST.md").write_text("\n".join(rows)+"\n")
print(json.dumps({"designs": len(entries), "images": len(requests), "quotedCredits": 280.5, "submitted": 0}))
