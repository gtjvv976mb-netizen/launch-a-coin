-- When a launch's images and metadata are public (lib/carddex/live/assets.server.ts serveLiveAsset):
--   published_at > 0: for good, from the batch that saves the creator's signed coin transaction (before it is sent) or
--     records the coin from the chain. Wallets, pump.fun and explorers read them from then on.
--   published_at = 0 (stored by this build, no signed coin yet): public only until public_until, the wallet approval
--     window set when the launch is saved, so a wallet can show the coin's image in its prompt. Preparing costs no SOL,
--     so a launch that never sends its coin never publishes anything for good (SEC-R5).
--   published_at NULL: stored by an older Worker (before 0014, or one still running while these migrations are applied
--     ahead of the deploy). Public exactly as before, so no coin saved in that window loses its metadata (F2).
ALTER TABLE live_assets ADD COLUMN public_until INTEGER;
