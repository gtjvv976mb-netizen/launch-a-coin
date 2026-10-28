//! Unit-test helpers: devnet fixture accounts from the localnet harness (`chain/scripts/localnet/fixtures`,
//! the `solana account --output json` format), a deterministic RNG, and error-code assertions.

use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
use anchor_lang::prelude::*;

use crate::errors::MintdexError;

#[allow(dead_code)]
pub struct Fixture {
    pub pubkey: Pubkey,
    pub owner: Pubkey,
    pub lamports: u64,
    pub data: Vec<u8>,
}

fn json_string<'a>(json: &'a str, key: &str) -> &'a str {
    let k = format!("\"{key}\"");
    let at = json.find(&k).unwrap_or_else(|| panic!("fixture has no {key}")) + k.len();
    let rest = &json[at..];
    let start = rest.find('"').unwrap() + 1;
    let end = start + rest[start..].find('"').unwrap();
    &rest[start..end]
}

fn json_u64(json: &str, key: &str) -> u64 {
    let k = format!("\"{key}\"");
    let at = json.find(&k).unwrap() + k.len();
    let rest = json[at..].trim_start_matches(|c: char| c == ':' || c.is_whitespace());
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap();
    rest[..end].parse().unwrap()
}

pub fn parse_fixture(json: &str) -> Fixture {
    // "data": [ "<base64>", "base64" ]
    let rest = &json[json.find("\"data\"").unwrap() + 6..];
    let rest = &rest[rest.find('[').unwrap() + 1..];
    let s = rest.find('"').unwrap() + 1;
    let e = s + rest[s..].find('"').unwrap();
    let b64 = &rest[s..e];
    Fixture {
        pubkey: json_string(json, "pubkey").parse().unwrap(),
        owner: json_string(json, "owner").parse().unwrap(),
        lamports: json_u64(json, "lamports"),
        data: STANDARD.decode(b64).unwrap(),
    }
}

/// `fixture!("coin2.bonding_curve")` loads `chain/scripts/localnet/fixtures/accounts/coin2.bonding_curve.json`.
#[macro_export]
macro_rules! fixture {
    ($name:literal) => {
        $crate::test_utils::parse_fixture(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../scripts/localnet/fixtures/accounts/",
            $name,
            ".json"
        )))
    };
}
pub use crate::fixture;

/// xorshift64* (deterministic, no dependency).
pub struct XorShift(u64);

impl XorShift {
    pub fn new(seed: u64) -> Self {
        Self(seed | 1)
    }
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    pub fn key(&mut self) -> [u8; 32] {
        let mut k = [0u8; 32];
        for chunk in k.chunks_mut(8) {
            chunk.copy_from_slice(&self.next().to_le_bytes());
        }
        k
    }
}

pub fn error_code(e: &anchor_lang::error::Error) -> u32 {
    match e {
        anchor_lang::error::Error::AnchorError(a) => a.error_code_number,
        anchor_lang::error::Error::ProgramError(p) => u64::from(p.program_error.clone()) as u32,
    }
}

#[track_caller]
pub fn assert_error<T: core::fmt::Debug>(r: Result<T>, expected: MintdexError) {
    let want: u32 = expected.into();
    match r {
        Ok(v) => panic!("expected error {want}, got Ok({v:?})"),
        Err(e) => assert_eq!(error_code(&e), want, "got {e:?}"),
    }
}

/// A model of the runtime's lamport check around a CPI (Agave `TransactionContext::push`; card-program-v2 §18.13).
/// The program edits its own copy of its instruction accounts' lamports (direct moves). A CPI first copies the
/// accounts passed to it into the runtime's view, then requires the runtime's lamport sum over all of the caller's
/// instruction accounts to equal the sum at instruction start (`UnbalancedInstruction` otherwise); the callee's
/// changes land in both views. One key under two names (an alias) is one index.
pub struct CpiLedger {
    program: Vec<u64>,
    runtime: Vec<u64>,
    start_sum: u128,
}

impl CpiLedger {
    pub fn new(balances: &[u64]) -> Self {
        Self { program: balances.to_vec(), runtime: balances.to_vec(), start_sum: Self::sum(balances) }
    }

    fn sum(v: &[u64]) -> u128 {
        v.iter().map(|&l| l as u128).sum()
    }

    /// A direct move by the program (`move_lamports` / `close_account`).
    pub fn direct(&mut self, from: usize, to: usize, amount: u64) {
        self.program[from] -= amount;
        self.program[to] += amount;
    }

    /// A CPI that carries `accounts`; `transfer` is a lamport move the callee makes between two of them.
    pub fn cpi(&mut self, accounts: &[usize], transfer: Option<(usize, usize, u64)>) -> core::result::Result<(), String> {
        for &a in accounts {
            self.runtime[a] = self.program[a];
        }
        let now = Self::sum(&self.runtime);
        if now != self.start_sum {
            return Err(format!("UnbalancedInstruction (off by {})", now as i128 - self.start_sum as i128));
        }
        if let Some((from, to, amount)) = transfer {
            assert!(accounts.contains(&from) && accounts.contains(&to), "the callee only moves lamports of its accounts");
            self.direct(from, to, amount);
        }
        for &a in accounts {
            self.runtime[a] = self.program[a];
        }
        Ok(())
    }

    /// The instruction returns: every account is synced and the sum must still match. Returns the final balances.
    pub fn finish(mut self) -> core::result::Result<Vec<u64>, String> {
        self.runtime = self.program.clone();
        if Self::sum(&self.runtime) != self.start_sum {
            return Err("UnbalancedInstruction at return".to_string());
        }
        Ok(self.program)
    }
}
