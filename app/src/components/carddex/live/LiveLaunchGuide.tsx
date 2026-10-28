import { useState } from "react";
import { Modal } from "../../mintdex/ui";

export function LiveLaunchGuide({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className={compact ? "grid h-11 w-11 place-items-center rounded-pill text-ink" : "mdx-link inline-flex min-h-6 items-center text-[14px]"} aria-label="How wallet launch works">
      {compact ? <span aria-hidden>?</span> : "How wallet launch works"}
    </button>
    <Modal open={open} onOpenChange={setOpen} title="A token and your own trading card" description="The mainnet launch uses your connected creator wallet and separate transaction reviews.">
      <div className="cdx-live-wallet">
        <p>Choose your permanent card finish and its exact quote asset. Add your token name, ticker and artwork.</p>
        <p>Connect your creator wallet and sign an ownership message. This message authorizes your launch session and spends no funds.</p>
        <p>Review the actual token creation costs and any optional initial buy, then approve the pump.fun transaction in your wallet.</p>
        <p>After the token is verified, review a separate transaction to issue its one-of-one card NFT to that same wallet. There are no NFT royalties, bids or marketplace listings.</p>
        <p>If the token succeeds before the card, resume card issuance from this page. Your token is not created again.</p>
      </div>
    </Modal>
  </>;
}
