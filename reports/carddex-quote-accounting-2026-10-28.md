# CardDex quote accounting — 28 October 2026

The local simulation now retains the selected pump.fun quote asset as an immutable identity separate from the card's fixed visual design and any stock-themed reference. This work does not enable wallet signing, token issuance, asset transfers or deployment.

## Persistence and validation

`app/migrations/0009_carddex_quote_assets.sql` adds `coins.quote_asset_key`, `quote_mint` and `peak_mcap_quote`. Existing records default to SOL and retain their existing reserves/history, including skins whose new-launch default is now a custom quote. An immutable SQL trigger prevents later quote key/mint changes. No existing curve is reinterpreted from SOL into a stock or memecoin asset.

The migration also adds independent `quote_balances` and `protocol_quote_fees` tables. Native test SOL remains in `users.balance`. Each non-native quote has its own safe integer atomic-unit wallet balance. First use grants local demo balances once with `INSERT OR IGNORE`; subsequent reads do not replenish spent balances. Migration 0010 changes accumulated protocol fees to canonical decimal text, preserving existing SQLite integer totals without a JavaScript-number conversion. Native fees share that exact ledger; the legacy native `meta.protocol_fees` row is kept in sync as exact text.

The server resolves launches through the shared reviewed registry and design allowlist. Unknown keys, substituted mints and incompatible bound designs become expected `UserError` responses before writes. Read/trade paths independently verify the stored key/mint against the registry and fail closed on a mismatch. They do not infer an existing coin's quote from its card skin.

Non-SOL trade clients must confirm the quote key; optional mint echoes must also match. Amounts and slippage bounds must be safe positive/non-negative integers as applicable. Decimal parsing rejects excess precision, exponent notation and integer overflow rather than rounding. Trade results and destination balances are checked against the safe integer range.

## Simulation units and fees

`app/src/lib/carddex/quote-simulation.ts` provides exact quote-unit parsing/formatting, reviewed-snapshot initial reserves, quote-native metrics and demo caps/grants. The existing constant-product integer math accepts the selected quote's atoms through the compatibility `vSol` reserve field; public responses expose that quantity explicitly as `vQuote`.

Initial reserve snapshots come from `pair-assets.json`, supplied with verification dates/slots by the parent task. These are recorded reference inputs, not fresh live curve estimates. Demo initial-buy caps are two-thirds of the initial quote reserve; demo start balances are ten-thirds, preserving the original 20-SOL cap and 100-SOL grant for SOL. The sixteen registered assets retain their actual decimals, mint and token program in responses.

The native 0.02 test-SOL **demo launch fee** is separate from an optional initial buy in another quote. It is not a live network-fee estimate. The local curve's 1% demo trading fee stays in the traded quote's fee accumulator. No creator fees, royalties or NFT marketplace financial states were reintroduced.

SOL uses the existing explicitly simulated USD reference of 150; USDC uses a demo reference of 1. Custom stock/memecoin assets receive no invented USD or SOL rate. These local references and curve fees do not claim to be current pump.fun production pricing or fee schedules.

## Read and mutation contract

- Quote identity: `quoteAssetKey`, `quoteMint`, `quoteSymbol`, `quoteDecimals`, `quoteTokenProgram`.
- Coin metrics: `tradingPair`, `priceQuote`, `mcapQuote`, `volumeQuote`, `volume24hQuote`, `valuationMode` and `vQuote` on details.
- Trade rows/results: explicit `quoteAmount`; results also expose wallet movement as `quoteNet`. Rows retain `priceQuote` and `mcapQuote`.
- Activity events: explicit quote identity and `quoteAmount`.
- Wallet: `me.quoteBalances`, keyed by quote asset and measured in that asset's atoms. `me.balance` remains native test SOL.
- Portfolio: `valueQuote` on each holding and `totals.holdingsValueByQuote` grouped by asset.
- Home statistics: `volumeByQuote` groups volume atoms by asset.

`AtomicAmount` is an explicit decimal-string type for analytics which may exceed JavaScript's safe integer range: coin `volumeQuote`/`volume24hQuote`, Home `volumeByQuote`, holding `valueQuote` and portfolio `holdingsValueByQuote`. Individual trade amounts, wallet balances and curve reserves remain checked safe integer numbers. Price and market-cap metrics are fractional estimates; legacy common SOL conversions remain approximate numeric analytics, not settlement amounts.

Lifetime and 24h volume are summed with BigInt from individual trade atoms cast to TEXT before crossing the D1 JSON boundary. There is no SQL `SUM` overflow, unsafe number accumulation or reliance on the deprecated `coins.volume` cache. The cache stops accumulating. Portfolio spot values use the integer reserve ratio and round once to an atom with BigInt; grouped totals preserve every rounded atom. A spot value is not a guaranteed liquidation payout. Protocol fee additions use guarded, retryable BigInt text updates in the same atomic batch, including native launch fees; no arbitrary cumulative-volume ceiling can block a sell.

For unpriced custom quotes, legacy SOL/USD compatibility fields are `null`: coin `priceSol`/`mcapUsd`/`volume`/`volume24h`, detail `vSol`, trade `sol`/`price`/`mcapUsd`, event `amount`, and holding `valueSol`. Combined legacy portfolio/home totals become `null` when a common conversion is unavailable. Stock and memecoin balances are never summed as raw SOL.

`tokenPair` remains the prior catalog stock-reference field; `tradingPair` is the actual launched token/selected-quote pair. Frontend consumers should use explicit quote fields for amounts and trading labels.

Inactive legacy chain adapters were updated with explicit SOL identities and null-safe compatibility shapes only. This does not activate chain routes or introduce custom-asset inference in old SDK records.

## Verification

- `bun x tsc --noEmit -p .` passed against the coordinated current source.
- `bun test tests/carddex/persistence.test.ts tests/carddex/quote-simulation.test.ts`: **33 passed, 0 failed, 1,693 assertions**.
- `bun test tests/chain tests/carddex`: **113 passed, 0 failed, 7,489 assertions**.

DB integration applies the real migrations to an in-memory transactional SQLite adapter. Every one of the sixteen quote assets is exercised through launch, description edit, buy, sell, coin/history reads and portfolio aggregation. Tests verify independent balances, quote/native fee separation, retained design/quote identity, null unpriced compatibility metrics, spoof/overflow rejection and immutable SQL guards. A migration test seeds the pre-0009 schema, applies 0009 and proves all old curves remain SOL even when a skin's current default quote differs.

Pure helper tests cover every asset's exact atomic precision, the largest safe integer, overflow/excess-precision rejection, tiny-value formatting, snapshot/grant/cap safety and absent custom-asset conversions. Existing canonical card, isolation, offline verifier and curve reference tests continue to pass.

Five additional DB regressions verify 65 complete BONK buy/sell round trips past MAX_SAFE_INTEGER, exact lifetime versus rolling volume, synthetic safe individual trade amounts whose aggregate exceeds SQLite's signed 64-bit `SUM` limit, fee accumulation beyond signed 64-bit, large atom-rounded spot values in a mixed SOL/USDC/BONK portfolio, and migration of 9,007,199,254,740,993 fee atoms without rounding. Sells complete normally; protocol totals, per-quote values and wallet movements remain distinct.

These reads scan the local simulation's trade history to obtain exact volume. A production indexer should maintain equivalent arbitrary-precision rolling aggregates rather than reuse this demonstration query strategy at unbounded scale. Migration 0010 preserves integer legacy fee rows; a previously corrupted REAL/scientific-notation amount intentionally fails its canonical-text check rather than invent lost atoms. No such corrupt data was observed or introduced here.

This agent did not apply the local runtime migrations or start the replacement build. Root is coordinating migrations 0009/0010, the source-guarded build and final desktop/phone flow verification. The separate unsigned pump.fun adapter is owned by the research task; real creation/NFT issuance remains unavailable until explicitly implemented and verified.
