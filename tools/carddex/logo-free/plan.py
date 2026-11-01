"""Logo-free front redesign (owner, 1 November 2026: "just do away with putting logos at the front corners and borders,
redesign each card"; then: "dont necessarily design the front as ornaments, just still base it on the identity and character
of the meme/stock"). Each card keeps its recorded materials and window tone and its border carries motifs from its subject's
character, with no logos, wordmarks or corner medallions; its live front is the reference."""
import json, os, sys
# The session folder holding hf/, pairs/, alts/ plans and nologo/refs.json + order.json (the generation inputs).
S = os.environ.get("CARD_SOURCES", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
def load(path, name):
    import importlib.util
    sp = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(sp)
    sys.path.insert(0, os.path.dirname(path)); sp.loader.exec_module(m); sys.path.pop(0); return m
hf = load(f"{S}/hf/plan.py", "hfplan"); sys.modules["plan"] = hf; pr = load(f"{S}/pairs/plan2.py", "prplan"); al = load(f"{S}/alts/plan.py", "alplan")
# key -> (subject, materials, window tone)
SPEC = {}
for k, v in hf.CARDS.items(): SPEC[f"pair-{k}"] = (v[0], v[1], v[3])
for k, v in pr.CARDS.items(): SPEC[f"pair-{k}"] = (v[0], v[1], v[3])
for (p, n), v in al.ALTS.items():
    parent = SPEC.get(f"pair-{p}", (p.upper(),))[0]
    SPEC[f"pair-{p}-alt{n}"] = (f"{parent}, in a {v[0]} edition", v[1], v[3])
SPEC["pair-eth"] = ("Ethereum", "smoked quartz, faceted silver and translucent lilac enamel", "deep indigo")
SPEC["pair-xrp"] = ("XRP", "black glass, silver-white ceramic and restrained steel-blue channels", "deep slate black")
SPEC["pair-wojak"] = ("Wojak, the melancholy meme face", "ivory porcelain, fine charcoal etching and understated matte silver", "soft charcoal grey")
SPEC["pair-cards"] = ("Collector Crypt trading cards", "orange, cyan and blue enamel facets, brushed platinum and dark recessed seams", "deep blue")
def prompt(key):
    subject, materials, window = SPEC[key]
    return (f"Redesign the frame of this premium collectible trading card front for {subject}. "
            f"Keep its materials and colours: {materials}. "
            "Keep exactly the same panel layout: a slim blank title bar at the top, a large blank rectangular picture window, a thin blank type bar under it and a large blank text box at the bottom, all completely empty; "
            f"the bars and text box smooth warm ivory parchment, the picture window a smooth plain {window} gradient. "
            f"The border and the strips between the panels are richly detailed edge to edge with motifs drawn from the identity and character of {subject}: its world, objects, textures, patterns and mood, worked into those materials, with no large plain areas. "
            "No logos, wordmarks, brand marks or tickers anywhere on the card, and no medallions, badges, coins or roundels in the corners: the corners continue the themed border. "
            "The bottom border below the text box is a thin band, the same height as the top border above the title bar. "
            "Luxurious, sophisticated, high-detail material rendering, crisp engraving, soft studio lighting, print-quality sharpness. "
            "Full-bleed, straight-on, flat, no perspective, no background around the card. No text, letters or numbers.")
def request(i, key, ref):
    return {"index": i, "params": {"model": "gpt_image_2_5", "quality": "high", "resolution": "2k", "aspect_ratio": "2:3",
            "medias": [{"value": ref, "role": "image_references"}], "prompt": prompt(key)}}
if __name__ == "__main__":
    refs = json.load(open(f"{S}/nologo/refs.json")); order = json.load(open(f"{S}/nologo/order.json"))
    s, c = int(sys.argv[1]), int(sys.argv[2])
    print(json.dumps([request(s + i, k, refs[k]) for i, k in enumerate(order[s:s + c])]))
