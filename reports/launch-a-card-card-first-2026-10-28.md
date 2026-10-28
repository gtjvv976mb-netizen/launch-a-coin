# Card-first simplification — 28 October 2026

The owner asked for less clutter, compact inputs, stronger card emphasis and candlestick token graphs while keeping a memorable identity. The approved gold/cream/charcoal palette, wordless crest, all 48premium finishes, fixed canonical card print, full motion, rounded cases and both-face shimmer are retained. No paid artwork was regenerated.

| Before | After | Purpose |
| --- | --- | --- |
| Form-heavy Launch, duplicated phone preview and large reserved caption | Compact 33/67 desktop layout; one full card at every viewport; optional settings disclosed | Make the collectible the primary object while keeping the launch complete |
| Scrolling activity ticker, bright panel frames and competing decoration | Quiet collector paper, thinner 176px rail/panels, compact trending and disclosed activity | Let the card artwork carry the visual identity |
| 39px design icons in settings rows | 124px artwork previews, larger selected card, concise captions | Choose a design visually |
| Step/line market graph | Actual observed OHLC candles, quote-native units, UTC axis and touch/keyboard readout | Familiar trading structure without fabricated data |
| Phone token page opened Trade | Card opens first; Chart, Trade and Trades remain one tap away | Keep cards prominent throughout the app |

## Mechanics

Rechecked the real launch adapter and wallet sequence. Fresh quote admission and exact immutable quote/design binding, initial-buy units/limits, cost review, exact-message signing and finalized token-before-NFT issuance remain. Fixed one reproducible expiry recovery bug: account absence could come from an older finalized bank than the expiry-height response. Token and NFT replacement now use one finalized epoch height/absoluteSlot, then require finalized absence at that slot or newer. Regression tests reject mixed-backend stale responses. No transaction was signed, funded or sent.

Limited category links also had a UI state bug: only stocks/memes were respected on initial load. All recognized collections now derive from the route; old icons maps to Limited, and changing design/quote preserves the filter. Limited renders 20 actual designs.

## Verification

- 147 app tests / 8,452 assertions pass; 24 isolated adapter tests / 421 assertions pass. Both TypeScript checks and the source-fingerprint-guarded build pass.
- Worker dry-run passes, 2,197.31 KiB gzip. No deployment occurred.
- Launch browser QA: 1440×900,1280×720,768×1024,390/320×844. Desktop cards 466×651 and 350×490 respectively; 40px desktop/ 44px phone fields. Single preview/selector, quote-pending Enter guard, compatible finish confirmation, initial-buy reset, optional settings, full motion/Pause/Resume, inspector front/back and focus restoration pass. No overflow, runtime errors, failed responses or write requests.
- Candle QA: TSLAX and DOGE at 1440/390/320; all four ranges, empty range, actual wick/body/doji, touch and keyboard OHLC pass. Zero/one-trade full pages were not fabricated; aggregation tests cover those cases and single-observation dojis render in existing history.
- Root route QA: Home 1440/1280×720, Levels 1440/1280×720, Discover 1440, token 1440 and Launch 1440. No page or main horizontal overflow, runtime errors or failed first-party responses. Home card 480×670 at 1440; selected design 440px wide. Complete token case 387.5px wide at 1440 and 219.9px at 1280×720, with full label/controls inside the viewport.
- Independent phone QA at 320/390: Home controls, 20 limited cards, category/quote linking, search/sort, empty results, all coin tabs, both case faces and inspector controls pass. Corrected library row overlap, header/library clipping, search contrast and phone tilt-button contrast. Physical phone sensors remain untested.
- Impeccable mechanical detection returned no findings. Browser console still has the existing unused Instrument Sans preload warning; no runtime failure.

Evidence is under ignored output/playwright/card-first-2026-10-28/, output/playwright/launch-a-card-simplify-2026-10-28/ and the compact-final-launch evidence listed in the companion launch report. See desktop.json, case-fit.json, phone-audit/README.md, build.log, tests.log, adapter-tests.log and worker-dryrun.log.

Public DNS/production setup remains the previous task's outstanding release requirement. This change is local and saved in the independent Launch a Card repository. MintDex was unchanged.
