-- Existing local SOL curves retain their exact meaning; a visual stock theme never rewrites their quote.
ALTER TABLE coins ADD COLUMN quote_asset_key TEXT NOT NULL DEFAULT 'sol';
ALTER TABLE coins ADD COLUMN quote_mint TEXT NOT NULL DEFAULT 'So11111111111111111111111111111111111111112';
ALTER TABLE coins ADD COLUMN peak_mcap_quote REAL NOT NULL DEFAULT 0;
UPDATE coins SET peak_mcap_quote = peak_mcap_usd / 150;

CREATE TRIGGER IF NOT EXISTS carddex_quote_immutable
BEFORE UPDATE OF quote_asset_key, quote_mint ON coins
WHEN NEW.quote_asset_key != OLD.quote_asset_key OR NEW.quote_mint != OLD.quote_mint
BEGIN SELECT RAISE(ABORT, 'CardDex quote asset is immutable'); END;

-- Native test SOL remains users.balance. Each non-native demo quote has its own atomic-unit ledger.
CREATE TABLE IF NOT EXISTS quote_balances (
  user_id TEXT NOT NULL,
  quote_asset_key TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (user_id, quote_asset_key)
);

CREATE TABLE IF NOT EXISTS protocol_quote_fees (
  quote_asset_key TEXT PRIMARY KEY,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0)
);
