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
const { OFFERED_PAIRS, PAIR_ASSETS, TRADED_PAIRS, defaultQuoteForDesign, designForPair, getPairAsset, getTradingPair, pairForDesign, NOT_OFFERED_PAIR, UNPAIRED_DESIGN } = await import("../../src/lib/carddex/pairs");
const { demoQuoteStartBalance, initialQuoteReserves, maxInitialBuyQuoteAtoms, quoteUnit } = await import("../../src/lib/carddex/quote-simulation");
const migrations = resolve(import.meta.dir, "../../migrations");

const user = { id: "creator", handle: "creator", balance: 2000 * 1e9, faucet_at: 0, created_at: Date.now() };
// A design-only request (the shape older clients send): the design's own pair comes with it. SOL's design by default.
const launch = (cardTemplate: string = designForPair("sol")!, devBuy = 0, ticker = "OWN") => service.launchCoin(user, { name: "Independent Token", ticker, image: "/api/img/art/qa-token.png", lore: "Creator artwork stays its own.", devBuy, cardTemplate });
const row = (id: string) => sqlite.query("SELECT * FROM coins WHERE id = ?").get(id) as Record<string, unknown>;
/** A coin stored before the pair picked the card (any design, the quote it was made with), as its row was written. */
const storedCoin = (id: string, cardTemplate: string, quoteKey: string, ticker: string) => {
  const asset = getPairAsset(quoteKey), design = getCardDesign(cardTemplate), initial = initialQuoteReserves(quoteKey), now = Date.now();
  sqlite.query(`INSERT INTO coins (id, dex_no, name, ticker, image, creator_id, owner_id, v_sol, v_tok, level, peak_level, card_template, quote_asset_key, quote_mint, created_at, last_trade_at)
    VALUES (?, (SELECT COALESCE(MAX(dex_no), 0) + 1 FROM coins), 'Historical Token', ?, '/api/img/art/qa-token.png', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ticker, user.id, user.id, initial.vSol, initial.vTok, design.materialLevel, design.materialLevel, cardTemplate, asset.key, asset.mint, now, now);
  return { id };
};
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
  test("every design persists through launch SQL (or its stored row) and reads", async () => {
    for (const [index, design] of CARD_DESIGNS.entries()) {
      // A launchable design launches from a design-only request and takes its own pair; the designs no pair has are
      // no longer launched, so they are read from rows stored before the pair picked the card.
      const pair = pairForDesign(design.key);
      const result = pair ? await launch(design.key, 0, `D${String(index).padStart(2, "0")}`) : storedCoin(`legacy-${design.key}`, design.key, defaultQuoteForDesign(design.key).key, `D${String(index).padStart(2, "0")}`);
      const stored = row(result.id);
      expect(stored.card_template).toBe(design.key);
      expect(stored.level).toBe(design.materialLevel);
      expect(stored.owner_id).toBe(user.id);
      expect(stored.creator_id).toBe(user.id);
      expect(stored.mint_address).toBeNull();
      const page = await service.getCoinPage(result.id, "qa-session");
      const asset = pair ?? defaultQuoteForDesign(design.key);
      expect(stored.quote_asset_key).toBe(asset.key);
      expect(page?.coin.cardTemplate).toBe(design.key);
      expect(page?.coin.level).toBe(design.materialLevel);
      expect(page?.coin.stockTicker).toBe(asset.kind === "stock" ? asset.referenceTicker : null);
      expect(page?.coin.tokenPair).toBe(asset.kind === "stock" ? getTradingPair(`D${String(index).padStart(2, "0")}`, asset.key) : null);
      expect(page?.bids).toEqual([]);
      expect(page?.sales).toEqual([]);
    }
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({ n: CARD_DESIGNS.length });
    // Home features one coin per design, at most 48 (the designs whose best coins lead by market cap), in design order.
    const featured = (await service.getHome()).featured;
    expect(featured).toHaveLength(48);
    expect(new Set(featured.map(coin => coin.cardTemplate)).size).toBe(48);
    const order = CARD_DESIGNS.map(design => design.key);
    expect(featured.map(coin => order.indexOf(coin.cardTemplate))).toEqual(featured.map(coin => order.indexOf(coin.cardTemplate)).sort((a, b) => a - b));
    expect((await service.getLevels()).counts).toEqual(CARD_DESIGNS.map(() => 1));
  });

  test("stock references are catalog-derived, survive token trades, and reject spoofed associations", async () => {
    const stockDesigns = CARD_DESIGNS.filter((design) => design.stock);
    expect(stockDesigns.filter(design=>!design.key.startsWith("pair-")).map(design => design.key).sort()).toEqual(["stock-gme", "stock-tsla", "stock-nvda", "stock-aapl", "stock-mstr", "stock-coin", "gamestop", "amc", "coinbase", "strategy"].sort());
    for (const [index, design] of stockDesigns.entries()) {
      const asset = defaultQuoteForDesign(design.key);
      const amount = Math.floor(initialQuoteReserves(asset.key).vSol / 30);
      const identity = { quoteAssetKey: asset.key, quoteMint: asset.mint };
      // GameStop, Coinbase and Strategy have no pair of their own now: their coins are rows stored before that.
      const { id } = pairForDesign(design.key) ? await launch(design.key, amount, `S${String(index).padStart(2, "0")}`) : storedCoin(`legacy-${design.key}`, design.key, asset.key, `S${String(index).padStart(2, "0")}`);
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
    // A stock design new coins can launch with (the stock pairs keep their live designs while their identities are held).
    const stock = stockDesigns.find((design) => pairForDesign(design.key))!;
    expect(stock.key).toBe("stock-gme");
    const base = { name: "Stock Reference", ticker: "SPOOF", image: "/api/img/art/qa-token.png", lore: "Reference artwork only.", devBuy: 0, cardTemplate: stock.key };
    const before = (sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance;
    await expect(service.launchCoin(user, { ...base, stockTicker: "FAKE" })).rejects.toThrow("stock reference must match");
    await expect(service.launchCoin(user, { ...base, tokenPair: "FAKE / SOL" })).rejects.toThrow("reference pair must match");
    const ordinary = CARD_DESIGNS.find((design) => !design.stock && pairForDesign(design.key))!;
    await expect(service.launchCoin(user, { ...base, cardTemplate: ordinary.key, stockTicker: stock.stock!.ticker })).rejects.toThrow("stock reference must match");
    expect((sqlite.query("SELECT balance FROM users WHERE id = ?").get(user.id) as { balance: number }).balance).toBe(before);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins WHERE ticker = 'SPOOF'").get()).toEqual({ n: 0 });
    const stockQuote = defaultQuoteForDesign(stock.key);
    await expect(service.launchCoin(user, { ...base, tokenPair: `${stockQuote.referenceTicker} / SOL` })).rejects.toThrow("reference pair must match");
    const accepted = await service.launchCoin(user, { ...base, stockTicker: stockQuote.referenceTicker, tokenPair: getTradingPair(base.ticker, stockQuote.key) });
    expect((await service.getCoinPage(accepted.id, null))?.coin.tokenPair).toBe(getTradingPair(base.ticker, stockQuote.key));
  });

  test("a stock pair alone takes its own design and derives its stock references from the quote", async () => {
    const asset = getPairAsset("tslax");
    const input = { name: "Neutral Stock Quote", ticker: "NEUTRAL", image: "/api/img/art/qa-token.png", lore: "The actual quote defines this association.", devBuy: 0, quoteAssetKey: asset.key, quoteMint: asset.mint, stockTicker: "TSLA", tokenPair: "NEUTRAL / TSLAX" };
    // The pair picks the card: another design with this pair is refused before anything is written.
    const before = writeCalls;
    await expect(service.launchCoin(user, {...input, cardTemplate: "pair-doge"})).rejects.toThrow("comes with its own card");
    // TSLAX's identity design is held (content holds): a new launch never gets it.
    await expect(service.launchCoin(user, {...input, cardTemplate: "pair-tslax"})).rejects.toThrow(UNPAIRED_DESIGN);
    expect(writeCalls).toBe(before);
    const {id} = await service.launchCoin(user, input);
    const page = (await service.getCoinPage(id, "qa-session"))!;
    expect(row(id).quote_mint).toBe(asset.mint);
    expect(row(id).card_template).toBe("stock-tsla");
    expect(page.coin).toMatchObject({cardTemplate: "stock-tsla", stockTicker: "TSLA", tokenPair: "NEUTRAL / TSLAX", tradingPair: "NEUTRAL / TSLAX"});
    expect((await service.getPortfolio("qa-session"))?.deeds.find(item => item.coin.id === id)?.coin.stockTicker).toBe("TSLA");
    await expect(service.launchCoin(user, {...input, ticker: "WRONG", stockTicker: "GME", tokenPair: "WRONG / TSLAX"})).rejects.toThrow("stock reference must match");
    await expect(service.launchCoin(user, {...input, ticker: "OLDPAIR", tokenPair: "TSLA / SOL"})).rejects.toThrow("reference pair must match");
  });

  test("Home's all-time volume stays known until a coin with no SOL reference trades (VIS-4)", async () => {
    await service.getMe(user);
    const sol = getPairAsset("sol"), doge = getPairAsset("doge");
    const traded = await service.launchCoin(user, { name: "Sol Pair Token", ticker: "SOLP", image: "/api/img/art/qa-token.png", lore: "", devBuy: LAMPORTS / 10, quoteAssetKey: sol.key, quoteMint: sol.mint });
    const before = (await service.getHome()).stats.volume;
    expect(before).toBeGreaterThan(0);
    // A DOGE-pair coin with no trades adds nothing and hides nothing.
    const untraded = await service.launchCoin(user, { name: "Doge Pair Token", ticker: "DOGEP", image: "/api/img/art/qa-token.png", lore: "", devBuy: 0, quoteAssetKey: doge.key, quoteMint: doge.mint });
    expect((await service.getHome()).stats.volume).toBe(before);
    // Once it trades, its volume has no SOL figure, so the total is unknown rather than understated.
    await service.trade(user, untraded.id, "buy", Math.floor(initialQuoteReserves(doge.key).vSol / 30), 0, { quoteAssetKey: doge.key, quoteMint: doge.mint });
    expect((await service.getHome()).stats.volume).toBeNull();
    expect(traded.id).toBeTruthy();
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

  test("a SOL launch keeps the design option it was made with through launch, edit, buy, sell and reads", async () => {
    await service.getMe(user);
    const sol = getPairAsset("sol"), identity = { quoteAssetKey: "sol", quoteMint: sol.mint };
    for (const [index, design] of (["ronin", "one-piece", "kraken"] as const).entries()) {
      const { id } = await service.launchCoin(user, { name: "Option Coin", ticker: `OPT${index}`, image: "/api/img/art/qa-token.png", lore: "SOL design option.", devBuy: 0, cardTemplate: design, ...identity });
      await service.updateLore(user, id, "Edited.");
      const initial = initialQuoteReserves("sol"), amount = Math.floor(initial.vSol / 40);
      const bought = await service.trade(user, id, "buy", amount, 1, identity);
      await service.trade(user, id, "sell", Math.floor(bought.tokens / 2), 1, identity);
      expect(row(id).card_template).toBe(design);
      expect(row(id).quote_asset_key).toBe("sol");
      expect((await service.getCoinPage(id, "qa-session"))!.coin.cardTemplate).toBe(design);
    }
  });

  for (const asset of OFFERED_PAIRS) test(`${asset.symbol} quote atoms stay separate through launch, edit, buy, sell and portfolio`, async () => {
    await service.getMe(user);
    const initial = initialQuoteReserves(asset.key);
    const amount = Math.floor(initial.vSol / 30);
    const identity = { quoteAssetKey: asset.key, quoteMint: asset.mint };
    // The pair alone (the shape the Launch form sends): its own design comes with it.
    const input = { name: "Quote Native Token", ticker: "QNT", image: "/api/img/art/qa-token.png", lore: "Own token, real quote identity, simulated accounting.", devBuy: amount, ...identity };
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
    expect(stored.card_template).toBe(designForPair(asset.key));
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
    for (const other of OFFERED_PAIRS.filter(other => other.key !== "sol" && other.key !== asset.key)) {
      expect(sqlite.query("SELECT balance FROM quote_balances WHERE user_id = ? AND quote_asset_key = ?").get(user.id, other.key)).toEqual({ balance: demoQuoteStartBalance(other.key) });
    }
    // Pairs not offered yet (AAVE, UNI) get no test funds.
    expect(sqlite.query("SELECT COUNT(*) AS n FROM quote_balances WHERE user_id = ? AND quote_asset_key IN ('aave', 'uni')").get(user.id)).toEqual({ n: 0 });
    const portfolio = (await service.getPortfolio("qa-session"))!;
    expect(portfolio.holdings[0].coin.quoteAssetKey).toBe(asset.key);
    expect(portfolio.totals.holdingsValueByQuote[asset.key]).toBe(portfolio.holdings[0].valueQuote);
    if (asset.kind === "stock" || asset.kind === "meme" || asset.kind === "collector" || asset.kind === "crypto") {
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

  test("each meme and collector pair launches its own design and keeps the creator's token and quote through trades and collection reads", async () => {
    await service.getMe(user);
    for (const [index, asset] of OFFERED_PAIRS.filter(asset => asset.kind === "meme" || asset.kind === "collector").entries()) {
      const preset = {design: designForPair(asset.key)!, quote: asset.key}, amount = Math.floor(initialQuoteReserves(asset.key).vSol / 30);
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

  // Rows stored before the pair picked the card: every earlier chooser preset (most of which a new launch now refuses;
  // the content holds made six of them current again), neutral designs on SOL or a stock, and designs no pair has.
  // Reads and trades keep them exactly.
  for (const [cardTemplate, quoteKey] of [["pokemon-classic", "sol"], ["pokemon-full-art", "tslax"], ["pepe", "sol"], ["pepe", "gmex"], ["spark", "tslax"], ["gamestop", "gmex"], ["shib", "sol"], ...MEME_PAIR_PRESETS.map(preset => [preset.design, preset.quote]), ...["ember", "relic", "tide", "neon-circuit", "frost", "mythic", "celestial", "regal", "wildtype", "aurora"].map(design => [design, "sol"])]) test(`existing ${cardTemplate}/${quoteKey} row keeps its stored quote through reads and trading`, async () => {
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

  // Content holds: a coin stored on a held identity keeps its design, renders and trades. TSLAX (offered with its live
  // design) is funded for everyone; AGENCY, 67 and SOLANGELES are not offered, so only an account that already holds the
  // quote (one funded while a preview offered the pair) can buy; anyone holding the coin can sell. WBTC and ETH coins
  // are the ones this release makes on new pairs: where a build does not fund them (the release step), an account the
  // full release funded keeps buying and selling.
  for (const [cardTemplate, quoteKey] of [["pair-tslax", "tslax"], ["pair-ansem", "ansem"], ["pair-agency", "agency"], ["pair-67", "67"], ["pair-solangeles", "solangeles"], ["pair-fartcoin", "fartcoin"], ["pair-wbtc", "wbtc"], ["pair-eth", "eth"]] as const) test(`a coin stored on ${cardTemplate} keeps its design and trades in ${quoteKey}`, async () => {
    await service.getMe(user);
    const fund = !TRADED_PAIRS.some(asset => asset.key === quoteKey);
    const asset = getPairAsset(quoteKey), design = getCardDesign(cardTemplate), initial = initialQuoteReserves(quoteKey), now = Date.now();
    expect(design.key).toBe(cardTemplate);
    if (fund) sqlite.query("INSERT OR REPLACE INTO quote_balances (user_id, quote_asset_key, balance) VALUES (?, ?, ?)").run(user.id, asset.key, initial.vSol);
    sqlite.query(`INSERT INTO coins (id, dex_no, name, ticker, image, creator_id, owner_id, v_sol, v_tok, level, peak_level, card_template, quote_asset_key, quote_mint, created_at, last_trade_at)
      VALUES ('held-identity', 1, 'Held Identity Token', 'HELD', '/api/img/art/qa-token.png', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.id, initial.vSol, initial.vTok, design.materialLevel, design.materialLevel, cardTemplate, asset.key, asset.mint, now, now);
    const identity = {quoteAssetKey: asset.key, quoteMint: asset.mint}, amount = Math.floor(initial.vSol / 30);
    const bought = await service.trade(user, "held-identity", "buy", amount, 0, identity);
    await service.trade(user, "held-identity", "sell", Math.floor(bought.tokens / 2), 0, identity);
    const page = (await service.getCoinPage("held-identity", "qa-session"))!;
    expect(page.coin).toMatchObject({cardTemplate, ...identity, tradingPair: `HELD / ${asset.symbol}`});
    expect(row("held-identity")).toMatchObject({card_template: cardTemplate, quote_asset_key: asset.key, quote_mint: asset.mint});
    expect((await service.getPortfolio("qa-session"))!.deeds.find(item => item.coin.id === "held-identity")?.coin).toMatchObject({cardTemplate, ...identity});
  });

  test("quote spoofing, incompatible designs, unsafe amounts and raw quote updates are rejected", async () => {
    const base = { name: "Quote Guard", ticker: "GUARD", image: "/api/img/art/qa-token.png", lore: "Immutable quote identity.", devBuy: 0 };
    const before = writeCalls;
    await expect(service.launchCoin(user, { ...base, quoteAssetKey: "unsupported" })).rejects.toThrow("supported pump.fun quote");
    await expect(service.launchCoin(user, { ...base, quoteAssetKey: "usdc", quoteMint: PAIR_ASSETS[0].mint })).rejects.toThrow("quote mint");
    // The pair picks the card: a design that is not the pair's own, or has no pair, is refused in plain words.
    await expect(service.launchCoin(user, { ...base, cardTemplate: "pair-doge", quoteAssetKey: "sol" })).rejects.toThrow("That card belongs to the DOGE pair. Pick DOGE for it, or one of SOL's designs.");
    await expect(service.launchCoin(user, { ...base, cardTemplate: "doge", quoteAssetKey: "sol" })).rejects.toThrow(UNPAIRED_DESIGN);
    // SOL's design options go with SOL only.
    await expect(service.launchCoin(user, { ...base, cardTemplate: "spark", quoteAssetKey: "doge" })).rejects.toThrow("for the SOL pair only");
    await expect(service.launchCoin(user, { ...base, cardTemplate: "pokemon-full-art", quoteAssetKey: "sv151" })).rejects.toThrow("for the SOL pair only");
    await expect(service.launchCoin(user, { ...base, cardTemplate: "pokemon-classic", quoteAssetKey: "cards" })).rejects.toThrow("The CARDS pair comes with its own card");
    await expect(service.launchCoin(user, { ...base, cardTemplate: "pair-sv151", quoteAssetKey: "sv151" })).rejects.toThrow(UNPAIRED_DESIGN);
    await expect(service.launchCoin(user, { ...base, cardTemplate: "pair-sol", quoteAssetKey: "usdc" })).rejects.toThrow("for the SOL pair only");
    await expect(service.launchCoin(user, { ...base, cardTemplate: "pair-usdc", quoteAssetKey: "usdc" })).rejects.toThrow(UNPAIRED_DESIGN);
    // A pair with no finished card is not offered (AAVE, UNI), whatever design the request names.
    for (const key of ["aave", "uni"]) {
      await expect(service.launchCoin(user, { ...base, quoteAssetKey: key })).rejects.toThrow(NOT_OFFERED_PAIR);
      await expect(service.launchCoin(user, { ...base, quoteAssetKey: key, quoteMint: getPairAsset(key).mint, cardTemplate: "one-piece" })).rejects.toThrow(NOT_OFFERED_PAIR);
    }
    await expect(service.launchCoin(user, { ...base, cardTemplate: "gamestop" })).rejects.toThrow(UNPAIRED_DESIGN);
    await expect(service.launchCoin(user, { ...base, cardTemplate: "gamestop", quoteAssetKey: "gmex" })).rejects.toThrow(UNPAIRED_DESIGN);
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
    const { id } = await service.launchCoin(user, { name: "Busy BONK", ticker: "BUSY", image: "/api/img/art/qa-token.png", lore: "Exact quote analytics.", cardTemplate: "pair-bonk", devBuy: 0, ...identity });
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
    const { id } = await launch();
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
    const { id } = await service.launchCoin(user, { name: "Fee Precision", ticker: "FEE", image: "/api/img/art/qa-token.png", lore: "Exact accumulated fees.", cardTemplate: "pair-bonk", devBuy: 0, ...identity });
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
    await launch(designForPair("sol")!, devBuy, "SOLFEE");
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
      return service.launchCoin(user, { name: "Portfolio Precision", ticker, image: "/api/img/art/qa-token.png", lore: "Separate quote values.", devBuy: amount, quoteAssetKey: key, quoteMint: asset.mint });
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
    // SOL curves as the seed wrote them before 0009 (no quote columns yet), in skins that now belong to other pairs.
    // The seed itself now writes each coin's own pair, so it no longer fits this schema.
    const legacy = ["pokemon-classic", "yugioh-monster", "magic-etched", "pokemon-full-art", "one-piece", "duel-masters", "doge", "ronin", "obsidian-archive", "yugioh-spell"];
    sqlite.query("INSERT INTO users (id, handle, balance, is_npc, faucet_at, created_at) VALUES ('legacy_npc', 'legacy_npc', 0, 1, 0, 0)").run();
    for (const [index, key] of legacy.entries()) {
      const level = getCardDesign(key).materialLevel;
      sqlite.query(`INSERT INTO coins (id, dex_no, name, ticker, lore, image, website, x_url, creator_id, owner_id, v_sol, v_tok, volume, owner_fees, level, peak_level, list_price, trades, is_seed, created_at, last_trade_at, fee_vault, mint_address, card_template, peak_mcap_usd)
        VALUES (?, ?, 'Legacy', ?, '', '/assets/creatures/honk.webp', NULL, NULL, 'legacy_npc', 'legacy_npc', ?, ?, 0, 0, ?, ?, NULL, 0, 1, 0, 0, 0, NULL, ?, 0)`)
        .run(`legacy${index}`, index + 1, `LEG${index}`, INITIAL_RESERVES.vSol, INITIAL_RESERVES.vTok, level, level, key);
    }
    sqlite.exec(readFileSync(resolve(migrations, "0009_carddex_quote_assets.sql"), "utf8"));
    const coins = await service.allCoins();
    expect(coins).toHaveLength(10);
    expect(coins.some(coin => coin.cardTemplate === "doge")).toBe(true);
    expect(coins.every(coin => coin.quoteAssetKey === "sol")).toBe(true);
    expect(coins.every(coin => coin.quoteMint === PAIR_ASSETS[0].mint)).toBe(true);
  });

  test("dev buy, token buy and token sell conserve quoted funds and never evolve or accrue royalties", async () => {
    // SOL's own design, so the initial buy and trades are in native (test) SOL.
    const template = getCardDesign(designForPair("sol")!);
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
    // A fresh database seeds each coin on its pair with that pair's main design (identity designs; USDC keeps its own).
    expect(coins.map(coin => `${coin.quoteAssetKey}:${coin.cardTemplate}`).sort()).toEqual(["act:pair-act", "cards:pair-cards", "cate:pair-cate", "doge:pair-doge", "fartcoin:ember", "sol:pair-sol", "sv151:pokemon-classic", "toad:pair-toad", "usdc:duel-masters", "vine:magic-etched"]);
    for (const coin of coins) {
      expect(coin.cardTemplate).toBeTruthy();
      // The pair picks the card: every seed coin trades against its design's own pair.
      expect(pairForDesign(coin.cardTemplate)?.key).toBe(coin.quoteAssetKey);
      expect(coin.quoteMint).toBe(getPairAsset(coin.quoteAssetKey).mint);
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

  test("seed coins trade in their own pair's units, and the demo bots can keep trading them", async () => {
    await localD1.batch(seed.buildSeed() as unknown as Prepared[]);
    const coins = await service.allCoins();
    // Several pairs, SOL among them; each pair's ledger and fee total stays whole and never negative.
    expect(new Set(coins.map(coin => coin.quoteAssetKey)).size).toBe(10);
    expect(coins.some(coin => coin.quoteAssetKey === "sol")).toBe(true);
    const ledgers = sqlite.query("SELECT quote_asset_key, balance FROM quote_balances").all() as { quote_asset_key: string; balance: number }[];
    expect(ledgers.length).toBeGreaterThan(0);
    for (const ledger of ledgers) {
      expect(ledger.quote_asset_key).not.toBe("sol");
      expect(Number.isSafeInteger(ledger.balance) && ledger.balance >= 0).toBe(true);
    }
    const fees = sqlite.query("SELECT quote_asset_key FROM protocol_quote_fees ORDER BY quote_asset_key").all() as { quote_asset_key: string }[];
    expect(fees.map(fee => fee.quote_asset_key)).toEqual([...new Set(coins.map(coin => coin.quoteAssetKey))].sort());
    // The ambient bot's call (seed.server.ts maybeAmbient): its own pair named, a buy sized in that pair's atoms.
    const npc = { id: "carddex_demo_0" };
    for (const coin of coins) {
      const before = row(coin.id);
      const fill = await service.trade(npc, coin.id, "buy", seed.seedQuoteAtoms(coin.quoteAssetKey, LAMPORTS / 2), 0, { quoteAssetKey: coin.quoteAssetKey, quoteMint: coin.quoteMint });
      expect(fill.quoteAssetKey).toBe(coin.quoteAssetKey);
      expect(fill.tokens).toBeGreaterThan(0);
      const after = row(coin.id);
      expect(after.card_template).toBe(before.card_template);
      expect(after.quote_asset_key).toBe(coin.quoteAssetKey);
    }
    // SOL is unchanged by the scaling; another pair moves the same share of its own starting reserve.
    expect(seed.seedQuoteAtoms("sol", LAMPORTS)).toBe(LAMPORTS);
    expect(seed.seedQuoteAtoms("doge", INITIAL_RESERVES.vSol)).toBe(initialQuoteReserves("doge").vSol);
  });
});
