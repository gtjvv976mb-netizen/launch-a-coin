# Launch a Card handoff — 28 October 2026

Public name is **Launch a Card** and public origin is **https://launchacard.fun** (owner-selected). Internal project folder `carddex`, asset filenames, CSS and database/session identifiers are retained for recoverability. MintDex is an independent project and must not be changed or reused.

## Latest card-first simplification

The owner requested less clutter, smaller fields and stronger card emphasis. The compact Launch is implemented (33/67 details/card desktop; single prominent phone card with Inspect, no miniature duplicate). Fields are40px desktop/44px phone; optional description/social/initial-buy/transaction settings are disclosed. Existing pair confirmation, immutable fields, paid-transaction acceptance, review, exact signing and recovery logic remain. Mainnet stays disabled without public setup.

Global UI now has a narrower176px charcoal rail, quiet engraved paper, thin panels, one featured-card caption/navigation row, disclosed Home activity and no global ticker/RoyalMotion decoration. Full card motion and both-face shimmer remain. Design thumbnails are124px art previews rather than39px settings icons, selected designs are larger, Limited filter links correctly show20designs, and phone clipping/contrast/gallery-overlap defects are fixed. Phones default to Card on coin pages; desktop shows a larger complete cased object.

Charts are actual-observation OHLC candlesticks with quote-native units, UTC/time ranges, pointer/touch/keyboard inspection and honest empty/sparse/truncated history. No fake wicks, volume or interpolated observations. A new shared finalized-bank check fixes stale account absence during expired token/NFT replacement, using getEpochInfo height+slot and minContextSlot-bound account lookup. Regression covers both assets.

Latest checks:147app tests/8,452assertions and24adapter tests/421assertions pass, as do app/adapter TypeScript, the source-guarded client/SSR build, Impeccable detector and Worker dry-run. Launch QA covers1440/1280×720/768/390/320; chart QA coversTSLAX+DOGE at1440/390/320 and all ranges; other route/phone/card-case checks pass with no overflow or runtime errors. Actual physical gyro sensors, real wallet signatures and broadcasts remain untested. No funds, remote resources, deployment or paid image generation occurred. See reports/launch-a-card-card-first-2026-10-28.md and companion compact-launch/candle reports. Preview remains127.0.0.1:5310.

## Current implementation

Default `/launch` is the real creator-wallet flow; `?mode=demo` explicitly selects the test flow. Details remain left/full canonical card right, with one prominent phone card and usable 3D inspector even after immutable launch review. No automatic card evolution, NFT sales, bids, auctions or royalties. Existing rounded 3D cards, both-face shimmer and full-motion default remain.

The isolated `integrations/pumpfun` official-SDK adapter is now imported only by server launch code. It prepares complete create_v2 transactions for freshly admitted native SOL or one of 15 exact custom quote assets, with optional exact initial buy, live balances/rent/fee review and transaction simulation. It independently verifies finalized token creation before a separate Metaplex Core NFT issuance. Core metadata and token/quote/design/hash binding attributes are immutable; creator owns the NFT, and no royalties plugin is added. Oversized custom-quote initial buys fail clearly rather than being dropped.

Wallet Standard connection, labelled ownership-message authentication, strict origin/session checks, client-only ephemeral keys, exact transaction/signature verification and a relay for already wallet-signed bytes are implemented. Mainnet intent records are separate from SIM records. Public content-addressed artwork, canonical front and marketplace-case PNGs, reviewed design hashes and metadata are attested by the server. Rotation, duplicate prevention, monotonic confirmation and interrupted issuance recovery use atomic intent snapshots and full prepared-plan-set guards. No assistant transaction signing, funding or sending occurred.

All 48 designs use the exact shared 63:88 print grid, fonts and live content slots. Approved Higgsfield imagery is retained unchanged as source decoration; 83 losslessly flattened canonical PNG skins include admitted stock engraving variants. `render-assets.json` pins output and original-source hashes. Runtime PNG rendering uses one flattened skin and actual creator art, avoiding the original nine-slice WASM memory explosion. Raw front is1260×1760; premium rounded transparent case is1440×2240, labelled Launch a Card. PNG/JPEG creator artwork is capped at2048px; the client also converts WebP and resizes larger uploads. Browser preview and export share CanonicalSkinSurface/CANONICAL_CARD_LAYOUT. Generated artwork contains no new theme/tier labels.

## Hosting and activation

Local `app/wrangler.jsonc` retains isolated local D1/R2 only; migration0011 is applied locally. Real launch readiness is disabled without an explicitly enabled production deployment, own public origin, own durable storage and a server-only mainnet RPC. The inherited MintDex chain SDK and global SIM mode must not be enabled. The discovery/trading catalogue remains honestly labelled demo; actual completed launches link to pump.fun and the creator's on-chain NFT.

DNS checked28October: launchacard.fun is still on192.64.119.61 with registrar-servers.com nameservers. No independent remote Launch a Card D1/R2 resources exist; no DNS/account/resource mutation or public deployment has occurred. `app/wrangler.production.example.jsonc` is disabled and has an intentionally invalid placeholder D1ID. See `reports/launch-a-card-public-readiness-2026-10-28.md` for the concrete activation sequence. Do not reuse MintDex resources or read private wallet files.

## Verification

Final coordinated checks passed **141 app tests / 8,429 assertions**, plus **23 adapter tests / 415 assertions**, TypeScript and the source-guarded client/SSR build. Backend lifecycle tests include deterministic concurrency races, and the client verifier accepts actual SDK plans for all16quote assets and CoreNFT issuance. Public-mainnet read-only simulations succeeded against actual pumpcreate_v2 and Core programs; those simulations were never signed or sent. Expiry/retry regression and Cloudflare dry-run packaging pass. The local workerd compositor returns the transparent 1440×2240 case successfully (799 ms). The final browser check covers renamed desktop and phone routes with no overflow, runtime errors or failed responses; detailed launch/inspector evidence is in the UI report. Use the final Git commit and logs for authoritative results. A first owner-approved signed launch after public activation remains untested.

## Retained recovery evidence

Independent source snapshot of MintDex commit 1c3a567cfe017d73039a5b6fae45def15e18a62d, exported from tracked files only. Existing uncommitted MintDex work is excluded.


48card pairs came from the approved98-imageHiggsfieldset (96faces+2websitevisuals), plus one separately approved logo, total quoted272.25credits. All99jobscompleted; itemizedactualcharges unavailable. The rejected generatedlogo isarchived, replaced by the current wordlessgoldcard+crownvector withoutadditionalspend. Do not regenerateorrepurchase these assets. OriginalPNGs, diagnosticrenders and priorQA live underignoredoutput/; publicWebPs/previews andtrustedPNGskins are tracked.

Earlier canonical layout, quote accounting and SIM-flow reports remain relevant. Quote key/mint/design are immutable; legacycoins remainSOL, customassetUSD/SOLvalues are null, and exactatom totals useBigInt/string arithmetic. Migrations0009/0010 and the older113test baseline were localonly. SeeREADME,PRODUCT,DESIGN anddatedreports for original scope and history.
