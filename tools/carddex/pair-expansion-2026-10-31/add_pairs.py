"""(Copied from the session scratchpad; it read selected.json/verify.json there, now reports/pair-expansion-2026-10-31.) Add the 20 new pairs to the registries (app pair-assets, adapter report, pair keys, identity map, staged designs,
generated-assets). Art manifests are written by install2.py. Idempotent: an existing key is left alone."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meta import PAIRS, SLOT, DATE, QC, TABLE, XTERMS
R = os.path.expanduser("~/code/lac-wt-designs")
LIB = f"{R}/app/src/lib/carddex"
sel = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "selected.json")))
ver = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "verify.json")))
assert ver["slot"] == SLOT
ART = "reports/pair-expansion-2026-10-31"

def asset(key, adapter=False):
    sym, name, kind, extra, *_ = PAIRS[key]; s = sel[key]; v = ver["assets"][key]
    assert v["inQuoteControl"] and v["owner"] == s["tokenProgram"] and v["decimals"] == s["decimals"]
    a = {"key": key, "symbol": sym, "name": name, "mint": s["mint"]}
    if "listingProvider" in extra: a["listingProvider"] = extra["listingProvider"]
    a |= {"decimals": s["decimals"], "tokenProgram": s["tokenProgram"], "kind": kind,
          "issuer": "Backed Assets (JE) Limited" if kind == "stock" else None, "issuerTerms": XTERMS if kind == "stock" else None}
    if "listingProviderTerms" in extra: a["listingProviderTerms"] = extra["listingProviderTerms"]
    a |= {"verifiedDate": DATE, "admission": "quoteControl", "initialVirtualQuoteReserves": v["initialVirtualQuoteReserves"]}
    if kind == "stock": a["referenceTicker"] = extra["ticker"]
    if extra.get("direct"):
        a |= {"listingStatus": "direct-onchain", "listingNotice": "Direct QuoteControl-enabled; not found in the checked dated public table.",
              "sourceUrls": [f"https://solscan.io/token/{s['mint']}", QC], "sourceEvidenceArtifact": f"{ART}/verification.json"}
    else:
        a["sourceUrls"] = [TABLE] + ([XTERMS] if kind == "stock" else []) + ([extra["listingProviderTerms"]] if "listingProviderTerms" in extra else [])
    if adapter: a |= {"mintVerificationSlot": SLOT, "admissionVerificationSlot": SLOT}
    else: a |= {"verifiedAt": DATE, "verificationSlot": SLOT}
    return a

def dump(path, data, src):
    open(path, "w").write(json.dumps(data, indent=2, ensure_ascii=False) + ("\n" if src.endswith("\n") else ""))

keys = list(PAIRS)
# App registry.
p = f"{LIB}/pair-assets.json"; src = open(p).read(); app = json.loads(src)
have = {a["key"] for a in app}; app += [asset(k) for k in keys if k not in have]; dump(p, app, src)
# Adapter report.
p = f"{R}/reports/pump-pair-assets-2026-10-28.json"; src = open(p).read(); rep = json.loads(src)
have = {a["key"] for a in rep["assets"]}; rep["assets"] += [asset(k, True) for k in keys if k not in have]
if TABLE not in rep["sources"]: rep["sources"].append(TABLE)
if XTERMS not in rep["sources"]: rep["sources"].append(XTERMS)
rep["evidence"]["pairExpansion20261031"] = {
  "reviewedDate": DATE, "preservedPreviousAssetCount": 97, "additionalCount": len(keys), "totalReviewedAssets": 97 + len(keys),
  "snapshotSlots": [SLOT], "artifacts": [f"{ART}/verification.json", f"{ART}/token-identities.json"],
  "publishedTableMembers": [k for k in keys if not PAIRS[k][3].get("direct")], "directOnchainOnly": [k for k in keys if PAIRS[k][3].get("direct")],
  "notes": ["Owner request (31 October 2026): add more pairs with new premium designs; the owner chose these 20 of the 130 admitted mints not yet offered.",
            "Each mint's owner program, decimals and initialisation and its QuoteControl entry were read in one confirmed mainnet snapshot (genesis checked); the starting reserves are that entry's.",
            "The twelve xStocks are Backed Assets (JE) Limited issues listed in pump.fun's public table, like the earlier xStocks; their kind is stock and their reference ticker the underlying.",
            "W, PSOL, cbLTC and cbADA are admitted on-chain but absent from the public table when checked (31 October 2026); they carry the direct-onchain notice."]}
dump(p, rep, src)
# Pair keys.
p = f"{LIB}/pairs.ts"; s = open(p).read()
m = re.search(r'export const PAIR_ASSET_KEYS = \[(.*?)\] as const;', s); cur = re.findall(r'"([^"]+)"', m.group(1))
new = cur + [k for k in keys if k not in cur]
s = s.replace(m.group(0), "export const PAIR_ASSET_KEYS = [" + ", ".join(f'"{k}"' for k in new) + "] as const;"); open(p, "w").write(s)
# Identity designs.
p = f"{LIB}/design-pairings.ts"; s = open(p).read()
if 'ray: "pair-ray"' not in s:
    add = "".join(f'\n  {k}: "pair-{k}",' for k in keys)
    s = s.replace('  skr: "pair-skr",\n});', '  skr: "pair-skr",' + add + '\n});', 1); assert 'ray: "pair-ray"' in s
    open(p, "w").write(s)
# Staged designs.
p = f"{LIB}/pair-designs.json"; src = open(p).read(); d = json.loads(src); have = {x["key"] for x in d}
for k in keys:
    if f"pair-{k}" in have: continue
    sym, name, kind, extra, dname, desc, pal = PAIRS[k]
    d.append({"key": f"pair-{k}", "quoteKey": k, "name": dname, "description": desc, "category": "stocks" if kind == "stock" else "crypto",
              "materialLevel": 14, "palette": pal, "finish": "holo", "quoteMint": sel[k]["mint"]})
dump(p, d, src)
# Generated-asset paths.
p = f"{LIB}/generated-assets.ts"; s = open(p).read()
anchor = [l for l in s.split("\n") if l.startswith('  "pair-skr":')][0]
if '"pair-ray":' not in s:
    lines = [anchor] + [f'  "pair-{k}": {{"front":"/assets/carddex/higgsfield/pair-{k}-front.webp","back":"/assets/carddex/higgsfield/pair-{k}-back.webp","front320":"/assets/carddex/higgsfield/pair-{k}-front-320.webp","back320":"/assets/carddex/higgsfield/pair-{k}-back-320.webp"}},' for k in keys]
    s = s.replace(anchor, "\n".join(lines), 1); open(p, "w").write(s)
# Evidence.
os.makedirs(f"{R}/{ART}", exist_ok=True)
json.dump(ver, open(f"{R}/{ART}/verification.json", "w"), indent=2); open(f"{R}/{ART}/verification.json", "a").write("\n")
ids = {k: {kk: sel[k][kk] for kk in ("mint", "symbol", "name", "decimals", "tokenProgram", "icon", "iconSha256")} for k in keys}
json.dump(ids, open(f"{R}/{ART}/token-identities.json", "w"), indent=2); open(f"{R}/{ART}/token-identities.json", "a").write("\n")
print("done", len(app), len(rep["assets"]), len(new), len(d))
