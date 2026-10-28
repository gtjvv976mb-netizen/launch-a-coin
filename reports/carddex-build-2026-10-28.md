# CardDex build evidence — 28 October 2026

This report records the completed local design/build work and its verification. It is not a deployment or mainnet-readiness claim. Real pump.fun/NFT production integration remains outside the functional simulation, as detailed below.

## Product and effective design direction

CardDex is an independent project exported from tracked MintDex commit `1c3a567cfe017d73039a5b6fae45def15e18a62d`. Uncommitted MintDex work, private files and production bindings were not copied. MintDex itself was not changed by this fork's work.

Creators select a permanent premium card design for their token and its one-of-one creator NFT card. Token launches, artwork/metadata entry, an optional initial buy, token buy/sell, charts, activity, holdings and the creator card collection remain in the local simulation. NFT sales, listings, bids, auctions, royalties and automatic market-cap design evolution are removed.

The latest owner direction preserves MintDex's original application composition: desktop navigation rail, headline above the card stage on the left, supporting token/activity content, and compact phone header/bottom navigation. The final chrome direction is Pokémon-card-inspired gold, cream, charcoal and scarlet, with no blue UI chrome. This supersedes the earlier navy/ice-blue/silver site concepts. Individual card artworks retain their own theme colors.

The current native logo is a wordless gold-foil trading-card-and-crown mark. It contains no letters or CD monogram. Root owns the final vector refinement and surrounding UI theme; no additional paid generation is authorized by this report.

## Fixed designs and rendering

The catalog contains 48 creator-selectable designs: eight classic trading-card layouts, 14 premium material designs, 20 limited-edition themes and six dedicated stock-reference designs. Every design has a matching Higgsfield front frame and reverse. Decorative art is wordless; the creator's own token artwork and card content are composed into measured apertures and text/data wells in the renderer. The generated pixels were not retouched or composited into a fixed token identity.

`app/src/lib/carddex/designs.ts` is the shared catalog. `generated-assets.ts` resolves full-size and 320px artwork for all 48 pairs; `generated-layouts.json` records the measured UI masks and content geometry. The renderer preserves the physical 63:88 card, rounded slab, direct touch rotation, both-face shimmer and inspection/case behavior. The final themed browser checks cover all 48 fronts/backs, touch behavior and representative continuous full-turn motion.

The selected `card_template` and material level are fixed at launch. `peak_mcap_usd` and other market data can change without changing that selection. Read responses derive stock metadata from the immutable design; mismatched launch echoes are rejected.

| Design | Derived ticker | Derived pair |
| --- | --- | --- |
| Stock GME | GME | GME / SOL |
| GameStop limited edition | GME | GME / SOL |
| Stock TSLA | TSLA | TSLA / SOL |
| Stock NVDA | NVDA | NVDA / SOL |
| Stock AAPL | AAPL | AAPL / SOL |
| Stock MSTR | MSTR | MSTR / SOL |
| Stock COIN | COIN | COIN / SOL |
| BlackBerry limited edition | BB | BB / SOL |

These associations are stock-themed token-pair references. They do not imply ownership of shares, dividends or equity backing.

## Backend boundaries

`app/migrations/0008_carddex_fixed_templates.sql` adds fixed-template/peak-market-cap persistence and rejects NFT sales, bids, royalty rows, listing terms and creator-card ownership changes. Service/API mutations for removed NFT trading features reject before database writes. Token trades continue without creator royalty or owner-fee accrual. Synthetic/demo token identities replace inherited real mint addresses; the vanity pool is empty.

The local seed supplies demo coins and token trades, not a working NFT marketplace. Sessions use `carddex_session`, distinct from MintDex. The current build uses test SOL and local demo NFT records. It neither moves real SOL nor creates real pump.fun tokens or on-chain NFTs.

The intended production flow is a creator token launch through pump.fun plus separate creator NFT issuance. That adapter, current provider compatibility, permanent public artwork/metadata, duplicate prevention, confirmed-launch verification, NFT recovery and signed end-to-end integration verification remain unimplemented. No CardDex chain activation or public deployment occurred.

## Higgsfield delivery and cost record

The owner approved the full 98-image set at 2.75 quoted credits each, then one additional logo at 2.75 credits. All 99 accepted jobs completed:

| Allocation | Completed images | Quoted credits |
| --- | ---: | ---: |
| 48 card fronts + 48 reverses | 96 | 264.00 |
| Website concept + environment | 2 | 5.50 |
| First generated logo, rejected by owner | 1 | 2.75 |
| Total | 99 | 272.25 |

These are approved quoted totals. The tools did not provide an itemized actual-charge reconciliation. Explicit no-job rate-limit rejections were retried after waiting; no accepted paid card/logo job was regenerated. No Higgsfield project/folder was created.

The rejected generated logo remains at `brand/logo/archive/higgsfield-first-lockup.png`. Its native vector replacement was refined without further generation spend. The two site visuals were created before the final Pokémon-card palette decision and do not override the latest layout/chrome instructions.

Delivery evidence:

- `creative/higgsfield/carddex-generation-plan.json`: all 98 indexed briefs and exact generation parameters.
- `creative/higgsfield/jobs-cards.json`: 96 unique terminal-successful job IDs, prompt hashes, result references and local-file metadata.
- `creative/higgsfield/jobs-website.json`: the two completed site jobs.
- `creative/higgsfield/jobs-logo-accepted.json` and `jobs-logo-completed.json`: the single completed additional logo job and rejection feedback.
- `app/public/assets/carddex/higgsfield/{design-key}-{front|back}.webp` and matching `-320.webp`: 192 card web assets.
- Ignored `output/higgsfield/carddex-2026-10-28/originals/`: 96 unchanged original card PNGs.
- Ignored `output/higgsfield/carddex-2026-10-28/contact-{front|back}-all48-{1|2}.jpg`: four labelled review sheets.

All 96 original card files and 192 WebPs passed file-existence, format, dimension and SHA-256 verification. Web processing was proportional resizing and WebP encoding only. Both the generation agent and renderer independently inspected all 48 pairs: distinct premium finishes, wordless decorative artwork and clear creator-art windows; no regeneration was required.

## Source and resource isolation inspection

Public source/config was inspected without opening private environment, wallet, key or credential paths:

- `app/src/lib/mintdex/mode.ts` fixes `MODE` to `sim`; `IS_CHAIN` is false.
- `app/vite.config.ts` rejects either `VITE_MINTDEX_MODE` or `VITE_CARDDEX_MODE` when set to a non-simulation mode.
- Both `app/wrangler.jsonc` and `app/wrangler.local.jsonc` use `carddex-local`, local DB/R2 names, an all-zero database UUID, and no production route or service binding.
- Both chain anchor files have blank program/config/ALT/treasury values. API/RPC defaults are `http://127.0.0.1:8788` and `http://127.0.0.1:8899`.
- `app/src/lib/mintdex/site-host.ts` uses `http://127.0.0.1:5310` for canonical/share URLs. The inactive devnet host is `carddex.invalid`.
- Root rendering does not mount the real wallet host in simulation. Active launch and data paths use the simulation API/local database.
- `app/src/lib/mintdex/server/auth.server.ts` uses the independent `carddex_session` cookie.
- Historical program/configuration source is archived under `reference/mintdex-chain`; there is no copied production Wrangler deployment configuration.

Residual MintDex strings remain in inherited comments, the security-header hostname comparison list, and offline SDK metadata defaults such as `https://mintdex.fun/c/` and `https://mintdex.fun/m/`. These are not the active simulation's API/RPC targets. The source scan establishes configuration and route gating; it is not a claim that every inherited reference string was deleted or that browser network traffic was captured in this check.

Fresh isolation test command: `bun test tests/chain/carddex-isolation.test.ts` — **3 passed, 0 failed, 35 assertions**. Its subprocess checks load the Vite config with each chain activation variable set to mainnet and confirm refusal; they do not build or deploy a chain version.

## Build integrity repair

An older local preview contained mismatched client/SSR source. The client bundle still rendered the old Hallmark-and-text lockup, while the SSR bundle rendered the newer SVG lockup. Client assets were emitted at 11:32:54 and SSR at 11:33:26 local time. SSR referred to `/assets/styles-NiObX3HZ.css`, but the client emitted `/assets/styles-5zhp5W34.css`; the first URL returned 404. Those differences explain the stale logo replacement and hydration error observed in preview.

`app/scripts/build.mjs` now waits for both TypeScript and Vite even if one fails, preventing a leftover Vite child from writing over a subsequent build. It fingerprints shared source, public assets, workspace packages, SDK source and build configuration before/after the client/SSR build, and exits unsuccessfully if captured inputs differ. It excludes dist, dependency caches, Git metadata, `.wrangler` state, QA outputs and TanStack's generated route index. `bun run build` invokes this helper.

Fresh focused command: `bun test tests/carddex/build-integrity.test.mjs` — **2 passed, 0 failed, 2 assertions**. Tests cover changed/added/deleted shared inputs and ignored generated/cache writes. This agent did not start a replacement build; root is coordinating source freeze and final build/preview restart.

## Final verification

- The final production build helper completed successfully after a source freeze, including TypeScript and Vite client/SSR compilation. No input mutations were reported. The workspace Bun binary invoked the helper directly (`~/.bun/bin/bun scripts/build.mjs`) because Bun is absent from this executor shell's PATH. `bun run build` delegates to the same helper when Bun is on PATH.
- `bun test tests/chain tests/carddex`: **80 passed, 0 failed, 4,182 assertions**, across nine active files. This includes immutable design persistence, all 48 catalog/render mappings, blocked NFT financial writes, stock consistency, build integrity, and isolated simulation configuration. Archived historical wallet/chain reference tests are not counted as live integration verification.
- The local Worker was restarted against the coherent final output on **http://127.0.0.1:5310**. No remote resources were provisioned or migrated.
- Playwright checked 32 route/viewport combinations at 320, 390, 768 and 1440 CSS pixels: Home, Discover, Designs, Launch, Portfolio, Legal, Coin and the legacy Market redirect. Zero runtime/hydration errors, console errors, first-party request failures, broken visible images, unwanted horizontal overflow or MintDex-domain requests were recorded in that matrix.
- Final affected desktop/phone screenshots were inspected after repairs: warm ambient light, scarlet launch ticker, readable cream/gold chrome, correctly framed outer coin columns and transparent desktop inner panels. Calculated palette pairs meet AA normal-text contrast. Search synchronizes with the URL and survives reload; the phone search focuses its input; narrow launch fields remain fully usable.
- All **48 generated fronts and 48 reverses** passed phone render/touch checks: actual decoded images, measured creator-art masks, text wells, rounded silhouette/depth walls, wordless reverse artwork, and shimmer changes on both physical faces. All 14 standard frames use a measured metal-only laminate so token art and paper details stay clear. Six stock print layouts were tightened to keep complete text lines visible. The affected 24-design regression pass is clean.
- Full-turn traces on classic, standard, Doge, dark Neon and stock designs measured approximately **476–485°** of continuous travel. Both physical faces, both lighting planes, Pause and Resume pass. Fresh Legend/TSLA traces also pass after laminate/text repairs. Calm, reduced motion and hidden-document gates stop decorative motion; Full remains the default.
- A separate homepage trace measured **363.58° at 1440px** and **360.94° at 390px**, with maximum sample steps of 3.76° and 3.29° respectively, both physical faces and no runtime errors. The physical face is calculated from the actual transform normal; the logical `data-side` target is not used as a physical-face assertion during automatic rotation.
- The actual local creator flow was exercised through the UI: sign in as a demo handle, upload artwork to local R2, select the TSLA design, edit metadata, launch with 0.75 test SOL, buy 0.10 test SOL, sell 25% of the holding, reload and inspect both portfolio tabs. Demo coin `w5acquh5` retains Tesla Current, TSLA / SOL and its separate one-of-one creator record. The three transactions and remaining 99.34 test SOL are visible after reload. No external wallet or real funds were used.
- The logo SVG and 1024px transparent export have no lettering or blue; 180/192/512px installed-app icons use the same gold card-and-crown identity. Rejected wordmarks are not installed.
- All 96 completed card generation jobs were presented once in four exact-ID galleries; no new jobs, paid retries or additional charges were requested by presentation.

Evidence is retained under ignored `output/playwright/carddex-2026-10-28/`: `ROYAL-UI-QA.md`, `final-collector-polish.json`, `final-card-render-review.json`, `final-motion-review.json`, `home-turntable-review.json`, `local-flow-readback.json`, actual desktop/mobile screenshots and all front/back contact sheets. Generation provenance and asset hashes remain tracked under `creative/higgsfield/`.

## Limits and next production work

Browser emulation confirms responsive/touch rendering; a physical phone's sensor permissions and gyroscope were not tested. Chromium also reports an inherited unused-font-preload warning; it is separate from runtime/console errors and does not block rendering. A One Piece name plaque has a tight decorative left edge, while its actual text remains legible.

The app is a **local simulation**. Real pump.fun launches/trades, wallet signing and separate NFT issuance are unconfigured and were not exercised. Public hosting, durable public artwork/metadata, current official provider compatibility, verified token/NFT binding, duplicate prevention and issuance recovery need production implementation and verification before live activation. No CardDex deployment, real mint, SOL transfer or MintDex production change occurred.
