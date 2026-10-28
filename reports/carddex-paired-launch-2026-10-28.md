# CardDex paired launch implementation

28 October 2026 · independent local CardDex project.

## Result

Premium stock and selected memecoin finishes now carry an immutable launch quote. Ten stock-bound finishes select GMEX, TSLAX, NVDAX, AAPLX, MSTRX, COINX or AMC. DOGE, BONK and WIF finishes select their matching reviewed quote. Other finishes explicitly support the full sixteen-asset catalog. All fronts retain the same MintDex content geometry; stock quotes add wordless market engraving, and the approved premium artwork and reverses remain unchanged.

Launch shows `creator ticker / quote symbol`, exact mint, issuer and terms before creation. Changing an incompatible bound quote opens a compatible-finish choice and blocks button/keyboard creation until confirmed or cancelled. Selecting a new asset clears an initial buy entered in the old unit. The desktop details-left/full-preview-right composition and Full motion default remain.

The local simulator uses separate atomic-unit balances, reserves, fees, history and portfolio values for each asset. The native 0.02 test-SOL demo launch fee stays separate from custom-quote initial buys. Unpriced stock/meme quotes have no invented SOL or USD conversion. Lifetime/24h volume, fee accumulators and portfolio atom totals use exact decimal strings and BigInt, including totals beyond JavaScript safe integers and SQLite aggregate limits. This implementation does not reinterpret old SOL coins based on their skin.

## Pump.fun integration boundary

Primary-source research and public mainnet account reads confirmed the catalog's exact mints, decimals, owning token programs and current quote admission. See `pump-pair-assets-2026-10-28.json` and `pump-custom-pairs-research-2026-10-28.md`. The Apple mint is authoritative; Pump's table spells its symbol APPLX while on-chain metadata is AAPLx.

`integrations/pumpfun` prepares a reviewed official-SDK 4.1.0 unsigned create_v2 instruction with the selected quote. It checks fresh mainnet admission and mint state, applies the app's design/pair policy, and binds approved frame hashes. All sixteen quotes and forty-eight designs are tested. A real read-only TSLAX preparation succeeded at confirmed slot 462350972 with twenty instruction accounts. Nothing was signed or sent.

The app remains an isolated local simulation. The preparer is a separate module, not an activated wallet flow. Production still needs public metadata/artwork content verification, complete transaction construction/simulation and wallet review, confirmed creation verification, the creator's separate NFT issuance and duplicate-safe recovery. Tokenized-stock pairing does not make the creator token or NFT company shares. See the integration README for exact limitations.

## Verification

- TypeScript and the source-guarded client/SSR build pass. All 113 app tests pass with 7,489 assertions; eleven adapter tests pass with 337 assertions.
- Real local migrations 0009 and 0010 were applied to local D1 only. Regression tests exercise all sixteen quotes through launch, edit, buy, sell and portfolio reads, invalid mint/design rejection, legacy SOL backfill and immutable SQL guards. Large BONK round trips and fee/portfolio totals preserve exact aggregates without blocking sells.
- Playwright exercised all sixteen selections and responsive Launch/Levels at 1440, 768, 390 and 320 pixels. Exact pair, printed quote, initial-buy units, native fee separation, compatible-finish confirmation, cancellation, terms/mint wrapping and Levels-to-Launch navigation passed.
- Pending-change guards passed native Enter, requestSubmit and blocked-button paths at 1440 and 320 pixels. Confirm/cancel restores creation correctly; changing finishes clears stale proposals.
- Actual local TSLAX and DOGE artwork-upload → launch → buy → sell → portfolio flows passed. A TSLAX buy debited exactly 0.25 TSLAX; a DOGE buy debited exactly 0.5 DOGE. Native test SOL changed only by the separate launch fees. Mixed portfolio values remain grouped in TSLAX and DOGE, and a fresh read retains the stock quote.
- A real visual check found wrapped phone trade caps and a duplicate portfolio change indicator. Final display polish fixed both. At 390/320/1440 pixels, all tested trade rows stay 34 pixels high without wrapping/clipping, with no horizontal overflow. Full motion remains enabled. The USDC chart baseline now uses its own initial quote parameters.
- No runtime errors, broken decoded images or failed first-party responses were found in final checks. Chromium emitted existing unused-font-preload warnings; these were not application runtime errors. Phone checks used browser emulation, not physical hardware or sensors.

Detailed frontend and accounting reports: `carddex-paired-quote-ui-2026-10-28.md` and `carddex-quote-accounting-2026-10-28.md`. Local screenshots/results/logs are under `output/playwright/carddex-pairs-2026-10-28/` and `output/playwright/carddex-2026-10-28/`. Public research snapshots are under `output/research/pump-custom-pairs-2026-10-28/`.

No paid generation, public deployment, account change, real transaction or NFT issuance occurred. MintDex was not modified. Local preview: http://127.0.0.1:5310/launch?design=stock-tsla&quote=tslax.
