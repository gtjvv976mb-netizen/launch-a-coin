import { useEffect, useSyncExternalStore } from "react";
import { getWallets } from "@wallet-standard/app";
import { StandardConnect, StandardDisconnect, StandardEvents, type StandardConnectFeature, type StandardDisconnectFeature, type StandardEventsFeature } from "@wallet-standard/features";
import { SolanaSignMessage, SolanaSignTransaction, type SolanaSignMessageFeature, type SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { ed25519 } from "@noble/curves/ed25519.js";
import { MAINNET_CHAIN, fromBase58, sameBytes } from "./transaction";

type Registry = ReturnType<typeof getWallets>;
type Wallet = ReturnType<Registry["get"]>[number];
type Account = Wallet["accounts"][number];
type Active = { wallet: Wallet; account: Account };
export type LiveWalletSnapshot = {
  ready: boolean; wallets: Array<{ name: string; icon: string }>;
  address: string | null; name: string | null; mainnet: boolean;
  connecting: string | null; canSignMessage: boolean;
};
const EMPTY: LiveWalletSnapshot = { ready: false, wallets: [], address: null, name: null, mainnet: false, connecting: null, canSignMessage: false };
let snapshot = EMPTY, active: Active | null = null, registry: Registry | null = null;
let available: Wallet[] = [], hostUsers = 0;
let stopRegistry: (() => void) | null = null, stopActive: (() => void) | null = null;
const listeners = new Set<() => void>();
const supported = (w: Wallet) => StandardConnect in w.features && SolanaSignTransaction in w.features && w.chains.some(chain => chain.startsWith("solana:"));
const onMainnet = (a: Active) => (a.account.chains.length ? a.account.chains : a.wallet.chains).includes(MAINNET_CHAIN);
function publish(connecting: string | null = snapshot.connecting) {
  snapshot = { ready: true, wallets: available.map(w => ({ name: w.name, icon: w.icon })), address: active?.account.address ?? null, name: active?.wallet.name ?? null, mainnet: !!active && onMainnet(active), connecting, canSignMessage: !!active && SolanaSignMessage in active.wallet.features && (!active.account.features.length || active.account.features.includes(SolanaSignMessage)) };
  listeners.forEach(fn => fn());
}
function setActive(next: Active | null) {
  stopActive?.(); stopActive = null; active = next;
  if (next) {
    const events = next.wallet.features[StandardEvents] as StandardEventsFeature[typeof StandardEvents] | undefined;
    stopActive = events?.on("change", props => {
      if (active?.wallet !== next.wallet) return;
      const account = props.accounts ? props.accounts[0] : next.wallet.accounts.find(a => a.address === active?.account.address) ?? active.account;
      setActive(account ? { wallet: next.wallet, account } : null);
    }) ?? null;
  }
  publish();
}
/** Holds the wallet registry open (AppShell keeps it mounted across pages); returns the release. */
export function mountRegistry() {
  hostUsers++;
  if (!registry) {
    registry = getWallets();
    const refresh = () => {
      available = registry!.get().filter(supported);
      if (active && !available.includes(active.wallet)) setActive(null);
      publish();
    };
    const offRegister = registry.on("register", refresh), offUnregister = registry.on("unregister", refresh);
    stopRegistry = () => { offRegister(); offUnregister(); };
    refresh();
  }
  return () => {
    hostUsers--;
    if (hostUsers > 0) return;
    stopRegistry?.(); stopRegistry = null;
    stopActive?.(); stopActive = null;
    registry = null; available = []; active = null; snapshot = EMPTY;
    listeners.forEach(fn => fn());
  };
}
export function useLiveWallet() {
  const state = useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snapshot, () => EMPTY);
  useEffect(mountRegistry, []);
  return state;
}
export function getLiveWalletSnapshot() { return snapshot; }
export async function connectLiveWallet(name: string) {
  const chosen = available.find(w => w.name === name);
  if (!chosen) throw new Error("That wallet is not available in this browser.");
  publish(name);
  try {
    const feature = chosen.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect];
    const result = await feature.connect();
    const accounts = result.accounts.length ? result.accounts : chosen.accounts;
    const account = accounts.find(a => a.chains.includes(MAINNET_CHAIN)) ?? accounts[0];
    if (!account) throw new Error("Your wallet did not share an account.");
    if (fromBase58(account.address).length !== 32) throw new Error("Your wallet returned an invalid Solana account.");
    setActive({ wallet: chosen, account });
    return account.address;
  } finally { publish(null); }
}
export async function disconnectLiveWallet() {
  const previous = active; setActive(null);
  const feature = previous?.wallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined;
  try { await feature?.disconnect(); } catch { /* Local access has already been released. */ }
}
function needWallet(expectedAddress: string) {
  if (!active || active.account.address !== expectedAddress) throw new Error("Your wallet account changed. Reconnect the creator wallet before continuing.");
  if (!onMainnet(active)) throw new Error("Switch this wallet account to Solana mainnet before continuing.");
  return active;
}
export async function signLiveMessage(message: Uint8Array, expectedAddress: string) {
  const current = needWallet(expectedAddress);
  if (current.account.features.length && !current.account.features.includes(SolanaSignMessage)) throw new Error("This wallet account does not support ownership-message signing.");
  const feature = current.wallet.features[SolanaSignMessage] as SolanaSignMessageFeature[typeof SolanaSignMessage] | undefined;
  if (!feature) throw new Error("This wallet cannot prove ownership with a signed message. Choose a wallet with Solana message signing.");
  const [out] = await feature.signMessage({ account: current.account, message });
  needWallet(expectedAddress);
  if (!out || !sameBytes(out.signedMessage, message) || !ed25519.verify(out.signature, message, fromBase58(expectedAddress))) throw new Error("The wallet did not sign the exact ownership message. No transaction was requested.");
  return out.signature;
}
/**
 * One solana:signTransaction prompt (never sign-and-send: the page adds its signature and the server checks and saves
 * the bytes before anything is broadcast). Returns the wallet's bytes as they are; signPlanWithWallet checks them.
 * No minContextSlot: the plan's slot is the newest the server saw, and a wallet RPC a slot behind would fail its
 * simulation and warn.
 */
export async function signLiveTransaction(transaction: Uint8Array, expectedAddress: string) {
  const current = needWallet(expectedAddress);
  if (current.account.features.length && !current.account.features.includes(SolanaSignTransaction)) throw new Error("This wallet account does not support transaction signing.");
  const feature = current.wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction];
  if (!feature.supportedTransactionVersions.includes(0)) throw new Error("This wallet does not support the version 0 launch transaction.");
  const [out] = await feature.signTransaction({ account: current.account, transaction, chain: MAINNET_CHAIN, options: { preflightCommitment: "confirmed" } });
  needWallet(expectedAddress);
  if (!out?.signedTransaction?.length) throw new Error("The wallet returned no signed transaction. Nothing was submitted.");
  return new Uint8Array(out.signedTransaction);
}
