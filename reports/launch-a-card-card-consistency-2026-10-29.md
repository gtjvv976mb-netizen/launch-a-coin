# Card consistency audit and corrections — 29 October 2026

The owner's instruction is to keep every card consistent in template and structure, premium in design, with Higgsfield as the required artwork provider. The existing 48-design collection passes the shared-template and paired-artwork review. Four defects were identified and corrected in local preview: shifted creator artwork, inherited artwork tint, inconsistent export label typography, and a collapsed Home card on short landscape phones.

At audit completion this work changed the local preview only; no deployment, push, paid generation or wallet transaction occurred during the audit. The owner's subsequent instruction to finish the work authorized the [version-only production release](launch-a-card-card-consistency-release-2026-10-29.md). Production availability work recorded in AGENTS.md belongs to the separate ongoing Cloudflare task; its configuration and hotfix files were preserved.

## Corrections

| Before | After | Why |
| --- | --- | --- |
| The shared browser image inherited a −3% top/left offset but used 100% width/height, leaving exposed strips at the bottom/right of the art aperture. | Canonical artwork uses zero inset, full aperture dimensions and centered cover cropping. | Creator artwork fills the same complete window in the preview and trusted export. |
| Browser token art inherited saturation, contrast and sepia filters that were absent from the exported NFT. | Canonical creator artwork has `filter: none`. | Preserve the uploaded token colors consistently; foil and lighting remain separate layers. |
| Exported data labels inherited the serif font and their dotted rules used proportional width estimates; browser labels use Courier Prime. | Export labels explicitly use Courier Prime at the matching weight, with monospace rule-width estimates. | Match the browser's data hierarchy and prevent label/rule spacing drift. |
| At 844×390, 667×375 and 568×320, Home's stacked caption reservation could produce a nonpositive card width. | A scoped landscape layout puts the rotating card in its own column and the caption/controls beside it. | Keep the card and controls visible without adding document scrolling or shrinking portrait/desktop cards. |

The shared content template remains `launchacard-v2`: 63:88 proportions; smooth common rounded edges; name, artwork, ticker/pair and details aligned from 10% to 90% width; art at 15%–59% height; details reaching 92.5%; no bottom identity/serial labels or empty footer slots. Design-specific material, ornament and reverse artwork remain distinct.

The trusted renderer advances from `launchacard-canonical-v2` to `launchacard-canonical-v2.1` because label output changes. Only the renderer-version metadata of the 83 existing atlas records changes; their image bytes, hashes and paths remain unchanged. Newly prepared launches require current compositions. Regression tests verify that saved v1/v2 intents continue to recover their committed images and metadata. The composition-binding schema remains unchanged.

## Collection and artwork review

- All 48 designs use the canonical front component and identical normalized content-role positions. Full, compact and lite views share this structure.
- All 83 full-size atlases and 83 previews match pinned dimensions, source bindings and SHA-256 hashes. Full-resolution alpha masks are identical across all 83 atlases, as are preview masks; external corner pixels are transparent.
- Fresh contact sheets show every current front with its actual themed reverse. All 48 pairs were visually inspected for coherent material/palette, complete rounded perimeters, clear content surfaces, integrated lower material and absence of retired footer boxes. Ornate Bloom, Tide and Frost corners were also compared against actual 320px canonical renders.
- All 179 current atlas/source hashes in that visual review match their records; 176 image instances decode. The contacts are a visual comparison, not a substitute for hydrated browser or export checks.
- All 35 neutral plain/stock atlas pairs intentionally share the same frame pixels. The printed pair identifies the selected quote; a stock quote does not claim a newly generated frame or imply equity backing.
- The separate local provenance audit verifies 48 complete pairs, 96 completed Higgsfield jobs and 96 matching full-size WebPs, with no missing or mismatched sources. No new generation is needed for these structural corrections.

## Verification

- App/chain suite: **244 tests passed, 0 failed, 13,115 assertions**. This includes all-design export-label coverage, pinned assets, PNG/case exports and previous-renderer recovery.
- TypeScript and the guarded client/SSR build passed. The guarded build detects source/config/asset changes during compilation.
- Impeccable manual detector returned an empty findings array for the changed card/export files and the landscape layout.
- Baseline hydrated catalog: **96/96 states** across all 48 designs at 1440×1000 and 390×844. Identical normalized content geometry, decoded front/back assets, full motion, two lighting planes, rounded clipping, no obsolete footer and no document overflow; no page errors or failed first-party asset responses.
- **7/7 full-turn traces** cover Pokémon Classic, Doge and TSLA on desktop; One Piece, Legend and Pepe on phone; Neon Circuit at 320×640. Each covers more than 360°, both sides and changing light values while retaining rounded clipping.
- **12/12 long-content launch states**, at desktop and 320px phone width, retain bounded content for 24-character names, eight-character tickers and 268-character descriptions. These were unsaved form edits; no upload/authentication or transaction writes occurred.
- Fresh trusted-output proofs for Doge, Pepe, TSLA and Neon Circuit produce four 1260×1760 cards and four 1440×2240 marketplace cases, all with transparent outer corners. Doge card and Neon Circuit case were inspected after the font change. Supplied WOFF2 fonts were verified with the actual Resvg runtime.

The final guarded bundle passes **96/96 additional catalog checks** across all 48 designs at 1440×1000 and 390×844: creator art has zero top/left offsets, no filter or margins, and matches the complete aperture dimensions; trusted skins decode and there is no document overflow or page error. Home passes **5/5 viewport regressions / 200 sampled frames** at 844×390, 667×375, 568×320, 390×844 and 1440×1000: nonzero card dimensions, full motion, reachable arrow/dot/Pause controls, working Next and Featured/Pulse tabs, no card/control overlap or document scrolling. No page errors, bad responses or write requests were recorded in that Home pass. All five final layouts were visually inspected; a settled 568×320 supplement confirms the post-Pulse entrance completes with visible heading and resumed motion. `browser/summary-final.json` records the complete result. The owned QA browser and temporary contact-sheet server are closed; preview port5310 remains running.

## Evidence and limits

Ignored local evidence is under `output/card-consistency-2026-10-29/`: `static/` contains the manifest/font review, `visual/` the six full-collection contacts plus stock comparisons, `browser/` the hydrated layout/motion/content evidence, `exports/` the current PNG/SVG proofs and `verification/` the tests/build/detector logs.

All new or creatively redesigned decorative card artwork must follow [the Higgsfield workflow](../creative/higgsfield/WORKFLOW.md). Code remains responsible for the shared grid, creator content, composition, export and interaction. Reusing a verified finish is labelled reuse.

Browser checks use Chromium viewport emulation and synthetic interaction; physical phone gyroscopes, Safari and hardware frame pacing were not verified. No real wallet issuance was tested. The audit can remove known in-scope defects in the reviewed states, but it cannot certify every device or future creator input as flawless.
