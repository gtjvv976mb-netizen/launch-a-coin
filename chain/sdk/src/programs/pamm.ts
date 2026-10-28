// Hand-encoded PumpSwap (pAMM) instructions, byte-equal to @pump-fun/pump-swap-sdk 1.20.0 as shipped
// with pump-sdk 2.0.0 (test/pamm.test.ts compares them). Account lists: facts §6 and the pAMM IDL.
import { toAddress } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import { ByteReader, ByteWriter, bytesEqual } from "../bytes.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PAMM_IX,
  PAMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "../constants.ts";
import { ro, wr, ws } from "../instruction.ts";
import type { AccountMeta, Instruction } from "../instruction.ts";
import {
  ammCreatorVaultAta,
  ammCreatorVaultAuthorityPda,
  ammEventAuthority,
  ammFeeConfigPda,
  ammGlobalConfigPda,
  ammGlobalVolumeAccumulatorPda,
  ammUserVolumeAccumulatorPda,
  associatedTokenAddress,
  creatorVaultPda,
  poolV2Pda,
} from "../pda.ts";
import { closeTokenAccount, createAtaIdempotent, syncNative, systemTransfer } from "./system.ts";

/** Pools shorter than this get `extend_account` first (pump-swap-sdk `POOL_ACCOUNT_NEW_SIZE`). */
export const POOL_ACCOUNT_NEW_SIZE = 300;
const DEFAULT_ADDRESS = "11111111111111111111111111111111";

export interface PammSwapAccounts {
  pool: AddressLike;
  user: AddressLike;
  baseMint: AddressLike;
  quoteMint?: AddressLike;
  /** `pool.pool_base_token_account` (data[139..171]). */
  poolBaseTokenAccount: AddressLike;
  /** `pool.pool_quote_token_account` (data[171..203]). */
  poolQuoteTokenAccount: AddressLike;
  /** One of `GlobalConfig.protocol_fee_recipients` (reserved recipients for mayhem pools). */
  protocolFeeRecipient: AddressLike;
  /** One of `GlobalConfig.buyback_fee_recipients`. */
  buybackFeeRecipient: AddressLike;
  /** `pool.coin_creator` (MintDex coins: the card vault). */
  coinCreator: AddressLike;
  baseTokenProgram?: AddressLike;
  quoteTokenProgram?: AddressLike;
  /** Defaults to ATA(user, base, baseTokenProgram). */
  userBaseTokenAccount?: AddressLike;
  /** Defaults to ATA(user, quote, quoteTokenProgram). */
  userQuoteTokenAccount?: AddressLike;
  isCashbackCoin?: boolean;
}

interface Resolved {
  pool: Address;
  user: Address;
  baseMint: Address;
  quoteMint: Address;
  baseTokenProgram: Address;
  quoteTokenProgram: Address;
  userBase: Address;
  userQuote: Address;
  coinCreator: Address;
}

function resolve(p: PammSwapAccounts): Resolved {
  const baseMint = toAddress(p.baseMint);
  const quoteMint = toAddress(p.quoteMint ?? WSOL_MINT);
  const baseTokenProgram = toAddress(p.baseTokenProgram ?? TOKEN_2022_PROGRAM_ID);
  const quoteTokenProgram = toAddress(p.quoteTokenProgram ?? TOKEN_PROGRAM_ID);
  return {
    pool: toAddress(p.pool),
    user: toAddress(p.user),
    baseMint,
    quoteMint,
    baseTokenProgram,
    quoteTokenProgram,
    userBase: toAddress(p.userBaseTokenAccount ?? associatedTokenAddress(p.user, baseMint, baseTokenProgram)),
    userQuote: toAddress(p.userQuoteTokenAccount ?? associatedTokenAddress(p.user, quoteMint, quoteTokenProgram)),
    coinCreator: toAddress(p.coinCreator),
  };
}

function commonAccounts(p: PammSwapAccounts, r: Resolved): AccountMeta[] {
  const vaultAuthority = ammCreatorVaultAuthorityPda(r.coinCreator);
  return [
    wr(r.pool),
    ws(r.user),
    ro(ammGlobalConfigPda()),
    ro(r.baseMint),
    ro(r.quoteMint),
    wr(r.userBase),
    wr(r.userQuote),
    wr(p.poolBaseTokenAccount),
    wr(p.poolQuoteTokenAccount),
    ro(p.protocolFeeRecipient),
    wr(associatedTokenAddress(p.protocolFeeRecipient, r.quoteMint, r.quoteTokenProgram)),
    ro(r.baseTokenProgram),
    ro(r.quoteTokenProgram),
    ro(SYSTEM_PROGRAM_ID),
    ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    ro(ammEventAuthority()),
    ro(PAMM_PROGRAM_ID),
    wr(associatedTokenAddress(vaultAuthority, r.quoteMint, r.quoteTokenProgram)),
    ro(vaultAuthority),
  ];
}

function remainingAccounts(p: PammSwapAccounts, r: Resolved, side: "buy" | "sell"): AccountMeta[] {
  const out: AccountMeta[] = [];
  if (p.isCashbackCoin) {
    const uva = ammUserVolumeAccumulatorPda(r.user);
    out.push(wr(associatedTokenAddress(uva, r.quoteMint, r.quoteTokenProgram)));
    if (side === "sell") out.push(wr(uva));
  }
  if (r.coinCreator !== DEFAULT_ADDRESS) out.push(ro(poolV2Pda(r.baseMint)));
  out.push(ro(p.buybackFeeRecipient));
  out.push(wr(associatedTokenAddress(p.buybackFeeRecipient, r.quoteMint, r.quoteTokenProgram)));
  return out;
}

function buyAccounts(p: PammSwapAccounts): AccountMeta[] {
  const r = resolve(p);
  return [
    ...commonAccounts(p, r),
    ro(ammGlobalVolumeAccumulatorPda()),
    wr(ammUserVolumeAccumulatorPda(r.user)),
    ro(ammFeeConfigPda()),
    ro(PUMP_FEES_PROGRAM_ID),
    ...remainingAccounts(p, r, "buy"),
  ];
}

export interface PammBuyParams extends PammSwapAccounts {
  baseAmountOut: bigint;
  maxQuoteAmountIn: bigint;
  trackVolume?: boolean;
}

/** pAMM buy (23 accounts + remaining). */
export function pammBuy(p: PammBuyParams): Instruction {
  return {
    programId: PAMM_PROGRAM_ID,
    accounts: buyAccounts(p),
    data: new ByteWriter()
      .bytes(PAMM_IX.buy)
      .u64(p.baseAmountOut)
      .u64(p.maxQuoteAmountIn)
      .bool(p.trackVolume ?? true)
      .toBytes(),
  };
}

export interface PammBuyExactQuoteInParams extends PammSwapAccounts {
  spendableQuoteIn: bigint;
  minBaseAmountOut: bigint;
  trackVolume?: boolean;
}

/** pAMM buy_exact_quote_in (same accounts as buy). */
export function pammBuyExactQuoteIn(p: PammBuyExactQuoteInParams): Instruction {
  return {
    programId: PAMM_PROGRAM_ID,
    accounts: buyAccounts(p),
    data: new ByteWriter()
      .bytes(PAMM_IX.buy_exact_quote_in)
      .u64(p.spendableQuoteIn)
      .u64(p.minBaseAmountOut)
      .bool(p.trackVolume ?? true)
      .toBytes(),
  };
}

export interface PammSellParams extends PammSwapAccounts {
  baseAmountIn: bigint;
  minQuoteAmountOut: bigint;
}

/** pAMM sell (21 accounts + remaining). */
export function pammSell(p: PammSellParams): Instruction {
  const r = resolve(p);
  return {
    programId: PAMM_PROGRAM_ID,
    accounts: [
      ...commonAccounts(p, r),
      ro(ammFeeConfigPda()),
      ro(PUMP_FEES_PROGRAM_ID),
      ...remainingAccounts(p, r, "sell"),
    ],
    data: new ByteWriter().bytes(PAMM_IX.sell).u64(p.baseAmountIn).u64(p.minQuoteAmountOut).toBytes(),
  };
}

/**
 * transfer_creator_fees_to_pump (v1, WSOL): no signer at all. Unwraps the AMM creator fees into the pump
 * creator vault as lamports (facts §6). Fails with 3012 when the AMM vault ATA does not exist (G3).
 */
export function pammTransferCreatorFeesToPump(p: { coinCreator: AddressLike }): Instruction {
  const authority = ammCreatorVaultAuthorityPda(p.coinCreator);
  return {
    programId: PAMM_PROGRAM_ID,
    accounts: [
      ro(WSOL_MINT),
      ro(TOKEN_PROGRAM_ID),
      ro(SYSTEM_PROGRAM_ID),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(p.coinCreator),
      wr(authority),
      wr(ammCreatorVaultAta(p.coinCreator)),
      wr(creatorVaultPda(p.coinCreator)),
      ro(ammEventAuthority()),
      ro(PAMM_PROGRAM_ID),
    ],
    data: Uint8Array.from(PAMM_IX.transfer_creator_fees_to_pump),
  };
}

/**
 * collect_coin_creator_fee: permissionless; pays the AMM creator fees into any token account the creator owns
 * (G12: this is the griefing path that MintDex sweep leg 3 recovers; localnet test L6 reproduces it).
 */
export function pammCollectCoinCreatorFee(p: {
  coinCreator: AddressLike;
  coinCreatorTokenAccount: AddressLike;
  quoteMint?: AddressLike;
  quoteTokenProgram?: AddressLike;
}): Instruction {
  const quoteMint = toAddress(p.quoteMint ?? WSOL_MINT);
  const quoteTokenProgram = toAddress(p.quoteTokenProgram ?? TOKEN_PROGRAM_ID);
  const authority = ammCreatorVaultAuthorityPda(p.coinCreator);
  return {
    programId: PAMM_PROGRAM_ID,
    accounts: [
      ro(quoteMint),
      ro(quoteTokenProgram),
      ro(p.coinCreator),
      ro(authority),
      wr(associatedTokenAddress(authority, quoteMint, quoteTokenProgram)),
      wr(p.coinCreatorTokenAccount),
      ro(ammEventAuthority()),
      ro(PAMM_PROGRAM_ID),
    ],
    data: Uint8Array.from(PAMM_IX.collect_coin_creator_fee),
  };
}

export function pammExtendAccount(p: { account: AddressLike; user: AddressLike }): Instruction {
  return {
    programId: PAMM_PROGRAM_ID,
    accounts: [wr(p.account), ws(p.user), ro(SYSTEM_PROGRAM_ID), ro(ammEventAuthority()), ro(PAMM_PROGRAM_ID)],
    data: Uint8Array.from(PAMM_IX.extend_account),
  };
}

// ---------------------------------------------------------------- composites (same lists as PUMP_AMM_SDK)

export interface PammSwapState {
  /** Pool account data length; `extend_account` is prepended below 300 bytes (or when the pool is missing). */
  poolDataLength: number | null;
  /** The user's base ATA exists and is owned by the base token program. */
  userBaseAccountExists: boolean;
  /** The user's quote ATA exists and is owned by the quote token program. */
  userQuoteAccountExists: boolean;
}

function withFixPool(p: PammSwapAccounts & PammSwapState, block: Instruction[]): Instruction[] {
  const needsExtend = p.poolDataLength === null || p.poolDataLength < POOL_ACCOUNT_NEW_SIZE;
  return needsExtend ? [pammExtendAccount({ account: p.pool, user: p.user }), ...block] : block;
}

/** `PUMP_AMM_SDK.buyInstructions(state, baseOut, maxQuoteIn)`: wraps SOL into the user's WSOL ATA and unwraps after. */
export function pammBuyInstructions(p: PammBuyParams & PammSwapState): Instruction[] {
  const r = resolve(p);
  const out: Instruction[] = [];
  const quoteIsWsol = r.quoteMint === WSOL_MINT;
  if (quoteIsWsol) {
    if (!p.userQuoteAccountExists)
      out.push(createAtaIdempotent(r.user, r.userQuote, r.user, WSOL_MINT, TOKEN_PROGRAM_ID));
    if (p.maxQuoteAmountIn > 0n) {
      out.push(systemTransfer(r.user, r.userQuote, p.maxQuoteAmountIn), syncNative(r.userQuote));
    }
  }
  if (!p.userBaseAccountExists)
    out.push(createAtaIdempotent(r.user, r.userBase, r.user, r.baseMint, r.baseTokenProgram));
  out.push(pammBuy(p));
  if (r.baseMint === WSOL_MINT) out.push(closeTokenAccount(r.userBase, r.user, r.user, TOKEN_PROGRAM_ID));
  if (quoteIsWsol) out.push(closeTokenAccount(r.userQuote, r.user, r.user, TOKEN_PROGRAM_ID));
  return withFixPool(p, out);
}

/** `PUMP_AMM_SDK.sellInstructions(state, baseIn, minQuoteOut)`: closes the user's WSOL ATA after to unwrap. */
export function pammSellInstructions(p: PammSellParams & PammSwapState): Instruction[] {
  const r = resolve(p);
  const out: Instruction[] = [];
  const baseIsWsol = r.baseMint === WSOL_MINT;
  if (baseIsWsol) {
    if (!p.userBaseAccountExists)
      out.push(createAtaIdempotent(r.user, r.userBase, r.user, WSOL_MINT, TOKEN_PROGRAM_ID));
    if (p.baseAmountIn > 0n) out.push(systemTransfer(r.user, r.userBase, p.baseAmountIn), syncNative(r.userBase));
  }
  if (!p.userQuoteAccountExists) {
    out.push(createAtaIdempotent(r.user, r.userQuote, r.user, r.quoteMint, r.quoteTokenProgram));
  }
  out.push(pammSell(p));
  if (r.quoteMint === WSOL_MINT) out.push(closeTokenAccount(r.userQuote, r.user, r.user, TOKEN_PROGRAM_ID));
  if (baseIsWsol) out.push(closeTokenAccount(r.userBase, r.user, r.user, TOKEN_PROGRAM_ID));
  return withFixPool(p, out);
}

// ---------------------------------------------------------------- decoding

const SWAP_COMMON = [
  "pool",
  "user",
  "globalConfig",
  "baseMint",
  "quoteMint",
  "userBaseTokenAccount",
  "userQuoteTokenAccount",
  "poolBaseTokenAccount",
  "poolQuoteTokenAccount",
  "protocolFeeRecipient",
  "protocolFeeRecipientTokenAccount",
  "baseTokenProgram",
  "quoteTokenProgram",
  "systemProgram",
  "associatedTokenProgram",
  "eventAuthority",
  "program",
  "coinCreatorVaultAta",
  "coinCreatorVaultAuthority",
] as const;

export const PAMM_ACCOUNT_NAMES = {
  buy: [...SWAP_COMMON, "globalVolumeAccumulator", "userVolumeAccumulator", "feeConfig", "feeProgram"],
  sell: [...SWAP_COMMON, "feeConfig", "feeProgram"],
  transfer_creator_fees_to_pump: [
    "wsolMint",
    "tokenProgram",
    "systemProgram",
    "associatedTokenProgram",
    "coinCreator",
    "coinCreatorVaultAuthority",
    "coinCreatorVaultAta",
    "pumpCreatorVault",
    "eventAuthority",
    "program",
  ],
  collect_coin_creator_fee: [
    "quoteMint",
    "quoteTokenProgram",
    "coinCreator",
    "coinCreatorVaultAuthority",
    "coinCreatorVaultAta",
    "coinCreatorTokenAccount",
    "eventAuthority",
    "program",
  ],
  extend_account: ["account", "user", "systemProgram", "eventAuthority", "program"],
} as const;

export type DecodedPammIx =
  | {
      name: "buy";
      args: { baseAmountOut: bigint; maxQuoteAmountIn: bigint; trackVolume: boolean | null };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "buy_exact_quote_in";
      args: { spendableQuoteIn: bigint; minBaseAmountOut: bigint; trackVolume: boolean | null };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "sell";
      args: { baseAmountIn: bigint; minQuoteAmountOut: bigint };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "transfer_creator_fees_to_pump" | "collect_coin_creator_fee" | "extend_account";
      args: Record<string, never>;
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    };

function named(ix: Instruction, names: readonly string[]) {
  if (ix.accounts.length < names.length) throw new Error(`expected at least ${names.length} accounts`);
  const accounts: Record<string, Address> = {};
  names.forEach((n, i) => (accounts[n] = ix.accounts[i].address));
  return { accounts, remaining: ix.accounts.slice(names.length) };
}

/** Decodes a pAMM instruction. Returns null for other programs or unknown discriminators. */
export function decodePammInstruction(ix: Instruction): DecodedPammIx | null {
  if (ix.programId !== PAMM_PROGRAM_ID || ix.data.length < 8) return null;
  const disc = ix.data.subarray(0, 8);
  const r = new ByteReader(ix.data, 8);
  const end = () => {
    if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes in instruction data`);
  };
  if (bytesEqual(disc, PAMM_IX.buy) || bytesEqual(disc, PAMM_IX.buy_exact_quote_in)) {
    const a = r.u64();
    const b = r.u64();
    const trackVolume = r.remaining > 0 ? r.bool() : null;
    end();
    const n = named(ix, PAMM_ACCOUNT_NAMES.buy);
    return bytesEqual(disc, PAMM_IX.buy)
      ? { name: "buy", args: { baseAmountOut: a, maxQuoteAmountIn: b, trackVolume }, ...n }
      : { name: "buy_exact_quote_in", args: { spendableQuoteIn: a, minBaseAmountOut: b, trackVolume }, ...n };
  }
  if (bytesEqual(disc, PAMM_IX.sell)) {
    const args = { baseAmountIn: r.u64(), minQuoteAmountOut: r.u64() };
    end();
    return { name: "sell", args, ...named(ix, PAMM_ACCOUNT_NAMES.sell) };
  }
  for (const name of ["transfer_creator_fees_to_pump", "collect_coin_creator_fee", "extend_account"] as const) {
    if (bytesEqual(disc, PAMM_IX[name])) {
      end();
      return { name, args: {}, ...named(ix, PAMM_ACCOUNT_NAMES[name]) };
    }
  }
  return null;
}
