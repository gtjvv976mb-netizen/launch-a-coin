# Launch a Card — actual site card backs

Three back-facing cards in a fan, with the separate gold crown above. No lettering is part of the mark.

- Left: the current `yugioh-spell` emerald vortex reverse.
- Center: the current `regal` crimson ruby reverse.
- Right: the current `aurora` amethyst crescent reverse.

These are the original full-resolution WebPs consumed by `GeneratedCardReverse`, embedded unchanged in the SVG. Their SHA-256 hashes are recorded in `sources.json` and verified against the embedded bytes. The card proportions are the site's shared 63:88 template; artwork uses the same fill behavior as the site. The crown and fan composition extend the existing native logo.

## Downloads

- `launch-a-card-logo-transparent.png`: 2048×2048 PNG with genuine alpha.
- `launch-a-card-logo.svg`: self-contained SVG composition with embedded original raster card artwork and vector crown. No external image requests are needed.
- `launch-a-card-logo-preview.png`: 1024×1024 charcoal presentation preview.

Regenerate from the project root with `node brand/logo/export-site-backs.mjs`. Set `PLAYWRIGHT_CLI` and `PLAYWRIGHT_CONFIG` to this workspace's installed executable and browser configuration when required. Chromium renders the SVG directly; no image generation, paid credits or artwork redraw is involved.

Visual inspection covers 32, 48, 64, 96 and 180px on light/dark backgrounds, plus the full preview. Proof is retained under `output/playwright/logo-site-backs-2026-10-28/`. This is the requested downloadable logo export; the public app's installed asset URLs are separate.
