# Crown-free pixel logo series

Requested 28 October 2026: keep the pixel-art direction and remove the crown. Three different brand concepts use pixel-art interpretations of the actual site's Doge, Pokémon Classic and Pepe card backs, without lettering.

| Concept | Meaning | Main download |
| --- | --- | --- |
| 01 — Card Fan | The simplest recognizable collector's hand | `01-card-fan-avatar.png` |
| 02 — Booster Pack | The excitement of launching and opening a collectible | `02-booster-pack-avatar.png` |
| 03 — Collector Album | A collection with a permanent identity | `03-collectors-album-avatar.png` |

**Recommendation:** Card Fan is the strongest primary logo because it reads fastest at small sizes. Booster Pack offers the most distinct launch metaphor and works well for campaign art. All three share the website's warm gold, charcoal and cream, with the card artwork's red, green and blue colors.

The raw generated concepts are the three un-suffixed 1254px PNGs. The `-avatar.png` versions are 1500 × 1500 transparent profile exports with additional breathing room. The matching native SVGs embed each generated PNG unchanged at its original pixel dimensions, center it, and mask faint stray transparency outside the avatar boundary. The important opaque silhouettes are inside a radius of 685px; the presentation mask is 730px on a 750px-radius canvas. It does not remove card artwork. The larger avatar files remain below 2 MB each. `series-preview.png` compares the mark on dark and cream backgrounds, circular 128px crops and 48px silhouettes. Fine face/engraving detail naturally reduces at 48px.

Created with **built-in image generation**, using the previous pixel logo as the style reference and the three actual site card-back WebPs as identity references. These are faithful style interpretations, not unchanged embedded card images. No additional Higgsfield generation was submitted. Full prompts and reference paths are in `prompts.json`.

Native export: `node brand/logo/export-pixel-series.mjs` (installed Playwright CLI and Chromium). Original generated assets are preserved. No live site, token, profile or social account has been changed. The earlier social kit remains paused while the logo direction is selected.
