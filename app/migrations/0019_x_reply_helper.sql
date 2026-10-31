-- The private reply helper (/admin/replies, x-replies.server.ts): fresh Solana and pump.fun posts from X's recent
-- search, for the site owner to answer by hand on X. Nothing here posts anything: a human writes and posts every reply.
--
-- The last search answer, so page loads within a few minutes reuse it instead of paying X for the same read again.
-- One row per query set ('search'); posts_json holds only the fields the page shows.
CREATE TABLE x_reply_cache (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  posts_json TEXT NOT NULL
);
-- Posts the owner answered ("done") or set aside ("hidden"): never shown again.
CREATE TABLE x_reply_marks (
  tweet_id TEXT PRIMARY KEY CHECK (length(tweet_id) BETWEEN 1 AND 30 AND tweet_id NOT GLOB '*[^0-9]*'),
  mark TEXT NOT NULL CHECK (mark IN ('done','hidden')),
  wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX x_reply_marks_created ON x_reply_marks(created_at);
