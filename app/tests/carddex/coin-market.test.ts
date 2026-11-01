import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// A launched coin's market data: the Solana half (/api/live/market, a fake RPC and an in-memory D1) and the GeckoTerminal
// half read in the browser (gecko.ts, a fake fetch). No test reaches the network. Shapes follow real answers (1 November 2026).
let sqlite = new Database(":memory:");
class Prepared {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Prepared(this.sql, values); }
  rows() { return sqlite.query(this.sql).all(...this.values as never[]); }
  async first<T>() { return (this.rows()[0] ?? null) as T | null; }
  async all<T>() { return {results: this.rows() as T[]}; }
  async run() { const results = this.rows(); return {results, success: true, meta: {changes: (sqlite.query("SELECT changes() AS n").get() as {n: number}).n}}; }
}
const localD1 = {prepare: (sql: string) => new Prepared(sql), async batch(statements: Prepared[]) { const out = []; for (const s of statements) out.push(await s.run()); return out; }};
let env: Record<string, unknown>;
mock.module("../../src/lib/bindings.server", () => ({bindings: () => env, keepAlive: <T,>(promise: Promise<T>) => promise}));

const market = await import("../../src/lib/carddex/live/market.server");
const gecko = await import("../../src/lib/carddex/live/gecko");
const shapes = await import("../../src/lib/carddex/live/market");
const format = await import("../../src/components/carddex/market/format");
const share = await import("../../src/components/carddex/ShareCoin");
const {missingMigrations} = await import("../../src/lib/carddex/live/limits.server");

const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");
const MINT = "12qCmfMdPfE3WADB7Qq5FyuC1VyKKxVmanPuHNWAcard", CURVE = "3WkJQahMySkJ3s3t4ytDon1eHMn9b6Sg6hy1TMMFf13R";
const CREATOR = "48G9GNHNRTQZQGBxvXuEEendXEcFTJCXfita9hVAh7EP", BUYER = "FbBzNqfFeHoywVgrGhLhGnUHPxHWLLFxhsTMhsEBEty9";
const SOL = "So11111111111111111111111111111111111111112";
const TX = "3mr7obqtjfCgKiZ2cRqkGW4cgfQ5HfoQdGtjmjLsCapXKAZuQh9P8vZHo54oDAZCauTpC2rE9opq6R5tjF55vEfP";
const NOW = Date.parse("2026-11-01T00:00:00Z");

function launch(mint = MINT, status = "complete") {
  sqlite.query(`INSERT INTO live_launch_intents (id, idempotency_key, creator_wallet, token_mint, nft_mint, quote_key, quote_mint, design_key, payload_sha256, payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'sol', ?, 'pair-sol', 'x', '{}', 'x', 'u', 'u', ?, ?, ?)`).run(`intent-${mint}`, mint, CREATOR, mint, `nft-${mint}`, SOL, status, NOW, NOW);
}
const poolAnswer = {data: {attributes: {
  base_token_price_usd: "0.0000027", quote_token_price_usd: "95.5", reserve_in_usd: "2543.92",
  fdv_usd: "2700", price_change_percentage: {m5: "0", h1: "1.5", h6: "-2", h24: "-10.86"}, volume_usd: {h24: "1102.41"},
  transactions: {h24: {buys: 6, sells: 5, buyers: 5, sellers: 4}},
}, relationships: {base_token: {data: {id: `solana_${MINT}`}}}}};
const tradesAnswer = {data: [
  {attributes: {block_timestamp: "2026-10-31T23:58:00Z", tx_hash: TX, tx_from_address: BUYER, kind: "buy", from_token_address: SOL, to_token_address: MINT, from_token_amount: "0.5", to_token_amount: "17000000", volume_in_usd: "47.75"}},
  {attributes: {block_timestamp: "2026-10-31T23:59:00Z", tx_hash: TX, tx_from_address: BUYER, kind: "sell", from_token_address: MINT, to_token_address: SOL, from_token_amount: "1000000", to_token_amount: "0.03", volume_in_usd: "2.86"}},
  {attributes: {block_timestamp: "bad", tx_hash: TX, tx_from_address: BUYER, kind: "buy"}},
]};
// The newest bucket twice (a real row, then a flat copy), as GeckoTerminal really answers; newest first.
const ohlcvAnswer = {data: {attributes: {ohlcv_list: [
  [1793481960, 3.45e-6, 3.45e-6, 3.34e-6, 3.34e-6, 23.2],
  [1793481960, 3.34e-6, 3.34e-6, 3.34e-6, 3.34e-6, 23.2],
  [1793479260, 3.67e-6, 3.67e-6, 3.45e-6, 3.45e-6, 110.9],
]}}};

type Call = {url: string; method: string; body: string | null; init: RequestInit};
/** A fake RPC (DAS) and a fake GeckoTerminal: records every call. */
function fakeNetwork(options: {geckoStatus?: number; das?: "ok" | "error"} = {}) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null, init});
    if (url.startsWith(gecko.GECKO_API)) {
      if (options.geckoStatus) return Response.json({errors: [{status: String(options.geckoStatus)}]}, {status: options.geckoStatus});
      if (url.includes("/ohlcv/")) return Response.json(ohlcvAnswer);
      if (url.endsWith("/trades")) return Response.json(tradesAnswer);
      if (url.endsWith(`/tokens/${MINT}`)) return Response.json({data: {relationships: {top_pools: {data: [{id: `solana_${CURVE}`, type: "pool"}]}}}});
      return Response.json(poolAnswer);
    }
    expect(init.redirect).toBe("manual");
    if (url === "https://rpc.example/secret-key-0001") {
      if (options.das === "error") return Response.json({jsonrpc: "2.0", id: "holders", error: {code: -32601, message: "Method not found"}});
      return Response.json({jsonrpc: "2.0", id: "holders", result: {total: 3, token_accounts: [
        {owner: CREATOR, amount: 5_000_000}, {owner: BUYER, amount: 17_000_000}, {owner: CURVE, amount: 900_000_000_000}, {owner: BUYER, amount: 1},
      ]}});
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return {calls, fetch};
}
const CURVE_ROW = {status: "curve", priceQuote: 2.8e-8, marketCapQuote: 28, progress: 0.25, reservesQuote: 10, supply: 1e9, pool: CURVE, marketOwners: [CURVE]};
const cacheCurve = (at: number) => sqlite.query("INSERT OR REPLACE INTO live_market_cache (mint, kind, fetched_at, json) VALUES (?, 'curve', ?, ?)").run(MINT, at, JSON.stringify(CURVE_ROW));
/** A connection whose curve read fails (its message names the RPC URL, as provider errors do). */
const failingChain = {
  async getMultipleAccountsInfo() { throw new Error("rpc down at https://rpc.example/secret-key-0001"); },
  async getTokenLargestAccounts() { return {value: []}; },
  async getMultipleParsedAccounts() { return {value: []}; },
};

const nativeFetch = globalThis.fetch, nativeLog = console.log, nativeError = console.error;
beforeEach(() => {
  sqlite.close(); sqlite = new Database(":memory:");
  const migrations = resolve(APP, "migrations");
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) { const sql = readFileSync(resolve(migrations, name), "utf8"); if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql); }
  env = {DB: localD1};
  globalThis.fetch = (async () => { throw new Error("A test attempted external network access"); }) as unknown as typeof fetch;
  console.log = () => undefined; console.error = () => undefined;
});
afterAll(() => { globalThis.fetch = nativeFetch; console.log = nativeLog; console.error = nativeError; sqlite.close(); });

describe("GeckoTerminal, read in the browser", () => {
  test("pool stats: the coin's own price, the quote's dollar price, change in percent, 24h counts", () => {
    expect(gecko.parsePool(poolAnswer, MINT)).toEqual({
      priceUsd: 0.0000027, quoteUsd: 95.5, reserveUsd: 2543.92, fdvUsd: 2700,
      change: {m5: 0, h1: 1.5, h6: -2, h24: -10.86}, volumeUsd24h: 1102.41, txns24h: {buys: 6, sells: 5, buyers: 5, sellers: 4},
    });
    expect(gecko.parsePool({data: {}}, MINT)).toBeNull();
  });
  test("trades: newest first, the side follows the coin whichever side of the pool it is, malformed rows dropped", () => {
    expect(gecko.parseTrades(tradesAnswer, MINT)).toEqual([
      {at: Date.parse("2026-10-31T23:59:00Z"), kind: "sell", wallet: BUYER, tokens: 1_000_000, quote: 0.03, usd: 2.86, tx: TX},
      {at: Date.parse("2026-10-31T23:58:00Z"), kind: "buy", wallet: BUYER, tokens: 17_000_000, quote: 0.5, usd: 47.75, tx: TX},
    ]);
    const quoteSide = {data: [{attributes: {block_timestamp: "2026-10-31T23:58:00Z", tx_hash: TX, tx_from_address: BUYER, kind: "buy", from_token_address: MINT, to_token_address: "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp", from_token_amount: "5000", to_token_amount: "2", volume_in_usd: "0.4"}}]};
    expect(gecko.parseTrades(quoteSide, MINT)).toMatchObject([{kind: "sell", tokens: 5000, quote: 2}]);
  });
  test("candles: oldest first, a repeated bucket keeps its first (real) row, gaps stay gaps", () => {
    expect(gecko.parseCandles(ohlcvAnswer)).toEqual([
      {t: 1793479260, o: 3.67e-6, h: 3.67e-6, l: 3.45e-6, c: 3.45e-6, v: 110.9},
      {t: 1793481960, o: 3.45e-6, h: 3.45e-6, l: 3.34e-6, c: 3.34e-6, v: 23.2},
    ]);
  });
  test("reads are plain GETs: no cookies, no referrer, the coin's pool and range in the path", async () => {
    const net = fakeNetwork();
    expect(await gecko.geckoGet(gecko.candlesPath(CURVE, MINT, "5m"), net.fetch)).toEqual(ohlcvAnswer);
    const url = new URL(net.calls[0].url), init = net.calls[0].init;
    expect(url.pathname).toBe(`/api/v2/networks/solana/pools/${CURVE}/ohlcv/minute`);
    expect(Object.fromEntries(url.searchParams)).toEqual({aggregate: "5", limit: "300", currency: "usd", token: MINT});
    expect([init.method, init.credentials, init.referrerPolicy]).toEqual(["GET", "omit", "no-referrer"]);
    await expect(gecko.geckoGet("/x", fakeNetwork({geckoStatus: 429}).fetch)).rejects.toMatchObject({name: "GeckoError", status: 429});
    expect(gecko.parseTopPool({data: {relationships: {top_pools: {data: [{id: `solana_${CURVE}`}]}}}})).toBe(CURVE);
  });
});

describe("the two halves together", () => {
  const chain = (over: Record<string, unknown> = {}) => ({
    mint: MINT, asOf: NOW, status: "curve", priceQuote: 2.8e-8, marketCapQuote: 28, progress: 0.25, reservesQuote: 10, supply: 1e9, pool: CURVE,
    holders: [], holderCount: 2, holderCountCapped: false, curveShare: 0.99, stale: false, ...over,
  }) as Parameters<typeof shapes.combineMarket>[1];
  const stats = gecko.parsePool(poolAnswer, MINT);
  test("the dollar price is the curve's price times the quote's dollar price, current to the chain", () => {
    const view = shapes.combineMarket(MINT, chain(), stats, []);
    expect(view.priceSource).toBe("chain");
    expect(view.priceUsd).toBeCloseTo(2.8e-8 * 95.5, 15);
    expect(view.marketCapUsd).toBeCloseTo(2.8e-8 * 95.5 * 1e9, 6);
    expect(view.reservesUsd).toBeCloseTo(955, 6);
    expect(view).toMatchObject({change: {h24: -10.86}, volumeUsd24h: 1102.41, holderCount: 2, stale: false});
  });
  test("without the curve, GeckoTerminal's own price and market cap, said as such; without either, nothing", () => {
    expect(shapes.combineMarket(MINT, null, stats, null)).toMatchObject({priceSource: "geckoterminal", priceUsd: 0.0000027, marketCapUsd: 2700, progress: null, reservesUsd: null, holders: null});
    expect(shapes.combineMarket(MINT, chain(), null, null)).toMatchObject({priceSource: null, priceUsd: null, marketCapUsd: null, reservesUsd: null, priceQuote: 2.8e-8, change: {h24: null}});
    // A graduated coin: the pool's liquidity, never curve reserves.
    expect(shapes.combineMarket(MINT, chain({status: "migrated", priceQuote: null, reservesQuote: null}), stats, null)).toMatchObject({priceSource: "geckoterminal", reservesUsd: 2543.92, reservesQuote: null});
    expect(shapes.combineMarket(MINT, chain(), stats, [], true).stale).toBe(true);
  });
});

describe("holders", () => {
  test("DAS counts distinct wallets with a balance, the curve left out; an RPC without DAS gives null", async () => {
    const net = fakeNetwork();
    expect(await market.countHolders(net.fetch, "https://rpc.example/secret-key-0001", MINT, [CURVE])).toEqual({count: 2, capped: false});
    expect(JSON.parse(net.calls[0].body!)).toMatchObject({method: "getTokenAccounts", params: {mint: MINT, limit: 1000, page: 1}});
    expect(await market.countHolders(fakeNetwork({das: "error"}).fetch, "https://rpc.example/secret-key-0001", MINT, [CURVE])).toBeNull();
  });
});

describe("the Solana endpoint", () => {
  test("only a finished launch answers; anything else is a 400 or 404 without any upstream read", async () => {
    const net = fakeNetwork();
    launch("9ad71NssXqrWRaS5KkKKwK64B8e3mdF1bKpczptcard", "token_pending");
    expect((await market.serveCoinMarket(new Request("https://launchacard.fun/api/live/market/x"), "not-a-mint", {fetch: net.fetch})).status).toBe(400);
    expect((await market.serveCoinMarket(new Request("https://launchacard.fun/api/live/market/x"), "9ad71NssXqrWRaS5KkKKwK64B8e3mdF1bKpczptcard", {fetch: net.fetch})).status).toBe(404);
    expect(net.calls).toEqual([]);
  });
  test("no RPC here: nothing is read or counted, figures are null (never zero) and not called stale", async () => {
    launch();
    const net = fakeNetwork();
    const answer = await market.readCoinMarket(MINT, {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => null});
    expect(answer).toMatchObject({mint: MINT, asOf: null, status: null, priceQuote: null, pool: null, holders: null, holderCount: null, stale: false});
    expect(net.calls).toEqual([]);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM rate_events").get() as {n: number}).n).toBe(0);
  });
  test("an RPC failure never leaks the RPC URL; the last answer is served marked stale, and the miss is not retried at once", async () => {
    launch();
    cacheCurve(NOW - 60_000);
    let reads = 0;
    const chain = {...failingChain, async getMultipleAccountsInfo() { reads++; return failingChain.getMultipleAccountsInfo(); }};
    const deps = {fetch: fakeNetwork().fetch, now: () => NOW, connection: () => chain as never, rpcUrl: () => null};
    const response = await market.serveCoinMarket(new Request("https://launchacard.fun/api/live/market/x"), MINT, deps);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("secret-key");
    // The curve is the minute-old answer; the holders list refreshed now.
    expect(JSON.parse(text)).toMatchObject({status: "curve", priceQuote: 2.8e-8, pool: CURVE, holders: [], asOf: NOW, stale: true});
    await market.readCoinMarket(MINT, {...deps, now: () => NOW + 5_000});
    expect(reads).toBe(1);
    await market.readCoinMarket(MINT, {...deps, now: () => NOW + 11_000});
    expect(reads).toBe(2);
  });
  test("with the curve: holders and their count, cached site-wide for their windows", async () => {
    launch();
    cacheCurve(NOW - 1_000);
    const net = fakeNetwork();
    const deps = {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => "https://rpc.example/secret-key-0001"};
    const answer = (await market.readCoinMarket(MINT, deps))!;
    expect(answer).toMatchObject({status: "curve", priceQuote: 2.8e-8, supply: 1e9, pool: CURVE, holderCount: 2, holderCountCapped: false, asOf: NOW, stale: false});
    await market.readCoinMarket(MINT, {...deps, now: () => NOW + 5 * 60_000});
    expect(net.calls).toHaveLength(1);
  });
  test("migration 0020 is probed by /api/live/health", async () => {
    expect(await missingMigrations()).toEqual([]);
    sqlite.exec("DROP TABLE live_market_cache");
    expect(await missingMigrations()).toEqual(["0020"]);
  });
});

describe("the page", () => {
  test("figures: tiny prices keep four significant digits, dollars and shares read short", () => {
    expect(format.usdPrice(0.0000026738)).toBe("$0.000002674");
    expect(format.usdPrice(1.5)).toBe("$1.50");
    expect(format.usdShort(2671.4)).toBe("$2.67K");
    expect(format.usdShort(0.92)).toBe("$0.92");
    expect(format.usdShort(1_234_567)).toBe("$1.23M");
    expect(format.shareText(0.0000001)).toBe("<0.01%");
    expect(format.shareText(0.124)).toBe("12.4%");
    expect(format.ageShort(NOW - 90_000, NOW)).toBe("1m");
    expect(format.axisPrice(0.000002674)).toBe("0.0₅2674");
    // A mantissa that rounds up to 10 moves the exponent instead of showing a price ten times too small.
    expect(format.axisPrice(0.0000099996)).toBe("0.0₄1000");
    expect(format.axisPrice(0.00099996)).toBe("0.001000");
    expect(format.axisPrice(0.0000028)).toBe("0.0₅2800");
    expect(format.axisPrice(12.5)).toBe("12.50");
    // Units are chosen after rounding; dust never reads as $0.00.
    expect(format.usdShort(999_999)).toBe("$1.00M");
    expect(format.usdShort(99_960)).toBe("$100K");
    expect(format.usdShort(999.6)).toBe("$1.00K");
    expect(format.usdShort(0.004)).toBe("<$0.01");
    expect(format.amountShort(999_950)).toBe("1.00M");
  });
  test("the coin page shows the market, the chart, trades, holders and the copyable address, and keeps the card", () => {
    const page = read("src/routes/coin/$id.tsx");
    for (const part of ["<MarketPanel", "<ChartSection", "<TradesSection", "<HoldersSection", "<CopyAddress", "<LaunchCardPreview"]) expect(page).toContain(part);
    expect(read("src/components/carddex/market/CoinMarket.tsx")).toContain('lazy(() => import("./PriceChart"))');
    expect(read("src/components/carddex/market/PriceChart.tsx")).toContain("attributionLogo: true");
  });
  test("the site's security headers let the browser read GeckoTerminal", () => {
    expect(read("src/lib/security-headers.server.ts")).toMatch(/'self' https:/);
  });
});

describe("sharing a coin", () => {
  test("X's composer opens prefilled with the coin, its cashtag, our handle and the coin page", () => {
    const text = share.shareText({name: "Charizard!", ticker: "CHARI", creator: true});
    expect(text).toBe("I just launched Charizard! ($CHARI) on @launchacard 🃏 It comes with its own one-of-one NFT card.");
    const url = new URL(share.xShareUrl(text, share.coinPageUrl(MINT)));
    expect(`${url.origin}${url.pathname}`).toBe("https://x.com/intent/tweet");
    expect(url.searchParams.get("text")).toBe(text);
    expect(url.searchParams.get("url")).toBe(`https://launchacard.fun/coin/${MINT}`);
    expect(share.shareText({name: "Charizard!", ticker: "CHARI"})).toBe("Charizard! ($CHARI) has its own one-of-one NFT card on @launchacard 🃏");
  });
  test("only a stored launch asset is offered to save, as a same-origin path", () => {
    expect(share.assetHref("https://launchacard.fun/api/live/assets/abc/card.png")).toBe("/api/live/assets/abc/card.png");
    expect(share.assetHref("/api/live/assets/abc/card.png")).toBe("/api/live/assets/abc/card.png");
    expect(share.assetHref("https://evil.example/x.png")).toBeNull();
    expect(share.assetHref(null)).toBeNull();
  });
  test("the launch panel offers sharing once a launch is complete, and every coin page offers it", () => {
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    expect(panel).toMatch(/status === "complete" && intent \? <section[^>]*cdx-live-share/);
    expect(panel).toContain("<ShareCoin creator");
    expect(read("src/routes/coin/$id.tsx")).toContain("<ShareCoin ");
  });
});
