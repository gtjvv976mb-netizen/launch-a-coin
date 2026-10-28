// Server functions: the only door between the UI and the database.
// Reads are GET, every state change is POST. Mutations never throw on
// expected failures; they resolve { ok: false, error } so the UI can say why.
//
// Speed rules (backlog P0-3, P1-3, P0-12):
// - Seeding is checked once per isolate and bot activity runs after the response (kickAmbient), so no read
//   ever waits on either.
// - Each read is one D1 round trip, and carries `rev`, the data revision of its snapshot.
// - Each write answers with `me` (the player's fresh balance and faucet state) and `rev`, read in the same
//   batch as the write, so the client can free the button and update the wallet without refetching.
// - checkRev tells a poller whether anything changed since the revision it holds (one tiny read).

import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { REPORT_REASON_VALUES } from "./copy";
import { NOINDEX_COINS, NOINDEX_PORTFOLIO } from "./seo";
import { currentUser, enterWithHandle, requireUser, sessionTokenHash, signOutCurrent } from "./server/auth.server";
import { UserError, revString, type Settled } from "./server/db.server";
import { ensureSeeded, kickAmbient } from "./server/seed.server";
import * as svc from "./server/service.server";
import { MAX_LEVEL } from "./tiers";
import type { CoinPage, Me } from "./types";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** What every successful write adds to its result (P0-12). */
export type Fresh = { me: Me; rev: string | null };

async function fresh(s: Settled): Promise<Fresh> {
  return { me: await svc.getMe(s.me), rev: s.rev == null ? null : revString(s.rev) };
}

async function attempt<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    await ensureSeeded();
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }
}

/** Before any read: the once-per-isolate seed check (free after the first call) and a non-blocking bot tick. */
async function readPrelude() {
  await ensureSeeded();
  kickAmbient();
}

/** Keep a page out of search (the document response when the call runs during SSR). */
function noindex() {
  try {
    setResponseHeader("X-Robots-Tag", "noindex");
  } catch {
    // No response to decorate (called outside a request): the head tag still says noindex.
  }
}

/** Canonical coin ids, the form every in-app link uses. */
const CANONICAL_ID = /^[a-z0-9_]{2,16}$/;
/** Coin parameters as people type them: ids, tickers, $TICKER, mint addresses. Validated loosely, never a 500. */
const coinParam = z.string().max(200);
const coinId = z.string().regex(CANONICAL_ID);
const lamports = z.number().int().positive().max(1_000_000 * 1_000_000_000);

// ---------------------------------------------------------------- reads

// Signed out (no session cookie) this answers without touching the database. Signed in it also carries the
// inbox (P1-13): unread offers, won cards, outbids and sales since the player last opened Portfolio.
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSeeded();
  return svc.getMe(await currentUser(), { inbox: true });
});

export const getHome = createServerFn({ method: "GET" }).handler(async () => {
  await readPrelude();
  return svc.getHome();
});

export const listCoins = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string().max(40).optional(),
      tier: z.number().int().min(0).max(MAX_LEVEL).optional(),
      sort: z.enum(["trending", "mcap", "new", "next"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await readPrelude();
    return svc.listCoins(data);
  });

/**
 * The coin page's data for polling, by exact id. Never throws on odd input: anything that is not a coin id
 * resolves to null (the page then shows "not in the dex").
 */
export const getCoin = createServerFn({ method: "GET" })
  .validator(z.object({ id: coinParam }))
  .handler(async ({ data }) => {
    await readPrelude();
    if (!CANONICAL_ID.test(data.id)) return null;
    return svc.getCoinPage(data.id, await sessionTokenHash());
  });

export type CoinRoute =
  | { status: "ok"; page: CoinPage & svc.Rev }
  | { status: "moved"; id: string }
  | { status: "missing"; address: boolean };

/**
 * The coin route's loader (P0-10): the page when the URL holds a canonical id; otherwise where it should
 * point (a ticker, another casing, a known mint address), or "missing", which the route turns into a real 404
 * inside the app shell. One round trip for the normal case.
 */
export const getCoinRoute = createServerFn({ method: "GET" })
  .validator(z.object({ id: coinParam }))
  .handler(async ({ data }): Promise<CoinRoute> => {
    await readPrelude();
    const raw = data.id.trim();
    if (CANONICAL_ID.test(raw)) {
      const page = await svc.getCoinPage(raw, await sessionTokenHash());
      if (page) {
        // Simulated coins stay out of search (decision C4); the head tag says the same.
        if (NOINDEX_COINS) noindex();
        return { status: "ok", page };
      }
    }
    const id = await svc.findCoinId(raw);
    if (id && id !== raw) return { status: "moved", id };
    noindex();
    return { status: "missing", address: svc.looksLikeAddress(raw) };
  });

export const getMarket = createServerFn({ method: "GET" }).handler(async () => {
  await readPrelude();
  return svc.getMarket();
});

export const getPortfolio = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSeeded();
  if (NOINDEX_PORTFOLIO) noindex();
  const hash = await sessionTokenHash();
  if (!hash) return null;
  return svc.getPortfolio(hash);
});

export const getLevels = createServerFn({ method: "GET" }).handler(async () => {
  await ensureSeeded();
  return svc.getLevels();
});

export const getActivity = createServerFn({ method: "GET" }).handler(async () => {
  await readPrelude();
  return svc.recentEvents(12);
});

/**
 * Has anything changed since `rev`? One tiny read. Pollers call this instead of refetching whole pages and
 * refetch only when `changed` is true (P0-12). Revisions also roll once a minute, so 24h figures stay fresh.
 * Without `rev`, it just returns the current one.
 */
export const checkRev = createServerFn({ method: "GET" })
  .validator(z.object({ rev: z.string().max(40).optional() }))
  .handler(async ({ data }) => {
    await readPrelude();
    const rev = await svc.currentRev();
    return { rev, changed: data.rev !== undefined && data.rev !== rev };
  });

// ---------------------------------------------------------------- writes

export const enter = createServerFn({ method: "POST" })
  .validator(z.object({ handle: z.string().max(32) }))
  .handler(async ({ data }) =>
    attempt(async () => {
      const u = await enterWithHandle(data.handle);
      return { me: await svc.getMe(u) };
    }),
  );

export const signOut = createServerFn({ method: "POST" }).handler(async () =>
  attempt(async () => {
    await signOutCurrent();
    return { me: null as Me };
  }),
);

export const claimFaucet = createServerFn({ method: "POST" }).handler(async () =>
  attempt(async () => fresh(await svc.claimFaucet(await requireUser()))),
);

export const tradeCoin = createServerFn({ method: "POST" })
  .validator(
    z.object({
      coinId,
      side: z.enum(["buy", "sell"]),
      amount: lamports,
      minOut: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const user = await requireUser();
      const { me, rev, ...fill } = await svc.trade(user, data.coinId, data.side, data.amount, data.minOut);
      return { ...fill, ...(await fresh({ me, rev })) };
    }),
  );

export const launch = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().max(40),
      ticker: z.string().max(12),
      image: z.string().max(120),
      lore: z.string().max(400),
      website: z.string().max(240).optional(),
      xUrl: z.string().max(240).optional(),
      devBuy: z.number().int().min(0).max(1_000_000_000_000),
      cardTemplate: z.string().max(48).optional(),
      stockTicker: z.string().max(12).optional(),
      tokenPair: z.string().max(48).optional(),
    }),
  )
  .handler(async ({ data }) =>
    attempt(async () => {
      const { id, me, rev } = await svc.launchCoin(await requireUser(), data);
      return { id, ...(await fresh({ me, rev })) };
    }),
  );

/** Removed product capabilities reject immediately, including direct server-function calls. */
const nftTradingRemoved = async () => ({ ok: false as const, error: svc.NFT_TRADING_REMOVED });
export const bid = createServerFn({ method: "POST" }).validator(z.object({ coinId, amount: lamports })).handler(nftTradingRemoved);
export const cancelBid = createServerFn({ method: "POST" }).validator(z.object({ bidId: z.string().max(40) })).handler(nftTradingRemoved);
export const acceptBid = createServerFn({ method: "POST" }).validator(z.object({ bidId: z.string().max(40) })).handler(nftTradingRemoved);
export const setListing = createServerFn({ method: "POST" }).validator(z.object({ coinId, price: lamports.nullable() })).handler(nftTradingRemoved);
export const buyNow = createServerFn({ method: "POST" }).validator(z.object({ coinId, price: lamports })).handler(nftTradingRemoved);
export const withdrawFees = createServerFn({ method: "POST" }).validator(z.object({ coinId })).handler(nftTradingRemoved);

export const updateLore = createServerFn({ method: "POST" })
  .validator(z.object({ coinId, lore: z.string().max(400) }))
  .handler(async ({ data }) =>
    attempt(async () => fresh(await svc.updateLore(await requireUser(), data.coinId, data.lore))),
  );

/** Portfolio was opened: the inbox counts start again from now (P1-13). */
export const markSeen = createServerFn({ method: "POST" }).handler(async () =>
  attempt(async () => svc.markSeen(await requireUser())),
);

/** Report a coin that breaks the content rules (P1-28). `first` is false when this player already reported it. */
export const reportCoin = createServerFn({ method: "POST" })
  .validator(z.object({ coinId, reason: z.enum(REPORT_REASON_VALUES) }))
  .handler(async ({ data }) =>
    attempt(async () => svc.reportCoin(await requireUser(), data.coinId, data.reason)),
  );
