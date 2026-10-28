# Launch a Card real-launch backend — 28 October 2026

The real-launch server implementation is separate from the local simulation. It prepares wallet transactions through the new pump.fun/Core adapter, records immutable launch commitments and verifies finalized receipts. This report documents implementation and mocked integration checks, not a public deployment or a completed mainnet launch.

## Public configuration

`app/wrangler.production.example.jsonc` is a disabled configuration template with a placeholder D1 identifier. It creates nothing. Production requires a new, independent Launch a Card Worker, D1 database and R2 bucket, the static `ASSETS` binding, all migrations through 0011, `CARDDEX_DEPLOYMENT_ENV=production`, `CARDDEX_PUBLIC_ORIGIN=https://launchacard.fun`, a server-only HTTPS `CARDDEX_MAINNET_RPC_URL` and an explicit `CARDDEX_LIVE_LAUNCH_ENABLED=true` after configuration is verified. The normal local config remains unchanged and disabled for real launches.

Readiness returns `implemented`, `configured`, `enabled`, `ready` and concrete blockers. Missing hosting/RPC bindings are configuration failures, rather than a claim that the launch implementation does not exist. The RPC endpoint is never included in public responses. Preparation rejects non-public origins, inherited MintDex origins and unreachable or changed public assets before producing a transaction for wallet review.

## Wallet ownership and isolated records

The creator signs a single-use, five-minute, origin-bound sign-in challenge. The server verifies the Ed25519 signature and canonical on-curve address, then creates a separate two-hour `carddex_live_session` HTTP-only, Secure, SameSite=Strict session. State-changing actions also require the configured request Origin. A wallet proof does not authorize sending a transaction.

Migration 0011 creates separate live challenge/session, asset/grant, trusted-composition, launch-intent and transaction-attempt tables. It does not insert simulated users, coins, balances or trades. Token mint, creator, exact quote, design, metadata URLs, payload and adapter binding hashes cannot be changed through SQL updates. Prepared messages and once-recorded signed bytes/signatures also have immutable SQL guards.

## Trusted public images and metadata

`POST /api/live/compose` accepts only creator artwork and token/design/quote fields. It derives the creator from the live wallet session. Opaque client-rendered cards or cases cannot qualify for launch. PNG/JPEG inputs are capped at 4 MB and 2048 pixels per side; the browser resizes all input formats and converts WebP before this request.

The trusted renderer composes the shared canonical card and marketplace case using pinned, preflattened approved skins and fonts from `ASSETS`. Its source loader checks hashes against the reviewed original WebP and lossless render manifests. R2 stores content-addressed artwork, complete card and case images. A D1 composition commitment binds those exact hashes to the normalized token fields and creator.

Preparation rechecks ownership grants, stored bytes, public HTTPS bytes, approved frame hashes and exact metadata JSON. Token metadata uses the creator artwork. The NFT image uses the complete marketplace case, retaining the uncased card and frame commitments in its properties. Website/X fields are sanitized and retained. NFT metadata sets zero seller fees and promises no royalties, revenue share, equity ownership or redemption rights. The Core adapter independently removes update authority in the same creation transaction.

Raster URLs are immutable content-addressed paths. JSON uses the compact `/m/<43-character-base64url-SHA256>` route, keeping pump.fun metadata URIs around 69 characters for the supplied domain. The complete SHA-256 remains in the binding and on-chain NFT attributes. These are public objects, accessible to marketplaces without wallet cookies.

## Lifecycle and recovery

The stages are `prepared`, `token_pending`, `nft_pending`, `complete` and safely `abandoned` for unused expired drafts. Preparation returns an unsigned, simulated transaction with actual network/rent/program/quote costs for wallet review. It never calls the simulation launcher and never signs on behalf of a creator. A requested initial buy is retained or fails explicitly; it is never silently removed to fit a transaction.

The authenticated relay accepts only the exact persisted prepared message with all required wallet/ephemeral signatures. It stores the deterministic signature and exact signed bytes before calling the adapter's fresh mainnet simulation/send helper. An uncertain provider response returns that same saved signature and requires recovery. It cannot replace the transaction with different signed bytes or send a competing transaction for the same pending stage.

Token confirmation checks the prepared message and finalized pump.fun mint/quote/creator state. Only then can the creator prepare the separate Core NFT. NFT verification checks the actual owner, immutable URI/name/attributes, token, quote, design and image/metadata hashes. A matching existing asset completes recovery instead of issuing another NFT.

No ephemeral private keys or wallet seeds are stored on the server. If a browser loses the unissued NFT key, replacement is allowed only after every prior prepared NFT blockhash has expired on the finalized chain and the old asset is absent. A same-key retry of an expired unissued NFT uses those same checks before clearing the old stage signature/receipt and preparing a fresh message. Old signed transaction rows remain immutable. An unused token draft can similarly be abandoned only after all token plans have expired and the mint is absent; records are retained. A finalized token must be resumed rather than discarded.

Concurrency guards compare the complete intent snapshot and exact sorted prepared-plan set after asynchronous RPC checks. Stale preparations cannot insert old-mint plans after rotation; a concurrent relay prevents rotation. Confirmation batches compare stage, signatures and receipt JSON, and preserve verified receipts, so a late pending RPC answer cannot downgrade an already finalized launch.

## Checks and limits

- Targeted live backend tests: **14 passed, 113 assertions**.
- Combined simulation persistence, quote helpers and live backend tests: **47 passed, 1,806 assertions**.
- TypeScript passes against the coordinated source after route generation and renderer integration.
- All real migrations are applied to an in-memory transactional SQLite adapter. Public fetches, R2 and mainnet RPC are mocked. Synthetic in-memory sign-in keys are unrelated to user wallets.
- Tests exercise proof/replay/expiry, public metadata and source hashes, opaque-image and quote substitution, retained stock quote, ownership mismatch, duplicate prevention, pre-send persistence, uncertain submission recovery, token/NFT stages, expiry-gated key replacement, safe abandonment and four deterministic concurrency races.

The full app suite started during the renderer transition was stopped at the parent's request; it is not final evidence. Root coordinates the frozen-source TypeScript/build, final full tests, public hosting, migration application and browser/wallet checks. No real signed transaction, relay request, wallet/private-key file read, remote resource creation or deployment was performed by this backend task. Real wallet funding, signed integration verification and the supplied domain's independent public deployment remain external prerequisites.
