-- Announcements of new coins on the site's own X account (@launchacard), only for creators who opted in at launch
-- (x-announce.server.ts). The launch's own rows (payload, binding, plans) never change for it.
--
-- The creator's choice, saved in the same batch as the launch intent when they ticked "Announce my coin on
-- @launchacard". Written once and never changed.
CREATE TABLE live_x_optins (
  intent_id TEXT PRIMARY KEY REFERENCES live_launch_intents(id),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER carddex_live_x_optin_immutable
BEFORE UPDATE ON live_x_optins
BEGIN SELECT RAISE(ABORT, 'Launch a Card announcement choice is immutable'); END;
-- One post per launch, added when an opted-in launch is complete and CARDDEX_X_AUTOPOST is on. Statuses:
--   review:  waiting for an owner to look at the name and card image on /admin/replies (reviewed_by, reviewed_at).
--   queued:  approved, waiting for the cron (next_attempt_at says when it may be tried).
--   posting: claimed by one run (claim_id); nothing else may post it.
--   posted:  posted on X as tweet_id.
--   failed:  given up (attempts used, a refusal, or an interrupted post whose outcome is unknown). Never retried by
--            the job; an operator who checked @launchacard may set it back to queued.
--   skipped: never posted (an owner skipped it, an unsafe name or ticker, or too old).
-- posted and skipped are final. claimed_at is kept after a run: the gap between posts is counted from it.
CREATE TABLE live_x_posts (
  intent_id TEXT PRIMARY KEY REFERENCES live_launch_intents(id),
  status TEXT NOT NULL CHECK (status IN ('review','queued','posting','posted','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  claim_id TEXT, claimed_at INTEGER,
  reviewed_by TEXT, reviewed_at INTEGER,
  tweet_id TEXT UNIQUE, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, posted_at INTEGER,
  CHECK (status != 'posted' OR (tweet_id IS NOT NULL AND posted_at IS NOT NULL))
);
CREATE INDEX live_x_posts_queue ON live_x_posts(status, next_attempt_at, created_at);
CREATE INDEX live_x_posts_posted ON live_x_posts(posted_at);
CREATE INDEX live_x_posts_claimed ON live_x_posts(claimed_at);
CREATE TRIGGER carddex_live_x_post_final
BEFORE UPDATE ON live_x_posts
WHEN OLD.status IN ('posted','skipped') AND (NEW.status IS NOT OLD.status OR NEW.tweet_id IS NOT OLD.tweet_id OR NEW.posted_at IS NOT OLD.posted_at)
BEGIN SELECT RAISE(ABORT, 'Launch a Card announcement is final'); END;
CREATE TRIGGER carddex_live_x_post_identity
BEFORE UPDATE OF intent_id, created_at ON live_x_posts
WHEN NEW.intent_id IS NOT OLD.intent_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'Launch a Card announcement identity is immutable'); END;
