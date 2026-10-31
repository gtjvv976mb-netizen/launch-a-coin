"""New pairs (31 October 2026; the installed PSOL front is the opal re-run below, the first lavender one read too close to W; CBADA's window was "deep navy starfield" on its first, rejected run): each card's identity, frame materials, motif, window tone and back brief.
`python3 plan2.py <start> <count>` prints that slice of generation requests as JSON for generate_image_batch."""
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "premium-redesign"))
from plan import LAYOUT, QUALITY, NO_TEXT

REF = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "higgsfield-refs.json")))
CARDS = {
 "ray": ("Raydium", "deep space-navy ceramic, iridescent violet-to-cyan anodised titanium rails and faceted hexagonal crystal inlays", "the Raydium hexagon R logo", "deep indigo", ("the Raydium hexagon R logo", "in iridescent violet-to-cyan anodised titanium inside a faceted hexagonal crystal medallion", "deep navy ceramic, hexagonal honeycomb engraving and iridescent titanium filigree", None)),
 "met": ("Meteora", "midnight black lacquer, molten sunset-orange to magenta enamel streaks and polished rose gold with meteor-trail engraving", "the round Meteora meteor emblem", "midnight plum", ("the round Meteora emblem with diagonal orange-to-violet streaks", "as glowing sunset enamel inside a polished rose-gold medallion", "midnight black lacquer, rose-gold meteor trails and tiny star-like jewels", None)),
 "bp": ("Backpack", "crimson-red enamel, soft white porcelain and polished silver with stitched-seam engraving and small buckle details", "the red Backpack logo", "deep crimson", ("the red Backpack logo", "in glossy crimson enamel inside a white-porcelain medallion ringed with polished silver", "soft white porcelain, crimson enamel bands, polished silver stitching lines and buckles", None)),
 "w": ("Wormhole", "lavender-violet enamel, pearl-white ceramic and polished silver with concentric spiral wormhole engraving", "the Wormhole W logo", "deep violet", ("the Wormhole W logo", "in pearl-white enamel on a lavender-violet medallion at the centre of a spiralling tunnel of silver rings", "lavender-violet enamel, pearl ceramic and concentric polished-silver spiral engraving", None)),
 "psol": ("Phantom Staked SOL", "milky white opal glass with pastel lilac fire, iridescent mother-of-pearl inlays and slim black enamel lines in polished silver, with flowing ribbon engraving", "the PSOL logo (three Solana bars in a black ring on lavender)", "soft lilac-grey", ("the PSOL logo: three slanted Solana bars inside a black ring on a lavender disc", "in black enamel on frosted lilac glass inside a polished-silver medallion", "soft lavender porcelain, frosted lilac glass waves and polished silver", None)),
 "hsol": ("Helius Staked SOL", "matte black obsidian, glowing ember-orange enamel and blackened copper with solar-flare ray engraving", "the hSOL logo (three orange Solana bars in a thin orange ring)", "black with a faint ember glow", ("the hSOL logo: three orange slanted Solana bars inside a thin orange ring on black", "in glowing ember-orange enamel on polished black obsidian", "matte black obsidian, blackened copper and fine ember-orange solar-flare rays", None)),
 "cbltc": ("Coinbase Wrapped Litecoin", "brushed sterling silver, white porcelain and bright Coinbase-blue enamel accents with fine diagonal guilloche", "the Litecoin L logo", "cool steel grey", ("the Litecoin L logo (a slanted L in a ring)", "in bright blue enamel inside a brushed sterling-silver coin medallion with a milled edge", "white porcelain, brushed sterling silver guilloche and thin bright-blue enamel lines", None)),
 "cbada": ("Coinbase Wrapped Cardano", "royal-blue enamel, deep navy lacquer and pale gold with a constellation of small raised dots", "the Cardano dotted-circle logo", "deep royal navy", ("the Cardano logo made of graduated dots in a circle", "as pale-gold and royal-blue enamel dots on a deep navy medallion", "deep navy lacquer, royal-blue enamel and pale-gold dot constellations", None)),
 "spyx": ("S&P 500 xStock", "deep navy lacquer, ivory porcelain and polished gold with engraved classical stock-exchange columns", "the SPYx emblem (three flowing horizontal bars)", "deep navy", ("the SPYx emblem: three flowing horizontal white bars", "in ivory enamel on a deep-navy medallion framed by polished-gold classical columns", "deep navy lacquer, ivory porcelain and polished gold column and laurel engraving", None)),
 "qqqx": ("Nasdaq-100 xStock", "glacier ice-blue glass, snow-white enamel and polished silver with alpine ridge-line engraving", "the white mountain peak from the QQQx logo", "icy blue", ("the white mountain peak from the QQQx logo", "as snow-white enamel on an ice-blue glass medallion", "glacier ice-blue glass, snow-white enamel and polished silver ridge-line engraving", None)),
 "googlx": ("Alphabet xStock", "white porcelain with blue, red, yellow and green enamel inlays and polished silver", "the four-colour Google G logo", "soft pearl grey", ("the four-colour Google G logo", "in glossy blue, red, yellow and green enamel on a white-porcelain medallion", "white porcelain, polished silver filigree and thin four-colour enamel lines", None)),
 "msftx": ("Microsoft xStock", "matte graphite, a mosaic of orange-red, green, blue and yellow glass tiles and brushed aluminium", "the Microsoft four-square logo", "graphite", ("the Microsoft four-square logo", "as four glowing coloured glass tiles inside a brushed-aluminium medallion", "matte graphite, brushed aluminium and small four-colour glass tile mosaics", None)),
 "metax": ("Meta xStock", "pearl-white ceramic, gradient blue glass and polished chrome with flowing infinity-loop engraving", "the Meta infinity logo", "deep azure", ("the Meta infinity logo", "in gradient blue glass inside a polished-chrome medallion", "pearl-white ceramic, polished chrome and flowing blue-glass infinity loops", None)),
 "amznx": ("Amazon xStock", "warm amber-orange enamel, matte black lacquer and polished brass with smile-arc engraving", "the Amazon a-and-smile logo", "deep amber brown", ("the Amazon a-and-smile logo", "in polished brass on a warm amber-orange enamel medallion", "matte black lacquer, amber enamel and polished brass smile-arc filigree", None)),
 "crclx": ("Circle xStock", "jet-black ceramic, mint-to-violet gradient enamel and brushed palladium with concentric ring engraving", "the Circle ring logo", "jet black", ("the Circle ring logo", "in mint-to-violet gradient enamel on a jet-black medallion", "jet-black ceramic, brushed palladium and concentric gradient-enamel rings", None)),
 "hoodx": ("Robinhood xStock", "neon chartreuse-lime enamel, matte black lacquer and blackened steel with fine feather-vein engraving", "the Robinhood feather logo", "deep black-green", ("the Robinhood feather logo", "in matte black on a neon chartreuse-lime enamel medallion", "matte black lacquer, chartreuse enamel and blackened steel feather engraving", None)),
 "gldx": ("SPDR Gold Shares xStock", "polished 24-carat gold, ivory enamel and stamped bullion-bar textures with fine guilloche", "a small stamped gold bar", "warm dark bronze", ("a neat stack of polished gold bullion bars", "on an ivory-enamel medallion ringed with polished gold", "polished gold guilloche, ivory enamel and stamped bullion textures", None)),
 "pltrx": ("Palantir xStock", "matte black ceramic, brushed white steel and pale silver with precise geometric orbit engraving", "the Palantir ring-and-chevron logo", "deep charcoal", ("the Palantir ring-and-chevron logo", "in brushed white steel on a matte black medallion", "matte black ceramic, pale silver and precise geometric orbit engraving", None)),
 "mcdx": ("McDonald's xStock", "golden-yellow enamel, glossy red lacquer accents and polished gold", "the McDonald's golden arches logo", "warm golden ochre", ("the McDonald's golden arches logo", "in polished golden-yellow enamel on a glossy red lacquer medallion", "golden-yellow enamel, polished gold filigree and glossy red accents", None)),
 "kox": ("Coca-Cola xStock", "glossy cherry-red enamel, white ribbon-wave enamel and polished chrome with contour-bottle fluting", "a small contour bottle silhouette", "deep cherry red", ("the Coca-Cola script logo from the reference", "in white enamel on a glossy red enamel medallion edged in polished chrome", "cherry-red enamel, white ribbon waves and polished chrome fluting", "The only text allowed is the exact Coca-Cola script logo from the reference.")),
}
ORDER = list(CARDS)


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
        base = {"model": "gpt_image_2_5", "quality": "high", "resolution": "2k", "aspect_ratio": "2:3"}
        out.append((f"{key}-front", {**base, "medias": [{"value": LAYOUT, "role": "image_references"}, {"value": QUALITY, "role": "image_references"}, {"value": REF[key], "role": "image_references"}], "prompt": front(key)}))
        out.append((f"{key}-back", {**base, "medias": [{"value": REF[key], "role": "image_references"}], "prompt": back(key)}))
    return out


if __name__ == "__main__":
    all_jobs = jobs()
    if sys.argv[1] == "count":
        print(len(all_jobs)); sys.exit()
    start, count = int(sys.argv[1]), int(sys.argv[2])
    print(json.dumps([{"index": start + i, "params": p} for i, (_, p) in enumerate(all_jobs[start:start + count])]))
    print(json.dumps({start + i: n for i, (n, _) in enumerate(all_jobs[start:start + count])}), file=sys.stderr)
