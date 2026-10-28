# @mintdex/chain-sdk

TypeScript helpers for MintDex card program v2 on the real pump.fun (devnet, later mainnet), shared by the
node scripts in `chain/scripts`, the `mintdex-chain` Worker and the web app. Spec: `refs/chain/card-program-v2.md`
(revision 1) and `refs/chain/devnet-plan.md` (M1 task 4).

The main entry has no `@solana/web3.js`, Anchor or pump-sdk dependency (only `@noble/hashes` and `@noble/curves`),
so the browser can run the transaction verifier from a small lazy chunk. Addresses are base58 strings, amounts
are `bigint`. `@mintdex/chain-sdk/web3` converts instructions to and from web3.js.

| Module | What |
|---|---|
| `pda.ts` | MintDex PDAs (`config`, `["vanity", mint]`, `["card", mint]`, `["card-state", mint]`, `["card-mint", mint]`, bids, listings, escrow, vault WSOL ATA), pump PDAs (curve, creator vault, global, event authority, mayhem), PumpSwap PDAs (canonical pool, pool authority, coin-creator vault + ATA). `coinAddresses(mint)` returns them all. |
| `tiers.ts` | 14 designs, `TIER_MIN_USD_E6` (14 level minimums in micro-USD), the 13 Config thresholds, `mcapUsdE6`, `levelFor`, `liveLevel`, `levelMinMcapLamports`, devnet calibration ($118 × 100). |
| `market-cap.ts` | Curve and pool market cap (same results as pump-sdk `bondingCurveMarketCap` / `poolMarketCap`), plus `readMarketCap` with the program's §5.1 / §5.2 account checks. |
| `programs/pump.ts`, `programs/pamm.ts` | `mintdexCreateV2` (the only create_v2 a MintDex launch uses: creator = card vault, the pinned 11-byte zero flag tail, O3); hand-encoded `create_v2`, `buy`, `buy_exact_sol_in`, `sell`, `collect_creator_fee`, `migrate`, `extend_account`; pAMM `buy`, `buy_exact_quote_in`, `sell`, `transfer_creator_fees_to_pump`, `collect_coin_creator_fee`, `extend_account`; composites equal to the SDK's instruction lists; decoders. |
| `accounts/*` | Bonding curve, pump Global, Pool, GlobalConfig, token accounts, mints, Token-2022 TokenMetadata, Pyth PriceUpdateV2, address lookup tables. |
| `mintdex/*` | Instruction builders (27 instructions after the fix pack: `observe`, `set_observers`, `update_tier_config`, `set_config_ext`, `set_paused`, `init_collection`, `sync_card_metadata`, `sync_collection_metadata` added; `initialize` passes the pinned Pyth feed under a Pyth config), account decoders (Config @488..535 incl. `evolve_resumed_slot` @527, Card @212..223, `ObserverSet`); review round 2: `setPausedIx({ set, clear })` (masks, `paused = (paused | set) & !clear`) and `setObserversIx({ expectedEpoch })` (the live epoch the set was built from; error 6046 `ObserverSetChanged` otherwise, shrinks excepted), events (with the §9 authenticity rule), config validation (`validateObserverSet`, `observerSetIsShrink`, `validateConfigExt`, `guardRulesOk`, `tierParamsFromConfig`, `tierFieldsDiff`), URIs, vanity residue, the MintDex ALT (38 entries + the 5 collection entries, `collectionAltExtension`). |
| `tx/wire.ts`, `tx/verify.ts` | Strict wire decoder (legacy + v0 + ALTs, signature checks; a v1 or newer envelope throws `UnsupportedTxVersionError`, O2) and `verifyTransaction(bytes, intent, options)`. |
| `cluster.ts` | Per-cluster profile (`DEVNET_PROFILE`, `MAINNET_PROFILE`, `clusterProfile`, `clusterOfGenesis`): genesis, program id, measured Metaplex creation fee, fresh curve size, the indexer's maximum transaction version and its v1 probe; `clusterAltAddresses` (the 43-entry layout). |
| `fees.ts`, `evolve.ts` | Sale splits and the withdrawable breakdown (§8); a line-by-line mirror of the fix-pack evolve state machine (attested `Who` open / count / cap, the ignore rule, epoch restart, witness bits, the F2 listing-pause mark, `listingVoided`, `listingPausedUntilSlot`), tested with the program's vectors (`test/evolve.test.ts`). |
| `programs/pyth.ts` | Posting a Hermes update to the sponsored push-oracle feed (PNAU accumulator parser, Wormhole encoded-VAA create / init / write / verify / close, `update_price_feed`, `pythPostPlan`: three transactions), checked against the Pyth SDK's own builders (`test/pyth.test.ts`). |

## MintDex IDL drop-in

MintDex encoders use the program's own IDL: `idl/mintdex.json` (synced from `anchor build` of program v2 on
2026-10-03, 18 instructions including the market). The hand-written placeholder (`src/mintdex/spec-idl.ts`) is the
fallback and the spec-side reference; it mirrors the program, and `test/mintdex.test.ts` fails on any drift in account
names, order, flags, args, types, discriminators or error codes. After every program change and `anchor build`:

```bash
cd chain/sdk && node scripts/sync-idl.mjs && npm test
```

`sync-idl.mjs` refuses anything that is not the v2 program (the v1 IDL lives at the same path), writes
`idl/mintdex.json` and `src/mintdex/idl.generated.ts`, and the builders switch to it. If the program's account
names or order differ from the spec, the builders throw on unknown or missing names and
`test/mintdex.test.ts` lists the drift. `setMintdexIdl(idl)` swaps the IDL at runtime.

## Verifying a transaction before the wallet signs

```ts
import { verifyTransaction, coinUri } from "@mintdex/chain-sdk";

const result = verifyTransaction(txBytes, {
  kind: "launch", payer: wallet, mint, name, symbol, uri: coinUri(mint), treasury: config.treasury,
  devBuy: { minTokens, maxSolCost },          // from what the user typed, not from the Worker's summary
}, { lookupTables: { [altA]: altAddresses }, allowedLookupTables: [altA, altB], requirePresignedBy: [mint] });
if (!result.ok) throw new Error(result.errors.join("; "));
```

Intents: `launch`, `pump_buy`, `pump_sell`, `pamm_buy`, `pamm_sell`, and `exact` (the client builds the expected
MintDex instructions itself, for withdraw, bids, accept, list, delist, buy now). Fetch lookup tables and the
Config / pool accounts from an RPC you trust, not through the Worker being checked.

## Seller fee floor (card-program-v2 §18.9)

`accept_bid` takes `minFeesToSeller` and `list_card` stores one in the listing for `buy_now`. A sale that would pay the
seller less accrued fees than the floor fails with `FeesBelowFloor` (6035). Set it with `sellerFeeFloor(balances)`
(= `withdrawableBreakdown(balances).total`), filling `vaultWsolAccountLamports` from
`getTokenAccountsByOwner(card_vault, { mint: WSOL })`, and pass the same accounts (except the vault's own WSOL ATA) as
the sale's extra WSOL accounts. If the sale fails with `FeesBelowFloor`, refetch the vault-owned WSOL accounts and
rebuild: a counterparty moved the AMM fees into an account the transaction did not include. A buyer's client should
always pass every vault-owned WSOL account too. `0` means no floor.

## Tests

```bash
cd chain/sdk && npm test          # node:test on Node ≥ 22.18 (native TypeScript)
npm run typecheck                 # uses chain/node_modules/typescript
node scripts/fetch-fixtures.mjs   # refresh the read-only devnet fixtures (never signs or sends)
```

Byte-equality with `@pump-fun/pump-sdk` 2.0.0 and pump-swap-sdk 1.20.0, real devnet transactions from the
facts run (re-encoded byte for byte, signatures verified), Anchor `BorshCoder` cross-checks of the IDL engine,
and doctored-transaction cases for the verifier (C8).
