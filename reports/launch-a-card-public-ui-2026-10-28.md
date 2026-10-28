# Public interface and Home release QA — 28 October 2026

Read-only browser verification began against the dedicated Worker at `https://launch-a-card.gtjvv976mb.workers.dev`, version `aa8f6ad7-3225-43a3-9a4c-50a1277cc56c`. The browser did not connect a wallet, create a demo account, submit a form or send a transaction. No source or remote resource changes were part of that initial pass.

## Public route checks

All 18 desktop/phone route checks returned HTTP 200, including the final destination of the legacy `/market` redirect. Home, Discover, the limited-design gallery, mainnet Launch, explicit test-demo Launch, Honk, signed-out Portfolio and Legal rendered at 1440×900 and 390×844. The separate card inspector was inspected on both faces at 320px and restored focus to Inspect.

The visible brand is Launch a Card with the wordless card-and-crown logo, and canonical URLs use `https://launchacard.fun`. Demo collection/trading routes carry the demo note. Mainnet Launch carries its separate wallet-approval note and exact selected TSLAX quote. At the initial pass, readiness correctly reported that real launches were disabled in the deployment and the review action had `aria-disabled=true`.

No runtime/console errors, failed first-party responses, request failures, broken loaded images or mutation requests were recorded. Nonblocking unused-font-preload warnings were observed. No horizontal overflow occurred at the checked route sizes.

Evidence: `output/playwright/launch-a-card-public-2026-10-28/public-routes.json`, `public-routes.log`, the route screenshots, and `inspect-{front,back}-320.png`.

## Confirmed release defect and scoped correction

The desktop Home card initially covered part of the subtitle and clipped its navigation below the viewport. A settled-layout correction alone still allowed the inherited hand-style turn lift and lean to project above the subtitle during automatic rotation. The parent authorized the scoped fix.

| Before | After | Why |
| --- | --- | --- |
| Card width used a viewport-height allowance independent of the caption and controls. | Width uses the actual stage container, fixed interface space and proportional card-motion padding. | Fits the complete object and navigation at every fitted stage size. |
| The Home hand card used its full lift/lean arc while revolving. | A per-instance `turnArcScale` defaults to 1; fitted desktop Home sets 0.2. | Turns in place while retaining the same angle, both-face lighting and pointer controls. |
| The near hand camera exaggerated projection into adjacent text. | Fitted desktop Home uses a 4000px camera. | Preserves the large collectible without projecting through the subtitle. |

Only four files implement this release correction: `app/src/carddex-gallery.css`, `app/src/routes/index.tsx`, `app/src/components/mintdex/card3d/motion3d.ts` and the existing `app/tests/card3d/turntable.test.ts`. The shared kind configuration is not mutated. Phones and other card scenes keep the default arc. A media listener immediately resets the Home instance when crossing the fitted breakpoint and cleans up on unmount. No new animation loop is added.

## Local rebuilt-engine verification

A fresh browser tested the actual rebuilt engine through more than 360° at 1440×900 and 1280×720. Front and back screenshots were inspected. Resizing the same card body from desktop to phone and back measured arc factors 0.20 → 1.00 → 0.20. The original 390px and 320px card dimensions and 44px controls remained unchanged. No overflow or runtime/asset errors occurred, and Full motion remained selected.

The final CSS-only proportional spacing was then tested on that coherent new-engine preview by adding the exact edited stylesheet. Complete rotations plus hover passed at all four desktop sizes:

| Viewport | Minimum visible card top | Subtitle bottom | Controls bottom |
| --- | --- | --- | --- |
| 1440×900 | 142.42px | 118.28px | 872.20px |
| 1280×720 | 133.26px | 110.28px | 700.19px |
| 1440×1000 | 142.19px | 118.28px | 972.20px |
| 1920×1200 | 189.20px | 118.28px | 1124.19px |

The projected card also remained above its caption at every sampled angle. The existing turntable suite passes 11 tests / 58 assertions, including a new isolation check over nine angles: a bounded arc keeps the rotation and front/back identity, while new and unrelated bodies retain default 1 and the shared kind settings remain unchanged. The parent recorded successful TypeScript, the coherent guarded build and its broader app suite. Diff and Impeccable detector checks pass.

Evidence: `home-final-built.json` records the rebuilt engine and resizing; `home-proportional-envelope.json` and `home-proportional-*.png` record final CSS projection, hover and capped-card checks. `home-turnarc-tests.log` records the focused regression. Earlier camera-only diagnostic files are intermediate trials, not release acceptance evidence.

## Final public readback and canonical connectivity

The final proportional UI was verified on the actual dedicated Worker, version `b62dea77-c03c-4aae-8ac3-7706d31d7045`, without injected styles. The parent subsequently deployed `0bc12834` with the same UI plus fetch hardening. Complete rotations exceeded 360° at both desktop sizes: the visible card stayed below the subtitle, above its caption and inside the control allowance. Minimum card top was 142.42px versus subtitle 118.28px at 1440×900, and 133.29px versus 110.28px at 1280×720. Controls ended at 872.20px and 700.19px. Front and back screenshots were inspected.

The final 390px and 320px pages retained their original card sizes, labels and controls with no horizontal overflow. The 320px inspector showed both faces, closed and restored focus to Inspect. Full motion stayed on. Mainnet Launch still showed the separate wallet note and disabled review, while test-demo Launch, the gallery and Discover retained demo labels. Exact TSLAX quote identity and the Launch a Card brand were correct. No runtime/console errors, failed responses or broken loaded assets were recorded in the final Worker pass. No wallet connection, signing, sending, form submission or remote resource change occurred, and all owned QA browsers were closed.

**Canonical browser verification remains incomplete from this QA host.** Plain browser navigation to `https://launchacard.fun/` timed out. The host's normal resolver returned the former parking address 192.64.119.61; resolver 1.1.1.1 returned 172.67.193.127 and 104.21.57.235. An isolated Chromium session mapped only the canonical hosts to the verified current address, preserving normal Host and TLS verification, but that navigation also timed out. Curl requests forced separately to both Cloudflare addresses timed out before an HTTP result. No certificate validation was bypassed, and no OS DNS setting was changed.

These local timeouts are separate from the subsequent successful canonical HTTPS checks. At `2026-10-28T07:42:19.421Z`, the temporary dedicated Worker `launch-a-card-connectivity-check` fetched the actual canonical root, public image and metadata. All returned HTTP 200 with ordinary certificate validation and no bypass.

| Remote check | HTTP status | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Canonical root HTML | 200 | 109,502 | `ddd345b5d9af6dce74dfdd33823a79f4c73feff6da2ed9386cebe78c651d4ac6` |
| Public PNG image | 200 | 93,500 | `07a5dd5b9633bda8e168c04a6b74486ba356b0c8f08d9ac4bcc7a567578258a3` |
| Public JSON metadata | 200 | 273 | `2485c038e9524a6730de0ed4a426c48ff04b4e13140a9d7a4899eccb0ca92274` |

This independently confirms canonical HTTPS and public asset delivery. It does not replace the browser-rendering checks, which passed on the dedicated Worker serving the same UI bundle, or establish a browser pass for the canonical domain or `www` redirect. The local port 443 timeout remains an environment limitation. The parent owns the temporary diagnostic Worker's cleanup and any further domain verification.

A keyless Helius POST from that Cloudflare Worker returned HTTP 401, confirming reachable provider transport rather than valid credentials. The earlier supplied authenticated endpoint also returned 401; the last recorded application health result is `network_error`. The current Launch-a-Card key in the owner's Helius dashboard differs from the earlier supplied key, and its allowed-domain, IP and CIDR lists are empty. The owner must update the encrypted Worker secret through the secure credential handoff. No endpoint or key value is included in this report.

**Live launches remain false** pending the credential update and successful RPC/mainnet readiness verification. No transaction was signed or sent during these checks. The directory, balances and trading remain labelled demo.

Final browser evidence: `worker-final.json`, `worker-final.log`, `worker-final-*.png`, `worker-final-inspect.log`, and `canonical-connectivity.json` under `output/playwright/launch-a-card-public-2026-10-28/`. The failed ordinary canonical attempt is retained as `canonical-final.log`; `canonical-cli.config.json` records the isolated resolver override used for diagnosis. Independent remote HTTPS and provider-transport evidence is in `output/launch-a-card-2026-10-28/connectivity-probe-result.json`.
