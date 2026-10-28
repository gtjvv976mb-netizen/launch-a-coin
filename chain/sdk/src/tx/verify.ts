// Transaction verifier (card-program-v2 R21, devnet-plan M3 "tx verifier", acceptance C8).
//
// The browser calls verifyTransaction() on the serialized transaction the chain Worker returns, with an
// intent built from what the user typed (not from the Worker's summary), before it asks the wallet to sign.
// Rules (fail closed):
//   1. The bytes decode strictly; every lookup table is supplied by the caller and resolves. The caller must
//      fetch ALT contents itself from an RPC it trusts (not through the chain Worker, which is the party being
//      checked) and should pass `allowedLookupTables` = the MintDex ALTs A and B. Lookup tables are append-only,
//      so a resolved index cannot change between verification and execution.
//   2. Fee payer and the exact signer set match the intent. Programs are on the allowlist.
//   3. Only SetComputeUnitLimit / SetComputeUnitPrice may precede the payload, within the configured limits.
//   4. The payload matches the intent's template instruction by instruction: program id, every account
//      address and every data byte are rebuilt from the intent with this SDK's encoders and compared.
//      Variable slots are allowed only where they cannot hurt the user: pump fee recipients from the known
//      set, and trade amounts inside the user's bounds.
//   5. The message-level signer/writable flag of every account equals the flags the expected instructions
//      need (no extra writable or signer accounts, no unreferenced accounts).
import { toAddress } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  MINTDEX_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "../constants.ts";
import { bytesEqual, toHex } from "../bytes.ts";
import type { Instruction } from "../instruction.ts";
import { associatedTokenAddress, canonicalPoolPda, cardVaultPda } from "../pda.ts";
import { decodePammInstruction, pammBuy, pammExtendAccount, pammSell } from "../programs/pamm.ts";
import { decodePumpInstruction, mintdexCreateV2, pumpBuy, pumpSell } from "../programs/pump.ts";
import {
  closeTokenAccount,
  createAtaIdempotent,
  decodeComputeBudget,
  decodeSystemTransfer,
  syncNative,
  systemTransfer,
} from "../programs/system.ts";
import { allowedCardStandards, registerIxFor } from "../mintdex/instructions.ts";
import type { CardStandard } from "../mintdex/instructions.ts";
import { decodeTransaction, resolveTransaction, signatureStatuses } from "./wire.ts";
import type { LookupTableContents, ResolvedTransaction } from "./wire.ts";

export const ALLOWED_PROGRAMS: readonly Address[] = [
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PAMM_PROGRAM_ID,
  MINTDEX_PROGRAM_ID,
];

export interface VerifyOptions {
  /** Contents of every lookup table the tx references, fetched by the client itself. */
  lookupTables?: LookupTableContents;
  /** When set, every lookup table the tx uses must be one of these (the MintDex ALTs A and B). */
  allowedLookupTables?: readonly AddressLike[];
  /** Default 1,400,000. */
  maxComputeUnitLimit?: number;
  /** Default 10,000,000 µlamports per CU. */
  maxComputeUnitPriceMicroLamports?: bigint;
  /** Cap on limit × price / 1e6. Default 5,000,000 lamports (0.005 SOL). */
  maxPriorityFeeLamports?: bigint;
  /**
   * pump `Global` fee recipients (fee_recipient + fee_recipients) and buyback recipients: **required** for every intent
   * with a pump trade (launch with a dev buy, pump_buy, pump_sell). Pass the live Global, or the cluster profile's
   * constants (`ClusterProfile.pumpFeeRecipients`); there is no silent devnet default (compat §6.2).
   */
  pumpFeeRecipients?: readonly AddressLike[];
  pumpBuybackFeeRecipients?: readonly AddressLike[];
  /**
   * The live `Config.register_flags` (F9): a launch template whose card standard the Config disables is refused
   * (bit0: no register_card; bit1: register_card_metaplex must carry the collection).
   */
  registerFlags?: number;
  /** pAMM `GlobalConfig.protocol_fee_recipients`; required for PumpSwap intents. */
  pammProtocolFeeRecipients?: readonly AddressLike[];
  /** pAMM `GlobalConfig.buyback_fee_recipients`; required for PumpSwap intents. */
  pammBuybackFeeRecipients?: readonly AddressLike[];
  /** Signers whose signature must already be present and valid (e.g. the vanity mint, server-first launch). */
  requirePresignedBy?: readonly AddressLike[];
  /**
   * Wallet guard programs (e.g. transaction guards some wallets append after the payload; m3-contract §3.5 finalize
   * step 4, §7.1). Default empty: today's strict behaviour. When set, trailing instructions of these programs are
   * accepted only after the whole payload, and only when every account they reference is read-only and not a signer
   * at the message level (so they cannot move funds or change state). A listed program that is also an allowed
   * payload program (ComputeBudget, System, Token, pump, MintDex, ...) is ignored, so the list can never excuse a
   * payload instruction.
   */
  guardPrograms?: readonly AddressLike[];
}

export type TxIntent =
  | {
      kind: "launch";
      payer: AddressLike;
      mint: AddressLike;
      /** Exactly the trimmed values the user approved (name ≤ 32 bytes, symbol ≤ 10). */
      name: string;
      symbol: string;
      /** The bound coin URI `https://mintdex.fun/m/{mint}.json`. */
      uri: string;
      /** `config.treasury` (from the Config account, not from the Worker). */
      treasury: AddressLike;
      devBuy: null | { minTokens: bigint; maxSolCost: bigint };
      /**
       * The card NFT the client asked for: "metaplex" = register_card_metaplex (Metaplex metadata + master edition,
       * card-program-v2 §18.17; Metaplex runs only by CPI, so it is not a top-level allowed program), default
       * "token2022" = the original register_card.
       */
      cardStandard?: CardStandard;
    }
  | {
      kind: "pump_buy";
      user: AddressLike;
      mint: AddressLike;
      /** The curve's creator (MintDex coins: the card vault; read it from the curve). */
      creator: AddressLike;
      minTokens: bigint;
      maxSolCost: bigint;
      tokenProgram?: AddressLike;
    }
  | {
      kind: "pump_sell";
      user: AddressLike;
      mint: AddressLike;
      creator: AddressLike;
      amount: bigint;
      minSolOutput: bigint;
      tokenProgram?: AddressLike;
    }
  | {
      kind: "pamm_buy";
      user: AddressLike;
      mint: AddressLike;
      /** From the pool account: pool_base_token_account, pool_quote_token_account, coin_creator. */
      poolBaseTokenAccount: AddressLike;
      poolQuoteTokenAccount: AddressLike;
      coinCreator: AddressLike;
      minBaseOut: bigint;
      maxQuoteIn: bigint;
    }
  | {
      kind: "pamm_sell";
      user: AddressLike;
      mint: AddressLike;
      poolBaseTokenAccount: AddressLike;
      poolQuoteTokenAccount: AddressLike;
      coinCreator: AddressLike;
      baseAmountIn: bigint;
      minQuoteOut: bigint;
    }
  | {
      /**
       * Any MintDex flow (withdraw, collect, bids, accept, list, delist, buy now, cancel + buy now): the client
       * builds `expected` itself with this SDK's builders from what the user chose; the tx must equal it.
       */
      kind: "exact";
      payer: AddressLike;
      expected: Instruction[];
    };

export interface TxSummary {
  feePayer: Address | null;
  signers: Address[];
  programs: Address[];
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: bigint | null;
  priorityFeeLamports: bigint;
  /** Upper bound of lamports the payload can take from the fee payer (system transfers + trade ceilings). */
  maxPayerSpendLamports: bigint;
  byteLength: number;
}

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  tx: ResolvedTransaction | null;
  summary: TxSummary;
}

class Reject extends Error {}

const DEFAULTS = {
  maxComputeUnitLimit: 1_400_000,
  maxComputeUnitPriceMicroLamports: 10_000_000n,
  maxPriorityFeeLamports: 5_000_000n,
};

/** A template step: returns the expected instruction for `actual`, or throws Reject with the reason. */
type Step = { label: string; optional?: boolean; match: (actual: Instruction) => Instruction };

function exactStep(label: string, expected: Instruction, optional = false): Step {
  return {
    label,
    optional,
    match: (actual) => {
      sameShape(label, actual, expected);
      return expected;
    },
  };
}

/** Same program id, account addresses (in order) and data bytes. Flags are checked at message level. */
function sameShape(label: string, actual: Instruction, expected: Instruction) {
  if (actual.programId !== expected.programId) {
    throw new Reject(`${label}: program ${actual.programId}, expected ${expected.programId}`);
  }
  if (actual.accounts.length !== expected.accounts.length) {
    throw new Reject(`${label}: ${actual.accounts.length} accounts, expected ${expected.accounts.length}`);
  }
  actual.accounts.forEach((a, i) => {
    if (a.address !== expected.accounts[i].address) {
      throw new Reject(`${label}: account #${i} is ${a.address}, expected ${expected.accounts[i].address}`);
    }
  });
  if (!bytesEqual(actual.data, expected.data)) {
    throw new Reject(`${label}: data ${toHex(actual.data)} differs from expected ${toHex(expected.data)}`);
  }
}

const inSet = (set: readonly AddressLike[], a: Address) => set.some((x) => toAddress(x) === a);

/**
 * Walks the payload through the steps in order. An optional step that does not match the current instruction
 * exactly is skipped, and that instruction must then match the next step; a required step that does not match
 * rejects. Every instruction must be consumed by exactly one step, so nothing can be added, dropped or reordered.
 */
function runTemplate(payload: Instruction[], steps: Step[]): Instruction[] {
  const expected: Instruction[] = [];
  let i = 0;
  for (const step of steps) {
    const actual = payload[i];
    if (!actual) {
      if (step.optional) continue;
      throw new Reject(`missing instruction: ${step.label}`);
    }
    if (step.optional) {
      let probe: Instruction | null = null;
      try {
        probe = step.match(actual);
      } catch {
        probe = null;
      }
      if (!probe) continue;
      expected.push(probe);
      i++;
      continue;
    }
    expected.push(step.match(actual));
    i++;
  }
  if (i !== payload.length) throw new Reject(`unexpected extra instruction #${i} (program ${payload[i].programId})`);
  return expected;
}

function pumpBuyStep(p: {
  user: Address;
  mint: Address;
  creator: Address;
  tokenProgram: Address;
  minTokens: bigint;
  maxSolCost: bigint;
  feeRecipients: readonly AddressLike[];
  buybackRecipients: readonly AddressLike[];
}): Step {
  return {
    label: "pump buy",
    match: (actual) => {
      const d = decodePumpInstruction(actual);
      if (!d || d.name !== "buy") throw new Reject("pump buy: not a pump buy instruction");
      const feeRecipient = d.accounts.feeRecipient;
      const buyback = d.remaining[1]?.address;
      if (!inSet(p.feeRecipients, feeRecipient)) throw new Reject(`pump buy: unknown fee recipient ${feeRecipient}`);
      if (!buyback || !inSet(p.buybackRecipients, buyback))
        throw new Reject(`pump buy: unknown buyback recipient ${buyback}`);
      if (d.args.amount < p.minTokens)
        throw new Reject(`pump buy: ${d.args.amount} tokens < approved minimum ${p.minTokens}`);
      if (d.args.maxSolCost > p.maxSolCost) {
        throw new Reject(`pump buy: max_sol_cost ${d.args.maxSolCost} > approved ${p.maxSolCost}`);
      }
      if (d.args.trackVolume !== true) throw new Reject("pump buy: track_volume must be set");
      const expected = pumpBuy({
        mint: p.mint,
        user: p.user,
        creator: p.creator,
        tokenProgram: p.tokenProgram,
        feeRecipient,
        buybackFeeRecipient: buyback,
        amount: d.args.amount,
        maxSolCost: d.args.maxSolCost,
      });
      sameShape("pump buy", actual, expected);
      return expected;
    },
  };
}

function pammRecipients(opts: VerifyOptions) {
  if (!opts.pammProtocolFeeRecipients?.length || !opts.pammBuybackFeeRecipients?.length) {
    throw new Reject(
      "PumpSwap intent needs pammProtocolFeeRecipients and pammBuybackFeeRecipients (from GlobalConfig)"
    );
  }
  return { protocol: opts.pammProtocolFeeRecipients, buyback: opts.pammBuybackFeeRecipients };
}

function pammSwapRecipients(label: string, actual: Instruction, opts: VerifyOptions) {
  const d = decodePammInstruction(actual);
  if (!d) throw new Reject(`${label}: not a PumpSwap instruction`);
  const sets = pammRecipients(opts);
  const protocol = d.accounts.protocolFeeRecipient;
  if (!inSet(sets.protocol, protocol)) throw new Reject(`${label}: unknown protocol fee recipient ${protocol}`);
  // remaining = [pool-v2 (when coin_creator is set)], buyback, buyback ATA
  const buyback = d.remaining[d.remaining.length - 2]?.address;
  if (!buyback || !inSet(sets.buyback, buyback)) throw new Reject(`${label}: unknown buyback recipient ${buyback}`);
  return { d, protocol, buyback };
}

/** The pump recipient sets of a pump template (fail closed without them: compat §6.2). */
function pumpRecipients(opts: VerifyOptions): { fees: readonly AddressLike[]; buyback: readonly AddressLike[] } {
  if (!opts.pumpFeeRecipients?.length || !opts.pumpBuybackFeeRecipients?.length) {
    throw new Reject("pump fee recipients are required (pass the live pump Global or the cluster profile's recipients)");
  }
  return { fees: opts.pumpFeeRecipients, buyback: opts.pumpBuybackFeeRecipients };
}

const STANDARD_LABEL: Record<CardStandard, string> = {
  token2022: "MintDex register_card",
  metaplex: "MintDex register_card_metaplex",
  "metaplex-collection": "MintDex register_card_metaplex (collection)",
};

function templateFor(intent: TxIntent, opts: VerifyOptions): { steps: Step[]; payer: Address; signers: Address[] } {
  switch (intent.kind) {
    case "launch": {
      const payer = toAddress(intent.payer);
      const mint = toAddress(intent.mint);
      const vault = cardVaultPda(mint);
      const standard: CardStandard = intent.cardStandard ?? "token2022";
      if (opts.registerFlags !== undefined && !allowedCardStandards(opts.registerFlags).includes(standard)) {
        throw new Reject(`card standard ${standard} is disabled by the Config (register_flags ${opts.registerFlags})`);
      }
      const steps: Step[] = [
        // O3: the only create_v2 accepted is MintDex's own (creator = card vault, the pinned 11-byte zero flag tail),
        // compared byte for byte, so a template with any pump flag set or a shorter tail is refused here
        exactStep(
          "pump create_v2",
          mintdexCreateV2({ mint, user: payer, name: intent.name, symbol: intent.symbol, uri: intent.uri })
        ),
        exactStep(STANDARD_LABEL[standard], registerIxFor(standard, { launcher: payer, mint, treasury: intent.treasury })),
      ];
      if (intent.devBuy) {
        const r = pumpRecipients(opts);
        const ata = associatedTokenAddress(payer, mint, TOKEN_2022_PROGRAM_ID);
        steps.push(exactStep("create coin ATA", createAtaIdempotent(payer, ata, payer, mint, TOKEN_2022_PROGRAM_ID)));
        steps.push(
          pumpBuyStep({
            user: payer,
            mint,
            creator: vault,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            minTokens: intent.devBuy.minTokens,
            maxSolCost: intent.devBuy.maxSolCost,
            feeRecipients: r.fees,
            buybackRecipients: r.buyback,
          })
        );
      }
      return { steps, payer, signers: [payer, mint] };
    }
    case "pump_buy": {
      const r = pumpRecipients(opts);
      const user = toAddress(intent.user);
      const mint = toAddress(intent.mint);
      const tokenProgram = toAddress(intent.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
      const ata = associatedTokenAddress(user, mint, tokenProgram);
      return {
        payer: user,
        signers: [user],
        steps: [
          exactStep("create coin ATA", createAtaIdempotent(user, ata, user, mint, tokenProgram), true),
          pumpBuyStep({
            user,
            mint,
            creator: toAddress(intent.creator),
            tokenProgram,
            minTokens: intent.minTokens,
            maxSolCost: intent.maxSolCost,
            feeRecipients: r.fees,
            buybackRecipients: r.buyback,
          }),
        ],
      };
    }
    case "pump_sell": {
      const { fees: pumpFees, buyback: pumpBuyback } = pumpRecipients(opts);
      const user = toAddress(intent.user);
      const mint = toAddress(intent.mint);
      const tokenProgram = toAddress(intent.tokenProgram ?? TOKEN_2022_PROGRAM_ID);
      const step: Step = {
        label: "pump sell",
        match: (actual) => {
          const d = decodePumpInstruction(actual);
          if (!d || d.name !== "sell") throw new Reject("pump sell: not a pump sell instruction");
          const feeRecipient = d.accounts.feeRecipient;
          const buyback = d.remaining[1]?.address;
          if (!inSet(pumpFees, feeRecipient)) throw new Reject(`pump sell: unknown fee recipient ${feeRecipient}`);
          if (!buyback || !inSet(pumpBuyback, buyback))
            throw new Reject(`pump sell: unknown buyback recipient ${buyback}`);
          if (d.args.amount !== intent.amount)
            throw new Reject(`pump sell: amount ${d.args.amount} != approved ${intent.amount}`);
          if (d.args.minSolOutput < intent.minSolOutput) {
            throw new Reject(`pump sell: min_sol_output ${d.args.minSolOutput} < approved ${intent.minSolOutput}`);
          }
          const expected = pumpSell({
            mint,
            user,
            creator: intent.creator,
            tokenProgram,
            feeRecipient,
            buybackFeeRecipient: buyback,
            amount: d.args.amount,
            minSolOutput: d.args.minSolOutput,
          });
          sameShape("pump sell", actual, expected);
          return expected;
        },
      };
      return { payer: user, signers: [user], steps: [step] };
    }
    case "pamm_buy":
    case "pamm_sell": {
      const user = toAddress(intent.user);
      const mint = toAddress(intent.mint);
      const pool = canonicalPoolPda(mint);
      const userBase = associatedTokenAddress(user, mint, TOKEN_2022_PROGRAM_ID);
      const userQuote = associatedTokenAddress(user, WSOL_MINT, TOKEN_PROGRAM_ID);
      const swap = {
        pool,
        user,
        baseMint: mint,
        poolBaseTokenAccount: intent.poolBaseTokenAccount,
        poolQuoteTokenAccount: intent.poolQuoteTokenAccount,
        coinCreator: intent.coinCreator,
      };
      const steps: Step[] = [exactStep("PumpSwap extend_account", pammExtendAccount({ account: pool, user }), true)];
      if (intent.kind === "pamm_buy") {
        let wrapped: bigint | null = null;
        steps.push(
          exactStep("create WSOL ATA", createAtaIdempotent(user, userQuote, user, WSOL_MINT, TOKEN_PROGRAM_ID), true)
        );
        steps.push({
          label: "wrap SOL",
          match: (actual) => {
            const t = decodeSystemTransfer(actual);
            if (!t || t.from !== user || t.to !== userQuote)
              throw new Reject("wrap SOL: expected a transfer to the user's WSOL ATA");
            if (t.lamports > intent.maxQuoteIn)
              throw new Reject(`wrap SOL: ${t.lamports} > approved ${intent.maxQuoteIn}`);
            wrapped = t.lamports;
            const expected = systemTransfer(user, userQuote, t.lamports);
            sameShape("wrap SOL", actual, expected);
            return expected;
          },
        });
        steps.push(exactStep("sync WSOL", syncNative(userQuote)));
        steps.push(
          exactStep("create coin ATA", createAtaIdempotent(user, userBase, user, mint, TOKEN_2022_PROGRAM_ID), true)
        );
        steps.push({
          label: "PumpSwap buy",
          match: (actual) => {
            const { d, protocol, buyback } = pammSwapRecipients("PumpSwap buy", actual, opts);
            if (d.name !== "buy") throw new Reject("PumpSwap buy: not a buy instruction");
            if (d.args.baseAmountOut < intent.minBaseOut) {
              throw new Reject(`PumpSwap buy: ${d.args.baseAmountOut} tokens < approved minimum ${intent.minBaseOut}`);
            }
            if (d.args.maxQuoteAmountIn > intent.maxQuoteIn) {
              throw new Reject(`PumpSwap buy: max quote ${d.args.maxQuoteAmountIn} > approved ${intent.maxQuoteIn}`);
            }
            if (wrapped !== d.args.maxQuoteAmountIn) throw new Reject("PumpSwap buy: wrapped SOL != max quote in");
            if (d.args.trackVolume !== true) throw new Reject("PumpSwap buy: track_volume must be set");
            const expected = pammBuy({
              ...swap,
              protocolFeeRecipient: protocol,
              buybackFeeRecipient: buyback,
              baseAmountOut: d.args.baseAmountOut,
              maxQuoteAmountIn: d.args.maxQuoteAmountIn,
            });
            sameShape("PumpSwap buy", actual, expected);
            return expected;
          },
        });
      } else {
        steps.push(
          exactStep("create WSOL ATA", createAtaIdempotent(user, userQuote, user, WSOL_MINT, TOKEN_PROGRAM_ID), true)
        );
        steps.push({
          label: "PumpSwap sell",
          match: (actual) => {
            const { d, protocol, buyback } = pammSwapRecipients("PumpSwap sell", actual, opts);
            if (d.name !== "sell") throw new Reject("PumpSwap sell: not a sell instruction");
            if (d.args.baseAmountIn !== intent.baseAmountIn) {
              throw new Reject(`PumpSwap sell: amount ${d.args.baseAmountIn} != approved ${intent.baseAmountIn}`);
            }
            if (d.args.minQuoteAmountOut < intent.minQuoteOut) {
              throw new Reject(`PumpSwap sell: min quote ${d.args.minQuoteAmountOut} < approved ${intent.minQuoteOut}`);
            }
            const expected = pammSell({
              ...swap,
              protocolFeeRecipient: protocol,
              buybackFeeRecipient: buyback,
              baseAmountIn: d.args.baseAmountIn,
              minQuoteAmountOut: d.args.minQuoteAmountOut,
            });
            sameShape("PumpSwap sell", actual, expected);
            return expected;
          },
        });
      }
      steps.push(exactStep("close WSOL ATA", closeTokenAccount(userQuote, user, user, TOKEN_PROGRAM_ID)));
      return { payer: user, signers: [user], steps };
    }
    case "exact": {
      const payer = toAddress(intent.payer);
      const signers = new Set<Address>([payer]);
      for (const ix of intent.expected) for (const m of ix.accounts) if (m.isSigner) signers.add(m.address);
      return {
        payer,
        signers: [...signers],
        steps: intent.expected.map((ix, i) => exactStep(`instruction ${i} (${ix.programId})`, ix)),
      };
    }
  }
}

/** Merged message-level flags the expected instructions need (what a compiler would produce). */
function expectedFlags(payer: Address, expected: Instruction[]): Map<Address, { s: boolean; w: boolean }> {
  const flags = new Map<Address, { s: boolean; w: boolean }>();
  const merge = (a: Address, s: boolean, w: boolean) => {
    const f = flags.get(a) ?? { s: false, w: false };
    flags.set(a, { s: f.s || s, w: f.w || w });
  };
  merge(payer, true, true);
  for (const ix of expected) {
    merge(ix.programId, false, false);
    for (const m of ix.accounts) merge(m.address, m.isSigner, m.isWritable);
  }
  return flags;
}

function spendUpperBound(payer: Address, ixs: Instruction[]): bigint {
  let total = 0n;
  for (const ix of ixs) {
    const t = decodeSystemTransfer(ix);
    if (t && t.from === payer) total += t.lamports;
    const p = decodePumpInstruction(ix);
    if (p && p.name === "buy") total += p.args.maxSolCost;
    // PumpSwap buys are funded by the wrap transfer above, so they are not added twice.
  }
  return total;
}

/** Verifies a serialized transaction against what the user approved. Never throws; see `errors`. */
export function verifyTransaction(txBytes: Uint8Array, intent: TxIntent, opts: VerifyOptions = {}): VerifyResult {
  const errors: string[] = [];
  const summary: TxSummary = {
    feePayer: null,
    signers: [],
    programs: [],
    computeUnitLimit: null,
    computeUnitPriceMicroLamports: null,
    priorityFeeLamports: 0n,
    maxPayerSpendLamports: 0n,
    byteLength: txBytes.length,
  };
  let tx: ResolvedTransaction | null = null;
  try {
    const decoded = decodeTransaction(txBytes);
    if (opts.allowedLookupTables) {
      for (const l of decoded.message.addressTableLookups) {
        if (!inSet(opts.allowedLookupTables, l.accountKey))
          throw new Reject(`lookup table ${l.accountKey} is not allowed`);
      }
    }
    tx = resolveTransaction(decoded, opts.lookupTables);
    summary.feePayer = tx.feePayer;
    summary.signers = tx.signers;
    summary.programs = [...new Set(tx.instructions.map((i) => i.programId))];

    const guards = new Set(
      (opts.guardPrograms ?? []).map((g) => toAddress(g)).filter((g) => !ALLOWED_PROGRAMS.includes(g))
    );
    for (const p of summary.programs)
      if (!ALLOWED_PROGRAMS.includes(p) && !guards.has(p)) throw new Reject(`program ${p} is not allowed`);

    // compute budget prefix
    let k = 0;
    const seen = new Set<string>();
    while (k < tx.instructions.length && tx.instructions[k].programId === COMPUTE_BUDGET_PROGRAM_ID) {
      const cb = decodeComputeBudget(tx.instructions[k]);
      if (!cb || cb.kind === "other" || seen.has(cb.kind)) throw new Reject("unexpected compute budget instruction");
      if (tx.instructions[k].accounts.length !== 0) throw new Reject("compute budget instruction with accounts");
      seen.add(cb.kind);
      if (cb.kind === "limit") summary.computeUnitLimit = cb.units;
      else summary.computeUnitPriceMicroLamports = cb.microLamports;
      k++;
    }
    const maxLimit = opts.maxComputeUnitLimit ?? DEFAULTS.maxComputeUnitLimit;
    const maxPrice = opts.maxComputeUnitPriceMicroLamports ?? DEFAULTS.maxComputeUnitPriceMicroLamports;
    const maxFee = opts.maxPriorityFeeLamports ?? DEFAULTS.maxPriorityFeeLamports;
    if (summary.computeUnitLimit !== null && summary.computeUnitLimit > maxLimit) {
      throw new Reject(`compute unit limit ${summary.computeUnitLimit} > ${maxLimit}`);
    }
    const price = summary.computeUnitPriceMicroLamports ?? 0n;
    if (price > maxPrice) throw new Reject(`compute unit price ${price} > ${maxPrice}`);
    const units = BigInt(summary.computeUnitLimit ?? 1_400_000);
    summary.priorityFeeLamports = (units * price + 999_999n) / 1_000_000n;
    if (summary.priorityFeeLamports > maxFee)
      throw new Reject(`priority fee ${summary.priorityFeeLamports} > ${maxFee}`);
    let end = tx.instructions.length;
    const guardIxs: Instruction[] = [];
    while (end > k && guards.has(tx.instructions[end - 1].programId)) {
      guardIxs.unshift(tx.instructions[end - 1]);
      end--;
    }
    const payload = tx.instructions.slice(k, end);
    if (payload.some((i) => i.programId === COMPUTE_BUDGET_PROGRAM_ID)) {
      throw new Reject("compute budget instructions must come first");
    }
    if (payload.some((i) => guards.has(i.programId))) {
      throw new Reject("guard instructions are allowed only after the payload");
    }
    for (const g of guardIxs) {
      for (const m of g.accounts) {
        if (m.isSigner || m.isWritable) {
          throw new Reject(`guard instruction (${g.programId}) uses ${m.address} as a signer or writable account`);
        }
      }
    }

    const t = templateFor(intent, opts);
    if (tx.feePayer !== t.payer) throw new Reject(`fee payer ${tx.feePayer}, expected ${t.payer}`);
    const want = new Set(t.signers);
    if (tx.signers.length !== want.size || !tx.signers.every((s) => want.has(s))) {
      throw new Reject(`signers [${tx.signers.join(", ")}], expected [${t.signers.join(", ")}]`);
    }
    const expected = runTemplate(payload, t.steps);

    // Guard instructions only add read-only, non-signer accounts (checked above) and their program ids.
    const guardRefs: Instruction[] = guardIxs.map((g) => ({
      programId: g.programId,
      accounts: g.accounts.map((m) => ({ address: m.address, isSigner: false, isWritable: false })),
      data: g.data,
    }));
    const flags = expectedFlags(t.payer, [...tx.instructions.slice(0, k), ...expected, ...guardRefs]);
    for (const a of tx.accounts) {
      const f = flags.get(a.address);
      if (!f) throw new Reject(`account ${a.address} is in the message but used by no expected instruction`);
      if (f.s !== a.isSigner) throw new Reject(`account ${a.address} signer flag ${a.isSigner}, expected ${f.s}`);
      if (f.w !== a.isWritable) throw new Reject(`account ${a.address} writable flag ${a.isWritable}, expected ${f.w}`);
    }

    if (opts.requirePresignedBy?.length) {
      const statuses = signatureStatuses(decoded);
      for (const s of opts.requirePresignedBy) {
        const st = statuses.find((x) => x.signer === toAddress(s));
        if (!st || st.status !== "valid") throw new Reject(`missing or invalid signature from ${toAddress(s)}`);
      }
    }
    summary.maxPayerSpendLamports = spendUpperBound(t.payer, payload);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return { ok: errors.length === 0, errors, tx, summary };
}
