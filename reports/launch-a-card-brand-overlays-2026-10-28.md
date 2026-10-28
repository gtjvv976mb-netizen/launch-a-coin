# Launch a Card brand and bounded overlays — 28 October 2026

The owner asked for a multicolor hand of card backs with a separate crown, and for the platform to use explicit views instead of scrolling. This work stays inside the independent Launch a Card project; no MintDex resources or assets were changed.

## Brand

The new wordless mark is a fan of three engraved card backs in jade, garnet and plum, with champagne foil edges and a separate floating gold crown set with ruby and emerald shapes. Each card is clearly a back: there are no title bars, illustration windows, text or monograms. The master is repository-native geometric SVG. No image generation or paid credits were used.

The installed color SVG, monochrome reproduction variants, 180/192/512px app icons, 1024px transparent export and presentation PNG were updated. Their existing asset URLs are retained. `brand/logo/build.py` installs the SVGs, and `brand/logo/export.mjs` provides reproducible Chromium PNG exports. The SVG requests no fonts or external assets.

Visual inspection covered 32, 48, 64, 96 and 180px on cream and charcoal backgrounds. The actual built app also loaded the SVG at its existing 28px phone-header and 52px desktop-rail sizes. The card fan, independent crown, rounded edges and three colors remain recognizable. The transparent PNG is 1024×1024 RGBA; app-icon dimensions were checked. All SVGs parse successfully, the public color SVG matches the master, and the scoped mechanical detector returned no findings.

## Overlay behavior

| Before | After | Purpose |
| --- | --- | --- |
| Desktop dialogs could scroll inside a height cap | Fixed viewport-bounded flex body with an independent heading | Keeps the close control and page navigation visible |
| Phone sheets had an inner scroll area | Viewport-bounded paged body with safe-area padding | Makes every section reachable with explicit controls |
| Guide stacked three steps, fees, legal links and settings | Five pages: three steps, costs/risks, and motion/entry settings | Retains all copy and controls without a long column |
| Entry introduction, account note and form shared one column | Information page followed by a compact handle form | Keeps errors and submit visible in a keyboard-sized viewport |
| Launch celebration stacked card, ownership copy and sharing | Full card page followed by ownership/demo copy and sharing | Gives the card the first view and preserves all sharing controls |
| Confirmation content and actions shared a flowing stack | Separate warning and action regions | Keeps the current warning and both outcomes visible together |

Radix/Vaul focus trapping, Escape/outside dismissal, close controls, return-focus handling and wallet authorization behavior are unchanged. The shared `ViewportPages` helper was corrected by the launch agent after QA found that moving to the final page could disable the focused Next button. The final helper moves focus to the current page region without scrolling; first/last-page navigation now keeps focus inside the modal.

The phone sheet also explicitly clips Vaul's decorative background tail. This is a pseudo-element placed below the real panel: at a 600px panel height it begins at 600px and is 1200px tall. It contains no content. `overflow:clip` bounds this decoration without creating a scroll container. DOM `scrollHeight` still reports the clipped pseudo-element; that value is not evidence of hidden content. Real panel descendants were measured independently and fit.

## Browser verification

The coherent built app at `http://127.0.0.1:5310` was exercised at **320×640, 390×844 and 1440×900**, with no runtime errors in the recorded flows. Initial Guide/Enter QA covered 22 page states. Final focus/confirmation/celebration QA covered 21 states:

- Guide final page and return to its first page keep focus inside. Closing returns to the actual opener on all three sizes.
- All five Guide pages retain the steps, fee/demo qualification, Terms link, motion switch and entry action.
- Enter retains its account-access warning, handle validation, reserved-handle error and intended submit label. The form/error state fits at all three sizes.
- A **320×320 keyboard-sized layout** keeps the field, reserved-handle error, Back and submit visible. This is viewport emulation, not a physical keyboard or phone test.
- The current Start over warning and both actions fit all three sizes. Cancel preserves the account and restores the phone account opener; on desktop the existing nearest-visible-focus fallback lands on the Home heading after its popup opener unmounts.
- One isolated **local demo** account and demo token/card were created to exercise the real celebration route. This used only simulated test balances. No mainnet wallet was connected, no real transaction was signed or sent, and nothing was posted to X.
- The actual new-card reveal and the separate ownership/demo/share page fit all three sizes. Copy link and Post on X remain present. The share action was inspected but not posted.

After the coordinated rebuild, an actual-bundle readback confirmed `overflow:clip` on the sheet and body, a 541px body with exactly 541px of content, and `scrollTop` remaining zero after an attempted scroll. Close, Escape and a mouse-driven drag-to-dismiss all work. Every measured control stays within the 320×640 viewport. Physical iOS/Android keyboard behavior, safe areas and touch gestures still require hardware verification. This agent did not deploy or claim a successful mainnet launch; the parent owns production activation and final release checks.

## Evidence

- `output/playwright/logo-fan-2026-10-28/logo-size-proof.png`
- `output/playwright/logo-fan-2026-10-28/logo-site-320.png`
- `output/playwright/logo-fan-2026-10-28/logo-site-1440.png`
- `output/playwright/logo-fan-2026-10-28/overlays-qa.json`
- `output/playwright/logo-fan-2026-10-28/enter-keyboard-size.png`
- `output/playwright/logo-fan-2026-10-28/final-overlay-qa.json`
- `output/playwright/logo-fan-2026-10-28/clip-readback.json`
- `output/playwright/logo-fan-2026-10-28/confirm-final-320.png`
- `output/playwright/logo-fan-2026-10-28/launched-320x640-1.png`
- `output/playwright/logo-fan-2026-10-28/launched-final-share-320.png`
