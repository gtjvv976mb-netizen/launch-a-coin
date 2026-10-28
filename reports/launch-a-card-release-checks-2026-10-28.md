# Launch a Card — implementation and verification

The public platform name is **Launch a Card**, and all canonical/share URLs use **https://launchacard.fun**. Navigation, titles, sessions, legal/help copy, card/case labels, install manifest and wallet launch metadata use the new name. Internal carddex identifiers and the recovery folder stay stable. The wordless premium card-and-crown logo is retained.

The preceding real-launch request is implemented: creator chooses a permanent design and admitted quote, authenticates their own mainnet wallet, reviews/signs the exact pump.fun token transaction, waits for finalized verification, then separately reviews/signs immutable creator Core NFT issuance. No NFT sales, bids, auctions or royalties were added. The selected quote is preserved, optional initial buys are explicit, and signed retries/recovery use immutable transaction history plus concurrency/expiry guards.

The server attests the canonical front and premium case from actual creator artwork. All48 designs have pinned lossless flattened skins, with 83 total admitted stock/plain variants. Raw front 1260×1760; marketplace case 1440×2240. A browser/WebP→PNG conversion is local and incurs no generation spend. No additional Higgsfield jobs or image credits were used.

## Final checks

- 141 app tests pass, 8,429 assertions. This includes wallet protocol and exact amount guards, actual PNG output, image/source hashes, auth/replay, trusted composition, immutable metadata and deterministic transaction recovery races.
- 23 isolated adapter tests pass, 415 assertions; adapter TypeScript passes. Actual emitted transactions for all 16quotes and Core pass the browser operation verifier.
- App TypeScript and the source-fingerprint-guarded client/SSR build pass.
- Cloudflare Worker dry-run passes:9,557.56 KiB / 2,200.88 KiB gzip. The official Anchor browser build is explicitly used to exclude filesystem wallets/workspaces. The renderer WASM is uploaded as a static module, not compiled from network bytes.
- A standalone local workerd fixture imported the actual built composer, loaded trusted static assets and returned a real 2,808,961-byte transparent 1440×2240 PNG case in 799 ms. No memory exception. Its temporary Worker was stopped; it is not an application route or deployment.
- Root browser checks cover Home 1440/390, Levels 390, Discover 320, Portfolio 320 and Legal 390. All use Launch a Card titles and launchacard.fun canonical URLs, with full motion, zero overflow, no old public CardDex copy, no runtime errors and no failed local responses. The separate launch UI report passes 1440/768/390/320px controls, readiness, artwork, wallet picker, keyboard pair guards and explicit demo switching with zero write requests. Turntable pause holds an exact stationary pose; resume and a179.94° turn pass. The320px inspector front/back header is clear, closes with focus restored and retains Full motion.
- Only local migration 0011 was applied. No remote D1/R2, DNS, account or deployment changes occurred. No real wallet signing, funding, broadcast, token creation or NFT issuance occurred. Public-mainnet program simulations are read-only, not completed launches.

Evidence under ignored `output/launch-a-card-2026-10-28/`: `build.log`, `tests.log`, `worker-dryrun.log`, `site-qa.json`, desktop/phone screenshots, representative NFT card/case PNGs, and local renderer HTTP headers/PNG. Adapter public RPC evidence is in `output/research/pump-custom-pairs-2026-10-28/live-program-simulations.json`. Prior quote/SIM and all 48card geometry reports remain applicable.

## Remaining activation work

launchacard.fun still points to its registrar parking address and registrar nameservers. Connect it to Cloudflare, create this application's independent production resources, review production CPU/RPC/storage configuration, deploy, verify public assets and enable wallet launches. A first real token+NFT launch must then be approved in the owner's wallet. See the public readiness report; the disabled production template has an intentionally invalid D1 placeholder. The current local preview is http://127.0.0.1:5310.
