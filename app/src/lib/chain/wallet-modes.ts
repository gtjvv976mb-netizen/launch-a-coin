// Per-wallet launch signing mode (refs/chain/m3-contract.md §7.2; card-program-v2 §10.1, wallet-integration R2).
// server_first (default): the Worker signs the vanity mint first and the wallet signs last. wallet_first: the wallet
// signs first and the Worker co-signs after checking the message hash. Owner: app:wallet.
//
// Since finalize accepts guard-only rewrites in both modes, a WALLET_REWROTE_TX means a change MintDex cannot accept:
// the launch retries once in wallet_first, and wallet_first is remembered for that wallet ONLY after a wallet_first
// launch succeeded. A WALLET_REWROTE_TX in wallet_first ends the attempt; it never loops or persists a mode.

import type { ApiSigningMode } from "@mintdex/chain-sdk/api";

/** Wallets known (from the C1 wallet matrix) to need wallet_first. Empty until C1 records them. */
export const KNOWN_WALLET_MODES: Readonly<Record<string, ApiSigningMode>> = {};

const STORAGE_KEY = "mintdex.walletModes.v1";

function readStored(): Record<string, ApiSigningMode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const out: Record<string, ApiSigningMode> = {};
    for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
      if (m === "wallet_first" || m === "server_first") out[k] = m;
    }
    return out;
  } catch {
    return {};
  }
}

/** The launch signing mode to try first for this wallet (by its Wallet Standard name). */
export function getWalletMode(walletName: string | null | undefined): ApiSigningMode {
  if (!walletName) return "server_first";
  return readStored()[walletName] ?? KNOWN_WALLET_MODES[walletName] ?? "server_first";
}

/** Call only after a wallet_first launch succeeded (it followed a WALLET_REWROTE_TX in server_first). */
export function rememberWalletFirst(walletName: string | null | undefined): void {
  if (!walletName) return;
  try {
    const all = readStored();
    all[walletName] = "wallet_first";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the next launch tries server_first again and falls back once more.
  }
}

/** Forget every remembered mode (tests, and a manual reset). */
export function forgetWalletModes(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
