// The words of the signing states and of chain failures (refs/chain/m3-contract.md §7.1; backlog P1-8 on devnet).
// Split from wallet-copy.ts so the main chunk carries only the wallet trigger words (C10): this module is imported by
// the lazy menus and TxSteps. Devnet only; plain English, no em dashes, en dashes or middle dots (copy.test.ts).
// Owner: app:wallet.

import type { TxStep } from "./client";
import { isChainError } from "./errors";
import { APP_CLUSTER, NET_NAME, ON_NET, SOL_WORD } from "./env";
import { WALLET_COPY } from "./wallet-copy";

/**
 * The signing states every money action walks through (backlog P1-8 on devnet): idle, building, verifying,
 * awaiting wallet, sending, confirming, done, error.
 */
export type TxPhase = "idle" | "building" | "verifying" | "awaiting-wallet" | "sending" | "confirming" | "done" | "error";

/** The client's flow steps folded into the phases above (signing in and uploading count as building). */
export function phaseOfStep(step: TxStep): TxPhase {
  switch (step) {
    case "signing-in":
    case "uploading":
    case "building":
      return "building";
    case "verifying":
      return "verifying";
    case "signing":
      return "awaiting-wallet";
    case "submitting":
      return "sending";
    case "confirming":
      return "confirming";
    case "confirmed":
      return "done";
  }
}

/** Short labels for the step row and a busy button ("Approve in wallet..."). */
export const PHASE_LABEL: Record<TxPhase, string> = {
  idle: "Ready",
  building: "Preparing",
  verifying: "Checking",
  "awaiting-wallet": "Approve in wallet",
  sending: "Sending",
  confirming: "Confirming",
  done: "Done",
  error: "Stopped",
};

/** The four visible steps of a transaction, in order (building and verifying share the first). */
export const PHASE_STEPS: ReadonlyArray<{ phase: TxPhase; label: string }> = [
  { phase: "verifying", label: "Check" },
  { phase: "awaiting-wallet", label: "Approve" },
  { phase: "sending", label: "Send" },
  { phase: "confirming", label: "Confirm" },
];

/** The launch flow's own step words (sign in and upload come first). */
export const STEP_LABEL: Record<TxStep, string> = {
  "signing-in": "Signing in",
  uploading: "Uploading art",
  building: "Preparing",
  verifying: "Checking the transaction",
  signing: "Approve in your wallet",
  submitting: "Sending",
  confirming: `Confirming ${ON_NET}`,
  confirmed: "Confirmed",
};

/** One plain sentence for any failure of a chain read, sign-in or transaction flow. */
export function chainErrorText(e: unknown): string {
  if (!isChainError(e)) return "Something went wrong. Try again.";
  switch (e.code) {
    case "VERIFY_FAILED":
      return "MintDex stopped this transaction because it did not match what you asked for. Nothing was signed.";
    case "WALLET_NOT_CONNECTED":
      return "Connect a wallet first.";
    case "WALLET_REJECTED":
      return "You declined in your wallet. Nothing was sent.";
    case "WRONG_NETWORK":
      return `Switch your wallet to ${NET_NAME}, then try again.`;
    case "CONFIRM_TIMEOUT":
      return "Not confirmed yet. It may still land, so check your wallet activity before trying again.";
    case "NETWORK":
      return "Connection problem. Try again.";
    case "INSUFFICIENT_FUNDS":
      return `Not enough ${SOL_WORD} in your wallet.`;
    case "PRICE_CHANGED":
      return "The price changed. Check it and try again.";
    case "RATE_LIMITED":
    case "TOO_MANY_RESERVATIONS":
      return "Too many tries in a row. Wait a minute and try again.";
    case "FEES_BELOW_FLOOR":
      return "The card's fees changed while you signed. Sign again with the new numbers.";
    case "CARD_FROZEN":
      return "This card is locked by another app. It can still withdraw fees; unlock it in that app to sell or list it.";
    case "TX_VERSION_UNSUPPORTED":
      return "Your wallet sent the transaction in a newer format MintDex cannot read yet. Nothing was sent.";
    case "LAUNCH_COIN_CHECK_FAILED":
      return "pump.fun changed how new coins are created, so MintDex paused launches. Nothing was signed.";
    case "WALLET_REWROTE_TX":
      return "Your wallet changed the transaction in a way MintDex cannot accept. Nothing was sent.";
    case "HANDLE_TAKEN":
      return "That handle is taken. Try another one.";
    case "HANDLE_INVALID":
      return WALLET_COPY.handleInvalid;
    case "ENGINE_OFF":
      return APP_CLUSTER === "mainnet" ? "Transactions are paused right now. Browsing still works." : "Devnet actions are paused right now. Browsing still works.";
    case "PAUSED":
      return "This action is paused on MintDex right now.";
    case "AUTH_EXPIRED":
    case "UNAUTHORIZED":
      return "Your sign-in expired. Try again to sign in.";
    case "INTENT_EXPIRED":
      return "That took too long and the transaction expired. Try again.";
    case "SIMULATION_FAILED":
    case "SEND_FAILED":
      return e.apiError?.message || `The transaction failed ${ON_NET}. Nothing changed.`;
    default:
      return e.apiError?.message || e.message || "Something went wrong. Try again.";
  }
}
