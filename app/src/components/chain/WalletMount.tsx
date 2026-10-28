/**
 * Mounts the Wallet Standard host once, in the root (devnet only: `IS_SIM ? null : <WalletMount />`).
 * Renders nothing on the server and on the first client frame; after hydration, at idle, it loads the host chunk.
 * (refs/chain/m3-contract.md §7.2, wallet-integration §2.2.)
 *
 * TanStack Start's import protection refuses *.client.* imports from server-reachable code, even through import():
 * createClientOnlyFn strips the loader from the server build, so the wallet packages never reach the Worker, and
 * React.lazy keeps them out of the main client chunk. A failed chunk (network, CSP) must never take the page
 * down: the error boundary swallows it (the store stays EMPTY and Connect keeps queueing the picker).
 *
 * Owner: app:wallet.
 */
import { createClientOnlyFn } from "@tanstack/react-start";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

const loadWalletHost = createClientOnlyFn(() => import("../../lib/chain/wallet-host.client"));

const WalletHost = lazy(async () => {
  const mod = await loadWalletHost();
  if (!mod) throw new Error("wallet host is client only");
  return mod;
});

class WalletBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[wallet] host failed to load", error instanceof Error ? error.message : error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function WalletMount() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // Idle, so wallet code never competes with first paint and hydration; a click on Connect before then is
    // queued by the store (wallet.openModal) and opens the picker as soon as the host registers.
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setOn(true), { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setOn(true), 1);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <WalletBoundary>
      <Suspense fallback={null}>
        <WalletHost />
      </Suspense>
    </WalletBoundary>
  );
}
