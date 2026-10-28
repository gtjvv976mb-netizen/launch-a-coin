# Pump custom pairs — 28 October 2026

Pump supports real quote assets for new fungible coins. Choosing a stock or meme card can therefore bind the token’s **actual quote mint**, rather than merely printing a stock reference. This does not make the new coin, card or NFT an equity share. The working CardDex app remains a local simulation; the separately implemented unsigned preparer does not sign, submit or issue an NFT.

## Verified sources and account evidence

- [Pump Supported Pair Assets](https://pump.fun/docs/custom-pairs), dated 9 October: exact Solana contract addresses, issuer/listing-provider terms, list-change rules and secondary-asset restrictions.
- [Official coin-creation instruction](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/COIN_CREATION.md), pinned to reviewed repository commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`.
- [Official pump-coin quote instructions](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md) and [current IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump.json).
- [Official SDK 4.1.0 registry artifact](https://registry.npmjs.org/@pump-fun/pump-sdk/4.1.0), inspected from its published source. Its package repository points to pump-fun. The GitHub SDK repository itself returned 404, so this report relies on the published artifact and public documentation, not a presumed accessible source repository.
- Direct, read-only [Solana mainnet RPC](https://api.mainnet-beta.solana.com) account reads: confirmed mint slot `462347454`, additional meme/base mint reads, Global/QuoteControl slot `462347736`, and combined integration fixture slot `462348249`. Raw/decoded evidence is retained under ignored `output/research/pump-custom-pairs-2026-10-28/`; the compact public account fixture is tracked in `integrations/pumpfun/tests/fixtures/`.

Pump Global is `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`, and QuoteControl is `6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP`. Both owners matched the Pump program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Creation was enabled, USDC was globally whitelisted, and QuoteControl contained 224 entries. All reviewed custom assets below were directly present with positive starting reserves. Current admission and reserves must be fetched again before any real launch.

## Selected assets

The complete machine-readable identity, mint, decimals, owner, issuer terms and verification slots are in [pump-pair-assets-2026-10-28.json](pump-pair-assets-2026-10-28.json). This catalog is intentionally smaller than Pump’s full list.

| Assets | Decimals | Mint program |
| --- | --- | --- |
| SOL | 9 | SPL Token (wrapped-SOL mint; create uses native SOL semantics) |
| USDC | 6 | SPL Token |
| GameStop, Tesla, NVIDIA, Apple, Strategy and Coinbase xStocks | 8 each | Token-2022 |
| AMC tokenized equity | 6 | Token-2022 |
| DOGE, Sunrise Solana representation | 8 | SPL Token |
| Fartcoin, Pnut, MOODENG, TROLL, WIF | 6 each | SPL Token |
| BONK | 5 | SPL Token |

The Pump table spells Apple’s symbol `APPLX`; the exact listed mint’s on-chain metadata says `AAPLx` / “Apple xStock”. CardDex uses `AAPLX` for display and the exact verified mint for identity. DOGE is the listed Sunrise Solana representation, not an address on Dogecoin’s native network. BlackBerry, Nokia, PEPE, SHIB, POPCAT, Binance and Kraken did not appear as assets in the reviewed public list, so their artwork must not imply an available stock/token quote.

The xStocks issuer is Backed Assets (JE) Limited; AMC’s issuer is Backpack Securities, with Sunrise as listing provider. Pump requires applicable issuer/listing-provider terms and eligibility before use, and may change asset support. The preparer records these links; it does not determine a user’s eligibility. See [Pump terms, Section 30A](https://pump.fun/docs/terms-and-conditions), [xStocks terms](https://xstocks.fi/documents/xstocks-terms-of-service.pdf), [Backpack legal documents](https://support.backpack.exchange/legal/general-legal/user-agreement), and [Sunrise terms](https://sunrise.xyz/terms-of-service).

## Implementation contract

Official SDK `PUMP_SDK.createV2Instruction` accepts `mint`, `user`, `creator`, `name`, `symbol`, `uri`, `mayhemMode`, `quoteMint`, `quoteTokenProgram`, optional fee/reward flags and optional `pumpQuote` accounts. It returns a `TransactionInstruction` and does not sign or send. New coins use Token-2022 and six decimals. The name/symbol/URI documented limits are 32/13/200; the preparer conservatively limits UTF-8 bytes.

For a non-SOL listed quote, SDK 4.1.0 appends four positional accounts after the 16 fixed accounts: quote mint; writable new curve quote ATA derived under the quote’s owner program; quote token program; QuoteControl PDA. The general coin-creation table describes the first three, but the SDK and pump-coin documentation include the fourth. `OnlinePumpSdk.resolveQuoteMint` resolves the owning program, decimals, admission source and starting reserves from live accounts. The preparer uses it against one atomic public account snapshot and rejects drift from the reviewed mint identity.

Official developer documentation says existing pump coins may themselves be used as quote mints to depth two, and live Global agreed with `max_curve_depth = 2`. Its rules exclude mayhem coins, require live curve/pool accounts down the chain, and reject completed curves awaiting migration. The public user terms/list still describe only one secondary hop. This discrepancy is unresolved. The current CardDex catalog therefore permits only directly listed assets, and does not offer arbitrary mint entry or nested pump-coin quotes.

## Integration delivered and remaining scope

`integrations/pumpfun` pins the reviewed SDK, revalidates mainnet accounts, enforces the app’s design/quote binding, verifies front/back hashes against all 96 approved WebPs, and returns a frozen unsigned instruction plan with quote/design/art commitments. Its offline tests cover all 16 assets and all 48 designs. It does not modify or reuse MintDex’s SOL-only SDK, sign transactions, send funds, enable production, fetch private files or deploy anything.

Validation: 11 tests pass with 337 assertions; TypeScript passes. A separate read-only live adapter call at slot `462350972` successfully returned a TSLAX create instruction with all 20 accounts and `nft.status: not-issued`. Its public identities were constructed without private keys, and no transaction was submitted. An earlier fixed test mint correctly triggered the existing-account guard. Evidence: `output/research/pump-custom-pairs-2026-10-28/adapter-live-readonly.json`.

The package’s output explicitly says `unsigned-review-only` and `not-issued`. Real activation still requires public metadata content verification, final rendered NFT artwork, costs/balance/eligibility review, complete-transaction simulation, creator/new-mint signatures, confirmed quote verification, separate NFT issuance and retry/duplicate recovery. Pump creates a fungible coin; it does not automatically create CardDex’s separate NFT.

The public documentation recommends SDK 4.1.0, whereas npm advertised 4.3.1 during installation. The adapter deliberately pins 4.1.0 and is not described as production-ready. Future signing work must review the current package/program contract and simulate against current state. No paid generation, real launch, account change or deployment was performed.
