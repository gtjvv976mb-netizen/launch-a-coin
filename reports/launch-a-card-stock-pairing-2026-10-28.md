# Stock-card pairing — preview verification, 28 October 2026

**Later publication update:** the owner subsequently requested **make it live**. This verified pairing work is included in production version `70b4ec76-b521-4469-8ba3-02ba6670f42d`. The preview-only statements below describe the original implementation turn; see the [release record](launch-a-card-meme-release-2026-10-28.md) for current deployment status and limitations.

The owner requested work on stock-card design pairing and answered the earlier front-deployment question **Keep in preview**. All changes below are local. Nothing was deployed or pushed, no paid generation was submitted, and no real wallet transaction was signed or sent. The earlier production version remains unchanged. Preview: **http://127.0.0.1:5310/levels?collection=stocks**.

## Result

Ten existing stock-bound card finishes now share one explicit design-to-quote policy. Stock catalog metadata comes from that policy and the reviewed asset registry, avoiding independent decorative pairs such as `TSLA / SOL`. The six premium finishes and four matching limited finishes retain their approved artwork and the common v2 front template.

| Reference | Exact quote symbol | Premium finish | Limited finish |
| --- | --- | --- | --- |
| GME | GMEX | GameStop Arcade | Power Play |
| TSLA | TSLAX | Tesla Current | — |
| NVDA | NVDAX | NVIDIA Silicon | — |
| AAPL | AAPLX | Apple Titanium | — |
| MSTR | MSTRX | Strategy Reserve | Orange Reserve |
| COIN | COINX | Coinbase Vault | Blue Current |
| AMC | AMC | — | Midnight Premiere |

The creator's actual trading pair is `CREATOR_TICKER / QUOTE_SYMBOL`. These are tokenized quote assets; the creator token and card do not become company shares. BlackBerry and Nokia artwork remain decorative designs without an invented stock quote. Neutral finishes still permit any of the 16 reviewed quote assets. DOGE, BONK and WIF bindings remain intact.

## Interaction changes

- The stock collection opens on an appropriate stock finish; a valid requested stock quote selects its preferred finish when no explicit design is supplied. Archive choices show visible reference/quote chips.
- Launch's **See all 48** opens a paginated design browser inside the form. Tiles use the creator's current artwork, name and ticker. Choosing a stock finish retains those fields and the launch mode, sets its exact quote and clears any initial-buy amount when the asset changes.
- A neutral finish with a stock quote offers **Matching stock designs**. Opening it leaves the current design unchanged; applying a premium or limited finish keeps the same quote. Focus returns to the quote selector.
- Changing a bound finish's quote requires an explicit compatible finish. Until Keep or Use is chosen, the archive's launch link and Designs tab are disabled. This prevents discarding a pending pair change by navigating away through those controls.
- Existing launch locks also disable the design browser and matching actions. No decorative words or extra slots were added to card artwork.

## Data and transaction coherence

The real quote mint/design binding was already enforced by the launch integration. This work fixes legacy API reference projections so `stockTicker` derives from the actual stored stock quote, and `tokenPair` aliases the creator's actual stock-quote pair. Optional legacy input echoes are checked against that same identity. No database schema migration or stored-data rewrite was needed. Historical stock artwork with stored SOL stays SOL on reads and trades.

Regression coverage exercises all ten bound designs through mocked token/NFT metadata, prepared NFT plans, immutable SQL identity, completion and recovery reads. The pinned official SDK also prepares unsigned `create_v2` and Core plans for all ten, checked by the independent client verifier and finalized-transaction/account fixtures. The mocked RPC's send count stays zero. Substituted quote identity is rejected.

## Current provider verification

A fresh read-only public mainnet check at **2026-10-28 13:06:28 UTC**, confirmed slot **462487107**, matched the expected mainnet genesis and found `createV2Enabled=true`. All 16 reviewed assets retained native/global/direct QuoteControl admission; mint owner, decimals and state matched, with positive reserves. Some reserve amounts had changed, as expected. Historical demo reserve inputs were preserved; real preparation already fetches fresh admission and reserve state.

Primary references: [Pump custom pairs](https://pump.fun/docs/custom-pairs), [official coin creation](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/COIN_CREATION.md), [official custom quote instructions](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md), and [pinned SDK 4.1.0 metadata](https://registry.npmjs.org/@pump-fun/pump-sdk/4.1.0). The public list spells Apple APPLX; the app's existing AAPLX label has the same exact listed mint. No SDK upgrade or new quote admission was introduced.

Raw verification and account evidence are under ignored `output/stock-pairing-2026-10-28/`. Provider admission is time-sensitive and is rechecked before a real launch; this snapshot is not a completed issuance.

## Validation

- App suite: **177 passed, 0 failed; 10,693 assertions**.
- Adapter suite: **34 passed, 0 failed; 511 assertions**.
- Guarded TypeScript/client/SSR build passed; adapter TypeScript passed.
- Impeccable detector returned `[]` for changed UI targets; final whitespace/diff checks passed.
- Archive browser checks: 50 assertions across desktop1440×900, phone390×844 and small phone320×568. Covered stock defaults/filter, exact Launch link, pending locks, Keep/apply, neutral recommendations, premium/limited GME selection and AMC-only limited selection. No document overflow or clipped controls.
- Launch browser checks: creator details and uploaded artwork survive stock selection; Demo stays Demo; quote changes clear initial-buy units; desktop stock pagination shows all ten finishes; Escape restores the browser opener's focus. The dialog/sheet fits1440×1000,390×844,320×740,768×1024 and844×390 landscape without body/document scrolling. Small-phone selection also retains artwork, name, ticker and mode.
- No browser runtime errors or failed first-party responses. Archive emitted only existing unused-font preload warnings. The phone sheet's clipped Vaul decorative tail is excluded from scroll-content measurements; its visible body and controls fit the viewport.

Evidence: ignored `output/stock-pairing-2026-10-28/{build,app-tests,adapter-tests}.log` and `output/playwright/stock-pairing-2026-10-28/` browser logs/screenshots. Earlier all48-design front geometry, shimmer, touch and export checks remain recorded in the [v2 front report](launch-a-card-front-v2-2026-10-28.md). Physical phone sensors and a real creator-operated mainnet issuance were not tested. The local mainnet integration remains disabled.
