import { formatLiveAmount } from "./amounts";
import type { TransactionPlan } from "./transaction";

/**
 * "What your wallet will show": the labels a wallet prompt carries for this transaction that code cannot remove,
 * said before the wallet opens. Built only from facts in the prepared plan. It never tells anyone to click through a
 * red warning.
 */
export const WALLET_NOTICE_TITLE = "What your wallet will show";
export const WALLET_NOTICE_COPY = {
  networkFee: (sol: string) => `A network fee of about ${sol} SOL.`,
  networkFeeLater: "A network fee. The exact amount is in your review.",
  initialBuy: (amount: string, symbol: string) => `Your initial buy: ${amount} ${symbol}.`,
  tokenAccount: "A new token account that holds your coin.",
  unverified: "Your new coin marked as unverified. That's normal for a coin created seconds ago.",
  stockQuote: "A note that tokenized stocks have issuer controls. It comes from the stock token, not from this site.",
  coinSigner: "A second signer for the new coin's address. This page created that address, and it can't move your other funds.",
  cardSigner: "A second signer for the new card's address. This page created that address, and it can't move your other funds.",
  cardLock: "The card's artwork and details locked for good. Some wallets call this an authority change.",
  newSite: (host?: string) => `Phantom may show a notice that this site is new.${host ? ` Check that the address bar reads ${host}.` : ""}`,
  safety: "If your wallet warns that this site could be malicious, don't approve. Reject it there; nothing is sent or charged.",
} as const;
/** Shown while the wallet prompt is open. */
export const WALLET_OPEN_COPY = "Approve or reject in your wallet. It shows the costs you reviewed and a second signer for the new address this page created.";

export type WalletNoticeQuote = { symbol: string; decimals: number; kind: string };
export type WalletNoticeItem = { key: keyof typeof WALLET_NOTICE_COPY; text: string };
export function walletNoticeItems(plan: Pick<TransactionPlan, "kind" | "review">, quote: WalletNoticeQuote, siteHost?: string): WalletNoticeItem[] {
  const fee = BigInt(plan.review.networkFeeLamports) + BigInt(plan.review.priorityFeeLamports);
  const buy = plan.kind === "token" && BigInt(plan.review.initialBuyQuoteBaseUnits) > 0n;
  const items: WalletNoticeItem[] = [{ key: "networkFee", text: WALLET_NOTICE_COPY.networkFee(formatLiveAmount(fee.toString(), 9)) }];
  if (buy) {
    items.push({ key: "initialBuy", text: WALLET_NOTICE_COPY.initialBuy(formatLiveAmount(plan.review.initialBuyQuoteBaseUnits, quote.decimals), quote.symbol) },
      { key: "tokenAccount", text: WALLET_NOTICE_COPY.tokenAccount }, { key: "unverified", text: WALLET_NOTICE_COPY.unverified });
    if (quote.kind === "stock") items.push({ key: "stockQuote", text: WALLET_NOTICE_COPY.stockQuote });
  }
  if (plan.kind === "token") items.push({ key: "coinSigner", text: WALLET_NOTICE_COPY.coinSigner });
  else items.push({ key: "cardSigner", text: WALLET_NOTICE_COPY.cardSigner }, { key: "cardLock", text: WALLET_NOTICE_COPY.cardLock });
  items.push({ key: "newSite", text: WALLET_NOTICE_COPY.newSite(siteHost) });
  return items;
}

/**
 * The same list before anything is prepared (the Launch ticket, above the primary): what the coin transaction's
 * wallet prompt will carry, from what the form already knows. It mirrors walletNoticeItems for a coin plan, with the
 * fee amount left to the review and the initial buy's amount left out (the review shows both exactly).
 */
export function walletNoticePreview({ hasBuy, quoteKind, siteHost }: { hasBuy: boolean; quoteKind: string; siteHost?: string }): WalletNoticeItem[] {
  const items: WalletNoticeItem[] = [{ key: "networkFeeLater", text: WALLET_NOTICE_COPY.networkFeeLater }];
  if (hasBuy) {
    items.push({ key: "tokenAccount", text: WALLET_NOTICE_COPY.tokenAccount }, { key: "unverified", text: WALLET_NOTICE_COPY.unverified });
    if (quoteKind === "stock") items.push({ key: "stockQuote", text: WALLET_NOTICE_COPY.stockQuote });
  }
  items.push({ key: "coinSigner", text: WALLET_NOTICE_COPY.coinSigner }, { key: "newSite", text: WALLET_NOTICE_COPY.newSite(siteHost) });
  return items;
}
