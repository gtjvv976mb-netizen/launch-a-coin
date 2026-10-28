import type { D1PreparedStatement } from "@cloudflare/workers-types";

import {
  FAUCET_AMOUNT,
  FAUCET_BELOW,
  FAUCET_COOLDOWN_MS,
  LAMPORTS,
  LAUNCH_FEE,
  MAX_DEV_BUY,
  TICKER_RE,
} from "../constants";
import {
  INITIAL_RESERVES,
  curveProgress,
  isGraduated,
  mcapUsd,
  priceSol,
  quoteBuy,
  quoteSell,
  type Reserves,
} from "../curve";
import { FLOW, notEnoughSentence } from "../copy";
import { looksLikeAddress } from "../seo";
import { filterByDesign, sortCoins } from "../sort";
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../../carddex/designs";
import type {
  CoinDetail,
  CoinPage,
  CoinSummary,
  EventRow,
  HomeData,
  Inbox,
  LevelsData,
  MarketData,
  Me,
  PortfolioData,
  TradeRow,
} from "../types";
import { viewerQuery, type SessionUser } from "./auth.server";
import {
  UserError,
  atomic,
  bumpRev,
  bumpRevIfChanged,
  clearGuard,
  db,
  guard,
  newId,
  one,
  q,
  readBatch,
  revQuery,
  revString,
  settledFrom,
  stmt,
  userQuery,
  type Settled,
} from "./db.server";

// ---------------------------------------------------------------- reads
//
// Every read is ONE D1 round trip (backlog P1-3): all statements are built up front and sent as a single
// batch. Pages that depend on the viewer resolve the session inside the same batch (viewerQuery), and the
// data revision (P0-12) rides along so pollers can later skip unchanged data.

/** Data revision of the snapshot a read came from (see revString in db.server.ts). */
export type Rev = { rev: string };

type CoinRaw = {
  id: string;
  dex_no: number;
  name: string;
  ticker: string;
  lore: string;
  image: string;
  website: string | null;
  x_url: string | null;
  creator_id: string;
  owner_id: string;
  v_sol: number;
  v_tok: number;
  volume: number;
  owner_fees: number;
  level: number;
  peak_level: number;
  card_template: string;
  peak_mcap_usd: number;
  list_price: number | null;
  trades: number;
  created_at: number;
  last_trade_at: number;
  fee_vault: number;
  mint_address: string | null;
  owner_handle: string;
  creator_handle: string;
  owner_npc: number;
  creator_npc: number;
};

const COIN_SELECT = `
  SELECT c.*, o.handle AS owner_handle, cr.handle AS creator_handle, o.is_npc AS owner_npc, cr.is_npc AS creator_npc
    FROM coins c
    JOIN users o ON o.id = c.owner_id
    JOIN users cr ON cr.id = c.creator_id`;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Every coin in dex order. Hidden coins (content rules, backlog P1-28) stay out of every public list and feed;
 * only a player's own portfolio still lists them, so their token holdings remain reachable.
 */
function allCoinsQuery(includeHidden = false) {
  return q<CoinRaw>(`${COIN_SELECT}${includeHidden ? "" : " WHERE c.hidden = 0"} ORDER BY c.dex_no ASC`);
}

type HolderAgg = { coin_id: string; n: number };
type BidAgg = { coin_id: string; top: number; n: number };
type PriceAgg = { coin_id: string; price: number };
type VolAgg = { coin_id: string; v: number };
type AggRows = [HolderAgg[], BidAgg[], PriceAgg[], VolAgg[]];

/**
 * Compatibility aggregate slots for holders, an empty retired bid slot, the last price before the 24h window and
 * 24h volume. Table-wide for lists; with `coinId` scoped to that one coin (P1-3 step 3: a coin page no longer
 * aggregates every coin in the dex).
 */
function aggQueries(since: number, coinId?: string) {
  const only = coinId ? " AND coin_id = ?" : "";
  const p = coinId ? [coinId] : [];
  return [
    q<HolderAgg>(`SELECT coin_id, COUNT(*) AS n FROM holdings WHERE amount > 0${only} GROUP BY coin_id`, ...p),
    q<BidAgg>("SELECT NULL AS coin_id, 0 AS top, 0 AS n WHERE 0"),
    q<PriceAgg>(
      `SELECT t.coin_id, t.price FROM trades t
         JOIN (SELECT coin_id, MAX(id) AS mid FROM trades WHERE created_at <= ?${only} GROUP BY coin_id) x
           ON x.mid = t.id`,
      since,
      ...p,
    ),
    q<VolAgg>(`SELECT coin_id, SUM(sol) AS v FROM trades WHERE created_at > ?${only} GROUP BY coin_id`, since, ...p),
  ] as const;
}

/** Raw coin rows plus their aggregates, as the client's CoinSummary. */
async function summarize(rows: CoinRaw[], [holders, bids, before, vol]: AggRows): Promise<CoinSummary[]> {
  if (!rows.length) return [];
  const hMap = new Map(holders.map((h) => [h.coin_id, h.n]));
  const pMap = new Map(before.map((p) => [p.coin_id, p.price]));
  const vMap = new Map(vol.map((v) => [v.coin_id, v.v]));
  const launchPrice = priceSol(INITIAL_RESERVES);

  return rows.map((r) => {
    const res: Reserves = { vSol: r.v_sol, vTok: r.v_tok };
    const price = priceSol(res);
    const base = pMap.get(r.id) ?? launchPrice;
    const usd = mcapUsd(res);
    const design = getCardDesign(r.card_template);
    return {
      id: r.id,
      dexNo: r.dex_no,
      name: r.name,
      ticker: r.ticker,
      image: r.image,
      lore: r.lore,
      cardTemplate: design.key,
      stockTicker: design.stock?.ticker ?? null,
      tokenPair: design.stock?.pair ?? null,
      level: design.materialLevel,
      liveLevel: design.materialLevel,
      mcapUsd: usd,
      priceSol: price,
      change24h: base > 0 ? price / base - 1 : 0,
      volume: r.volume,
      volume24h: vMap.get(r.id) ?? 0,
      holders: hMap.get(r.id) ?? 0,
      trades: r.trades,
      curveProgress: curveProgress(res),
      ownerId: r.owner_id,
      ownerHandle: r.owner_handle,
      ownerIsBot: !!r.owner_npc,
      creatorId: r.creator_id,
      creatorHandle: r.creator_handle,
      creatorIsBot: !!r.creator_npc,
      listPrice: null,
      topBid: null,
      bidCount: 0,
      createdAt: r.created_at,
      lastTradeAt: r.last_trade_at,
      feeVault: 0,
      mintAddress: null,
      graduated: isGraduated(res),
    };
  });
}

/** Every coin with its summary figures, in dex order. One round trip. */
export async function allCoins(): Promise<CoinSummary[]> {
  const [raw, h, b, p, v] = await readBatch(allCoinsQuery(), ...aggQueries(Date.now() - DAY));
  return summarize(raw, [h, b, p, v]);
}

/** The current data revision (one tiny read). */
export async function currentRev(): Promise<string> {
  const [rev] = await readBatch(revQuery());
  return revString(rev[0]?.value);
}

/** Compatibility helper for retired marketplace views. CardDex does not price or sell NFT cards. */
export function deedGuide(_c: { level: number; volume: number }) { return 0; }

export type CoinFilter = { q?: string; tier?: number; sort?: "trending" | "mcap" | "new" | "next" };

export async function listCoins(f: CoinFilter): Promise<CoinSummary[]> {
  let coins = await allCoins();
  const q = f.q?.trim().toLowerCase();
  if (q) {
    coins = coins.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q.replace(/^\$/, "")) ||
        c.creatorHandle.toLowerCase().includes(q.replace(/^@/, "")) ||
        c.ownerHandle.toLowerCase().includes(q.replace(/^@/, "")),
    );
  }
  // One order and one design filter for the server and Discover's instant client sort (lib/mintdex/sort.ts).
  return sortCoins(filterByDesign(coins, f.tier), f.sort ?? "trending");
}

/** The player's faucet state, from their row: what the wallet menu and "not enough" hints say. */
function faucetState(user: { balance: number; faucet_at: number }, now = Date.now()) {
  const readyAt = user.faucet_at + FAUCET_COOLDOWN_MS;
  const low = user.balance < FAUCET_BELOW;
  return { canFaucet: low && now >= readyAt, faucetReadyAt: low && now < readyAt ? readyAt : null };
}

/** The local demo balance and optional empty notification state. */
export async function getMe(user: SessionUser | null, opts: { inbox?: boolean } = {}): Promise<Me> {
  if (!user) return null;
  const me: NonNullable<Me> = { id: user.id, handle: user.handle, balance: user.balance, ...faucetState(user) };
  if (opts.inbox) me.inbox = await getInbox(user);
  return me;
}

// ---------------------------------------------------------------- inbox (backlog P1-13)

/**
 * The "seen" cursor lives in `meta` under seen:{user id} (epoch ms), so no schema change is needed. A player who
 * never opened Portfolio counts from when they entered.
 */
function seenKey(userId: string) {
  return `seen:${userId}`;
}

/** CardDex has no NFT offers, sales or royalty notifications. */
export async function getInbox(user: { id: string; created_at: number }): Promise<Inbox> {
  const seen = await one<{ value: string }>("SELECT value FROM meta WHERE key = ?", seenKey(user.id));
  return { offers: 0, won: 0, outbid: 0, sold: 0, latest: null, seenAt: Number(seen?.value ?? user.created_at) || 0 };
}

/** Portfolio was opened: everything up to now is seen. Private to the player, so no data revision bump. */
export async function markSeen(user: { id: string }): Promise<{ seenAt: number }> {
  const now = Date.now();
  await stmt(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    seenKey(user.id),
    String(now),
  ).run();
  return { seenAt: now };
}

type EventRaw = {
  id: number;
  kind: EventRow["kind"];
  coin_id: string;
  name: string;
  ticker: string;
  image: string;
  handle: string | null;
  npc: number | null;
  amount: number;
  level: number;
  created_at: number;
};

function mapEvent(e: EventRaw): EventRow {
  return {
    id: e.id,
    kind: e.kind,
    coinId: e.coin_id,
    coinName: e.name,
    ticker: e.ticker,
    image: e.image,
    handle: e.handle,
    isBot: !!e.npc,
    amount: e.amount,
    level: e.level,
    createdAt: e.created_at,
  };
}

function eventsQuery(limit: number) {
  return q<EventRaw>(
    `SELECT e.id, e.kind, e.coin_id, c.name, c.ticker, c.image, u.handle, u.is_npc AS npc, e.amount, e.level, e.created_at
       FROM events e JOIN coins c ON c.id = e.coin_id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.kind IN ('launch', 'buy', 'sell') AND c.hidden = 0
      ORDER BY e.id DESC LIMIT ?`,
    limit,
  );
}

export async function recentEvents(limit = 10): Promise<EventRow[]> {
  const [rows] = await readBatch(eventsQuery(limit));
  return rows.map(mapEvent);
}

export async function getHome(): Promise<HomeData & Rev> {
  const [raw, h, b, p, v, events, players, rev] = await readBatch(
    allCoinsQuery(),
    ...aggQueries(Date.now() - DAY),
    eventsQuery(8),
    q<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE is_npc = 0"),
    revQuery(),
  );
  const coins = await summarize(raw, [h, b, p, v]);
  // One token per selected design. Equal material finishes must not hide distinct card templates.
  const featured: CoinSummary[] = [];
  for (const design of CARD_DESIGNS) {
    const best = coins.filter((c) => c.cardTemplate === design.key).sort((a, b) => b.mcapUsd - a.mcapUsd)[0];
    if (best) featured.push(best);
  }
  const trending = [...coins]
    .sort((a, b) => b.volume24h - a.volume24h || b.lastTradeAt - a.lastTradeAt)
    .slice(0, 6);
  return {
    featured,
    trending,
    activity: events.map(mapEvent),
    stats: {
      coins: coins.length,
      deedSales: 0,
      volume: coins.reduce((s, c) => s + c.volume, 0),
      players: players[0]?.n ?? 0,
    },
    rev: revString(rev[0]?.value),
  };
}

export { looksLikeAddress };

/**
 * What someone typed after /coin/, resolved to a coin id (P0-10): the id in any casing, or the ticker with or
 * without "$" (tickers are unique). Mint addresses are the branch reserved for M4: at devnet this becomes the
 * real mint lookup; in sim only test coins carry (test, not on chain) addresses, so a real devnet or mainnet
 * mint finds nothing and the page answers 404.
 */
export async function findCoinId(param: string): Promise<string | null> {
  const raw = param.trim();
  if (!raw || raw.length > 64) return null;
  if (looksLikeAddress(raw)) {
    const row = await one<{ id: string }>("SELECT id FROM coins WHERE mint_address = ? AND hidden = 0", raw);
    return row?.id ?? null;
  }
  const id = raw.toLowerCase();
  const ticker = raw.replace(/^\$/, "").toUpperCase();
  const row = await one<{ id: string }>(
    "SELECT id FROM coins WHERE (id = ? OR ticker = ?) AND hidden = 0 ORDER BY id = ? DESC LIMIT 1",
    id,
    ticker,
    id,
  );
  return row?.id ?? null;
}

/**
 * Everything the coin page shows, in one round trip, including the viewer (from the session hash) and the
 * data revision. Null when no coin has this exact id.
 */
export async function getCoinPage(id: string, viewerHash: string | null): Promise<(CoinPage & Rev) | null> {
  const [raws, h, b, p, v, trades, viewers, holding, rev] = await readBatch(
    q<CoinRaw>(`${COIN_SELECT} WHERE c.id = ? AND c.hidden = 0`, id),
    ...aggQueries(Date.now() - DAY, id),
    q<{
      id: number;
      side: "buy" | "sell";
      sol: number;
      tokens: number;
      price: number;
      mcap_usd: number;
      handle: string;
      npc: number;
      created_at: number;
    }>(
      `SELECT * FROM (
         SELECT t.id, t.side, t.sol, t.tokens, t.price, t.mcap_usd, u.handle, u.is_npc AS npc, t.created_at
           FROM trades t JOIN users u ON u.id = t.user_id
          WHERE t.coin_id = ? ORDER BY t.id DESC LIMIT 400
       ) ORDER BY id ASC`,
      id,
    ),
    viewerQuery(viewerHash),
    q<{ amount: number }>(
      `SELECT h.amount FROM holdings h JOIN sessions s ON s.user_id = h.user_id
        WHERE s.token_hash = ? AND h.coin_id = ?`,
      viewerHash,
      id,
    ),
    revQuery(),
  );
  const raw = raws[0];
  if (!raw) return null;
  const [summary] = await summarize([raw], [h, b, p, v]);
  const viewer = viewers[0] ?? null;

  const coin: CoinDetail = {
    ...summary,
    vSol: raw.v_sol,
    vTok: raw.v_tok,
    ownerFees: 0,
    ownerEarnings: 0,
    website: raw.website,
    xUrl: raw.x_url,
    deedGuide: deedGuide({ level: raw.peak_level, volume: raw.volume }),
  };

  const tradeRows: TradeRow[] = trades.map((t) => ({
    id: t.id,
    side: t.side,
    sol: t.sol,
    tokens: t.tokens,
    price: t.price,
    mcapUsd: t.mcap_usd,
    handle: t.handle,
    isBot: !!t.npc,
    createdAt: t.created_at,
  }));

  return {
    coin,
    trades: tradeRows,
    bids: [],
    sales: [],
    viewer: viewer
      ? {
          holding: holding[0]?.amount ?? 0,
          myBid: null,
          isOwner: raw.owner_id === viewer.id,
          isCreator: raw.creator_id === viewer.id,
        }
      : null,
    rev: revString(rev[0]?.value),
  };
}

/** Retired NFT marketplace read: no off-chain listings or bids are exposed. */
export async function getMarket(): Promise<MarketData & Rev> {
  return { listed: [], topBids: [], sales: [], rev: await currentRev() };
}

/** The signed-in player's binder, in one round trip (the session resolves inside the batch). */
export async function getPortfolio(viewerHash: string): Promise<(PortfolioData & Rev) | null> {
  const [users, raw, h, b, p, v, holdings, rev] = await readBatch(
    viewerQuery(viewerHash),
    allCoinsQuery(true),
    ...aggQueries(Date.now() - DAY),
    q<{ coin_id: string; amount: number }>(
      `SELECT h.coin_id, h.amount FROM holdings h JOIN sessions s ON s.user_id = h.user_id
        WHERE s.token_hash = ? AND h.amount > 0`,
      viewerHash,
    ),
    revQuery(),
  );
  const user = users[0];
  if (!user) return null;
  const coins = await summarize(raw, [h, b, p, v]);
  const byId = new Map(coins.map((c) => [c.id, c]));

  const holdingRows = holdings
    .filter((x) => byId.has(x.coin_id))
    .map((x) => {
      const coin = byId.get(x.coin_id)!;
      return { coin, amount: x.amount, valueSol: Math.round(x.amount * 1e-6 * coin.priceSol * LAMPORTS) };
    })
    .sort((a, b) => b.valueSol - a.valueSol);

  const deeds = coins
    .filter((c) => c.ownerId === user.id)
    .map((coin) => ({ coin, earnings: 0 }))
    .sort((a, b) => b.coin.mcapUsd - a.coin.mcapUsd);

  return {
    holdings: holdingRows,
    deeds,
    bids: [],
    offers: [],
    totals: {
      holdingsValue: holdingRows.reduce((s, x) => s + x.valueSol, 0),
      earnings: 0,
      escrowed: 0,
    },
    rev: revString(rev[0]?.value),
  };
}

export async function getLevels(): Promise<LevelsData> {
  const coins = await allCoins();
  const counts = CARD_DESIGNS.map((design) => coins.filter((coin) => coin.cardTemplate === design.key).length);
  const coin = [...coins].sort((a, b) => b.volume - a.volume)[0] ?? null;
  return { coin, counts };
}


// ---------------------------------------------------------------- writes

/**
 * `sol` is the trade's gross size (what the trades list and volume record); `net` is what the wallet moved by:
 * paid on a buy (fee included), received on a sell (after the fee). Toasts state `net` (backlog P0-8).
 */
type TradeResult = { side: "buy" | "sell"; sol: number; net: number; tokens: number; levelUp: number | null };

// Every write returns Settled (db.server.ts): the player's row after the write and the new data revision, read
// in the same batch, so the client can update the balance and free the button without refetching (P0-12).

function protocolFeeStmt(amount: number): D1PreparedStatement {
  return stmt(
    `INSERT INTO meta (key, value) VALUES ('protocol_fees', ?)
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) AS TEXT)`,
    String(amount),
  );
}

/**
 * Buy (amount = lamports to spend) or sell (amount = token base units) on a
 * coin's curve. `minOut` protects against price movement between quote and fill.
 */
export async function trade(
  user: { id: string },
  coinId: string,
  side: "buy" | "sell",
  amount: number,
  minOut = 0,
): Promise<TradeResult & Settled> {
  if (!Number.isFinite(amount) || amount <= 0) throw new UserError("Enter an amount.");
  let result: TradeResult | null = null;

  const settled = await atomic(async () => {
    // The coin, the wallet and the bag in one round trip; the guards below catch anything that moves after.
    const [coins, wallets, bags] = await readBatch(
      q<{ v_sol: number; v_tok: number; owner_id: string; level: number; peak_level: number }>(
        "SELECT v_sol, v_tok, owner_id, level, peak_level FROM coins WHERE id = ?",
        coinId,
      ),
      q<{ balance: number; faucet_at: number }>("SELECT balance, faucet_at FROM users WHERE id = ?", user.id),
      q<{ amount: number }>("SELECT amount FROM holdings WHERE user_id = ? AND coin_id = ?", user.id, coinId),
    );
    const c = coins[0];
    if (!c) throw new UserError("That coin does not exist.");
    const r: Reserves = { vSol: c.v_sol, vTok: c.v_tok };
    const now = Date.now();
    const s: D1PreparedStatement[] = [
      // Retry if token reserves or creator ownership changed after the read.
      guard(
        "EXISTS (SELECT 1 FROM coins WHERE id = ? AND v_sol = ? AND v_tok = ? AND owner_id = ? AND peak_level = ?)",
        coinId,
        c.v_sol,
        c.v_tok,
        c.owner_id,
        c.peak_level,
      ),
      clearGuard(),
    ];

    let solMoved: number;
    let tokMoved: number;
    let ownerFee: number;
    let protocolFee: number;
    let after: Reserves;

    if (side === "buy") {
      const q = quoteBuy(r, amount);
      if (!q.ok) throw new UserError(q.reason ?? "Cannot buy right now.");
      if (q.tokensOut < minOut) throw new UserError("Price moved. Check the new quote and try again.");
      const bal = wallets[0];
      // The same words as the ticket (P1-9 step 6): claim the faucet when it is open, else when it opens.
      if (!bal || bal.balance < q.solIn) throw new UserError(notEnoughSentence(faucetState(bal ?? { balance: 0, faucet_at: 0 }, now)));
      solMoved = q.solIn;
      tokMoved = q.tokensOut;
      ownerFee = 0;
      protocolFee = q.fee;
      after = q.after;
      s.push(
        stmt("UPDATE users SET balance = balance - ? WHERE id = ?", q.solIn, user.id),
        stmt(
          `INSERT INTO holdings (user_id, coin_id, amount) VALUES (?, ?, ?)
           ON CONFLICT(user_id, coin_id) DO UPDATE SET amount = amount + excluded.amount`,
          user.id,
          coinId,
          q.tokensOut,
        ),
      );
    } else {
      const q = quoteSell(r, amount);
      if (!q.ok) throw new UserError(q.reason ?? "Cannot sell right now.");
      if (q.solOut < minOut) throw new UserError("Price moved. Check the new quote and try again.");
      const h = bags[0];
      if (!h || h.amount < q.tokensIn) throw new UserError("You do not hold that many coins.");
      solMoved = q.solOut;
      tokMoved = q.tokensIn;
      ownerFee = 0;
      protocolFee = q.fee;
      after = q.after;
      s.push(
        guard(
          "EXISTS (SELECT 1 FROM holdings WHERE user_id = ? AND coin_id = ? AND amount >= ?)",
          user.id,
          coinId,
          q.tokensIn,
        ),
        clearGuard(),
        stmt("UPDATE holdings SET amount = amount - ? WHERE user_id = ? AND coin_id = ?", q.tokensIn, user.id, coinId),
        stmt("UPDATE users SET balance = balance + ? WHERE id = ?", q.solOut, user.id),
      );
    }

    const usd = mcapUsd(after);
    // Market data changes; the creator-selected NFT design never does.
    const live = c.level;
    const peak = c.peak_level;
    const grossVolume = side === "buy" ? solMoved : solMoved + ownerFee + protocolFee;

    s.push(
      // Token fees go to the protocol only; the creator card accrues no financial entitlement.
      stmt(
        `UPDATE coins SET v_sol = ?, v_tok = ?, volume = volume + ?, owner_fees = owner_fees + ?,
                fee_vault = fee_vault + ?, level = ?, peak_level = MAX(peak_level, ?), peak_mcap_usd = MAX(peak_mcap_usd, ?),
                trades = trades + 1, last_trade_at = ?
          WHERE id = ?`,
        after.vSol,
        after.vTok,
        grossVolume,
        ownerFee,
        ownerFee,
        live,
        peak,
        usd,
        now,
        coinId,
      ),
      stmt(
        `INSERT INTO trades (coin_id, user_id, side, sol, tokens, price, mcap_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        coinId,
        user.id,
        side,
        grossVolume,
        tokMoved,
        priceSol(after),
        usd,
        now,
      ),
      protocolFeeStmt(protocolFee),
    );
    if (grossVolume >= LAMPORTS && side === "buy") {
      s.push(
        stmt(
          "INSERT INTO events (kind, coin_id, user_id, amount, level, created_at) VALUES ('buy', ?, ?, ?, ?, ?)",
          coinId,
          user.id,
          grossVolume,
          peak,
          now,
        ),
      );
    }
    result = { side, sol: grossVolume, net: solMoved, tokens: tokMoved, levelUp: null };
    return s;
  }, "The price moved while your order was filling. Please try again.", 3, { meId: user.id });

  return { ...result!, me: settled.me, rev: settled.rev };
}

export type LaunchInput = {
  name: string;
  ticker: string;
  image: string;
  lore: string;
  website?: string;
  xUrl?: string;
  devBuy: number;
  cardTemplate?: string;
  /** Optional catalog echoes, checked for consistency; these never establish a stock association. */
  stockTicker?: string;
  tokenPair?: string;
};

function cleanUrl(u: string | undefined, hostCheck?: (h: string) => boolean): string | null {
  const t = (u ?? "").trim();
  if (!t) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new UserError("Links must be full https:// addresses.");
  }
  if (url.protocol !== "https:") throw new UserError("Links must start with https://");
  if (hostCheck && !hostCheck(url.hostname)) throw new UserError("That X link does not look right.");
  if (t.length > 200) throw new UserError("That link is too long.");
  return url.toString();
}

export async function launchCoin(user: SessionUser, input: LaunchInput): Promise<{ id: string } & Settled> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const ticker = input.ticker.trim().replace(/^\$/, "").toUpperCase();
  const lore = input.lore.trim();
  const cardTemplate = input.cardTemplate ?? DEFAULT_CARD_DESIGN;
  if (!isCardDesignKey(cardTemplate)) throw new UserError("Choose an available card design.");
  const design = getCardDesign(cardTemplate);
  if (input.stockTicker !== undefined && input.stockTicker !== design.stock?.ticker) {
    throw new UserError("The stock reference must match the selected card design.");
  }
  if (input.tokenPair !== undefined && input.tokenPair !== design.stock?.pair) {
    throw new UserError("The reference pair must match the selected card design.");
  }
  if (name.length < 2 || name.length > 24) throw new UserError("Names are 2 to 24 characters.");
  if (!TICKER_RE.test(ticker)) throw new UserError("Tickers are 2 to 8 letters or numbers.");
  if (lore.length > 280) throw new UserError("Keep the description under 280 characters.");
  if (!/^\/api\/img\/art\/[a-z0-9-]+\.(webp|png|jpg|jpeg|gif)$/.test(input.image)) {
    throw new UserError("Upload card art first.");
  }
  const website = cleanUrl(input.website);
  const xUrl = cleanUrl(input.xUrl, (h) => /(^|\.)(x|twitter)\.com$/.test(h));
  const devBuy = Math.floor(input.devBuy || 0);
  if (devBuy < 0 || devBuy > MAX_DEV_BUY) throw new UserError("Dev buy can be up to 20 SOL.");

  const taken = await one<{ id: string }>("SELECT id FROM coins WHERE ticker = ?", ticker);
  if (taken) throw new UserError(`$${ticker} is already in the dex. Pick another ticker.`);

  const id = newId(8);
  const now = Date.now();
  const q = devBuy > 0 ? quoteBuy(INITIAL_RESERVES, devBuy) : null;
  const after = q?.ok ? q.after : INITIAL_RESERVES;
  const cost = LAUNCH_FEE + (q?.ok ? q.solIn : 0);
  // Creator cards carry no royalty or fee entitlement, including on the initial buy.
  const creatorFee = 0;
  if (user.balance < cost) throw new UserError("Not enough SOL for the launch fee and dev buy.");

  const usd = mcapUsd(after);
  const level = design.materialLevel;
  const s: D1PreparedStatement[] = [
    stmt("UPDATE users SET balance = balance - ? WHERE id = ?", cost, user.id),
    stmt(
      `INSERT INTO coins (id, dex_no, name, ticker, lore, image, website, x_url, creator_id, owner_id,
                          v_sol, v_tok, volume, owner_fees, level, peak_level, list_price, trades, is_seed,
                          created_at, last_trade_at, fee_vault, mint_address, card_template, peak_mcap_usd)
       VALUES (?, (SELECT COALESCE(MAX(dex_no), 0) + 1 FROM coins), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?,
               NULL, ?, ?)`,
      id,
      name,
      ticker,
      lore,
      input.image,
      website,
      xUrl,
      user.id,
      user.id,
      after.vSol,
      after.vTok,
      q?.ok ? q.solIn : 0,
      creatorFee,
      level,
      level,
      q?.ok ? 1 : 0,
      now,
      now,
      creatorFee,
      cardTemplate,
      usd,
    ),
    stmt(
      "INSERT INTO events (kind, coin_id, user_id, amount, level, created_at) VALUES ('launch', ?, ?, 0, ?, ?)",
      id,
      user.id,
      level,
      now,
    ),
    protocolFeeStmt(LAUNCH_FEE + (q?.ok ? q.fee : 0)),
  ];
  if (q?.ok) {
    s.push(
      stmt("INSERT INTO holdings (user_id, coin_id, amount) VALUES (?, ?, ?)", user.id, id, q.tokensOut),
      stmt(
        `INSERT INTO trades (coin_id, user_id, side, sol, tokens, price, mcap_usd, created_at)
         VALUES (?, ?, 'buy', ?, ?, ?, ?, ?)`,
        id,
        user.id,
        q.solIn,
        q.tokensOut,
        priceSol(after),
        usd,
        now,
      ),
    );
  }
  const settled = await atomic(async () => s, "Launch failed. Check your balance and try again.", 2, { meId: user.id });
  return { id, me: settled.me, rev: settled.rev };
}

/** These compatibility exports always refuse before any database read or write. */
export const NFT_TRADING_REMOVED = "CardDex does not support NFT sales, bids, auctions or royalties.";
function rejectNftTrading(): never { throw new UserError(NFT_TRADING_REMOVED); }
export async function placeBid(_user: { id: string }, _coinId: string, _amount: number): Promise<Settled> { return rejectNftTrading(); }
export async function cancelBid(_user: { id: string }, _bidId: string): Promise<Settled> { return rejectNftTrading(); }
export async function acceptBid(_user: { id: string }, _bidId: string): Promise<Settled> { return rejectNftTrading(); }
export async function setListing(_user: { id: string }, _coinId: string, _price: number | null): Promise<Settled> { return rejectNftTrading(); }
export async function buyNow(_user: { id: string }, _coinId: string, _expectedPrice: number): Promise<Settled> { return rejectNftTrading(); }
export async function withdrawFees(_user: { id: string }, _coinId: string): Promise<{ amount: number } & Settled> { return rejectNftTrading(); }

export async function updateLore(user: { id: string }, coinId: string, lore: string): Promise<Settled> {
  const t = lore.trim();
  if (t.length > 280) throw new UserError("Keep the description under 280 characters.");
  const res = await db().batch([
    stmt("UPDATE coins SET lore = ? WHERE id = ? AND owner_id = ?", t, coinId, user.id),
    // A rejected edit changes nothing, so it must not send every poller to a full refetch.
    bumpRevIfChanged(),
    userQuery(user.id).s,
  ]);
  if (!res[0].meta.changes) throw new UserError("Only the card owner can edit the description.");
  return settledFrom(res, 1, true);
}

export async function claimFaucet(user: SessionUser): Promise<Settled> {
  const now = Date.now();
  const res = await db().batch([
    stmt(
      "UPDATE users SET balance = balance + ?, faucet_at = ? WHERE id = ? AND balance < ? AND faucet_at <= ?",
      FAUCET_AMOUNT,
      now,
      user.id,
      FAUCET_BELOW,
      now - FAUCET_COOLDOWN_MS,
    ),
    bumpRevIfChanged(),
    userQuery(user.id).s,
  ]);
  if (!res[0].meta.changes) {
    throw new UserError("The faucet refills wallets under 5 SOL, once every 6 hours.");
  }
  return settledFrom(res, 1, true);
}

// ---------------------------------------------------------------- content rules (backlog P1-28)

/**
 * A player reports a coin that breaks the content rules. One report per player per coin (a repeat is a quiet
 * no-op). Reports are read by the operator, who hides a coin with `UPDATE coins SET hidden = 1 WHERE id = ?`:
 * a hidden coin leaves every list, feed and the sitemap, and its page answers 404.
 */
export async function reportCoin(
  user: { id: string },
  coinId: string,
  reason: string,
): Promise<{ first: boolean }> {
  const c = await one<{ id: string }>("SELECT id FROM coins WHERE id = ? AND hidden = 0", coinId);
  if (!c) throw new UserError("That coin is not in the dex.");
  const res = await stmt(
    "INSERT OR IGNORE INTO reports (coin_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)",
    coinId,
    user.id,
    reason,
    Date.now(),
  ).run();
  return { first: (res.meta?.changes ?? 0) > 0 };
}
