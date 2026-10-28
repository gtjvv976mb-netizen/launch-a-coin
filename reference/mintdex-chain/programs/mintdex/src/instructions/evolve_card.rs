//! `evolve` and `observe` (card-program-v2 §7.3; mainnet fix pack F1/F2: refs/mainnet/fix-plan.md §2.3). Both read
//! the market cap from the pump curve (or the canonical PumpSwap pool after migration), convert it to USD with the
//! configured price and feed the live level to the pure state machine in `crate::evolve`. A confirm updates the NFT's
//! `level` field and URI (Token-2022 cards) or the Metaplex metadata URI (`CARD_METAPLEX` cards, §18.17), copying the
//! Metaplex creators and collection verbatim (F8). When nothing changes it is a cheap no-op (no error).
//!
//! Who counts (F1):
//! - open mode (`Config.evolve_min_observers == 0`): `evolve` by anyone and `observe` by an observer-set member are
//!   `Who::Open`, exactly the pre-fix-pack rule (`observe` additionally caps the live level);
//! - attested mode: plain `evolve` changes no window or mark (it only caches the canonical pool and the GRADUATED
//!   flag); `observe(cap)` by a ROLE_COUNT member counts (`Who::Count`), by a ROLE_CAP-only member (the watcher) may
//!   lower or clear (`Who::Cap`); the live level is `min(on-chain, cap)`, and a counting call is ignored when its cap
//!   is above the card level and the on-chain read is below the cap (`ObservationMismatch { applied: false }`); an
//!   ignored call still lowers the pending level to its cap (review round 2, `lower_on_ignored`).
//!
//! Review round 2: a window opened before the last EVOLVE unpause (`Config.evolve_resumed_slot`) restarts on its next
//! observation, because nothing could observe it while EVOLVE was paused.
//!
//! `observe` remaining accounts: `[ObserverSet (ro)]`, then on a Metaplex confirm `[metadata (w), Metaplex program]`;
//! `evolve` takes the two Metaplex accounts first.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{token_metadata_update_field, Token2022, TokenMetadataUpdateField};
use spl_token_metadata_interface::state::Field;

use crate::constants::*;
use crate::errors::MintdexError;
use crate::events::{CardEvolved, CreatorFeesChanged, CreatorMismatch, EvolveObserved, EvolvePendingCleared, ObservationMismatch};
use crate::evolve::{count_call_ignored, lower_on_ignored, step, EvolveParams, Who, Window};
use crate::math::{level_for, mcap_usd_e6, MAX_LEVEL};
use crate::metadata::{base58_string, card_name, card_uri, parse_coin_metadata};
use crate::mpl;
use crate::price;
use crate::pump::{self, AccountView};
use crate::state::{load_observer_set, Card, Config, ObserverSet};
use crate::utils::top_up_rent;

#[event_cpi]
#[derive(Accounts)]
pub struct Evolve<'info> {
    /// Pays only the NFT rent top-up on a confirm (normally pre-funded at registration).
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CARD_SEED, card.mint.as_ref()], bump = card.bump)]
    pub card: Box<Account<'info, Card>>,
    /// CHECK: the card NFT mint: addr = `card.card_mint`, owner Token-2022 (§7.0).
    #[account(mut, address = card.card_mint, owner = TOKEN_2022_PROGRAM_ID)]
    pub card_mint: UncheckedAccount<'info>,
    /// CHECK: the coin mint (addr = `card.mint`); owner and live supply are checked in the pool path (§5.2).
    #[account(address = card.mint)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: addr = PDA(["bonding-curve", mint], pump); owner, discriminator and length in the handler (§5.1).
    /// It may be gone after migration (then `card.pool` must be cached).
    #[account(address = pump::bonding_curve_pda(&card.mint) @ MintdexError::CurveMismatch)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: canonical PumpSwap pool (§5.2), required once the curve reserves are 0.
    pub pool: Option<UncheckedAccount<'info>>,
    /// CHECK: `pool.pool_base_token_account` (Token-2022), checked against the pool data.
    pub pool_base_ta: Option<UncheckedAccount<'info>>,
    /// CHECK: `pool.pool_quote_token_account` (SPL Token, WSOL), checked against the pool data.
    pub pool_quote_ta: Option<UncheckedAccount<'info>>,
    /// CHECK: addr = `config.pyth_price_account`, owner Pyth receiver; required when the price source is Pyth.
    #[account(
        address = config.pyth_price_account @ MintdexError::PriceFeedMismatch,
        owner = PYTH_RECEIVER_PROGRAM_ID @ MintdexError::PriceFeedMismatch,
    )]
    pub price_feed: Option<UncheckedAccount<'info>>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    /// CHECK: addr = the instructions sysvar (a forged account would bypass `EvolveMustBeAlone`).
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,
}

/// Program ids of every top-level instruction in the transaction, read straight from the instructions sysvar
/// layout (`u16 n`, `u16 offsets[n]`, then per ix `u16 n_accounts`, `n_accounts × (u8 flags, [32] key)`,
/// `[32] program_id`, ...). Lighter than deserializing every instruction; unit-tested against the runtime's
/// serializer.
pub fn check_only_compute_budget_and_mintdex(data: &[u8]) -> Result<()> {
    let bad = || error!(MintdexError::EvolveMustBeAlone);
    let rd16 = |o: usize| -> Result<usize> {
        data.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).ok_or_else(bad)
    };
    let n = rd16(0)?;
    for i in 0..n {
        let start = rd16(2 + 2 * i)?;
        let n_accounts = rd16(start)?;
        let pid_at = start + 2 + 33 * n_accounts;
        let pid = data.get(pid_at..pid_at + 32).ok_or_else(bad)?;
        require!(
            pid == COMPUTE_BUDGET_PROGRAM_ID.as_ref() || pid == crate::ID.as_ref(),
            MintdexError::EvolveMustBeAlone
        );
    }
    Ok(())
}

fn view<'a>(a: &'a AccountInfo, data: &'a [u8]) -> AccountView<'a> {
    AccountView { key: a.key, owner: a.owner, data }
}

/// F1: `observe`'s cap must be a level (`InvalidObservation`).
pub fn check_cap(cap: u8) -> Result<()> {
    require!((1..=MAX_LEVEL).contains(&cap), MintdexError::InvalidObservation);
    Ok(())
}

/// F1 role table for `observe`: the signer must hold ROLE_CAP in the set (`NotObserver`); open mode → `Open`, a COUNT
/// member → `Count { bit: 1 << slot }`, a CAP-only member → `Cap`.
pub fn resolve_observer(attested: bool, set: &ObserverSet, signer: &Pubkey) -> Result<Who> {
    let (slot, roles) = set
        .find(signer)
        .filter(|(_, r)| r & ROLE_CAP != 0)
        .ok_or_else(|| error!(MintdexError::NotObserver))?;
    Ok(if !attested {
        Who::Open
    } else if roles & ROLE_COUNT != 0 {
        Who::Count { bit: 1u8 << slot }
    } else {
        Who::Cap
    })
}

pub fn evolve<'info>(ctx: Context<'_, '_, 'info, 'info, Evolve<'info>>) -> Result<()> {
    run(ctx, None)
}

/// `observe(max_live_level)` (F1): an observer-set member's observation, capped at the level it read from committed
/// state. Remaining accounts: `[ObserverSet]`, then on a Metaplex confirm `[metadata (w), Metaplex program]`.
pub fn observe<'info>(ctx: Context<'_, '_, 'info, 'info, Evolve<'info>>, max_live_level: u8) -> Result<()> {
    run(ctx, Some(max_live_level))
}

fn run<'info>(ctx: Context<'_, '_, 'info, 'info, Evolve<'info>>, cap: Option<u8>) -> Result<()> {
    let cfg = &ctx.accounts.config;
    require!(!cfg.is_paused(PAUSE_EVOLVE), MintdexError::Paused);
    // Same-tx manipulation guard: every top-level instruction must be ComputeBudget or MintDex.
    {
        let ixs = ctx.accounts.instructions.try_borrow_data()?;
        check_only_compute_budget_and_mintdex(&ixs)?;
    }
    let attested = cfg.evolve_min_observers != 0;
    // F1: who observes. `None` = a plain `evolve` in attested mode (no window or mark change).
    let (who, epoch, metaplex_at) = match cap {
        None => (if attested { None } else { Some(Who::Open) }, 0u8, 0usize),
        Some(c) => {
            check_cap(c)?;
            let set_info = ctx.remaining_accounts.first().ok_or_else(|| error!(MintdexError::ObserverSetMismatch))?;
            let set = load_observer_set(set_info)?;
            let who = resolve_observer(attested, &set, ctx.accounts.cranker.key)?;
            (Some(who), if attested { set.epoch } else { 0 }, 1usize)
        }
    };
    let clock = Clock::get()?;
    let mint = ctx.accounts.card.mint;
    let vault = Pubkey::create_program_address(&[CARD_VAULT_SEED, mint.as_ref(), &[ctx.accounts.card.vault_bump]], &crate::ID)
        .map_err(|_| error!(MintdexError::InvalidVault))?;

    // §5.1 / §5.2 market cap.
    let reading = {
        let curve = ctx.accounts.bonding_curve.to_account_info();
        let coin = ctx.accounts.mint.to_account_info();
        let pool = ctx.accounts.pool.as_ref().map(|a| a.to_account_info());
        let base = ctx.accounts.pool_base_ta.as_ref().map(|a| a.to_account_info());
        let quote = ctx.accounts.pool_quote_ta.as_ref().map(|a| a.to_account_info());
        let curve_data = curve.try_borrow_data()?;
        let coin_data = coin.try_borrow_data()?;
        let pool_data = pool.as_ref().map(|a| a.try_borrow_data()).transpose()?;
        let base_data = base.as_ref().map(|a| a.try_borrow_data()).transpose()?;
        let quote_data = quote.as_ref().map(|a| a.try_borrow_data()).transpose()?;
        pump::read_market_cap(
            &mint,
            &vault,
            &ctx.accounts.card.pool,
            view(&curve, &curve_data),
            pool.as_ref().zip(pool_data.as_deref()).map(|(a, d)| view(a, d)),
            base.as_ref().zip(base_data.as_deref()).map(|(a, d)| view(a, d)),
            quote.as_ref().zip(quote_data.as_deref()).map(|(a, d)| view(a, d)),
            view(&coin, &coin_data),
        )?
    };

    if let Some(p) = reading.cache_pool {
        ctx.accounts.card.pool = p;
    }
    let who = match who {
        Some(w) => w,
        None => {
            // attested mode, plain evolve (tier B5): only the pool cache and the GRADUATED flag; no price read, no
            // window or mark change, no event
            if reading.graduated {
                ctx.accounts.card.flags |= CARD_GRADUATED;
            }
            return Ok(());
        }
    };

    // Flags (sticky) and their events, emitted when a flag is first set (§5.5, rev 1 FEES_CHANGED).
    let old_flags = ctx.accounts.card.flags;
    let mut flags = old_flags;
    if reading.graduated {
        flags |= CARD_GRADUATED;
    }
    let creator_lost = reading.curve_creator_mismatch.is_some() || reading.pool_creator_mismatch.is_some();
    if creator_lost {
        flags |= CARD_CREATOR_LOST;
    }
    if reading.fees_changed.is_some() {
        flags |= CARD_FEES_CHANGED;
    }
    ctx.accounts.card.flags = flags;
    if creator_lost && old_flags & CARD_CREATOR_LOST == 0 {
        if let Some(found) = reading.curve_creator_mismatch {
            crate::emit_event!(ctx, CreatorMismatch { mint, found, on_pool: false });
        }
        if let Some(found) = reading.pool_creator_mismatch {
            crate::emit_event!(ctx, CreatorMismatch { mint, found, on_pool: true });
        }
    }
    if let Some((creator_fee_bps, is_holder_reward)) = reading.fees_changed {
        if old_flags & CARD_FEES_CHANGED == 0 {
            crate::emit_event!(ctx, CreatorFeesChanged { mint, creator_fee_bps, is_holder_reward });
        }
    }

    // §5.3 price, §6 level; F1 cap and ignore rule.
    let price_feed = ctx.accounts.price_feed.as_ref().map(|a| a.to_account_info());
    let sol_usd_e6 = price::sol_usd_e6(cfg, price_feed.as_ref(), clock.unix_timestamp)?;
    let usd = mcap_usd_e6(reading.mcap_lamports, sol_usd_e6, cfg.mcap_multiplier)?;
    let live_onchain = level_for(usd, &cfg.tier_thresholds_usd);
    let live = cap.map_or(live_onchain, |c| live_onchain.min(c));
    if let Some(c) = cap {
        let ignored = count_call_ignored(who, c, ctx.accounts.card.level, live_onchain);
        if ignored || live_onchain != c {
            crate::emit_event!(ctx, ObservationMismatch {
                mint,
                observer: ctx.accounts.cranker.key(),
                cap: c,
                live_onchain,
                applied: !ignored,
                slot: clock.slot,
            });
        }
        if ignored {
            // review round 2: the observer's own read (the cap) still lowers the window; no count, no witness
            let mut w = Window::from_card(&ctx.accounts.card);
            if lower_on_ignored(&mut w, c) {
                w.write_to(&mut ctx.accounts.card);
                crate::emit_event!(ctx, EvolveObserved {
                    mint,
                    live_level: c,
                    pending_level: w.pending_level,
                    obs: w.pending_obs,
                    mcap_lamports: reading.mcap_lamports,
                    mcap_usd_e6: usd,
                    sol_usd_e6,
                    slot: clock.slot,
                });
            }
            return Ok(());
        }
    }

    // §7.3 state machine.
    let params = EvolveParams {
        hold_slots: cfg.evolve_hold_slots as u64,
        min_obs: cfg.evolve_min_obs,
        max_step: cfg.evolve_max_step,
        min_observers: cfg.evolve_min_observers,
        epoch,
        resumed_slot: cfg.evolve_resumed_slot,
    };
    let mut w = Window::from_card(&ctx.accounts.card);
    let out = step(&mut w, live, clock.slot, &params, who);
    w.write_to(&mut ctx.accounts.card);

    if out.expired || out.dip_cleared {
        crate::emit_event!(ctx, EvolvePendingCleared { mint, live_level: live, slot: clock.slot });
    }
    if let Some((pending_level, obs)) = out.observed {
        crate::emit_event!(ctx, EvolveObserved {
            mint,
            live_level: live,
            pending_level,
            obs,
            mcap_lamports: reading.mcap_lamports,
            mcap_usd_e6: usd,
            sol_usd_e6,
            slot: clock.slot,
        });
    }
    if let Some((from_level, to_level)) = out.evolved {
        {
            let card = &mut ctx.accounts.card;
            card.evolved_at = clock.unix_timestamp;
            card.peak_mcap_lamports = reading.mcap_lamports;
            card.peak_mcap_usd_e6 = usd;
        }
        let card_bump = ctx.accounts.card.bump;
        let seeds: &[&[u8]] = &[CARD_SEED, mint.as_ref(), &[card_bump]];
        let card_mint = ctx.accounts.card_mint.to_account_info();
        let card_info = ctx.accounts.card.to_account_info();
        let uri = card_uri(cfg.card_uri_base(), &base58_string(&mint), to_level);
        if ctx.accounts.card.flags & CARD_METAPLEX != 0 {
            // §18.17: the Metaplex metadata holds the URI (the level lives in `?l=`); the name is rebuilt from the
            // coin's immutable TokenMetadata exactly as at registration; creators and collection are copied verbatim
            // and the royalty follows `outside_royalty_bps` (F8).
            let ra = &ctx.remaining_accounts[metaplex_at.min(ctx.remaining_accounts.len())..];
            require!(
                ra.len() >= 2
                    && *ra[1].key == mpl::MPL_TOKEN_METADATA_PROGRAM_ID
                    && *ra[0].key == mpl::metadata_pda(card_mint.key),
                MintdexError::MetaplexAccountMismatch
            );
            // A holder can burn the NFT through Metaplex, which closes the metadata account: the level still counts.
            if *ra[0].owner == mpl::MPL_TOKEN_METADATA_PROGRAM_ID && !ra[0].data_is_empty() {
                let name = {
                    let data = ctx.accounts.mint.try_borrow_data()?;
                    let md = parse_coin_metadata(&data)?;
                    card_name(core::str::from_utf8(md.symbol).map_err(|_| error!(MintdexError::NotTokenMetadataMint))?)
                };
                mpl::rewrite_metadata(
                    &ra[0],
                    card_mint.key,
                    &card_info,
                    &ra[1],
                    Some(name.as_bytes()),
                    Some(CARD_NFT_SYMBOL.as_bytes()),
                    uri.as_bytes(),
                    cfg.outside_royalty_bps,
                    &[seeds],
                )?;
            }
        } else {
            let token_program = ctx.accounts.token_2022_program.to_account_info();
            for (field, value) in [(Field::Key("level".to_string()), to_level.to_string()), (Field::Uri, uri)] {
                token_metadata_update_field(
                    CpiContext::new_with_signer(
                        token_program.clone(),
                        TokenMetadataUpdateField {
                            program_id: token_program.clone(),
                            metadata: card_mint.clone(),
                            update_authority: card_info.clone(),
                        },
                        &[seeds],
                    ),
                    field,
                    value,
                )?;
            }
            // normally a no-op: the final size was pre-funded at registration
            top_up_rent(
                &card_mint,
                &ctx.accounts.cranker.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
            )?;
        }
        crate::emit_event!(ctx, CardEvolved {
            mint,
            from_level,
            to_level,
            mcap_lamports: reading.mcap_lamports,
            mcap_usd_e6: usd,
            sol_usd_e6,
            graduated: reading.graduated,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use crate::state::ObserverSet;
    #[allow(deprecated)]
    use anchor_lang::solana_program::sysvar::instructions::construct_instructions_data;
    use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
    use solana_instruction::{BorrowedAccountMeta, BorrowedInstruction};

    fn sysvar_bytes(ixs: &[Instruction]) -> Vec<u8> {
        let keys: Vec<Vec<(Pubkey, bool, bool)>> =
            ixs.iter().map(|ix| ix.accounts.iter().map(|m| (m.pubkey, m.is_signer, m.is_writable)).collect()).collect();
        let borrowed: Vec<BorrowedInstruction> = ixs
            .iter()
            .zip(keys.iter())
            .map(|(ix, metas)| BorrowedInstruction {
                program_id: &ix.program_id,
                accounts: metas
                    .iter()
                    .map(|(k, s, w)| BorrowedAccountMeta {
                        pubkey: k,
                        is_signer: *s,
                        is_writable: *w,
                    })
                    .collect(),
                data: &ix.data,
            })
            .collect();
        #[allow(deprecated)]
        construct_instructions_data(&borrowed)
    }

    fn ix(program: Pubkey, n_accounts: usize, data_len: usize) -> Instruction {
        Instruction {
            program_id: program,
            accounts: (0..n_accounts).map(|i| AccountMeta::new(Pubkey::new_unique(), i == 0)).collect(),
            data: vec![7u8; data_len],
        }
    }

    fn set_with(entries: &[(Pubkey, u8)]) -> ObserverSet {
        let mut keys = [Pubkey::default(); MAX_OBSERVERS];
        let mut roles = [0u8; MAX_OBSERVERS];
        for (i, (k, r)) in entries.iter().enumerate() {
            keys[i] = *k;
            roles[i] = *r;
        }
        ObserverSet { version: 1, bump: OBSERVER_SET_BUMP, epoch: 3, _pad: 0, keys, roles, updated_at: 0, reserved: [0; 32] }
    }

    /// F1 role table (fix-plan §2.8): non-member, CAP-only (watcher), COUNT member, open-mode member.
    #[test]
    fn observer_role_table() {
        let (crank, standby, watcher, pauser) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let set = set_with(&[(crank, ROLE_COUNT | ROLE_CAP), (standby, ROLE_COUNT | ROLE_CAP), (watcher, ROLE_CAP | ROLE_PAUSE), (pauser, ROLE_PAUSE)]);
        assert_eq!(resolve_observer(true, &set, &crank).unwrap(), Who::Count { bit: 1 });
        assert_eq!(resolve_observer(true, &set, &standby).unwrap(), Who::Count { bit: 2 });
        assert_eq!(resolve_observer(true, &set, &watcher).unwrap(), Who::Cap);
        // open mode: every CAP member observes as Open (with its cap)
        for k in [crank, watcher] {
            assert_eq!(resolve_observer(false, &set, &k).unwrap(), Who::Open);
        }
        // a PAUSE-only key and a stranger cannot observe; the default key never matches an empty slot
        for k in [pauser, Pubkey::new_unique(), Pubkey::default()] {
            assert_error(resolve_observer(true, &set, &k), MintdexError::NotObserver);
            assert_error(resolve_observer(false, &set, &k), MintdexError::NotObserver);
        }
    }

    #[test]
    fn cap_bounds() {
        assert_error(check_cap(0), MintdexError::InvalidObservation);
        assert_error(check_cap(15), MintdexError::InvalidObservation);
        check_cap(1).unwrap();
        check_cap(14).unwrap();
    }

    /// `load_observer_set`: wrong address, owner, discriminator or empty data → `ObserverSetMismatch`.
    #[test]
    fn observer_set_account_checks() {
        use anchor_lang::AccountSerialize;
        let set = set_with(&[(Pubkey::new_unique(), 3)]);
        let mut good = Vec::new();
        set.try_serialize(&mut good).unwrap();
        assert_eq!(good.len(), ObserverSet::LEN);
        let check = |key: Pubkey, owner: Pubkey, data: &mut Vec<u8>| {
            let mut lamports = 1u64;
            let info = AccountInfo::new(&key, false, false, &mut lamports, data, &owner, false, 0);
            load_observer_set(&info).map(|s| s.epoch)
        };
        assert_eq!(check(OBSERVER_SET_ADDRESS, crate::ID, &mut good.clone()).unwrap(), 3);
        assert_error(check(Pubkey::new_unique(), crate::ID, &mut good.clone()), MintdexError::ObserverSetMismatch);
        assert_error(check(OBSERVER_SET_ADDRESS, SYSTEM_PROGRAM_ID, &mut good.clone()), MintdexError::ObserverSetMismatch);
        let mut bad = good.clone();
        bad[0] ^= 1;
        assert_error(check(OBSERVER_SET_ADDRESS, crate::ID, &mut bad), MintdexError::ObserverSetMismatch);
        assert_error(check(OBSERVER_SET_ADDRESS, crate::ID, &mut Vec::new()), MintdexError::ObserverSetMismatch);
        // a Config (another MintDex account) at the address is not an ObserverSet
        let mut cfg = Vec::new();
        crate::state::tests::devnet_config().try_serialize(&mut cfg).unwrap();
        assert_error(check(OBSERVER_SET_ADDRESS, crate::ID, &mut cfg), MintdexError::ObserverSetMismatch);
    }

    /// The handler's order pins (tier B5): in attested mode a plain `evolve` returns before the price read and the
    /// state machine; the ignore rule returns before `step`; observe's Metaplex accounts sit after the set.
    #[test]
    fn handler_order_pins() {
        let src = include_str!("evolve_card.rs");
        let body = &src[src.find("fn run<'info>").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let early = body.find("None => {\n            // attested mode, plain evolve").unwrap();
        assert!(early < body.find("price::sol_usd_e6(").unwrap());
        assert!(early < body.find("step(&mut w").unwrap());
        let ignored = body.find("if ignored {").unwrap();
        assert!(ignored < body.find("step(&mut w").unwrap());
        // the ignored branch only lowers (never `step`) and returns
        let branch = &body[ignored..body.find("// §7.3 state machine.").unwrap()];
        assert!(branch.contains("lower_on_ignored(&mut w, c)") && branch.contains("return Ok(());") && !branch.contains("step("));
        assert!(body.contains("resumed_slot: cfg.evolve_resumed_slot"));
        assert!(body.contains("ctx.remaining_accounts[metaplex_at.min("));
    }

    #[test]
    fn evolve_must_be_alone_guard() {
        let cb = COMPUTE_BUDGET_PROGRAM_ID;
        let me = crate::ID;
        // [CU limit, CU price, evolve × 6]: allowed
        let mut ok = vec![ix(cb, 0, 5), ix(cb, 0, 9)];
        ok.extend((0..6).map(|_| ix(me, 17, 8)));
        check_only_compute_budget_and_mintdex(&sysvar_bytes(&ok)).unwrap();
        // a pump buy (or any other program) anywhere in the tx: rejected
        for pos in [0usize, 3, 8] {
            let mut bad = ok.clone();
            bad.insert(pos, ix(PUMP_PROGRAM_ID, 16, 25));
            assert_error(check_only_compute_budget_and_mintdex(&sysvar_bytes(&bad)), MintdexError::EvolveMustBeAlone);
        }
        // a wallet-injected guard (e.g. Lighthouse) or a system transfer: rejected
        let mut bad = ok.clone();
        bad.push(ix(SYSTEM_PROGRAM_ID, 2, 12));
        assert_error(check_only_compute_budget_and_mintdex(&sysvar_bytes(&bad)), MintdexError::EvolveMustBeAlone);
        // truncated / garbage sysvar data fails closed
        let bytes = sysvar_bytes(&ok);
        assert_error(check_only_compute_budget_and_mintdex(&bytes[..bytes.len() / 2]), MintdexError::EvolveMustBeAlone);
        assert_error(check_only_compute_budget_and_mintdex(&[5, 0]), MintdexError::EvolveMustBeAlone);
        assert_error(check_only_compute_budget_and_mintdex(&[]), MintdexError::EvolveMustBeAlone);
    }
}
