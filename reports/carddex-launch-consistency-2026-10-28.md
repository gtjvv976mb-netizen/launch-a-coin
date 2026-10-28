# CardDex launch and card consistency

28 October 2026. Local CardDex work only, on `codex/carddex-creator-designs`.

## Requested result

The launch page follows MintDex's form composition: token details on the left and a complete, open card preview on the right. CardDex retains its warm collector palette, permanent design selection and simulation flow. The live MintDex launch page was inspected as a read-only layout reference; its production state and resources were not reused.

At 1440 × 1000, both applications' launch columns start at x248 and x928.09, with widths 660.09 and 487.91 pixels. CardDex's card fills the available stage without a second enclosing panel. On phones, an inline live card sits beside Name/Ticker and opens the existing 3D inspector. Editing the token returns a turned preview to the front; automatic rotation resumes after the existing interaction delay unless paused.

## One template, 48 finishes

Every active front renderer now uses `CanonicalCardFace`, `CanonicalCardSkin` and the frozen `CANONICAL_CARD_LAYOUT`. The print grid is the original MintDex Spark geometry at 63:88, with identical artwork, name, ticker, description, address, market-cap, holder, creator and serial positions and typography. The same structure is used on Launch, Home, Designs, coin views, thumbnails and the 3D inspector, including loading and failed-image states.

The existing Higgsfield images remain untouched. Their measured coordinates now select border and plate ornament pixels into an SVG decoration atlas; they no longer position live content. Opaque shared panels prevent old source apertures from showing through. Each skin keeps its own material, ornament, foil response and wordless reverse. A shared wordless hex seal and fine engraved rays fill the lower gutter without moving any content slot. Selected keys and stock-reference mappings remain compatible with existing records.

## Collector background

The warm wall now contains original guilloche, engraved card outlines, woven diagonals, parchment fibre and small ruby accents. The static SVG is 22,962 bytes. Existing ambient light and floor layers provide motion; no additional animation loop or paid image was introduced. Forms retain opaque paper fills. Full remains the default; Calm, reduced motion and existing visibility/dialog gates are preserved.

## Verification

- TypeScript and the source-safe client/SSR build pass after the final seal polish. All 83 active tests pass, with 6,429 assertions across nine files. `git diff --check` is clean.
- Launch checked at 1440 × 1000, 1280 × 720, 1024 × 768, 768 × 1024, 390 × 844 and 320 × 740. Complete desktop cards and inline phone cards fit; all six had no horizontal overflow, runtime errors, failed first-party responses or broken visible images.
- A local artwork upload, live field editing, Doge-to-stock design change and phone inspector were exercised. Slot/font signatures stayed identical, token metadata survived the design change, editing returned the card from approximately 180° to 0°, and the phone inspector retained the same identity and closed correctly. No failed responses or runtime errors occurred.
- Home, Launch, Coin and Designs checked at 1440, 390 and 320 pixels: all 12 background views passed. Full ambient animation, Calm and reduced-motion behavior were verified.
- An independent source review confirmed all 48 atlas crops stay in bounds, fallback geometry is common, old front layouts are unreachable, and design persistence remains intact.
- All 48 decoded phone fronts/backs passed equal normalized live-slot and font signatures, text fitting, rounded clipping and both-face touch shimmer. Representative Legend and TSLA turntable traces covered a full turn, pause and resume without runtime or hydration errors.
- After the final seal polish, eight desktop and eight phone representatives passed content clearance, identical slot/text-font signatures within each viewport, image loading, rounded clipping and page fit. Both additional full-turn/pause/resume traces passed with zero runtime or hydration errors.

Browser evidence is under `output/playwright/carddex-launch-consistency-2026-10-28/`: `launch-matrix.json`, `launch-live.json`, launch screenshots, `final-build.log` and `final-tests.log`. Background and collection evidence is under `output/playwright/carddex-2026-10-28/`: `COLLECTOR-BACKGROUND-QA.md`, `canonical-card-review.json`, `canonical-motion-review.json`, `canonical-seal-review.json`, the front/back contact sheets and `CANONICAL-CARD-REVIEW.md`. These are ignored local files. Phone checks use browser emulation; physical phone sensors and hardware were not tested.

## Scope boundary

No new generation credits, public deployment, production transaction or account changes occurred. CardDex remains an isolated local simulation at port 5310. Real pump.fun launches, NFT issuance and durable public metadata still require the production adapter described in the project README. MintDex source and production resources were not modified.
