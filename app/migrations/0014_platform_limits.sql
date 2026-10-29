-- Request limits (lib/carddex/live/limits.server.ts): one row per counted request. key_hash is a hash of the scope and
-- the client (a connecting address, a wallet or a demo account), never the value itself. Rows older than a day are
-- purged as new requests are counted, so the table stays small.
CREATE TABLE rate_events (scope TEXT NOT NULL, key_hash TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX rate_event_window ON rate_events(scope, key_hash, at);
CREATE INDEX rate_event_age ON rate_events(at);
-- Launch images and metadata are public only once a launch uses them: published_at is set in the same batch that saves
-- the launch (its coin and card metadata URIs are permanent from then on). An upload that never became a launch is
-- served only to this Worker's own verification read, so launchacard.fun never hosts arbitrary images. Everything
-- stored before this migration stays public exactly as before.
ALTER TABLE live_assets ADD COLUMN published_at INTEGER;
UPDATE live_assets SET published_at = created_at;
-- Server-only values created by the Worker itself (the random key its own asset verification reads carry).
CREATE TABLE live_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Expired challenges and sessions are purged in small batches (auth.server.ts purgeExpiredLiveRows).
CREATE INDEX live_wallet_challenge_expiry ON live_wallet_challenges(expires_at);
CREATE INDEX live_sign_in_challenge_expiry ON live_sign_in_challenges(expires_at);
CREATE INDEX live_wallet_session_expiry ON live_wallet_sessions(expires_at);
