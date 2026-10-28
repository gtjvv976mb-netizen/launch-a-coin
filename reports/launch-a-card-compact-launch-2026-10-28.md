# Compact launch desk — 28 October 2026

The launch screen keeps its details-left/card-right composition and existing gold, cream, charcoal and scarlet identity. Its desktop columns now allocate one third to compact fields and two thirds to one complete interactive card. The former 206px finish-caption reservation is removed. A single finish selector sits beside the other creation controls; a single prominent inline card appears before the form on phones. The existing inspector opens only when requested.

Fields are 40px on desktop and 44px on phones. Artwork uses a compact upload row. Description, social links and the optional initial buy are disclosed together. Transaction details and slippage remain separately available. Mainnet readiness has a concise expandable explanation; the paid-mainnet acknowledgement, exact transaction review, locked intent, confirmation and recovery states remain. Mainnet and explicit test-demo modes remain distinct.

No transaction construction, verification, signing, relay, backend state, canonical card geometry or shared turntable behavior changed. No wallet signature, transaction submission or deployment was performed.

## Source verification

TypeScript and diff checks pass. Impeccable's detector returns no findings on the scoped changes. An independent read-only source review found no probable regression in pending quote submission, optional-field focus, immutable saved intent handling or inspector focus return.

## Rebuilt browser verification

An isolated Chromium session checked 1440×900,1280×720,768×1024,390×844 and320×844. It inspected actual rendered screenshots and exercised representative TSLAX/Tesla and DOGE finishes.

- One inline card and one finish picker render at every width; no horizontal overflow occurs.
- The complete desktop card measures 466×651 at 1440 and 350×490 at 1280×720, entirely inside the first viewport. On phones the card is shown before the form and retains 44px turn/pause/inspect controls.
- Local artwork, name, ticker and optional description update the existing canonical preview without a write request.
- Pending incompatible quote changes block Enter. Explicit confirmation updates quote and compatible finish together and clears the initial buy.
- Optional description, links, initial buy and slippage remain usable at 320px. The mainnet setup state keeps real review disabled until readiness passes.
- The 320px inspector opens, shows both faces, closes and restores focus to Inspect. The marketplace case's Launch a Card label and 1/1 serial remain separated.
- Default rotation advances; Pause holds the pose and Resume restores motion. Full motion remains selected.
- No runtime or console errors, failed first-party responses or write requests occurred. One existing unused-font-preload warning was recorded.

Evidence: `output/playwright/carddex-2026-10-28/compact-launch-ui.json`, `compact-launch-ui.log`, `compact-launch-{1440,1280,768,390,320}.png`, `compact-options-320.png`, and `compact-inspect-{front,back}-320.png`.

The final coordinated polish build was read back at 1440, 390 and 320px. Turn, Pause/Resume and Inspect form one centered group, within 10px of the card center; card dimensions are unchanged. The 320px inspector restores focus to Inspect after closing. The optional description still says “Permanent once issued,” and mainnet review remains blocked while setup is incomplete. There were no runtime errors or failed responses. Full motion remains on, and the owned browser was closed. Final evidence is `compact-launch-polish.json` and `compact-final-launch-{1440,390,320}.png`. Broader platform checks are recorded by the parent task.
