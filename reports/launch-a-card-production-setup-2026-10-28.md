# Launch a Card production setup — 28 October 2026

The owner explicitly authorized the production setup with “do it” after the mainnet readiness checklist. Work is restricted to Launch a Card; MintDex resources and credentials were not reused.

## Provisioned and deployed

- Cloudflare account: `985281cb00d5f7379896b62a03e0edb7` (existing CLI authentication).
- Dedicated D1 `launch-a-card`: `ffc8ba69-4d9d-404c-9c3d-e4a7f187cb3a`, APAC.
- Dedicated R2 `launch-a-card`, APAC hint, Standard storage.
- All 11 tracked migrations applied remotely using the explicit production config. Remote `quick_check=ok`, no foreign-key violations, 11 migration records and zero live intents before traffic.
- Guarded TypeScript/client/SSR build passed. Final Worker startup 16 ms; bundle 9,577.53 KiB raw / 2,203.64 KiB gzip.
- Worker `launch-a-card` deployed at `https://launch-a-card.gtjvv976mb.workers.dev`.
- Current enabled version `108990d7-c0fc-4c7d-be9b-996ad3199dd6`, tag `viewport-final-polish`, deployed at 100% traffic. The first enabled release was `f4323060-6374-408b-ad04-6d01c61bcab4`. Initial version was `aa8f6ad7-3225-43a3-9a4c-50a1277cc56c`.
- `app/wrangler.production.jsonc` records only this app's bindings. Local configuration remains isolated.
- Cloudflare accepted an explicit 30,000 ms CPU allowance. No Cloudflare subscription or billing change was made.
- The production mainnet integration is enabled after healthy RPC and Cloudflare-internal canonical delivery checks. Later independent public probes pass outside the Philippines, while regional access failures remain unresolved; the original public HTTPS evidence claim is corrected below. No real wallet transaction was signed, submitted or funded by the agent.

## Hosted checks

The deployed launch page returns HTTP 200 with the expected security headers at the dedicated Worker URL. During the initial disabled release, an unauthenticated composition request failed closed with “Real wallet launches are disabled in this deployment.” That response is historical, preceding the activation recorded below. Independent browser QA covers desktop/phone routes at the dedicated Worker URL: correct branding and demo labels, no runtime/console/asset errors or broken images, and no write requests. The Home card clipping issue found during this QA is fixed in the deployed version. The full 360-degree motion envelope stays clear of the heading and controls at 1440×900 and 1280×720, including hover; 390/320-pixel phone layouts and both card faces pass. See the public UI report for measurements and evidence.

A temporary remote workerd probe successfully rendered the real canonical 1440×2240 transparent case: 2,808,961-byte PNG, 978 ms reported renderer time. This checks the Cloudflare runtime rather than only local workerd. It does not establish the production account's CPU plan or replace an owner-wallet launch.

The same remote probe found that `https://api.mainnet-beta.solana.com` returns HTTP 403 (“Your IP or provider is blocked from this endpoint”) for genesis, health and epoch methods from Cloudflare. The unusable public RPC setting was removed from the production config/template.

Two harmless content-addressed R2 diagnostic objects test the actual asset and short metadata routes. They have no wallet, D1 grant, token, NFT or launch-intent record. Metadata explicitly states that no token or NFT was issued. Details and hashes are in ignored `output/launch-a-card-2026-10-28/deployment-check-record.json`.

## Canonical domain

The Cloudflare Free zone is `e91d78f85ca3a48e61b7a894e1285f4a`. Namecheap now uses `aaron.ns.cloudflare.com` and `addyson.ns.cloudflare.com`; authoritative `.fun` delegation and public resolvers confirm the change. Worker custom domains `launchacard.fun` and `www.launchacard.fun` are successfully attached.

The owner explicitly approved replacing only the two parking records. The removed values are backed up here: apex A `192.64.119.61`, and `www` CNAME `parkingpage.namecheap.com`. Existing email records were preserved; Namecheap showed no configured email redirect recipients. Original records:

- `www`: CNAME `parkingpage.namecheap.com`.
- MX: priority10 `eforward1`, `eforward2`, `eforward3`; priority15 `eforward4`; priority20 `eforward5`, all under `registrar-servers.com`.
- SPF: `v=spf1 include:spf.efwd.registrar-servers.com ~all`.
- No CAA or DS answers were observed.

Both authoritative Cloudflare nameservers and public resolvers return A `104.21.57.235` / `172.67.193.127`. The QA host's local resolver still caches the old parking address. Forced canonical HTTP reaches this Worker and returns its HTTPS redirect and app security headers. HTTPS connections to both Cloudflare IPv4 addresses time out before TCP connects from this local network, so canonical browser/TLS QA could not finish here; no certificate validation was bypassed and no OS network settings were changed.

A temporary Cloudflare Worker successfully fetched the canonical **HTTPS** root (200), image (200, exact SHA-256 `07a5dd5b9633bda8e168c04a6b74486ba356b0c8f08d9ac4bcc7a567578258a3`) and metadata (200, exact SHA-256 `2485c038e9524a6730de0ed4a426c48ff04b4e13140a9d7a4899eccb0ca92274`). This verifies host routing and delivery from inside Cloudflare. The earlier conclusion that it independently confirmed public Internet TLS was too strong: Cloudflare may route these fetches internally. It does not resolve the ordinary-browser failure. The dedicated `launch-a-card-connectivity-check` Worker was deleted after the checks. See `connectivity-probe-result.json` and cleanup log under the evidence directory below.

In the later 28 October investigation, the authenticated dashboard showed “Your domain is now protected by Cloudflare,” ruling out a still-pending zone. Strict external curl requests preserving canonical SNI/Host but forced to alternative Cloudflare edges `104.21.85.161` and `172.67.141.22` returned HTTP 200 with `ssl_verify_result=0`. A separate certificate inspection found a valid `launchacard.fun` SAN certificate issued by Google Trust Services WE1, valid 28 October 2026 06:24:52 UTC through 26 January 2027 07:24:49 UTC. These checks establish valid public TLS on those forced paths, not on the DNS-assigned paths. The assigned addresses still time out on TCP 443 from the QA network; the default resolver also retains the old parking answer. See [the availability report](launch-a-card-availability-2026-10-28.md) for the current distinction and remaining verification.

Independent Globalping HTTPS measurements created at 08:57 UTC subsequently verified ordinary canonical apex access (200) and `www` redirects (308) from Singapore, the United States and Germany, with `tls.authorized=true`. Successful probes used the actual assigned addresses `104.21.57.235` and `172.67.193.127`. Two Philippine probes failed: an Angeles City apex probe resolved `162.159.36.12` and received a TLS alert, while a Manila `www` probe timed out connecting to assigned `172.67.193.127`. This establishes a regional network/DNS difference, not a globally broken deployment or a proven ISP block. No app, domain or security setting was changed during that investigation; the user's local access is not confirmed restored. Raw/summary records are in `output/launch-a-card-2026-10-28/globalping-site-connectivity/`.

## RPC and activation

`CARDDEX_MAINNET_RPC_URL` is stored as an encrypted Production Worker secret, verified by CLI name/type and dashboard “Value encrypted.” It was never written to source or an environment file. The endpoint supplied by the owner returned HTTP 401 in a direct read-only genesis probe. The owner subsequently upgraded Helius; the selected Launch-a-Card project shows 10 million plan credits. Its current existing app key differs from the supplied endpoint, and its allowed domains/IPs/CIDRs are empty (the Helius UI states this allows requests from anywhere). No key, access rule or Helius billing setting was changed by the agent.

The initial disabled `/api/live/health` reported `configured=true`, `enabled=false`, and RPC `unavailable / network_error`. That hosted response does not establish an HTTP authentication rejection. The health check uses two fixed read-only mainnet methods, a bounded timeout/cache, and returns only sanitized status/slot observations; it never reveals the endpoint, key, provider body or raw exception. A separate keyless Helius request from Cloudflare returns HTTP 401, establishing that the provider hostname is reachable there.

The transport cause was subsequently identified: Workers rejects `redirect:"error"` before any network request. An exact-init local workerd probe reproduces the TypeError and confirms `manual` works. Both health and `fetchPublicBytes` now use `redirect:"manual"` and reject all non-2xx responses, including redirects, without following them. Focused tests verify rejected provider redirects do not expose location/keys and asset redirects cause only one fetch. The fix is deployed and verified by the healthy mainnet readback. [Cloudflare Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/) describes this runtime restriction. A prior global-fetch receiver hypothesis was tested and not reproduced.

The owner completed the secure secret entry and deployment. Disabled release `7f095a73-7203-4ac2-8d86-6ceba9bc4716` passed the healthy mainnet check before activation. The subsequent enabled release returned `ok=true`, `configured/enabled/ready=true`, with finalized slot 462405058 and block height 440429656 at 2026-10-28T08:15:27Z. The remote D1 read immediately before activation confirmed zero live intents, transactions and wallet sessions, with no writes.

The final Cloudflare-internal probe returned canonical root HTTPS 200, `www` 308 to the canonical apex, health 200/ready true, logo 200 with exact source SHA-256 `054816c953054b475d79234e65a99164e1dda0adaad41f7eac5e5b48dc344cef`, and image/metadata 200 with their original committed hashes. This preserves the recorded delivery evidence without treating it as an ordinary public network pass. See `connectivity-final-result.json`; the temporary Worker was deleted successfully afterward.

A read-only public Launch browser pass at 1440, 390 and 320 pixels confirmed enabled readiness, the active review control, terms visibility/checkbox behavior, the new logo and no page scrolling. No wallet was connected and no authentication, signature, submission or non-GET request occurred. The first creator-operated mainnet token and Core NFT issuance remains unverified. Discovery, balances and site trading remain explicitly demo; real completed launches link to pump.fun and the creator's NFT.

Latest checks: **169 app tests / 8,612 assertions / 18 files**, including chain, CardDex, health, canonical origin and turntable regressions; TypeScript and guarded client/SSR build pass. Earlier adapter checks passed 24 tests / 421 assertions; the adapter was unchanged in this setup pass. No real token or NFT transaction has been signed or broadcast.

Evidence is under `output/playwright/card-first-2026-10-28/` (deployment/build/D1 records), `output/playwright/launch-a-card-public-2026-10-28/` (browser QA), and `output/launch-a-card-2026-10-28/` (remote renderer/RPC/HTTPS checks). All temporary diagnostic Workers were stopped/deleted. No paid subscription or plan upgrade was made by the agent; the owner reported independently upgrading Helius.

## Viewport and brand release

The subsequent owner request replaces document scrolling with measured pages, tabs and field steps while preserving the original card-led composition. All 48 designs, 16 quote balances, long descriptions/legal copy and exact transaction values remain reachable. The new logo is a multicolor fan of card backs beneath a separate jeweled crown. No paid image generation occurred. Dialog focus return, Close/Escape/drag dismissal, both-face shimmer and full rotations remain verified. See `launch-a-card-viewport-2026-10-28.md`, `launch-a-card-viewport-launch-2026-10-28.md` and `launch-a-card-brand-overlays-2026-10-28.md` for scoped browser evidence and limitations. Local-only SIM QA created a test holding and card; this was not a mainnet transaction.

Final polish version `108990d7-c0fc-4c7d-be9b-996ad3199dd6` keeps the verified backend/config and adds only bounded phone Home clearance and a 40px desktop wallet control. Actual final-bundle full rotations clear the heading, caption and controls at 1440×900, 1280×720, 390×844 and 320×640; no injected styles were used for acceptance. Final TypeScript and guarded build pass, as do diff and targeted Impeccable checks. The post-deployment sanitized health record is `output/launch-a-card-2026-10-28/viewport-polish-health.json`.
