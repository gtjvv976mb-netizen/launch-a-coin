// Program ids, well-known accounts and discriminators. Sources: refs/chain/pump-devnet-facts.md §3, §4, §6
// and refs/chain/card-program-v2.md §3 (revision 1). pump and PumpSwap use the same ids on devnet and mainnet.
import { fromHex } from "./bytes.ts";
import type { Address } from "./address.ts";

// Native programs and sysvars
export const SYSTEM_PROGRAM_ID: Address = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM_ID: Address = "ComputeBudget111111111111111111111111111111";
export const TOKEN_PROGRAM_ID: Address = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID: Address = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ID: Address = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID: Address = "BPFLoaderUpgradeab1e11111111111111111111111";
export const ADDRESS_LOOKUP_TABLE_PROGRAM_ID: Address = "AddressLookupTab1e1111111111111111111111111";
export const SYSVAR_INSTRUCTIONS_ID: Address = "Sysvar1nstructions1111111111111111111111111";
export const SYSVAR_RENT_ID: Address = "SysvarRent111111111111111111111111111111111";
export const WSOL_MINT: Address = "So11111111111111111111111111111111111111112";
/** Sink with no private key (§4.5 launcher fallback). */
export const INCINERATOR: Address = "1nc1nerator11111111111111111111111111111111";

// pump.fun family
export const PUMP_PROGRAM_ID: Address = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PAMM_PROGRAM_ID: Address = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMP_FEES_PROGRAM_ID: Address = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
export const MAYHEM_PROGRAM_ID: Address = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";

// Pyth (mainnet price source; devnet uses a fixed admin price)
export const PYTH_RECEIVER_PROGRAM_ID: Address = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
export const PYTH_SOL_USD_PRICE_ACCOUNT: Address = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
export const SOL_USD_FEED_ID = fromHex("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");

// Metaplex Token Metadata (card NFTs registered with register_card_metaplex, card-program-v2 §18.17; same id on devnet
// and mainnet). Only ever invoked by CPI from MintDex, never at the top level of a MintDex transaction.
export const MPL_TOKEN_METADATA_PROGRAM_ID: Address = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

// MintDex card program v2
export const MINTDEX_PROGRAM_ID: Address = "4HTSBYfgm5os2kBwFVBv5cd4mPetNmS32Cb4r3YViDon";

// Cluster guards (devnet-plan M3: refuse to sign anything unless the genesis hash is devnet)
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** 8-byte Anchor discriminators (first bytes of instruction data / account data). */
export const PUMP_IX = {
  create_v2: fromHex("d6904cec5f8b31b4"),
  buy: fromHex("66063d1201daebea"),
  buy_exact_sol_in: fromHex("38fc74089edfcd5f"),
  sell: fromHex("33e685a4017f83ad"),
  collect_creator_fee: fromHex("1416567bc61cdb84"),
  migrate: fromHex("9beae792ec9ea21e"),
  extend_account: fromHex("ea66c2cb96483ee5"),
} as const;

export const PAMM_IX = {
  buy: fromHex("66063d1201daebea"),
  buy_exact_quote_in: fromHex("c62e1552b4d9e870"),
  sell: fromHex("33e685a4017f83ad"),
  transfer_creator_fees_to_pump: fromHex("8b348655e4e56cf1"),
  collect_coin_creator_fee: fromHex("a039592ab58b2b42"),
  extend_account: fromHex("ea66c2cb96483ee5"),
} as const;

export const ACCOUNT_DISC = {
  pumpBondingCurve: fromHex("17b7f83760d8ac60"),
  pumpGlobal: fromHex("a7e8e8b1c86c727f"),
  pammPool: fromHex("f19a6d0411b16dbc"),
  pammGlobalConfig: fromHex("95089ccaa0fcb0d9"),
  pythPriceUpdateV2: fromHex("22f123639d7ef4cd"),
} as const;

/** Anchor `emit_cpi!` inner-instruction tag: data = tag ‖ event discriminator ‖ borsh. */
export const ANCHOR_EVENT_IX_TAG = fromHex("e445a52e51cb9a1d");

/**
 * Devnet pump `Global` fee recipients (facts §4, decoded 2026-10-02). Encoders take recipients as
 * arguments; these are defaults for verification policies. Pass the live `Global` values when they change.
 */
export const DEVNET_PUMP_FEE_RECIPIENTS: readonly Address[] = [
  "68yFSZxzLWJXkxxRGydZ63C6mHx1NLEDWmwN9Lb5yySg",
  "6QgPshH1egekJ2TURfakiiApDdv98qfRuRe7RectX8xs",
  "78i5hpHxbtmosSJdfJ74WzwdUr3eKWg9RbCPpBeAF78t",
  "8RMFYhsVsfdGCuWPFLxMCbSpSesiofabDdNorGqFrBNe",
  "9GDepfBcjJMvNgmijXWVWa97Am7VZYCqXx7kJV44E9ij",
  "9ppkS5madL2uXozoEnMnZi5bKDq9jgdKkSavjWTS5NfW",
  "DDMCfwbcaNYTeMk1ca8tr8BQKFaUfFCWFwBJq8JcnyCw",
  "DRDBsRMst21CJUhwD16pncgiXnBrFaRAPvA2G6SUQceE",
];
export const DEVNET_PUMP_BUYBACK_FEE_RECIPIENTS: readonly Address[] = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
];
/** pump `Global.withdraw_authority` on devnet (writable, never a signer, in `migrate`). */
export const DEVNET_PUMP_WITHDRAW_AUTHORITY: Address = "5PXxuZkvftsg5CAGjv5LL5tEtvBRskdx1AAjxw8hK2Qx";

/** MintDex card PDA shared ALT created during the facts run (27 pump addresses; not the v2 MintDex ALT). */
export const DEVNET_SHARED_PUMP_ALT: Address = "G66jR7Q7FCX8pDZP5Lq6QypZcJUQRzDkyELHZKCtS9XN";

/** Coins created on devnet before v2 (facts §14; card-program-v2 G7). */
export const DEVNET_COIN1_MINT: Address = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint";
export const DEVNET_COIN2_MINT: Address = "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint";

/** Bytes per account of non-data overhead used in rent math (rent(len) = (len + 128) × lamports/byte). */
export const ACCOUNT_STORAGE_OVERHEAD = 128;
