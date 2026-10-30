import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { requestWallet, useChainMe, useChainRequireMe } from "../../lib/chain/identity";
import { IS_SIM } from "../../lib/mintdex/mode";
import type { Me } from "../../lib/mintdex/types";

const rootApi = getRouteApi("__root__");

/*
 * Launch a Card has no accounts of its own: a creator's identity is the mainnet wallet they connect to launch
 * (components/carddex/live). What remains here is the "How it works" opener every page shares, and the identity the
 * inherited chain pages (components/chain, never mounted in this build) read.
 */

const noAccount = (): Me => null;

/** The inherited chain pages' player: the connected devnet wallet there; nobody in this build. */
export const useMe: () => Me = IS_SIM ? noAccount : useChainMe;

/**
 * True on the devnet test site (lib/mintdex/site-host.ts), whose one-line banner above every page already says that
 * devnet SOL has no real value. From the root loader, so the server HTML and the hydrating client agree. Always false
 * in this build.
 */
export function useDevnetSite(): boolean {
  return rootApi.useLoaderData({ select: (d) => !!(d as { devnetSite?: boolean } | undefined)?.devnetSite });
}

export type Intent = { label: string; run: () => void };

type Ctx = { openEnter: (reason?: string, intent?: Intent) => void; openGuide: () => void };
const SessionCtx = createContext<Ctx>({ openEnter: () => {}, openGuide: () => {} });

export function useSessionUi() {
  return useContext(SessionCtx);
}

/** The inherited chain pages' guard: runs `fn` once a wallet is connected. Nothing here asks for an account. */
export const useRequireMe: () => (fn: () => void, reason?: string, label?: string) => void = IS_SIM
  ? () => (fn: () => void) => fn()
  : useChainRequireMe;

export function SessionProvider({ children }: { children: ReactNode }) {
  // Only the inherited chain pages ask for a wallet this way (lib/chain/identity.ts requestWallet).
  const openEnter = useCallback((_reason?: string, i?: Intent) => {
    if (!IS_SIM) requestWallet(i?.run);
  }, []);
  // The guide is a page (/how): every "How it works" entry opens it. An old ?guide=1 link redirects there in the root
  // route's beforeLoad.
  const navigate = useNavigate();
  const openGuide = useCallback(() => void navigate({ to: "/how" }), [navigate]);
  const value = useMemo(() => ({ openEnter, openGuide }), [openEnter, openGuide]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
