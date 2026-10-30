import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { checkRev as chainCheckRev } from "../../lib/chain/client";
import { FLOW } from "../../lib/mintdex/copy";
import type { Me } from "../../lib/mintdex/types";
import type { Viewport } from "../../lib/mintdex/viewport";
import { useToast, type ActionState, type Feedback, type ToastAction } from "./ui";

// Keyboard paging, live number flashes and ticks, arrivals and the reduced motion check live with the
// primitives; re-exported for convenience.
export { prefersReducedMotion, useArrivals, useFlash, usePageKeys, useTick } from "./ui";

const rootApi = getRouteApi("__root__");

/**
 * The root loader's clock: Date.now() when the page's data was loaded, the same number on the server and
 * in the hydrating client (it travels with the dehydrated loader data). Use it for any first-frame value
 * that depends on the time, never Date.now() during render.
 */
export function useLoaderNow(): number | undefined {
  const data = rootApi.useLoaderData() as { now?: number } | undefined;
  return data?.now;
}

/**
 * The viewport the root loader read from the mdx_vp cookie (P1-20): the same value on the server and in the
 * hydrating client. A first visit has the phone guess on phones (viewport.ts) and null elsewhere. Fitted views use
 * it to size their server HTML for this screen.
 */
export function useLoaderViewport(): Viewport | null {
  const data = rootApi.useLoaderData() as { vp?: Viewport | null } | undefined;
  return data?.vp ?? null;
}

/**
 * A clock for relative timestamps ("37s ago"), refreshed every 15s on the client. The first frame uses the
 * root loader's clock, so the server HTML and the hydrating client print the same text (no hydration
 * mismatch); a layout effect then moves to the real time before the first paint.
 */
export function useNow(every = 15_000) {
  const loaderNow = useLoaderNow();
  const [now, setNow] = useState(() => loaderNow ?? 0);
  // Layout effect on the client (before paint), plain effect on the server (where it never runs).
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** A write's answer: its fields, or why it failed (never a throw for an expected failure). */
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------- the wallet in the cache

/**
 * Put a write's fresh wallet into the ['me'] cache (P0-12). Write results leave the inbox out (only the getMe
 * read carries it), so the badge keeps the inbox it had until the next poll.
 */
export function setMe(qc: QueryClient, me: Me) {
  qc.setQueryData<Me>(["me"], (old) =>
    me ? { ...me, inbox: me.inbox ?? old?.inbox ?? undefined } : me,
  );
}

// ---------------------------------------------------------------- polls that skip unchanged data (P0-12)

/** The revision each poll last saw, by query key. */
const heldRev = new Map<string, string>();

function revIn(data: unknown): string | undefined {
  if (data && typeof data === "object" && "rev" in data) {
    const r = (data as { rev?: unknown }).rev;
    if (typeof r === "string") return r;
  }
  return undefined;
}

/**
 * A query function for a polled read that first asks checkRev (one tiny read) whether anything changed since
 * the revision this query last saw, and keeps the data it has when nothing did. Reads that carry `rev` (home,
 * coin, market, portfolio) seed it from their own snapshot; others (Discover's list) learn it from checkRev,
 * read before the data so the held revision is never newer than the data. Any failure falls back to a plain
 * fetch. Revisions roll every minute, so 24h figures still refresh.
 */
/** The revision check behind revPoll: GET /api/chain/rev (m3-contract §3.8), for the inherited chain pages. */
const askRev: (rev?: string) => Promise<{ rev: string; changed: boolean }> = (rev) => chainCheckRev(rev);

export function revPoll<T>(
  qc: QueryClient,
  key: QueryKey,
  fetch: () => Promise<T>,
  revOf: (data: T) => string | undefined = revIn,
) {
  return async (): Promise<T> => {
    const hash = JSON.stringify(key);
    const prev = qc.getQueryData<T>(key);
    const held = heldRev.get(hash) ?? (prev !== undefined ? revOf(prev) : undefined);
    try {
      if (prev !== undefined && held) {
        const r = await askRev(held);
        if (!r.changed) return prev;
        const next = await fetch();
        heldRev.set(hash, revOf(next) ?? r.rev);
        return next;
      }
      const r = await askRev();
      const next = await fetch();
      heldRev.set(hash, revOf(next) ?? r.rev);
      return next;
    } catch {
      heldRev.delete(hash);
      return fetch();
    }
  };
}

// ---------------------------------------------------------------- money actions (P0-12, P1-8)

type Status = { state: ActionState; seq: number; error?: string };

export type RunOptions<T> = {
  /**
   * The queries this action changes, refetched in the background once the server answers (P0-12), for
   * example ['coin', id], ['portfolio']. ['me'] is always set from the answer itself. Omit to refresh all.
   */
  keys?: QueryKey[];
  /** A link on the success toast ("View in portfolio"); a toast with an action stays until dismissed. */
  action?: ToastAction | ((r: { ok: true } & T) => ToastAction | undefined);
  /** Patch caches from the answer before the background refetch lands (exact server values, P1-8 step 3). */
  patch?: (r: { ok: true } & T, qc: QueryClient) => void;
};

/** How long the success label ("Bought") holds on the button before it returns to its idle label. */
const SUCCESS_HOLD_MS = 1100;

/**
 * Wrap a server mutation (P0-12, P1-8). Each action key has a status: idle, pending, success or error, with
 * "signing" and "confirming" reserved for devnet wallets. The button frees up the moment the server answers:
 * the wallet comes from the answer, and only the affected queries refetch, in the background. Success holds
 * for 1.1s (the button shows a drawn check and its done label), errors stay until the next try or reset(key),
 * so the form can mark its field invalid. Every outcome also toasts (errors through the alert region).
 */
export function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Record<string, Status>>({});
  const seq = useRef(0);
  const holds = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = holds.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const set = useCallback((key: string, next: Status | null) => {
    const h = holds.current.get(key);
    if (h) {
      clearTimeout(h);
      holds.current.delete(key);
    }
    setStatus((s) => {
      const copy = { ...s };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  }, []);

  const run = useCallback(
    async <T extends object>(
      key: string,
      call: () => Promise<Result<T>>,
      success?: string | ((r: { ok: true } & T) => string | null),
      opts: RunOptions<T> = {},
    ): Promise<({ ok: true } & T) | null> => {
      set(key, { state: "pending", seq: ++seq.current });
      let res: Result<T>;
      try {
        res = await call();
      } catch {
        set(key, { state: "error", seq: ++seq.current, error: FLOW.connection });
        toast("err", FLOW.connection);
        return null;
      }
      if (!res.ok) {
        set(key, { state: "error", seq: ++seq.current, error: res.error });
        toast("err", res.error);
        return null;
      }
      // Free the button now: the answer carries the fresh wallet; everything else refreshes behind it.
      if ("me" in res) setMe(qc, (res as { me: Me }).me);
      opts.patch?.(res, qc);
      set(key, { state: "success", seq: ++seq.current });
      holds.current.set(
        key,
        setTimeout(() => {
          holds.current.delete(key);
          setStatus((s) => {
            if (s[key]?.state !== "success") return s;
            const copy = { ...s };
            delete copy[key];
            return copy;
          });
        }, SUCCESS_HOLD_MS),
      );
      const msg = typeof success === "function" ? success(res) : success;
      const action = typeof opts.action === "function" ? opts.action(res) : opts.action;
      if (msg) toast("ok", msg, action ? { action } : undefined);
      if (opts.keys) {
        for (const k of opts.keys) void qc.invalidateQueries({ queryKey: k });
      } else {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      }
      return res;
    },
    [qc, toast, set],
  );

  const pendingKey = Object.keys(status).find((k) => status[k].state === "pending") ?? null;

  /** The feedback a Button shows for this key. */
  const feedback = useCallback(
    (key: string): Feedback => (status[key] ? { state: status[key].state, seq: status[key].seq } : null),
    [status],
  );
  /** The server's (or the network's) error for this key, until the next try or reset. */
  const errorOf = useCallback(
    (key: string) => (status[key]?.state === "error" ? status[key].error : undefined),
    [status],
  );
  /** Forget an error (the player edited the field). */
  const reset = useCallback(
    (key: string) => {
      if (status[key]?.state === "error") set(key, null);
    },
    [status, set],
  );

  return { run, pending: pendingKey, feedback, errorOf, reset, status };
}
