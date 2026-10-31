-- The creator's optional pump.fun creator fee split, set by its own creator-only transaction after the coin and its card
-- are complete (service.server.ts prepareLiveFeeShare). The launch's own rows (payload, binding, plans) never change for
-- it. One row per launch, written in the same batch as the launch intent when the creator chose a split; the recipients
-- are frozen from then on. Statuses:
--   requested:     chosen at launch, nothing prepared yet.
--   prepared:      a transaction is prepared (live_fee_share_transactions), not sent.
--   pending:       the creator's signed transaction is saved and sent; signature set.
--   complete:      finalized and verified: the coin's split is locked with exactly these recipients.
--   set_elsewhere: the coin's split was locked with other recipients (on pump.fun), so this one can never be set.
--   skipped:       the creator kept 100% (pump.fun's default) instead.
--   failed:        the last transaction failed on Solana or expired unlanded; it can be prepared again.
-- complete, set_elsewhere and skipped are final.
CREATE TABLE live_fee_shares (
  intent_id TEXT PRIMARY KEY REFERENCES live_launch_intents(id),
  recipients_json TEXT NOT NULL, recipients_sha256 TEXT NOT NULL CHECK (length(recipients_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('requested','prepared','pending','complete','set_elsewhere','skipped','failed')),
  signature TEXT UNIQUE, receipt_json TEXT, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TRIGGER carddex_live_fee_share_recipients_immutable
BEFORE UPDATE OF intent_id, recipients_json, recipients_sha256, created_at ON live_fee_shares
WHEN NEW.intent_id IS NOT OLD.intent_id OR NEW.recipients_json IS NOT OLD.recipients_json
  OR NEW.recipients_sha256 IS NOT OLD.recipients_sha256 OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'Launch a Card fee split recipients are immutable'); END;
CREATE TRIGGER carddex_live_fee_share_final
BEFORE UPDATE ON live_fee_shares
WHEN OLD.status IN ('complete','set_elsewhere','skipped') AND (NEW.status IS NOT OLD.status OR NEW.signature IS NOT OLD.signature OR NEW.receipt_json IS NOT OLD.receipt_json)
BEGIN SELECT RAISE(ABORT, 'Launch a Card fee split is final'); END;
-- Each prepared attempt, as live_launch_transactions keeps the coin and card plans: the plan and the signed bytes are
-- written once and never change (the same rules as 0011 and 0012).
CREATE TABLE live_fee_share_transactions (
  id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES live_fee_shares(intent_id),
  message_sha256 TEXT NOT NULL, plan_json TEXT NOT NULL,
  signature TEXT UNIQUE, signed_transaction_base64 TEXT, signed_message_sha256 TEXT, effective_last_valid_block_height INTEGER,
  status TEXT NOT NULL CHECK (status IN ('prepared','pending','confirmed')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(intent_id, message_sha256)
);
CREATE INDEX live_fee_share_transaction_intent ON live_fee_share_transactions(intent_id, created_at);
CREATE TRIGGER carddex_live_fee_share_plan_immutable
BEFORE UPDATE OF intent_id, message_sha256, plan_json ON live_fee_share_transactions
WHEN NEW.intent_id != OLD.intent_id OR NEW.message_sha256 != OLD.message_sha256 OR NEW.plan_json != OLD.plan_json
BEGIN SELECT RAISE(ABORT, 'Launch a Card prepared fee split is immutable'); END;
CREATE TRIGGER carddex_live_fee_share_signed_immutable
BEFORE UPDATE OF signature, signed_transaction_base64, signed_message_sha256, effective_last_valid_block_height ON live_fee_share_transactions
WHEN (OLD.signature IS NOT NULL AND NEW.signature IS NOT OLD.signature)
  OR (OLD.signed_transaction_base64 IS NOT NULL AND NEW.signed_transaction_base64 IS NOT OLD.signed_transaction_base64)
  OR (OLD.signed_message_sha256 IS NOT NULL AND NEW.signed_message_sha256 IS NOT OLD.signed_message_sha256)
  OR (OLD.effective_last_valid_block_height IS NOT NULL AND NEW.effective_last_valid_block_height IS NOT OLD.effective_last_valid_block_height)
BEGIN SELECT RAISE(ABORT, 'Launch a Card submitted fee split bytes are immutable'); END;
