# CardDex

Read HANDOFF.md and README.md before work. This is an independent project forked from MintDex. Do not change or deploy MintDex.

Use the user-level web-design-workflow skill for frontend work. Preserve the rounded 3D card, both-face shimmer and touch controls.

Product: token launches with one creator-selected NFT card design. No automatic evolution, NFT sales, bids, auctions or royalties. Token buy/sell trading remains. Designs must persist through launch, reads and token trades.

Default is isolated local simulation. Never sign transactions, move SOL, publish or deploy without specific authorization. No MintDex bindings, wallets, sessions, APIs or shared data. Never read private wallet/secret files or copy credentials.

App checks: `cd app && bun x tsc --noEmit -p . && bun test tests/chain && bun x vite build`. Use local-only D1/R2 for preview. Chain source is an unconfigured integration reference; no chain deployment is active.
