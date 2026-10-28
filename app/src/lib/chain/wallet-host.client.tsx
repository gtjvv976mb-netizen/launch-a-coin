// The Wallet Standard host (refs/chain/m3-contract.md §7.2; wallet-integration R1 and §2.5, from
// refs/chain/wallet-spike/app-src/lib/solana/WalletHostStandard.client.tsx). Browser only, lazy: WalletMount loads it
// with createClientOnlyFn + React.lazy + an error boundary after hydration and idle, so none of this reaches the
// server bundle or the main client chunk. Owner: app:wallet.
//
// What it does:
//   - lists the registered Solana wallets (StandardConnect + solana:signTransaction + a solana: chain); Phantom,
//     Solflare and Backpack all register through the Wallet Standard, so no per-wallet package is needed;
//   - connects and disconnects, reconnects silently to the last wallet name (localStorage) once it registers;
//   - follows standard:events (account switches and disconnects inside the wallet, chain or feature changes) and
//     the registry (a wallet that unregisters is disconnected);
//   - flags an account that does not list solana:devnet (clusterOk false: "Switch your wallet to devnet") and refuses
//     to sign for it;
//   - signs with chain "solana:devnet" on the exact wire bytes it is given (flows.ts verified them first) and signs
//     messages only when the wallet signed the exact bytes (SIWS needs that);
//   - renders the MintDex wallet picker (components/chain/WalletModal.tsx).
// No web3.js, no wallet-adapter: three small packages (@wallet-standard/app, /features, @solana/wallet-standard-features).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getWallets } from "@wallet-standard/app";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";

import { WalletModal } from "../../components/chain/WalletModal";
import { useToast } from "../../components/mintdex/ui";
import { NET_NAME, SOLANA_CHAIN } from "./env";
import { ChainClientError } from "./errors";
import { dropWalletIntent } from "./identity";
import { EMPTY_WALLET, setWalletActions, setWalletSnapshot } from "./wallet";
import { WALLET_COPY } from "./wallet-copy";
import { isSolanaWallet, onCluster, pickAccount, pickAccountAfterChange, sameBytes, snapshotOf, type StdWallet, type StdAccount } from "./wallet-std";

type Active = { wallet: StdWallet; account: StdAccount };

type Registry = ReturnType<typeof getWallets>;

const LAST_WALLET_KEY = "mintdex.wallet";

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
}
function writeLast(name: string | null) {
  try {
    if (name) localStorage.setItem(LAST_WALLET_KEY, name);
    else localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    // storage blocked: no silent reconnect next time
  }
}

// ---------------------------------------------------------------- the registry as an external store

let registry: Registry | null = null;
let cache: StdWallet[] = [];
function reg(): Registry {
  if (!registry) {
    registry = getWallets();
    cache = registry.get().filter(isSolanaWallet);
  }
  return registry;
}
function subscribeWallets(cb: () => void) {
  const r = reg();
  const refresh = () => {
    cache = r.get().filter(isSolanaWallet);
    cb();
  };
  const offA = r.on("register", refresh);
  const offB = r.on("unregister", refresh);
  return () => {
    offA();
    offB();
  };
}
function listSnapshot() {
  reg();
  return cache;
}

// ---------------------------------------------------------------- the host

export default function WalletHost() {
  const wallets = useSyncExternalStore(subscribeWallets, listSnapshot, listSnapshot);
  const [active, setActiveState] = useState<Active | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Refs for the actions the store calls (they must see the latest state without re-registering).
  const activeRef = useRef<Active | null>(null);
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const triedSilent = useRef(new Set<string>());

  const setActive = useCallback((next: Active | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);

  const connect = useCallback(
    async (name: string, opts: { silent?: boolean } = {}): Promise<string> => {
      const w = walletsRef.current.find((x) => x.name === name);
      if (!w) throw new ChainClientError("WALLET_NOT_CONNECTED", "That wallet is not available in this browser.");
      setConnecting(name);
      try {
        const f = w.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect];
        const res = await f.connect(opts.silent ? { silent: true } : undefined);
        const account = pickAccount(res.accounts.length ? res.accounts : w.accounts);
        if (!account) throw new ChainClientError("WALLET_NOT_CONNECTED", "The wallet shared no account.");
        setActive({ wallet: w, account });
        writeLast(w.name);
        return account.address;
      } catch (e) {
        if (e instanceof ChainClientError) throw e;
        throw new ChainClientError(
          opts.silent ? "WALLET_NOT_CONNECTED" : "WALLET_REJECTED",
          e instanceof Error && e.message ? e.message : WALLET_COPY.connectFailed,
        );
      } finally {
        setConnecting(null);
      }
    },
    [setActive],
  );

  // Silent reconnect to the last wallet, once per registration (a wallet extension can register late).
  useEffect(() => {
    if (activeRef.current) return;
    const last = readLast();
    if (!last || triedSilent.current.has(last)) return;
    if (!wallets.some((w) => w.name === last)) return;
    triedSilent.current.add(last);
    void connect(last, { silent: true }).catch(() => undefined);
  }, [wallets, connect]);

  // The active wallet left the registry (extension disabled): disconnected.
  useEffect(() => {
    const cur = activeRef.current;
    if (cur && !wallets.includes(cur.wallet)) setActive(null);
  }, [wallets, setActive]);

  // Account switches, disconnects, chain and feature changes from inside the wallet.
  const activeWallet = active?.wallet ?? null;
  useEffect(() => {
    if (!activeWallet) return;
    const ev = activeWallet.features[StandardEvents] as StandardEventsFeature[typeof StandardEvents] | undefined;
    if (!ev) return;
    return ev.on("change", (props) => {
      const cur = activeRef.current;
      if (!cur || cur.wallet !== activeWallet) return;
      if (props.accounts) {
        const next = pickAccountAfterChange(props.accounts);
        setActive(next ? { wallet: activeWallet, account: next } : null);
        return;
      }
      // Chains or features changed: re-read the same account so clusterOk and canSignMessage follow.
      const fresh = activeWallet.accounts.find((a) => a.address === cur.account.address) ?? cur.account;
      setActive({ wallet: activeWallet, account: fresh });
    });
  }, [activeWallet, setActive]);

  // The connected wallet's card, menus and sheet (a lazy chunk of their own): fetch them now, so they are there
  // by the time any wallet connects (a wallet can only connect through this host).
  useEffect(() => {
    void import("../../components/chain/WalletMenus").catch(() => undefined);
  }, []);

  // The snapshot every component reads.
  useEffect(() => {
    setWalletSnapshot(snapshotOf(wallets, active, connecting !== null));
  }, [wallets, active, connecting]);

  // The actions the store forwards (registered once).
  useEffect(() => {
    setWalletActions({
      openModal: () => {
        setError(null);
        setOpen(true);
      },
      connect,
      disconnect: async () => {
        const cur = activeRef.current;
        setActive(null);
        writeLast(null);
        const f = cur?.wallet.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined;
        try {
          await f?.disconnect();
        } catch {
          // The app has let go already; a wallet that fails to disconnect keeps its own state.
        }
      },
      signTransaction: async (tx: Uint8Array) => {
        const cur = activeRef.current;
        if (!cur) throw new ChainClientError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
        if (!onCluster(cur)) throw new ChainClientError("WRONG_NETWORK", `This wallet account is not on ${NET_NAME}.`);
        const f = cur.wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction];
        if (!f.supportedTransactionVersions.includes(0)) {
          throw new ChainClientError("WALLET_REJECTED", "This wallet cannot sign version 0 transactions.");
        }
        const [out] = await f.signTransaction({ account: cur.account, transaction: tx, chain: SOLANA_CHAIN });
        if (!out || !(out.signedTransaction instanceof Uint8Array) || out.signedTransaction.length === 0) {
          throw new ChainClientError("WALLET_REJECTED", "The wallet returned no signed transaction.");
        }
        return new Uint8Array(out.signedTransaction);
      },
      signMessage: async (message: Uint8Array) => {
        const cur = activeRef.current;
        if (!cur) throw new ChainClientError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
        const f = cur.wallet.features[SolanaSignMessage] as SolanaSignMessageFeature[typeof SolanaSignMessage] | undefined;
        if (!f) throw new ChainClientError("SIGNATURE_INVALID", WALLET_COPY.handleNoSign);
        const [out] = await f.signMessage({ account: cur.account, message });
        // Sign-In With Solana verifies the exact text: a wallet that prefixed or edited it produced a useless signature.
        if (!out || (out.signedMessage && !sameBytes(out.signedMessage, message))) {
          throw new ChainClientError("SIGNATURE_INVALID", "The wallet changed the sign-in message, so it cannot be used.");
        }
        if (!(out.signature instanceof Uint8Array) || out.signature.length !== 64) {
          throw new ChainClientError("SIGNATURE_INVALID", "The wallet returned an unusable signature.");
        }
        return new Uint8Array(out.signature);
      },
    });
    return () => {
      setWalletActions(null);
      setWalletSnapshot(EMPTY_WALLET);
    };
  }, [connect, setActive]);

  async function pick(name: string) {
    setError(null);
    try {
      await connect(name);
      setOpen(false);
      toast("ok", WALLET_COPY.connected(name));
    } catch {
      setError(WALLET_COPY.connectFailed);
    }
  }

  return (
    <WalletModal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && !activeRef.current) dropWalletIntent();
      }}
      wallets={wallets.map((w) => ({ name: w.name, icon: w.icon }))}
      connecting={connecting}
      error={error}
      onPick={(name) => void pick(name)}
    />
  );
}
