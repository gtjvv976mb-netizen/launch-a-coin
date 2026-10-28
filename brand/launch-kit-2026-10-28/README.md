# Launch a Card — pump.fun and X kit

Prepared 28 October 2026. The crowned logo uses the actual **Doge, Pokémon Classic and Pepe card backs** from the site, embedded unchanged. This is a brand asset package; it does not create a token or change an external profile.

## Upload files

| File | Use |
| --- | --- |
| `pumpfun-token-image-1024.png` | 1024 × 1024 token image, opaque PNG |
| `x-profile-400.png` | 400 × 400 X profile image, opaque PNG |
| `x-header-1500x500.png` | 1500 × 500 X header, opaque PNG |
| `logo-transparent-2048.png` | 2048 × 2048 transparent logo master |
| `logo-master.svg` | Self-contained editable logo composition |
| `x-header-master.svg` | Self-contained header artwork with embedded fonts |
| `COPY.txt` | Copy/paste names, description, bio, links and posts |
| `card-art-sources.json` | Original art hashes and placement |

The header extends the existing native SVG brand system with foil engraving and embedded site fonts. No new AI generation or paid image credits were used. The two profile PNGs are byte-for-byte copies of the earlier social-logo exports. The fan and crown fit circular avatar crops. Header text stays inside the middle 380px of the 500px image, with room at the bottom left for the profile-photo overlap.

## Use

1. On pump.fun, enter the name, confirmed ticker, description and social links from `COPY.txt`; upload the 1024px token image. `LAC` is a proposed ticker, not a claim that a token has been issued. No contract address is included.
2. For X, upload the 400px profile image and 1500 × 500 header, then copy the bio and website field. The handle matches the existing `@launchacard` page observed in the browser; this kit does not register a handle.
3. Review the preview before saving. The X header can also be tried in pump.fun's optional banner uploader, but pump.fun does not publish a banner-specific size in its readable create form; inspect that crop separately.
4. Post the pinned copy when ready. No posts or profile changes have been submitted by the agent.

## Current website link

The canonical website remains `https://launchacard.fun`. On 28 October it passed normal-DNS HTTPS tests from Singapore, Germany and the US, while Philippine network tests and the owner's access still failed. The temporary browsing address is `https://launch-a-card.gtjvv976mb.workers.dev/`. Mainnet wallet actions retain their canonical-origin restriction, so this address is not presented as a replacement launch origin. Check canonical access before committing permanent token/social metadata. See `reports/launch-a-card-availability-2026-10-28.md` in the project for the diagnostic evidence.

## Official export guidance checked 28 October 2026

- [pump.fun create](https://pump.fun/create): square token image recommended, at least 1000 × 1000, maximum 15 MB; PNG/JPG/GIF recommended. Name, social and banner details are marked uneditable after creation in the current form.
- [X profile customization](https://help.x.com/en/managing-your-account/how-to-customize-your-profile): header 1500 × 500, profile 400 × 400, bio maximum 160 characters; no animated GIFs for header/profile. About 60px at the top and bottom of a header may be cropped.
- [X image upload troubleshooting](https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo): profile image maximum 2 MB. A separate current header-specific maximum was not confirmed; the exported PNG is kept under 2 MB.

The pump.fun description is 155 characters, X bio 133, and pinned copy 246 with literal URL length. X applies its own URL counting. No performance, financial return, stock backing, trading-volume or token-utility claims have been invented.

## Reproduce

From the project root, run `node brand/export-launch-kit.mjs`. The exporter uses the installed Playwright CLI and Chromium, embeds the retained site artwork and fonts, and makes no external requests. The crop proof is saved separately under `output/playwright/launch-kit-2026-10-28/`.
