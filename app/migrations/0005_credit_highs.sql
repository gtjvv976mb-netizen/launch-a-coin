-- Credit old highs on the 14-design ladder. A card keeps the best design its market cap has reached,
-- but 0004 only renumbered stored levels, and the app's peak self-heal only looks at the current
-- market cap. So a coin that once passed $300K and now sits at $160K would stay Apex, while a coin
-- still at $210K gets Ember. This raises every card to the design its highest recorded market cap
-- (MAX(trades.mcap_usd), the trades table is never pruned) unlocks on the new ladder, with one levelup
-- event per raised card. It only ever raises peak_level, never lowers it.
--
-- Runs once, after the renumbering: every statement needs the 'tier_ladder' marker from 0004 (so the
-- peaks it compares are new-numbered) and no 'tier_highs' marker; the marker is written last.
-- The app runs the identical SQL behind the same markers before any read or write (ensureHighs in
-- src/lib/mintdex/server/seed.server.ts, which builds the CASE from TIERS in tiers.ts), so deploy and
-- migration order do not matter. Keep the two copies identical.

-- The events first, while each card still shows its lower peak.
INSERT INTO events (kind, coin_id, user_id, amount, level, created_at)
SELECT 'levelup', c.id, NULL, CAST(ROUND(h.hi) AS INTEGER), h.lvl, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM (SELECT coin_id, hi,
               CASE WHEN hi >= 1000000 THEN 14 WHEN hi >= 900000 THEN 13 WHEN hi >= 800000 THEN 12 WHEN hi >= 700000 THEN 11 WHEN hi >= 600000 THEN 10 WHEN hi >= 500000 THEN 9 WHEN hi >= 400000 THEN 8 WHEN hi >= 300000 THEN 7 WHEN hi >= 200000 THEN 6 WHEN hi >= 150000 THEN 5 WHEN hi >= 100000 THEN 4 WHEN hi >= 50000 THEN 3 WHEN hi >= 15000 THEN 2 ELSE 1 END AS lvl
          FROM (SELECT coin_id, MAX(mcap_usd) AS hi FROM trades GROUP BY coin_id)) AS h
  JOIN coins c ON c.id = h.coin_id
 WHERE h.lvl > c.peak_level
   AND EXISTS (SELECT 1 FROM meta WHERE key = 'tier_ladder')
   AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tier_highs');

UPDATE coins
   SET peak_level = h.lvl
  FROM (SELECT coin_id, hi,
               CASE WHEN hi >= 1000000 THEN 14 WHEN hi >= 900000 THEN 13 WHEN hi >= 800000 THEN 12 WHEN hi >= 700000 THEN 11 WHEN hi >= 600000 THEN 10 WHEN hi >= 500000 THEN 9 WHEN hi >= 400000 THEN 8 WHEN hi >= 300000 THEN 7 WHEN hi >= 200000 THEN 6 WHEN hi >= 150000 THEN 5 WHEN hi >= 100000 THEN 4 WHEN hi >= 50000 THEN 3 WHEN hi >= 15000 THEN 2 ELSE 1 END AS lvl
          FROM (SELECT coin_id, MAX(mcap_usd) AS hi FROM trades GROUP BY coin_id)) AS h
 WHERE h.coin_id = coins.id
   AND h.lvl > coins.peak_level
   AND EXISTS (SELECT 1 FROM meta WHERE key = 'tier_ladder')
   AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tier_highs');

INSERT OR IGNORE INTO meta (key, value)
SELECT 'tier_highs', '1' WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'tier_ladder');
