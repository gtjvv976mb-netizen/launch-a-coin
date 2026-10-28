-- Real wallet-authorized receipts and public assets never share simulated users, coins or balances.
CREATE TABLE live_wallet_challenges (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, origin TEXT NOT NULL, message TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX live_wallet_challenge_rate ON live_wallet_challenges(wallet, created_at);
CREATE TABLE live_wallet_sessions (
  token_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE live_assets (
  sha256 TEXT PRIMARY KEY, storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL, width INTEGER, height INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE live_asset_grants (
  wallet TEXT NOT NULL, sha256 TEXT NOT NULL REFERENCES live_assets(sha256),
  PRIMARY KEY(wallet, sha256)
);
CREATE TABLE live_compositions (
  wallet TEXT NOT NULL, binding_sha256 TEXT NOT NULL,
  artwork_sha256 TEXT NOT NULL, card_sha256 TEXT NOT NULL, case_sha256 TEXT NOT NULL,
  renderer_version TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(wallet, binding_sha256, artwork_sha256, card_sha256, case_sha256)
);
CREATE TABLE live_launch_intents (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL, creator_wallet TEXT NOT NULL,
  token_mint TEXT NOT NULL UNIQUE, nft_mint TEXT NOT NULL UNIQUE,
  quote_key TEXT NOT NULL, quote_mint TEXT NOT NULL, design_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL, binding_sha256 TEXT NOT NULL,
  token_metadata_uri TEXT NOT NULL, nft_metadata_uri TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('prepared','token_pending','nft_pending','complete','abandoned')),
  token_signature TEXT UNIQUE, nft_signature TEXT UNIQUE, token_receipt_json TEXT, nft_receipt_json TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(creator_wallet, idempotency_key)
);
CREATE INDEX live_launch_creator ON live_launch_intents(creator_wallet, created_at);
CREATE TRIGGER carddex_live_binding_immutable
BEFORE UPDATE OF creator_wallet, token_mint, quote_key, quote_mint, design_key, payload_sha256,
  payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri ON live_launch_intents
WHEN NEW.creator_wallet != OLD.creator_wallet OR NEW.token_mint != OLD.token_mint
  OR NEW.quote_key != OLD.quote_key OR NEW.quote_mint != OLD.quote_mint
  OR NEW.design_key != OLD.design_key OR NEW.payload_sha256 != OLD.payload_sha256
  OR NEW.payload_json != OLD.payload_json OR NEW.token_metadata_uri != OLD.token_metadata_uri
  OR NEW.binding_sha256 != OLD.binding_sha256
  OR NEW.nft_metadata_uri != OLD.nft_metadata_uri
BEGIN SELECT RAISE(ABORT, 'CardDex live launch binding is immutable'); END;
CREATE TRIGGER carddex_live_nft_complete_immutable
BEFORE UPDATE OF nft_mint ON live_launch_intents WHEN OLD.status = 'complete' AND NEW.nft_mint != OLD.nft_mint
BEGIN SELECT RAISE(ABORT, 'CardDex confirmed creator NFT is immutable'); END;
CREATE TABLE live_launch_transactions (
  id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES live_launch_intents(id),
  kind TEXT NOT NULL CHECK(kind IN ('token','nft')), message_sha256 TEXT NOT NULL,
  plan_json TEXT NOT NULL, signature TEXT UNIQUE, signed_transaction_base64 TEXT,
  status TEXT NOT NULL CHECK(status IN ('prepared','pending','confirmed')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(intent_id, kind, message_sha256)
);
CREATE TRIGGER carddex_live_transaction_plan_immutable
BEFORE UPDATE OF intent_id, kind, message_sha256, plan_json ON live_launch_transactions
WHEN NEW.intent_id != OLD.intent_id OR NEW.kind != OLD.kind OR NEW.message_sha256 != OLD.message_sha256 OR NEW.plan_json != OLD.plan_json
BEGIN SELECT RAISE(ABORT, 'Launch a Card prepared transaction is immutable'); END;
CREATE TRIGGER carddex_live_signed_transaction_immutable
BEFORE UPDATE OF signature, signed_transaction_base64 ON live_launch_transactions
WHEN (OLD.signature IS NOT NULL AND NEW.signature IS NOT OLD.signature)
  OR (OLD.signed_transaction_base64 IS NOT NULL AND NEW.signed_transaction_base64 IS NOT OLD.signed_transaction_base64)
BEGIN SELECT RAISE(ABORT, 'Launch a Card submitted transaction bytes are immutable'); END;
