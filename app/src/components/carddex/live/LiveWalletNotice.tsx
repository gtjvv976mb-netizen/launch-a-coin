import { useId } from "react";
import type { TransactionPlan } from "./transaction";
import { WALLET_NOTICE_COPY, WALLET_NOTICE_TITLE, walletNoticeItems, type WalletNoticeQuote } from "./wallet-notice";

/**
 * The calm list of what the wallet prompt will carry, placed before the wallet opens. Unstyled on purpose: the
 * `cdx-live-wallet-notice` hooks are for the Launch screen's own styles. `card`: the card plan that comes in the same
 * prompt as a coin plan.
 */
export function LiveWalletNotice({ plan, card, quote, siteHost, className }: {
  plan: Pick<TransactionPlan, "kind" | "review">; card?: Pick<TransactionPlan, "kind" | "review"> | null; quote: WalletNoticeQuote; siteHost?: string; className?: string;
}) {
  const id = useId();
  return <section className={className ? `cdx-live-wallet-notice ${className}` : "cdx-live-wallet-notice"} aria-labelledby={id}>
    <h3 id={id} className="cdx-live-wallet-notice-title">{WALLET_NOTICE_TITLE}</h3>
    <ul className="cdx-live-wallet-notice-list">{walletNoticeItems(plan, quote, siteHost, card).map(item => <li key={item.key} data-notice={item.key}>{item.text}</li>)}</ul>
    {/* The review dialog stays open: the details open in a new tab. */}
    <p className="cdx-live-wallet-notice-safety">{WALLET_NOTICE_COPY.safety} <a href="/how#wallet" target="_blank" rel="noopener" className="mdx-link mdx-hit">Details</a></p>
  </section>;
}
