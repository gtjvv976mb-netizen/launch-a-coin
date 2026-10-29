-- What the wallet and the page actually signed. A wallet may append read-only Lighthouse assertions or refresh the
-- blockhash within the shared wallet rule (integrations/pumpfun/src/wallet-guards.ts), so the landed message can
-- differ from the plan's: every finalization check expects signed_message_sha256 when it is set. The effective last
-- valid block height bounds when those signed bytes can still land (the plan's, or an upper bound for a refreshed
-- blockhash); abandon and card replacement wait past it. Both are written with the signature, before any broadcast,
-- and never change after.
ALTER TABLE live_launch_transactions ADD COLUMN signed_message_sha256 TEXT;
ALTER TABLE live_launch_transactions ADD COLUMN effective_last_valid_block_height INTEGER;
DROP TRIGGER carddex_live_signed_transaction_immutable;
CREATE TRIGGER carddex_live_signed_transaction_immutable
BEFORE UPDATE OF signature, signed_transaction_base64, signed_message_sha256, effective_last_valid_block_height ON live_launch_transactions
WHEN (OLD.signature IS NOT NULL AND NEW.signature IS NOT OLD.signature)
  OR (OLD.signed_transaction_base64 IS NOT NULL AND NEW.signed_transaction_base64 IS NOT OLD.signed_transaction_base64)
  OR (OLD.signed_message_sha256 IS NOT NULL AND NEW.signed_message_sha256 IS NOT OLD.signed_message_sha256)
  OR (OLD.effective_last_valid_block_height IS NOT NULL AND NEW.effective_last_valid_block_height IS NOT OLD.effective_last_valid_block_height)
BEGIN SELECT RAISE(ABORT, 'Launch a Card submitted transaction bytes are immutable'); END;
