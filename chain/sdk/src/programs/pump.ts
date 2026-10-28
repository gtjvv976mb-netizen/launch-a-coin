// Hand-encoded pump (bonding curve) instructions, byte-equal to @pump-fun/pump-sdk 2.0.0
// (test/pump.test.ts compares them with the SDK and with real devnet transactions).
// Account lists: refs/chain/pump-devnet-facts.md §6 and the pump IDL shipped with the SDK.
import { toAddress, toAddressBytes } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import { ByteReader, ByteWriter, bytesEqual } from "../bytes.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MAYHEM_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_FEES_PROGRAM_ID,
  PUMP_IX,
  PUMP_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  SYSVAR_RENT_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "../constants.ts";
import { ro, wr, ws } from "../instruction.ts";
import type { AccountMeta, Instruction } from "../instruction.ts";
import {
  ammEventAuthority,
  ammGlobalConfigPda,
  associatedTokenAddress,
  bondingCurvePda,
  bondingCurveV2Pda,
  boostVault,
  boostVaultAuthorityPda,
  canonicalPoolPda,
  cardVaultPda,
  creatorVaultPda,
  globalVolumeAccumulatorPda,
  lpMintPda,
  mayhemGlobalParamsPda,
  mayhemSolVaultPda,
  mayhemStatePda,
  mayhemTokenVault,
  poolAuthorityPda,
  pumpEventAuthority,
  pumpFeeConfigPda,
  pumpGlobalPda,
  pumpMintAuthorityPda,
  userVolumeAccumulatorPda,
} from "../pda.ts";
import { createAtaIdempotent } from "./system.ts";

// ---------------------------------------------------------------- create_v2

export interface PumpCreateV2Params {
  mint: AddressLike;
  user: AddressLike;
  name: string;
  symbol: string;
  uri: string;
  /** pump `creator` argument (never a signer). MintDex: the card vault PDA `["card", mint]`. */
  creator: AddressLike;
  isMayhemMode?: boolean;
  /** `OptionBool` newtype; create_v2 rejects true (6082). */
  isCashbackEnabled?: boolean;
  /** `OptionU64` newtype; 0 = pump's schedule. MintDex requires 0. */
  creatorFeeBps?: bigint;
  /** `OptionBool` newtype. MintDex requires false. */
  isHolderReward?: boolean;
}

/** create_v2 (16 accounts). SOL-quoted only: MintDex rejects other quotes (card-program-v2 §5.1). */
export function pumpCreateV2(p: PumpCreateV2Params): Instruction {
  const mint = toAddress(p.mint);
  const curve = bondingCurvePda(mint);
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: [
      ws(mint),
      ro(pumpMintAuthorityPda()),
      wr(curve),
      wr(associatedTokenAddress(curve, mint, TOKEN_2022_PROGRAM_ID)),
      ro(pumpGlobalPda()),
      ws(p.user),
      ro(SYSTEM_PROGRAM_ID),
      ro(TOKEN_2022_PROGRAM_ID),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      wr(MAYHEM_PROGRAM_ID),
      ro(mayhemGlobalParamsPda()),
      wr(mayhemSolVaultPda()),
      wr(mayhemStatePda(mint)),
      wr(mayhemTokenVault(mint)),
      ro(pumpEventAuthority()),
      ro(PUMP_PROGRAM_ID),
    ],
    data: new ByteWriter()
      .bytes(PUMP_IX.create_v2)
      .string(p.name)
      .string(p.symbol)
      .string(p.uri)
      .bytes(toAddressBytes(p.creator))
      .bool(p.isMayhemMode ?? false)
      .bool(p.isCashbackEnabled ?? false)
      .u64(p.creatorFeeBps ?? 0n)
      .bool(p.isHolderReward ?? false)
      .toBytes(),
  };
}

/**
 * The 11 bytes MintDex always sends after `creator` in create_v2 (refs/mainnet/design-compat.md §3, O3):
 * is_mayhem_mode 0, is_cashback_enabled 0, creator_fee_bps 0 (u64 LE), is_holder_reward 0. Checked against mainnet
 * pump (deploy slot 452,654,932) on 2026-10-06 and again after the redeploy (deploy slot 454,596,459, 166 B curves)
 * on 2026-10-08: live creates with exactly this tail got a curve with every flag 0 and the requested creator
 * (chain/sdk/test/fixtures/mainnet/create_v2_tails.json), and a read-only simulation of mintdexCreateV2 did too
 * (chain/scripts/mainnet/03-launch-cost.out.json, 02-pump-compat.out.json C7).
 */
export const MINTDEX_CREATE_V2_TAIL: Uint8Array = new Uint8Array(11);

/** The bytes after `creator` in create_v2 instruction data; null when `data` is not a well-formed create_v2 prefix. */
export function createV2Tail(data: Uint8Array): Uint8Array | null {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), PUMP_IX.create_v2)) return null;
  try {
    const r = new ByteReader(data, 8);
    r.string();
    r.string();
    r.string();
    r.bytes(32);
    return data.subarray(data.length - r.remaining);
  } catch {
    return null;
  }
}

export interface MintdexCreateV2Params {
  mint: AddressLike;
  /** The launcher (payer, signer). */
  user: AddressLike;
  name: string;
  symbol: string;
  uri: string;
  /** MintDex program id the card vault is derived under (default: the devnet/mainnet id 4HTSBY…). */
  programId?: AddressLike;
}

/**
 * The only create_v2 a MintDex launch may contain (O3): creator = the card vault PDA ["card", mint], and no flag
 * parameters at all, so the tail is always MINTDEX_CREATE_V2_TAIL. Byte-identical to
 * `pumpCreateV2({ ..., creator: cardVaultPda(mint) })` with every flag left at its default. Throws if the encoded
 * tail ever differs (a guard against a future edit of pumpCreateV2's defaults).
 */
export function mintdexCreateV2(p: MintdexCreateV2Params): Instruction {
  const mint = toAddress(p.mint);
  const ix = pumpCreateV2({
    mint,
    user: p.user,
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    creator: p.programId ? cardVaultPda(mint, p.programId) : cardVaultPda(mint),
  });
  const tail = createV2Tail(ix.data);
  if (!tail || !bytesEqual(tail, MINTDEX_CREATE_V2_TAIL)) {
    throw new Error("mintdexCreateV2: the create_v2 flag tail is not the pinned 11 zero bytes");
  }
  return ix;
}

// ---------------------------------------------------------------- buy / sell

interface PumpTradeAccounts {
  mint: AddressLike;
  user: AddressLike;
  /** The curve's `creator` (selects `creator_vault`). MintDex coins: the card vault. */
  creator: AddressLike;
  /** One of `Global.fee_recipient` + `Global.fee_recipients` (pump checks it). */
  feeRecipient: AddressLike;
  /** One of `Global.buyback_fee_recipients` (remaining account, writable). */
  buybackFeeRecipient: AddressLike;
  /** Token-2022 for create_v2 coins (the default); SPL Token for legacy coins. */
  tokenProgram?: AddressLike;
  /** Defaults to ATA(user, mint, tokenProgram). */
  associatedUser?: AddressLike;
}

export interface PumpBuyParams extends PumpTradeAccounts {
  /** Exact tokens out (base units). */
  amount: bigint;
  /** Lamport ceiling, fees included. */
  maxSolCost: bigint;
  trackVolume?: boolean;
}

function buyAccounts(p: PumpTradeAccounts): AccountMeta[] {
  const mint = toAddress(p.mint);
  const tokenProgram = toAddress(p.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
  const curve = bondingCurvePda(mint);
  return [
    ro(pumpGlobalPda()),
    wr(p.feeRecipient),
    ro(mint),
    wr(curve),
    wr(associatedTokenAddress(curve, mint, tokenProgram)),
    wr(p.associatedUser ?? associatedTokenAddress(p.user, mint, tokenProgram)),
    ws(p.user),
    ro(SYSTEM_PROGRAM_ID),
    ro(tokenProgram),
    wr(creatorVaultPda(p.creator)),
    ro(pumpEventAuthority()),
    ro(PUMP_PROGRAM_ID),
    ro(globalVolumeAccumulatorPda()),
    wr(userVolumeAccumulatorPda(p.user)),
    ro(pumpFeeConfigPda()),
    ro(PUMP_FEES_PROGRAM_ID),
    ro(bondingCurveV2Pda(mint)),
    wr(p.buybackFeeRecipient),
  ];
}

/** buy (16 accounts + [bonding-curve-v2 (ro), buyback fee recipient (w)]). */
export function pumpBuy(p: PumpBuyParams): Instruction {
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: buyAccounts(p),
    data: new ByteWriter()
      .bytes(PUMP_IX.buy)
      .u64(p.amount)
      .u64(p.maxSolCost)
      .bool(p.trackVolume ?? true)
      .toBytes(),
  };
}

export interface PumpBuyExactSolInParams extends PumpTradeAccounts {
  spendableSolIn: bigint;
  minTokensOut: bigint;
  trackVolume?: boolean;
}

/** buy_exact_sol_in (IDL-ONLY on devnet: never sent in the facts run). Same accounts as buy. */
export function pumpBuyExactSolIn(p: PumpBuyExactSolInParams): Instruction {
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: buyAccounts(p),
    data: new ByteWriter()
      .bytes(PUMP_IX.buy_exact_sol_in)
      .u64(p.spendableSolIn)
      .u64(p.minTokensOut)
      .bool(p.trackVolume ?? true)
      .toBytes(),
  };
}

export interface PumpSellParams extends PumpTradeAccounts {
  amount: bigint;
  minSolOutput: bigint;
  /** Cashback coins put the user volume accumulator first in the remaining accounts. MintDex rejects them. */
  cashback?: boolean;
}

/** sell (14 accounts + [(user volume accumulator), bonding-curve-v2 (ro), buyback fee recipient (w)]). */
export function pumpSell(p: PumpSellParams): Instruction {
  const mint = toAddress(p.mint);
  const tokenProgram = toAddress(p.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
  const curve = bondingCurvePda(mint);
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: [
      ro(pumpGlobalPda()),
      wr(p.feeRecipient),
      ro(mint),
      wr(curve),
      wr(associatedTokenAddress(curve, mint, tokenProgram)),
      wr(p.associatedUser ?? associatedTokenAddress(p.user, mint, tokenProgram)),
      ws(p.user),
      ro(SYSTEM_PROGRAM_ID),
      wr(creatorVaultPda(p.creator)),
      ro(tokenProgram),
      ro(pumpEventAuthority()),
      ro(PUMP_PROGRAM_ID),
      ro(pumpFeeConfigPda()),
      ro(PUMP_FEES_PROGRAM_ID),
      ...(p.cashback ? [wr(userVolumeAccumulatorPda(p.user))] : []),
      ro(bondingCurveV2Pda(mint)),
      wr(p.buybackFeeRecipient),
    ],
    data: new ByteWriter().bytes(PUMP_IX.sell).u64(p.amount).u64(p.minSolOutput).toBytes(),
  };
}

// ---------------------------------------------------------------- fees, migrate, extend

/** collect_creator_fee: permissionless, the creator does not sign (facts §6). */
export function pumpCollectCreatorFee(p: { creator: AddressLike }): Instruction {
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: [
      wr(p.creator),
      wr(creatorVaultPda(p.creator)),
      ro(SYSTEM_PROGRAM_ID),
      ro(pumpEventAuthority()),
      ro(PUMP_PROGRAM_ID),
    ],
    data: Uint8Array.from(PUMP_IX.collect_creator_fee),
  };
}

export interface PumpMigrateParams {
  mint: AddressLike;
  /** Any signer; pays about 1.49M lamports (facts §10). */
  user: AddressLike;
  /** `Global.withdraw_authority` (writable, not a signer). */
  withdrawAuthority: AddressLike;
  /** Coin token program; Token-2022 for create_v2 coins. */
  tokenProgram?: AddressLike;
}

/** migrate (25 accounts + [boost vault authority (ro), boost vault (w)]); permissionless. */
export function pumpMigrate(p: PumpMigrateParams): Instruction {
  const mint = toAddress(p.mint);
  const tokenProgram = toAddress(p.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
  const curve = bondingCurvePda(mint);
  const poolAuthority = poolAuthorityPda(mint);
  const pool = canonicalPoolPda(mint);
  const lpMint = lpMintPda(pool);
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: [
      ro(pumpGlobalPda()),
      wr(p.withdrawAuthority),
      ro(mint),
      wr(curve),
      wr(associatedTokenAddress(curve, mint, tokenProgram)),
      ws(p.user),
      ro(SYSTEM_PROGRAM_ID),
      ro(TOKEN_PROGRAM_ID),
      ro(PAMM_PROGRAM_ID),
      wr(pool),
      wr(poolAuthority),
      wr(associatedTokenAddress(poolAuthority, mint, tokenProgram)),
      wr(associatedTokenAddress(poolAuthority, WSOL_MINT, TOKEN_PROGRAM_ID)),
      ro(ammGlobalConfigPda()),
      ro(WSOL_MINT),
      wr(lpMint),
      wr(associatedTokenAddress(poolAuthority, lpMint, TOKEN_2022_PROGRAM_ID)),
      wr(associatedTokenAddress(pool, mint, tokenProgram)),
      wr(associatedTokenAddress(pool, WSOL_MINT, TOKEN_PROGRAM_ID)),
      ro(TOKEN_2022_PROGRAM_ID),
      ro(ASSOCIATED_TOKEN_PROGRAM_ID),
      ro(ammEventAuthority()),
      ro(pumpEventAuthority()),
      ro(PUMP_PROGRAM_ID),
      ro(SYSVAR_RENT_ID),
      ro(boostVaultAuthorityPda(pool)),
      wr(boostVault(pool)),
    ],
    data: Uint8Array.from(PUMP_IX.migrate),
  };
}

export function pumpExtendAccount(p: { account: AddressLike; user: AddressLike }): Instruction {
  return {
    programId: PUMP_PROGRAM_ID,
    accounts: [wr(p.account), ws(p.user), ro(SYSTEM_PROGRAM_ID), ro(pumpEventAuthority()), ro(PUMP_PROGRAM_ID)],
    data: Uint8Array.from(PUMP_IX.extend_account),
  };
}

// ---------------------------------------------------------------- composites (same lists as the SDK)

/** pump-sdk slippage: `sol + sol × floor(slippage% × 10) / 1000` (buy ceiling). */
export const slippageUp = (sol: bigint, slippagePct: number): bigint =>
  sol + (sol * BigInt(Math.floor(slippagePct * 10))) / 1000n;
/** pump-sdk slippage: `sol − sol × floor(slippage% × 10) / 1000` (sell floor). */
export const slippageDown = (sol: bigint, slippagePct: number): bigint =>
  sol - (sol * BigInt(Math.floor(slippagePct * 10))) / 1000n;

/** `PUMP_SDK.buyInstructions`: [ATA create (when the user's ATA is missing), buy]. */
export function pumpBuyInstructions(p: PumpBuyParams & { userAtaExists: boolean }): Instruction[] {
  const mint = toAddress(p.mint);
  const tokenProgram = toAddress(p.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
  const ata = toAddress(p.associatedUser ?? associatedTokenAddress(p.user, mint, tokenProgram));
  const out: Instruction[] = [];
  if (!p.userAtaExists) out.push(createAtaIdempotent(p.user, ata, p.user, mint, tokenProgram));
  out.push(pumpBuy({ ...p, associatedUser: ata }));
  return out;
}

/** `PUMP_SDK.createV2AndBuyInstructions` (SOL quote, no agent): [create_v2, ATA create, buy]. */
export function pumpCreateV2AndBuyInstructions(
  p: PumpCreateV2Params & Omit<PumpBuyParams, "creator" | "tokenProgram" | "associatedUser">
): Instruction[] {
  const mint = toAddress(p.mint);
  const ata = associatedTokenAddress(p.user, mint, TOKEN_2022_PROGRAM_ID);
  return [
    pumpCreateV2(p),
    createAtaIdempotent(p.user, ata, p.user, mint, TOKEN_2022_PROGRAM_ID),
    pumpBuy({ ...p, creator: p.creator, tokenProgram: TOKEN_2022_PROGRAM_ID, associatedUser: ata }),
  ];
}

// ---------------------------------------------------------------- decoding

export const PUMP_ACCOUNT_NAMES = {
  create_v2: [
    "mint",
    "mintAuthority",
    "bondingCurve",
    "associatedBondingCurve",
    "global",
    "user",
    "systemProgram",
    "tokenProgram",
    "associatedTokenProgram",
    "mayhemProgram",
    "globalParams",
    "solVault",
    "mayhemState",
    "mayhemTokenVault",
    "eventAuthority",
    "program",
  ],
  buy: [
    "global",
    "feeRecipient",
    "mint",
    "bondingCurve",
    "associatedBondingCurve",
    "associatedUser",
    "user",
    "systemProgram",
    "tokenProgram",
    "creatorVault",
    "eventAuthority",
    "program",
    "globalVolumeAccumulator",
    "userVolumeAccumulator",
    "feeConfig",
    "feeProgram",
  ],
  sell: [
    "global",
    "feeRecipient",
    "mint",
    "bondingCurve",
    "associatedBondingCurve",
    "associatedUser",
    "user",
    "systemProgram",
    "creatorVault",
    "tokenProgram",
    "eventAuthority",
    "program",
    "feeConfig",
    "feeProgram",
  ],
  collect_creator_fee: ["creator", "creatorVault", "systemProgram", "eventAuthority", "program"],
  migrate: [
    "global",
    "withdrawAuthority",
    "mint",
    "bondingCurve",
    "associatedBondingCurve",
    "user",
    "systemProgram",
    "tokenProgram",
    "pumpAmm",
    "pool",
    "poolAuthority",
    "poolAuthorityMintAccount",
    "poolAuthorityWsolAccount",
    "ammGlobalConfig",
    "wsolMint",
    "lpMint",
    "userPoolTokenAccount",
    "poolBaseTokenAccount",
    "poolQuoteTokenAccount",
    "token2022Program",
    "associatedTokenProgram",
    "pumpAmmEventAuthority",
    "eventAuthority",
    "program",
    "rent",
  ],
  extend_account: ["account", "user", "systemProgram", "eventAuthority", "program"],
} as const;

export type DecodedPumpIx =
  | {
      name: "create_v2";
      args: {
        name: string;
        symbol: string;
        uri: string;
        creator: Address;
        isMayhemMode: boolean;
        isCashbackEnabled: boolean;
        creatorFeeBps: bigint;
        isHolderReward: boolean;
      };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "buy";
      args: { amount: bigint; maxSolCost: bigint; trackVolume: boolean | null };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "buy_exact_sol_in";
      args: { spendableSolIn: bigint; minTokensOut: bigint; trackVolume: boolean | null };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "sell";
      args: { amount: bigint; minSolOutput: bigint };
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    }
  | {
      name: "collect_creator_fee" | "migrate" | "extend_account";
      args: Record<string, never>;
      accounts: Record<string, Address>;
      remaining: AccountMeta[];
    };

function nameAccounts(ix: Instruction, names: readonly string[]) {
  if (ix.accounts.length < names.length) throw new Error(`expected at least ${names.length} accounts`);
  const accounts: Record<string, Address> = {};
  names.forEach((n, i) => (accounts[n] = ix.accounts[i].address));
  return { accounts, remaining: ix.accounts.slice(names.length) };
}

function expectEnd(r: ByteReader) {
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes in instruction data`);
}

/** Decodes a pump instruction (args + named accounts). Returns null for other programs or unknown discriminators. */
export function decodePumpInstruction(ix: Instruction): DecodedPumpIx | null {
  if (ix.programId !== PUMP_PROGRAM_ID || ix.data.length < 8) return null;
  const disc = ix.data.subarray(0, 8);
  const r = new ByteReader(ix.data, 8);
  if (bytesEqual(disc, PUMP_IX.create_v2)) {
    const args = {
      name: r.string(),
      symbol: r.string(),
      uri: r.string(),
      creator: toAddress(r.bytes(32)),
      isMayhemMode: r.bool(),
      isCashbackEnabled: r.bool(),
      creatorFeeBps: r.u64(),
      isHolderReward: r.bool(),
    };
    expectEnd(r);
    return { name: "create_v2", args, ...nameAccounts(ix, PUMP_ACCOUNT_NAMES.create_v2) };
  }
  if (bytesEqual(disc, PUMP_IX.buy) || bytesEqual(disc, PUMP_IX.buy_exact_sol_in)) {
    const a = r.u64();
    const b = r.u64();
    const trackVolume = r.remaining > 0 ? r.bool() : null;
    expectEnd(r);
    const named = nameAccounts(ix, PUMP_ACCOUNT_NAMES.buy);
    return bytesEqual(disc, PUMP_IX.buy)
      ? { name: "buy", args: { amount: a, maxSolCost: b, trackVolume }, ...named }
      : { name: "buy_exact_sol_in", args: { spendableSolIn: a, minTokensOut: b, trackVolume }, ...named };
  }
  if (bytesEqual(disc, PUMP_IX.sell)) {
    const args = { amount: r.u64(), minSolOutput: r.u64() };
    expectEnd(r);
    return { name: "sell", args, ...nameAccounts(ix, PUMP_ACCOUNT_NAMES.sell) };
  }
  for (const name of ["collect_creator_fee", "migrate", "extend_account"] as const) {
    if (bytesEqual(disc, PUMP_IX[name])) {
      expectEnd(r);
      return { name, args: {}, ...nameAccounts(ix, PUMP_ACCOUNT_NAMES[name]) };
    }
  }
  return null;
}
