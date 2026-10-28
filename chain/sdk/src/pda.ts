// Every PDA MintDex touches. MintDex seeds: card-program-v2 §3. pump / PumpSwap seeds: facts §3
// (checked against @pump-fun/pump-sdk 2.0.0 in test/pda.test.ts).
import { findProgramAddress, pda, seedOf, toAddress } from "./address.ts";
import type { Address, AddressLike } from "./address.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  MAYHEM_PROGRAM_ID,
  MINTDEX_PROGRAM_ID,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "./constants.ts";

// ---------------------------------------------------------------- generic

/** ATA = PDA([owner, token program, mint], ATA program). Off-curve owners (PDAs) are allowed. */
export function associatedTokenAddress(
  owner: AddressLike,
  mint: AddressLike,
  tokenProgram: AddressLike = TOKEN_PROGRAM_ID
): Address {
  return pda([seedOf(owner), seedOf(tokenProgram), seedOf(mint)], ASSOCIATED_TOKEN_PROGRAM_ID);
}

export const eventAuthorityPda = (programId: AddressLike): Address => pda(["__event_authority"], programId);

/** BPF upgradeable loader program-data account of a program. */
export const programDataAddress = (programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda([seedOf(programId)], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);

// ---------------------------------------------------------------- MintDex (card-program-v2 §3)

export const configPda = (programId: AddressLike = MINTDEX_PROGRAM_ID): Address => pda(["config"], programId);
/** Admin-issued vanity ticket `["vanity", mint]` (rev 1). */
export const ticketPda = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda(["vanity", seedOf(mint)], programId);
/** Card vault `["card", mint]` = pump `creator`; system-owned, lamports only. */
export const cardVaultPda = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda(["card", seedOf(mint)], programId);
export const cardVaultPdaWithBump = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID) =>
  findProgramAddress(["card", seedOf(mint)], programId);
/** `Card` state account `["card-state", mint]`. */
export const cardStatePda = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda(["card-state", seedOf(mint)], programId);
/** Token-2022 card NFT mint `["card-mint", mint]`. */
export const cardMintPda = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda(["card-mint", seedOf(mint)], programId);
export const bidPda = (mint: AddressLike, bidder: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda(["bid", seedOf(mint), seedOf(bidder)], programId);
export const listingPda = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  pda(["listing", seedOf(mint)], programId);
// ---------------------------------------------------------------- fix pack (fix-plan §2.2)

/** `["observers"]`: the ObserverSet of attested mode (F1), 8WB8k8… on both clusters. */
export const observerSetPda = (programId: AddressLike = MINTDEX_PROGRAM_ID): Address => pda(["observers"], programId);
/** `["collection"]`: the MintDex collection authority (F8; a PDA signer, never an account). */
export const collectionAuthorityPda = (programId: AddressLike = MINTDEX_PROGRAM_ID): Address => pda(["collection"], programId);
/** `["collection-mint"]`: the MintDex collection NFT mint (legacy SPL Token, decimals 0). */
export const collectionMintPda = (programId: AddressLike = MINTDEX_PROGRAM_ID): Address => pda(["collection-mint"], programId);

export const mintdexEventAuthority = (programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  eventAuthorityPda(programId);

/** Holder's card token account: ATA(holder, card_mint, Token-2022). */
export const cardTokenAccount = (
  holder: AddressLike,
  mint: AddressLike,
  programId: AddressLike = MINTDEX_PROGRAM_ID
): Address => associatedTokenAddress(holder, cardMintPda(mint, programId), TOKEN_2022_PROGRAM_ID);
/** Custodial listing escrow: ATA(listing, card_mint, Token-2022) (rev 1). */
export const listingEscrowPda = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  associatedTokenAddress(listingPda(mint, programId), cardMintPda(mint, programId), TOKEN_2022_PROGRAM_ID);
/** Sweep leg 3 target: ATA(card_vault, WSOL, SPL Token) (rev 1, G12). */
export const vaultWsolAta = (mint: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID): Address =>
  associatedTokenAddress(cardVaultPda(mint, programId), WSOL_MINT, TOKEN_PROGRAM_ID);

// ---------------------------------------------------------------- pump

export const pumpGlobalPda = (): Address => pda(["global"], PUMP_PROGRAM_ID);
export const pumpMintAuthorityPda = (): Address => pda(["mint-authority"], PUMP_PROGRAM_ID);
export const pumpEventAuthority = (): Address => eventAuthorityPda(PUMP_PROGRAM_ID);
export const bondingCurvePda = (mint: AddressLike): Address => pda(["bonding-curve", seedOf(mint)], PUMP_PROGRAM_ID);
/** Passed read-only as a remaining account to buy/sell; does not exist on devnet (facts §3). */
export const bondingCurveV2Pda = (mint: AddressLike): Address =>
  pda(["bonding-curve-v2", seedOf(mint)], PUMP_PROGRAM_ID);
/** ATA(bonding curve, mint, Token-2022) for create_v2 coins. */
export const associatedBondingCurve = (mint: AddressLike, tokenProgram: AddressLike = TOKEN_2022_PROGRAM_ID): Address =>
  associatedTokenAddress(bondingCurvePda(mint), mint, tokenProgram);
/** pump creator vault `["creator-vault", creator]` (hyphen). For MintDex coins the creator is the card vault. */
export const creatorVaultPda = (creator: AddressLike): Address =>
  pda(["creator-vault", seedOf(creator)], PUMP_PROGRAM_ID);
export const globalVolumeAccumulatorPda = (): Address => pda(["global_volume_accumulator"], PUMP_PROGRAM_ID);
export const userVolumeAccumulatorPda = (user: AddressLike): Address =>
  pda(["user_volume_accumulator", seedOf(user)], PUMP_PROGRAM_ID);
/** pump_fees `["fee_config", pump]`. */
export const pumpFeeConfigPda = (): Address => pda(["fee_config", seedOf(PUMP_PROGRAM_ID)], PUMP_FEES_PROGRAM_ID);
export const pumpQuoteControlPda = (): Address => pda(["quote-control"], PUMP_PROGRAM_ID);

// mayhem accounts passed to create_v2 (even for non-mayhem coins)
export const mayhemGlobalParamsPda = (): Address => pda(["global-params"], MAYHEM_PROGRAM_ID);
export const mayhemSolVaultPda = (): Address => pda(["sol-vault"], MAYHEM_PROGRAM_ID);
export const mayhemStatePda = (mint: AddressLike): Address => pda(["mayhem-state", seedOf(mint)], MAYHEM_PROGRAM_ID);
export const mayhemTokenVault = (mint: AddressLike): Address =>
  associatedTokenAddress(mayhemSolVaultPda(), mint, TOKEN_2022_PROGRAM_ID);

/** pump `["pool-authority", mint]`: creator of the canonical pool. */
export const poolAuthorityPda = (mint: AddressLike): Address => pda(["pool-authority", seedOf(mint)], PUMP_PROGRAM_ID);

// ---------------------------------------------------------------- PumpSwap (pAMM)

export function poolPda(index: number, creator: AddressLike, baseMint: AddressLike, quoteMint: AddressLike): Address {
  const idx = new Uint8Array(2);
  new DataView(idx.buffer).setUint16(0, index, true);
  return pda(["pool", idx, seedOf(creator), seedOf(baseMint), seedOf(quoteMint)], PAMM_PROGRAM_ID);
}
/** Canonical pool `["pool", 0u16 LE, pool_authority, mint, WSOL]`. Non-canonical pools are ignored by design. */
export const canonicalPoolPda = (mint: AddressLike): Address => poolPda(0, poolAuthorityPda(mint), mint, WSOL_MINT);
export const ammGlobalConfigPda = (): Address => pda(["global_config"], PAMM_PROGRAM_ID);
export const ammEventAuthority = (): Address => eventAuthorityPda(PAMM_PROGRAM_ID);
export const ammGlobalVolumeAccumulatorPda = (): Address => pda(["global_volume_accumulator"], PAMM_PROGRAM_ID);
export const ammUserVolumeAccumulatorPda = (user: AddressLike): Address =>
  pda(["user_volume_accumulator", seedOf(user)], PAMM_PROGRAM_ID);
/** pump_fees `["fee_config", pAMM]`. */
export const ammFeeConfigPda = (): Address => pda(["fee_config", seedOf(PAMM_PROGRAM_ID)], PUMP_FEES_PROGRAM_ID);
export const poolV2Pda = (baseMint: AddressLike): Address => pda(["pool-v2", seedOf(baseMint)], PAMM_PROGRAM_ID);
export const lpMintPda = (pool: AddressLike): Address => pda(["pool_lp_mint", seedOf(pool)], PAMM_PROGRAM_ID);
export const boostVaultAuthorityPda = (pool: AddressLike): Address =>
  pda(["boost_vault", seedOf(pool)], PAMM_PROGRAM_ID);
export const boostVault = (pool: AddressLike): Address =>
  associatedTokenAddress(boostVaultAuthorityPda(pool), WSOL_MINT, TOKEN_PROGRAM_ID);
/** AMM coin-creator vault authority `["creator_vault", coin_creator]` (underscore). */
export const ammCreatorVaultAuthorityPda = (coinCreator: AddressLike): Address =>
  pda(["creator_vault", seedOf(coinCreator)], PAMM_PROGRAM_ID);
/** AMM creator fees sit here: ATA(authority, WSOL, SPL Token). */
export const ammCreatorVaultAta = (coinCreator: AddressLike, quoteMint: AddressLike = WSOL_MINT): Address =>
  associatedTokenAddress(ammCreatorVaultAuthorityPda(coinCreator), quoteMint, TOKEN_PROGRAM_ID);

// ---------------------------------------------------------------- Metaplex Token Metadata (card-program-v2 §18.17)

/** Metaplex metadata PDA ["metadata", mpl, mint]. */
export const metaplexMetadataPda = (mint: AddressLike): Address =>
  pda(["metadata", seedOf(MPL_TOKEN_METADATA_PROGRAM_ID), seedOf(mint)], MPL_TOKEN_METADATA_PROGRAM_ID);
/** Metaplex master edition PDA ["metadata", mpl, mint, "edition"] (mint + freeze authority of a NonFungible). */
export const metaplexMasterEditionPda = (mint: AddressLike): Address =>
  pda(["metadata", seedOf(MPL_TOKEN_METADATA_PROGRAM_ID), seedOf(mint), "edition"], MPL_TOKEN_METADATA_PROGRAM_ID);

/** All derived addresses for one MintDex coin, the usual starting point for clients. */
export function coinAddresses(mintLike: AddressLike, programId: AddressLike = MINTDEX_PROGRAM_ID) {
  const mint = toAddress(mintLike);
  const cardVault = cardVaultPda(mint, programId);
  const cardMint = cardMintPda(mint, programId);
  const listing = listingPda(mint, programId);
  const pool = canonicalPoolPda(mint);
  return {
    mint,
    // MintDex
    ticket: ticketPda(mint, programId),
    cardVault,
    card: cardStatePda(mint, programId),
    cardMint,
    /** Metaplex metadata / master edition of the card NFT (cards registered with register_card_metaplex). */
    cardMetadata: metaplexMetadataPda(cardMint),
    cardEdition: metaplexMasterEditionPda(cardMint),
    listing,
    listingEscrow: associatedTokenAddress(listing, cardMint, TOKEN_2022_PROGRAM_ID),
    vaultWsolAta: associatedTokenAddress(cardVault, WSOL_MINT, TOKEN_PROGRAM_ID),
    // pump
    bondingCurve: bondingCurvePda(mint),
    associatedBondingCurve: associatedBondingCurve(mint),
    pumpCreatorVault: creatorVaultPda(cardVault),
    // PumpSwap
    poolAuthority: poolAuthorityPda(mint),
    pool,
    poolBaseTokenAccount: associatedTokenAddress(pool, mint, TOKEN_2022_PROGRAM_ID),
    poolQuoteTokenAccount: associatedTokenAddress(pool, WSOL_MINT, TOKEN_PROGRAM_ID),
    ammCreatorVaultAuthority: ammCreatorVaultAuthorityPda(cardVault),
    ammCreatorVaultAta: ammCreatorVaultAta(cardVault),
  };
}
export type CoinAddresses = ReturnType<typeof coinAddresses>;

/** The MintDex collection accounts (F8): authority PDA, mint, its ATA held by the authority, Metaplex metadata and edition. */
export function collectionAddresses(programId: AddressLike = MINTDEX_PROGRAM_ID) {
  const authority = collectionAuthorityPda(programId);
  const mint = collectionMintPda(programId);
  return {
    authority,
    mint,
    token: associatedTokenAddress(authority, mint, TOKEN_PROGRAM_ID),
    metadata: metaplexMetadataPda(mint),
    edition: metaplexMasterEditionPda(mint),
  };
}
export type CollectionAddresses = ReturnType<typeof collectionAddresses>;
