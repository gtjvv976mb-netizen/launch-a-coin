import { useState } from "react";
import { IconButton, Modal } from "../../mintdex/ui";

export function LiveLaunchGuide({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    {/* The same help control as the shell's guide button on every other route (IconButton "help"). */}
    {compact ? <IconButton icon="help" label="How wallet launch works" onClick={() => setOpen(true)} aria-haspopup="dialog" />
      : <button type="button" onClick={() => setOpen(true)} className="mdx-link mdx-hit" aria-haspopup="dialog">How wallet launch works</button>}
    <Modal open={open} onOpenChange={setOpen} title="A token and your own trading card" description="The mainnet launch uses your connected creator wallet and separate transaction reviews.">
      <ol className="cdx-live-guide">
        <li>Choose your permanent card design and its exact quote asset. Add your token name, ticker and artwork.</li>
        <li>Connect your creator wallet and sign an ownership message. This message authorizes your launch session and spends no funds.</li>
        <li>Review the actual token creation costs and any optional initial buy, then approve the pump.fun transaction in your wallet.</li>
        <li>After the token is verified, review a separate transaction to issue its one-of-one card NFT to that same wallet. There are no NFT royalties, bids or marketplace listings.</li>
        <li>If the token succeeds before the card, resume card issuance from this page. Your token is not created again.</li>
      </ol>
    </Modal>
  </>;
}
