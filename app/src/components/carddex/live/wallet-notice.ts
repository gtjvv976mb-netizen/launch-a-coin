import { formatLiveAmount } from "./amounts";
import type { TransactionPlan } from "./transaction";

/**
 * "What your wallet will show": the labels a wallet prompt carries for this transaction that code cannot remove,
 * said before the wallet opens. Built only from facts in the prepared plan. It never tells anyone to click through a
 * red warning. The first line says how many approvals the launch takes from here.
 */
export const WALLET_NOTICE_TITLE = "What your wallet will show";
export const WALLET_NOTICE_COPY = {
  approvalsPair: "One wallet approval creates your coin and its card. The card is sent as soon as the coin is confirmed.",
  approvalsCoin: "This approval creates your coin. Your wallet asks once more, for its card, after the coin is confirmed.",
  approvalsCard: "This approval issues your card. It's the last one.",
  networkFee: (sol: string) => `A network fee of about ${sol} SOL.`,
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
/** Shown while the wallet prompt with the coin and its card is open. */
export const WALLET_OPEN_PAIR_COPY = "Approve or reject in your wallet. It shows your coin and its card together, with the costs you reviewed and a second signer for each new address this page created.";
/** The review's line under the costs when the card comes in the same approval (the coin-only line is the panel's). */
export const PAIR_REVIEW_COPY = "Your wallet approves the coin and its card together. The card is sent once the coin is confirmed on Solana, with no second approval.";

export type WalletNoticeQuote = { symbol: string; decimals: number; kind: string };
export type WalletNoticeItem = { key: keyof typeof WALLET_NOTICE_COPY; text: string };
type NoticePlan = Pick<TransactionPlan, "kind" | "review">;
/** `card`: the card plan that comes in the same prompt as this coin plan (one approval for both). */
export function walletNoticeItems(plan: NoticePlan, quote: WalletNoticeQuote, siteHost?: string, card?: NoticePlan | null): WalletNoticeItem[] {
  const pair = plan.kind === "token" && card?.kind === "nft" ? card : null;
  const fees = (p: NoticePlan) => BigInt(p.review.networkFeeLamports) + BigInt(p.review.priorityFeeLamports);
  const fee = fees(plan) + (pair ? fees(pair) : 0n);
  const buy = plan.kind === "token" && BigInt(plan.review.initialBuyQuoteBaseUnits) > 0n;
  const approvals = pair ? "approvalsPair" : plan.kind === "token" ? "approvalsCoin" : "approvalsCard";
  const items: WalletNoticeItem[] = [{ key: approvals, text: WALLET_NOTICE_COPY[approvals] }, { key: "networkFee", text: WALLET_NOTICE_COPY.networkFee(formatLiveAmount(fee.toString(), 9)) }];
  if (buy) {
    items.push({ key: "initialBuy", text: WALLET_NOTICE_COPY.initialBuy(formatLiveAmount(plan.review.initialBuyQuoteBaseUnits, quote.decimals), quote.symbol) },
      { key: "tokenAccount", text: WALLET_NOTICE_COPY.tokenAccount }, { key: "unverified", text: WALLET_NOTICE_COPY.unverified });
    if (quote.kind === "stock") items.push({ key: "stockQuote", text: WALLET_NOTICE_COPY.stockQuote });
  }
  if (plan.kind === "token") items.push({ key: "coinSigner", text: WALLET_NOTICE_COPY.coinSigner });
  if (plan.kind === "nft" || pair) items.push({ key: "cardSigner", text: WALLET_NOTICE_COPY.cardSigner }, { key: "cardLock", text: WALLET_NOTICE_COPY.cardLock });
  items.push({ key: "newSite", text: WALLET_NOTICE_COPY.newSite(siteHost) });
  return items;
}
