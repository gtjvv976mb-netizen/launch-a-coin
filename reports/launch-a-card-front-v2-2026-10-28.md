# Launch a Card: consistent themed fronts — 28 October 2026

**Later publication update:** the owner subsequently requested **make it live**. This verified redesign is included in production version `70b4ec76-b521-4469-8ba3-02ba6670f42d`. The preview-only statements below describe the original implementation turn; see the [release record](launch-a-card-meme-release-2026-10-28.md) for current deployment status and limitations.

The owner requested redoing every card front, removing the bottom platform/coin-number text and making all cards seamless and consistent with their chosen theme. The owner then explicitly reinforced removing both empty bottom slots and making that area part of the design.

## Result and scope

All48 designs now share one immutable `launchacard-v2` grid: aligned name, larger artwork window, ticker/quote and details panels. Every live content panel uses the same10%–90% width. Artwork occupies15%–59% of card height; details extend to92.5%. Shared width-relative print metrics drive browser CSS and trusted SVG export. Safe detail insets keep heavy floral/metal corner ornaments clear of the ink.

Both footer slots are removed, along with platform/owner text, coin serials, the universal hex seal and extra stock engraving block. The bottom is continuous native themed material sampled below all old footer plates. The top1/1 and the separate case identity label remain.

The old compositor reused the complete outer frame around the art aperture and put generic cream rectangles over original themed paper. It also sliced footer placeholders into a universal lower platform. The replacement uses the actual aperture rim, original textured plate centers/corners and an asymmetric clean perimeter crop. Source selection corrections prevent the Archive medallion covering the token name and prevent thin/incorrect companion bars in Duel Masters/One Piece.

83full1260×1760 PNG atlases and83transparent320×447 previews were regenerated locally. Browser faces and Home preloading now use those exact flattened atlases, matching NFT exports and avoiding low-resolution browser source slicing. Palette fallback remains available for slow or failed image loads. Original Higgsfield fronts/backs and reviewed source hashes are unchanged. No paid image generation occurred.

No navigation, logo, wallet transaction, token pair, quote accounting, card back or physical3D motion implementation changed. The preceding gallery-wordmark proposal remains unapproved and uninstalled.

## Trusted export and recovery

`CARD_RENDERER_VERSION=launchacard-canonical-v2` is shared by the compositor, exported SVG and atlas manifest. Fresh trusted image loading validates the version, dimensions, original reviewed source hash and PNG digest. New launches require a fresh current composition. Existing saved/prepared intents retain their immutable asset references and recovery path; lifecycle behavior and wallet-signing boundaries are preserved.

## Verification

- **162 app tests /10,338 assertions pass**, including the manifest/preview hashes, all48 front roles, retired-footer absence, realPNG output, tampered/stale atlas rejection and saved-intent recovery. The2build-integrity tests are included in that count and also passed their focused run.
- **Guarded TypeScript/client/SSR build passes.** The initial optional-radius type errors were corrected by making the canonical radius required; no geometry changed during that correction.
- **Production Worker packaging dry-run passes** using the existing production config; the command exits before uploading or deployment.
- **Impeccable detector:** empty result for changed card UI targets.
- **48 designs /83variants ×200,320,420px:**249source/flattened states and249screenshot comparisons pass. All48 flattened fronts were manually inspected at all three widths across18contact sheets; no empty bottom slots remain. Small image-downsampling/antialias differences are documented in the parity report; placement and materials match.
- **Hydrated desktop:** Home/Honk, Limited/Doge, Neon, Pepe demo Launch and Honk coin card at1440×1000, plus Doge archive at768×1024, pass. All show v2 geometry, decoded flattened skins and actual artwork without footer nodes, document overflow, first-party response failures or runtime errors.
- **Phone emulation:** Home/Honk, Doge archive and Pepe demo Launch at390×844 and320×740 pass. Touch drag reaches the wordless matching back and returns to the front. Front/back shimmer gradients remain active. No image or console errors; only an existing unused-font preload warning. Physical phone sensors were not exercised.
- **State checks:** maximum-length UI token name/ticker retain ellipsis, no title/numeral overlap and no footer. Intentional atlas load failures retain the themed fallback and shared layout without overflow or runtime errors.
- Actual trusted Resvg card and case proofs for Doge, Pepe, TSLA and Neon retain complete rounded shapes and alpha corners, with no bottom owner/platform/serial.

Evidence is under ignored `output/playwright/card-front-v2-2026-10-28/`: `final-report.json`, `parity-report.json`, `manual-review.json`, desktop/state reports, phone captures,18flattened contact sheets and `exports/verification.json`. Build/test/detector logs are retained there.

## Publication status

Implemented and verified in the local preview at `http://127.0.0.1:5310`. No production deployment, Git push, purchase or real wallet transaction occurred during this redesign. The prior live Worker deployment remains unchanged. Existing already-published immutable NFT images are not rewritten by a new renderer version.
