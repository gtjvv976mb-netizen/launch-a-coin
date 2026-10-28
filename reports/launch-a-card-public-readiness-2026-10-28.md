# Launch a Card — public domain readiness

**Later update:** The owner authorized production setup. Dedicated resources, remote migrations and a disabled Worker deployment now exist. The shared Solana public RPC was found to block Cloudflare; a provider secret is required. Follow the [current production setup record](launch-a-card-production-setup-2026-10-28.md). The inventory below is the original pre-authorization baseline.

The owner selected **Launch a Card**, at **https://launchacard.fun**, on 28 October 2026. The recoverable project folder, Git branch and technical carddex asset/session identifiers remain stable. This is an independent application; MintDex is unchanged.

Public DNS checked on 28 October 2026: `launchacard.fun` resolves to `192.64.119.61`, with `dns1.registrar-servers.com` and `dns2.registrar-servers.com`. It is still on the registrar's parking setup. Domain ownership was supplied by the owner; no DNS account changes were performed.

Cloudflare CLI is authenticated. Read-only D1/R2 inventory found no resources for this independent application. Existing MintDex/other-project resources must never be reused. No remote resources, production migrations, domain attachment or deployment were performed in this task.

## Concrete activation sequence

1. Add launchacard.fun to the owner's Cloudflare account. At the registrar, replace the current nameservers with the two nameservers Cloudflare assigns to this domain. Wait for Cloudflare to report Active.
2. Create a dedicated `launch-a-card` D1 database and R2 bucket. Review `app/wrangler.production.example.jsonc`, copy it to a private deployment config and replace the database placeholder with the new ID. Keep live launches disabled during setup.
3. Apply this app's migrations to that dedicated remote D1 database. Do not copy local demo files or any MintDex credentials.
4. Install both the isolated pump adapter and app dependencies from their pinned lockfiles. Run the source-guarded build and checks. The Worker dry-run passes with the static renderer WASM module: 9,557.56 KiB uncompressed / 2,200.88 KiB gzip. The local workerd runtime rendered a real 1440×2240 transparent PNG case in 799 ms, producing 2,808,961 bytes without a memory exception. Verify production CPU allowance before enabling public launches; this rendering workload exceeds the free plan’s 10 ms CPU allowance ([Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)). The server uses flattened trusted skins to avoid repeated raster decoding. Do not enable or upgrade a paid plan without owner approval.
5. Deploy to the exact configured public origin. Check `/launch`, static premium fronts/backs/fonts, cookie/origin policy, and immutable public asset/metadata routes over HTTPS. Public artwork must stay available for wallets and marketplaces.
6. Configure a reliable server-only Solana mainnet RPC, verify mainnet genesis/admitted quote accounts, and enable `CARDDEX_LIVE_LAUNCH_ENABLED=true` only after the public setup checks pass. Never activate the inherited MintDex chain SDK or modify its global SIM switch.
7. The owner connects their own wallet and reviews/signs a real token transaction, followed by a separate creator NFT transaction after token finalization. These require real SOL/rent and possibly the selected quote balance for an initial buy. The assistant has not signed, funded or sent any real transaction. Test a first owner-approved launch before inviting other creators.

The real launch flow has independent mainnet intent records, immutable public image/metadata bindings, wallet message authentication, exact-message signing/relay verification and retry/recovery paths. The discovery/trading catalogue remains clearly labelled demo. A completed wallet launch links to the actual pump.fun token and on-chain creator NFT; it is not inserted into simulated trading balances.
