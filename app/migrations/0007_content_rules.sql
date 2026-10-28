-- Content rules (backlog P1-28): hidden coins and player reports. Additive.
--
-- A hidden coin leaves every public list, feed and the sitemap, and its page answers 404; its holders and
-- bidders still see it in their own portfolio, so tokens and escrowed bids on it stay reachable. The operator
-- hides a coin by hand after reading its reports:
--   UPDATE coins SET hidden = 1 WHERE id = '<coin id>';
--
-- DEPLOY ORDER: apply this migration to the remote D1 BEFORE (or together with) the app build that reads
-- coins.hidden. Code from before this migration ignores the column, so applying it first is always safe.

ALTER TABLE coins ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- One report per player per coin.
CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports (coin_id, user_id);
CREATE INDEX IF NOT EXISTS reports_coin_time ON reports (coin_id, created_at);
