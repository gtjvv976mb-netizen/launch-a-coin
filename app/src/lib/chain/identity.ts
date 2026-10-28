// The devnet identity (refs/chain/m3-contract.md §2.2, §8.0): the connected wallet IS the player. useChainMe() hands
// the existing components the same `Me` shape the simulation's useMe() returns, so they keep rendering:
//   { id: address, handle: handle ?? short address, balance (lamports), canFaucet: false, faucetReadyAt: null }.
// No handle login, no faucet, no test SOL. Owner: app:wallet.
//
//   - balance: POST /api/chain/rpc getBalance (query key ["me", address], so the pages' invalidateQueries(["me"])
//     after a transaction refreshes it), every API_LIMITS.revPollMs while the tab is visible and every
//     pendingPollMs for a while after the viewer's own transaction; the public devnet RPC answers if the relay
//     cannot (display only, never a trust input);
//   - handle: the SIWS session's handle, else the wallet read's (GET /wallets/:address, once per address, seeding
//     the pages' ["chain-wallet", address] cache), else the short address ("BiHs...dFtQ");
//   - null while no wallet is connected or before the first balance read answers, so a button never shows
//     "not enough SOL" for a balance nobody has read yet.

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { API_LIMITS, type ApiWallet } from "@mintdex/chain-sdk/api";

import type { Me } from "../mintdex/types";
import { getBalance, getSession, getWallet } from "./client";
import { isBoosted } from "./data";
import { PUBLIC_RPC_URL } from "./env";
import { getWalletSnapshot, subscribeWallet, useWalletSnapshot, wallet } from "./wallet";

const SSR = typeof window === "undefined";

/** "BiHs...dFtQ": the handle stand-in until a wallet sets one (the pages test for the "..." to tell them apart). */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

export const meKey = (address: string | null) => ["me", address ?? ""] as const;
export const handleKey = (address: string | null) => ["chain-handle", address ?? ""] as const;

// ---------------------------------------------------------------- reads

/**
 * The public devnet RPC's getBalance (display only, never a trust input). Browser only: in the server build this is
 * null, which keeps PUBLIC_RPC_URL out of the server's chunks (see client.ts browserOnly).
 */
const publicBalance = import.meta.env.SSR
  ? null
  : async (address: string): Promise<number | null> => {
      try {
        const res = await fetch(PUBLIC_RPC_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
        });
        const json = (await res.json()) as { result?: { value?: unknown } };
        const v = json.result?.value;
        return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
      } catch {
        return null;
      }
    };

/** Lamports through the chain API's relay, or the public devnet RPC when the relay cannot answer. */
export async function readBalance(address: string): Promise<number> {
  try {
    return Number(await getBalance(address));
  } catch (relayError) {
    const v = publicBalance ? await publicBalance(address) : null;
    if (v !== null) return v;
    throw relayError;
  }
}

/** The wallet's MintDex handle (null when it has none). */
async function readHandle(qc: QueryClient, address: string): Promise<string | null> {
  const s = getSession();
  if (s && s.address === address && s.handle) return s.handle;
  const cached = qc.getQueryData<ApiWallet>(["chain-wallet", address]);
  if (cached) return cached.handle;
  const w = (await getWallet(address)).wallet;
  qc.setQueryData(["chain-wallet", address], w);
  return w.handle;
}

/** The handle just changed (setHandle answered): show it everywhere at once. */
export function setChainHandle(qc: QueryClient, address: string, handle: string): void {
  qc.setQueryData(handleKey(address), handle);
  qc.setQueryData<ApiWallet>(["chain-wallet", address], (w) => (w ? { ...w, handle } : w));
}

// ---------------------------------------------------------------- the hook

/** Devnet useMe(): the connected wallet in the `Me` shape, or null. */
export function useChainMe(): Me {
  const snap = useWalletSnapshot();
  const qc = useQueryClient();
  const address = snap.connected ? snap.address : null;
  const enabled = !SSR && !!address;

  const balance = useQuery({
    queryKey: meKey(address),
    queryFn: () => readBalance(address!),
    enabled,
    staleTime: 5_000,
    // Fast for a while after the viewer's own transaction (the pages boost "wallet:{address}"), else 20 s (§3.8).
    refetchInterval: () => (isBoosted(`wallet:${address}`) ? API_LIMITS.pendingPollMs : API_LIMITS.revPollMs),
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const handle = useQuery({
    queryKey: handleKey(address),
    queryFn: () => readHandle(qc, address!),
    enabled,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const lamports = balance.data;
  const name = handle.data;
  return useMemo<Me>(() => {
    if (!address || typeof lamports !== "number") return null;
    return {
      id: address,
      handle: name || shortAddress(address),
      balance: lamports,
      canFaucet: false,
      faucetReadyAt: null,
    };
  }, [address, lamports, name]);
}

// ---------------------------------------------------------------- "connect first, then do it" (useRequireMe on devnet)

const INTENT_TTL_MS = 2 * 60_000;
let pending: { run: () => void; until: number } | null = null;
let watching = false;

function watch() {
  if (watching || SSR) return;
  watching = true;
  let was = getWalletSnapshot().connected;
  subscribeWallet(() => {
    const s = getWalletSnapshot();
    const now = s.connected && !!s.address;
    if (now && !was && pending) {
      const p = pending;
      pending = null;
      // Finish what they started (the sim's P1-11), once the picker has closed and handed focus back.
      if (p.until > Date.now()) setTimeout(p.run, 0);
    }
    if (!now) pending = pending && pending.until > Date.now() ? pending : null;
    was = now;
  });
}

/**
 * The devnet stand-in for the Enter dialog: a connected wallet runs `run` at once; otherwise the wallet picker opens
 * and `run` follows as soon as a wallet connects (within two minutes, else it is dropped).
 */
export function requestWallet(run?: () => void): void {
  const s = getWalletSnapshot();
  if (s.connected && s.address) {
    run?.();
    return;
  }
  watch();
  pending = run ? { run, until: Date.now() + INTENT_TTL_MS } : null;
  wallet.openModal();
}

/**
 * Devnet useRequireMe(): the guard runs `fn` when a wallet is connected (even before its balance is read), otherwise
 * it opens the wallet picker and runs `fn` once a wallet connects. Same signature as the sim's (reason and label are
 * the sim's Enter dialog words; the picker does not need them).
 */
export function useChainRequireMe(): (fn: () => void, reason?: string, label?: string) => void {
  return useCallback((fn: () => void) => requestWallet(fn), []);
}

/** The picker closed without a wallet: forget the action it would have finished. */
export function dropWalletIntent(): void {
  pending = null;
}
