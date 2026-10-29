# Launch a Card production release — 28 October 2026

The owner's latest instruction, **make it live**, explicitly supersedes the earlier **Keep in preview** decision for the verified fronts and pairing work. The existing dedicated Launch a Card Worker is updated; MintDex is unchanged. This authorizes the website deployment, not a real token/NFT transaction.

## Published version

- Worker: **launch-a-card**, existing production configuration `app/wrangler.production.jsonc`.
- Version: **70b4ec76-b521-4469-8ba3-02ba6670f42d**.
- Tag: **card-fronts-meme-pairs**.
- Created: **2026-10-28 14:43:13.684 UTC / 22:43:13 Asia/Manila**.
- Deployment readback: **100% traffic**, confirmed with Cloudflare's deployments API through the authenticated CLI.
- Prior version: `108990d7-c0fc-4c7d-be9b-996ad3199dd6` (`viewport-final-polish`). No rollback was performed.
- Public collection: **https://launch-a-card.gtjvv976mb.workers.dev/levels?collection=memes**.
- Existing custom domains remain bound: `launchacard.fun` and `www.launchacard.fun`.

The release contains the 48 standardized v2 card fronts / 83 admitted atlas variants and previews; six premium stock bindings and matching limited finishes; supported meme/collector presets; exact quote filters; and the verified portrait/short-landscape layout repairs. The meme collection has **17 finishes / 19 explicit combinations / 16 meme and collector quotes**. The complete quote registry has **25 reviewed assets**. Approved original front/back source art, print rounding, shimmer, motion and the installed public logo are retained. Draft logos remain uninstalled outside the public directory.

The dedicated D1 database, R2 bucket, existing 11 migrations, encrypted RPC secret, CPU allowance and enabled independent mainnet-wallet flag are unchanged. No DNS records, account subscription, Git remote, MintDex resources or inherited chain activation were changed. No Git push or real wallet signature/transaction was performed. The local preview remains available on port 5310.

## Build and deployment verification

- The unchanged source passes **242 app tests / 12,582 assertions** and **60 adapter tests / 824 assertions**. Both TypeScript checks pass. The Impeccable detector reports `[]` across the affected interface files.
- A fresh source-guarded TypeScript/client/SSR build passed immediately before publishing. The 1,251 captured build inputs have combined SHA-256 **d229838dcda6ff77f325d3588a5987d6f028fcf64b642ba1c869298421cdb0f4**. No source changes occurred during deployment.
- Production Worker packaging dry-run passed against the same isolated bindings. Final upload was **9,612.38 KiB raw / 2,209.83 KiB gzip**; Cloudflare reported **16 ms** startup. The CLI uploaded **118 new static asset files** and reused 437 existing asset objects.
- Deployment used the explicit production config, `--strict`, disabled autoconfiguration, and the recorded tag/message. Cloudflare accepted the existing Worker, domains and bindings without a subscription change.
- Before release, sanitized mainnet health was HTTP 200 with `configured/enabled/ready=true`. After release it remained HTTP 200 and healthy, checked **2026-10-28T14:43:59.084Z**, finalized slot **462514490**, block height **440538991**. This is a read-only backend check, not proof of completed wallet issuance.
- **14 public byte/hash checks pass** at the Worker origin: full-size and thumbnail atlases for Pokémon Classic, Jade Reliquary, Doge, Frost, Tesla and Neon Circuit match their trusted source manifest. The existing unissued diagnostic image and metadata still return their original content-addressed hashes. Nothing was written to R2 or a launch record during these checks.

## Public browser verification

The isolated public browser smoke passes **354 checks / 104 recorded states** at **1440×1000, 390×844, 320×640 and 568×320**:

- Archive: **251 checks / 58 states**. All 17 finishes and all 19 exact design/quote combinations pass pagination, filtering without mutating the current selection, exact PENGU/CARDS/CHILLGUY selection, compatible launch-link continuity and the 25-asset quote registry.
- Unconnected Mainnet Launch: **103 checks / 46 states**. All 17 finish choices remain accessible. Exact pair filtering, CHILLGUY selection, quote continuity, focus restoration and compact review controls pass.
- No runtime errors, failed first-party HTTP responses or requests, document overflow or missing visible images were recorded. Desktop, portrait and landscape screenshots were visually inspected.
- A baseline read confirmed the old public collection; the post-deployment browser independently confirmed the new bundle and fronts. Earlier Launch harness logs assumed the design browser started on page one; the final run correctly resets its selected-card pagination before enumeration. No app repair was needed.

Evidence is in `output/playwright/live-meme-release-2026-10-28/summary.json`, `archive-smoke.json`, `launch-smoke-final-2.json` and companion screenshots/scripts. No live upload, account authentication, wallet connection, signature or submit action occurred.

Secondary public smoke also passes all six planned Home, Tesla stock archive and Honk coin views at 1440×1000 and 390×844. The exact Tesla CTA remains `/launch?design=stock-tsla&quote=tslax`; visible atlases decode, retired footer nodes are absent and documents fit. Screenshots were inspected. An initial stock-phone load timeout recovered in a fresh isolated browser using DOMContentLoaded; the failed attempt is retained rather than treated as a product failure. Phone Honk sampled the original back during rotation, so this is not a fresh full-turn/sensor audit. Evidence: `output/playwright/live-meme-release-2026-10-28/secondary/summary.json`. All owned QA browser sessions were closed and the local preview was preserved.

## Remaining limitations

Direct normal HTTPS access to `launchacard.fun` still times out from the QA network. The earlier regional-domain investigation remains applicable; this release did not change DNS or claim that regional access was repaired. The dedicated Worker URL serves the new public bundle. Backend health does not establish external canonical artwork/metadata reachability for every network.

A first creator-operated paid token launch and separate Core NFT issuance remain unverified. Public browsing and automated lifecycle tests do not substitute for that wallet-operated acceptance step. Physical phone sensors are also untested. Some optional custom-quote initial-buy transactions exceed Solana's 1,232-byte packet limit with long metadata URIs; the existing explicit error remains, and a requested buy is never silently dropped.

Evidence: ignored `output/live-meme-release-2026-10-28/` contains fresh build, dry-run, deployment/readback logs, source input hashes, sanitized health and static/immutable asset results. The implementation, tests and local responsive evidence remain in the front-v2, stock-pairing, meme-pairing and more-meme-pairs reports. No temporary diagnostic Worker was created for this release.
