# More supported meme pairs — 28 October 2026

**Later publication update:** the owner subsequently requested **make it live**. This verified expansion is included in production version `70b4ec76-b521-4469-8ba3-02ba6670f42d`. The preview-only statements below describe the original implementation turn; see the [release record](launch-a-card-meme-release-2026-10-28.md) for current deployment status and limitations.

The owner requested **more meme pairs** after specifying **supported meme pairs only**. This expands the existing local implementation. The earlier **Keep in preview** instruction remains in force: no deployment, Git push, paid generation, wallet signature or real transaction was performed.

Preview: **http://127.0.0.1:5310/levels?collection=memes**.

## Added presets

| Existing premium finish | Exact quote |
| --- | --- |
| Ember | Fartcoin |
| Relic | Pnut |
| Tide | MOODENG |
| Neon Circuit | TROLL |
| Frost | PENGU |
| Mythic | GIGA |
| Celestial | SPX |
| Regal | TRUMP |
| Wildtype | USELESS |
| Aurora | CHILLGUY |

These ten presets bring the collection to **17 finishes, 19 explicit design/quote combinations and 16 meme/collector quotes**. Fartcoin, Pnut, MOODENG and TROLL were already admitted registry assets. The other six quotes are new additions. Existing approved premium front/back artwork is reused; this work does not claim new mascot illustrations or add new design identities.

Neutral design keys remain neutral outside explicit preset selection. Their historical SOL/stock cards, saved intents and recovery are preserved. Existing stock, DOGE, BONK and WIF hard bindings remain unchanged. All 83 trusted print variants, original artwork, rounded card geometry, turntable motion and shimmer remain unchanged by this expansion.

## Supported identities

All six exact mints appear in [Pump's Supported Pair Assets](https://pump.fun/docs/custom-pairs), whose published update was 9 October 2026. Read-only mainnet verification at **2026-10-28 13:45:01 UTC / 21:45:01 Asia/Manila**, confirmed slot **462497910**, matched the expected mainnet genesis. The pinned official SDK directly resolves each quote through QuoteControl; `createV2Enabled` was true and QuoteControl contained 224 entries.

| Key | Exact Solana mint | Decimals |
| --- | --- | ---: |
| PENGU | `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv` | 6 |
| GIGA | `63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9` | 5 |
| SPX | `J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr` | 8 |
| TRUMP | `6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN` | 6 |
| USELESS | `Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk` | 6 |
| CHILLGUY | `Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump` | 6 |

All six mint accounts are initialized legacy SPL Token accounts, with no extensions or freeze authority. Five have no mint authority. SPX retains its Wormhole mint authority and is explicitly labelled **SPX6900 (Wormhole Solana representation)**, with Wormhole Portal as listing provider and its published terms link. It is a memecoin quote, not tokenized stock.

The app and launch-adapter registries agree on **25 assets**. The previous 19 asset objects and reserve snapshots are preserved byte-for-byte, as are the original public account fixtures. The six additions carry their own capture provenance. Actual preparation rechecks current chain state instead of treating these snapshots as permanent admission.

POPCAT has no exact entry in the published supported table and remains excluded. Ambiguous PEPE and POKEMON candidates also remain excluded. TOAD, CARDS and SV151 retain their explicit distinct identities from the preceding batch.

## Browsing and selection

The existing archive and Launch design browser now offer an exact **Pair asset** filter with **All pairs** as default. It filters compatible finishes without changing the selected card, launch mode, draft or URL. Choosing a finish applies the exact filtered quote through the existing pair-change path. Exact symbol/key/full-name archive search resolves shared designs to the intended quote; a CARDS search cannot accidentally apply SV151.

The measured grid uses the number of visible results, so single filtered cards and short last pages are centered and larger. Pagination keeps every finish accessible without document scrolling. Short landscape archive layouts use one filter row and compact horizontal card choices with accessible touch targets. Browser review also identified existing short landscape Launch clipping. A scoped left control rail gives the fields their full height, while the design dialog uses horizontal card choices. The existing wallet-section selector shares the rail on the review step; consent and review actions remain visible. Wallet logic, acceptance gating and transaction verification are unchanged.

## Automated verification

- **242 app tests / 12,582 assertions** and **60 adapter tests / 824 assertions** pass.
- App guarded TypeScript/client/SSR build and adapter TypeScript checks pass. The Impeccable detector reports `[]` across the affected interface files; diff checks pass.
- All 19 combinations cover exact token/NFT metadata binding, quote persistence, mocked lifecycle finalization, separate NFT issuance and saved reads. Actual unsigned official-SDK token/Core plans pass the independent client verifier; wrong mint substitution is rejected.
- Exact decimals, quote atoms and u64 boundaries are covered. All ten new neutral finish presets retain historical SOL recovery, in addition to the existing Pokémon/Pepe SOL and stock cases.

An existing Solana packet-size constraint is explicitly tested. For these six legacy-SPL quotes, optional initial-buy plans with the standard 67-character fixture URI are 1,247 bytes and correctly reject the 1,232-byte packet limit. Zero-initial-buy plans fit; shorter-URI fixtures prove exact buy amounts when the complete transaction fits. The adapter does not silently remove a requested buy. This task does not claim every nonzero buy fits every metadata URI.

## Browser verification

- Final archive regression: **765 checks / 106 states** at 320×640, 390×844, 568×320, 667×375 and 844×390. The 1440×1000 desktop baseline also passed; the later archive header repair is restricted to short landscape sizes. All 17 finishes, ten new presets, exact filters, CARDS/Prism selection, 25 quote options and pending Keep/apply paths pass. No runtime errors, failed first-party responses or failed requests were recorded.
- Launch browser: all 17 choices remain reachable through pagination at **1440×1000, 390×844, 320×640, 768×1024, 568×320, 667×375 and 844×390**. Exact CARDS filtering exposes three compatible finishes and exact PENGU filtering exposes Frost. Closing restores opener focus; the document and sheet body fit without overflow. Single results and short final pages are larger and centered. The PENGU artwork is 160px wide on portrait/desktop and 62–72px wide in short horizontal choices, replacing the unusable 25px landscape preview.
- The creator's uploaded artwork, name, ticker and Demo mode survive selection. A quote change clears the prior initial-buy units; filtering alone leaves the preview unchanged. The quote dropdown exposes 25 reviewed assets and excludes ambiguous PEPE/POKEMON and unpublished POPCAT quotes.
- Short landscape creation regression: **39 states / 108 visible-control checks** pass at 568×320, 667×375 and 844×390. All eight Demo steps are reachable, the Card/Details tabs work, and the unconnected Mainnet Launch, Terms, Recovery, Saved and Status panes keep their controls within the form and hit-testable. All material transaction terms and the disabled setup/review state remain visible. No launch was submitted.
- Screenshots from desktop, portrait phone, archive landscape, exact-pair filters and compact review/terms were visually inspected. The final small centering/copy supplement is recorded separately from the earlier full layout pass.

Physical phone sensors, funded-wallet states, real wallet signing and actual token/NFT issuance were not exercised. Mainnet recovered/issued intents are covered by automated lifecycle tests, not claimed as real browser transactions or a complete physical-device audit.

## Evidence and delivery state

Read-only source/account verification, public bytes, test logs and build logs are under ignored `output/more-meme-pairs-2026-10-28/`. Browser scripts, reports and inspected screenshots are under ignored `output/playwright/more-meme-pairs-2026-10-28/`. Final records are `archive-summary.json`, `archive-qa-combined-final.json`, `launch-summary.json`, `short-steps-summary.json`, `final-centering.log` and their companion scripts/screenshots. Earlier archive/short-step logs retain the defects that prompted the repairs; they are superseded by these passing records. The source registry snapshot is `reports/pump-pair-assets-2026-10-28.json`.

The existing local preview remains on port 5310, with local mainnet actions disabled. Production and MintDex are unchanged. The first creator-operated real issuance remains unverified.
