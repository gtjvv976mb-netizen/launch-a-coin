-- MINTDEX core schema. Additive only (CREATE ... IF NOT EXISTS).
-- Money is INTEGER lamports (1e9 per SOL); coin amounts are INTEGER base units
-- (1e6 per token); timestamps are epoch milliseconds.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_npc INTEGER NOT NULL DEFAULT 0,
  faucet_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS coins (
  id TEXT PRIMARY KEY,
  dex_no INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  lore TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  website TEXT,
  x_url TEXT,
  creator_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  v_sol INTEGER NOT NULL,
  v_tok INTEGER NOT NULL,
  volume INTEGER NOT NULL DEFAULT 0,
  owner_fees INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  peak_level INTEGER NOT NULL DEFAULT 1,
  list_price INTEGER,
  trades INTEGER NOT NULL DEFAULT 0,
  is_seed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_trade_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coins_ticker ON coins (ticker);
CREATE INDEX IF NOT EXISTS coins_owner ON coins (owner_id);

CREATE TABLE IF NOT EXISTS holdings (
  user_id TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (user_id, coin_id)
);
CREATE INDEX IF NOT EXISTS holdings_coin ON holdings (coin_id);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  side TEXT NOT NULL,
  sol INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  price REAL NOT NULL,
  mcap_usd REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_coin_time ON trades (coin_id, created_at);
CREATE INDEX IF NOT EXISTS trades_time ON trades (created_at);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  coin_id TEXT NOT NULL,
  bidder_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bids_one_open ON bids (coin_id, bidder_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS bids_coin_status ON bids (coin_id, status);
CREATE INDEX IF NOT EXISTS bids_bidder ON bids (bidder_id, status);

CREATE TABLE IF NOT EXISTS deed_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deed_sales_time ON deed_sales (created_at);
CREATE INDEX IF NOT EXISTS deed_sales_coin ON deed_sales (coin_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  user_id TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_time ON events (created_at);

-- Trade fees earned by each owner while they held a coin's deed card.
CREATE TABLE IF NOT EXISTS owner_earnings (
  user_id TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, coin_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Optimistic-concurrency guard: a batch inserts 1 when its preconditions
-- still hold; a 0 violates the CHECK and rolls the whole batch back.
CREATE TABLE IF NOT EXISTS tx_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
