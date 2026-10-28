-- Coin links people type (backlog P0-10): /coin/{mint address} looks a coin up by its address. Additive and
-- safe to re-run. The data revision counter (meta key 'rev', backlog P0-12) needs no schema change: the first
-- write creates the row.
CREATE INDEX IF NOT EXISTS coins_mint_address ON coins (mint_address);
