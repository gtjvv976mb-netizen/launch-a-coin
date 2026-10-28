# Launch a Card wallet interface — 28 October 2026

The new `/launch` default is a separate Solana mainnet wallet flow. The explicit `mode=demo` option retains the isolated simulation. This implementation does not activate the inherited MintDex chain integration.

The original token-details-left/card-preview-right composition, phone miniature, permanent design selection, paired quote controls and 3D turntable remain. The mainnet screen has its own Wallet Standard connection, accurate mainnet note and ownership guide. Demo balances and simulated activity are not presented as live funds or activity on that screen. Artwork is prepared locally without a simulation account or upload request.

## Creator flow

1. Add token details and artwork, choose the permanent design and exact quote mint, and acknowledge mainnet transaction terms.
2. Connect a Wallet Standard account that supports Solana mainnet and message/transaction signing. Ownership proof signs the server's exact domain-bound message; it moves no funds.
3. Compose trusted public card assets and prepare the exact token transaction. The form and finish lock to the resulting immutable intent. Review actual SOL network/priority/program costs, any separate quote spend and the minimum token output.
4. Explicitly continue to the wallet's own review. The browser partially signs only the new token asset with its ephemeral key. It rejects a changed message, missing creator signature or modified partial signature before calling the authenticated relay.
5. Verify finalized token creation. A separate explicit review then issues the one-of-one Core card NFT to the same creator wallet, with no royalty plugin and permanently removed metadata update authority.
6. Show verified pump.fun, Solscan token/transaction and NFT/metadata links. No simulation coin is substituted for a real success.

## Recovery

Only public intent IDs are stored in browser storage. New asset seeds stay in page memory and are cleared after their stage completes or the view closes. Reload recovery uses the creator's authenticated intent and restores its actual name, artwork, mint, quote and finish into the locked preview.

A token-created/card-pending launch proceeds to card issuance without creating a second token. An unissued NFT key can change only through the server's independently verified expiry/absence boundary. An unused prepared token draft can be discarded only after the server verifies all relevant blockhashes expired and the token is absent. Uncertain submissions direct the creator to confirmation/recovery rather than a new token attempt.

## Verification before browser pass

Nine pure client tests pass with 47 assertions, without any RPC or wallet. They cover exact u64 quote parsing, invalid monetary inputs, network/creator/signer/quote/binding mismatches, priority-fee binding, unchanged wallet-returned messages, partial-signature preservation, exact Pump create metadata and Core immutable card attributes, and ephemeral seed clearing.

The SDK agent independently tested all 16 emitted token quote plans plus a Core NFT plan against the browser operation verifier. The mainnet adapter and backend retain their own checks and tests. The coordinated guarded client/SSR build, full app suite and Wrangler dry run passed, as recorded by the root task. The final browser pass follows.

Actual wallet approval, spending and public mainnet launch were not performed by the assistant. Wallet rejection/network/account-switch states are implemented; real wallet/device validation remains a creator-operated release check. No deployment was performed by this UI task.

## Final browser verification

An isolated headless Chromium session checked the rebuilt `/launch` at 1440, 768, 390 and 320 CSS pixels. Actual screenshots were inspected, including the 320px wallet sheet and both faces of the full-screen card case.

- Default/mainnet mode shows the mainnet wallet note and actual TSLAX identity, without demo balance or activity. Readiness blocks review until the separate production public origin/storage and server-only RPC are configured.
- Local artwork selection updates the canonical preview without requiring a simulation account, opening a signing prompt or making any write request. No simulated market cap is invented; the unlaunched card says “At launch.”
- An incompatible DOGE change requires explicit compatible-finish confirmation. Enter while pending opens no account or wallet flow. Confirmation updates quote and finish together.
- The explicit Test demo switch preserves the selected quote/finish and displays “Demo collection · Balances and trading are simulated.” Its separate test-only form remains reachable.
- Automatic turntable rotation changed from 8.28° to 22.56° in the sampled interval. Pause held an identical pose, Resume advanced it, and Turn over reached 179.94° smoothly.
- The phone inspector opens, flips, closes and returns focus to its preview button. “Launch a Card” and the `1/1` plate have clear separation on both faces at 320px. The wallet picker fits the phone viewport.
- Final copy correctly says the live description is printed permanently and must be reviewed before signing. The former edit-later promise is absent in live mode.
- No horizontal overflow, runtime/console errors or failed first-party responses were observed. The functional UI pass recorded zero write requests. Full motion remains selected with Calm off. The isolated browser was closed after verification.

Evidence is under `output/playwright/carddex-2026-10-28/`:

- `live-launch-ui.json`, `live-motion-ui.json`, `live-final-readback.json`
- `live-launch-1440.png`, `live-launch-768.png`, `live-launch-390.png`, `live-launch-320.png`
- `live-turntable-back-1440.png`
- `live-final-inspect-front-320.png`, `live-final-inspect-back-320.png`, `live-final-wallet-320.png`

The readonly browser pass does not establish successful real wallet signing, spending, provider confirmation or NFT marketplace indexing. Those remain creator-operated release checks after production readiness. No real launch, transaction submission or deployment occurred in this UI session.
