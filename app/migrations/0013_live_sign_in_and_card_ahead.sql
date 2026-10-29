-- Sign In With Solana (solana:signIn): one wallet prompt connects the wallet and proves its owner. The challenge names
-- no wallet (the wallet chooses the account), so its rate limit is per client: a hash of the connecting address, never
-- the address itself. input_json is the exact request the wallet signs, every field set by the server; the wallet adds
-- only its address, recorded once the challenge is consumed.
CREATE TABLE live_sign_in_challenges (
  id TEXT PRIMARY KEY, client_hash TEXT NOT NULL, origin TEXT NOT NULL, input_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, wallet TEXT
);
CREATE INDEX live_sign_in_challenge_rate ON live_sign_in_challenges(client_hash, created_at);
CREATE TRIGGER carddex_live_sign_in_challenge_immutable
BEFORE UPDATE OF origin, input_json, client_hash, created_at, expires_at ON live_sign_in_challenges
WHEN NEW.origin IS NOT OLD.origin OR NEW.input_json IS NOT OLD.input_json OR NEW.client_hash IS NOT OLD.client_hash
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'Launch a Card sign-in challenge is immutable'); END;
-- A card approved with its coin in one wallet prompt is saved in live_launch_transactions before the coin is sent:
-- signed_transaction_base64, signed_message_sha256 and effective_last_valid_block_height are set while signature stays
-- NULL. The relay sends those exact bytes only once the coin is verified (status nft_pending); setting signature then
-- marks them submitted. The existing immutability trigger already keeps those saved bytes unchanged. No new column.
