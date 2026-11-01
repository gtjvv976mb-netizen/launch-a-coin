-- Getting a token pair's quote with SOL before an initial buy (integrations/pumpfun/src/swap.ts, service.server.ts):
-- one row per swap the server checked and prepared for a creator's wallet, then the bytes the wallet signed and their
-- outcome. The plan holds what the creator reviewed: the most SOL it takes and the token balance it leaves.
CREATE TABLE live_quote_swaps (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  quote_key TEXT NOT NULL,
  need TEXT NOT NULL,
  message_sha256 TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','pending','confirmed','failed','expired')),
  signature TEXT UNIQUE,
  signed_transaction_base64 TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX live_quote_swaps_wallet ON live_quote_swaps(wallet, created_at);
