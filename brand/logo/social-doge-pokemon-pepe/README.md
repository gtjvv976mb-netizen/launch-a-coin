# Doge, Pokémon and Pepe profile logo

This download set uses three **actual card backs from Launch a Card**, arranged as a fanned hand: Doge on the left, Pokémon Classic in the center and Pepe on the right. A separate gold crown with ruby and emerald settings sits above the cards. There is no lettering or literal hand.

The self-contained SVG embeds the original full-resolution WebP bytes without redrawing the card artwork. Each card uses the site's 63:88 template proportions, rounded corners and image-fill behavior. [`sources.json`](sources.json) records the original paths, SHA-256 hashes and placement.

## Downloads

| File | Intended use | Export |
| --- | --- | --- |
| [`launch-a-card-pumpfun.png`](launch-a-card-pumpfun.png) | pump.fun token image | 1024 × 1024, opaque RGB PNG, 1,182,277 bytes |
| [`launch-a-card-x.png`](launch-a-card-x.png) | X profile photo | 400 × 400, opaque RGB PNG, 204,579 bytes |
| [`launch-a-card-transparent.png`](launch-a-card-transparent.png) | Transparent master for other placements | 2048 × 2048, RGBA PNG |
| [`launch-a-card-logo.svg`](launch-a-card-logo.svg) | Transparent editable composition | Embedded original card images |
| [`launch-a-card-profile.svg`](launch-a-card-profile.svg) | Square profile composition | Dark olive-charcoal background |

The mark fits inside a centered circular crop. Its three different color families keep the cards distinct, and the crown remains separated from the fan at small profile sizes. The background editions avoid platform-dependent transparency treatment.

## Reproduce

From the project root:

```sh
node brand/logo/export-meme-social.mjs
```

The exporter uses the installed `playwright-cli` and Chromium. `PLAYWRIGHT_CLI` and `PLAYWRIGHT_CONFIG` can override the executable and browser configuration. It writes the download set here and a circular/square size proof to `output/playwright/logo-meme-social-2026-10-28/profile-size-proof.png`. It makes no external requests, spends no generation credits and does not change the live site's installed logo or any external profile.

## Platform requirements and verification

Checked against official sources on **28 October 2026**:

- [pump.fun's create form](https://pump.fun/create) recommends a square image of at least 1000 × 1000 pixels; its image upload limit is 15 MB, with PNG, JPG and GIF recommended. The 1024px PNG meets these requirements.
- [X's profile-photo upload guidance](https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo) recommends 400 × 400 pixels and limits profile photos to 2 MB. The 400px PNG meets these requirements. [X's customization guidance](https://help.x.com/en/managing-your-account/how-to-customize-your-profile) excludes animated GIFs from profile and header images.

Independent visual QA inspected the 1024px and 400px exports plus circular previews at 400, 128, 64 and 48 pixels. The Doge face, Pokémon-style ball and Pepe face remain visible, the crown stays separate and the artwork is not clipped. Fine facial detail naturally becomes smaller at 48px, while the card fan, colors and crown remain readable.

All three source-file hashes match the manifest, and the SVG contains their exact original bytes. The profile PNGs are fully opaque. The transparent master's alpha spans 0–255; even its faintest shadow pixels fit within 91.1% of the canvas circle radius, with no artwork outside the circular crop. This crop margin is a design QA decision, not a platform-published safe-area rule.
