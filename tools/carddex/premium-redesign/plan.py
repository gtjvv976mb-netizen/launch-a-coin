"""Redesign plan: each card's identity, frame materials, motif, window tone and (when the back is plain) a back brief.
`python3 plan.py <start> <count>` prints that slice of generation requests as JSON for generate_image_batch.
Each card's front uses refs [LAYOUT, QUALITY, its own current back]; a back uses its own current back only."""
import json, sys

LAYOUT = "0e97227b-a335-49d4-9655-725c0a10f255"   # pair-eth's current front: the canonical panel layout
QUALITY = "c7782bf4-67a4-402b-80bc-1542bb5798db"  # legend: the richness bar
REF = {
 "aaplx": "1dbd3731-e40e-46ca-89c7-8ca83ddbd09a", "npc": "5153af0d-669a-4754-8aa0-36e08b216f24", "manifest": "319d5372-0a44-46e0-a76c-d8531dd8baee",
 "gork": "e1eed072-eda2-4160-aed3-0d15a384a8a0", "stonk": "cdf7dc40-af12-43fc-b0d6-574045a78655", "otc": "03738f4a-10bf-4d9c-8164-e99d7765ae07",
 "jotchua": "5cacf750-13f0-466e-95f8-2bb31124073a", "coinx": "3493a14d-3386-4de5-bed4-7dfe1bfb19ce", "paid": "1e850f77-f083-4d24-9e93-a7833827486d",
 "near": "62e7179c-af72-49bc-9219-ee070e1f2178", "67": "d1bb65ff-6b7d-4905-b777-4f2879113ed6", "ape": "dc1278c7-bac0-4b03-88d1-5f2e90b126d8",
 "xmr": "7fdba935-35d0-43b2-9e85-5dcb03075180", "fone": "ac9d90df-4368-4a1d-8cac-2473259630d7", "zec": "3da0996f-5bb7-4979-b4f8-419e24a2f5c3",
 "tao": "876ceb82-dbe7-4459-9a82-3e1a6d08136e", "zauth": "400ad1ba-8826-4e3c-ad95-51d3f5528c51", "chillhouse": "75f9e6d1-8f4f-4810-9343-ea10cc684be4",
 "pippin": "f0e84ced-2473-4abe-a26a-3af4f38e23fe", "kins": "9374d8de-9526-44c7-ad9e-c8ebd79adbf0", "aura": "b79119e5-9e14-464c-98cb-df55bc2735d2",
 "cashcat": "6455fcbd-ce1c-4b3d-b247-a489cece6fd8", "pill": "fb3fcd88-7863-4793-9faf-4815e0845713", "useless": "16b1204e-f16b-49cf-842b-55b12ddec868",
 "sui": "28711b40-a2b3-462f-9be4-267817a82c43", "michi": "993c78c0-779a-428d-9421-9540f3933e03", "cupsey": "fd337383-493b-44fb-b7b5-bbbf5fe43b2c",
 "fartcoin": "233ab505-674a-4f93-b4fe-4ad31650d11e", "percolator": "66020e44-8fbf-4f3b-8a28-f3dfd1c97630", "baton": "1b525934-b733-42dc-a149-9eb3302f6c27",
 "claw": "88f72c1a-4dda-42c8-8c80-428d70b05b0a", "amc": "1c01c309-6a92-4cab-a703-7622fc416eb4", "buttcoin": "d9db699b-72ad-40ed-aff8-24ca95704005",
 "hodl": "99b8e4f9-2764-40be-bd02-2f037ebbd450", "goat": "43460795-5c46-4c99-8e6a-7903bfb55b37", "arb": "331163ed-b68d-4bf0-a51a-2718b82348c6",
 "shib": "9fb9c2cf-9d6c-4ff8-a1db-1bfe3dcb2846", "tslax": "1ff91e88-eedc-4db0-b7c3-9f694d665cb0", "nvdax": "f0159a8c-8dd8-45c9-9ef4-4a5d4624a07b",
 "tokabu": "1f5f475d-34ef-4160-938b-80b423fae938", "usduc": "b23d88a1-dfc6-41bf-8f4f-263994523f98", "pumpcade": "b948a91d-169c-41d3-b266-d93b811a8707",
 "bobo": "5601e765-525e-4054-b13f-666a5ffce1cf", "pengu": "8857a8e7-f47e-46f9-9266-4f89219bc2e7", "cards": "8fec7ac7-3723-4f40-86f0-b6dbcd76be72",
 "pnut": "44c652b4-5a7a-4459-8f1b-a3cf6a316b84", "giga": "ed471a80-1f06-49b5-b5a3-967446104595", "troll": "46976826-82fa-4475-8a5e-5cd70e3ab95c",
 "gmex": "dad76dff-5b58-4634-ba4a-5ea8fef233ac", "mstrx": "7b1fc37d-6ac2-446f-b945-d8ce2dd3e7a4",
}

# key: (identity, frame materials, motif for corners and bottom medallion, window tone, back brief or None)
# A back brief is (centrepiece, its treatment, surrounding materials, allowed text or None).
CARDS = {
 "aaplx": ("Apple xStock", "satin titanium rails, pearl ceramic inlays and fine brushed aluminium engraving", "the Apple apple logo", "soft graphite", ("the Apple apple logo", "in polished titanium inside a pearl-ceramic medallion", "satin titanium filigree, pearl ceramic panels and fine machined guilloche", None)),
 "npc": ("NPCs, the grey NPC meme face", "matte grey ceramic, black line enamel and brushed industrial silver with machined panel seams", "the NPC face (two dot eyes, a straight brow, a small nose and a flat mouth)", "cool slate grey", ("the NPC meme face from the reference (simple grey face, straight brows, dot eyes, flat mouth)", "as a grey ceramic relief inside a brushed-silver hexagonal medallion", "matte grey ceramic tiles, black enamel line work and brushed industrial silver rivets", None)),
 "manifest": ("Manifesting", "matte black enamel, warm ivory porcelain and narrow champagne-gold metal with art deco sunburst engraving", "a small open-armed figure silhouette under a sunburst", "deep black", ("the silhouette of a figure with open arms beneath a tall arch, from the reference", "in matte black under a champagne-gold art deco arch with radiating sunrays", "warm ivory porcelain, matte black enamel and champagne-gold deco fans", None)),
 "gork": ("@gork", "graphite ceramic, slate enamel, pale grey metal and dark glass with geometric tessellated stone", "a small round avatar disc", "dark slate", ("a round blank avatar portrait disc from the reference", "as a polished dark-glass cameo in a pale-grey metal ring", "graphite ceramic tessellation, slate enamel and pale grey marble", None)),
 "stonk": ("STONK", "cyan translucent enamel, pale blue ceramic and narrow silver edges with rising chart-line engraving", "a small upward chart arrow", "deep teal", ("the cyan sock-like STONK shapes from the reference", "as translucent cyan glass sculptures over a rising chart line", "pale blue ceramic, cyan enamel and silver engraved upward trend lines", None)),
 "otc": ("OTC, a retro computer terminal", "warm cream ceramic, dark screen glass, green phosphor enamel, beige keyboard-key details and a tiny red accent", "a small retro computer monitor", "dark phosphor green", ("the retro beige computer terminal from the reference", "as a precious cream-ceramic and brass miniature with a glowing green phosphor screen showing only abstract lines", "warm cream ceramic, green phosphor enamel circuit lines and brushed brass", None)),
 "jotchua": ("Jotchua, a cream puppy", "warm cream ceramic, light champagne metal, quiet black glass accents and soft paw-print engraving", "a small paw print", "warm sepia brown", None),
 "coinx": ("Coinbase xStock", "deep blue enamel, pale palladium rails and fine engraved guilloche", "the Coinbase C logo", "deep blue", ("the Coinbase C logo", "in pale palladium inside a deep-blue enamel medallion", "deep blue guilloche enamel, palladium filigree and fine engraving", None)),
 "paid": ("Paid", "black ceramic, raised white enamel and fine polished palladium with sharp geometric engraving", "the PAID P logo", "deep black", ("the PAID P logo from the reference", "in raised white enamel and polished palladium on black ceramic", "black ceramic, white enamel inlays and polished palladium geometric filigree", None)),
 "near": ("NEAR Protocol", "obsidian ceramic, pale mint-green enamel and precise silver inlays", "the NEAR N logo", "obsidian", ("the NEAR N logo", "in polished silver inside an obsidian medallion edged in pale mint-green enamel", "obsidian ceramic, pale mint-green enamel and precise silver geometric inlays", None)),
 "67": ("The Official 67 Coin", "warm pale-gold metal with wavy hair-like scrollwork, neutral ivory and cyan and black accent planes", "a small wavy gold scroll crest", "soft cyan-grey", None),
 "ape": ("ApeCoin", "cobalt-blue enamel and polished silver with jungle-leaf engraving", "the ApeCoin gorilla logo", "deep cobalt", ("the ApeCoin gorilla logo from the reference", "in polished silver inside a cobalt-blue enamel medallion", "cobalt-blue enamel, polished silver filigree and engraved jungle leaves", None)),
 "xmr": ("Monero", "graphite ceramic, orange enamel and brushed white metal", "the Monero M logo", "graphite", ("the Monero M logo (orange and white M in a circle)", "in orange enamel and brushed white metal inside a graphite medallion", "graphite ceramic, orange enamel channels and brushed white-metal filigree", None)),
 "fone": ("apeonfone, a monkey on a phone", "dark phone glass, warm bronze edging and camera-lens details", "a small camera lens", "dark smoky glass", None),
 "zec": ("Zcash", "charcoal ceramic, saffron-gold enamel and satin platinum", "the Zcash Z logo", "charcoal", ("the Zcash Z logo (gold coin with a Z)", "in saffron-gold enamel and satin platinum inside a charcoal medallion", "charcoal ceramic, saffron-gold enamel and satin platinum filigree", None)),
 "tao": ("Bittensor", "black ceramic, ivory enamel and brushed platinum with neural-network line engraving", "the Bittensor T logo", "black", ("the Bittensor T logo from the reference", "in brushed platinum on an ivory-enamel medallion", "black ceramic, ivory enamel and brushed platinum neural-network line engraving", None)),
 "zauth": ("zauthx402", "black glass, ivory pixel enamel and thin palladium with pixel-grid mosaic", "a small pixel-art Z", "black glass", ("the pixel-art Z from the reference", "built from raised ivory enamel pixels on black glass inside a palladium frame", "black glass, ivory pixel-enamel mosaic and thin palladium lines", None)),
 "chillhouse": ("Chill House, a cartoon house character", "warm cream ceramic, terracotta-red enamel, grey knit relief and pale blue denim tones", "a small cartoon house", "soft sage grey", None),
 "pippin": ("Pippin, a round white bird", "warm white porcelain, black ink-like enamel, pastel pink and small yellow accents with delicate swirl engraving", "a small round white bird", "soft lilac grey", ("Pippin the round white bird from the reference (simple ink line drawing)", "as glazed white porcelain with fine black ink lines in a pastel-pink porcelain medallion", "warm white porcelain, black ink swirl filigree, pastel pink and small yellow accents", None)),
 "kins": ("Kintara, a blocky tan character", "tan ceramic, matte black enamel and clean sky-blue glass accents with geometric folding", "a small blocky tan face", "warm tan", ("the blocky tan face with two black eyes from the reference", "as a tan ceramic sculpture in a sky-blue glass frame", "tan ceramic, matte black enamel and sky-blue glass geometric folds", None)),
 "aura": ("aura, a grey cat", "frosted smoke glass, pale silver and muted lilac and rose reflections", "a small cat silhouette", "smoky lilac grey", None),
 "cashcat": ("Cash Cat, a grey cat", "palladium, pearl-grey ceramic and soft white enamel with coin-edge milling", "a small cat silhouette", "pearl grey", ("the sitting grey cat from the reference", "as a fine pearl-grey ceramic sculpture on a palladium coin plinth", "palladium coin-edge milling, pearl-grey ceramic and soft white enamel", None)),
 "pill": ("pill", "emerald and white vitreous enamel, a dark edge line and polished silver", "a small green and white capsule", "deep emerald", ("the green and white capsule from the reference", "in glossy emerald and white vitreous enamel inside a polished-silver medallion", "emerald and white enamel waves, dark edge lines and polished silver", None)),
 "useless": ("USELESS COIN", "warm yellow enamel, ivory ceramic and narrow satin-gold joints", "the USELESS U coin logo", "warm amber", ("the USELESS U coin logo from the reference", "in satin gold inside a warm-yellow enamel medallion", "warm yellow enamel, ivory ceramic and satin-gold geometric joints", None)),
 "sui": ("Sui", "deep blue glass, pale blue enamel and polished palladium with water-ripple engraving", "the Sui droplet logo", "deep blue", ("the Sui water-droplet logo", "in pale blue enamel and polished palladium inside a deep-blue glass medallion", "deep blue glass, pale blue enamel ripples and polished palladium", None)),
 "michi": ("michi, a fluffy cat", "warm white ceramic, soft grey enamel, light brushed metal and tiny wood-tone accents", "a small cat face", "warm grey", None),
 "cupsey": ("Cupsey, a round smiling mascot", "pearl cream ceramic, smooth green enamel, soft pink glass and narrow champagne metal", "a small round smiling face", "soft green", None),
 "fartcoin": ("Fartcoin", "black terminal ceramic, satin palladium and phosphor-green circuit rails", "a small green gas cloud", "black terminal glass", ("a stylised green gas cloud emblem with circuit traces", "glowing phosphor green inside a satin-palladium medallion", "black terminal ceramic, phosphor-green circuit rails and satin palladium", None)),
 "percolator": ("Percolator", "violet-to-teal enamel, deep black ceramic and minimal satin silver with flowing iridescent waves", "a small coffee percolator", "deep violet", ("an elegant chrome coffee percolator emblem", "in satin silver with violet-to-teal iridescent glass", "deep black ceramic, violet-to-teal enamel waves and satin silver", None)),
 "baton": ("baton, a shiba holding a baton", "warm tan enamel, polished white ceramic, emerald grip-like inlays and satin brass", "a small baton", "warm tan", None),
 "claw": ("clawpump.tech", "emerald enamel, white glass highlights, dark green ceramic and brushed silver", "the green claw logo", "deep green", ("the green claw logo from the reference", "in emerald enamel with white glass highlights inside a brushed-silver medallion", "dark green ceramic, emerald enamel and brushed silver filigree", None)),
 "amc": ("AMC Entertainment", "red enamel, warm polished brass and cinema film-strip and marquee-light details", "a small film reel", "deep crimson", ("the AMC logo from the reference", "in red enamel on a polished-brass cinema marquee medallion ringed with small marquee lights", "red velvet-toned enamel, film-strip borders and warm polished brass", "The only text allowed is the exact AMC logo from the reference.")),
 "buttcoin": ("Buttcoin", "tangerine enamel, warm-white ceramic and fine champagne-metal edges with soft rounded relief", "the Buttcoin emblem", "warm tangerine", None),
 "hodl": ("HODL", "brushed silver, matte charcoal, photographic warm white and black enamel", "a small diamond-hands emblem", "charcoal", None),
 "goat": ("Goatseus Maximus, a terminal goat", "near-black terminal glass, mint phosphor lines and satin dark metal", "a small goat head made of terminal glyphs", "near-black", ("the goat face drawn in terminal line art from the reference", "glowing mint phosphor inside a satin dark-metal medallion", "near-black terminal glass, mint phosphor grid lines and satin dark metal", None)),
 "arb": ("Arbitrum", "navy ceramic, ice-blue enamel and faceted titanium", "the Arbitrum logo", "deep navy", ("the Arbitrum hexagon logo", "in ice-blue enamel and faceted titanium inside a navy medallion", "navy ceramic, ice-blue enamel and faceted titanium filigree", None)),
 "shib": ("SHIBA INU", "orange and red enamel, white ceramic and dark polished metal with narrow gold edges", "the Shiba Inu face", "deep red", None),
 "tslax": ("Tesla xStock", "pearl ceramic, polished titanium and deep red enamel with aerodynamic line engraving", "the Tesla T logo", "deep red", ("the Tesla T logo", "in polished titanium on a deep-red enamel medallion", "pearl ceramic, polished titanium aerodynamic lines and deep red enamel", None)),
 "nvdax": ("NVIDIA xStock", "obsidian, NVIDIA-green enamel and circuit-board traces in satin metal", "the NVIDIA eye logo", "obsidian", ("the NVIDIA eye logo", "in NVIDIA-green enamel inside an obsidian medallion", "obsidian, green enamel circuit traces and satin metal", None)),
 "tokabu": ("The Spirit of Gambling", "cyan enamel, bright yellow ceramic and slim blackened metal with flowing organic shapes", "a small blue spirit figure", "deep cyan", None),
 "usduc": ("unstable coin", "cobalt enamel, white ceramic and thin matte silver with jagged chart-line engraving", "a small jagged line", "deep cobalt", None),
 "pumpcade": ("PUMPCADE", "burgundy enamel and satin gold with arcade-cabinet and joystick details", "a small arcade joystick", "deep burgundy", ("the PUMPCADE arcade medallion from the reference", "in satin gold and burgundy enamel", "burgundy enamel, satin gold arcade-cabinet filigree and small light bulbs", "The only text allowed is the exact lettering on the medallion from the reference.")),
 "bobo": ("Bobo, the bear meme", "dark brown enamel, deep crimson lacquer, black etching and restrained copper", "a small bear face", "deep brown", None),
 "pengu": ("Pudgy Penguins", "blue and warm-white enamel, clean platinum edges and small orange glass accents", "a small penguin", "deep blue", None),
 "cards": ("Collector Crypt", "orange, cyan and blue enamel, brushed platinum and dark recessed seams", "the Collector Crypt logo", "deep blue", ("the Collector Crypt logo from the reference", "in orange and cyan enamel on brushed platinum", "orange, cyan and blue enamel facets, brushed platinum and dark recessed seams", None)),
 "pnut": ("Peanut the Squirrel", "walnut-brown enamel, warm brass and carved acorn and leaf relief", "a small acorn", "warm walnut", None),
 "giga": ("GIGACHAD", "matte graphite, brushed dark titanium and restrained silver highlights with classical sculpted relief", "a small laurel wreath", "graphite", None),
 "troll": ("TROLL", "ivory enamel, deep black lacquer and very fine polished silver edges with bold engraved rays", "a small grinning troll face", "deep black", None),
 "gmex": ("GameStop xStock", "red enamel, black lacquer and polished chrome with game-controller details", "a small game controller", "deep red", ("the GameStop logo from the reference", "in red and white enamel on a polished-chrome medallion with game-controller details", "black lacquer, red enamel and polished chrome", "The only text allowed is the exact GameStop logo from the reference.")),
 "mstrx": ("Strategy xStock", "orange enamel, matte black and brushed steel", "the Strategy logo mark", "deep orange", ("the Strategy logo from the reference", "in matte black on an orange-enamel medallion", "orange enamel, matte black and brushed steel geometric filigree", "The only text allowed is the exact Strategy logo from the reference.")),
}
ORDER = list(CARDS)

NO_TEXT = "Absolutely no text, letters, numbers or watermarks."


def front(key):
    name, materials, motif, window, _ = CARDS[key]
    return ("Full-bleed premium collectible trading card FRONT, filling the entire image edge to edge, straight-on, flat, no perspective, no background around it. "
            "Keep exactly the panel layout of the first reference: a slim blank title bar at the top, a large blank rectangular picture window, a thin blank type bar under it, and a large blank text box at the bottom, same positions and proportions, inside a wide border about one tenth of the card width on each side. "
            f"All panels completely empty: the bars and text box smooth warm ivory parchment, the picture window a smooth {window} gradient. "
            "Match the craftsmanship and richness of the second reference. "
            f"Identity: {name}. The whole border and the strips between the panels are densely and intricately ornamented edge to edge, with no large plain areas: {materials}, with {motif} motifs at the four corners and a centred {motif} medallion in the bottom border, taken from the third reference. "
            f"Luxurious, sophisticated, high-detail material rendering, crisp engraving, soft studio lighting, print-quality sharpness. {NO_TEXT}")


def back(key):
    name, _, _, _, b = CARDS[key]
    centre, treatment, materials, text = b
    return ("Full-bleed premium collectible trading card BACK filling the entire image edge to edge, straight-on, flat, no perspective, no background around it, symmetrical. "
            f"Identity: {name}. Centrepiece: {centre}, accurate shape and colours, {treatment}. "
            f"Around it, an ornate symmetrical pattern of {materials}, fine engraving, a raised border with small corner jewels. "
            f"Luxurious, sophisticated, high detail, crisp, soft studio lighting, print-quality sharpness. {text or NO_TEXT}")


def jobs():
    out = []
    for key in ORDER:
        out.append((f"{key}-front", {"model": "gpt_image_2_5", "quality": "high", "resolution": "2k", "aspect_ratio": "2:3",
                                     "medias": [{"value": LAYOUT, "role": "image_references"}, {"value": QUALITY, "role": "image_references"}, {"value": REF[key], "role": "image_references"}],
                                     "prompt": front(key)}))
        if CARDS[key][4]:
            out.append((f"{key}-back", {"model": "gpt_image_2_5", "quality": "high", "resolution": "2k", "aspect_ratio": "2:3",
                                        "medias": [{"value": REF[key], "role": "image_references"}], "prompt": back(key)}))
    return out


if __name__ == "__main__":
    all_jobs = jobs()
    if sys.argv[1] == "count":
        print(len(all_jobs)); sys.exit()
    start, count = int(sys.argv[1]), int(sys.argv[2])
    print(json.dumps([{"index": start + i, "params": p} for i, (_, p) in enumerate(all_jobs[start:start + count])]))
    print(json.dumps({start + i: n for i, (n, _) in enumerate(all_jobs[start:start + count])}), file=sys.stderr)
