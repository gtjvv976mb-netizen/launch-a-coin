# Launch a Card

Independent project based on MintDex, publicly branded **Launch a Card** at **https://launchacard.fun**. The recoverable folder and internal carddex identifiers remain stable. Creators choose one permanent premium card design for their token and its one-of-one NFT trading card. The token launch provider is **pump.fun**.

## Included

- 48 creator-selectable designs: eight trading-card classics, 14 premium material designs, 20 limited editions and six dedicated stock-reference designs.
- Matching text-free Higgsfield front/back artwork for all 48 designs, with the creator's token image and live card content composed above the frame.
- One shared MintDex card template: every design uses the same artwork, name, ticker, description, statistics and footer positions. Only frame art, material, foil and matching reverse change.
- Card-first compact launch form, one full 3D preview, artwork upload, token metadata and disclosed optional initial buy.
- Observed OHLC candlestick charts with quote-native units, UTC ranges and touch/keyboard inspection.
- Local pump.fun-style token curve, buys/sells, charts, activity, holdings and NFT card collection.
- Existing rounded 3D slab, both-face 360° shimmer, touch rotation, viewer and case.
- Fixed designs: market cap never changes the selected design.
- Six premium stock finishes and their matching limited editions select reviewed pump.fun tokenized-stock quotes. DOGE, BONK and WIF finishes also select their matching quote. Neutral finishes can explicitly select any of 16 reviewed assets. Historical coins keep their stored quote, including SOL.
- Exact quote mint, decimals and token program persist with the permanent design. Local launches, buys/sells, balances, fees, charts and portfolio values use the selected asset's units; stock/memecoin quantities are not treated as SOL or given an invented USD price.
- No NFT sales, listings, bids or royalties. Removed endpoints reject before database writes; SQL triggers provide another boundary.

The interface retains MintDex's original composition, desktop navigation rail and compact phone navigation. Launch has token details on the left and a full preview on the right. The current Launch a Card chrome uses a Pokémon-card-inspired gold, cream, charcoal and scarlet palette, with no blue chrome. Individual card artworks retain their own themed colors. Stock quotes add wordless market engraving while retaining the common print grid. The current brand mark is a wordless gold-foil trading card and crown, without a letter or CD monogram.

## Run locally

Requires Node22+, Bun and Chrome for optional QA.

```sh
cd integrations/pumpfun
bun install --frozen-lockfile
cd ../../app
bun install --frozen-lockfile
bun run dev
```

This builds the Worker, applies **local-only** D1 migrations and starts the local preview at **http://127.0.0.1:5310**. Subsequent starts can use `bun run preview`. Runtime state is inside ignored `app/.wrangler/`. Test accounts use an independent `carddex_session` cookie.

```sh
bun test tests/chain tests/carddex
bun run build
```

`bun run build` waits for both TypeScript and Vite, and compares shared source/config/asset fingerprints before and after the client/SSR build. Finish edits before building; an input change rejects the build so mixed client/server output is not treated as ready. Ensure Bun is on the shell's PATH. In this workspace the helper can also be invoked directly with `~/.bun/bin/bun scripts/build.mjs`.

See `HANDOFF.md` and the dated reports for the latest build/test counts and browser evidence. The local database must have all migrations applied before starting the current preview.

## Current status and real pump.fun launches

The default `/launch` route is the **real creator-wallet flow**, with an explicit **Test demo** option. Real actions fail closed locally until this platform has durable public storage, a mainnet RPC, wallet authentication and an enabled production deployment. The directory, portfolio and token trading catalogue remain clearly marked demo; they do not invent on-chain balances. Both inherited `VITE_MINTDEX_MODE` and `VITE_CARDDEX_MODE` activation remain rejected. The new wallet integration is separate from the inherited MintDex program.

`integrations/pumpfun` uses the pinned official pump.fun SDK to prepare a complete create_v2 transaction with the selected admitted quote and optional exact-amount initial buy. It revalidates mainnet genesis, quote admission, mint/program/decimals, balances, rent and fresh transaction simulation. Native SOL and 15 custom quote assets are supported subject to current on-chain admission and packet limits. A requested initial buy is never silently dropped.

The browser generates ephemeral token/NFT signers in memory, authenticates wallet ownership with a labelled message, and checks the exact immutable transaction before wallet approval. The server validates every signature and the exact prepared bytes, simulates and relays those same wallet-signed bytes. Token finalization is independently verified before a separate **Metaplex Core NFT** transaction is prepared. The NFT is owned by the creator, has immutable metadata and binding attributes, and has no royalties plugin. Durable intents, concurrency guards and recovery prevent an interrupted NFT stage from creating another token or duplicate NFT.

The trusted server image composer uses the same canonical card layout and preflattened approved skins, actual creator artwork and a premium rounded case. Content-addressed public metadata binds creator, token mint, quote mint, design, original frame/back hashes and rendered image hashes. Client-provided finished images cannot qualify as an attested composition.

No real transaction was signed or submitted. Public-mainnet read-only simulations verified create_v2 and Core creation against the actual programs. These are simulations, not completed token/NFT issuance. A first owner-approved launch is still required after public deployment.

The domain currently remains on registrar parking DNS. No production resources, DNS updates or deployment occurred. Follow [the public readiness checklist](reports/launch-a-card-public-readiness-2026-10-28.md) and review `app/wrangler.production.example.jsonc`; it is disabled with an intentionally invalid D1 placeholder. Create this platform's own D1/R2 resources, never MintDex resources.

Current provider reference, reviewed 28 October 2026: [official pump.fun coin creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md). Historical accounts and fees are not assumed current.

## Generated assets

The approved Higgsfield work produced 99 completed images: 96 card faces, two website visuals and one logo that the owner rejected. The quoted total was 272.25 credits; the tools did not provide an itemized actual-charge reconciliation. No paid regeneration was submitted. The current logo is a separate native vector refinement, created without further generation spend; the rejected generated logo is retained in `brand/logo/archive/`.

83 trusted flattened PNG skins for 48 designs and their admitted stock variants live in `app/public/assets/carddex/render/`, pinned in `render-assets.json`. Regenerate them with `bun scripts/prepare-card-skins.ts` (Python/Pillow and Playwright CLI required); this performs lossless local rendering without paid generation. Card WebPs and 320px previews live in `app/public/assets/carddex/higgsfield/`. `creative/higgsfield/` retains the indexed prompts, provider job IDs and verification ledger. Unchanged original card PNGs and diagnostic contact sheets are retained under ignored `output/higgsfield/`. Website concepts generated before the final palette decision are references, not authority to change the retained MintDex layout.

## Sources and QA

Forked from tracked MintDex commit `1c3a567cfe017d73039a5b6fae45def15e18a62d`; MintDex uncommitted work was excluded. See `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md`, `reports/carddex-build-2026-10-28.md` and the quote-pair reports for scope and verification. The reviewed assets are recorded in `reports/pump-pair-assets-2026-10-28.json`; production must revalidate them at preparation time.
