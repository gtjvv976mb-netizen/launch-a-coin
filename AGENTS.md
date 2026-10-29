> **DEPLOY NOTICE (28 Oct 2026, from the Claude session): read before any `wrangler deploy`.**
> PLDT (Philippines) blocks the two Cloudflare IPs of the launchacard.fun zone. The site is being moved behind
> Cloudflare for SaaS on the new zone **launchacard.com** (custom hostnames launchacard.fun + www, fallback
> `edge.launchacard.com`, Worker route `*/*` on zone launchacard.com). `www.launchacard.fun` is already a DNS-only
> CNAME to `edge.launchacard.com`.
> - `app/wrangler.production.jsonc` here now carries the phase-1 config (adds the `*/*` route on launchacard.com and a
>   `SELF` service binding) and `app/src/lib/carddex/live/assets.server.ts` reads own-origin assets via ASSETS/SELF,
>   because a routed Worker cannot fetch() its own zone. **Do not revert these four files** (also bindings.server.ts and
>   routes/api/live/health.ts). Deploying an older config would drop the route and, run non-interactively, overwrite the
>   www CNAME with a Custom Domain, putting the site back on the blocked IPs and breaking launch prepare.
> - After the apex cutover the two `custom_domain` routes must be removed from the config before any later deploy.
> - Production self-check: `GET /api/live/health?self=1` must return `{"ok":true,...}`.
> - Live version 947f7fc4 = your working tree of 70b4ec76 + this hotfix (branch `claude/prod-snapshot` in ~/code/lac-wt-prod).

29 October release follow-up: current Worker version is **6b453309-2236-4491-b93b-90504490d703**, adding 12 verified meme pairs while retaining 9709a88f's card-consistency fixes and 947f7fc4's SaaS hotfix. It was published with `versions upload`/`versions deploy` only; no triggers or DNS changed. The cutover warning above still applies. See `reports/launch-a-card-meme-pairs-expansion-2026-10-29.md` and the previous card-consistency release record before any later publication.

# Launch a Card (internal project: CardDex)

Read HANDOFF.md and README.md before work. This is an independent project forked from MintDex. Do not change or deploy MintDex.

Use the user-level web-design-workflow skill for frontend work. Preserve the rounded 3D card, both-face shimmer and touch controls.

Card artwork requirement (owner instruction, 29 October 2026): use **Higgsfield for all new and redesigned card artwork**, including fronts, backs, limited editions, stock/meme themes and custom card-based logos. Do not silently substitute built-in image_gen, another image provider, or code-drawn decorative artwork. Follow `creative/higgsfield/WORKFLOW.md` for matched references, the shared print template, provenance and visual checks. Deterministic content composition, responsive layout, exports and motion remain code responsibilities. Existing verified Higgsfield designs may be reused for supported pair presets; do not describe reuse as newly generated custom artwork. The provider preference does not extend any previously approved credit allocation.

Token GIF clarification (owner, later 29 October 2026): the **existing website card designs and thin turntable geometry are already approved**. Export those directly for the token GIF, with market cap removed from that image. Do not generate a thicker card, slab, case or replacement design for this export. The rejected Higgsfield motion study is retained only as provenance; it must not be installed or published. This is an export task using existing Higgsfield artwork, not authorization for further paid redesigns.

Product: token launches with one creator-selected NFT card design. No automatic evolution, NFT sales, bids, auctions or royalties. Token buy/sell trading remains. Designs must persist through launch, reads and token trades.

Default is isolated local simulation. Never sign transactions, move SOL, publish or deploy without specific authorization. No MintDex bindings, wallets, sessions, APIs or shared data. Never read private wallet/secret files or copy credentials.

App checks: `cd app && bun x tsc --noEmit -p . && bun test tests/chain tests/carddex && bun x vite build`. Use local-only D1/R2 for preview. The new pump.fun + Core wallet launch integration is separate from the inherited MintDex chain reference. It remains disabled locally; deployment readiness is documented in README.md. Never enable inherited MintDex chain mode.
