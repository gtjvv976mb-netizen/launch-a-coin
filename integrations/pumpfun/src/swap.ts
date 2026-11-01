/**
 * Getting a token pair's quote with SOL before an initial buy (owner request 1 November 2026: "is it not automatic"):
 * a Jupiter swap as its own transaction, approved in the creator's wallet before the launch transaction is prepared.
 *
 * Jupiter (lite-api.jup.ag/swap/v1/swap-instructions, read in the creator's browser) proposes the instructions. Nothing
 * from it is trusted: this file keeps only an exact allowlist of top-level instructions (create the creator's own token
 * accounts, wrap SOL into the creator's wSOL account, one Jupiter route, unwrap it again), compiles the transaction
 * itself with its own blockhash and compute budget, and simulates it on mainnet with the creator as the only signer and
 * payer. A plan is returned only when the simulation leaves the creator holding the full amount the buy needs and spends
 * no more SOL than the cap. The signed transaction is checked again the same way, simulation included, before it is
 * sent: a wallet may add its own read-only Lighthouse assertions (wallet-guards.ts) and refresh the blockhash, nothing else.
 */
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackAccount } from "@solana/spl-token";
import { isLighthouseGuard, LIGHTHOUSE_PROGRAM_ID, MAX_WALLET_GUARDS, WALLET_SIZE_TARGET } from "./wallet-guards.ts";
import { simulatedPayerOutflow } from "./live.ts";

export const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const COMPUTE_BUDGET_ID = ComputeBudgetProgram.programId;
const LIGHTHOUSE_ID = new PublicKey(LIGHTHOUSE_PROGRAM_ID);
/**
 * The one Jupiter v6 instruction allowed: shared_accounts_exact_out_route (Anchor discriminator sha256("global:<name>")
 * [0..8]), the route the browser asks for (exact output, shared accounts). Its fixed accounts are pinned (ROUTE_*), so
 * it can only spend the creator's wSOL account and pay into the creator's quote account, with no platform fee.
 */
export const JUPITER_ROUTE_DISCRIMINATOR = createHash("sha256").update("global:shared_accounts_exact_out_route").digest().subarray(0, 8).toString("hex");
const ROUTE_TOKEN_PROGRAM = 0, ROUTE_USER = 2, ROUTE_SOURCE = 3, ROUTE_DESTINATION = 6, ROUTE_SOURCE_MINT = 7, ROUTE_DESTINATION_MINT = 8, ROUTE_PLATFORM_FEE = 9;
/** The highest slippage a route may carry (bps): the browser asks for 100. */
export const MAX_ROUTE_SLIPPAGE_BPS = 300;
/** What the route itself says, read from the end of its data: out_amount u64, quoted_in_amount u64, slippage_bps u16, platform_fee_bps u8. */
export type RouteTerms = { outAmount: bigint; quotedInAmount: bigint; slippageBps: number; maxIn: bigint };
const MIN_MICRO_LAMPORTS = 1_000, MAX_MICRO_LAMPORTS = 200_000;
/** Room for a wallet's own assertions on top of 1.2 x the simulated use (as the launch's plans keep: live.ts). */
const COMPUTE_MARGIN = 50_000;
/** What the wallet must still hold after the swap: Solana's rent minimum plus enough to launch the coin and its card. */
export const LAUNCH_SOL_RESERVE_LAMPORTS = 50_000_000n;
/** A signed swap may cost at most this much more than the reviewed one (a refreshed blockhash, a moved price). */
const SIGNED_SPEND_TOLERANCE_BPS = 100n, SIGNED_SPEND_TOLERANCE_LAMPORTS = 20_000n;

export type JupiterInstruction = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
/** Jupiter's /swap/v1/swap-instructions answer: only these fields are read. */
export type JupiterSwapInstructions = {
  computeBudgetInstructions?: JupiterInstruction[] | null;
  setupInstructions?: JupiterInstruction[] | null;
  swapInstruction: JupiterInstruction;
  cleanupInstruction?: JupiterInstruction | null;
  otherInstructions?: JupiterInstruction[] | null;
  tokenLedgerInstruction?: JupiterInstruction | null;
  addressLookupTableAddresses?: string[] | null;
};
export type SwapTarget = { creator: string; quoteMint: string; quoteTokenProgram: string; /** The quote balance the buy needs, in base units. */ need: bigint; /** The most SOL the swap may spend (lamports, fees included). */ maxSpend: bigint };
export type SwapConnection = Pick<Connection, "getAddressLookupTable" | "getLatestBlockhash" | "getRecentPrioritizationFees" | "simulateTransaction" | "getFeeForMessage" | "getTokenAccountsByOwner" | "getAccountInfo">;
/** Rent of one SPL token account: the most the swap may spend besides the SOL it wraps and the network fee is two of them. */
const TOKEN_ACCOUNT_RENT = 2_039_280n;

export class SwapRefused extends Error {
  constructor(message: string) { super(message); this.name = "SwapRefused"; }
}
const refuse = (why: string): never => { throw new SwapRefused(why); };

function toInstruction(raw: JupiterInstruction): TransactionInstruction {
  try {
    return new TransactionInstruction({ programId: new PublicKey(raw.programId), data: Buffer.from(raw.data, "base64"),
      keys: raw.accounts.map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner === true, isWritable: a.isWritable === true })) });
  } catch { return refuse("The swap route was not readable"); }
}
const u32 = (data: Buffer, at: number) => data.length >= at + 4 ? data.readUInt32LE(at) : -1;

/**
 * Checks one top-level instruction against the allowlist; returns the lamports it wraps (a System transfer) or 0n.
 * Only the creator may sign anything, and only into the creator's own accounts.
 */
type Seen = { route: number; terms: RouteTerms | null };
function allowedInstruction(ix: TransactionInstruction, target: SwapTarget, seen: Seen): bigint {
  const creator = new PublicKey(target.creator), quoteMint = new PublicKey(target.quoteMint), quoteProgram = new PublicKey(target.quoteTokenProgram);
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, creator, false, TOKEN_PROGRAM_ID);
  const quoteAta = getAssociatedTokenAddressSync(quoteMint, creator, false, quoteProgram);
  if (ix.keys.some(k => k.isSigner && !k.pubkey.equals(creator))) refuse("The swap asked for another signer");
  const key = (i: number) => ix.keys[i]?.pubkey;
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    // CreateIdempotent (1) of the creator's own wSOL or quote account, paid by the creator.
    if (!(ix.data.length === 1 && ix.data[0] === 1)) refuse("The swap route made an unexpected account");
    const [payer, ata, owner, mint, , program] = [0, 1, 2, 3, 4, 5].map(key);
    const ok = payer?.equals(creator) && owner?.equals(creator) && (
      mint?.equals(NATIVE_MINT) && ata?.equals(wsolAta) && program?.equals(TOKEN_PROGRAM_ID)
      || mint?.equals(quoteMint) && ata?.equals(quoteAta) && program?.equals(quoteProgram));
    if (!ok) refuse("The swap route made an account that is not the creator's own");
    return 0n;
  }
  if (ix.programId.equals(SystemProgram.programId)) {
    // Transfer (2) from the creator into the creator's wSOL account: the SOL being swapped.
    if (u32(ix.data, 0) !== 2 || ix.data.length !== 12 || !key(0)?.equals(creator) || !key(1)?.equals(wsolAta)) refuse("The swap route moved SOL somewhere unexpected");
    return ix.data.readBigUInt64LE(4);
  }
  if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
    // SyncNative (17) of the wSOL account, or CloseAccount (9) of it back to the creator.
    if (ix.data.length === 1 && ix.data[0] === 17 && ix.keys.length === 1 && key(0)?.equals(wsolAta)) return 0n;
    if (ix.data.length === 1 && ix.data[0] === 9 && key(0)?.equals(wsolAta) && key(1)?.equals(creator) && key(2)?.equals(creator)) return 0n;
    return refuse("The swap route used a token instruction that is not allowed");
  }
  if (ix.programId.equals(JUPITER_PROGRAM_ID)) {
    if (ix.data.subarray(0, 8).toString("hex") !== JUPITER_ROUTE_DISCRIMINATOR || ix.data.length < 8 + 19) refuse("The swap route is not a plain Jupiter swap");
    if (++seen.route > 1) refuse("The swap had more than one route");
    // The fixed accounts: SPL Token as the route's token program, the creator as the one authority, the creator's wSOL in,
    // the creator's quote account out, the two mints, and no platform fee account (Jupiter's own id means none).
    const tokenProgram = key(ROUTE_TOKEN_PROGRAM);
    const pinned = (tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID))
      && key(ROUTE_USER)?.equals(creator) && ix.keys[ROUTE_USER]?.isSigner
      && key(ROUTE_SOURCE)?.equals(wsolAta) && key(ROUTE_DESTINATION)?.equals(quoteAta)
      && key(ROUTE_SOURCE_MINT)?.equals(NATIVE_MINT) && key(ROUTE_DESTINATION_MINT)?.equals(quoteMint)
      && key(ROUTE_PLATFORM_FEE)?.equals(JUPITER_PROGRAM_ID);
    if (!pinned) refuse("The swap route spends or pays an account that is not the creator's wSOL or token account");
    // The AMM legs' accounts never include the creator or its two accounts (real routes name them only at 2, 3 and 6).
    if (ix.keys.slice(ROUTE_PLATFORM_FEE + 1).some(k => k.pubkey.equals(creator) || k.pubkey.equals(wsolAta) || k.pubkey.equals(quoteAta))) refuse("The swap route passes the creator's accounts to its pools");
    const tail = ix.data.subarray(ix.data.length - 19);
    const outAmount = tail.readBigUInt64LE(0), quotedInAmount = tail.readBigUInt64LE(8), slippageBps = tail.readUInt16LE(16), platformFeeBps = tail[18];
    if (platformFeeBps !== 0) refuse("The swap route carries a platform fee");
    if (slippageBps > MAX_ROUTE_SLIPPAGE_BPS) refuse("The swap route allows too much slippage");
    seen.terms = { outAmount, quotedInAmount, slippageBps, maxIn: quotedInAmount + (quotedInAmount * BigInt(slippageBps) + 9_999n) / 10_000n };
    return 0n;
  }
  return refuse("The swap route used a program that is not allowed");
}

/** Jupiter's proposal as the instructions this site compiles (no compute budget: ours is added), with the SOL it wraps. */
export function reviewSwapInstructions(raw: JupiterSwapInstructions, target: SwapTarget): { instructions: TransactionInstruction[]; wrapLamports: bigint; terms: RouteTerms } {
  if (raw.tokenLedgerInstruction) refuse("Token-ledger swaps are not used");
  if (raw.otherInstructions?.length) refuse("The swap route added extra instructions");
  if (!raw.swapInstruction) refuse("The swap route had no swap");
  const instructions = [...(raw.setupInstructions ?? []), raw.swapInstruction, ...(raw.cleanupInstruction ? [raw.cleanupInstruction] : [])].map(toInstruction);
  if (instructions.length > 12) refuse("The swap route had too many steps");
  const seen: Seen = { route: 0, terms: null };
  let wrapLamports = 0n;
  for (const ix of instructions) wrapLamports += allowedInstruction(ix, target, seen);
  if (seen.route !== 1 || !seen.terms) refuse("The swap route had no swap");
  // The SOL wrapped is at most what the route itself may take (its quoted input plus its slippage).
  if (wrapLamports > seen.terms!.maxIn) refuse("The swap wraps more SOL than its route can use");
  if (wrapLamports > target.maxSpend) refuse("The swap would spend more SOL than allowed");
  return { instructions, wrapLamports, terms: seen.terms! };
}

/**
 * No instruction may name any token account the creator owns besides its wSOL and quote accounts: whatever an AMM leg
 * does, the creator's other tokens are never within reach of the creator's signature.
 */
async function assertNoOtherTokenAccounts(connection: Pick<SwapConnection, "getTokenAccountsByOwner">, instructions: readonly TransactionInstruction[], target: SwapTarget) {
  const creator = new PublicKey(target.creator);
  const allowed = new Set([getAssociatedTokenAddressSync(NATIVE_MINT, creator, false, TOKEN_PROGRAM_ID).toBase58(),
    getAssociatedTokenAddressSync(new PublicKey(target.quoteMint), creator, false, new PublicKey(target.quoteTokenProgram)).toBase58()]);
  const owned = (await Promise.all([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(programId => connection.getTokenAccountsByOwner(creator, { programId }, "confirmed"))))
    .flatMap(answer => answer.value.map(entry => entry.pubkey.toBase58())).filter(key => !allowed.has(key));
  const named = new Set(instructions.flatMap(ix => ix.keys.map(k => k.pubkey.toBase58())));
  if (owned.some(key => named.has(key))) refuse("The swap route names another of the creator's token accounts");
}

async function lookupTables(connection: Pick<SwapConnection, "getAddressLookupTable">, addresses: readonly string[]): Promise<AddressLookupTableAccount[]> {
  if (addresses.length > 4) refuse("The swap route used too many lookup tables");
  return Promise.all(addresses.map(async address => {
    const table = (await connection.getAddressLookupTable(new PublicKey(address))).value;
    if (!table || !table.isActive()) refuse("A lookup table of the swap route is not active");
    return table!;
  }));
}

/**
 * The simulated outcome for the creator: the most SOL the swap takes (every System debit from the creator in the
 * simulation, plus the SOL wrapped and the network fee; wrapped SOL Jupiter does not use comes back when the wSOL account
 * is closed, so the real cost is at most this) and the quote balance afterwards. The creator's wSOL account must hold
 * nothing before (so the route can spend only what this transaction wraps) and be gone or empty after, and nothing
 * besides at most two new token accounts' rent may leave the creator inside the swap.
 */
async function simulateOutcome(connection: Pick<SwapConnection, "simulateTransaction" | "getFeeForMessage" | "getAccountInfo">, transaction: VersionedTransaction, target: SwapTarget, sigVerify: boolean) {
  const creator = new PublicKey(target.creator), quoteProgram = new PublicKey(target.quoteTokenProgram);
  const quoteAta = getAssociatedTokenAddressSync(new PublicKey(target.quoteMint), creator, false, quoteProgram);
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, creator, false, TOKEN_PROGRAM_ID);
  const wsolBefore = await connection.getAccountInfo(wsolAta, "confirmed");
  if (wsolBefore && wsolBefore.data.length >= 72 && unpackAccount(wsolAta, wsolBefore, TOKEN_PROGRAM_ID).amount > 0n) {
    refuse("This wallet holds wrapped SOL. Unwrap it in your wallet first, or get the token on Jupiter yourself");
  }
  const [simulation, fee] = await Promise.all([
    connection.simulateTransaction(transaction, { sigVerify, replaceRecentBlockhash: false, commitment: "confirmed", innerInstructions: true,
      accounts: { encoding: "base64", addresses: [creator.toBase58(), quoteAta.toBase58(), wsolAta.toBase58()] } }),
    connection.getFeeForMessage(transaction.message, "confirmed"),
  ]);
  if (simulation.value.err) {
    const text = JSON.stringify(simulation.value.err) + (simulation.value.logs ?? []).join(" ");
    refuse(/insufficient lamports|InsufficientFunds|"Custom":1\b/i.test(text) ? "This wallet doesn't have enough SOL for the swap" : "The swap failed in simulation; prices may have moved. Try again");
  }
  const [payer, quote, wsolAfter] = simulation.value.accounts ?? [];
  if (!payer) return refuse("The swap's simulated balances were not returned");
  if (wsolAfter && wsolAfter.lamports > 0 && wsolAfter.data?.[0]) {
    const left = unpackAccount(wsolAta, { ...wsolAfter, data: Buffer.from(wsolAfter.data[0], "base64"), owner: new PublicKey(wsolAfter.owner) } as never, TOKEN_PROGRAM_ID);
    if (left.amount > 0n) refuse("The swap would leave wrapped SOL behind");
  }
  const outflow = simulatedPayerOutflow(simulation.value.innerInstructions, creator.toBase58());
  if (outflow === null || fee.value === null) return refuse("The swap's cost could not be measured");
  if (outflow > 2n * TOKEN_ACCOUNT_RENT) refuse("The swap would take SOL beyond what it wraps");
  // Top-level transfers (the SOL being wrapped) are not inner instructions: add them from the message itself.
  const topLevel = transaction.message.compiledInstructions.reduce((sum, ix) => {
    const program = transaction.message.staticAccountKeys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    return program?.equals(SystemProgram.programId) && data.length === 12 && data.readUInt32LE(0) === 2 ? sum + data.readBigUInt64LE(4) : sum;
  }, 0n);
  const spent = outflow + topLevel + BigInt(fee.value);
  let quoteAfter = 0n;
  if (quote) {
    const info = { ...quote, data: Buffer.from(quote.data[0], "base64"), owner: new PublicKey(quote.owner) };
    const account = unpackAccount(quoteAta, info as never, quoteProgram);
    if (account.owner.equals(creator) && !account.isFrozen) quoteAfter = account.amount;
  }
  return { spent, quoteAfter, payerAfter: BigInt(payer.lamports), unitsConsumed: simulation.value.unitsConsumed ?? 0 };
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export type QuoteSwapPlan = {
  transactionBase64: string; messageSha256: string; blockhash: string; lastValidBlockHeight: number;
  /** The most SOL the swap takes, fees and new-account rent included (lamports); unused wrapped SOL comes back. */ spendLamports: string;
  /** The quote balance after the swap (base units), at least `need`. */ quoteAfter: string;
  lookupTables: string[];
  /** The route's own quoted SOL input and the most it may take (quoted input plus slippage), in lamports. */
  routeQuotedIn: string; routeMaxIn: string;
};

/** Compiles, sizes and simulates the swap; refuses anything outside the allowlist or short of `need`. */
export async function prepareQuoteSwap(connection: SwapConnection, raw: JupiterSwapInstructions, target: SwapTarget): Promise<QuoteSwapPlan> {
  const { instructions, terms } = reviewSwapInstructions(raw, target);
  await assertNoOtherTokenAccounts(connection, instructions, target);
  const creator = new PublicKey(target.creator);
  const tableAddresses = [...new Set(raw.addressLookupTableAddresses ?? [])];
  const [tables, latest, samples] = await Promise.all([
    lookupTables(connection, tableAddresses),
    connection.getLatestBlockhash("confirmed"),
    connection.getRecentPrioritizationFees({ lockedWritableAccounts: [creator] }),
  ]);
  const fees = samples.map(s => s.prioritizationFee).filter(f => Number.isSafeInteger(f) && f >= 0).sort((a, b) => a - b);
  const microLamports = Math.min(MAX_MICRO_LAMPORTS, Math.max(MIN_MICRO_LAMPORTS, fees[Math.floor(fees.length * 0.75)] ?? MIN_MICRO_LAMPORTS));
  const compile = (limit: number) => new VersionedTransaction(new TransactionMessage({ payerKey: creator, recentBlockhash: latest.blockhash, instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports }), ...instructions,
  ] }).compileToV0Message(tables));
  const first = compile(1_400_000);
  if (first.serialize().length > WALLET_SIZE_TARGET) refuse("The swap route is too large for one transaction");
  const trial = await simulateOutcome(connection, first, target, false);
  if (!trial.unitsConsumed || trial.unitsConsumed > 1_400_000) refuse("The swap's compute use could not be measured");
  const transaction = compile(Math.min(1_400_000, Math.ceil(trial.unitsConsumed * 1.2) + COMPUTE_MARGIN));
  const outcome = await simulateOutcome(connection, transaction, target, false);
  if (outcome.quoteAfter < target.need) refuse("The swap would not leave enough of the token for the initial buy");
  if (outcome.spent > target.maxSpend) refuse("The swap would spend more SOL than allowed");
  if (outcome.payerAfter < LAUNCH_SOL_RESERVE_LAMPORTS) refuse("After the swap this wallet wouldn't have enough SOL left to launch. Lower the initial buy or add SOL");
  return {
    transactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
    messageSha256: digest(transaction.message.serialize()),
    blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
    spendLamports: outcome.spent.toString(), quoteAfter: outcome.quoteAfter.toString(), lookupTables: tableAddresses,
    routeQuotedIn: terms.quotedInAmount.toString(), routeMaxIn: terms.maxIn.toString(),
  };
}

/**
 * The creator's signed swap, checked before it is sent: one signature, the creator's and valid; the same lookup tables;
 * the same allowlist (plus a wallet's read-only Lighthouse assertions and its own compute budget, refreshed or not); and
 * a simulation with signatures verified that still leaves `need` and spends no more than the reviewed amount allows.
 */
export async function checkSignedQuoteSwap(connection: SwapConnection, signedBase64: string, target: SwapTarget & { reviewedSpend: bigint; lookupTables: readonly string[]; preparedBase64: string }) {
  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64")); } catch { return refuse("The wallet returned an unreadable transaction"); }
  const message = transaction.message, creator = new PublicKey(target.creator);
  if (message.version !== 0) refuse("The wallet returned a different kind of transaction");
  if (message.header.numRequiredSignatures !== 1 || !message.staticAccountKeys[0]?.equals(creator)) refuse("The swap must be signed by the creator alone");
  if (!ed25519.verify(transaction.signatures[0], message.serialize(), creator.toBytes())) refuse("The wallet's signature did not verify");
  const tableKeys = message.addressTableLookups.map(l => l.accountKey.toBase58());
  if (tableKeys.some(key => !target.lookupTables.includes(key))) refuse("The wallet changed the swap's lookup tables");
  const tables = await lookupTables(connection, [...new Set(tableKeys)]);
  const instructions = TransactionMessage.decompile(message, { addressLookupTableAccounts: tables }).instructions;
  const seen: Seen = { route: 0, terms: null };
  const own: TransactionInstruction[] = [];
  let guards = 0;
  for (const ix of instructions) {
    if (ix.programId.equals(COMPUTE_BUDGET_ID)) {
      // SetComputeUnitLimit (2) or SetComputeUnitPrice (3) only, the price within the cap.
      if (ix.data[0] === 3 && ix.data.length === 9 && ix.data.readBigUInt64LE(1) <= BigInt(MAX_MICRO_LAMPORTS)) continue;
      if (ix.data[0] === 2 && ix.data.length === 5) continue;
      refuse("The wallet changed the swap's compute budget");
    }
    if (ix.programId.equals(LIGHTHOUSE_ID)) {
      // A wallet's read-only assertion, in the same shape the launch accepts (wallet-guards.ts): one account it reads.
      // That account may be signer or writable for the other instructions (the payer, the quote account).
      if (++guards > MAX_WALLET_GUARDS || !isLighthouseGuard({ program: LIGHTHOUSE_PROGRAM_ID, data: ix.data, accounts: ix.keys.map(k => k.pubkey.toBase58()) })) refuse("The wallet added an instruction that is not a read-only check");
      continue;
    }
    allowedInstruction(ix, target, seen);
    own.push(ix);
  }
  if (seen.route !== 1 || !seen.terms) refuse("The signed swap has no swap");
  // The same instructions the server prepared, in order, account for account and byte for byte (only a wallet's
  // compute budget, read-only checks and blockhash may differ).
  const prepared = VersionedTransaction.deserialize(Buffer.from(target.preparedBase64, "base64"));
  const preparedTables = await lookupTables(connection, prepared.message.addressTableLookups.map(l => l.accountKey.toBase58()));
  const expected = TransactionMessage.decompile(prepared.message, { addressLookupTableAccounts: preparedTables }).instructions.filter(ix => !ix.programId.equals(COMPUTE_BUDGET_ID));
  const same = (a: TransactionInstruction, b: TransactionInstruction) => a.programId.equals(b.programId) && a.data.equals(b.data)
    && a.keys.length === b.keys.length && a.keys.every((k, i) => k.pubkey.equals(b.keys[i]!.pubkey));
  if (own.length !== expected.length || own.some((ix, i) => !same(ix, expected[i]!))) refuse("The wallet returned a different swap than the one you reviewed");
  const named = new Set(own.flatMap(ix => ix.keys.map(k => k.pubkey.toBase58())));
  for (const ix of instructions) if (ix.programId.equals(LIGHTHOUSE_ID) && !named.has(ix.keys[0]!.pubkey.toBase58())) refuse("The wallet's check reads an account outside the swap");
  await assertNoOtherTokenAccounts(connection, own, target);
  const outcome = await simulateOutcome(connection, transaction, target, true);
  if (outcome.quoteAfter < target.need) refuse("The swap would no longer leave enough of the token; prices moved. Try again");
  const allowed = target.reviewedSpend + target.reviewedSpend * SIGNED_SPEND_TOLERANCE_BPS / 10_000n + SIGNED_SPEND_TOLERANCE_LAMPORTS;
  if (outcome.spent > allowed || outcome.spent > target.maxSpend) refuse("The swap would now cost more SOL than you reviewed. Try again");
  return { signature: bs58.encode(transaction.signatures[0]), bytes: transaction.serialize(), spent: outcome.spent, quoteAfter: outcome.quoteAfter };
}

/** The blockhash a signed swap carries (a wallet may have refreshed it), so its expiry can be checked. */
export function signedBlockhash(bytes: Uint8Array): string | null {
  try { return VersionedTransaction.deserialize(bytes).message.recentBlockhash; } catch { return null; }
}
