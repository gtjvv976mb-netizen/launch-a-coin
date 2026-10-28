//! Who may act as the card holder (card-program-v2 §4.5, §7.0 row `holder_card_account`, §7.5 step 1).
//! The holder is not stored: it is whoever holds the 1 card token, checked in every instruction that needs it.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::StateWithExtensions,
    state::{Account as T22Account, AccountState},
};

use crate::constants::*;
use crate::errors::MintdexError;
use crate::state::Listing;

/// A Token-2022 account of the card mint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CardTokenAccount {
    pub owner: Pubkey,
    pub amount: u64,
    /// The account is frozen (F10: a holder-approved Metaplex delegate `Lock`ed it).
    pub frozen: bool,
}

/// Reads a Token-2022 token account of `card_mint`: owner program Token-2022, a valid (possibly extended) account,
/// initialized or frozen (F10), `mint == card_mint`. `NotHolder` otherwise (an uninitialized account included).
pub fn read_card_token_account(owner_program: &Pubkey, data: &[u8], card_mint: &Pubkey) -> Result<CardTokenAccount> {
    require!(*owner_program == TOKEN_2022_PROGRAM_ID, MintdexError::NotHolder);
    let state = StateWithExtensions::<T22Account>::unpack(data).map_err(|_| error!(MintdexError::NotHolder))?;
    let frozen = state.base.state == AccountState::Frozen;
    require!(
        (state.base.state == AccountState::Initialized || frozen) && state.base.mint == *card_mint,
        MintdexError::NotHolder
    );
    Ok(CardTokenAccount { owner: state.base.owner, amount: state.base.amount, frozen })
}

/// ATA(owner, card_mint, Token-2022): every card token account the market touches (§3, §7.0).
pub fn card_ata(owner: &Pubkey, card_mint: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address_with_program_id(owner, card_mint, &TOKEN_2022_PROGRAM_ID)
}

/// The listing escrow: ATA(listing, card_mint, Token-2022) (§4.4).
pub fn listing_escrow_address(listing: &Pubkey, card_mint: &Pubkey) -> Pubkey {
    card_ata(listing, card_mint)
}

/// How a withdrawer qualified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HolderPath {
    /// The signer owns the token account holding the card.
    Holder,
    /// The card is in the listing escrow and the signer is `listing.seller`.
    ListedSeller,
    /// Nobody can sign as holder (burned, or held by a sink) and the signer is `card.launcher`.
    LauncherFallback,
}

/// The keys of the MintDex accounts around one card, for the sink list.
#[derive(Debug, Clone, Copy)]
pub struct CardKeys<'a> {
    pub card: &'a Pubkey,
    pub card_vault: &'a Pubkey,
    pub card_mint: &'a Pubkey,
    pub config: &'a Pubkey,
    pub listing: &'a Pubkey,
    pub launcher: &'a Pubkey,
}

/// §4.5 sinks: owners no one can sign for. The listing PDA counts only outside an active listing (inside one, the
/// escrow path applies).
pub fn is_sink(token_owner: &Pubkey, k: &CardKeys, listing_active: bool) -> bool {
    *token_owner == INCINERATOR
        || *token_owner == SYSTEM_PROGRAM_ID
        || token_owner == k.card_vault
        || token_owner == k.card
        || token_owner == k.config
        || (!listing_active && token_owner == k.listing)
}

/// `withdraw_fees` holder check (§7.5 step 1), one of:
/// - the signer owns the token account, which holds the 1 card, frozen or not (F10: a frozen account still proves
///   custody, and the token cannot move while frozen);
/// - the account is the listing escrow holding 1, the listing is active and `listing.seller == signer` (never
///   frozen: the listing PDA never approves a delegate; required anyway);
/// - launcher fallback: `signer == card.launcher` and either the card is burned (`supply == 0`; the token account
///   is then not read) or the account holding 1 is owned by a sink (not frozen; a sink never approves a delegate).
pub fn check_withdraw_holder(
    holder: &Pubkey,
    k: &CardKeys,
    card_mint_supply: u64,
    token_account_key: &Pubkey,
    token_account_owner_program: &Pubkey,
    token_account_data: &[u8],
    listing: Option<&Listing>,
) -> Result<HolderPath> {
    if card_mint_supply == 0 {
        require!(holder == k.launcher, MintdexError::NotHolder);
        return Ok(HolderPath::LauncherFallback);
    }
    let ta = read_card_token_account(token_account_owner_program, token_account_data, k.card_mint)?;
    require!(ta.amount == 1, MintdexError::NotHolder);
    if ta.owner == *holder {
        return Ok(HolderPath::Holder);
    }
    if ta.frozen {
        return err!(MintdexError::NotHolder);
    }
    if let Some(l) = listing {
        if l.seller == *holder
            && ta.owner == *k.listing
            && *token_account_key == listing_escrow_address(k.listing, k.card_mint)
        {
            return Ok(HolderPath::ListedSeller);
        }
    }
    if holder == k.launcher && is_sink(&ta.owner, k, listing.is_some()) {
        return Ok(HolderPath::LauncherFallback);
    }
    err!(MintdexError::NotHolder)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use anchor_lang::solana_program::program_pack::Pack;

    fn token_account(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
        token_account_in(mint, owner, amount, AccountState::Initialized)
    }

    fn token_account_in(mint: &Pubkey, owner: &Pubkey, amount: u64, state: AccountState) -> Vec<u8> {
        let mut data = vec![0u8; T22Account::LEN];
        T22Account { mint: *mint, owner: *owner, amount, state, ..Default::default() }.pack_into_slice(&mut data);
        data
    }

    /// F10 (design-market §3.7): a frozen own account withdraws; frozen escrows, sinks and other people's accounts
    /// never qualify; an uninitialized account never reads.
    #[test]
    fn frozen_paths() {
        let ks = Keys::new();
        let k = ks.k();
        let t22 = TOKEN_2022_PROGRAM_ID;
        let alice = Pubkey::new_unique();
        let ta = Pubkey::new_unique();
        let frozen_own = token_account_in(&ks.card_mint, &alice, 1, AccountState::Frozen);
        assert_eq!(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &frozen_own, None).unwrap(), HolderPath::Holder);
        let r = read_card_token_account(&t22, &frozen_own, &ks.card_mint).unwrap();
        assert!(r.frozen && r.amount == 1);
        // someone else's frozen account
        assert_error(check_withdraw_holder(&Pubkey::new_unique(), &k, 1, &ta, &t22, &frozen_own, None), MintdexError::NotHolder);
        // a frozen escrow with the listed seller
        let seller = Pubkey::new_unique();
        let escrow = listing_escrow_address(&ks.listing, &ks.card_mint);
        let frozen_escrow = token_account_in(&ks.card_mint, &ks.listing, 1, AccountState::Frozen);
        let l = listing(seller, Pubkey::new_unique());
        assert_error(check_withdraw_holder(&seller, &k, 1, &escrow, &t22, &frozen_escrow, Some(&l)), MintdexError::NotHolder);
        // a frozen sink with the launcher
        let frozen_sink = token_account_in(&ks.card_mint, &INCINERATOR, 1, AccountState::Frozen);
        assert_error(check_withdraw_holder(&ks.launcher, &k, 1, &ta, &t22, &frozen_sink, None), MintdexError::NotHolder);
        // uninitialized
        let uninit = token_account_in(&ks.card_mint, &alice, 1, AccountState::Uninitialized);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &uninit, None), MintdexError::NotHolder);
        // frozen but wrong mint, or empty
        let wrong = token_account_in(&Pubkey::new_unique(), &alice, 1, AccountState::Frozen);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &wrong, None), MintdexError::NotHolder);
        let empty = token_account_in(&ks.card_mint, &alice, 0, AccountState::Frozen);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &empty, None), MintdexError::NotHolder);
    }

    struct Keys {
        card: Pubkey,
        vault: Pubkey,
        card_mint: Pubkey,
        config: Pubkey,
        listing: Pubkey,
        launcher: Pubkey,
    }

    impl Keys {
        fn new() -> Self {
            Self {
                card: Pubkey::new_unique(),
                vault: Pubkey::new_unique(),
                card_mint: Pubkey::new_unique(),
                config: Pubkey::new_unique(),
                listing: Pubkey::new_unique(),
                launcher: Pubkey::new_unique(),
            }
        }
        fn k(&self) -> CardKeys<'_> {
            CardKeys {
                card: &self.card,
                card_vault: &self.vault,
                card_mint: &self.card_mint,
                config: &self.config,
                listing: &self.listing,
                launcher: &self.launcher,
            }
        }
    }

    fn listing(seller: Pubkey, mint: Pubkey) -> Listing {
        Listing {
            version: 1, bump: 255, flags: 0, level_at_list: 1, mint, seller, price: 30_000_000, created_at: 0, expires_at: 0,
            min_fees_to_seller: 0,
        }
    }

    #[test]
    fn holder_paths() {
        let ks = Keys::new();
        let k = ks.k();
        let alice = Pubkey::new_unique();
        let ta = Pubkey::new_unique();
        let t22 = TOKEN_2022_PROGRAM_ID;
        // the owner of the token account holding 1
        let data = token_account(&ks.card_mint, &alice, 1);
        assert_eq!(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &data, None).unwrap(), HolderPath::Holder);
        // fake holder token account: wrong mint, amount 0, SPL Token owner program, garbage
        let wrong_mint = token_account(&Pubkey::new_unique(), &alice, 1);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &wrong_mint, None), MintdexError::NotHolder);
        let empty = token_account(&ks.card_mint, &alice, 0);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &empty, None), MintdexError::NotHolder);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &SPL_TOKEN_PROGRAM_ID, &data, None), MintdexError::NotHolder);
        assert_error(check_withdraw_holder(&alice, &k, 1, &ta, &t22, &[0u8; 10], None), MintdexError::NotHolder);
        // someone else's card
        let bob = Pubkey::new_unique();
        assert_error(check_withdraw_holder(&bob, &k, 1, &ta, &t22, &data, None), MintdexError::NotHolder);
    }

    #[test]
    fn listed_seller_path() {
        let ks = Keys::new();
        let k = ks.k();
        let seller = Pubkey::new_unique();
        let escrow = listing_escrow_address(&ks.listing, &ks.card_mint);
        let data = token_account(&ks.card_mint, &ks.listing, 1);
        let l = listing(seller, Pubkey::new_unique());
        let t22 = TOKEN_2022_PROGRAM_ID;
        assert_eq!(check_withdraw_holder(&seller, &k, 1, &escrow, &t22, &data, Some(&l)).unwrap(), HolderPath::ListedSeller);
        // not the seller; not the escrow address; no active listing
        assert_error(check_withdraw_holder(&Pubkey::new_unique(), &k, 1, &escrow, &t22, &data, Some(&l)), MintdexError::NotHolder);
        assert_error(check_withdraw_holder(&seller, &k, 1, &Pubkey::new_unique(), &t22, &data, Some(&l)), MintdexError::NotHolder);
        assert_error(check_withdraw_holder(&seller, &k, 1, &escrow, &t22, &data, None), MintdexError::NotHolder);
        // the launcher cannot use the escrow of an active listing as a sink
        assert_error(check_withdraw_holder(&ks.launcher, &k, 1, &escrow, &t22, &data, Some(&l)), MintdexError::NotHolder);
        // ... but can once there is no active listing (card stuck under the listing PDA)
        assert_eq!(
            check_withdraw_holder(&ks.launcher, &k, 1, &escrow, &t22, &data, None).unwrap(),
            HolderPath::LauncherFallback
        );
    }

    #[test]
    fn launcher_fallback_l11_logic() {
        let ks = Keys::new();
        let k = ks.k();
        let ta = Pubkey::new_unique();
        let t22 = TOKEN_2022_PROGRAM_ID;
        // burned: supply 0, the token account is not even read
        assert_eq!(check_withdraw_holder(&ks.launcher, &k, 0, &ta, &t22, &[], None).unwrap(), HolderPath::LauncherFallback);
        assert_error(check_withdraw_holder(&Pubkey::new_unique(), &k, 0, &ta, &t22, &[], None), MintdexError::NotHolder);
        // sinks
        for sink in [INCINERATOR, SYSTEM_PROGRAM_ID, ks.vault, ks.card, ks.config] {
            let data = token_account(&ks.card_mint, &sink, 1);
            assert_eq!(check_withdraw_holder(&ks.launcher, &k, 1, &ta, &t22, &data, None).unwrap(), HolderPath::LauncherFallback);
            // only the launcher
            assert_error(check_withdraw_holder(&Pubkey::new_unique(), &k, 1, &ta, &t22, &data, None), MintdexError::NotHolder);
        }
        // a normal third-party wallet: launcher denied
        let data = token_account(&ks.card_mint, &Pubkey::new_unique(), 1);
        assert_error(check_withdraw_holder(&ks.launcher, &k, 1, &ta, &t22, &data, None), MintdexError::NotHolder);
        // a sink-owned account that does not hold the card (amount 0) does not qualify
        let data = token_account(&ks.card_mint, &INCINERATOR, 0);
        assert_error(check_withdraw_holder(&ks.launcher, &k, 1, &ta, &t22, &data, None), MintdexError::NotHolder);
    }
}
