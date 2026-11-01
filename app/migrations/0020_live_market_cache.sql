-- A launched coin's market data for its page (market.server.ts): the last answer per coin and kind, shared by every
-- colo, so the chain and GeckoTerminal are asked at most once per kind's freshness window site-wide.
-- kind: 'curve' (on-chain curve), 'pool' (GeckoTerminal stats), 'trades', 'holders', 'holder-count', 'ohlcv:<range>'.
CREATE TABLE live_market_cache (
  mint TEXT NOT NULL,
  kind TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (mint, kind)
);
