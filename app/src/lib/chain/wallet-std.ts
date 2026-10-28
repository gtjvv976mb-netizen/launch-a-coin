// Pure Wallet Standard helpers of the wallet host (refs/chain/m3-contract.md §7.2): which wallets MintDex lists,
// which account it uses, when an account counts as devnet, and the snapshot the app reads. No React, no DOM, so the
// app tests can run them on fake wallets (app/tests/chain/wallet-std.test.ts). Lazy chunk (the host imports it).
// Owner: app:wallet.

import type { getWallets } from "@wallet-standard/app";
import { StandardConnect } from "@wallet-standard/features";
import { SolanaSignMessage, SolanaSignTransaction } from "@solana/wallet-standard-features";

import { SOLANA_CHAIN } from "./env";
import type { WalletSnapshot } from "./wallet";

type Registry = ReturnType<typeof getWallets>;
/** A Wallet Standard wallet (the type comes through @wallet-standard/app, so @wallet-standard/base needs no install). */
export type StdWallet = ReturnType<Registry["get"]>[number];
export type StdAccount = StdWallet["accounts"][number];
export type Active = { wallet: StdWallet; account: StdAccount };

/** A wallet MintDex can use: connect, sign transactions, and some Solana chain. */
export function isSolanaWallet(w: StdWallet): boolean {
  return StandardConnect in w.features && SolanaSignTransaction in w.features && w.chains.some((c) => c.startsWith("solana:"));
}

/** The account (or, when it lists no chains, its wallet) is on the build's cluster (SOLANA_CHAIN). */
export function onCluster(a: Active): boolean {
  const chains = a.account.chains.length ? a.account.chains : a.wallet.chains;
  return chains.includes(SOLANA_CHAIN);
}

/** The first account that lists the build's chain, else the first account. */
export function pickAccount(accounts: readonly StdAccount[]): StdAccount | null {
  return accounts.find((a) => a.chains.includes(SOLANA_CHAIN)) ?? accounts[0] ?? null;
}

export function canSignMessage(a: Active): boolean {
  if (!(SolanaSignMessage in a.wallet.features)) return false;
  return a.account.features.length === 0 || a.account.features.includes(SolanaSignMessage);
}

export function snapshotOf(list: readonly StdWallet[], active: Active | null, connecting: boolean): WalletSnapshot {
  return {
    ready: true,
    wallets: list.map((w) => ({ name: w.name, icon: w.icon })),
    connected: !!active,
    connecting,
    address: active?.account.address ?? null,
    walletName: active?.wallet.name ?? null,
    walletIcon: active?.wallet.icon ?? null,
    clusterOk: !!active && onCluster(active),
    canSignMessage: !!active && canSignMessage(active),
  };
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * After an accounts change: none means disconnected; otherwise the wallet's first account, which Phantom, Solflare
 * and Backpack keep as the selected one (an account switch inside the wallet).
 */
export function pickAccountAfterChange(accounts: readonly StdAccount[]): StdAccount | null {
  return accounts[0] ?? null;
}
