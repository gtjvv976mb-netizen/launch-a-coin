-- Pre-ground coin mint addresses ending in "card" (lib/carddex/live/vanity.server.ts). The operator grinds keypairs
-- locally (solana-keygen grind --ends-with card:N), encrypts each secret key with AES-256-GCM under the Worker secret
-- CARDDEX_VANITY_KEY (tools/carddex/vanity-pool.ts) and inserts the rows; plaintext secret keys are never stored here.
--   available: in the pool, never handed out.
--   issued:    handed to one signed-in creator wallet (issued_to) for one new launch; never handed out again.
--   used:      a launch intent was saved with this coin mint (in the same batch, by that same wallet).
CREATE TABLE live_vanity_mints (
  public_key TEXT PRIMARY KEY CHECK (
    length(public_key) BETWEEN 32 AND 44 AND substr(public_key, -4) = 'card'
    -- Base58 only. A range class keeps the pattern under D1's LIKE/GLOB pattern length limit (a 58-character class is
    -- refused there with "LIKE or GLOB pattern too complex" on every insert).
    AND public_key NOT GLOB '*[^1-9A-HJ-NP-Za-km-z]*'),
  secret_ciphertext TEXT NOT NULL CHECK (length(secret_ciphertext) > 0),
  secret_iv TEXT NOT NULL CHECK (length(secret_iv) > 0),
  status TEXT NOT NULL CHECK (status IN ('available', 'issued', 'used')),
  issued_to TEXT,
  issued_at INTEGER,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK ((status = 'available') = (issued_to IS NULL AND issued_at IS NULL)),
  CHECK ((status = 'used') = (used_at IS NOT NULL))
);
CREATE INDEX live_vanity_mint_status ON live_vanity_mints(status);
-- A wallet's one issued, unused address (issueCardMint hands it back instead of issuing a second one).
CREATE INDEX live_vanity_mint_issued ON live_vanity_mints(issued_to) WHERE status = 'issued';
