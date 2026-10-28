# Launch a Card availability diagnosis — 28 October 2026

The owner reported that the site would not load. The app and its mainnet RPC are healthy at the dedicated Worker URL. Independent public probes verify normal canonical-domain HTTPS in Singapore, the United States and Germany, while two Philippine probes fail and the local QA network cannot connect to the assigned addresses. The evidence points to regional network/DNS behavior, including an old answer from the local default DNS resolver. It does not prove an ISP block, and the owner's access is not confirmed restored.

Current deployment: `108990d7-c0fc-4c7d-be9b-996ad3199dd6`, tag `viewport-final-polish`, at 100% traffic. No app code, domain record, wallet state, credential, security setting or subscription was changed during the investigation. No production repair was applied or claimed.

## Observations

| Check | Result | Scope |
| --- | --- | --- |
| `https://launch-a-card.gtjvv976mb.workers.dev` | HTTP 200 over normal HTTPS | App deployment is reachable from the QA network. |
| Deployed `/api/live/health` | Healthy mainnet RPC; `configured/enabled/ready=true` | Backend/provider readiness; not canonical-origin reachability. |
| Authenticated Cloudflare zone dashboard | “Your domain is now protected by Cloudflare” | Zone is active; the failure is not explained by a pending zone. |
| Authoritative DNS, Cloudflare 1.1.1.1 and Google 8.8.8.8 | `104.21.57.235`, `172.67.193.127`; assigned nameservers `aaron.ns.cloudflare.com`, `addyson.ns.cloudflare.com` | Public delegation and assigned addresses are correct. |
| QA host's default resolver for apex | Former parking A `192.64.119.61` | This resolver still has an old answer; flushing the OS cache did not change it. |
| Default `www` resolution | Assigned Cloudflare addresses | The apex parking answer alone cannot explain all failures. |
| Strict HTTPS forced separately to both assigned Cloudflare addresses | TCP 443 timeout before TLS/HTTP | These assigned paths are unreachable from this network even when DNS is overridden. |
| Canonical HTTP forced to an assigned Cloudflare address | Worker HTTPS redirect and security headers | Canonical routing works on the reachable HTTP path. |
| Strict canonical HTTPS forced separately to `104.21.85.161` and `172.67.141.22` | HTTP 200; `ssl_verify_result=0` | Public TLS and canonical SNI/Host routing work through these alternative edges; ordinary visitors do not automatically use these forced paths. |
| Independent certificate inspection | Google Trust Services WE1; valid canonical SAN; 2026-10-28 06:24:52 UTC through 2027-01-26 07:24:49 UTC | A valid certificate exists; missing issuance is not the diagnosis. |
| Ordinary canonical-domain browser navigation | Still fails from QA host | Do not claim the canonical site has passed normal visitor/browser verification. |

No certificate verification was disabled. No OS DNS setting was changed. Alternative edge overrides were diagnostic, not a production DNS change or a visitor workaround.

## Correction to earlier evidence

The temporary Cloudflare diagnostic Worker fetched the canonical root, logo, image/metadata and redirect successfully. Those results remain useful evidence of host routing and content delivery from inside Cloudflare. Earlier reports described them too strongly as independent public Internet HTTPS verification. Cloudflare-internal fetches may avoid the network path that an ordinary browser uses, so they cannot settle this availability issue. The diagnostic Workers were deleted after use.

Later strict curl checks through alternative Cloudflare edges establish genuine public TLS with the actual canonical SNI and Host. The independent public probes below then verify ordinary DNS-assigned paths from other countries. Neither result establishes restored access from the owner's network.

## Independent public-network verification

Globalping HTTPS measurements created at 2026-10-28 08:57:17 UTC used normal domain lookup, without the local forced-edge override. All six successful checks report `tls.authorized=true`. The measurements cover two Philippine probes and three other countries per hostname; they are a sample of networks, not a worldwide availability guarantee.

| Host | Probe network/location | Resolved address | Result |
| --- | --- | --- | --- |
| Apex | OVH, Singapore | `104.21.57.235` | HTTP 200, valid TLS |
| Apex | HostPapa, Buffalo, United States | `172.64.80.1` | HTTP 200, valid TLS |
| Apex | Hetzner Online, Falkenstein, Germany | `104.21.57.235` | HTTP 200, valid TLS |
| Apex | COMFAC, Angeles City, Philippines | `162.159.36.12` | TLS alert; no HTTP result |
| `www` | xTom, Singapore | `172.67.193.127` | HTTP 308, valid TLS |
| `www` | HostPapa, Buffalo, United States | `172.67.193.127` | HTTP 308, valid TLS |
| `www` | Hetzner Online, Falkenstein, Germany | `172.67.193.127` | HTTP 308, valid TLS |
| `www` | HUAWEI CLOUDS, Manila, Philippines | `172.67.193.127` | TCP connection timeout at 15 seconds |

These are direct external checks of the assigned Cloudflare address paths, resolving the earlier gap left by Cloudflare-internal fetches. The same assigned address can work from one network and time out from another. The differing addresses observed by some resolvers are recorded without assuming a particular DNS cause.

Measurement IDs: apex `2C4KWIx9n9kUTDwf400021On3`; `www` `2p8f4Mc0A2ckP4OsW00021On3`. Raw responses, submission records and sanitized summaries are under `output/launch-a-card-2026-10-28/globalping-site-connectivity/`.

## Remaining verification

Compare a normal canonical-domain browser result from the owner's cellular connection or another Philippine provider with the failing paths. Preserve address-specific evidence if Cloudflare or the network provider needs a routing investigation. The existing cross-network results narrow the issue, but do not distinguish every possible routing, filtering or resolver cause. Cloudflare's [official potential ISP blocking guidance](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/potential-isp-blocking/) recommends per-address checks and comparison across networks. It also states that Free/Pro/Business addresses are shared and are not rotated on request. The evidence does not justify a plan purchase, security change or unreviewed production DNS override.

The current mainnet feature flag remains enabled, but its health response is not a public-domain readiness guarantee. Canonical artwork and NFT metadata access must be considered separately. No real token/NFT transaction was signed, sent or funded during this investigation, and the first creator-operated issuance remains unverified.
