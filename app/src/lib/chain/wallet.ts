// Wallet state for the devnet app (refs/chain/m3-contract.md §7.2; wallet-integration R1: Wallet Standard directly,
// no wallet-adapter, no web3.js). This tiny store is safe in the main chunk and in SSR; the Wallet Standard host
// (lib/chain/wallet-host.client.tsx, app:wallet) loads lazily after hydration and registers the real actions.
//
// SCAFFOLD: owner app:wallet. Exported names and types are FROZEN by the contract. The store below is complete;
// the actions throw "not implemented" until the host registers itself with setWalletActions.

import { useSyncExternalStore } from "react";

export interface WalletInfo {
  name: string;
  /** data: URI from the wallet's registration. */
  icon: string;
}

export interface WalletSnapshot {
  /** The host chunk loaded and the Wallet Standard registry was read. */
  ready: boolean;
  /** Registered Solana wallets (StandardConnect + solana:signTransaction + a solana: chain). */
  wallets: WalletInfo[];
  connected: boolean;
  connecting: boolean;
  /** base58 address of the connected account. */
  address: string | null;
  walletName: string | null;
  walletIcon: string | null;
  /** The account lists the build's chain (solana:devnet or solana:mainnet); otherwise the UI asks to switch networks. */
  clusterOk: boolean;
  /** The wallet supports solana:signMessage (needed for Sign-In With Solana). */
  canSignMessage: boolean;
}

export const EMPTY_WALLET: WalletSnapshot = {
  ready: false,
  wallets: [],
  connected: false,
  connecting: false,
  address: null,
  walletName: null,
  walletIcon: null,
  clusterOk: false,
  canSignMessage: false,
};

export interface WalletActions {
  /** Opens the MintDex wallet picker (queued until the host loads). */
  openModal(): void;
  /** Connects the named wallet; `silent` reconnects without a prompt (last wallet, from localStorage). Returns the address. */
  connect(name: string, opts?: { silent?: boolean }): Promise<string>;
  disconnect(): Promise<void>;
  /** solana:signTransaction with chain "solana:devnet" on the exact wire bytes; returns the signed wire bytes. */
  signTransaction(tx: Uint8Array): Promise<Uint8Array>;
  /** solana:signMessage; returns the 64-byte signature. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

let snapshot: WalletSnapshot = EMPTY_WALLET;
let actions: WalletActions | null = null;
let pendingOpen = false;
const listeners = new Set<() => void>();

export function getWalletSnapshot(): WalletSnapshot {
  return snapshot;
}

export function subscribeWallet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The wallet snapshot; EMPTY_WALLET during SSR and before the host loads. */
export function useWalletSnapshot(): WalletSnapshot {
  return useSyncExternalStore(subscribeWallet, getWalletSnapshot, () => EMPTY_WALLET);
}

/** For the lazy host only. */
export function setWalletSnapshot(next: WalletSnapshot): void {
  snapshot = next;
  listeners.forEach((l) => l());
}

/** For the lazy host only (null when it unmounts). */
export function setWalletActions(next: WalletActions | null): void {
  actions = next;
  if (next && pendingOpen) {
    pendingOpen = false;
    next.openModal();
  }
}

function need(): WalletActions {
  if (!actions) throw new Error("not implemented: wallet host (app:wallet) is not loaded");
  return actions;
}

export const wallet: WalletActions = {
  openModal() {
    if (actions) actions.openModal();
    else pendingOpen = true;
  },
  connect: (name, opts) => need().connect(name, opts),
  disconnect: () => need().disconnect(),
  signTransaction: (tx) => need().signTransaction(tx),
  signMessage: (message) => need().signMessage(message),
};
