-- The design ladder grows from 6 designs to 14. Stored levels used the old numbering:
--   old 1 Spark, 2 Surge, 3 Nova, 4 Apex ($150K), 5 Mythic ($400K), 6 Legend ($1M)
-- and the same designs are now
--   1 Spark, 2 Surge, 3 Nova, 5 Apex, 8 Mythic, 14 Legend
-- (Tide 4, Ember 6, Bloom 7, Aurora 9, Relic 10, Frost 11, Regal 12 and Celestial 13 are new).
--
-- Each column is remapped by one CASE on its old value inside a single UPDATE, so the steps never
-- chain (an old 4 becomes 5 and is not then read as an old 5). Events with level 0 (bids, sales,
-- listings) are untouched by the ELSE branch.
--
-- Runs once: the migration system applies each file once, and the 'tier_ladder' marker below also
-- makes a manual re-run a no-op instead of remapping a second time (5 -> 8, 8 -> 8 ...). The marker
-- row is written last, after the three remaps, all in this one migration.
--
-- The app runs the identical SQL behind the same marker before any read or write (ensureLadder in
-- src/lib/mintdex/server/seed.server.ts), so the order of deploy and migration does not matter: the
-- first to run remaps, the other is a no-op. Keep the two copies identical.
--
-- Coins whose market cap now qualifies for one of the new in-between designs (a $230K coin moves
-- from Apex to Ember) are raised by the app's peak self-heal on the next read, with a levelup event.

UPDATE coins
   SET level = CASE level WHEN 4 THEN 5 WHEN 5 THEN 8 WHEN 6 THEN 14 ELSE level END,
       peak_level = CASE peak_level WHEN 4 THEN 5 WHEN 5 THEN 8 WHEN 6 THEN 14 ELSE peak_level END
 WHERE (level IN (4, 5, 6) OR peak_level IN (4, 5, 6))
   AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tier_ladder');

UPDATE events
   SET level = CASE level WHEN 4 THEN 5 WHEN 5 THEN 8 WHEN 6 THEN 14 ELSE level END
 WHERE level IN (4, 5, 6)
   AND NOT EXISTS (SELECT 1 FROM meta WHERE key = 'tier_ladder');

INSERT OR IGNORE INTO meta (key, value) VALUES ('tier_ladder', '14');
