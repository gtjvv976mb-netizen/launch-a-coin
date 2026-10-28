// Launch a Card's isolated demo world. Token history is simulated; every creator keeps
// one fixed-design card. No real mint addresses, NFT sales, bids or royalties.
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { CARD_DESIGNS } from "../../carddex/designs";
import { LAMPORTS } from "../constants";
import { INITIAL_RESERVES, mcapUsd, priceSol, quoteBuy, quoteSell, type Reserves } from "../curve";
import { runInBackground } from "./background.server";
import { bulkInsert, bumpRev, db, one, readBatch, q, stmt } from "./db.server";
import { trade } from "./service.server";

const NPCS = ["sol_degen", "jpeg_junkie", "rare_ape", "moon_banker", "bag_holder", "card_whale", "slime_collector", "gm_goblin", "holo_hunter", "foil_maxi"];
const SEED_COINS = [
  ["honk", "Honk", "HONK", "The war goose of the ramparts. Honks first, asks never."],
  ["noodl", "Noodl", "NOODL", "A ramen dragon born in a night market bowl."],
  ["comet", "Comet Corgi", "CORGI", "A very good boy riding a very fast rock."],
  ["glorb", "Glorb", "GLORB", "King of the swamp. Jiggles under pressure, never breaks."],
  ["zappo", "Zappo", "ZAPPO", "Too fast for the charts. Leaves sparks on every candle."],
  ["byte", "Frostbyte", "BYTE", "An owl carved from glacier ice. Cold storage, warm heart."],
  ["molten", "Moltenmole", "MOLE", "Digs through obsidian looking for the bottom."],
  ["spore", "Spore", "SPORE", "A frog witch spreading glowing spores."],
  ["skrimp", "Skrimp", "SKRIMP", "Cyber shrimp with pink plasma claws."],
  ["pebl", "Pebl", "PEBL", "A tiny rock golem guarding one shiny gem."],
] as const;
// The catalog keys intentionally demonstrate collectible layouts before material variations.
const DEMO_DESIGNS = ["pokemon-classic", "yugioh-monster", "magic-etched", "pokemon-full-art", "one-piece", "duel-masters", "doge", "ronin", "obsidian-archive", "yugioh-spell"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let seeded: Promise<void> | null = null;
export function ensureSeeded(): Promise<void> {
  if (!seeded) seeded = seedOnce().catch((error) => { seeded = null; throw error; });
  return seeded;
}
async function seedOnce() {
  if (await one("SELECT value FROM meta WHERE key = 'carddex_seeded'")) return;
  try { await db().batch(buildSeed()); }
  catch (error) { if (!(await one("SELECT value FROM meta WHERE key = 'carddex_seeded'"))) throw error; }
}

export function buildSeed(): D1PreparedStatement[] {
  const rand = rng(20261028);
  const now = Date.now();
  const users = NPCS.map((_, i) => `carddex_demo_${i}`);
  const balances = new Map(users.map((id) => [id, 2_500 * LAMPORTS]));
  const bags = new Map<string, number>();
  const coins: unknown[][] = [], trades: unknown[][] = [], events: unknown[][] = [];
  let protocol = 0;
  SEED_COINS.forEach(([id, name, ticker, lore], index) => {
    const creator = users[index];
    const design = CARD_DESIGNS.find((d) => d.key === DEMO_DESIGNS[index]) ?? CARD_DESIGNS[index % CARD_DESIGNS.length];
    const launchedAt = now - (80 - index * 6) * 3_600_000;
    let reserves: Reserves = { ...INITIAL_RESERVES };
    let volume = 0, peakMcap = mcapUsd(reserves), count = 0, lastAt = launchedAt;
    events.push(["launch", id, creator, 0, design.materialLevel, launchedAt]);
    for (let step = 0; step < 42; step++) {
      const user = users[Math.floor(rand() * users.length)];
      const key = `${user}|${id}`;
      const at = Math.round(launchedAt + (now - launchedAt - 120_000) * ((step + 1) / 42));
      const holding = bags.get(key) ?? 0;
      if (holding > 0 && rand() < 0.24) {
        const fill = quoteSell(reserves, Math.floor(holding * (0.08 + rand() * 0.12)));
        if (!fill.ok) continue;
        bags.set(key, holding - fill.tokensIn);
        balances.set(user, (balances.get(user) ?? 0) + fill.solOut);
        protocol += fill.fee; volume += fill.gross; reserves = fill.after;
        trades.push([id, user, "sell", fill.gross, fill.tokensIn, priceSol(reserves), mcapUsd(reserves), at]);
      } else {
        const fill = quoteBuy(reserves, Math.round((0.3 + rand() * (1 + (10 - index) * 0.35)) * LAMPORTS));
        if (!fill.ok) continue;
        bags.set(key, holding + fill.tokensOut);
        balances.set(user, (balances.get(user) ?? 0) - fill.solIn);
        protocol += fill.fee; volume += fill.solIn; reserves = fill.after;
        trades.push([id, user, "buy", fill.solIn, fill.tokensOut, priceSol(reserves), mcapUsd(reserves), at]);
        if (step > 37) events.push(["buy", id, user, fill.solIn, design.materialLevel, at]);
      }
      peakMcap = Math.max(peakMcap, mcapUsd(reserves)); count++; lastAt = at;
    }
    coins.push([id, index + 1, name, ticker, lore, `/assets/creatures/${id}.webp`, null, null, creator, creator, reserves.vSol, reserves.vTok, volume, 0, design.materialLevel, design.materialLevel, null, count, 1, launchedAt, lastAt, 0, null, design.key, peakMcap]);
  });
  return [
    stmt("INSERT INTO meta (key, value) VALUES ('carddex_seeded', ?)", String(now)), bumpRev(),
    stmt("INSERT OR IGNORE INTO meta (key, value) VALUES ('ambient_at', ?)", String(now)),
    stmt("INSERT OR IGNORE INTO meta (key, value) VALUES ('protocol_fees', ?)", String(protocol)),
    ...bulkInsert("users", ["id", "handle", "balance", "is_npc", "faucet_at", "created_at"], users.map((id, i) => [id, NPCS[i], balances.get(id), 1, 0, now - 90 * 3_600_000])),
    ...bulkInsert("coins", ["id", "dex_no", "name", "ticker", "lore", "image", "website", "x_url", "creator_id", "owner_id", "v_sol", "v_tok", "volume", "owner_fees", "level", "peak_level", "list_price", "trades", "is_seed", "created_at", "last_trade_at", "fee_vault", "mint_address", "card_template", "peak_mcap_usd"], coins),
    ...bulkInsert("holdings", ["user_id", "coin_id", "amount"], [...bags].filter(([, value]) => value > 0).map(([key, value]) => [...key.split("|"), value])),
    ...bulkInsert("trades", ["coin_id", "user_id", "side", "sol", "tokens", "price", "mcap_usd", "created_at"], trades),
    ...bulkInsert("events", ["kind", "coin_id", "user_id", "amount", "level", "created_at"], events),
  ];
}

const AMBIENT_EVERY_MS = 75_000;
let nextAmbientCheck = 0;
export function kickAmbient() {
  const now = Date.now();
  if (now < nextAmbientCheck) return;
  nextAmbientCheck = now + AMBIENT_EVERY_MS;
  runInBackground("Launch a Card demo token tick", maybeAmbient);
}
export async function maybeAmbient() {
  const row = await one<{ value: string }>("SELECT value FROM meta WHERE key = 'ambient_at'");
  if (!row) return;
  const now = Date.now(), last = Number(row.value);
  if (now - last < AMBIENT_EVERY_MS) { nextAmbientCheck = last + AMBIENT_EVERY_MS; return; }
  const claim = await stmt("UPDATE meta SET value = ? WHERE key = 'ambient_at' AND value = ?", String(now), row.value).run();
  if (!claim.meta.changes) return;
  const [coins, users] = await readBatch(q<{ id: string }>("SELECT id FROM coins WHERE is_seed = 1"), q<{ id: string; balance: number }>("SELECT id, balance FROM users WHERE is_npc = 1"));
  if (!coins.length || !users.length) return;
  const rand = rng(now % 2147483647);
  const coin = coins[Math.floor(rand() * coins.length)], user = users[Math.floor(rand() * users.length)];
  try {
    const holding = await one<{ amount: number }>("SELECT amount FROM holdings WHERE user_id = ? AND coin_id = ?", user.id, coin.id);
    if (holding && holding.amount > 0 && rand() < 0.3) await trade(user, coin.id, "sell", Math.floor(holding.amount * 0.02));
    else if (user.balance > LAMPORTS) await trade(user, coin.id, "buy", Math.round((0.15 + rand() * 0.8) * LAMPORTS));
  } catch { /* Simulated activity is best-effort and cannot mutate card identity. */ }
}
