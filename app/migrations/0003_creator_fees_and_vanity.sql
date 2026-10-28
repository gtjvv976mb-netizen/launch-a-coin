-- Creator fees now accrue in a per-card vault. The card owner spends them on
-- template upgrades or withdraws them. Coins also get a vanity mint address
-- (every MintDex address ends in "mint"), drawn from a pre-ground pool.

ALTER TABLE coins ADD COLUMN fee_vault INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coins ADD COLUMN mint_address TEXT;

CREATE TABLE IF NOT EXISTS vanity_pool (
  pubkey TEXT PRIMARY KEY,
  coin_id TEXT,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS vanity_pool_free ON vanity_pool (coin_id);
