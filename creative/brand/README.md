# Launch a Card logo

`launch-a-card-logo-source.webp` is the owner-supplied logo (29 October 2026): a cream card with a gold rim, a red
top-right corner and "LAUNCH A CARD" in dark serif capitals, on a dark brown ground (#26120b). Every brand file under
`app/public/assets/brand/` is derived from it; none is redrawn.

| File | Made from | Used by |
|---|---|---|
| `carddex-180.png`, `favicon-180.png` | the whole square, resized | apple-touch-icon |
| `carddex-192.png`, `icon-192.png`, `carddex-512.png`, `icon-512.png` | the whole square, resized | manifest icons, structured-data logo |
| `carddex-maskable-512.png` | the card at 62% height on #26120b, inside the 80% safe circle | manifest `maskable` icon |
| `launch-a-card-logo.webp` | the card cut out on a transparent ground, 640px tall | large placements |
| `carddex.svg`, `favicon-16.png`, `favicon-32.png`, `app/public/favicon.ico` | the card without its lettering (the band is filled with the card's own blank paper), centred in a square | browser favicon, rail and phone-header mark |
| `wordmark.webp` | the logo's own lettering, as a white alpha mask (2.244:1, 120px tall) | the rail lockup, coloured by a token through CSS `mask` |

At 16–32px the lettering cannot be read, so the small mark is the wordless card and the name sits beside it in the
logo's own letters. Do not swap the lettering for a web font.
