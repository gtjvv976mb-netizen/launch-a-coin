import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// A launched coin's market data (/api/live/market). A fake GeckoTerminal, a fake RPC connection and an in-memory D1:
// no test reaches the network. Shapes follow GeckoTerminal's real answers (1 November 2026).
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
const shapes = await import("../../src/lib/carddex/live/market");
const format = await import("../../src/components/carddex/market/format");
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

type Call = {url: string; method: string; body: string | null};
function fakeNetwork(options: {geckoStatus?: number; das?: "ok" | "error"} = {}) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : null});
    expect(init.redirect).toBe("manual");
    if (url.startsWith(market.GECKO_API)) {
      if (options.geckoStatus) return Response.json({errors: [{status: String(options.geckoStatus)}]}, {status: options.geckoStatus});
      if (url.includes("/ohlcv/")) return Response.json(ohlcvAnswer);
      if (url.endsWith("/trades")) return Response.json(tradesAnswer);
      if (url.endsWith(`/tokens/${MINT}`)) return Response.json({data: {relationships: {top_pools: {data: [{id: `solana_${CURVE}`, type: "pool"}]}}}});
      return Response.json(poolAnswer);
    }
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
/** The curve read and the largest accounts, as the integration returns them. */
function fakeChain(options: {fail?: boolean} = {}) {
  let reads = 0;
  const connection = {
    async getMultipleAccountsInfo() { reads++; if (options.fail) throw new Error("rpc down at https://rpc.example/secret-key-0001"); return [null, null, null]; },
    async getTokenLargestAccounts() { return {value: []}; },
    async getMultipleParsedAccounts() { return {value: []}; },
  };
  return {connection, reads: () => reads};
}

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

describe("GeckoTerminal answers", () => {
  test("pool stats: the coin's own price, the quote's dollar price, change in percent, 24h counts", () => {
    expect(market.parsePool(poolAnswer, MINT)).toEqual({
      priceUsd: 0.0000027, quoteUsd: 95.5, reserveUsd: 2543.92, fdvUsd: 2700,
      change: {m5: 0, h1: 1.5, h6: -2, h24: -10.86}, volumeUsd24h: 1102.41, txns24h: {buys: 6, sells: 5, buyers: 5, sellers: 4},
    });
    expect(market.parsePool({data: {}}, MINT)).toBeNull();
  });
  test("trades: newest first, buys and sells sided by which token the coin was, malformed rows dropped", () => {
    expect(market.parseTrades(tradesAnswer, MINT)).toEqual([
      {at: Date.parse("2026-10-31T23:59:00Z"), kind: "sell", wallet: BUYER, tokens: 1_000_000, quote: 0.03, usd: 2.86, tx: TX},
      {at: Date.parse("2026-10-31T23:58:00Z"), kind: "buy", wallet: BUYER, tokens: 17_000_000, quote: 0.5, usd: 47.75, tx: TX},
    ]);
  });
  test("candles: oldest first, a repeated bucket keeps its first (real) row, gaps stay gaps", () => {
    expect(market.parseCandles(ohlcvAnswer)).toEqual([
      {t: 1793479260, o: 3.67e-6, h: 3.67e-6, l: 3.45e-6, c: 3.45e-6, v: 110.9},
      {t: 1793481960, o: 3.45e-6, h: 3.45e-6, l: 3.34e-6, c: 3.34e-6, v: 23.2},
    ]);
  });
});

describe("misses and sides", () => {
  test("a trade's side follows the coin, whichever side of the pool it is on", () => {
    const quoteSide = {data: [{attributes: {block_timestamp: "2026-10-31T23:58:00Z", tx_hash: TX, tx_from_address: BUYER, kind: "buy", from_token_address: MINT, to_token_address: "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp", from_token_amount: "5000", to_token_amount: "2", volume_in_usd: "0.4"}}]};
    expect(market.parseTrades(quoteSide, MINT)).toMatchObject([{kind: "sell", tokens: 5000, quote: 2}]);
  });
  test("a coin GeckoTerminal has not indexed is not asked again within the window, and spends no budget meanwhile", async () => {
    launch();
    const net = fakeNetwork({geckoStatus: 404});
    const deps = {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => null};
    const first = await market.readCoinMarket(MINT, deps);
    expect(first).toMatchObject({asOf: null, priceSource: null, priceUsd: null, stale: false});
    const calls = net.calls.length;
    await market.readCoinMarket(MINT, {...deps, now: () => NOW + 60_000});
    expect(net.calls.length).toBe(calls);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM rate_events WHERE scope = 'live:market:gecko:site'").get() as {n: number}).n).toBe(calls);
    // Past the lookup's ten minutes it is asked again.
    await market.readCoinMarket(MINT, {...deps, now: () => NOW + 11 * 60_000});
    expect(net.calls.length).toBe(calls + 1);
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

describe("the endpoint", () => {
  test("only a finished launch answers; anything else is a 400 or 404 without any upstream read", async () => {
    const net = fakeNetwork();
    launch("9ad71NssXqrWRaS5KkKKwK64B8e3mdF1bKpczptcard", "token_pending");
    const bad = await market.serveCoinMarket(new Request("https://launchacard.fun/api/live/market/x"), "not-a-mint", {fetch: net.fetch});
    expect(bad.status).toBe(400);
    const pending = await market.serveCoinMarket(new Request("https://launchacard.fun/api/live/market/x"), "9ad71NssXqrWRaS5KkKKwK64B8e3mdF1bKpczptcard", {fetch: net.fetch});
    expect(pending.status).toBe(404);
    expect((await market.serveCoinCandles(new Request("https://launchacard.fun/x"), MINT, "2m", {fetch: net.fetch})).status).toBe(400);
    expect(net.calls).toEqual([]);
  });
  test("no RPC ready: GeckoTerminal's pool gives price, market cap and trades; chain-only figures are null, never a zero", async () => {
    launch();
    const net = fakeNetwork();
    const answer = await market.readCoinMarket(MINT, {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => null});
    expect(answer).toMatchObject({mint: MINT, status: null, priceUsd: 0.0000027, priceSource: "geckoterminal", marketCapUsd: 2700, progress: null, holders: null, holderCount: null, reservesUsd: null, stale: false});
    expect(answer!.trades).toHaveLength(2);
    expect(net.calls[0].url).toBe(`${market.GECKO_API}/networks/solana/tokens/${MINT}`);
    // The lookup is kept for ten minutes.
    await market.readCoinMarket(MINT, {fetch: net.fetch, now: () => NOW + 60_000, connection: () => null, rpcUrl: () => null});
    expect(net.calls.filter(c => c.url.endsWith(`/tokens/${MINT}`))).toHaveLength(1);
  });
  test("an RPC failure never leaks the RPC URL, and a refused refresh serves the last answer marked stale", async () => {
    launch();
    const chain = fakeChain({fail: true});
    const response = await market.serveCoinMarket(new Request("https://launchacard.fun/api/live/market/x"), MINT, {fetch: fakeNetwork().fetch, now: () => NOW, connection: () => chain.connection as never, rpcUrl: () => "https://rpc.example/secret-key-0001"});
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("secret-key");
    sqlite.query("INSERT INTO live_market_cache (mint, kind, fetched_at, json) VALUES (?, 'curve', ?, ?)").run(MINT, NOW - 60_000, JSON.stringify({status: "curve", priceQuote: 2.8e-8, marketCapQuote: 28, progress: 0.25, reservesQuote: 10, supply: 1e9, pool: CURVE, marketOwners: [CURVE]}));
    // Past the pool's 30 seconds GeckoTerminal refuses: the stats read before are served, marked stale.
    const later = await market.readCoinMarket(MINT, {fetch: fakeNetwork({geckoStatus: 429}).fetch, now: () => NOW + 31_000, connection: () => chain.connection as never, rpcUrl: () => null});
    expect(later).toMatchObject({status: "curve", priceQuote: 2.8e-8, progress: 0.25, quoteUsd: 95.5, volumeUsd24h: 1102.41, stale: true});
    expect(later!.priceUsd).toBeCloseTo(2.8e-8 * 95.5, 15);
  });
  test("with the curve read: dollar price is curve price times the quote's dollar price; parts are cached site-wide", async () => {
    launch();
    sqlite.query("INSERT INTO live_market_cache (mint, kind, fetched_at, json) VALUES (?, 'curve', ?, ?)").run(MINT, NOW - 1_000, JSON.stringify({status: "curve", priceQuote: 2.8e-8, marketCapQuote: 28, progress: 0.25, reservesQuote: 10, supply: 1e9, pool: CURVE, marketOwners: [CURVE]}));
    const net = fakeNetwork();
    const deps = {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => "https://rpc.example/secret-key-0001"};
    const answer = (await market.readCoinMarket(MINT, deps))!;
    expect(answer.priceUsd).toBeCloseTo(2.8e-8 * 95.5, 15);
    expect(answer.marketCapUsd).toBeCloseTo(2.8e-8 * 95.5 * 1e9, 6);
    expect(answer.reservesUsd).toBeCloseTo(955, 6);
    expect(answer).toMatchObject({change: {h24: -10.86}, volumeUsd24h: 1102.41, holderCount: 2, priceSource: "chain", asOf: NOW, stale: false});
    expect(answer.trades).toHaveLength(2);
    const reads = net.calls.length;
    await market.readCoinMarket(MINT, {...deps, now: () => NOW + 5_000});
    expect(net.calls.length).toBe(reads);
    // Candles for one range, read once and then reused.
    const first = await market.readCoinCandles(MINT, "5m", deps);
    expect(first).toMatchObject({range: "5m", stale: false});
    expect(first!.candles).toHaveLength(2);
    const url = new URL(net.calls.at(-1)!.url);
    expect(url.pathname).toBe(`/api/v2/networks/solana/pools/${CURVE}/ohlcv/minute`);
    expect(url.searchParams.get("aggregate")).toBe("5");
    expect(url.searchParams.get("token")).toBe(MINT);
    await market.readCoinCandles(MINT, "5m", deps);
    expect(net.calls.at(-1)!.url).toBe(url.toString());
    expect(net.calls.filter(c => c.url.includes("/ohlcv/"))).toHaveLength(1);
  });
  test("the GeckoTerminal budget is site-wide: past it, parts are served from the cache or null", async () => {
    launch();
    sqlite.query("INSERT INTO live_market_cache (mint, kind, fetched_at, json) VALUES (?, 'curve', ?, ?)").run(MINT, NOW, JSON.stringify({status: "curve", priceQuote: 2.8e-8, marketCapQuote: 28, progress: 0.25, reservesQuote: 10, supply: 1e9, pool: CURVE, marketOwners: [CURVE]}));
    const net = fakeNetwork();
    for (const range of shapes.CHART_RANGES) await market.readCoinCandles(MINT, range, {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => null});
    for (let i = 0; i < 30; i++) sqlite.query("INSERT INTO rate_events (scope, key_hash, at) SELECT scope, key_hash, ? FROM rate_events WHERE scope = 'live:market:gecko:site' LIMIT 1").run(NOW);
    const before = net.calls.length;
    const answer = await market.readCoinMarket(MINT, {fetch: net.fetch, now: () => NOW, connection: () => null, rpcUrl: () => null});
    expect(net.calls.length).toBe(before);
    expect(answer).toMatchObject({volumeUsd24h: null, trades: null, stale: false});
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
    // Units are chosen after rounding; dust never reads as $0.00.
    expect(format.usdShort(999_999)).toBe("$1.00M");
    expect(format.usdShort(99_960)).toBe("$100K");
    expect(format.usdShort(999.6)).toBe("$1.00K");
    expect(format.usdShort(0.004)).toBe("<$0.01");
    expect(format.amountShort(999_950)).toBe("1.00M");
    expect(format.axisPrice(0.0000028)).toBe("0.0₅2800");
    expect(format.axisPrice(0.0123)).toBe("0.01230");
    expect(format.axisPrice(12.5)).toBe("12.50");
  });
  test("the coin page shows the market, the chart, trades, holders and the copyable address, and keeps the card", () => {
    const page = read("src/routes/coin/$id.tsx");
    for (const part of ["<MarketPanel", "<ChartSection", "<TradesSection", "<HoldersSection", "<CopyAddress", "<LaunchCardPreview"]) expect(page).toContain(part);
    expect(read("src/components/carddex/market/CoinMarket.tsx")).toContain('lazy(() => import("./PriceChart"))');
    expect(read("src/components/carddex/market/PriceChart.tsx")).toContain("attributionLogo: true");
  });
});
