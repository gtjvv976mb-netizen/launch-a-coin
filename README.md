# CardDex

Independent local project based on MintDex. Creators choose one permanent premium card design for their token and its one-of-one NFT trading card. The intended live token launch provider is **pump.fun**.

## Included

- 48 creator-selectable designs: eight trading-card classics, 14 premium material designs, 20 limited editions and six dedicated stock-reference designs.
- Matching text-free Higgsfield front/back artwork for all 48 designs, with the creator's token image and live card content composed above the frame.
- One shared MintDex card template: every design uses the same artwork, name, ticker, description, statistics and footer positions. Only frame art, material, foil and matching reverse change.
- Live token/card preview, artwork upload, token metadata, optional initial buy.
- Local pump.fun-style token curve, buys/sells, charts, activity, holdings and NFT card collection.
- Existing rounded 3D slab, both-face 360° shimmer, touch rotation, viewer and case.
- Fixed designs: market cap never changes the selected design.
- Stock references derive from the selected design. Eight designs reference GME, TSLA, NVDA, AAPL, MSTR, COIN or BB against SOL; they do not represent shares or equity backing.
- No NFT sales, listings, bids or royalties. Removed endpoints reject before database writes; SQL triggers provide another boundary.

The interface retains MintDex's original composition, including the card stage on the left, desktop navigation rail and compact phone navigation. The current CardDex chrome uses a Pokémon-card-inspired gold, cream, charcoal and scarlet palette, with no blue chrome. Individual card artworks retain their own themed colors. The current brand mark is a wordless gold-foil trading card and crown, without a letter or CD monogram.

## Run locally

Requires Node22+, Bun and Chrome for optional QA.

```sh
cd app
bun install --frozen-lockfile
bun run dev
```

This builds the Worker, applies **local-only** D1 migrations and starts the local preview at **http://127.0.0.1:5310**. Subsequent starts can use `bun run preview`. Runtime state is inside ignored `app/.wrangler/`. Test accounts use an independent `carddex_session` cookie.

```sh
bun test tests/chain tests/carddex
bun run build
```

`bun run build` waits for both TypeScript and Vite, and compares shared source/config/asset fingerprints before and after the client/SSR build. Finish edits before building; an input change rejects the build so mixed client/server output is not treated as ready. Ensure Bun is on the shell's PATH. In this workspace the helper can also be invoked directly with `~/.bun/bin/bun scripts/build.mjs`.

The final build and all 80 active tests pass. Browser checks cover desktop and phone layouts, search, launch fields, motion controls, stock references, and the local launch/trade/portfolio flow. See the dated build report for detailed evidence and physical-device limitations.

## Current status and real pump.fun launches

The working local build is **simulation**, with test SOL and demo NFT records. No real token or NFT is minted, and no funds are sent. Real launches are intentionally unavailable until CardDex has its own configured launch/NFT adapter and durable public artwork/metadata storage. Both inherited `VITE_MINTDEX_MODE` and new `VITE_CARDDEX_MODE` chain activation attempts are rejected at build time.

The production mechanism should create the fungible token through pump.fun’s current official SDK/instructions, then issue a separate NFT to the creator’s wallet whose metadata permanently binds the token mint to the selected design and rendered front/back. pump.fun creates fungible tokens, so token creation alone does not issue the NFT. Prefer existing NFT infrastructure without a royalty plugin; removing evolution and the custom marketplace avoids carrying MintDex’s entire on-chain program into this simpler product. Wallet review, current pump.fun compatibility, duplicate prevention, confirmed launch verification, NFT issuance recovery and permanent metadata all need production implementation and signed integration verification before enabling it.

Current provider reference, reviewed28October2026: [official pump.fun coin creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md). This project does not assume historic pump.fun account layouts or fees remain current.

No production Worker/account/route/database/bucket/program/wallet is copied. MintDex’s historical program is retained only under `reference/mintdex-chain`; `chain/sdk` supports offline verifier/math reference tests. Inherited MintDex URL strings remain in reference SDK metadata helpers, comments and hostname comparisons, but are not the simulation's API/RPC targets. No deployment has occurred.

## Generated assets

The approved Higgsfield work produced 99 completed images: 96 card faces, two website visuals and one logo that the owner rejected. The quoted total was 272.25 credits; the tools did not provide an itemized actual-charge reconciliation. No paid regeneration was submitted. The current logo is a separate native vector refinement, created without further generation spend; the rejected generated logo is retained in `brand/logo/archive/`.

Card WebPs and 320px previews live in `app/public/assets/carddex/higgsfield/`. `creative/higgsfield/` retains the indexed prompts, provider job IDs and verification ledger. Unchanged original card PNGs and diagnostic contact sheets are retained under ignored `output/higgsfield/`. Website concepts generated before the final palette decision are references, not authority to change the retained MintDex layout.

## Sources and QA

Forked from tracked MintDex commit `1c3a567cfe017d73039a5b6fae45def15e18a62d`; MintDex uncommitted work was excluded. See `HANDOFF.md`, `PRODUCT.md`, `DESIGN.md` and `reports/carddex-build-2026-10-28.md` for scope and verification.
