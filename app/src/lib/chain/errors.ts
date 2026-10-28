// The chain client's error class (refs/chain/m3-contract.md §7.1). It lives in its own import-free module so the
// lazy chunks (flows.ts, verify.ts, trust.ts) and the main chunk (client.ts re-exports it) share one class without
// an import cycle. Owner: app:wallet.

import type { ApiError, ApiErrorCode } from "@mintdex/chain-sdk/api";

/** Client-side failure codes on top of the API's codes. */
export type ChainClientErrorCode =
  | ApiErrorCode
  | "VERIFY_FAILED" // the SDK verifier rejected the Worker's tx; the wallet was not opened
  | "WALLET_NOT_CONNECTED"
  | "WALLET_REJECTED" // the user declined in the wallet
  | "WRONG_NETWORK" // the wallet account does not list solana:devnet (or the public RPC is not devnet)
  | "CONFIRM_TIMEOUT" // not confirmed before lastValidBlockHeight (the tx may still land; status shows it)
  | "NETWORK"; // fetch failed (offline, CORS, DNS)

export class ChainClientError extends Error {
  readonly code: ChainClientErrorCode;
  readonly status: number;
  readonly apiError: ApiError | null;
  /** VERIFY_FAILED: the verifier's reasons (for logs; the UI shows a plain sentence). */
  readonly verifyErrors: string[];
  constructor(
    code: ChainClientErrorCode,
    message: string,
    opts: { status?: number; apiError?: ApiError | null; verifyErrors?: string[] } = {},
  ) {
    super(message);
    this.name = "ChainClientError";
    this.code = code;
    this.status = opts.status ?? 0;
    this.apiError = opts.apiError ?? null;
    this.verifyErrors = opts.verifyErrors ?? [];
  }
}

/** True when `e` is a ChainClientError with one of `codes` (any code when none are given). */
export function isChainError(e: unknown, ...codes: ChainClientErrorCode[]): e is ChainClientError {
  return e instanceof ChainClientError && (codes.length === 0 || codes.includes(e.code));
}

/** MintDex program error 6035 FeesBelowFloor (card-program-v2 §18.9), in either the code or the decoded program error. */
export function isFeesBelowFloor(e: unknown): boolean {
  if (!(e instanceof ChainClientError)) return false;
  if (e.code === "FEES_BELOW_FLOOR") return true;
  const pe = e.apiError?.programError;
  return !!pe && pe.code === 6035;
}
