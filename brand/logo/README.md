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

## Downloadable logo using actual site designs

The subsequent requested export is in [`site-backs/`](site-backs/README.md): the same fan/crown concept now uses the site's exact emerald vortex, crimson ruby and amethyst crescent reverse artwork. It includes a 2048px transparent PNG, a charcoal preview and a self-contained SVG with embedded original card images. The installed public logo assets above are separate. Reproduce this export with `node brand/logo/export-site-backs.mjs`.

## Doge, Pokémon and Pepe profile downloads

The latest requested logo set is in [`social-doge-pokemon-pepe/`](social-doge-pokemon-pepe/README.md). It uses the site's original Doge, Pokémon Classic and Pepe **card backs** in a fan with a separate jeweled crown and no lettering. The download set contains a [1024px pump.fun PNG](social-doge-pokemon-pepe/launch-a-card-pumpfun.png), a [400px X profile PNG](social-doge-pokemon-pepe/launch-a-card-x.png), a [2048px transparent master](social-doge-pokemon-pepe/launch-a-card-transparent.png) and a [self-contained SVG](social-doge-pokemon-pepe/launch-a-card-logo.svg). Both upload PNGs meet the official platform image requirements checked on 28 October 2026; the full mark also passes circular-crop and small-size visual QA. Source hashes and verification details are recorded with the set.

Reproduce the exports with `node brand/logo/export-meme-social.mjs`. These are delivery files; this exporter does not update the installed website logo or publish to any external account.
