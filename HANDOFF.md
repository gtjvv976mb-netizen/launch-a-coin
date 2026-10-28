# Launch a Card handoff — 28 October 2026

Public name is **Launch a Card** and public origin is **https://launchacard.fun** (owner-selected). Internal project folder `carddex`, asset filenames, CSS and database/session identifiers are retained for recoverability. MintDex is an independent project and must not be changed or reused.

## Latest live and viewport release

Public mainnet creator-wallet launches are now **enabled**. The owner saved the current app-specific Helius endpoint through the encrypted Cloudflare Secret form. The deployed health check verifies Solana mainnet genesis and healthy finalized slot/height observations with `configured/enabled/ready=true`. Canonical HTTPS root, logo, immutable image/metadata and the `www` redirect passed independent remote checks. See the production setup report for the final deployed version and evidence. No real token/NFT transaction was signed or submitted by the agent, and the first creator-operated issuance remains unverified. Local configuration and the inherited MintDex chain stay disabled; discovery, balances and site trading remain explicitly demo.

The owner's next request is implemented: viewport-fitted pages replace document scrolling with tabs, measured pagination and explicit steps. Launch retains details left/full card right, with eight field steps and separate phone Card/Details views. All exact transaction-review values remain reachable across five pages. Guide, entry, confirmation and card celebration dialogs fit without scroll containers and preserve focus/close behavior. The new wordless mark shows jade, garnet and plum card backs fanned beneath a separate jeweled crown. Full 360-degree motion, both-face shimmer and touch controls remain.

Latest checks: **169 app tests / 8,612 assertions**, TypeScript and guarded client/SSR build pass. Browser QA covers five screen sizes, the complete field flow, public enabled Launch, local-only demo holdings/NFT/balances, paged content and dialog controls. Physical phone sensors and real-wallet signing remain untested. See the viewport, launch and brand/overlay reports dated 28 October 2026.

## Earlier card-first simplification baseline

The owner requested less clutter, smaller fields and stronger card emphasis. The compact Launch is implemented (33/67 details/card desktop; single prominent phone card with Inspect, no miniature duplicate). Fields are40px desktop/44px phone; optional description/social/initial-buy/transaction settings are disclosed. Existing pair confirmation, immutable fields, paid-transaction acceptance, review, exact signing and recovery logic remain. Local mainnet actions stay disabled; public activation is recorded above.

Global UI now has a narrower176px charcoal rail, quiet engraved paper, thin panels, one featured-card caption/navigation row, disclosed Home activity and no global ticker/RoyalMotion decoration. Full card motion and both-face shimmer remain. Design thumbnails are124px art previews rather than39px settings icons, selected designs are larger, Limited filter links correctly show20designs, and phone clipping/contrast/gallery-overlap defects are fixed. Phones default to Card on coin pages; desktop shows a larger complete cased object.

Charts are actual-observation OHLC candlesticks with quote-native units, UTC/time ranges, pointer/touch/keyboard inspection and honest empty/sparse/truncated history. No fake wicks, volume or interpolated observations. A new shared finalized-bank check fixes stale account absence during expired token/NFT replacement, using getEpochInfo height+slot and minContextSlot-bound account lookup. Regression covers both assets.

Latest checks:147app tests/8,452assertions and24adapter tests/421assertions pass, as do app/adapter TypeScript, the source-guarded client/SSR build, Impeccable detector and Worker dry-run. Launch QA covers1440/1280×720/768/390/320; chart QA coversTSLAX+DOGE at1440/390/320 and all ranges; other route/phone/card-case checks pass with no overflow or runtime errors. Actual physical gyro sensors, real wallet signatures and broadcasts remain untested. At that pre-authorization check, no funds, remote resources, deployment or paid image generation had occurred; the later authorized hosting setup is recorded below. See reports/launch-a-card-card-first-2026-10-28.md and companion compact-launch/candle reports. Preview remains127.0.0.1:5310.

## Current implementation

Default `/launch` is the real creator-wallet flow; `?mode=demo` explicitly selects the test flow. Details remain left/full canonical card right, with one prominent phone card and usable 3D inspector even after immutable launch review. No automatic card evolution, NFT sales, bids, auctions or royalties. Existing rounded 3D cards, both-face shimmer and full-motion default remain.

The isolated `integrations/pumpfun` official-SDK adapter is now imported only by server launch code. It prepares complete create_v2 transactions for freshly admitted native SOL or one of 15 exact custom quote assets, with optional exact initial buy, live balances/rent/fee review and transaction simulation. It independently verifies finalized token creation before a separate Metaplex Core NFT issuance. Core metadata and token/quote/design/hash binding attributes are immutable; creator owns the NFT, and no royalties plugin is added. Oversized custom-quote initial buys fail clearly rather than being dropped.

Wallet Standard connection, labelled ownership-message authentication, strict origin/session checks, client-only ephemeral keys, exact transaction/signature verification and a relay for already wallet-signed bytes are implemented. Mainnet intent records are separate from SIM records. Public content-addressed artwork, canonical front and marketplace-case PNGs, reviewed design hashes and metadata are attested by the server. Rotation, duplicate prevention, monotonic confirmation and interrupted issuance recovery use atomic intent snapshots and full prepared-plan-set guards. No assistant transaction signing, funding or sending occurred.

All 48 designs use the exact shared 63:88 print grid, fonts and live content slots. Approved Higgsfield imagery is retained unchanged as source decoration; 83 losslessly flattened canonical PNG skins include admitted stock engraving variants. `render-assets.json` pins output and original-source hashes. Runtime PNG rendering uses one flattened skin and actual creator art, avoiding the original nine-slice WASM memory explosion. Raw front is1260×1760; premium rounded transparent case is1440×2240, labelled Launch a Card. PNG/JPEG creator artwork is capped at2048px; the client also converts WebP and resizes larger uploads. Browser preview and export share CanonicalSkinSurface/CANONICAL_CARD_LAYOUT. Generated artwork contains no new theme/tier labels.

## Hosting and activation

Production setup was explicitly authorized with “do it.” This app has dedicated `launch-a-card` Worker, D1 and R2 resources; D1 ID is `ffc8ba69-4d9d-404c-9c3d-e4a7f187cb3a`, with all 11 migrations applied remotely and integrity checks passing. Actual config `app/wrangler.production.jsonc` enables only the independent Pump/Core launch integration. Cloudflare accepted a 30,000 ms CPU limit without an agent-made subscription change. No MintDex resources or credentials were reused.

Cloudflare Free zone `e91d78f85ca3a48e61b7a894e1285f4a` uses `aaron.ns.cloudflare.com` and `addyson.ns.cloudflare.com`; Namecheap Custom DNS and public delegation are confirmed. Both apex and `www` custom domains are bound. Only the two owner-approved parking records were replaced; email DNS was preserved. Independent canonical HTTPS checks pass. The QA host still caches parking DNS and cannot connect to the new Cloudflare IPv4 addresses on port 443, so canonical browser rendering remains locally unverified; equivalent bundle rendering passed at the dedicated Worker URL.

The encrypted `CARDDEX_MAINNET_RPC_URL` now passes the deployed health check. Earlier authentication and `network_error` results are historical: the owner saved the current app-specific endpoint, and Workers' unsupported redirect error mode was replaced with manual rejection in health and public asset verification. No endpoint/key is stored in source or reports. All temporary diagnostic Workers were deleted.

Local `app/wrangler.jsonc` retains isolated local D1/R2 only. Do not enable the inherited MintDex chain SDK or global chain mode. The discovery/trading catalogue remains honestly labelled demo; actual completed launches link to pump.fun and the creator's Core NFT. The current production setup report is authoritative for deployment IDs and remaining owner-wallet verification.

## Earlier implementation verification

Final coordinated checks passed **141 app tests / 8,429 assertions**, plus **23 adapter tests / 415 assertions**, TypeScript and the source-guarded client/SSR build. Backend lifecycle tests include deterministic concurrency races, and the client verifier accepts actual SDK plans for all16quote assets and CoreNFT issuance. Public-mainnet read-only simulations succeeded against actual pumpcreate_v2 and Core programs; those simulations were never signed or sent. Expiry/retry regression and Cloudflare dry-run packaging pass. The local workerd compositor returns the transparent 1440×2240 case successfully (799 ms). The final browser check covers renamed desktop and phone routes with no overflow, runtime errors or failed responses; detailed launch/inspector evidence is in the UI report. Use the final Git commit and logs for authoritative results. A first owner-approved signed launch after public activation remains untested.

## Retained recovery evidence

Independent source snapshot of MintDex commit 1c3a567cfe017d73039a5b6fae45def15e18a62d, exported from tracked files only. Existing uncommitted MintDex work is excluded.


48card pairs came from the approved98-imageHiggsfieldset (96faces+2websitevisuals), plus one separately approved logo, total quoted272.25credits. All99jobscompleted; itemizedactualcharges unavailable. The rejected generatedlogo isarchived, replaced by the current wordlessgoldcard+crownvector withoutadditionalspend. Do not regenerateorrepurchase these assets. OriginalPNGs, diagnosticrenders and priorQA live underignoredoutput/; publicWebPs/previews andtrustedPNGskins are tracked.

Earlier canonical layout, quote accounting and SIM-flow reports remain relevant. Quote key/mint/design are immutable; legacycoins remainSOL, customassetUSD/SOLvalues are null, and exactatom totals useBigInt/string arithmetic. Migrations0009/0010 and the older113test baseline were localonly. SeeREADME,PRODUCT,DESIGN anddatedreports for original scope and history.
