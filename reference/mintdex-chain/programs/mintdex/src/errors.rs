use anchor_lang::prelude::*;

/// Error codes 6000.. in the exact order of card-program-v2 §9 (the SDK placeholder IDL numbers them the same
/// way). Errors the implementation needed beyond §9 are appended after `MathOverflow` so the §9 codes never move.
#[error_code]
pub enum MintdexError {
    #[msg("MintDex is paused for this action")]
    Paused,
    #[msg("Invalid config")]
    InvalidConfig,
    #[msg("Signer is not allowed to do this")]
    Unauthorized,
    #[msg("The coin mint is not a MintDex vanity key")]
    NotMintdexMint,
    #[msg("No vanity ticket for this mint")]
    TicketMissing,
    #[msg("The coin metadata URI is not the bound MintDex URI")]
    CoinUriMismatch,
    #[msg("The coin mint is not a Token-2022 mint with TokenMetadata")]
    NotTokenMetadataMint,
    #[msg("Bonding curve address, owner, discriminator or length is wrong")]
    CurveMismatch,
    #[msg("The coin's pump creator is not the card vault")]
    CreatorMismatch,
    #[msg("Unsupported coin (mayhem, cashback, non-SOL quote, custom creator fee or holder reward)")]
    UnsupportedCoin,
    #[msg("Pool account, owner, mints or token accounts are wrong")]
    PoolMismatch,
    #[msg("The coin migrated: pass the canonical pool accounts")]
    PoolRequired,
    #[msg("Pool base reserve is too thin to price the coin")]
    PoolTooThin,
    #[msg("Price is stale or invalid")]
    StalePrice,
    #[msg("Price confidence interval is too wide")]
    PriceTooUncertain,
    #[msg("Price change is larger than allowed")]
    PriceStepTooLarge,
    #[msg("Price was updated too recently")]
    PriceTooSoon,
    #[msg("evolve must not share a transaction with other programs")]
    EvolveMustBeAlone,
    #[msg("Signer does not hold this card")]
    NotHolder,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Payout would leave the receiver below rent exemption")]
    PayoutBelowRent,
    #[msg("Bid or price is below the minimum")]
    BidTooLow,
    #[msg("The bid changed; refresh and try again")]
    BidChanged,
    #[msg("The listing price changed; refresh and try again")]
    PriceChanged,
    #[msg("Fees are higher than your limit")]
    FeesChanged,
    #[msg("You cannot trade with yourself")]
    SelfTrade,
    #[msg("A listing already exists for this card")]
    ListingExists,
    #[msg("The listing has expired")]
    ListingExpired,
    #[msg("The listing has not expired")]
    ListingNotExpired,
    #[msg("The listing was voided by an evolve; the seller must re-price")]
    ListingVoided,
    #[msg("Listing account is invalid")]
    ListingInvalid,
    #[msg("Token account extensions (MemoTransfer, CpiGuard) block this transfer")]
    UnsupportedTokenAccount,
    #[msg("Math overflow")]
    MathOverflow,
    // ---- appended (not in §9; see card-program-v2 §18.2 and §18.9)
    #[msg("Price feed account is missing or is not the configured Pyth SOL/USD account")]
    PriceFeedMismatch,
    #[msg("The card vault must be a system-owned account without data")]
    InvalidVault,
    #[msg("Fees paid to the seller are below the seller's floor: pass every vault-owned WSOL account")]
    FeesBelowFloor,
    #[msg("Metaplex metadata account or program is missing or wrong")]
    MetaplexAccountMismatch,
    // ---- appended by the mainnet fix pack (refs/mainnet/fix-plan.md §2.2; card-program-v2 §18.18)
    #[msg("The card is locked by another app (frozen token account); unlock it there first")]
    CardFrozen,
    #[msg("Observer set account is missing or wrong")]
    ObserverSetMismatch,
    #[msg("Signer is not in the observer set")]
    NotObserver,
    #[msg("The observed level cap must be 1 to 14")]
    InvalidObservation,
    #[msg("Tier, price, fee and card URI settings change only through the upgrade authority")]
    TierFieldsLocked,
    #[msg("No Pyth price is recorded: pass the price feed")]
    PriceBaselineMissing,
    #[msg("This card standard is disabled for new cards")]
    CardStandardDisabled,
    #[msg("MintDex collection accounts are missing or wrong")]
    CollectionAccountMismatch,
    #[msg("The ticket authority's allowance is used up")]
    TicketAllowanceExhausted,
    #[msg("The observer set changed since this update was built; rebuild it from the live set")]
    ObserverSetChanged,
}

#[cfg(test)]
mod tests {
    use super::MintdexError;

    /// The fix-pack codes are appended after 6036: nothing earlier moves (the SDK, Worker and app map them by number).
    #[test]
    fn error_codes_are_pinned() {
        let code = |e: MintdexError| -> u32 { e.into() };
        assert_eq!(code(MintdexError::Paused), 6000);
        assert_eq!(code(MintdexError::MathOverflow), 6032);
        assert_eq!(code(MintdexError::MetaplexAccountMismatch), 6036);
        let appended = [
            (MintdexError::CardFrozen, 6037),
            (MintdexError::ObserverSetMismatch, 6038),
            (MintdexError::NotObserver, 6039),
            (MintdexError::InvalidObservation, 6040),
            (MintdexError::TierFieldsLocked, 6041),
            (MintdexError::PriceBaselineMissing, 6042),
            (MintdexError::CardStandardDisabled, 6043),
            (MintdexError::CollectionAccountMismatch, 6044),
            (MintdexError::TicketAllowanceExhausted, 6045),
            (MintdexError::ObserverSetChanged, 6046),
        ];
        for (e, n) in appended {
            assert_eq!(code(e), n);
        }
    }
}
