import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// A transaction-capable SQLite adapter exercises the exact service SQL against
// every real local migration. No cloud bindings, wallets, RPCs or network calls.
let sqlite = new Database(":memory:");
let writeCalls = 0;
class Prepared {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Prepared(this.sql, values); }
  rows() { return sqlite.query(this.sql).all(...this.values as never[]); }
  async first<T>() { return (this.rows()[0] ?? null) as T | null; }
  async all<T>() { return { results: this.rows() as T[] }; }
  async run() { writeCalls++; const results = this.rows(); return { results, success: true, meta: { changes: (sqlite.query("SELECT changes() AS n").get() as { n: number }).n } }; }
}
const localD1 = {
  prepare(sql: string) { return new Prepared(sql); },
  async batch(statements: Prepared[]) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const output = [];
      for (const statement of statements) output.push(await statement.run());
      sqlite.exec("COMMIT");
      return output;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
mock.module("../../src/lib/bindings.server", () => ({ bindings: () => ({ DB: localD1 }) }));
const db = await import("../../src/lib/mintdex/server/db.server");
mock.module("../../src/lib/mintdex/server/auth.server", () => ({
  viewerQuery: (hash: string | null) => db.q("SELECT u.id, u.handle, u.balance, u.faucet_at, u.created_at FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ?", hash),
}));
mock.module("../../src/lib/mintdex/server/background.server", () => ({ runInBackground: () => {} }));
const service = await import("../../src/lib/mintdex/server/service.server");
const seed = await import("../../src/lib/mintdex/server/seed.server");
const { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign } = await import("../../src/lib/carddex/designs");
const { INITIAL_RESERVES, quoteBuy, quoteSell } = await import("../../src/lib/mintdex/curve");
const { LAUNCH_FEE, LAMPORTS } = await import("../../src/lib/mintdex/constants");
const migrations = resolve(import.meta.dir, "../../migrations");

const user = { id: "creator", handle: "creator", balance: 2000 * 1e9, faucet_at: 0, created_at: Date.now() };
const launch = (cardTemplate: string = DEFAULT_CARD_DESIGN, devBuy = 0, ticker = "OWN") => service.launchCoin(user, { name: "Independent Token", ticker, image: "/api/img/art/qa-token.png", lore: "Creator artwork stays its own.", devBuy, cardTemplate });
const row = (id: string) => sqlite.query("SELECT * FROM coins WHERE id = ?").get(id) as Record<string, unknown>;
beforeEach(() => {
  sqlite.close(); sqlite = new Database(":memory:"); writeCalls = 0;
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(migrations, name), "utf8");
    if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql);
  }
  sqlite.query("INSERT INTO users (id, handle, balance, is_npc, faucet_at, created_at) VALUES (?, ?, ?, 0, 0, ?)").run(user.id, user.handle, user.balance, user.created_at);
  sqlite.query("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ('qa-session', ?, ?)").run(user.id, user.created_at);
});
afterAll(() => sqlite.close());

describe("CardDex fixed creator cards and token trading", () => {
  test("every design persists through actual launch SQL and reads", async () => {
    for (const [index, design] of CARD_DESIGNS.entries()) {
      const result = await launch(design.key, 0, `D${String(index).padStart(2, "0")}`);
      const stored = row(result.id);
      expect(stored.card_template).toBe(design.key);
      expect(stored.level).toBe(design.materialLevel);
      expect(stored.owner_id).toBe(user.id);
      expect(stored.creator_id).toBe(user.id);
      expect(stored.mint_address).toBeNull();
      const page = await service.getCoinPage(result.id, "qa-session");
      expect(page?.coin.cardTemplate).toBe(design.key);
      expect(page?.coin.level).toBe(design.materialLevel);
      expect(page?.coin.stockTicker).toBe(design.stock?.ticker ?? null);
      expect(page?.coin.tokenPair).toBe(design.stock?.pair ?? null);
      expect(page?.bids).toEqual([]);
      expect(page?.sales).toEqual([]);
    }
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({ n: CARD_DESIGNS.length });
    expect((await service.getHome()).featured).toHaveLength(CARD_DESIGNS.length);
    expect((await service.getLevels()).counts).toEqual(CARD_DESIGNS.map(() => 1));
  });

  test("stock references are catalog-derived, survive token trades, and reject spoofed associations", async () => {
    const stockDesigns = CARD_DESIGNS.filter((design) => design.stock);
    expect(stockDesigns.length).toBeGreaterThan(0);
    for (const [index, design] of stockDesigns.entries()) {
      const { id } = await launch(design.key, LAMPORTS, `S${String(index).padStart(2, "0")}`);
      const buy = await service.trade(user, id, "buy", LAMPORTS);
      await service.trade(user, id, "sell", Math.floor(buy.tokens / 2));
      const page = await service.getCoinPage(id, "qa-session");
      expect(page?.coin.cardTemplate).toBe(design.key);
      expect(page?.coin.stockTicker).toBe(design.stock!.ticker);
      expect(page?.coin.tokenPair).toBe(design.stock!.pair);
      expect(page?.coin.ticker).toBe(`S${String(index).padStart(2, "0")}`);
      const item = (await service.getPortfolio("qa-session"))?.deeds.find((item) => item.coin.id === id);
      expect(item?.coin.stockTicker).toBe(design.stock!.ticker);
      expect(item?.coin.tokenPair).toBe(design.stock!.pair);
    }
    const stock = stockDesigns[0];
    const base = { name: "Stock Reference", ticker: "SPOOF", image: "/api/img/art/qa-token.png", lore: "Reference artwork only.", devBuy: 0, cardTemplate: stock.key };
    const before = (sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance;
    await expect(service.launchCoin(user, { ...base, stockTicker: "FAKE" })).rejects.toThrow("stock reference must match");
    await expect(service.launchCoin(user, { ...base, tokenPair: "FAKE / SOL" })).rejects.toThrow("reference pair must match");
    const ordinary = CARD_DESIGNS.find((design) => !design.stock)!;
    await expect(service.launchCoin(user, { ...base, cardTemplate: ordinary.key, stockTicker: stock.stock!.ticker })).rejects.toThrow("stock reference must match");
    expect((sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance).toBe(before);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins WHERE ticker = 'SPOOF'").get()).toEqual({ n: 0 });
    const accepted = await service.launchCoin(user, { ...base, stockTicker: stock.stock!.ticker, tokenPair: stock.stock!.pair });
    expect((await service.getCoinPage(accepted.id, null))?.coin.tokenPair).toBe(stock.stock!.pair);
  });

  test("dev buy, token buy and token sell conserve quoted funds and never evolve or accrue royalties", async () => {
    const template = CARD_DESIGNS.find((design) => design.key === "spark") ?? CARD_DESIGNS[0];
    const devBuy = 2 * LAMPORTS;
    const initialQuote = quoteBuy(INITIAL_RESERVES, devBuy);
    const { id } = await launch(template.key, devBuy);
    expect((sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance).toBe(user.balance - LAUNCH_FEE - initialQuote.solIn);
    const before = row(id);
    const buyAmount = 100 * LAMPORTS;
    const buyQuote = quoteBuy({ vSol: Number(before.v_sol), vTok: Number(before.v_tok) }, buyAmount);
    const fill = await service.trade(user, id, "buy", buyAmount, buyQuote.tokensOut);
    expect(fill.tokens).toBe(buyQuote.tokensOut);
    expect(fill.levelUp).toBeNull();
    const bought = row(id);
    expect(Number(bought.peak_mcap_usd)).toBeGreaterThan(Number(before.peak_mcap_usd));
    const sellAmount = Math.floor(buyQuote.tokensOut / 2);
    const sellQuote = quoteSell({ vSol: Number(bought.v_sol), vTok: Number(bought.v_tok) }, sellAmount);
    const sold = await service.trade(user, id, "sell", sellAmount, sellQuote.solOut);
    expect(sold.net).toBe(sellQuote.solOut);
    const final = row(id);
    expect(final.card_template).toBe(template.key);
    expect(final.level).toBe(template.materialLevel);
    expect(final.peak_level).toBe(template.materialLevel);
    expect(final.owner_fees).toBe(0);
    expect(final.fee_vault).toBe(0);
    expect(final.owner_id).toBe(user.id);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM events WHERE kind = 'levelup'").get()).toEqual({ n: 0 });
    expect(sqlite.query("SELECT COUNT(*) AS n FROM owner_earnings").get()).toEqual({ n: 0 });
    const walletBalance = (sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance;
    expect(walletBalance).toBe(user.balance - LAUNCH_FEE - devBuy - buyAmount + sellQuote.solOut);
    expect(Number((sqlite.query("SELECT value FROM meta WHERE key = 'protocol_fees'").get() as { value: string }).value)).toBe(LAUNCH_FEE + initialQuote.fee + buyQuote.fee + sellQuote.fee);
    const portfolio = await service.getPortfolio("qa-session");
    expect(portfolio?.deeds[0].coin.cardTemplate).toBe(template.key);
    expect(portfolio?.deeds[0].earnings).toBe(0);
    expect(portfolio?.bids).toEqual([]);
    expect(portfolio?.offers).toEqual([]);
    expect(portfolio?.totals.earnings).toBe(0);
    expect(portfolio?.totals.escrowed).toBe(0);
  });

  test("bad selections and slippage failures leave funds and cards unchanged", async () => {
    const before = (sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance;
    await expect(launch("not-a-template")).rejects.toThrow("Choose an available card design");
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({ n: 0 });
    const { id } = await launch();
    const beforeTrade = row(id);
    await expect(service.trade(user, id, "buy", LAMPORTS, Number.MAX_SAFE_INTEGER)).rejects.toThrow("Price moved");
    expect(row(id)).toEqual(beforeTrade);
    expect((sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance).toBe(before - LAUNCH_FEE);
  });

  test("all removed NFT mutation entry points reject before database access", async () => {
    const start = writeCalls;
    const calls = [() => service.placeBid(user, "missing", LAMPORTS), () => service.cancelBid(user, "missing"), () => service.acceptBid(user, "missing"), () => service.setListing(user, "missing", LAMPORTS), () => service.buyNow(user, "missing", LAMPORTS), () => service.withdrawFees(user, "missing")];
    for (const call of calls) await expect(call()).rejects.toThrow(service.NFT_TRADING_REMOVED);
    expect(writeCalls).toBe(start);
    expect(await service.getMarket()).toMatchObject({ listed: [], topBids: [], sales: [] });
  });

  test("database invariants reject raw design, owner, listing, bid, sale and royalty mutations", async () => {
    const { id } = await launch();
    expect(() => sqlite.query("UPDATE coins SET card_template = 'doge' WHERE id = ?").run(id)).toThrow("design is immutable");
    const alternateLevel = getCardDesign(DEFAULT_CARD_DESIGN).materialLevel === 1 ? 2 : 1;
    expect(() => sqlite.query("UPDATE coins SET level = ? WHERE id = ?").run(alternateLevel, id)).toThrow("design is immutable");
    expect(() => sqlite.query("UPDATE coins SET owner_id = 'buyer' WHERE id = ?").run(id)).toThrow("cannot be traded");
    expect(() => sqlite.query("UPDATE coins SET list_price = 1 WHERE id = ?").run(id)).toThrow("no marketplace");
    expect(() => sqlite.query("UPDATE coins SET fee_vault = 1 WHERE id = ?").run(id)).toThrow("no marketplace");
    expect(() => sqlite.query("INSERT INTO bids (id, coin_id, bidder_id, amount, created_at, updated_at) VALUES ('b', ?, 'buyer', 1, 0, 0)").run(id)).toThrow("bids are not supported");
    expect(() => sqlite.query("INSERT INTO deed_sales (coin_id, seller_id, buyer_id, price, kind, created_at) VALUES (?, 'creator', 'buyer', 1, 'buy_now', 0)").run(id)).toThrow("sales are not supported");
    expect(() => sqlite.query("INSERT INTO owner_earnings (user_id, coin_id, amount) VALUES ('creator', ?, 1)").run(id)).toThrow("royalties are not supported");
  });

  test("seeded token histories contain no real mints, evolution, NFT trades or fee entitlements", async () => {
    await localD1.batch(seed.buildSeed() as unknown as Prepared[]);
    const coins = await service.allCoins();
    expect(coins).toHaveLength(10);
    for (const coin of coins) {
      expect(coin.cardTemplate).toBeTruthy();
      expect(coin.level).toBe(getCardDesign(coin.cardTemplate).materialLevel);
      expect(coin.ownerId).toBe(coin.creatorId);
      expect(coin.mintAddress).toBeNull();
      expect(coin.feeVault).toBe(0);
      expect(coin.listPrice).toBeNull();
      expect(coin.topBid).toBeNull();
    }
    expect(sqlite.query("SELECT COUNT(*) AS n FROM trades").get()).toEqual({ n: 420 });
    for (const table of ["bids", "deed_sales", "owner_earnings", "vanity_pool"]) expect(sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(sqlite.query("SELECT COUNT(*) AS n FROM events WHERE kind NOT IN ('launch', 'buy', 'sell')").get()).toEqual({ n: 0 });
  });
});
