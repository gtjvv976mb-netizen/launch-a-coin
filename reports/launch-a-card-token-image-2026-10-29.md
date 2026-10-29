# Standard creator token image — 29 October 2026

Status: implemented and built locally; **not deployed**. Production version6b453309 remains unchanged. No wallet signing, token/NFT issuance, RPC transaction, paid generation, DNS, secret or Git publication occurred.

## Result

New real-launch preparations now derive the token metadata image from the creator's chosen complete card, rather than using the raw artwork upload. The permanent export is a1024×1024 GIF:64 frames, a full front/back360° turn,40ms motion frames,600ms front/back holds and an infinite3.68s loop. The complete rounded63:88 silhouette stays inside a centered circular avatar. Market cap is omitted from this token-image print, without leaving an empty statistics row. Existing live card statistics and NFT case/card prints retain their behavior.

The composition reuses the48 verified Higgsfield front/back designs. This is deterministic export/motion of existing approved artwork, not a new Higgsfield generation or a claim of new custom art. GIF uses one128-color palette; a separate full-color1024px PNG still is included. Pump.fun's published creation guidelines accept GIF and recommend square images of at least1000px ([official help](https://intercom.help/pumpfun-web/en/articles/11002205-create-a-coin-on-pump-fun)). Wallet/indexer animation behavior is client-dependent; the first GIF frame is a complete front view, and metadata includes the still file.

## Trust and compatibility

- New preparation verifies the original wallet-owned artwork/card/case against the exact normalized composition before rendering media. Client-supplied token GIF/poster claims are rejected before rendering or RPC preparation.
- Token metadata `image` and `animation_url` point to the immutable GIF. Its `properties.files` includes GIF then PNG; format IDs and both hashes are recorded. Original creator artwork remains the interior source, preventing card-within-card recursion.
- Historical three-asset intents recover their committed metadata/URLs without generating or replacing images. NFT case/card, quote identities, transaction binding and issuance behavior remain unchanged.
- All48 WebP backs have pinned, lossless630×880 rounded PNG compatibility copies because the installed Resvg build cannot decode their WebPs. The generator verifies approved source hashes, output hashes, dimensions and repeatability. Originals and83 front atlases are unchanged.
- GIF MIME/header/immutable serving support was added narrowly. The concurrent Cloudflare SaaS own-origin ASSETS/SELF hotfix remains intact. No production configuration, bindings or health changes were made for this task.
- Creator review displays the actual immutable token animation before wallet approval, with a still link and a reduced-motion PNG source. Short landscape phones now use a full-height card and a separate control rail, fixing an inherited tiny-preview issue.

## Verification

- TypeScript and guarded client/Worker build pass. App/chain suite:300 tests,30,512 assertions,0 failures.
- All48 completed creator-card GIFs render in the actual compiled local Cloudflare Worker:1024 square, valid GIF89a,5,408,803–9,998,367bytes,1.16–2.24s observed local render time; all below the12MiB application ceiling. These are local timings, not production latency guarantees.
- Same-isolate card/case warm-up followed by token export passes; four concurrent representative exports pass. No memory-limit or runtime failure was observed in these checks.
- Four completed Doge/Pokémon/Neon/TSLA exports were independently decoded with Pillow:64frames, correct front/back order, infinite loop,3.68s duration. Actual front/back contact sheets were visually inspected. Pure encoder tests independently decode LZW pixels, verify timing and circular-crop geometry.
- Security/lifecycle tests cover immutable metadata hashes, served GIF bytes/MIME, approved reverse tampering, forged media rejection and historical intent recovery.
- Browser QA passes199/199 checks: four designs across1440×900,390×844,320×640 and568×320, artwork/identity/exact-pair retention, three emulated touch drags, front/back rail controls, Inspect and focus restoration. No runtime errors, failed first-party requests or write requests. Prepared authenticated wallet review, physical phones and a creator-operated mainnet launch were not exercised. The actual immutable export and metadata/transaction binding are covered separately by renderer and server tests.
- Final build fingerprint:1303 inputs, `8fad9dd2c709df5f39fcd6705a29d335ad82d23d566f771c280f8a8f69084a63`. Owned auxiliary Worker/browser sessions were closed; preview5310 remains running.

Evidence: `worker/all-designs.json`, `worker/full-flow.json`, `worker/concurrency.json`, `worker/media-qa.json`, completed example GIF/PNG files, contact sheets, logs and browser captures. Outputs are local QA examples, not issued tokens.
