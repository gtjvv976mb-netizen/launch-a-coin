# Viewport screens — 28 October 2026

The owner requested screens without scrolling, using pages, tabs and steps rather than hiding the rest of the content. This pass preserves the gold, cream, charcoal and scarlet identity, approved card artwork, shared print grid, both faces and full-motion controls.

## Public routes

The shell fills the available dynamic viewport. The phone header and navigation participate in layout rather than covering content. A visualViewport listener adjusts the canvas for browser chrome and software-keyboard changes without disabling zoom. Long collections use measured page capacity instead of an overflow container.

- Home switches between the featured card and collection pulse on phones. Trending and activity have their own tabs and page controls.
- Discover pages its card grid and keeps token search and sorting reachable.
- Designs separates the full card preview, library and pair details on phones. A native category selector preserves every filter, all 48 designs remain paged, and exact quote mint and issuer terms remain available.
- Portfolio separates tokens, NFT cards and quote balances. All 16 demo balances remain available through page controls.
- Coin screens have Card, Chart, Trade, Trades and Details views. Trade amount and review are separate steps; recent trades and card ownership are paged. Long stories use measured prose pages.
- Legal keeps Terms, Privacy and Risks as tabs, with section navigation and measured text pages.
- The mobile account sheet separates account actions from help and motion settings.

The implementation is in `app/src/carddex-viewport.css`, `app/src/components/carddex/Viewport.tsx`, the owned public routes, `AppShell.tsx` and the coin components. Inactive chain-page adapters only normalize the added route tab values; inherited chain mode remains disabled. Launch steps and secondary overlay changes were implemented and checked by the other assigned agents.

## Browser evidence

The installed Playwright CLI used a separate headless Chromium session against the local Worker at `http://127.0.0.1:5310`. The tested sizes were 1440×900, 1280×720, 768×1024, 390×844 and 320×640.

The first 50 route/viewport checks recorded no runtime errors, failed responses, broken loaded images or document overflow. Visual inspection found issues that document metrics missed: a zero-width coin heading, a clipped phone design preview and small library thumbnails. Those were corrected. The final interaction pass covered 65 states plus traversal of all 48 designs; there were no clipped controls, scrolling content regions, prose overflow or runtime errors. All 48 designs were reached through 12 pages at 390px.

An explicitly authorized local-only demo account, `rootviewportqa28`, created Viewport QA (`VPQA`, local coin `qwpy4rmo`) with a 0.1 test SOL initial buy. Its token holding and one NFT card persisted. This was a simulation, with no wallet connection, signing or real transaction. Signed-in Portfolio was checked in all three views at all five sizes. All 16 quote balances were reached through six pages at 320px.

The Portfolio check identified a narrow-phone tab label extending beyond the viewport. After the scoped flex-width correction, fresh actual-build checks at 320px and 390px confirmed all three tabs fit without injected styles. At 320px their bounds run from x=14 to x=306. Account help and motion settings remained reachable.

A software-keyboard-size check focused the trade amount at 320×640, then reduced the viewport to 320×420. The keyboard flag hid the phone header and navigation. The input remained at y=292–340 and Review buy at y=356–400, with no document overflow. Physical iOS/Android keyboard behavior, safe areas and pinch zoom still require a real device; desktop emulation does not establish those properties.

Evidence is under `output/playwright/launch-a-card-viewport-2026-10-28/`: `routes.json`, `interactions.json`, `portfolio.json`, `portfolio-final.json`, `home-retry-keyboard.log` and the corresponding screenshots. Candidate images with injected CSS are diagnostic only; `accepted-portfolio-*.png` records actual-build acceptance.

## Checks and limits

TypeScript and whitespace checks passed after the owned changes. The parent recorded a passing coordinated guarded build, 169 app tests / 8,612 assertions, and an empty Impeccable detector result. No independent build, deployment or remote resource mutation was performed by this UI agent. Public activation and RPC readiness are tracked by the parent in the production setup report.

## Final full-rotation clearance

The actual rebuilt Home was sampled through more than 360° at both desktop sizes and both phone sizes, with Full motion on and no injected styles. Front and back screenshots were inspected. A phone-only height reserve and a small individual `translate` offset keep the projected card clear of surrounding text without changing the rotation, its faces or shimmer. Desktop layout and motion remain unchanged by the phone offsets.

| Viewport | Sampled angle range | Header clearance | Caption clearance | Controls inside main |
| --- | --- | --- | --- | --- |
| 1440×900 | 9.50–383.52° | 20.13px | 44.59px | 19.81px |
| 1280×720 | 5.77–380.54° | 19.20px | 31.98px | 19.80px |
| 390×844 | 7.45–384.74° | 1.23px | 11.78px | 19.03px |
| 320×640 | 4.55–380.52° | 1.74px | 12.42px | 15.17px |

The final desktop measurements are in `home-final.json`; the subsequent actual-build phone acceptance is in `home-phone-final.json`. `accepted-home-{width}-{front,back}.png` shows both faces. Candidate offset captures and the earlier traces are diagnostic history, not final phone acceptance. No runtime errors occurred during the final sweep. Full motion remained on, and the owned `lac-viewport` browser session was closed after verification.
