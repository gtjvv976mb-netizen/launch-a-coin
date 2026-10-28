# CardDex pump.fun unsigned launch preparation

This isolated package prepares an unsigned **create_v2 instruction** using the official `@pump-fun/pump-sdk` **4.1.0**, with `@pump-fun/pump-swap-sdk` **2.1.0** pinned by override. It is not imported by the CardDex app and does not activate mainnet launches. It contains no wallet connection, private key input, signing, sending, storage upload, initial-buy transaction, NFT issuance or deployment capability.

The reviewed catalog contains 16 exact Solana pair mints. `preparePumpLaunchPlan` checks the mainnet genesis hash and fetches Pump Global, QuoteControl, the quote mint and the proposed new mint together at one confirmed slot. It rejects disabled creation, an already-existing new mint, removed/zero-reserve quotes, wrong Pump account owners, changed quote decimals/programs, and paused/uninitialized/default-frozen mints. The official SDK resolves that same snapshot and constructs the quote-aware instruction. Arbitrary pump-coin quotes and nested pair chains are intentionally excluded.

The adapter uses the app’s current design validation and design/pair binding. All 48 existing designs must also have a reviewed front/back entry in `src/design-assets.json`. The 96 hashes were copied from the approved asset ledger and verified against the actual WebPs; this manifest is checked in tests. Supplied hashes must match it. Any new design requires a reviewed manifest update.

```ts
import { preparePumpLaunchPlan } from "./src/index.ts";

const plan = await preparePumpLaunchPlan({
  creator: creatorPublicKey,
  mint: newMintPublicKey,
  name: "Example",
  symbol: "EXAMPLE",
  tokenMetadataUri: "ipfs://…/token.json",
  quoteKey: "tslax",
  card: {
    designKey: "stock-tsla",
    frontUri: "https://your-public-assets.example/stock-tsla-front.webp",
    backUri: "https://your-public-assets.example/stock-tsla-back.webp",
    frontSha256: approvedFrontSha256,
    backSha256: approvedBackSha256,
    nftMetadataUri: "ipfs://…/card.json",
  },
});
// Inspect plan.createInstruction, plan.binding and plan.requiredSigners.
// This has neither sent a transaction nor issued an NFT.
```

The returned frozen JSON object includes the exact instruction account list/data, quote identity, immutable design/art commitments, verification slot, signer public keys, and SHA-256 commitments. It carries `status: "unsigned-review-only"` and `nft.status: "not-issued"`. It is an instruction plan rather than a complete transaction; there is no blockhash, signature, balance check, total-cost estimate or buy quote. Artwork hashes commit the approved decorative source assets; the final card/NFT image still needs to be rendered with the token identity and verified against its metadata.

Before a production wallet flow can use this, rebuild from fresh state, enforce current issuer eligibility, verify the contents of the public metadata and artwork URIs against the commitments, construct/simulate the complete transaction and show costs for wallet review. On confirmation verify the created curve and quote mint; issue the creator’s separate NFT only after that confirmation, with duplicate prevention and recovery. A stock quote is a tokenized pair asset; neither the creator’s coin nor the NFT becomes company equity merely by using it.

```sh
bun install --frozen-lockfile --ignore-scripts
bun test tests
bun run typecheck
```

Tests use public mainnet account fixtures from confirmed slot 462348249 and generate no signatures or RPC traffic. They cover all 16 quotes, all 48 design bindings, complete positional quote accounts, metadata commitments, invalid/removed/mutated quotes and local metadata rejection. The native bigint add-on is deliberately not built by the script-disabled install; its pure-JavaScript fallback is used.

Validation: 11 tests / 337 assertions and TypeScript pass. A separate read-only call to the actual adapter prepared a TSLAX instruction against fresh mainnet slot 462350972: 20 accounts, exact reviewed quote, unsigned status and NFT not issued. It used public identities constructed without private keys; nothing was submitted. The earlier fixed test mint was correctly refused because its account already existed.

Research and exact catalog: [findings](../../reports/pump-custom-pairs-research-2026-10-28.md), [16 verified assets](../../reports/pump-pair-assets-2026-10-28.json). The official documentation recommends 4.1.0, while npm advertised 4.3.1 at installation time. This package deliberately preserves the reviewed 4.1.0 contract; a production integration needs a separate review of the current release and transaction simulation.
