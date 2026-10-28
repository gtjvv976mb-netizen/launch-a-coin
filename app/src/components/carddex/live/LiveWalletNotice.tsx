import { useId } from "react";
import type { TransactionPlan } from "./transaction";
import { WALLET_NOTICE_COPY, WALLET_NOTICE_TITLE, walletNoticeItems, type WalletNoticeQuote } from "./wallet-notice";

/**
 * The calm list of what the wallet prompt will carry, placed before the wallet opens. Unstyled on purpose: the
 * `cdx-live-wallet-notice` hooks are for the Launch screen's own styles.
 */
export function LiveWalletNotice({ plan, quote, siteHost, className }: {
  plan: Pick<TransactionPlan, "kind" | "review">; quote: WalletNoticeQuote; siteHost?: string; className?: string;
}) {
  const id = useId();
  return <section className={className ? `cdx-live-wallet-notice ${className}` : "cdx-live-wallet-notice"} aria-labelledby={id}>
    <h3 id={id} className="cdx-live-wallet-notice-title">{WALLET_NOTICE_TITLE}</h3>
    <ul className="cdx-live-wallet-notice-list">{walletNoticeItems(plan, quote, siteHost).map(item => <li key={item.key} data-notice={item.key}>{item.text}</li>)}</ul>
    <p className="cdx-live-wallet-notice-safety">{WALLET_NOTICE_COPY.safety}</p>
  </section>;
}
