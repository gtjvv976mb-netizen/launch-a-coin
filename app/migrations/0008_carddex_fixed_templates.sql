-- CardDex local simulation: immutable creator-selected artwork and token trading only.
-- Apply to CardDex's isolated database; never to MintDex data.
ALTER TABLE coins ADD COLUMN card_template TEXT NOT NULL DEFAULT 'pokemon-classic';
ALTER TABLE coins ADD COLUMN peak_mcap_usd REAL NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS carddex_template_immutable
BEFORE UPDATE OF card_template, level ON coins
WHEN NEW.card_template != OLD.card_template OR NEW.level != OLD.level
BEGIN SELECT RAISE(ABORT, 'CardDex card design is immutable'); END;

CREATE TRIGGER IF NOT EXISTS carddex_creator_card_retained
BEFORE UPDATE OF owner_id, creator_id ON coins
WHEN NEW.owner_id != OLD.owner_id OR NEW.creator_id != OLD.creator_id
BEGIN SELECT RAISE(ABORT, 'CardDex creator NFT cards cannot be traded'); END;

CREATE TRIGGER IF NOT EXISTS carddex_no_nft_sales_insert
BEFORE INSERT ON deed_sales
BEGIN SELECT RAISE(ABORT, 'NFT sales are not supported by CardDex'); END;
CREATE TRIGGER IF NOT EXISTS carddex_no_bids_insert
BEFORE INSERT ON bids
BEGIN SELECT RAISE(ABORT, 'NFT bids are not supported by CardDex'); END;
CREATE TRIGGER IF NOT EXISTS carddex_no_bids_update
BEFORE UPDATE ON bids
BEGIN SELECT RAISE(ABORT, 'NFT bids are not supported by CardDex'); END;
CREATE TRIGGER IF NOT EXISTS carddex_no_royalties_insert
BEFORE INSERT ON owner_earnings
BEGIN SELECT RAISE(ABORT, 'NFT royalties are not supported by CardDex'); END;
CREATE TRIGGER IF NOT EXISTS carddex_no_royalties_update
BEFORE UPDATE ON owner_earnings
BEGIN SELECT RAISE(ABORT, 'NFT royalties are not supported by CardDex'); END;
CREATE TRIGGER IF NOT EXISTS carddex_no_nft_terms_insert
BEFORE INSERT ON coins
WHEN NEW.list_price IS NOT NULL OR NEW.owner_fees != 0 OR NEW.fee_vault != 0 OR NEW.owner_id != NEW.creator_id
BEGIN SELECT RAISE(ABORT, 'CardDex creator cards have no marketplace or royalties'); END;
CREATE TRIGGER IF NOT EXISTS carddex_no_nft_terms_update
BEFORE UPDATE OF list_price, owner_fees, fee_vault ON coins
WHEN NEW.list_price IS NOT NULL OR NEW.owner_fees != 0 OR NEW.fee_vault != 0
BEGIN SELECT RAISE(ABORT, 'CardDex creator cards have no marketplace or royalties'); END;
