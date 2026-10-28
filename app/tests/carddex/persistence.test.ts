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
const { MEME_PAIR_PRESETS } = await import("../../src/lib/carddex/design-pairings");
const { INITIAL_RESERVES, quoteBuy, quoteSell } = await import("../../src/lib/mintdex/curve");
const { LAUNCH_FEE, LAMPORTS } = await import("../../src/lib/mintdex/constants");
const { PAIR_ASSETS, defaultQuoteForDesign, getPairAsset, getTradingPair } = await import("../../src/lib/carddex/pairs");
const { demoQuoteStartBalance, initialQuoteReserves, maxInitialBuyQuoteAtoms, quoteUnit } = await import("../../src/lib/carddex/quote-simulation");
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
      const asset = defaultQuoteForDesign(design.key);
      expect(page?.coin.cardTemplate).toBe(design.key);
      expect(page?.coin.level).toBe(design.materialLevel);
      expect(page?.coin.stockTicker).toBe(asset.kind === "stock" ? asset.referenceTicker : null);
      expect(page?.coin.tokenPair).toBe(asset.kind === "stock" ? getTradingPair(`D${String(index).padStart(2, "0")}`, asset.key) : null);
      expect(page?.bids).toEqual([]);
      expect(page?.sales).toEqual([]);
    }
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({ n: CARD_DESIGNS.length });
    expect((await service.getHome()).featured).toHaveLength(CARD_DESIGNS.length);
    expect((await service.getLevels()).counts).toEqual(CARD_DESIGNS.map(() => 1));
  });

  test("stock references are catalog-derived, survive token trades, and reject spoofed associations", async () => {
    const stockDesigns = CARD_DESIGNS.filter((design) => design.stock);
    expect(stockDesigns.map(design => design.key).sort()).toEqual(["stock-gme", "stock-tsla", "stock-nvda", "stock-aapl", "stock-mstr", "stock-coin", "gamestop", "amc", "coinbase", "strategy"].sort());
    for (const [index, design] of stockDesigns.entries()) {
      const asset = defaultQuoteForDesign(design.key);
      const amount = Math.floor(initialQuoteReserves(asset.key).vSol / 30);
      const identity = { quoteAssetKey: asset.key, quoteMint: asset.mint };
      const { id } = await launch(design.key, amount, `S${String(index).padStart(2, "0")}`);
      const buy = await service.trade(user, id, "buy", amount, 0, identity);
      await service.trade(user, id, "sell", Math.floor(buy.tokens / 2), 0, identity);
      const page = await service.getCoinPage(id, "qa-session");
      expect(page?.coin.cardTemplate).toBe(design.key);
      expect(page?.coin.stockTicker).toBe(asset.referenceTicker);
      expect(page?.coin.tokenPair).toBe(getTradingPair(`S${String(index).padStart(2, "0")}`, asset.key));
      expect(page?.coin.ticker).toBe(`S${String(index).padStart(2, "0")}`);
      const item = (await service.getPortfolio("qa-session"))?.deeds.find((item) => item.coin.id === id);
      expect(item?.coin.stockTicker).toBe(asset.referenceTicker);
      expect(item?.coin.tokenPair).toBe(getTradingPair(`S${String(index).padStart(2, "0")}`, asset.key));
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
    const stockQuote = defaultQuoteForDesign(stock.key);
    await expect(service.launchCoin(user, { ...base, tokenPair: `${stockQuote.referenceTicker} / SOL` })).rejects.toThrow("reference pair must match");
    const accepted = await service.launchCoin(user, { ...base, stockTicker: stockQuote.referenceTicker, tokenPair: getTradingPair(base.ticker, stockQuote.key) });
    expect((await service.getCoinPage(accepted.id, null))?.coin.tokenPair).toBe(getTradingPair(base.ticker, stockQuote.key));
  });

  test("a neutral design derives stock references from its selected quote", async () => {
    const asset = getPairAsset("tslax");
    const input = { name: "Neutral Stock Quote", ticker: "NEUTRAL", image: "/api/img/art/qa-token.png", lore: "The actual quote defines this association.", cardTemplate: "spark", devBuy: 0, quoteAssetKey: asset.key, quoteMint: asset.mint, stockTicker: "TSLA", tokenPair: "NEUTRAL / TSLAX" };
    const {id} = await service.launchCoin(user, input);
    const page = (await service.getCoinPage(id, "qa-session"))!;
    expect(row(id).quote_mint).toBe(asset.mint);
    expect(page.coin).toMatchObject({cardTemplate: "spark", stockTicker: "TSLA", tokenPair: "NEUTRAL / TSLAX", tradingPair: "NEUTRAL / TSLAX"});
    expect((await service.getPortfolio("qa-session"))?.deeds.find(item => item.coin.id === id)?.coin.stockTicker).toBe("TSLA");
    await expect(service.launchCoin(user, {...input, ticker: "WRONG", stockTicker: "GME", tokenPair: "WRONG / TSLAX"})).rejects.toThrow("stock reference must match");
    await expect(service.launchCoin(user, {...input, ticker: "OLDPAIR", tokenPair: "TSLA / SOL"})).rejects.toThrow("reference pair must match");
  });

  test("historical stock artwork keeps its stored SOL quote through reads and trades", async () => {
    const design = getCardDesign("stock-tsla"), now = Date.now();
    // Represents a pre-pairing row: the quote columns retain their migration defaults.
    sqlite.query(`INSERT INTO coins (id, dex_no, name, ticker, image, creator_id, owner_id, v_sol, v_tok, level, peak_level, card_template, created_at, last_trade_at)
      VALUES ('legacy-stock-sol', 1, 'Historical Tesla Art', 'OLDTSLA', '/api/img/art/qa-token.png', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, user.id, INITIAL_RESERVES.vSol, INITIAL_RESERVES.vTok, design.materialLevel, design.materialLevel, design.key, now, now);
    const sol = getPairAsset("sol");
    const bought = await service.trade(user, "legacy-stock-sol", "buy", LAMPORTS, 0, {quoteAssetKey: sol.key, quoteMint: sol.mint});
    await service.trade(user, "legacy-stock-sol", "sell", Math.floor(bought.tokens / 2), 0, {quoteAssetKey: sol.key, quoteMint: sol.mint});
    const page = (await service.getCoinPage("legacy-stock-sol", "qa-session"))!;
    expect(page.coin).toMatchObject({cardTemplate: "stock-tsla", quoteAssetKey: "sol", quoteMint: sol.mint, stockTicker: null, tokenPair: null, tradingPair: "OLDTSLA / SOL"});
    expect(page.trades.every(trade => trade.quoteAssetKey === "sol")).toBe(true);
    expect(row("legacy-stock-sol").quote_asset_key).toBe("sol");
    expect(row("legacy-stock-sol").quote_mint).toBe(sol.mint);
    expect((await service.getPortfolio("qa-session"))?.deeds.find(item => item.coin.id === "legacy-stock-sol")?.coin).toMatchObject({stockTicker: null, tokenPair: null});
  });

  for (const asset of PAIR_ASSETS) test(`${asset.symbol} quote atoms stay separate through launch, edit, buy, sell and portfolio`, async () => {
    await service.getMe(user);
    const initial = initialQuoteReserves(asset.key);
    const amount = Math.floor(initial.vSol / 30);
    const identity = { quoteAssetKey: asset.key, quoteMint: asset.mint };
    const input = { name: "Quote Native Token", ticker: "QNT", image: "/api/img/art/qa-token.png", lore: "Own token, real quote identity, simulated accounting.", cardTemplate: "spark", devBuy: amount, ...identity };
    const first = quoteBuy(initial, amount);
    const { id } = await service.launchCoin(user, input);
    await service.updateLore(user, id, "An edited creator story.");
    const second = quoteBuy(first.after, amount);
    const bought = await service.trade(user, id, "buy", amount, second.tokensOut, identity);
    const tokensToSell = Math.floor(bought.tokens / 2);
    const sale = quoteSell(second.after, tokensToSell);
    const sold = await service.trade(user, id, "sell", tokensToSell, sale.solOut, identity);
    const stored = row(id);
    expect(stored.quote_asset_key).toBe(asset.key);
    expect(stored.quote_mint).toBe(asset.mint);
    expect(stored.card_template).toBe("spark");
    expect(stored.v_sol).toBe(sale.after.vSol);
    const page = (await service.getCoinPage(id, "qa-session"))!;
    expect(page.coin.quoteAssetKey).toBe(asset.key);
    expect(page.coin.quoteMint).toBe(asset.mint);
    expect(page.coin.quoteDecimals).toBe(asset.decimals);
    expect(page.coin.quoteTokenProgram).toBe(asset.tokenProgram);
    expect(page.coin.tradingPair).toBe(`QNT / ${asset.symbol}`);
    expect(page.coin.stockTicker).toBe(asset.kind === "stock" ? asset.referenceTicker : null);
    expect(page.coin.tokenPair).toBe(asset.kind === "stock" ? `QNT / ${asset.symbol}` : null);
    expect(page.coin.lore).toBe("An edited creator story.");
    expect(page.coin.vQuote).toBe(sale.after.vSol);
    expect(page.trades.every(trade => trade.quoteAssetKey === asset.key)).toBe(true);
    expect(bought.quoteNet).toBe(amount);
    expect(sold.quoteNet).toBe(sale.solOut);
    const allFees = first.fee + second.fee + sale.fee;
    const native = (sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance;
    expect(native).toBe(user.balance - LAUNCH_FEE - (asset.key === "sol" ? amount * 2 - sale.solOut : 0));
    if (asset.key !== "sol") {
      const wallet = sqlite.query("SELECT balance FROM quote_balances WHERE user_id = ? AND quote_asset_key = ?").get(user.id, asset.key) as { balance: number };
      expect(wallet.balance).toBe(demoQuoteStartBalance(asset.key) - amount * 2 + sale.solOut);
      expect(sqlite.query("SELECT amount FROM protocol_quote_fees WHERE quote_asset_key = ?").get(asset.key)).toEqual({ amount: String(allFees) });
    }
    expect(Number((sqlite.query("SELECT value FROM meta WHERE key = 'protocol_fees'").get() as { value: string }).value)).toBe(LAUNCH_FEE + (asset.key === "sol" ? allFees : 0));
    for (const other of PAIR_ASSETS.filter(other => other.key !== "sol" && other.key !== asset.key)) {
      expect(sqlite.query("SELECT balance FROM quote_balances WHERE user_id = ? AND quote_asset_key = ?").get(user.id, other.key)).toEqual({ balance: demoQuoteStartBalance(other.key) });
    }
    const portfolio = (await service.getPortfolio("qa-session"))!;
    expect(portfolio.holdings[0].coin.quoteAssetKey).toBe(asset.key);
    expect(portfolio.totals.holdingsValueByQuote[asset.key]).toBe(portfolio.holdings[0].valueQuote);
    if (asset.kind === "stock" || asset.kind === "meme" || asset.kind === "collector") {
      expect(page.coin.mcapUsd).toBeNull();
      expect(page.coin.priceSol).toBeNull();
      expect(bought.sol).toBeNull();
      expect(sold.net).toBeNull();
      expect(page.trades.every(trade => trade.sol === null && trade.price === null && trade.mcapUsd === null)).toBe(true);
      expect(portfolio.holdings[0].valueSol).toBeNull();
      expect(portfolio.totals.holdingsValue).toBeNull();
      expect((await service.getHome()).stats.volume).toBeNull();
      expect((await service.recentEvents()).every(event => event.amount === null)).toBe(true);
    }
  });

  test("collector and meme design presets retain the creator's token and selected quote through trades and collection reads", async () => {
    await service.getMe(user);
    for (const [index, preset] of MEME_PAIR_PRESETS.entries()) {
      const asset = getPairAsset(preset.quote), amount = Math.floor(initialQuoteReserves(asset.key).vSol / 30);
      const ticker = `P${index}`, identity = {quoteAssetKey: asset.key, quoteMint: asset.mint};
      const {id} = await service.launchCoin(user, {name: "Own Collector Token", ticker, image: "/api/img/art/qa-token.png", lore: "A themed finish with the creator's own token.", cardTemplate: preset.design, devBuy: amount, ...identity});
      const replacement = PAIR_ASSETS.find(other => other.key !== asset.key && other.decimals === asset.decimals)!;
      const beforeSubstitution = writeCalls;
      await expect(service.trade(user, id, "buy", amount, 0, {quoteAssetKey: replacement.key, quoteMint: replacement.mint})).rejects.toThrow("does not match");
      await expect(service.trade(user, id, "buy", amount, 0, {...identity, quoteMint: replacement.mint})).rejects.toThrow("does not match");
      expect(writeCalls).toBe(beforeSubstitution);
      const bought = await service.trade(user, id, "buy", amount, 0, identity);
      await service.trade(user, id, "sell", Math.floor(bought.tokens / 2), 0, identity);
      const coin = (await service.getCoinPage(id, "qa-session"))!.coin;
      expect(coin).toMatchObject({cardTemplate: preset.design, ticker, image: "/api/img/art/qa-token.png", ...identity, quoteDecimals: asset.decimals, quoteTokenProgram: asset.tokenProgram, tradingPair: `${ticker} / ${asset.symbol}`, stockTicker: null, tokenPair: null, mcapUsd: null, priceSol: null});
      expect(row(id)).toMatchObject({card_template: preset.design, quote_asset_key: asset.key, quote_mint: asset.mint, owner_id: user.id, creator_id: user.id});
      const deed = (await service.getPortfolio("qa-session"))!.deeds.find(item => item.coin.id === id)!;
      expect(deed.coin).toMatchObject({cardTemplate: preset.design, ticker, ...identity});
      expect((await service.allCoins()).find(coin => coin.id === id)).toMatchObject({cardTemplate: preset.design, ...identity});
    }
  });

  for (const [cardTemplate, quoteKey] of [["pokemon-classic", "sol"], ["pokemon-full-art", "tslax"], ["pepe", "sol"], ["pepe", "gmex"], ...["ember", "relic", "tide", "neon-circuit", "frost", "mythic", "celestial", "regal", "wildtype", "aurora"].map(design => [design, "sol"])]) test(`existing ${cardTemplate}/${quoteKey} row keeps its stored quote through reads and trading`, async () => {
    await service.getMe(user);
    const asset = getPairAsset(quoteKey), design = getCardDesign(cardTemplate), initial = initialQuoteReserves(quoteKey), now = Date.now();
    sqlite.query(`INSERT INTO coins (id, dex_no, name, ticker, image, creator_id, owner_id, v_sol, v_tok, level, peak_level, card_template, quote_asset_key, quote_mint, created_at, last_trade_at)
      VALUES ('legacy-themed-pair', 1, 'Historical Themed Token', 'OLDTHEME', '/api/img/art/qa-token.png', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.id, initial.vSol, initial.vTok, design.materialLevel, design.materialLevel, cardTemplate, asset.key, asset.mint, now, now);
    const identity = {quoteAssetKey: asset.key, quoteMint: asset.mint}, amount = Math.floor(initial.vSol / 30);
    const bought = await service.trade(user, "legacy-themed-pair", "buy", amount, 0, identity);
    await service.trade(user, "legacy-themed-pair", "sell", Math.floor(bought.tokens / 2), 0, identity);
    const page = (await service.getCoinPage("legacy-themed-pair", "qa-session"))!;
    expect(page.coin).toMatchObject({cardTemplate, ...identity, tradingPair: `OLDTHEME / ${asset.symbol}`, stockTicker: asset.kind === "stock" ? asset.referenceTicker : null});
    expect(page.trades.every(trade => trade.quoteAssetKey === asset.key)).toBe(true);
    expect(row("legacy-themed-pair")).toMatchObject({card_template: cardTemplate, quote_asset_key: asset.key, quote_mint: asset.mint});
    expect((await service.getPortfolio("qa-session"))!.deeds.find(item => item.coin.id === "legacy-themed-pair")?.coin).toMatchObject({cardTemplate, ...identity});
  });

  test("quote spoofing, incompatible designs, unsafe amounts and raw quote updates are rejected", async () => {
    const base = { name: "Quote Guard", ticker: "GUARD", image: "/api/img/art/qa-token.png", lore: "Immutable quote identity.", cardTemplate: "spark", devBuy: 0 };
    const before = writeCalls;
    await expect(service.launchCoin(user, { ...base, quoteAssetKey: "unsupported" })).rejects.toThrow("supported pump.fun quote");
    await expect(service.launchCoin(user, { ...base, quoteAssetKey: "usdc", quoteMint: PAIR_ASSETS[0].mint })).rejects.toThrow("quote mint");
    await expect(service.launchCoin(user, { ...base, cardTemplate: "stock-tsla", quoteAssetKey: "sol" })).rejects.toThrow("compatible card");
    await expect(service.launchCoin(user, { ...base, devBuy: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow("safe initial-buy");
    await expect(service.launchCoin(user, { ...base, devBuy: 1.5 })).rejects.toThrow("safe initial-buy");
    expect(writeCalls).toBe(before);
    const asset = PAIR_ASSETS.find(asset => asset.key === "usdc")!;
    const { id } = await service.launchCoin(user, { ...base, quoteAssetKey: asset.key, quoteMint: asset.mint });
    const writes = writeCalls;
    await expect(service.trade(user, id, "buy", quoteUnit(asset.key))).rejects.toThrow("confirm its quote");
    await expect(service.trade(user, id, "buy", quoteUnit(asset.key), 0, { quoteAssetKey: "sol" })).rejects.toThrow("does not match");
    await expect(service.trade(user, id, "buy", Number.MAX_SAFE_INTEGER + 1, 0, { quoteAssetKey: asset.key })).rejects.toThrow("safe integer");
    expect(writeCalls).toBe(writes);
    expect(() => sqlite.query("UPDATE coins SET quote_asset_key = 'sol' WHERE id = ?").run(id)).toThrow("quote asset is immutable");
    expect(() => sqlite.query("UPDATE coins SET quote_mint = 'fake' WHERE id = ?").run(id)).toThrow("quote asset is immutable");
  });

  test("65 BONK round trips preserve exact analytics past MAX_SAFE_INTEGER without blocking sells", async () => {
    const asset = PAIR_ASSETS.find(asset => asset.key === "bonk")!;
    const identity = { quoteAssetKey: asset.key, quoteMint: asset.mint };
    const { id } = await service.launchCoin(user, { name: "Busy BONK", ticker: "BUSY", image: "/api/img/art/qa-token.png", lore: "Exact quote analytics.", cardTemplate: "bonk", devBuy: 0, ...identity });
    let reserves = initialQuoteReserves(asset.key);
    const amount = maxInitialBuyQuoteAtoms(asset.key);
    let volume = 0n, fees = 0n, spent = 0n, firstBuy = 0n;
    for (let i = 0; i < 65; i++) {
      const buy = quoteBuy(reserves, amount);
      const bought = await service.trade(user, id, "buy", amount, buy.tokensOut, identity);
      const sell = quoteSell(buy.after, bought.tokens);
      await service.trade(user, id, "sell", bought.tokens, sell.solOut, identity);
      volume += BigInt(buy.solIn) + BigInt(sell.gross);
      fees += BigInt(buy.fee) + BigInt(sell.fee);
      spent += BigInt(buy.solIn) - BigInt(sell.solOut);
      reserves = sell.after;
      if (i === 0) firstBuy = BigInt(buy.solIn);
    }
    expect(volume > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    // Keep the lifetime total while excluding one trade from the rolling window.
    sqlite.query("UPDATE trades SET created_at = ? WHERE id = (SELECT MIN(id) FROM trades WHERE coin_id = ?)").run(Date.now() - 25 * 3_600_000, id);
    const page = (await service.getCoinPage(id, "qa-session"))!;
    expect(page.coin.volumeQuote).toBe(volume.toString());
    expect(page.coin.volume24hQuote).toBe((volume - firstBuy).toString());
    expect(page.coin.volume).toBeNull();
    expect(page.coin.volume24h).toBeNull();
    expect((await service.allCoins())[0].volumeQuote).toBe(volume.toString());
    expect((await service.getHome()).stats.volumeByQuote).toEqual({ bonk: volume.toString() });
    expect(sqlite.query("SELECT amount, typeof(amount) AS storage FROM protocol_quote_fees WHERE quote_asset_key = 'bonk'").get()).toEqual({ amount: fees.toString(), storage: "text" });
    const balance = (sqlite.query("SELECT balance FROM quote_balances WHERE user_id = ? AND quote_asset_key = 'bonk'").get(user.id) as { balance: number }).balance;
    expect(Number.isSafeInteger(balance)).toBe(true);
    expect(balance).toBe(demoQuoteStartBalance("bonk") - Number(spent));
    expect(sqlite.query("SELECT amount FROM holdings WHERE user_id = ? AND coin_id = ?").get(user.id, id)).toEqual({ amount: 0 });
    // The deprecated INTEGER cache no longer accumulates or becomes REAL.
    expect(sqlite.query("SELECT volume, typeof(volume) AS storage FROM coins WHERE id = ?").get(id)).toEqual({ volume: 0, storage: "integer" });
  });

  test("volume aggregation survives SQLite SUM overflow using individual exact trade atoms", async () => {
    const { id } = await launch("spark");
    const amount = Number.MAX_SAFE_INTEGER;
    const at = Date.now();
    const insert = sqlite.query("INSERT INTO trades (coin_id, user_id, side, sol, tokens, price, mcap_usd, created_at) VALUES (?, ?, 'buy', ?, 1, 1, 1, ?)");
    sqlite.transaction(() => { for (let i = 0; i < 1100; i++) insert.run(id, user.id, amount, at); })();
    const expected = BigInt(amount) * 1100n;
    expect(expected > 9_223_372_036_854_775_807n).toBe(true);
    expect(() => sqlite.query("SELECT SUM(sol) FROM trades").get()).toThrow("integer overflow");
    const page = (await service.getCoinPage(id, null))!;
    expect(page.coin.volumeQuote).toBe(expected.toString());
    expect(page.coin.volume24hQuote).toBe(expected.toString());
    expect((await service.getHome()).stats.volumeByQuote.sol).toBe(expected.toString());
  });

  test("quote and native fee ledgers add exact text totals beyond signed 64-bit integers", async () => {
    const asset = PAIR_ASSETS.find(asset => asset.key === "bonk")!;
    const identity = { quoteAssetKey: asset.key, quoteMint: asset.mint };
    const { id } = await service.launchCoin(user, { name: "Fee Precision", ticker: "FEE", image: "/api/img/art/qa-token.png", lore: "Exact accumulated fees.", cardTemplate: "bonk", devBuy: 0, ...identity });
    const prior = 184_467_440_737_095_516_179n;
    sqlite.query("INSERT INTO protocol_quote_fees (quote_asset_key, amount) VALUES ('bonk', ?)").run(prior.toString());
    const amount = maxInitialBuyQuoteAtoms("bonk");
    const buy = quoteBuy(initialQuoteReserves("bonk"), amount);
    const bought = await service.trade(user, id, "buy", amount, buy.tokensOut, identity);
    const sell = quoteSell(buy.after, bought.tokens);
    await service.trade(user, id, "sell", bought.tokens, sell.solOut, identity);
    expect(sqlite.query("SELECT amount FROM protocol_quote_fees WHERE quote_asset_key = 'bonk'").get()).toEqual({ amount: (prior + BigInt(buy.fee) + BigInt(sell.fee)).toString() });
    sqlite.query("UPDATE protocol_quote_fees SET amount = ? WHERE quote_asset_key = 'sol'").run(prior.toString());
    sqlite.query("UPDATE meta SET value = ? WHERE key = 'protocol_fees'").run(prior.toString());
    const devBuy = LAMPORTS;
    const first = quoteBuy(INITIAL_RESERVES, devBuy);
    await launch("spark", devBuy, "SOLFEE");
    const expectedNative = (prior + BigInt(LAUNCH_FEE) + BigInt(first.fee)).toString();
    expect(sqlite.query("SELECT amount, typeof(amount) AS storage FROM protocol_quote_fees WHERE quote_asset_key = 'sol'").get()).toEqual({ amount: expectedNative, storage: "text" });
    expect(sqlite.query("SELECT value FROM meta WHERE key = 'protocol_fees'").get()).toEqual({ value: expectedNative });
    for (const invalid of ["", "-1", "01", "1e3", "2.5"]) {
      expect(() => sqlite.query("UPDATE protocol_quote_fees SET amount = ? WHERE quote_asset_key = 'bonk'").run(invalid)).toThrow("CHECK");
    }
  });

  test("mixed portfolio spot values and per-quote totals retain large exact atom-rounded estimates", async () => {
    const launchQuoted = (key: string, ticker: string, amount: number) => {
      const asset = PAIR_ASSETS.find(asset => asset.key === key)!;
      return service.launchCoin(user, { name: "Portfolio Precision", ticker, image: "/api/img/art/qa-token.png", lore: "Separate quote values.", cardTemplate: "spark", devBuy: amount, quoteAssetKey: key, quoteMint: asset.mint });
    };
    const first = await launchQuoted("bonk", "BONKONE", maxInitialBuyQuoteAtoms("bonk"));
    await launchQuoted("bonk", "BONKTWO", quoteUnit("bonk"));
    await launchQuoted("sol", "SOLHOLD", LAMPORTS);
    await launchQuoted("usdc", "USDCHOLD", quoteUnit("usdc"));
    const whale = { ...user, id: "whale", handle: "whale" };
    sqlite.query("INSERT INTO users (id, handle, balance, is_npc, faucet_at, created_at) VALUES (?, ?, ?, 0, 0, ?)").run(whale.id, whale.handle, whale.balance, whale.created_at);
    await service.getMe(whale);
    sqlite.query("UPDATE quote_balances SET balance = ? WHERE user_id = ? AND quote_asset_key = 'bonk'").run(8_000_000_000_000_000, whale.id);
    const bonk = PAIR_ASSETS.find(asset => asset.key === "bonk")!;
    await service.trade(whale, first.id, "buy", 8_000_000_000_000_000, 0, { quoteAssetKey: "bonk", quoteMint: bonk.mint });
    const portfolio = (await service.getPortfolio("qa-session"))!;
    const expected: Record<string, bigint> = {};
    for (const item of portfolio.holdings) {
      const stored = row(item.coin.id);
      const denominator = BigInt(Number(stored.v_tok));
      const atoms = (BigInt(item.amount) * BigInt(Number(stored.v_sol)) + denominator / 2n) / denominator;
      expect(item.valueQuote).toBe(atoms.toString());
      expected[item.coin.quoteAssetKey] = (expected[item.coin.quoteAssetKey] ?? 0n) + atoms;
    }
    expect(BigInt(portfolio.holdings.find(item => item.coin.id === first.id)!.valueQuote) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(portfolio.totals.holdingsValueByQuote).toEqual(Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, value.toString()])));
    expect(Object.keys(portfolio.totals.holdingsValueByQuote).sort()).toEqual(["bonk", "sol", "usdc"]);
    expect(portfolio.totals.holdingsValue).toBeNull();
    expect(portfolio.holdings.filter(item => item.coin.quoteAssetKey === "bonk").every(item => item.valueSol === null)).toBe(true);
  });

  test("exact fee migration preserves preexisting integer atoms without a JS-number round trip", () => {
    sqlite.close(); sqlite = new Database(":memory:");
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql") && name < "0010").sort()) {
      const sql = readFileSync(resolve(migrations, name), "utf8");
      if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql);
    }
    const prior = "9007199254740993";
    sqlite.query("INSERT INTO protocol_quote_fees (quote_asset_key, amount) VALUES ('bonk', ?)").run(prior);
    sqlite.query("INSERT INTO meta (key, value) VALUES ('protocol_fees', ?)").run(prior);
    sqlite.exec(readFileSync(resolve(migrations, "0010_carddex_exact_analytics.sql"), "utf8"));
    expect(sqlite.query("SELECT quote_asset_key, amount, typeof(amount) AS storage FROM protocol_quote_fees ORDER BY quote_asset_key").all()).toEqual([
      { quote_asset_key: "bonk", amount: prior, storage: "text" },
      { quote_asset_key: "sol", amount: prior, storage: "text" },
    ]);
  });

  test("migration preserves existing SOL curves even when their skin now defaults to another quote", async () => {
    sqlite.close(); sqlite = new Database(":memory:");
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql") && name < "0009").sort()) {
      const sql = readFileSync(resolve(migrations, name), "utf8");
      if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql);
    }
    await localD1.batch(seed.buildSeed() as Prepared[]);
    sqlite.exec(readFileSync(resolve(migrations, "0009_carddex_quote_assets.sql"), "utf8"));
    const coins = await service.allCoins();
    expect(coins).toHaveLength(10);
    expect(coins.some(coin => coin.cardTemplate === "doge")).toBe(true);
    expect(coins.every(coin => coin.quoteAssetKey === "sol")).toBe(true);
    expect(coins.every(coin => coin.quoteMint === PAIR_ASSETS[0].mint)).toBe(true);
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
