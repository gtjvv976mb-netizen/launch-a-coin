# CardDex symbol

The current identity is a premium gold-foil trading card with a sculpted crown and ruby settings. It has no lettering, monogram or blue. The portrait frame, illustration window and inset paper wells echo a rare Pokémon-style collectible card. The visible brand mark remains symbol-only in the desktop rail, mobile header, favicon and app icons.

- `carddex-master.svg`: editable vector source.
- `carddex.svg`: installed color mark.
- `carddex-ink.svg` and `carddex-white.svg`: single-color reproduction variants.
- `carddex-transparent.png`: 1024px transparent export.
- `carddex-gold.png`: large presentation preview.

Run `python3 build.py` from this folder to copy the SVG masters into the app. PNG/app-icon exports were rendered from that same vector in Chromium, at 180, 192, 512 and 1024px. Inspect each size after changing the master. No fonts, raster tracing or external requests are required by the installed SVG.

The rejected paid Higgsfield concept is retained only in `archive/`. The replacement vector was authored locally without additional image-generation spend.
