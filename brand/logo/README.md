# Launch a Card symbol

The current identity is a **fanned hand of three card backs with a separate floating crown**. Jade, garnet and plum enamel distinguish the cards; champagne foil edges, engraved back patterns and ruby/emerald crown settings make the mark recognizable without lettering. All three cards face backward. There is no literal hand, front artwork window, monogram or theme name.

The installed symbol remains transparent and wordless in the desktop rail, phone header and SVG favicon. Existing asset filenames are retained to keep every consumer consistent. The app icons use a charcoal canvas with an 8% inset so the crown and fan stay clear of icon crops.

- `carddex-master.svg`: editable vector source, original geometric artwork.
- `carddex.svg`: installed multicolor mark, identical to the master.
- `carddex-ink.svg` and `carddex-white.svg`: single-color reproduction variants.
- `carddex-transparent.png`: 1024px transparent export.
- `carddex-gold.png`: 1024px charcoal presentation preview; legacy filename retained.
- `app/public/assets/brand/carddex-{180,192,512}.png`: app and touch icons.

From the project root, run:

```sh
python3 brand/logo/build.py
node brand/logo/export.mjs
```

The exporter uses the installed `playwright-cli` and Chromium. Set `PLAYWRIGHT_CLI` and `PLAYWRIGHT_CONFIG` to override the executable and browser configuration when needed. It renders the native SVG directly and produces a light/dark proof at 32, 48, 64, 96 and 180px in `output/playwright/logo-fan-2026-10-28/logo-size-proof.png`. Inspect the proof after a master edit. No fonts, raster tracing, external requests or image-generation credits are required.

The rejected paid Higgsfield concept remains in `archive/`. This replacement was authored as repository-native vector artwork without additional generation spend.
