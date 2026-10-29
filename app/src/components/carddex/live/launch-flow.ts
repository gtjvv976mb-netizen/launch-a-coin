import {
  planForWallet, signPlanWithWallet, WalletChangedTransaction,
  type EphemeralSigner, type ExpectedPlan, type SigningOrder, type TransactionPlan,
} from "./transaction";

/** Shown in the review while the wallet opens a second time after it returned a transaction this page refused. */
export const WALLET_RETRY_NOTICE = "Your wallet returned a different transaction, so nothing was sent. Approve once more: this time this page signs first.";

export type WalletStep =
  | { status: "signed"; plan: TransactionPlan; signed: Uint8Array; order: SigningOrder; fellBack: boolean }
  /** A re-prepared plan moved a reviewed cost: show the review again before any wallet prompt. */
  | { status: "changed"; plan: TransactionPlan }
  /** The stage no longer needs this transaction (the server already has its result). */
  | { status: "gone" };

/**
 * The wallet step for one launch transaction, without UI. A plan older than ~30 s is prepared again first
 * (planForWallet), the wallet signs in `order`, and the page co-signs. When a wallet-first wallet returns a message
 * outside the shared wallet rule, its bytes go only to `onWalletChanged` (the server change log; they cannot land
 * without this page's signature) and the step is retried once in the page-first order, after the same freshness
 * check, with one more wallet prompt. Nothing here signs a changed message, uploads, or sends.
 */
export async function signForLaunch(step: {
  plan: TransactionPlan; receivedAt: number; expected: ExpectedPlan; signer: EphemeralSigner; order: SigningOrder;
  /** Prepares the same stage again and validates it; null when the stage no longer needs it. */
  refresh: () => Promise<TransactionPlan | null>;
  /** One solana:signTransaction prompt; returns the wallet's bytes as they are. */
  walletSign: (transaction: Uint8Array) => Promise<Uint8Array>;
  /** The page now holds this re-prepared plan (received at `receivedAt`). */
  onPlan?: (plan: TransactionPlan, receivedAt: number) => void;
  onWalletOpen?: (retry: boolean) => void;
  onWalletChanged?: (plan: TransactionPlan, returned: Uint8Array) => void;
  now?: () => number;
}): Promise<WalletStep> {
  const now = step.now ?? Date.now;
  let plan = step.plan, receivedAt = step.receivedAt;
  const fresh = async () => {
    const ready = await planForWallet(plan, receivedAt, step.refresh, now());
    if (ready.status === "refreshed" || ready.status === "changed") { plan = ready.plan; receivedAt = now(); step.onPlan?.(plan, receivedAt); }
    return ready.status;
  };
  const sign = async (order: SigningOrder, retry: boolean) => {
    step.onWalletOpen?.(retry);
    try { return await signPlanWithWallet(plan, step.expected, step.signer, order, step.walletSign); }
    catch (error) { if (error instanceof WalletChangedTransaction) step.onWalletChanged?.(plan, error.returned); throw error; }
  };
  let ready = await fresh();
  if (ready === "gone") return { status: "gone" };
  if (ready === "changed") return { status: "changed", plan };
  try { return { status: "signed", plan, signed: await sign(step.order, false), order: step.order, fellBack: false }; }
  catch (error) {
    if (!(error instanceof WalletChangedTransaction) || step.order !== "wallet-first") throw error;
  }
  ready = await fresh();
  if (ready === "gone") return { status: "gone" };
  if (ready === "changed") return { status: "changed", plan };
  return { status: "signed", plan, signed: await sign("page-first", true), order: "page-first", fellBack: true };
}
