//! Small lamport and account helpers (v1's `top_up_rent`, `top_up_rent_for`, `move_lamports`, `pay`, kept as is,
//! plus PDA account creation and closing).

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::SYSTEM_PROGRAM_ID;

pub use crate::math::bps;

/// Fund `account` up to the rent-exempt minimum for its current size.
pub fn top_up_rent<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    top_up_rent_for(account, payer, system_program, 0)
}

/// Like `top_up_rent`, for the current size plus `headroom` bytes the account may grow by later.
pub fn top_up_rent_for<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    headroom: usize,
) -> Result<()> {
    top_up_to_len(account, payer, system_program, account.data_len() + headroom)
}

/// Fund `account` to the rent-exempt minimum of `len` bytes (no-op when it already has that much).
pub fn top_up_to_len<'info>(
    account: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    len: usize,
) -> Result<()> {
    let needed = Rent::get()?.minimum_balance(len);
    let have = account.lamports();
    if needed > have {
        pay(system_program, payer, account, needed - have)?;
    }
    Ok(())
}

/// Debit a program-owned account and credit any account directly.
///
/// Ordering rule (card-program-v2 §18.13): a direct move must come after every CPI of the instruction that carries
/// exactly one side of it, counting aliases (e.g. launcher == treasury). A CPI syncs only the accounts passed to it,
/// and the runtime then requires the lamport sum of all the caller's instruction accounts to be unchanged, so such a
/// CPI fails with `UnbalancedInstruction`. Every MintDex handler runs its direct moves after its last CPI except
/// `emit_event!`, whose only account is the event authority.
pub fn move_lamports<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    from.sub_lamports(amount)?;
    to.add_lamports(amount)?;
    Ok(())
}

/// System-program transfer from a signer.
pub fn pay<'info>(
    system_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(
            system_program.clone(),
            system_program::Transfer {
                from: from.clone(),
                to: to.clone(),
            },
        ),
        amount,
    )
}

/// Create a program-owned PDA account of `space` bytes, paid by `payer`. Works when someone pre-funded the
/// address (transfer the shortfall, then allocate + assign with the PDA's seeds), so a griefer cannot block it.
pub fn create_pda_account<'info>(
    payer: &AccountInfo<'info>,
    target: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    space: usize,
    owner: &Pubkey,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(space);
    let have = target.lamports();
    if have == 0 {
        system_program::create_account(
            CpiContext::new_with_signer(
                system_program.clone(),
                system_program::CreateAccount { from: payer.clone(), to: target.clone() },
                &[signer_seeds],
            ),
            rent,
            space as u64,
            owner,
        )
    } else {
        require!(*target.owner == SYSTEM_PROGRAM_ID, anchor_lang::error::ErrorCode::AccountNotSystemOwned);
        if rent > have {
            pay(system_program, payer, target, rent - have)?;
        }
        system_program::allocate(
            CpiContext::new_with_signer(
                system_program.clone(),
                system_program::Allocate { account_to_allocate: target.clone() },
                &[signer_seeds],
            ),
            space as u64,
        )?;
        system_program::assign(
            CpiContext::new_with_signer(
                system_program.clone(),
                system_program::Assign { account_to_assign: target.clone() },
                &[signer_seeds],
            ),
            owner,
        )
    }
}

/// Writes an `#[account]` struct (discriminator + borsh) into an account MintDex owns.
pub fn store_account<T: AccountSerialize>(info: &AccountInfo, value: &T) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    value.try_serialize(&mut &mut data[..])
}

/// Close a program-owned account: all lamports to `destination`, owner back to System, data length 0
/// (what Anchor's `close` constraint does). A direct lamport move: see the ordering rule on `move_lamports`.
pub fn close_account<'info>(info: &AccountInfo<'info>, destination: &AccountInfo<'info>) -> Result<()> {
    let lamports = info.lamports();
    move_lamports(info, destination, lamports)?;
    info.assign(&SYSTEM_PROGRAM_ID);
    #[allow(deprecated)]
    info.realloc(0, false).map_err(Into::into)
}
