-- Analytics can outgrow both JavaScript's safe integer range and SQLite SUM's signed 64-bit range.
-- Keep each fee total as canonical decimal text; application BigInt arithmetic updates it atomically.
ALTER TABLE protocol_quote_fees RENAME TO carddex_legacy_protocol_quote_fees;
CREATE TABLE protocol_quote_fees (
  quote_asset_key TEXT PRIMARY KEY,
  amount TEXT NOT NULL DEFAULT '0'
    CHECK (length(amount) > 0 AND amount NOT GLOB '*[^0-9]*'
      AND (amount = '0' OR substr(amount, 1, 1) != '0'))
);
INSERT INTO protocol_quote_fees (quote_asset_key, amount)
  SELECT quote_asset_key, CAST(amount AS TEXT) FROM carddex_legacy_protocol_quote_fees;
INSERT OR IGNORE INTO protocol_quote_fees (quote_asset_key, amount)
  SELECT 'sol', value FROM meta WHERE key = 'protocol_fees';
DROP TABLE carddex_legacy_protocol_quote_fees;

-- coins.volume is a deprecated historical cache. Authoritative lifetime and 24h volume are now
-- derived from individual trade rows using BigInt, never SQL SUM or this accumulating INTEGER.
