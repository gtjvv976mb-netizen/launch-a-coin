"""Alternate premium cards for ten meme pairs (owner, 1 November 2026: two more card choices per pair).
Each alt: (style name, frame materials, corner/medallion motif, window tone, back centrepiece treatment, back surround).
`python3 alt_plan.py <start> <count>` prints generation requests; `count` prints the total."""
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "premium-redesign"))
from plan import LAYOUT, QUALITY, NO_TEXT

REF = {"bonk": "36a12717-8a58-4750-8847-8d198c2d29a2", "wif": "a569fbf9-fe53-4a7e-ad79-1919ac5a9c51", "pengu": "aa9a98d7-3d81-4e6e-b931-5445791621ee",
       "toad": "bed3a17e-d30a-4547-9bbc-0a7634d0d46f", "fartcoin": "c30ac39a-8405-4292-ac0d-c4cf0e2a19b4", "doge": "731fe7eb-da83-4236-a2a0-e81f298cd0c5",
       "pnut": "17c1d24e-2c46-4bf3-b700-166258d0cfea", "moodeng": "47272fda-4288-44cd-b6d1-55d9aac41472", "michi": "0f3fa2a7-15d0-483a-bdd3-6ea6d22d39df",
       "chillguy": "ac4b06b4-c4bd-4c67-aed7-c61d075d29f7"}
# Who the character is (the reference is the pair's current card back).
WHO = {"bonk": "BONK, the orange cartoon shiba dog", "wif": "dogwifhat, the shiba dog wearing a pink knitted hat",
       "pengu": "Pudgy Penguins, the round cartoon penguin", "toad": "The Toad Pepe, a jade-green frog",
       "fartcoin": "Fartcoin, a stylised green gas cloud", "doge": "Dogecoin, the smiling shiba dog",
       "pnut": "Peanut the Squirrel, a small brown squirrel in a tiny cowboy hat", "moodeng": "Moo Deng, the baby pygmy hippo",
       "michi": "michi, the fluffy grey-and-white cat", "chillguy": "Chill Guy, the relaxed cartoon dog in a grey sweater and jeans"}
ALTS = {
 ("bonk", 1): ("Urushi", "glossy black and vermilion urushi lacquer with gold maki-e cherry blossoms and fine gold rims", "a small gold cherry blossom", "deep black lacquer", "as a gold maki-e lacquer relief on a black urushi medallion", "black and vermilion lacquer, gold maki-e cherry branches and petals"),
 ("bonk", 2): ("Glacier", "frosted ice-blue crystal, polished silver and carved snowflake facets", "a small silver snowflake", "glacier blue", "as a sculpture of frosted crystal and silver, snowflakes drifting around it", "frosted crystal facets, silver filigree and snowflakes"),
 ("wif", 1): ("Heraldry", "deep navy velvet, polished gold laurels, small crowns and royal crest engraving", "a small gold crown", "royal navy", "as a gold-framed royal portrait in a laurel crest", "navy velvet, gold laurel wreaths, crowns and heraldic scrolls"),
 ("wif", 2): ("Comic Foil", "holographic rainbow foil, bold black ink outlines, halftone dot patterns and pop-art bursts", "a small pop-art starburst", "deep magenta", "as a bold pop-art comic illustration with black ink outlines and halftone shading", "holographic foil, halftone dots and pop-art bursts in pink, cyan and yellow"),
 ("pengu", 1): ("Polar Lights", "deep teal enamel, glowing aurora-green and violet glass ribbons, silver stars", "a small silver star", "polar night teal", "as a smooth porcelain figure under glowing aurora ribbons", "deep teal enamel, aurora glass ribbons and silver stars"),
 ("pengu", 2): ("Tropic", "coral-pink and turquoise enamel, rose-gold palm leaves and pearl shells", "a small rose-gold palm leaf", "warm turquoise lagoon", "as a glossy porcelain figure on a rose-gold sun medallion", "coral and turquoise enamel, rose-gold palm leaves and pearls"),
 ("toad", 1): ("Lily Pond", "emerald enamel, gold art-nouveau lily pads, water lilies and flowing water lines", "a small gold lily pad", "deep pond green", "as a carved jade sculpture sitting on a gold lily pad", "emerald enamel, gold art-nouveau lilies and ripples"),
 ("toad", 2): ("Neon Arcade", "dark smoked glass, lime and magenta neon tube outlines and polished chrome", "a small neon lightning bolt", "dark arcade purple", "as a glowing neon sign of lime and magenta tubes", "dark smoked glass, chrome rails and lime and magenta neon lines"),
 ("fartcoin", 1): ("Steampunk", "polished brass gears, copper pipes, riveted plates and green glass gauges", "a small brass gear", "smoky bronze", "as a green glass vial in a brass and copper steampunk machine", "brass gears, copper pipes, rivets and green glass gauges"),
 ("fartcoin", 2): ("Candy", "glossy pastel pink and mint lacquer, pearl beads and sugar-sparkle details", "a small pearl bubble", "soft mint", "as a glossy pastel candy cloud with sugar sparkles", "pastel pink and mint lacquer, pearl beads and candy swirls"),
 ("doge", 1): ("Lapis", "deep lapis lazuli and gold with lotus, scarab and sun-disc patterns", "a small gold sun disc", "deep lapis blue", "as a gold relief inside a lapis lazuli sun disc", "lapis lazuli, gold lotus and scarab patterns"),
 ("doge", 2): ("Moonshot", "brushed white ceramic, polished chrome, orange enamel stripes and tiny rocket and moon details", "a small chrome rocket", "starry space black", "as an astronaut in a chrome helmet before a full moon", "white ceramic, chrome panels, orange stripes, stars and a crescent moon"),
 ("pnut", 1): ("Sapphire", "navy enamel, polished silver filigree and small sapphire crowns", "a small silver crown", "deep sapphire", "as a polished silver relief in a navy enamel medallion", "navy enamel, silver filigree and small sapphire crowns"),
 ("pnut", 2): ("Stained Glass", "leaded stained glass in autumn amber, moss green and golden yellow with oak leaves and acorns", "a small glass acorn", "warm amber glow", "as a stained-glass window with dark leading", "leaded stained glass in amber, moss and gold with oak leaves and acorns"),
 ("moodeng", 1): ("Temple Gold", "gold leaf, red lacquer and glittering glass mosaic in Thai temple patterns", "a small gold lotus", "deep temple red", "as a gold-leaf figure in a glass-mosaic temple arch", "gold leaf, red lacquer and glittering glass mosaic"),
 ("moodeng", 2): ("Splash", "pearlescent aqua and bubblegum-pink enamel, water ripples and polished chrome droplets", "a small chrome water droplet", "aqua water", "as a glossy figure splashing in pearlescent water", "aqua and pink pearlescent ripples and chrome droplets"),
 ("michi", 1): ("Sakura", "white porcelain, pink cherry-blossom enamel and fine gold lines", "a small pink cherry blossom", "soft blush", "as a white porcelain figure among pink cherry blossoms", "white porcelain, pink cherry-blossom enamel and gold branches"),
 ("michi", 2): ("Moonlight", "deep indigo velvet, silver crescent moons and small star jewels", "a small silver crescent moon", "midnight indigo", "as a silver-lit figure curled on a crescent moon", "indigo velvet, silver crescent moons and star jewels"),
 ("chillguy", 1): ("Vaporwave", "lilac-to-peach gradient enamel, chrome palm trees and fine perspective grid lines", "a small chrome palm tree", "sunset lilac", "as a chrome-outlined figure in front of a striped retro sunset", "lilac-to-peach enamel, chrome palms and grid lines"),
 ("chillguy", 2): ("Cabin", "warm oak wood, red wool tartan and brass lantern details", "a small brass lantern", "warm firelight brown", "as a cosy figure by a warm brass lantern", "oak wood carving, red tartan and brass lanterns"),
}
ORDER = list(ALTS)


def name(key):
    pair, n = key
    return f"{pair}-alt-{n}"


def front(key):
    pair = key[0]; style, materials, motif, window, _, _ = ALTS[key]
    return ("Full-bleed premium collectible trading card FRONT, filling the entire image edge to edge, straight-on, flat, no perspective, no background around it. "
            "Keep exactly the panel layout of the first reference: a slim blank title bar at the top, a large blank rectangular picture window, a thin blank type bar under it, and a large blank text box at the bottom, same positions and proportions, inside a wide border about one tenth of the card width on each side. "
            f"All panels completely empty: the bars and text box smooth warm ivory parchment, the picture window a smooth plain {window} gradient with nothing drawn in it. "
            "Match the craftsmanship and richness of the second reference. "
            f"Identity: {WHO[pair]} (from the third reference), in a {style} style. The whole border and the strips between the panels are densely and intricately ornamented edge to edge, with no large plain areas: {materials}, with {motif} motifs at the four corners and a centred medallion in the bottom border showing a tiny head of the character from the third reference. "
            f"Luxurious, sophisticated, high-detail material rendering, crisp engraving, soft studio lighting, print-quality sharpness. {NO_TEXT}")


def back(key):
    pair = key[0]; style, _, _, _, treatment, surround = ALTS[key]
    return ("Full-bleed premium collectible trading card BACK filling the entire image edge to edge, straight-on, flat, no perspective, no background around it, symmetrical. "
            f"Identity: {WHO[pair]}, in a {style} style. Centrepiece: the character from the reference, recognisable shape and colours, {treatment}. "
            f"Around it, an ornate symmetrical pattern of {surround}, fine engraving, a raised border with small corner jewels. "
            f"Luxurious, sophisticated, high detail, crisp, soft studio lighting, print-quality sharpness. {NO_TEXT}")


def jobs():
    out = []
    base = {"model": "gpt_image_2_5", "quality": "high", "resolution": "2k", "aspect_ratio": "2:3"}
    for key in ORDER:
        out.append((f"{name(key)}-front", {**base, "medias": [{"value": LAYOUT, "role": "image_references"}, {"value": QUALITY, "role": "image_references"}, {"value": REF[key[0]], "role": "image_references"}], "prompt": front(key)}))
        out.append((f"{name(key)}-back", {**base, "medias": [{"value": REF[key[0]], "role": "image_references"}], "prompt": back(key)}))
    return out


if __name__ == "__main__":
    J = jobs()
    if sys.argv[1] == "count": print(len(J)); sys.exit()
    s, c = int(sys.argv[1]), int(sys.argv[2])
    print(json.dumps([{"index": s + i, "params": p} for i, (_, p) in enumerate(J[s:s + c])]))
    print(json.dumps({s + i: n for i, (n, _) in enumerate(J[s:s + c])}), file=sys.stderr)
