# Viewport creation flow — 28 October 2026

Scope: the Launch a Card creation screen, shared opt-in quote/turntable viewport behavior, wallet connection and exact transaction review. No backend transaction construction, verification, signatures, broadcasting, funding or activation changed.

| Before | After | Why |
| --- | --- | --- |
| One long creation form and phone preview above it | Eight explicit field steps; desktop details/card split; phone Card / Token details views | Every field and the complete animated card have their own viewport space. |
| Expandable quote details and finish-change confirmation accumulated in the form | Opt-in Pair / Mint / Terms pages; pending quote confirmation replaces the selector body | Exact quote identity and issuer links remain available without nested scrolling. |
| All wallet, launch, recovery and status information stacked | Separate Launch, Transaction terms, Recovery, Saved launch details and Status pages | Loading, saved intent recovery and provider errors remain accessible. |
| Exact transaction review was a single scrolling dialog | Five ordered review pages; full wallet/mint/quote addresses, all cost components, totals, initial buy and minimum output retained | Wallet review appears only after the preceding review pages are visited. |
| Arbitrary-length errors and wallet/intent lists could grow | Complete error messages use 180-character pages; wallet and saved-intent lists show two per page | Long content remains reachable without truncation. |
| Full card turn could project outside its viewport | Opt-in per-instance turn arc scale 0.2 and camera 4000px; angle and both-face lighting retained | The entire 360° object can fit its reserved stage. Shared default is reset to 1 on cleanup. |

All fields/components remain mounted while navigating steps, preserving draft values, ownership and in-memory ephemeral-key recovery state. Invalid submission selects and focuses the relevant field step. The platform still requires the user to approve ownership and payment prompts in their wallet. No real wallet approval or transaction has been performed by this work.

Static checks: full app TypeScript and scoped git diff whitespace checks pass. Impeccable's scoped mechanical detector returned an empty findings array. The parent's coordinated guarded build and 169-test / 8,612-assertion suite passed after the final repair batch.

## Rendered checks

Actual final local bundle, without injected CSS: 69 measured states passed at 1440×900, 1280×720, 768×1024, 390×844 and 320×640. This covers every one of the eight field steps, all five wallet section pages, quote Pair / Mint / Terms views, and incompatible quote confirmation. Document width/height and every creation body stayed within its viewport; no visible content or controls extended outside the body. The alternate phone card is computed `display:none`, removing it from keyboard and assistive navigation while editing details.

Changing TSLAX to DOGE required compatible-finish confirmation. Cancel kept TSLAX; confirmation selected DOGE with its matching finish. Invalid final submission returned to Token and focused Name. Keyboard navigation uses the step selector and Next/Back controls; input-field Enter is not used as a step shortcut because the disabled mainnet submit prevents native implicit submission while setup is incomplete.

The last Message Next control now transfers focus to the newly visible status paragraph when it becomes disabled. The shared document pager, transaction review and wallet/recovery list pagers use the same focus handoff to their current body, preventing focus from dropping outside an overlay on the first/last page. The parent coordinates the separate Guide overlay recheck.

Full actual engine motion was sampled through more than 360° at 1280×720, 390×844 and 320×640. All samples remained in Full motion. On 320×640, the card face stayed between Y190–466 and controls between Y483–541 inside the reserved Y175–579 preview. At 1280×720, face Y137–574 and controls Y590–646 fit inside Y108–708. The 300px minimum belongs only to the turntable controls wrapper; actual height-sized card widths were 183px / 290px respectively. The first sweep injected the exact final CSS while the build was being coordinated; a second final-bundle sweep without injection passed 1280×720 and 320×640 with the same bounds and angles beyond 373°.

The no-wallet phone sheet opened with all visible connection guidance within its bounds. Its Vaul background tail increased `scrollHeight` without an out-of-bounds child; that shared Sheet detail was reported to the parent for cleanup. It is separate from the launch form and its contents.

Evidence: `output/playwright/viewport-launch-final-qa.json`, `viewport-launch-motion.json`, `viewport-launch-final-motion.json`, final status/wallet screenshots and full-turn screenshots. No runtime console errors appeared. The only console warning was the inherited unused Instrument Sans preload.

## Limits

No real wallet was connected, no ownership message or transaction was signed, and the exact mainnet transaction review was not opened with real funds. Its five-page UI preserves the existing plan validation, full identifiers and every exact cost field; the actual first wallet transaction remains an owner action. Real phone software keyboards, physical tilt sensors and safe-area behavior need hardware verification. No deployment was performed by this subtask.

## Production readback

Version `f4323060-6374-408b-ad04-6d01c61bcab4` was verified read-only at the dedicated Worker URL after the parent enabled production. At 1440×900, 390×844 and 320×640, the mainnet status reports ready, the Review mainnet launch control is enabled, and the terms checkbox becomes available after reading Transaction terms. Checking/unchecking that local UI state works. The review control and wallet connection were never clicked.

`GET /api/live/health` returned HTTP 200, `ok:true`, configured/enabled/ready true and healthy mainnet RPC, with observed finalized slot 462405381 at 2026-10-28T08:16:35.446Z. No document scrolling or creation-body overflow appeared. Phone editing hides the alternate card. The new multicolor fan-and-crown SVG loaded successfully. All observed requests during interaction/readback were GET; no ownership authentication, wallet connection, signatures, token or NFT writes occurred. Evidence: `output/playwright/viewport-launch-public-readback.json` and public screenshots. Canonical-domain verification is owned by the parent; this browser check used the dedicated Worker origin.
