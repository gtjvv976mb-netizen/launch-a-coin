import { useState } from "react";
import { Modal } from "../../mintdex/ui";

export function LiveLaunchGuide({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className={compact ? "grid h-11 w-11 place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track" : "mdx-link inline-flex min-h-6 items-center text-[14px]"} aria-label="How wallet launch works">
      {compact ? <HelpGlyph /> : "How wallet launch works"}
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

/** The same outlined question mark as the header guide button on every other route (VD-12). */
function HelpGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none">
      <circle cx="10" cy="10" r="7.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.9 7.9a2.15 2.15 0 1 1 3.02 1.97c-.55.25-.92.72-.92 1.33v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13.9" r="0.95" fill="currentColor" />
    </svg>
  );
}
