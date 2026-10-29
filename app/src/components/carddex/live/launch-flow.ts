import { ed25519 } from "@noble/curves/ed25519.js";
import {
  fromBase58, PAIR_FRESH_MS, planForWallet, planIsStale, refreshKeepsReview, signPlansWithWallet, signPlanWithWallet, toBase64,
  WalletBatchUnsupported, WalletChangedTransaction,
  type EphemeralSigner, type ExpectedPlan, type SigningOrder, type TransactionPlan,
} from "./transaction";
import { liveSignInInputProblem, liveSignInOutputProblem, liveSignInProblem, type LiveSignInInput } from "../../../lib/carddex/live/sign-in";
import { SignInWrongSite, walletRejected } from "./wallet-errors";

/** Shown in the review while the wallet opens a second time after it returned a transaction this page refused. */
export const WALLET_RETRY_NOTICE = "Your wallet returned a different transaction, so nothing was sent. Approve once more: this time this page signs first.";
/** Shown with the card's own review when the card approved with its coin ran out of time before the coin was verified. */
export const CARD_APPROVAL_EXPIRED = "Your card approval ran out of time while the coin was confirming, so nothing was charged for the card. Approve the card once more.";
/** The ownership step, said while the wallet is open: the same words for a sign-in and for the plain message. */
export const SIGN_IN_COPY = "Sign in with your wallet. Signing in proves you own it and spends no funds.";
/** Shown while the wallet opens for the coin alone after it did not sign the coin and its card in one approval. */
export const PAIR_SINGLE_NOTICE = "Your wallet signs one transaction at a time, so nothing was sent. Approve the coin now; its card follows once the coin is confirmed.";
/** The card row's words while the card the wallet approved with its coin waits for the coin, then once it can go. */
export const CARD_APPROVED_WAITING = "Approved with the coin. Sends once the coin is confirmed";
export const CARD_APPROVED_READY = "Approved with the coin. Ready to send";

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

/** The coin and its card, prepared together for one wallet prompt. `card` is null once a refresh could not include it. */
export type PairPlans = { coin: TransactionPlan; card: TransactionPlan | null };
export type PairStep =
  | { status: "signed"; coin: TransactionPlan; card: TransactionPlan; coinSigned: Uint8Array; cardSigned: Uint8Array; order: SigningOrder; fellBack: boolean }
  /** A re-prepared plan moved a reviewed cost of either: show the review again before any wallet prompt. */
  | { status: "changed"; plans: PairPlans }
  /** The coin stage no longer needs this transaction (the server already has its result). */
  | { status: "gone" }
  /**
   * Not one prompt after all (the wallet returned another count, or the refreshed pair has no card): nothing was
   * co-signed or sent. Continue with `coin` alone through signForLaunch; the card follows the coin with its own prompt.
   * `prompted`: the wallet was already opened once for the pair.
   */
  | { status: "single"; coin: TransactionPlan; receivedAt: number; prompted: boolean };

/**
 * One wallet prompt for the coin and its card (a multi-input solana:signTransaction), without UI. The pair is prepared
 * again first when older than PAIR_FRESH_MS, so the card's blockhash can outlive the coin's verification. The wallet
 * signs both in `order` and the page co-signs each exactly as for one transaction (signPlansWithWallet). A wallet-first
 * wallet whose messages break the shared wallet rule is logged per transaction and asked once more, page-first. The
 * caller sends only the coin now; it relays the card (saved with holdLiveCard) once the coin is verified. Nothing here
 * sends, uploads or co-signs a changed message.
 */
export async function signLaunchPair(step: {
  plans: { coin: TransactionPlan; card: TransactionPlan }; receivedAt: number;
  expected: { coin: ExpectedPlan; card: ExpectedPlan }; signers: { coin: EphemeralSigner; card: EphemeralSigner }; order: SigningOrder;
  /** Prepares both again and validates them; null when the coin stage no longer needs a transaction. */
  refresh: () => Promise<PairPlans | null>;
  /** One solana:signTransaction prompt with both transactions; returns the wallet's outputs as they are. */
  walletSignAll: (transactions: Uint8Array[]) => Promise<Uint8Array[]>;
  onPlans?: (plans: PairPlans, receivedAt: number) => void;
  onWalletOpen?: (retry: boolean) => void;
  onWalletChanged?: (plan: TransactionPlan, returned: Uint8Array) => void;
  now?: () => number;
}): Promise<PairStep> {
  const now = step.now ?? Date.now;
  let coin = step.plans.coin, card: TransactionPlan | null = step.plans.card, receivedAt = step.receivedAt;
  const fresh = async (): Promise<"fresh" | "refreshed" | "changed" | "gone"> => {
    if (!planIsStale(receivedAt, now(), PAIR_FRESH_MS)) return "fresh";
    const next = await step.refresh();
    if (!next) return "gone";
    const moved = !refreshKeepsReview(coin, next.coin) || !!(card && next.card && !refreshKeepsReview(card, next.card));
    coin = next.coin; card = next.card; receivedAt = now(); step.onPlans?.({ coin, card }, receivedAt);
    return moved ? "changed" : "refreshed";
  };
  const attempt = async (order: SigningOrder, retry: boolean): Promise<PairStep> => {
    const ready = await fresh();
    if (ready === "gone") return { status: "gone" };
    if (ready === "changed") return { status: "changed", plans: { coin, card } };
    const pair = card;
    if (!pair) return { status: "single", coin, receivedAt, prompted: retry };
    step.onWalletOpen?.(retry);
    try {
      const [coinSigned, cardSigned] = await signPlansWithWallet([
        { plan: coin, expected: step.expected.coin, signer: step.signers.coin }, { plan: pair, expected: step.expected.card, signer: step.signers.card },
      ], order, step.walletSignAll);
      return { status: "signed", coin, card: pair, coinSigned, cardSigned, order, fellBack: retry };
    } catch (error) {
      if (error instanceof WalletBatchUnsupported) return { status: "single", coin, receivedAt, prompted: true };
      if (error instanceof WalletChangedTransaction) for (const change of error.changes) step.onWalletChanged?.(change.index === 0 ? coin : pair, change.returned);
      throw error;
    }
  };
  try { return await attempt(step.order, false); }
  catch (error) {
    if (!(error instanceof WalletChangedTransaction) || step.order !== "wallet-first") throw error;
  }
  return attempt("page-first", true);
}

/** What a stage needs next for its card, once the coin is verified (status nft_pending). */
export type CardNext = "send-approved" | "prepare" | "confirm" | "none";
/**
 * The card's next step without UI: "send-approved" sends the card the wallet approved with its coin (no prompt);
 * "prepare" prepares the card's own review and prompt; "confirm" checks a card already sent; "none" before the coin is
 * verified or once the card is done. An approved card for another card address (after a key change) is not used.
 */
export function cardNext(stage: { status: string; nftMint: string; nftSignature: string | null }, approved: { nftMint: string } | null): CardNext {
  if (stage.status !== "nft_pending") return "none";
  if (stage.nftSignature) return "confirm";
  return approved && approved.nftMint === stage.nftMint ? "send-approved" : "prepare";
}

/**
 * Wallet ownership without UI, in as few prompts as the wallet allows. With solana:signIn: one prompt that connects
 * (when `address` is null) and signs this site's SIWS request; its text is checked here, then by the server
 * (verifySignIn semantics), before the session starts. Without it, or when the wallet signs other text or its sign-in
 * fails for another reason than a refusal: connect (when needed), then the plain ownership message, as before. A
 * refusal in the wallet, or a sign-in for another site, stops here with no further prompt. Nothing here moves funds.
 */
export async function proveOwnership(step: {
  /** The connected creator, or null when the wallet is not connected yet (a sign-in then connects it in its one prompt). */
  address: string | null;
  canSignIn: boolean;
  /** This page's origin (window.location.origin). */
  origin: string;
  signInChallenge: () => Promise<{ challengeId: string; input: LiveSignInInput }>;
  verifySignIn: (proof: { challengeId: string; wallet: string; signedMessageBase64: string; signatureBase64: string }) => Promise<void>;
  messageChallenge: (wallet: string) => Promise<{ challengeId: string; message: string }>;
  verifyMessage: (proof: { challengeId: string; wallet: string; signatureBase64: string }) => Promise<void>;
  /** One solana:signIn prompt; returns the signed-in account and the wallet's bytes as they are. */
  signIn: (input: LiveSignInInput & { address?: string }) => Promise<{ address: string; signedMessage: Uint8Array; signature: Uint8Array }>;
  connect: () => Promise<string>;
  signMessage: (message: Uint8Array, address: string) => Promise<Uint8Array>;
  onPrompt?: (kind: "sign-in" | "connect" | "message") => void;
}): Promise<{ address: string; method: "sign-in" | "message"; prompts: number }> {
  let prompts = 0, address = step.address;
  if (step.canSignIn) {
    const challenge = await step.signInChallenge();
    const problem = liveSignInInputProblem(challenge.input, step.origin);
    if (problem) throw new Error(problem);
    step.onPrompt?.("sign-in"); prompts++;
    let out: Awaited<ReturnType<typeof step.signIn>> | null = null;
    try { out = await step.signIn(address ? { ...challenge.input, address } : challenge.input); }
    catch (error) { if (walletRejected(error) || error instanceof SignInWrongSite) throw error; }
    if (out) {
      if (address && out.address !== address) throw new Error("Your wallet signed in with another account. Reconnect the creator wallet to continue.");
      address = out.address;
      const accepted = !liveSignInOutputProblem(challenge.input, out.address, out.signedMessage) && out.signature.length === 64 && ed25519.verify(out.signature, out.signedMessage, fromBase58(out.address));
      if (accepted) {
        await step.verifySignIn({ challengeId: challenge.challengeId, wallet: out.address, signedMessageBase64: toBase64(out.signedMessage), signatureBase64: toBase64(out.signature) });
        return { address: out.address, method: "sign-in", prompts };
      }
      // The wallet signed other text: nothing is accepted from it. The plain message below proves ownership instead.
    }
  }
  if (!address) { step.onPrompt?.("connect"); prompts++; address = await step.connect(); }
  const challenge = await step.messageChallenge(address);
  // The same check the server runs before it accepts the signature: this site, this wallet, Solana mainnet.
  const problem = liveSignInProblem(challenge.message, { origin: step.origin, wallet: address });
  if (problem) throw new Error(problem);
  step.onPrompt?.("message"); prompts++;
  const signature = await step.signMessage(new TextEncoder().encode(challenge.message), address);
  await step.verifyMessage({ challengeId: challenge.challengeId, wallet: address, signatureBase64: toBase64(signature) });
  return { address, method: "message", prompts };
}
