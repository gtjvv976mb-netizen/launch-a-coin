# Launch a Card — pump.fun and creator NFT integration

`src/live.ts` prepares real Solana mainnet transactions for a pump.fun token and its separate creator-owned Metaplex Core NFT. Wallet Standard supplies the creator signature; the browser also creates and signs the new token/asset identities without uploading their private keys. This package never generates a creator signature or holds wallet keys. App activation requires production persistence, public artwork/metadata, mainnet RPC and an explicit live-enable setting.

Pinned dependencies: official Pump SDK **4.1.0**, PumpSwap **2.1.0**, Core **1.10.0**, Umi **1.6.0**, web3.js **1.99.0**. The lockfile pins the resolved tree. Install scripts are disabled; native bigint uses its JavaScript fallback.

## Server interface

All functions accept an injected connection from `createMainnetConnection(rpcUrl)`, keeping RPC credentials on the server.

- `prepareTokenTransaction(input, {connection})` revalidates mainnet, the exact reviewed quote, decimals/program, admission and new mint. Optional atomic initial buys use fresh reserves/fees, exact quote base units and integer basis-point minimums. Custom buys require sufficient unfrozen quote balance. Complete unsigned transactions are simulated before wallet review.
- `validateSignedWalletTransaction(plan, transactionBase64)` checks the exact message, payer, signer set and all Ed25519 signatures. It returns the deterministic signature and unchanged bytes.
- `sendSignedWalletTransaction({plan, transactionBase64}, {connection})` is the authenticated server relay. **The caller must atomically persist the signature and exact signed bytes first.** It checks mainnet, expiry, existing status and signed preflight. Transport uncertainty returns the same signature; retries never rebuild or re-sign it.
- `verifyTokenLaunch(input, {connection, signature, expectedMessageSha256})` independently verifies finality, successful execution, exact Pump creation/optional buy, mint/curve owners, creator, quote and token metadata.
- `prepareCreatorNftTransaction(input, {connection, tokenSignature, tokenMessageSha256})` requires fresh finalized token verification, then prepares one Core asset owned by the creator. Creation and permanent metadata authority removal are atomic. Its sole plugin is immutable binding Attributes; there is no Royalties plugin or collection. A matching existing asset returns `already-created` instead.
- `verifyCreatorNft` and `recoverCreatorLaunch` verify the existing Core account even without a known NFT signature. Recovery distinguishes token pending, token created/NFT pending and complete.
- `assertNftMintReplaceable` / `assertTokenMintReplaceable` require finalized expiry and an absent old mint. The expiry height and slot come from one finalized epoch bank; the subsequent absence read must meet that minimum context slot. The server must also atomically compare the checked intent and complete prepared-plan set after RPC verification.

`LiveLaunchInput` extends the base creator/mint/name/symbol/metadata/quote/card input with `nftMint`, optional `nftName`, initial-buy atoms, slippage, and required live commitments `renderedCardSha256` / `nftMetadataSha256`. Reviewed source-art hashes are checked against all 96 approved WebPs.

Plans contain an unsigned v0 wire transaction without lookup tables, exactly two signer public keys, message hash, blockhash/expiry, stable launch binding, decoded summary and wallet costs. Costs show network/priority/rent-program components, total simulated SOL debit, optional quote spend and minimum six-decimal token output. A small reserve buffer is shown separately. The binding excludes the ephemeral Core address so a safely expired, unissued key can be replaced without changing approved metadata.

Some atomic custom-quote create/buy transactions exceed Solana’s 1232-byte packet limit. Freshly verified existing ATA setup is omitted when safe, and metadata URLs are kept short. Oversized transactions fail explicitly; callers can choose an initial buy of zero. The adapter never silently removes a buy. Stock quotes do not give the creator token or NFT company-equity rights.

## Verification

```sh
bun install --frozen-lockfile --ignore-scripts
bun test tests
bun run typecheck
```

**24 tests / 421 assertions and TypeScript pass.** Checks cover all 16 quote identities, all 48 designs, all 96 source hashes, positional accounts, live buy inputs/minimums, simulation and packet failures, immutable Core state, signatures, retry uncertainty, context-bound expiry/absence and separate-stage recovery. Synthetic signing/relay tests use a fake blockhash and mock-only RPC. Actual SDK plans pass the app’s independent browser verifier for all 16 quotes and Core issuance.

Separate **unsigned mainnet program simulations** passed at slots 462361248 (TSLAX token create, 1011 bytes) and 462361249 (Core create/authority removal, 885 bytes). Deserialized Core state confirmed creator ownership, both immutable authorities, six binding attributes and no Royalties plugin. These were independent simulations: no token/NFT was issued, no wallet prompt was used and nothing was sent. Evidence is retained under `output/research/pump-custom-pairs-2026-10-28/`; `scripts/readonly-simulation.ts` performs only public reads and unsigned simulations.

The older instruction-only helper remains in `src/index.ts`. See [research](../../reports/pump-custom-pairs-research-2026-10-28.md), [verified assets](../../reports/pump-pair-assets-2026-10-28.json), and [boundary audit](AUDIT-2026-10-28.md). Official references: [Pump creation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COIN_CREATION.md), [Core creation](https://www.metaplex.com/docs/smart-contracts/core/create-asset), [Core immutability](https://www.metaplex.com/docs/smart-contracts/core/update).
