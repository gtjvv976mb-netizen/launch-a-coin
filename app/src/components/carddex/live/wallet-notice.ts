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
  approvalsPairThenFees: "One wallet approval creates your coin and its card. Your wallet asks once more, for your creator fee split, after both are confirmed.",
  approvalsCoinThenFees: "This approval creates your coin. Your wallet asks again for its card, then for your creator fee split.",
  approvalsCardThenFees: "This approval issues your card. Your wallet asks once more, for your creator fee split.",
  approvalsFees: "This approval sets your creator fee split on pump.fun. It's the last one, and the split can't be changed afterward.",
  feeProgram: "pump.fun's fee-sharing program. pump.fun pays creator fees; Launch a Card takes none and is not in your split.",
  feeRent: "Rent for pump.fun's fee-sharing account, paid from your wallet.",
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
/** Shown while the wallet prompt with the coin and its card is open. */
export const WALLET_OPEN_PAIR_COPY = "Approve or reject in your wallet. It shows your coin and its card together, with the costs you reviewed and a second signer for each new address this page created.";
/**
 * What the wallet asks for, in order, under the fresh Launch ticket's primary: one prompt for the coin and its card
 * when the connected wallet is on the server's batch list (signsBothFor), else the card's own prompt after the coin.
 */
export const SEPARATE_APPROVALS_NEXT = "Your wallet opens for a sign-in message that spends nothing, then your coin, then its card.";
export const ONE_APPROVAL_NEXT = "Your wallet opens for a sign-in message that spends nothing, then your coin and its card in one approval.";
/** The same lines when the creator chose to share creator fees: the split is its own approval after the card. */
export const SEPARATE_APPROVALS_NEXT_FEES = "Your wallet opens for a sign-in message that spends nothing, then your coin, then its card, then your creator fee split.";
export const ONE_APPROVAL_NEXT_FEES = "Your wallet opens for a sign-in message that spends nothing, then your coin and its card in one approval, then your creator fee split.";
/** The review's line under the costs when the card comes in the same approval (the coin-only line is the panel's). */
export const PAIR_REVIEW_COPY = "Your wallet approves the coin and its card together. The card is sent once the coin is confirmed on Solana, with no second approval.";

export type WalletNoticeQuote = { symbol: string; decimals: number; kind: string };
export type WalletNoticeItem = { key: keyof typeof WALLET_NOTICE_COPY; text: string };
type NoticePlan = Pick<TransactionPlan, "kind" | "review">;
/**
 * `card`: the card plan that comes in the same prompt as this coin plan (one approval for both). `feesNext`: a creator
 * fee split follows the card, so the card's approval is not the last one.
 */
export function walletNoticeItems(plan: NoticePlan, quote: WalletNoticeQuote, siteHost?: string, card?: NoticePlan | null, feesNext = false): WalletNoticeItem[] {
  if (plan.kind === "fees") {
    const fee = BigInt(plan.review.networkFeeLamports) + BigInt(plan.review.priorityFeeLamports);
    return [{ key: "approvalsFees", text: WALLET_NOTICE_COPY.approvalsFees }, { key: "networkFee", text: WALLET_NOTICE_COPY.networkFee(formatLiveAmount(fee.toString(), 9)) },
      ...(BigInt(plan.review.rentAndProgramCostLamports) > 0n ? [{ key: "feeRent" as const, text: WALLET_NOTICE_COPY.feeRent }] : []),
      { key: "feeProgram", text: WALLET_NOTICE_COPY.feeProgram }, { key: "newSite", text: WALLET_NOTICE_COPY.newSite(siteHost) }];
  }
  const pair = plan.kind === "token" && card?.kind === "nft" ? card : null;
  const fees = (p: NoticePlan) => BigInt(p.review.networkFeeLamports) + BigInt(p.review.priorityFeeLamports);
  const fee = fees(plan) + (pair ? fees(pair) : 0n);
  const buy = plan.kind === "token" && BigInt(plan.review.initialBuyQuoteBaseUnits) > 0n;
  const approvals = pair ? feesNext ? "approvalsPairThenFees" : "approvalsPair" : plan.kind === "token" ? feesNext ? "approvalsCoinThenFees" : "approvalsCoin" : feesNext ? "approvalsCardThenFees" : "approvalsCard";
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

/**
 * The same list before anything is prepared (the Launch ticket, under the primary): what the coin transaction's
 * wallet prompt will carry, from what the form already knows. It mirrors walletNoticeItems for a coin plan (and its
 * card, `oneApproval`: the connected wallet signs both in one prompt), with the fee amount left to the review and the
 * initial buy's amount left out (the review shows both exactly). A tokenized-stock quote never carries a first buy
 * (the page says so at the buy), so its issuer note never shows here.
 */
export function walletNoticePreview({ hasBuy, siteHost, oneApproval = false, feesNext = false }: { hasBuy: boolean; siteHost?: string; oneApproval?: boolean; feesNext?: boolean }): WalletNoticeItem[] {
  const approvals = oneApproval ? feesNext ? "approvalsPairThenFees" : "approvalsPair" : feesNext ? "approvalsCoinThenFees" : "approvalsCoin";
  const items: WalletNoticeItem[] = [{ key: approvals, text: WALLET_NOTICE_COPY[approvals] }, { key: "networkFeeLater", text: WALLET_NOTICE_COPY.networkFeeLater }];
  if (hasBuy) items.push({ key: "tokenAccount", text: WALLET_NOTICE_COPY.tokenAccount }, { key: "unverified", text: WALLET_NOTICE_COPY.unverified });
  items.push({ key: "coinSigner", text: WALLET_NOTICE_COPY.coinSigner });
  if (oneApproval) items.push({ key: "cardSigner", text: WALLET_NOTICE_COPY.cardSigner }, { key: "cardLock", text: WALLET_NOTICE_COPY.cardLock });
  items.push({ key: "newSite", text: WALLET_NOTICE_COPY.newSite(siteHost) });
  return items;
}
