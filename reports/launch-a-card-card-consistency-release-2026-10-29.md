# Card consistency release — 29 October 2026

After the preview-only audit delivery, the owner instructed **DO EVERYTHONG YOURSE:F**. In context this is the go-ahead to finish publication of the verified card fixes to the existing Launch a Card platform. It is not authorization for a wallet transaction, additional credit purchases, unrelated account changes or deployment to MintDex.

The card fixes are deployed to the existing `launch-a-card` Worker at **100% traffic**:

- Version: **9709a88f-9fe5-4c02-9f46-11a900df211a**.
- Tag: **card-consistency-v21**.
- Version created: **2026-10-28 17:08:10 UTC**.
- Traffic switched: **2026-10-28 17:08:58 UTC / 29 October 01:08:58 Asia/Manila**.
- Previous version: **947f7fc4-f49e-4999-b936-edd2e04cc101**, including the concurrent SaaS hotfix.
- Verified public origin: **https://launch-a-card.gtjvv976mb.workers.dev**.

## Published changes

The release removes inherited artwork offsets and saturation/sepia filters from every canonical card, matches exported data labels to the browser's Courier Prime typography, and keeps Home's full-motion card visible on short landscape phones. The existing 48 distinct Higgsfield designs retain their shared v2 structure and their original front/back artwork. No decorative image bytes were regenerated or replaced.

Trusted renderer metadata advances to `launchacard-canonical-v2.1`. New launches require a current trusted composition; saved launch intents retain their committed image and metadata references. The immutable binding schema is unchanged. Details and the Before/After/Why review are in [the audit report](launch-a-card-card-consistency-2026-10-29.md).

## Preserve the existing SaaS transition

AGENTS.md warns that a normal deploy can overwrite the DNS-only `www` CNAME with stale custom-domain routing during the separate Cloudflare-for-SaaS migration. The referenced cutover report is absent from this checkout, so the release does not infer that cutover is complete and does not alter the production config.

Publication used **`wrangler versions upload --strict --keep-vars`** and **`wrangler versions deploy NEW_VERSION@100 --yes`**. No normal `deploy` or `triggers deploy` command ran. Cloudflare's [deployment documentation](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/) separates version publication from route/domain/cron changes; the installed Wrangler4.147.0 implementation was also independently reviewed before execution. The final command reported **No non-versioned settings to sync**.

Remote version readback confirms identical complete bindings and runtime settings before/after upload, including DB, R2, ASSETS, SELF, secret binding name, production origin, mainnet flag, compatibility date/flags and CPU limit. The current production config and all four SaaS hotfix files remain unchanged. No migration, secret, domain, DNS, subscription or wallet operation occurred. No logo was installed or generated, and no additional artwork credits were spent.

Public DNS readback remains consistent with the pre-release queries: apex A addresses `104.21.57.235` / `172.67.193.127`, `www.launchacard.fun` CNAME `edge.launchacard.com`, and fallback addresses `104.21.86.22` / `172.67.214.55`. This records observed DNS; it does not claim that the separate cutover or regional access problem is resolved.

## Release verification

- The previously corrected source passes **244 app/chain tests / 13,115 assertions**, TypeScript and local desktop/emulated-phone checks. See the audit for all48 paired-art reviews,83 atlas/preview checks,96 catalog states,7 full turns,12 long-content states and the post-fix local regressions.
- A fresh guarded TypeScript/client/SSR build passes immediately before upload. All **1,253** tracked release inputs, including both Wrangler configs, retain combined SHA-256 **d8405066ac4d4dba8867424e92e9d8c1f319ee05837d7e3df26ba6bf43b2ad1e** before build, after build and after publication.
- Strict packaging dry-run passes. Upload is **9,617.62 KiB raw / 2,210.36 KiB gzip** with **19 ms** reported startup;20 changed static asset files upload and535 existing objects are reused.
- Deployment API readback confirms the exact new version at **100% traffic**, with no intervening concurrent version replacing the expected947f7fc4 before the traffic switch.
- Public Home is HTTP200. Normal health is HTTP200 with configured/enabled/ready true and healthy mainnet observations at finalized slot462555669. `health?self=1` is HTTP200 with `ok:true, assets:200, worker:200`, preserving own-origin asset checks through the SaaS binding.
- **16/16 public byte/hash checks pass**: twelve representative atlas/preview objects, the previous unissued diagnostic image and metadata, and both actual production stylesheets matching the locally built bundle. Saved diagnostic assets remain unchanged; these checks perform no issuance or writes.

## Public browser verification

The independent actual-production browser pass succeeds:

- **96/96 settled catalog/art states** across all48 designs at1440×1000 and390×844. Creator art has zero offsets/margins, no color filter and full-aperture fill; canonical content, decoded skins/backs, clipping and document fit remain consistent.
- **5/5 Home viewports / 200 sampled motion frames** at844×390,667×375,568×320,390×844 and1440×1000. Cards are usable, controls hit-test without overlap, Next advances, Featured/Pulse tabs work and full motion remains enabled. The settled568×320 supplement confirms heading opacity1, running animation and resumed ambient motion.
- **7/7 full-turn traces**, covering representative standard, premium, limited and stock cards at desktop/phone sizes. Each completes a revolution with continuous angle changes, active light response on both faces and rounded front/back clipping.
- **103/103 unsigned Launch assertions / 46 states** at1440×1000,390×844,320×640 and568×320. All17 meme finishes remain reachable; exact PENGU/CARDS/CHILLGUY filtering/selection,25 admitted quote options, focus return, paired-link continuity and unconnected review layout pass.

Final runtime, first-party response and request-error lists are empty; no write requests occurred. Eighteen actual screenshots were inspected. Baseline screenshots independently reproduce the old zero-sized568px Home card and the filtered/offset Doge art before the traffic switch. The first two cold catalog samples read the skin-ready attribute before hydration; explicit readiness waits confirm both pass. Those initial samples and the settled retries are retained, rather than changing application code for a harness delay.

Ignored evidence is under `output/card-consistency-release-2026-10-29/`, including the strict upload/deploy logs, remote version/deployment records, source fingerprints, public checks and `browser/summary.json` with companion screenshots/scripts. The owned QA browser is closed and the original local preview remains running.

## Limits

The canonical `https://launchacard.fun/` request still times out from this QA network. This release verifies the dedicated Worker URL and preserves the separate SaaS transition; it does not claim to fix canonical-domain availability. Physical phone sensors, Safari and real creator-operated token/NFT issuance remain untested. The local preview stays running on port5310. Nothing was pushed to Git or posted to external profiles.
