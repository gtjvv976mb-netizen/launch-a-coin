import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import BN from "bn.js";
import {
  AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction, type AccountInfo, type ParsedInnerInstruction, type VersionedMessage,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, getTokenMetadata, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  unpackAccount, unpackMint,
} from "@solana/spl-token";
import {
  bondingCurvePda, creatorVaultPda, feeSharingConfigPda, GLOBAL_PDA, holderRewardsPda, isSharingConfigEditable, PUMP_FEE_CONFIG_PDA, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID,
  PUMP_SDK, QUOTE_CONTROL_PDA, getBuyV3TokenAmountFromQuoteAmount,
  newBondingCurve, type SharingConfig,
} from "@pump-fun/pump-sdk";
import {
  create as createCoreAsset, deserializeAssetV1, mplCore, updateV1,
  PluginType,
} from "@metaplex-foundation/mpl-core";
import { getPluginRegistryV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/hooked/pluginRegistryV1Data.js";
import {
  createNoopSigner, lamports, publicKey as umiPublicKey, signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import {
  ALLOW_PERMANENT_DELEGATE_QUOTE_BUY, bindingOptions, createOptionsGlobal, createV2Flags, MAINNET_GENESIS_HASH, PAIR_ASSETS, PERMANENT_DELEGATE_BUY_REFUSAL, PUBLIC_MAINNET_RPC, hash, immutable,
  preparePumpLaunchPlan, publicKey, quoteIssuerControls, reviewLaunchInput, reviewTokenFields, type PairKey, type PrepareLaunchInput,
} from "./index.ts";
import {
  LIGHTHOUSE_PROGRAM_ID, PACKET_LIMIT, PUMP_LOOKUP_TABLE, WALLET_GUARD_RESERVE_BYTES, WALLET_SIZE_TARGET, WalletMessageRefused,
  decodeV0Message, resolveInstructions, walletMessageChange, withoutWalletGuards,
} from "./wallet-guards.ts";
import {
  MAX_FEE_RECIPIENTS, feeRecipientsProblem, feeShareInstructionsProblem, sameFeeSplit, type FeeRecipient, type FeeShareExpected,
} from "./fee-share-rules.ts";
import { HOLDER_REWARDS_NO_SPLIT, createV2FlagTail, readCreateOptions, type CreateOptions } from "./create-options.ts";

export { HOLDER_REWARDS_NO_SPLIT, createOptionsGlobal };
export { LIGHTHOUSE_PROGRAM_ID, MAX_FEE_RECIPIENTS, PACKET_LIMIT, PUMP_LOOKUP_TABLE, WALLET_GUARD_RESERVE_BYTES, WALLET_SIZE_TARGET, type FeeRecipient };

export const CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export interface LiveLaunchInput extends PrepareLaunchInput {
  nftMint: string;
  nftName?: string;
  initialBuyQuoteBaseUnits?: string;
  slippageBps?: number;
  renderedCardSha256?: string;
  nftMetadataSha256?: string;
}

export type LiveConnection = Pick<Connection,
  "getGenesisHash" | "getMultipleAccountsInfoAndContext" | "getAccountInfoAndContext" |
  "getAccountInfo" | "getLatestBlockhash" | "getRecentPrioritizationFees" |
  "getFeeForMessage" | "simulateTransaction" | "getTransaction" |
  "getSignatureStatuses" | "getBlockHeight" | "getEpochInfo" | "sendRawTransaction" | "isBlockhashValid"
>;
export type LiveOptions = { connection: LiveConnection; now?: () => Date };
export type VerifyOptions = { connection: LiveConnection; signature?: string; expectedMessageSha256?: string };

/** Longest a single RPC call may take before it is abandoned: a hung provider must not leave a launch step spinning. */
export const RPC_TIMEOUT_MS = 20_000;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/** A fetch that gives every RPC request its own timeout, unless the caller already set a signal. */
export function rpcFetchWithTimeout(base: FetchLike, timeoutMs = RPC_TIMEOUT_MS): FetchLike {
  return (input, init) => base(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
}
export function createMainnetConnection(rpcUrl: string): Connection {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("A server-side HTTPS mainnet RPC URL is required");
  // A timed-out read fails like any provider error: the pre-send paths keep the signed bytes and say "not sent".
  return new Connection(rpcUrl, { commitment: "confirmed", fetch: rpcFetchWithTimeout((input, init) => globalThis.fetch(input, init)) as never });
}
/** A transaction the chain processed and failed: nothing it would have created exists. Its network fee was charged. */
export class TransactionFailedOnChain extends Error {
  constructor(readonly chainError: unknown) { super(`Transaction failed: ${JSON.stringify(chainError)}`); this.name = "TransactionFailedOnChain"; }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function atoms(value: string | undefined, label: string): bigint {
  if (value === undefined) return 0n;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be an unsigned base-unit integer string`);
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throw new Error(`${label} exceeds u64`);
  return result;
}
function safeLamports(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is not a safe lamport integer`);
  return BigInt(value);
}
function identity(input: LiveLaunchInput) {
  const reviewed = reviewLaunchInput(input);
  const nftMint = publicKey(input.nftMint, "Core asset");
  if ([reviewed.creator, reviewed.mint, reviewed.quoteMint].some((key) => nftMint.equals(key))) throw new Error("The Core asset must have its own new signer address");
  const buy = atoms(input.initialBuyQuoteBaseUnits, "Initial buy");
  const slippageBps = input.slippageBps ?? 100;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) throw new Error("Slippage must be 0–1000 basis points");
  for (const [label, value] of [["renderedCardSha256", input.renderedCardSha256], ["nftMetadataSha256", input.nftMetadataSha256]]) {
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is required for a live launch`);
  }
  const nftName = input.nftName ?? input.name;
  if (!nftName.trim() || Buffer.byteLength(nftName, "utf8") > 64 || /[\x00-\x1f]/.test(nftName)) throw new Error("Invalid creator NFT name");
  const binding = {
    network: "solana-mainnet-beta", creatorWallet: input.creator, tokenMint: input.mint,
    tokenName: input.name, tokenSymbol: input.symbol, tokenMetadataUri: input.tokenMetadataUri,
    quoteKey: reviewed.asset.key, quoteMint: reviewed.asset.mint,
    card: reviewed.card, nftName, renderedCardSha256: input.renderedCardSha256!,
    nftMetadataSha256: input.nftMetadataSha256!,
    initialBuyQuoteBaseUnits: buy.toString(), slippageBps,
    // Only a chosen option is added, so every binding made before these options hashes exactly as before.
    ...bindingOptions(reviewed.options),
  };
  return { ...reviewed, nftMint, nftName, buy, slippageBps, binding, bindingSha256: hash(JSON.stringify(binding)) };
}

async function assertMainnet(connection: LiveConnection) {
  if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) throw new Error("RPC is not Solana mainnet");
}

function decodeInstruction(input: { programId: string; accounts: { address: string; signer: boolean; writable: boolean }[]; dataBase64: string }) {
  return new TransactionInstruction({
    programId: new PublicKey(input.programId),
    keys: input.accounts.map((key) => ({ pubkey: new PublicKey(key.address), isSigner: key.signer, isWritable: key.writable })),
    data: Buffer.from(input.dataBase64, "base64"),
  });
}

/**
 * The two accounts every create_v2 write-locks, shared with every other pump.fun create: the Mayhem program account
 * and the Mayhem SOL vault (writable in Pump's IDL even with mayhem off). The coin's priority fee is sampled on them;
 * a fresh creator wallet alone has no fee history, so it priced at the floor while competing creates cleared at
 * about 100,000-200,000 micro-lamports (mainnet, 2026-10-29).
 */
export const PUMP_SHARED_WRITE_LOCKS = Object.freeze([
  new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e"), new PublicKey("BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"),
]);
/** Priority-fee bounds in micro-lamports per compute unit: 200,000 x a 250k-unit coin limit is 0.00005 SOL. */
export const MIN_MICRO_LAMPORTS = 1_000, MAX_MICRO_LAMPORTS = 200_000;
/**
 * Compute units added on top of 1.2 x the simulated use, so wallet assertions can never exhaust the limit (an
 * exhausted limit fails the wallet's own simulation, which is its red warning). Measured on mainnet: the payer
 * AssertAccountInfoMulti 1,818 units, a token-account assertion 4,954 (SPL), 4,971 (Token-2022 coin) or 7,973
 * (Token-2022 stock) units; nine assertions (the most reported: the payer and eight stock-account assertions) are
 * about 65,600 units. The smallest coin uses about 105,800 units, so 0.2 x 105,800 + 50,000 = 71,000 units are
 * left; the card's 100,000 floor leaves about 73,500.
 */
export const GUARD_COMPUTE_MARGIN = 50_000;
const TABLE_ADDRESS = new PublicKey(PUMP_LOOKUP_TABLE.address);
/** Fills every unpinned table slot, so compiling can only use pinned entries. No transaction account has this key. */
const UNPINNED_SLOT = new PublicKey(new Uint8Array(32).fill(255));
const NEVER_DEACTIVATED = 0xffff_ffff_ffff_ffffn;
/**
 * The pinned pump.fun lookup table as a compile input, from a fresh read of its account: owned by the lookup-table
 * program, never deactivated and holding every pinned entry at its pinned index. Null when anything differs, so the
 * transaction is built without it.
 */
export function pinnedLookupTable(account: AccountInfo<Buffer> | null): AddressLookupTableAccount | null {
  if (!account || account.executable || !account.owner.equals(AddressLookupTableProgram.programId)) return null;
  let state: AddressLookupTableAccount["state"];
  try { state = AddressLookupTableAccount.deserialize(account.data); } catch { return null; }
  if (BigInt(state.deactivationSlot) !== NEVER_DEACTIVATED || PUMP_LOOKUP_TABLE.entries.some(([index, address]) => state.addresses[index]?.toBase58() !== address)) return null;
  const addresses = Array.from({ length: Math.max(...PUMP_LOOKUP_TABLE.entries.map(([index]) => index)) + 1 }, () => UNPINNED_SLOT);
  for (const [index, address] of PUMP_LOOKUP_TABLE.entries) addresses[index] = new PublicKey(address);
  return new AddressLookupTableAccount({ key: TABLE_ADDRESS, state: { ...state, addresses } });
}
function compileWalletTransaction(payer: PublicKey, blockhash: string, units: number, microLamports: number, instructions: TransactionInstruction[], table: AddressLookupTableAccount | null = null) {
  return new VersionedTransaction(new TransactionMessage({
    payerKey: payer, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports }), ...instructions],
  }).compileToV0Message(table ? [table] : []));
}
/** The pinned table from one fresh read, or null (the transaction is then built without it) when the read fails. */
async function readPinnedTable(connection: Pick<LiveConnection, "getAccountInfo">) {
  return pinnedLookupTable(await connection.getAccountInfo(TABLE_ADDRESS, "confirmed").catch(() => null));
}
/**
 * Solana refuses a transaction that leaves its fee payer holding 1 to 890,879 lamports, the rent for a 0-byte account,
 * so the wallet must keep at least this much after a launch transaction (WW-3).
 */
export const RENT_EXEMPT_MINIMUM_LAMPORTS = 890_880n;
const SHORT_OF_SOL = `Insufficient SOL: add SOL to this wallet. Solana requires it to keep at least ${RENT_EXEMPT_MINIMUM_LAMPORTS} lamports (0.00089 SOL) after this transaction`;
/** A simulation that failed only because the fee payer is short of SOL, as plain words; null for any other failure. */
function shortOfSol(err: unknown): string | null {
  if (err === "InsufficientFundsForFee") return SHORT_OF_SOL;
  const rent = (err as { InsufficientFundsForRent?: { account_index?: unknown } } | null)?.InsufficientFundsForRent;
  return rent && rent.account_index === 0 ? SHORT_OF_SOL : null;
}
/** The three wallet transactions: the coin, its card, and the optional creator fee split after both. */
export type PlanKind = "token" | "nft" | "fees";
function oversizeError(kind: PlanKind, bytes: number, advice: string[] = []) {
  return new Error(`${kind === "token" ? "Launch" : kind === "nft" ? "Card" : "Fee split"} transaction is ${bytes} bytes and exceeds the ${WALLET_SIZE_TARGET}-byte wallet limit (Solana's ${PACKET_LIMIT}-byte packet limit less ${WALLET_GUARD_RESERVE_BYTES} bytes for wallet safety checks)${advice.length ? `; ${advice.join(", or ")}` : ""}`);
}
const shortVec = (length: number) => length < 0x80 ? 1 : length < 0x4000 ? 2 : 3;
/** Exact signed wire size, also past the packet limit where web3.js serialization overruns. */
export function transactionBytes(message: VersionedMessage): number {
  const signers = message.header.numRequiredSignatures;
  const instructions = message.compiledInstructions.reduce((total, ix) => total + 1 + shortVec(ix.accountKeyIndexes.length) + ix.accountKeyIndexes.length + shortVec(ix.data.length) + ix.data.length, 0);
  const lookups = message.addressTableLookups.reduce((total, lookup) => total + 32 + shortVec(lookup.writableIndexes.length) + lookup.writableIndexes.length + shortVec(lookup.readonlyIndexes.length) + lookup.readonlyIndexes.length, 0);
  return shortVec(signers) + 64 * signers + (message.version === 0 ? 1 : 0) + 3 + shortVec(message.staticAccountKeys.length) + 32 * message.staticAccountKeys.length + 32 +
    shortVec(message.compiledInstructions.length) + instructions + (message.version === 0 ? shortVec(message.addressTableLookups.length) + lookups : 0);
}

const PAYER_DEBITS = new Set(["transfer", "createAccount", "createAccountWithSeed", "transferWithSeed"]);
/**
 * SOL the payer sends in a simulation: the System transfers and account creations it funds (only the System program
 * can debit a system-owned wallet), from the RPC's parsed inner instructions. Null when the RPC returned none, or
 * anything unreadable, so the caller falls back to comparing balances.
 */
export function simulatedPayerOutflow(inner: ParsedInnerInstruction[] | null | undefined, payer: string): bigint | null {
  if (!Array.isArray(inner)) return null;
  let total = 0n;
  for (const group of inner) for (const ix of group.instructions ?? []) {
    if (!("parsed" in ix) || ix.program !== "system" || !PAYER_DEBITS.has(ix.parsed?.type) || ix.parsed?.info?.source !== payer) continue;
    const amount = ix.parsed.info.lamports;
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
    total += BigInt(amount);
  }
  return total;
}

async function makeWalletPlan<K extends PlanKind>(input: LiveLaunchInput, kind: K, instructions: TransactionInstruction[],
  minimumTokensOut: string, options: LiveOptions, extra: { feeRecipients?: readonly FeeRecipient[] } = {}) {
  const id = identity(input), connection = options.connection;
  const [latest, payerAccount, prioritySamples, preparedBlockHeight] = await Promise.all([
    connection.getLatestBlockhash("confirmed"),
    connection.getAccountInfoAndContext(id.creator, "confirmed"),
    // The coin competes for the write locks every pump.fun create takes; the card has none, so its creator alone. The
    // fee split also write-locks the coin's curve, which its trades write.
    connection.getRecentPrioritizationFees({ lockedWritableAccounts: kind === "token" ? [...PUMP_SHARED_WRITE_LOCKS] : kind === "fees" ? [id.creator, bondingCurvePda(id.mint)] : [id.creator] }),
    connection.getBlockHeight("confirmed"),
  ]);
  const payerBefore = safeLamports(payerAccount.value?.lamports ?? 0, "Wallet balance");
  const fees = prioritySamples.map((sample) => sample.prioritizationFee).filter((fee) => Number.isSafeInteger(fee) && fee >= 0).sort((a, b) => a - b);
  const microLamports = Math.min(MAX_MICRO_LAMPORTS, Math.max(MIN_MICRO_LAMPORTS, fees[Math.floor(fees.length * 0.75)] ?? MIN_MICRO_LAMPORTS));
  // Every coin transaction is compiled against pump.fun's own create lookup table, as pump.fun's own creates are (WW-4):
  // it keeps the coin far from the packet limit, with room for wallet assertions. The table is read fresh and checked
  // first; when anything differs the transaction is built without it. Never used for the card. The fee split uses it too:
  // without it no split with the config create fits under the wallet size target.
  const table = kind !== "nft" ? await readPinnedTable(connection) : null;
  const sized = (ixs: TransactionInstruction[]) => transactionBytes(compileWalletTransaction(id.creator, latest.blockhash, 1_400_000, microLamports, ixs, table).message);
  const compile = (limit: number) => compileWalletTransaction(id.creator, latest.blockhash, limit, microLamports, instructions, table);
  const first = compile(1_400_000);
  // The final guard. measureTokenTransaction lets the app refuse a non-fitting buy before anything is uploaded.
  const packetBytes = transactionBytes(first.message);
  if (packetBytes > WALLET_SIZE_TARGET) {
    if (kind === "nft") throw oversizeError("nft", packetBytes);
    if (kind === "fees") throw oversizeError("fees", packetBytes, ["choose fewer wallets"]);
    // Advice only where it can work: the coin alone (the create is the first instruction), or this transaction with
    // the shortest name and symbol (1 byte each).
    throw oversizeError("token", packetBytes, [
      ...(id.buy > 0n && sized(instructions.slice(0, 1)) <= WALLET_SIZE_TARGET ? ["launch without an initial buy"] : []),
      ...(packetBytes - (Buffer.byteLength(input.name, "utf8") - 1) - (input.symbol.length - 1) <= WALLET_SIZE_TARGET ? ["use a shorter name or symbol"] : []),
    ]);
  }
  const firstSimulation = await connection.simulateTransaction(first, {
    sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [input.creator] },
  });
  if (firstSimulation.value.err) throw new Error(shortOfSol(firstSimulation.value.err) ?? `Transaction simulation failed: ${JSON.stringify(firstSimulation.value.err)}`);
  const consumed = firstSimulation.value.unitsConsumed;
  if (!consumed || !Number.isSafeInteger(consumed) || consumed > 1_400_000) throw new Error("RPC did not return a valid compute estimate");
  const computeUnitLimit = Math.min(1_400_000, Math.max(100_000, Math.ceil(consumed * 1.2) + GUARD_COMPUTE_MARGIN));
  const transaction = compile(computeUnitLimit);
  const [simulation, fee] = await Promise.all([
    connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed", innerInstructions: true,
      accounts: { encoding: "base64", addresses: [input.creator] } }),
    connection.getFeeForMessage(transaction.message, "confirmed"),
  ]);
  if (simulation.value.err) throw new Error(shortOfSol(simulation.value.err) ?? `Final transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
  if (fee.value === null) throw new Error("RPC could not price this transaction");
  const payerAfterAccount = simulation.value.accounts?.[0];
  if (!payerAfterAccount) throw new Error("RPC did not return the simulated wallet balance");
  const payerAfter = safeLamports(payerAfterAccount.lamports, "Simulated wallet balance");
  const totalFee = safeLamports(fee.value, "Network fee");
  const priorityFee = (BigInt(computeUnitLimit) * BigInt(microLamports) + 999_999n) / 1_000_000n;
  // The debit from the final simulation itself (its post-balance already carries the fee): one slot, so a balance that
  // moved between the earlier read and the simulation cannot skew the review or the balance check.
  const outflow = simulatedPayerOutflow(simulation.value.innerInstructions, input.creator);
  const debit = outflow !== null ? outflow + totalFee : payerBefore > payerAfter ? payerBefore - payerAfter : 0n;
  const totalDebit = debit > totalFee ? debit : totalFee;
  const balance = outflow !== null ? payerAfter + debit : payerBefore;
  const nativeBuy = kind === "token" && id.asset.key === "sol" ? id.buy : 0n;
  const rentAndProgram = totalDebit > totalFee + nativeBuy ? totalDebit - totalFee - nativeBuy : 0n;
  // What the wallet must keep afterwards: Solana's rent minimum, so the reviewed balance check agrees with the runtime.
  const reserveBuffer = RENT_EXEMPT_MINIMUM_LAMPORTS;
  if (balance < totalDebit + reserveBuffer) throw new Error(`Insufficient SOL: keep at least ${(totalDebit + reserveBuffer).toString()} lamports for this transaction and the minimum Solana requires the wallet to keep`);
  const requiredSigners = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map((key) => key.toBase58());
  // The fee split is the creator's alone: no new address, so nothing for this page to co-sign.
  if (kind === "fees" ? requiredSigners.length !== 1 || requiredSigners[0] !== input.creator
    : requiredSigners.length !== 2 || !requiredSigners.includes(input.creator) || !requiredSigners.includes(kind === "token" ? input.mint : input.nftMint)) throw new Error("Unexpected transaction signer set");
  const serialized = transaction.serialize();
  return immutable({
    kind, network: "solana:mainnet" as const, status: "wallet-signature-required" as const,
    transactionBase64: Buffer.from(serialized).toString("base64"),
    messageSha256: digest(transaction.message.serialize()),
    blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
    // The signing window: this blockhash stops landing after lastValidBlockHeight - preparedBlockHeight more blocks.
    preparedBlockHeight: Math.min(preparedBlockHeight, latest.lastValidBlockHeight),
    requiredSigners, feePayer: input.creator, bindingSha256: id.bindingSha256,
    verifiedSlot: Math.max(payerAccount.context.slot, simulation.context.slot),
    preparedAt: (options.now?.() ?? new Date()).toISOString(),
    instructionPrograms: [...new Set(transaction.message.compiledInstructions.map((ix) => transaction.message.staticAccountKeys[ix.programIdIndex].toBase58()))],
    instructionSummary: kind === "token" ? ["Create pump.fun Token-2022 coin", ...(id.buy > 0n ? ["Buy with the selected quote asset"] : [])]
      : kind === "nft" ? ["Create separate Core NFT owned by creator", "Permanently remove metadata update authority"]
        : ["Collect creator fees earned so far into your own pump.fun creator vault", "Set this coin's permanent pump.fun creator fee split"],
    review: {
      quoteKey: id.asset.key, quoteMint: id.asset.mint, quoteDecimals: id.asset.decimals, tokenDecimals: 6,
      initialBuyQuoteBaseUnits: kind === "token" ? id.buy.toString() : "0",
      launchInitialBuyQuoteBaseUnits: id.buy.toString(), minimumTokensOut,
      networkFeeLamports: (totalFee > priorityFee ? totalFee - priorityFee : 0n).toString(),
      priorityFeeLamports: priorityFee.toString(), rentAndProgramCostLamports: rentAndProgram.toString(),
      totalDebitLamports: totalDebit.toString(), reserveBufferLamports: reserveBuffer.toString(),
      walletBalanceLamports: balance.toString(), computeUnitLimit, microLamportsPerComputeUnit: microLamports,
      // The signed wire size equals this unsigned one: both signature slots are already in the bytes.
      transactionBytes: serialized.length, packetLimit: PACKET_LIMIT, walletSizeTarget: WALLET_SIZE_TARGET,
      lookupTable: transaction.message.addressTableLookups.length ? PUMP_LOOKUP_TABLE.address : null,
      ...(extra.feeRecipients ? { feeRecipients: extra.feeRecipients.map((entry) => ({ address: entry.address, bps: entry.bps })) } : {}),
    },
  });
}
/** A coin or card plan (two signers: the creator and the new address this page holds). */
export type WalletTransactionPlan = Awaited<ReturnType<typeof makeWalletPlan<"token" | "nft">>>;
/** The creator fee split plan (one signer: the creator). */
export type FeeSharePlan = Awaited<ReturnType<typeof makeWalletPlan<"fees">>>;
/** Any plan the shared signature, pre-send and relay checks take. */
export type AnyWalletPlan = WalletTransactionPlan | FeeSharePlan;

type PumpGlobal = ReturnType<typeof PUMP_SDK.decodeGlobal>;
type PumpQuoteControl = ReturnType<typeof PUMP_SDK.decodeQuoteControl>;
/**
 * The curve create_v2 makes for this launch, for the first-buy estimate: its custom creator fee rate when one was chosen
 * (the buy's fee follows it), and for holder rewards the coin's holderRewardsPda as creator, as the program sets it.
 */
function launchCurve(global: PumpGlobal, quoteControl: PumpQuoteControl, quoteMint: PublicKey, creator: PublicKey, mint: PublicKey, options: CreateOptions = {}) {
  return { ...newBondingCurve(global, quoteMint, quoteControl, options.creatorFeeBps ? new BN(options.creatorFeeBps) : undefined, options.holderReward === true),
    creator: options.holderReward ? holderRewardsPda(mint) : creator, isMayhemMode: false };
}
/** Throws unless a create_v2 instruction's data ends with exactly the flag bytes these options make (create-options.ts). */
export function assertCreateFlags(data: Uint8Array, options: CreateOptions) {
  const tail = data.subarray(data.length - 11), expected = createV2FlagTail(options);
  if (data.length < 11 || tail.some((byte, index) => byte !== expected[index])) throw new Error("The coin's create options differ from the ones chosen for this launch");
}
/** The initial buy as the wallet receives it: base ATA, the buyback ATA on token quotes, then buy_exact_quote_in_v3. */
async function firstBuyInstructions(keys: { mint: PublicKey; creator: PublicKey; quoteMint: PublicKey; quoteTokenProgram: PublicKey },
  global: PumpGlobal, curve: ReturnType<typeof launchCurve>, buy: bigint, estimate: BN, minimumTokensOut: string) {
  const buybackFeeRecipient = global.buybackFeeRecipients.find((key) => !key.equals(PublicKey.default));
  const firstBuy = await PUMP_SDK.buyExactQuoteInV3Instructions({
    mint: keys.mint, user: keys.creator, bondingCurve: curve, associatedUserAccountInfo: null,
    amount: estimate, quoteAmount: new BN(buy.toString()), slippage: 0,
    quoteTokenProgram: keys.quoteTokenProgram, tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackFeeRecipient,
  });
  // The convenience builder rounds percentages to tenths. Use its public raw
  // instruction builder for the exact integer-bps minimum shown in review.
  firstBuy[firstBuy.length - 1] = await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({
    mint: keys.mint, user: keys.creator, spendableQuoteIn: new BN(buy.toString()),
    minTokensOut: new BN(minimumTokensOut), quoteMint: keys.quoteMint,
    quoteTokenProgram: keys.quoteTokenProgram, tokenProgram: TOKEN_2022_PROGRAM_ID,
    buybackFeeRecipient, partialFill: false,
  });
  return firstBuy;
}
// The SDK emits idempotent ATA creation even when an ATA already exists.
// Removing only a freshly verified matching ATA saves its owner key and
// setup bytes, allowing many custom-quote creates + first buys to stay atomic.
async function withoutExistingSetup(connection: Pick<LiveConnection, "getMultipleAccountsInfoAndContext">, instructions: TransactionInstruction[]) {
  const setup = instructions.filter((ix) => ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 1);
  const omit = new Set<TransactionInstruction>();
  if (setup.length) {
    const snapshot = await connection.getMultipleAccountsInfoAndContext(setup.map((ix) => ix.keys[1].pubkey), "confirmed");
    setup.forEach((ix, index) => {
      const account = snapshot.value[index];
      if (!account) return;
      const decoded = unpackAccount(ix.keys[1].pubkey, account, ix.keys[5].pubkey);
      if (!decoded.isInitialized || decoded.isFrozen || !decoded.owner.equals(ix.keys[2].pubkey) || !decoded.mint.equals(ix.keys[3].pubkey)) throw new Error("An existing token account is incompatible with the initial buy");
      omit.add(ix);
    });
  }
  return instructions.filter((ix) => !omit.has(ix));
}

/** Real unsigned v0 transaction. This function never signs or sends it. */
export async function prepareTokenTransaction(input: LiveLaunchInput, options: LiveOptions): Promise<WalletTransactionPlan> {
  const id = identity(input), connection = options.connection;
  const validated = await preparePumpLaunchPlan(input, { connection, now: options.now });
  const instructions = [decodeInstruction(validated.createInstruction)];
  // The server's own check of the create flags (the browser repeats it before the wallet opens): exactly the chosen ones.
  assertCreateFlags(instructions[0].data, id.options);
  let minimumTokensOut = "0";
  if (id.buy > 0n && validated.quoteIssuerControls.permanentDelegate && !ALLOW_PERMANENT_DELEGATE_QUOTE_BUY) throw new Error(PERMANENT_DELEGATE_BUY_REFUSAL);
  if (id.buy > 0n) {
    const quoteAta = getAssociatedTokenAddressSync(id.quoteMint, id.creator, false, new PublicKey(id.asset.tokenProgram));
    const fresh = await connection.getMultipleAccountsInfoAndContext([GLOBAL_PDA, QUOTE_CONTROL_PDA, PUMP_FEE_CONFIG_PDA, quoteAta], "confirmed");
    const [globalInfo, quoteControlInfo, feeInfo, quoteAccount] = fresh.value;
    if (!globalInfo?.owner.equals(PUMP_PROGRAM_ID) || !quoteControlInfo?.owner.equals(PUMP_PROGRAM_ID) || !feeInfo?.owner.equals(PUMP_FEE_PROGRAM_ID)) throw new Error("Current Pump price/fee accounts are unavailable");
    const global = PUMP_SDK.decodeGlobal(globalInfo), quoteControl = PUMP_SDK.decodeQuoteControl(quoteControlInfo);
    const feeConfig = PUMP_SDK.decodeFeeConfig(feeInfo);
    if (id.asset.key !== "sol") {
      if (!quoteAccount) throw new Error(`Your wallet needs ${id.asset.symbol} before its initial buy`);
      const account = unpackAccount(quoteAta, quoteAccount, new PublicKey(id.asset.tokenProgram));
      if (!account.owner.equals(id.creator) || !account.mint.equals(id.quoteMint) || account.isFrozen || account.amount < id.buy) throw new Error(`Insufficient or frozen ${id.asset.symbol} quote balance`);
    }
    const curve = launchCurve(global, quoteControl, id.quoteMint, id.creator, id.mint, id.options);
    const estimate = getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: global.tokenTotalSupply,
      bondingCurve: curve, amount: new BN(id.buy.toString()), curveBaseTokenBalance: global.tokenTotalSupply });
    if (estimate.lten(0)) throw new Error("The selected initial buy is too small to receive any token units");
    minimumTokensOut = estimate.muln(10_000 - id.slippageBps).divn(10_000).toString();
    if (minimumTokensOut === "0") throw new Error("The slippage-adjusted initial buy would receive zero token units");
    instructions.push(...await firstBuyInstructions({ mint: id.mint, creator: id.creator, quoteMint: id.quoteMint,
      quoteTokenProgram: new PublicKey(id.asset.tokenProgram) }, global, curve, id.buy, estimate, minimumTokensOut));
  }
  return makeWalletPlan(input, "token", await withoutExistingSetup(connection, instructions), minimumTokensOut, options);
}

// Placeholders only change key and hash values, never the wire size: a mint signer and a blockhash are 32 bytes each.
const SIZE_MINT = new PublicKey(new Uint8Array(32).fill(7)), SIZE_BLOCKHASH = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
export type TokenSizeInput = { creator: string; name: string; symbol: string; tokenMetadataUri: string; quoteKey: PairKey; holderReward?: boolean; creatorFeeBps?: number };
/**
 * Exact wire size of the coin transaction prepareTokenTransaction builds, with and without an initial buy, from the
 * same builders, the real Pump accounts, the same lookup-table choice and a metadata URI of the final length. The buy
 * amount never changes the size. Existing ATAs are omitted exactly as prepare omits them; any other ATA create is
 * counted. `limit` is the wallet size target prepare enforces. `buyBlocked` names a quote whose first buy prepare
 * refuses for another reason ("issuer-controls": a permanent-delegate stock quote). No blockhash, signing or send.
 */
export async function measureTokenTransaction(input: TokenSizeInput, options: { connection: Pick<LiveConnection, "getMultipleAccountsInfoAndContext"> }) {
  const asset = PAIR_ASSETS.find((candidate) => candidate.key === input.quoteKey);
  if (!asset) throw new Error("Choose a verified CardDex pair asset");
  const creator = publicKey(input.creator, "creator"), quoteMint = new PublicKey(asset.mint), quoteTokenProgram = new PublicKey(asset.tokenProgram);
  const tokenMetadataUri = reviewTokenFields(input);
  // The options never change the size (create_v2 always carries all 11 flag bytes); built with them all the same.
  const createOptions = readCreateOptions(input);
  const create = await PUMP_SDK.createV2Instruction({ mint: SIZE_MINT, user: creator, creator, name: input.name, symbol: input.symbol,
    uri: tokenMetadataUri, quoteMint, quoteTokenProgram, ...createV2Flags(createOptions) });
  const snapshot = await options.connection.getMultipleAccountsInfoAndContext([GLOBAL_PDA, QUOTE_CONTROL_PDA, TABLE_ADDRESS, quoteMint], "confirmed");
  const [globalInfo, quoteControlInfo, tableInfo, quoteInfo] = snapshot.value;
  if (!globalInfo?.owner.equals(PUMP_PROGRAM_ID) || !quoteControlInfo?.owner.equals(PUMP_PROGRAM_ID)) throw new Error("Current Pump accounts are unavailable");
  if (!quoteInfo?.owner.equals(quoteTokenProgram)) throw new Error("The pair mint account is unavailable");
  const global = PUMP_SDK.decodeGlobal(globalInfo), quoteControl = PUMP_SDK.decodeQuoteControl(quoteControlInfo);
  const issuerControls = quoteIssuerControls(unpackMint(quoteMint, quoteInfo, quoteTokenProgram));
  const buy = await withoutExistingSetup(options.connection, [create, ...await firstBuyInstructions({ mint: SIZE_MINT, creator, quoteMint, quoteTokenProgram },
    global, launchCurve(global, quoteControl, quoteMint, creator, SIZE_MINT, createOptions), 1n, new BN(1), "1")]);
  const table = pinnedLookupTable(tableInfo ?? null);
  const bytes = (instructions: TransactionInstruction[]) => transactionBytes(compileWalletTransaction(creator, SIZE_BLOCKHASH, 1_400_000, 1_000, instructions, table).message);
  return { limit: WALLET_SIZE_TARGET, packetLimit: PACKET_LIMIT, createBytes: bytes([create]), buyBytes: bytes(buy), lookupTable: !!table,
    buyBlocked: issuerControls.permanentDelegate && !ALLOW_PERMANENT_DELEGATE_QUOTE_BUY ? "issuer-controls" as const : null };
}

/**
 * What pump.fun's Global allows for the create options right now (holder rewards; a custom creator fee rate and its
 * maximum), from one read of Global. Read-only; prepare re-checks the same Global before building the coin.
 */
export async function readCreateOptionsGlobal(options: { connection: Pick<LiveConnection, "getAccountInfo"> }) {
  const info = await options.connection.getAccountInfo(GLOBAL_PDA, "confirmed");
  if (!info?.owner.equals(PUMP_PROGRAM_ID)) throw new Error("Current Pump accounts are unavailable");
  const global = PUMP_SDK.decodeGlobal(info);
  if (!global.createV2Enabled) return { holderRewards: false, creatorFeeConfigurable: false, maxCreatorFeeBps: 0 };
  return createOptionsGlobal(global);
}

function coreAttributes(input: LiveLaunchInput) {
  const id = identity(input);
  return [
    { key: "token_mint", value: input.mint }, { key: "quote_mint", value: id.asset.mint },
    { key: "card_design", value: input.card.designKey }, { key: "binding_sha256", value: id.bindingSha256 },
    { key: "card_sha256", value: input.renderedCardSha256! },
    { key: "metadata_sha256", value: input.nftMetadataSha256! },
  ];
}
export function creatorNftInstructions(input: LiveLaunchInput): TransactionInstruction[] {
  const id = identity(input);
  const payer = createNoopSigner(umiPublicKey(input.creator));
  const asset = createNoopSigner(umiPublicKey(input.nftMint));
  const umi = createUmi(PUBLIC_MAINNET_RPC).use(mplCore()).use(signerIdentity(payer));
  const builder = createCoreAsset(umi, { asset, payer, authority: payer,
    owner: umiPublicKey(input.creator), updateAuthority: umiPublicKey(input.creator),
    name: id.nftName, uri: input.card.nftMetadataUri,
    plugins: [{ type: "Attributes", attributeList: coreAttributes(input), authority: { type: "None" } }],
  }).add(updateV1(umi, { asset: umiPublicKey(input.nftMint), payer, authority: payer,
    newUpdateAuthority: { __kind: "None" } }));
  return builder.getInstructions().map(toWeb3JsInstruction);
}

function signedTransactionDetails(transaction: VersionedTransactionResponse, expectedMessageSha256?: string) {
  if (!transaction.meta) throw new Error("The finalized transaction has no status");
  if (transaction.meta.err) throw new TransactionFailedOnChain(transaction.meta.err);
  const message = transaction.transaction.message;
  const messageSha256 = digest(message.serialize());
  if (expectedMessageSha256 && expectedMessageSha256 !== messageSha256) throw new Error("The finalized transaction message differs from the approved plan");
  const keys = message.getAccountKeys({ accountKeysFromLookups: transaction.meta.loadedAddresses });
  const all = message.compiledInstructions.map((ix) => ({
    programId: keys.get(ix.programIdIndex)!, program: keys.get(ix.programIdIndex)!.toBase58(),
    accounts: ix.accountKeyIndexes.map((index) => keys.get(index)!), data: Buffer.from(ix.data),
  }));
  // Wallet assertions count only inside the message the server validated before relaying (its hash is the expected
  // one): then each must be a read-only Lighthouse assertion, wherever it sits, and the rest is checked as planned.
  let instructions: typeof all;
  const keyList = Array.from({ length: keys.length }, (_, index) => keys.get(index)!.toBase58());
  try { instructions = withoutWalletGuards(all.map((ix) => ({ ...ix, accounts: ix.accounts.map((key) => key.toBase58()), source: ix })), !!expectedMessageSha256, keyList).map((ix) => ix.source); }
  catch { throw new Error("Finalized transaction contains unexpected wallet instructions"); }
  return { message, messageSha256, keys, instructions, walletGuards: all.length - instructions.length };
}

function matchesInstruction(actual: ReturnType<typeof signedTransactionDetails>["instructions"][number], expected: TransactionInstruction) {
  return actual.programId.equals(expected.programId) && actual.data.equals(expected.data) &&
    actual.accounts.length === expected.keys.length && actual.accounts.every((key, index) => key.equals(expected.keys[index].pubkey));
}
function receiptIdentity(input: LiveLaunchInput) {
  const id = identity(input);
  return { creatorWallet: input.creator, tokenMint: input.mint, quoteMint: id.asset.mint,
    nftMint: input.nftMint, bindingSha256: id.bindingSha256 };
}
async function finalizedTransaction(connection: LiveConnection, signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) throw new Error("Invalid transaction signature");
  const [transaction, status] = await Promise.all([
    connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
    connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
  ]);
  const state = status.value[0];
  if (state?.err) throw new TransactionFailedOnChain(state.err);
  return transaction && state?.confirmationStatus === "finalized" ? transaction : null;
}

/** The coin's sharing config as finalized at or after `minContextSlot`, when it is pump-fees' own, for this coin and administered by its creator; else null. */
async function creatorSharingConfig(connection: LiveConnection, id: { mint: PublicKey; creator: PublicKey }, minContextSlot: number): Promise<SharingConfig | null> {
  const account = await connection.getAccountInfoAndContext(feeSharingConfigPda(id.mint), { commitment: "finalized", minContextSlot });
  if (!account.value || account.value.executable || !account.value.owner.equals(PUMP_FEE_PROGRAM_ID)) return null;
  let config: SharingConfig;
  try { config = PUMP_SDK.decodeSharingConfig(account.value); } catch { return null; }
  return config.mint.equals(id.mint) && config.admin.equals(id.creator) ? config : null;
}

export async function verifyTokenLaunch(input: LiveLaunchInput, options: VerifyOptions) {
  const id = identity(input), connection = options.connection;
  await assertMainnet(connection);
  if (!options.signature) return { status: "pending" as const, ...receiptIdentity(input) };
  const transaction = await finalizedTransaction(connection, options.signature);
  if (!transaction) return { status: "pending" as const, signature: options.signature, ...receiptIdentity(input) };
  const details = signedTransactionDetails(transaction, options.expectedMessageSha256);
  const allowedPrograms = new Set([PUMP_PROGRAM_ID.toBase58(), ComputeBudgetProgram.programId.toBase58(), "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]);
  if (details.instructions.some((ix) => !allowedPrograms.has(ix.programId.toBase58()))) throw new Error("Finalized token launch contains an unexpected outer program");
  const expectedCreate = await PUMP_SDK.createV2Instruction({ mint: id.mint, creator: id.creator, user: id.creator,
    name: input.name, symbol: input.symbol, uri: input.tokenMetadataUri, ...createV2Flags(id.options),
    quoteMint: id.quoteMint, quoteTokenProgram: new PublicKey(id.asset.tokenProgram) });
  const matches = details.instructions.filter((ix) => matchesInstruction(ix, expectedCreate));
  const signers = details.message.staticAccountKeys.slice(0, details.message.header.numRequiredSignatures).map((key) => key.toBase58());
  if (matches.length !== 1 || details.keys.get(0)?.toBase58() !== input.creator || !signers.includes(input.creator) || !signers.includes(input.mint)) {
    throw new Error("Finalized transaction does not contain the exact creator/token/quote/metadata create instruction");
  }
  const pumpInstructions = details.instructions.filter((ix) => ix.programId.equals(PUMP_PROGRAM_ID));
  if (id.buy > 0n) {
    const firstBuy = pumpInstructions.find((ix) => ix.data.subarray(0, 8).toString("hex") === "e1f7501ed5b38488");
    if (pumpInstructions.length !== 2 || !firstBuy || firstBuy.data.length !== 25 || firstBuy.data.readBigUInt64LE(8) !== id.buy ||
      firstBuy.data.readBigUInt64LE(16) === 0n || firstBuy.data[24] !== 0 || firstBuy.accounts.length !== 17 ||
      !firstBuy.accounts[1].equals(id.mint) || !firstBuy.accounts[2].equals(id.quoteMint) ||
      !firstBuy.accounts[3].equals(TOKEN_2022_PROGRAM_ID) || !firstBuy.accounts[4].equals(new PublicKey(id.asset.tokenProgram)) ||
      !firstBuy.accounts[8].equals(id.creator)) throw new Error("Finalized launch does not contain the exact selected-quote initial buy");
  } else if (pumpInstructions.length !== 1) throw new Error("Finalized launch contains an unapproved Pump instruction");
  const accounts = await connection.getMultipleAccountsInfoAndContext([id.mint, bondingCurvePda(id.mint)], { commitment: "finalized", minContextSlot: transaction.slot });
  const [mintInfo, curveInfo] = accounts.value;
  if (!mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID) || !curveInfo?.owner.equals(PUMP_PROGRAM_ID)) throw new Error("Created token/curve accounts are missing or have unexpected owners");
  const mintState = unpackMint(id.mint, mintInfo, TOKEN_2022_PROGRAM_ID);
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  const expectedStoredQuote = id.asset.key === "sol" ? PublicKey.default : id.quoteMint;
  // After the creator's fee split the curve's creator is the coin's sharing config, never anyone else's: accepted only
  // when that config exists, is pump-fees' own, is for this coin and keeps the creator as its admin (it stays the
  // admin after the split locks, verified by mainnet simulation).
  // A holder-rewards coin (chosen and saved with the launch): its creator is the coin's holderRewardsPda, set by pump.fun
  // for good, and accepted only then. Every other coin must not be one.
  const creatorOk = id.options.holderReward
    ? curve.isHolderReward && curve.creator.equals(holderRewardsPda(id.mint))
    : !curve.isHolderReward && (curve.creator.equals(id.creator) || curve.creator.equals(feeSharingConfigPda(id.mint)) && !!await creatorSharingConfig(connection, id, transaction.slot));
  // The coin's own creator fee rate: the chosen one, or 0 (pump.fun's standard rate) when none was chosen.
  const rateOk = (curve.creatorFeeBps ? BigInt(curve.creatorFeeBps.toString()) : 0n) === BigInt(id.options.creatorFeeBps ?? 0);
  if (!mintState.isInitialized || mintState.decimals !== 6 || !creatorOk || !rateOk || !curve.quoteMint.equals(expectedStoredQuote) || curve.isMayhemMode) {
    throw new Error("Finalized token state differs from the creator and selected pair");
  }
  const metadata = await getTokenMetadata(connection as Connection, id.mint, "finalized", TOKEN_2022_PROGRAM_ID);
  if (!metadata || metadata.name !== input.name || metadata.symbol !== input.symbol || metadata.uri !== input.tokenMetadataUri) throw new Error("Created token metadata differs from the approved launch");
  return { status: "verified" as const, signature: options.signature, slot: transaction.slot,
    messageSha256: details.messageSha256, ...receiptIdentity(input) };
}

function verifyCoreAccount(input: LiveLaunchInput, account: AccountInfo<Buffer>) {
  const id = identity(input);
  if (!account.owner.equals(CORE_PROGRAM_ID) || account.executable) throw new Error("NFT address is not a Metaplex Core asset");
  const asset = deserializeAssetV1({ publicKey: umiPublicKey(input.nftMint), owner: umiPublicKey(CORE_PROGRAM_ID.toBase58()),
    executable: false, lamports: lamports(safeLamports(account.lamports, "Core rent")), data: account.data });
  if (asset.owner !== input.creator || asset.name !== id.nftName || asset.uri !== input.card.nftMetadataUri || asset.updateAuthority.type !== "None") throw new Error("Core NFT ownership or immutable metadata differs from the creator card");
  if (asset.royalties || asset.updateDelegate || asset.permanentTransferDelegate || asset.permanentBurnDelegate || asset.permanentFreezeDelegate || asset.freezeDelegate || asset.transferDelegate || asset.burnDelegate || asset.oracles || asset.lifecycleHooks) throw new Error("Creator NFT has unexpected royalty/delegate/external plugins");
  const actual = asset.attributes;
  if (!actual || actual.authority.type !== "None" || actual.attributeList.length !== coreAttributes(input).length ||
    !coreAttributes(input).every((expected) => actual.attributeList.some((entry) => entry.key === expected.key && entry.value === expected.value))) throw new Error("Core NFT is missing its immutable token/design/quote binding");
  if (!asset.pluginHeader) throw new Error("Core NFT plugin registry is missing");
  const [registry] = getPluginRegistryV1AccountDataSerializer().deserialize(account.data, Number(asset.pluginHeader.pluginRegistryOffset));
  if (registry.registry.length !== 1 || (registry.registry[0] as { isUnknown?: boolean }).isUnknown || registry.registry[0].pluginType !== PluginType.Attributes || registry.externalRegistry.length !== 0) throw new Error("Core NFT contains plugins outside the approved immutable Attributes binding");
}

export async function verifyCreatorNft(input: LiveLaunchInput, options: VerifyOptions) {
  identity(input);
  await assertMainnet(options.connection);
  let signatureResult: { signature: string; slot: number; messageSha256: string } | null = null;
  if (options.signature) {
    const transaction = await finalizedTransaction(options.connection, options.signature);
    if (transaction) {
      const details = signedTransactionDetails(transaction, options.expectedMessageSha256);
      if (!creatorNftInstructions(input).every((expected) => details.instructions.filter((actual) => matchesInstruction(actual, expected)).length === 1) ||
        details.instructions.some((ix) => !ix.programId.equals(CORE_PROGRAM_ID) && !ix.programId.equals(ComputeBudgetProgram.programId)) ||
        details.instructions.filter((ix) => ix.programId.equals(CORE_PROGRAM_ID)).length !== 2 ||
        details.keys.get(0)?.toBase58() !== input.creator) throw new Error("Finalized NFT transaction does not match the approved creator card");
      signatureResult = { signature: options.signature, slot: transaction.slot, messageSha256: details.messageSha256 };
    }
  }
  const account = await options.connection.getAccountInfoAndContext(new PublicKey(input.nftMint), { commitment: "finalized", ...(signatureResult ? { minContextSlot: signatureResult.slot } : {}) });
  if (!account.value) return { status: "pending" as const, ...receiptIdentity(input) };
  verifyCoreAccount(input, account.value);
  return { status: "verified" as const, ...signatureResult, slot: signatureResult?.slot ?? account.context.slot,
    recoveredFromAccount: !signatureResult, ...receiptIdentity(input) };
}

export async function prepareCreatorNftTransaction(input: LiveLaunchInput, options: LiveOptions & { tokenSignature: string; tokenMessageSha256?: string }) {
  const token = await verifyTokenLaunch(input, { connection: options.connection, signature: options.tokenSignature, expectedMessageSha256: options.tokenMessageSha256 });
  if (token.status !== "verified") throw new Error("Wait for finalized pump.fun token creation before minting its NFT");
  const existing = await verifyCreatorNft(input, { connection: options.connection });
  if (existing.status === "verified") return { status: "already-created" as const, receipt: existing };
  return makeWalletPlan(input, "nft", creatorNftInstructions(input), "0", options);
}

/**
 * The card transaction prepared with its coin, before the coin exists, so one wallet prompt can approve both. Core's
 * CreateV1 and UpdateV1 read no token or Pump account (the coin mint is attribute text only), so it simulates and
 * prices on its own; its review and balance check are the card's alone. The caller relays it only after
 * verifyTokenLaunch verified the coin (the app requires the nft_pending stage). Never signs or sends.
 */
export async function prepareCreatorNftAheadOfCoin(input: LiveLaunchInput, options: LiveOptions) {
  const existing = await verifyCreatorNft(input, { connection: options.connection });
  if (existing.status === "verified") return { status: "already-created" as const, receipt: existing };
  return makeWalletPlan(input, "nft", creatorNftInstructions(input), "0", options);
}

export async function recoverCreatorLaunch(input: LiveLaunchInput, options: LiveOptions & { tokenSignature?: string; nftSignature?: string; tokenMessageSha256?: string; nftMessageSha256?: string }) {
  const token = await verifyTokenLaunch(input, { connection: options.connection, signature: options.tokenSignature, expectedMessageSha256: options.tokenMessageSha256 });
  if (token.status !== "verified") return { status: "token-pending" as const, token };
  const nft = await verifyCreatorNft(input, { connection: options.connection, signature: options.nftSignature, expectedMessageSha256: options.nftMessageSha256 });
  return nft.status === "verified" ? { status: "complete" as const, token, nft } : { status: "token-created-nft-pending" as const, token, nft };
}

// ---------------------------------------------------------------- the creator fee split (optional, after the card)

/**
 * Rent the creator's wallet pays for the split, read on mainnet on 31 October 2026: pump-fees' 1,024-byte sharing
 * config, and on a token quote the sharing vault's 165-byte quote token account. Used only for the balance check before
 * simulation; the review shows what the simulation charged.
 */
export const SHARING_CONFIG_RENT_LAMPORTS = 5_852_160n, QUOTE_ACCOUNT_RENT_LAMPORTS = 1_488_440n;
/** Network and priority fees allowed for in that balance check (a fee split costs well under this). */
const FEE_SPLIT_FEE_ALLOWANCE = 100_000n;
export const GRADUATED_FEE_SPLIT = "This coin has left its pump.fun bonding curve, so its creator fee split can only be set on pump.fun itself.";
export const FEE_SPLIT_NOT_CREATOR = "This coin's creator fees are managed by another wallet, so its split can't be set here.";
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

function feeShareKeys(id: ReturnType<typeof identity>) {
  const sol = id.asset.key === "sol", quoteTokenProgram = new PublicKey(id.asset.tokenProgram);
  const sharingConfig = feeSharingConfigPda(id.mint), sharingVault = creatorVaultPda(sharingConfig);
  return { sol, quoteMint: id.quoteMint, quoteTokenProgram, sharingConfig, sharingVault, bondingCurve: bondingCurvePda(id.mint),
    sharingVaultQuoteAccount: sol ? null : getAssociatedTokenAddressSync(id.quoteMint, sharingVault, true, quoteTokenProgram) };
}
/** What the fee split transaction must say for this launch and these recipients (fee-share-rules.ts). */
export function feeShareExpected(input: LiveLaunchInput, recipients: readonly FeeRecipient[]): FeeShareExpected {
  const keys = feeShareKeys(identity(input));
  return { creator: input.creator, mint: input.mint, quoteMint: keys.quoteMint.toBase58(), quoteTokenProgram: keys.quoteTokenProgram.toBase58(),
    sol: keys.sol, recipients: recipients.map((entry) => ({ address: entry.address, bps: entry.bps })), bondingCurve: keys.bondingCurve.toBase58(),
    sharingConfig: keys.sharingConfig.toBase58(), sharingVault: keys.sharingVault.toBase58(), sharingVaultQuoteAccount: keys.sharingVaultQuoteAccount?.toBase58() ?? null };
}
/**
 * The recipients as this site accepts them (fee-share-rules.ts feeRecipientsProblem): 1 to MAX_FEE_RECIPIENTS distinct
 * Solana wallet addresses (on the ed25519 curve, so never a PDA or program address), never one of this launch's own
 * accounts or a program, whole basis points above 0 adding up to exactly 10,000. Launch a Card adds itself nowhere.
 */
export function reviewFeeRecipients(input: LiveLaunchInput, recipients: readonly FeeRecipient[]): FeeRecipient[] {
  const id = identity(input), keys = feeShareKeys(id);
  if (id.options.holderReward) throw new Error(HOLDER_REWARDS_NO_SPLIT);
  const forbidden = [id.mint, id.nftMint, id.quoteMint, keys.bondingCurve, keys.sharingConfig, keys.sharingVault, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID, keys.quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, CORE_PROGRAM_ID].map((key) => key.toBase58());
  const problem = feeRecipientsProblem(recipients, { forbidden, isWallet: (address) => { try { return PublicKey.isOnCurve(new PublicKey(address).toBytes()); } catch { return false; } } });
  if (problem) throw new Error(problem);
  return recipients.map((entry) => ({ address: entry.address, bps: entry.bps }));
}
/**
 * A live read of each recipient. Refused: a program (pump.fun's payout then fails 6052 for everyone in the split, and the
 * split can never change) and an account that holds data or belongs to another program (a token account or PDA: what it
 * is paid is stranded). Allowed, and returned in `unfunded`: an address with no account or no SOL yet; pump.fun holds
 * its share until it covers the account's rent (mainnet simulation, 31 October 2026).
 */
export async function checkFeeRecipientAccounts(recipients: readonly FeeRecipient[], options: { connection: Pick<LiveConnection, "getMultipleAccountsInfoAndContext"> }) {
  const snapshot = await options.connection.getMultipleAccountsInfoAndContext(recipients.map((entry) => new PublicKey(entry.address)), "confirmed");
  const unfunded: string[] = [];
  recipients.forEach((entry, index) => {
    const account = snapshot.value[index];
    if (account?.executable) throw new Error(`${shortAddress(entry.address)} is a program, not a wallet. pump.fun could never pay this split, so choose a Solana wallet.`);
    if (account && (!account.owner.equals(SYSTEM_PROGRAM_ID) || account.data.length)) throw new Error(`${shortAddress(entry.address)} is not a plain Solana wallet, so fees sent to it would be stuck. Recipients must be Solana wallets.`);
    if (!account || account.lamports === 0) unfunded.push(entry.address);
  });
  return { unfunded };
}
async function feeSplitSnapshot(input: LiveLaunchInput, connection: LiveConnection, commitment: "confirmed" | "finalized", minContextSlot?: number) {
  const id = identity(input), keys = feeShareKeys(id);
  if (id.options.holderReward) throw new Error(HOLDER_REWARDS_NO_SPLIT);
  const snapshot = await connection.getMultipleAccountsInfoAndContext([keys.bondingCurve, keys.sharingConfig, id.creator], { commitment, ...(minContextSlot ? { minContextSlot } : {}) });
  const [curveInfo, configInfo, creatorInfo] = snapshot.value;
  if (!curveInfo?.owner.equals(PUMP_PROGRAM_ID)) throw new Error("This coin's pump.fun curve is unavailable");
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  if (curve.isMayhemMode || curve.isHolderReward) throw new Error(FEE_SPLIT_NOT_CREATOR);
  let config: SharingConfig | null = null;
  if (configInfo) {
    if (configInfo.executable || !configInfo.owner.equals(PUMP_FEE_PROGRAM_ID)) throw new Error("This coin's fee-sharing account is not pump.fun's");
    config = PUMP_SDK.decodeSharingConfig(configInfo);
    if (!config.mint.equals(id.mint)) throw new Error("This coin's fee-sharing account is for another coin");
  }
  return { id, keys, curve, config, slot: snapshot.context.slot, creatorLamports: BigInt(creatorInfo?.lamports ?? 0),
    shareholders: config ? config.shareholders.map((entry) => ({ address: entry.address.toBase58(), bps: entry.shareBps })) : null,
    locked: !!config && !isSharingConfigEditable({ sharingConfig: config }) };
}
/**
 * The coin's fee split as finalized on mainnet (or at `commitment`): "unset" (no config, the creator keeps 100%),
 * "editable" (a config whose split was never set) or "locked" (set for good), with its shareholders, and whether the
 * curve has graduated. With `afterBlockHeight` (a sent split's saved expiry), the read is bound to the chain as the
 * mint replacement checks are: finalized block height must be past it ("unexpired" otherwise: the split can still
 * land), and the config is read at that finalized bank or newer, so a lagging node never reads a late landing as unset.
 */
export async function readFeeSplit(input: LiveLaunchInput, options: { connection: LiveConnection; commitment?: "confirmed" | "finalized"; afterBlockHeight?: number }) {
  await assertMainnet(options.connection);
  let minContextSlot: number | undefined;
  if (options.afterBlockHeight !== undefined) {
    const epoch = await options.connection.getEpochInfo("finalized");
    if (typeof epoch.blockHeight !== "number" || !Number.isSafeInteger(epoch.blockHeight) || !Number.isSafeInteger(epoch.absoluteSlot) || epoch.absoluteSlot <= 0) throw new Error("RPC did not return a valid finalized expiry context");
    if (!Number.isSafeInteger(options.afterBlockHeight) || epoch.blockHeight <= options.afterBlockHeight) return { state: "unexpired" as const, shareholders: null, graduated: false, slot: epoch.absoluteSlot };
    minContextSlot = epoch.absoluteSlot;
  }
  const snapshot = await feeSplitSnapshot(input, options.connection, options.commitment ?? "finalized", minContextSlot);
  if (minContextSlot !== undefined && snapshot.slot < minContextSlot) throw new Error("RPC fee split context predates the finalized expiry check");
  return { state: !snapshot.config ? "unset" as const : snapshot.locked ? "locked" as const : "editable" as const,
    shareholders: snapshot.shareholders, graduated: snapshot.curve.complete, slot: snapshot.slot };
}
async function feeShareInstructions(snapshot: Awaited<ReturnType<typeof feeSplitSnapshot>>, recipients: readonly FeeRecipient[], current: PublicKey[]) {
  const { id, keys } = snapshot;
  const newShareholders = recipients.map((entry) => ({ address: new PublicKey(entry.address), shareBps: entry.bps }));
  return [
    // The curve's earned creator fees go to its current creator's own vault first (6095 otherwise): they stay the creator's.
    await PUMP_SDK.sweepCreatorFeeInstruction({ payer: id.creator, mint: id.mint, creator: snapshot.curve.creator, quoteMint: keys.quoteMint, quoteTokenProgram: keys.quoteTokenProgram }),
    ...(snapshot.config ? [] : [await PUMP_SDK.createFeeSharingConfig({ creator: id.creator, mint: id.mint, pool: null })]),
    ...(keys.sol ? [] : [createAssociatedTokenAccountIdempotentInstruction(id.creator, keys.sharingVaultQuoteAccount!, keys.sharingVault, keys.quoteMint, keys.quoteTokenProgram)]),
    keys.sol
      ? await PUMP_SDK.updateFeeShares({ authority: id.creator, mint: id.mint, currentShareholders: current, newShareholders, bondingCurveComplete: false })
      : await PUMP_SDK.updateFeeSharesV2({ authority: id.creator, mint: id.mint, currentShareholders: current, newShareholders,
        quoteMint: keys.quoteMint, quoteTokenProgram: keys.quoteTokenProgram, bondingCurveComplete: false }),
  ];
}
/** Throws unless a fee split plan is exactly the creator-only transaction for these recipients (prepare and pre-relay). */
export function verifyFeeSharePlan(plan: Pick<FeeSharePlan, "transactionBase64" | "requiredSigners" | "feePayer" | "kind">, input: LiveLaunchInput, recipients: readonly FeeRecipient[]) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
  const view = decodeV0Message(transaction.message.serialize());
  if (plan.kind !== "fees" || view.header.required !== 1 || view.header.readonlySigned !== 0 || view.staticKeys[0] !== input.creator ||
    plan.feePayer !== input.creator || plan.requiredSigners.length !== 1 || plan.requiredSigners[0] !== input.creator) throw new Error("The fee split must be signed by the creator wallet alone");
  const problem = feeShareInstructionsProblem(resolveInstructions(view), feeShareExpected(input, recipients));
  if (problem) throw new Error(problem);
}
/**
 * Real unsigned creator-only fee split transaction for a finished launch. Never signs or sends. "already-set" when the
 * coin's split is already locked (here or on pump.fun), with whether it equals these recipients.
 */
export async function prepareFeeShareTransaction(input: LiveLaunchInput, recipients: readonly FeeRecipient[], options: LiveOptions) {
  const shares = reviewFeeRecipients(input, recipients), connection = options.connection;
  await assertMainnet(connection);
  const snapshot = await feeSplitSnapshot(input, connection, "confirmed");
  if (snapshot.locked) return { status: "already-set" as const, shareholders: snapshot.shareholders!, matches: sameFeeSplit(snapshot.shareholders!, shares) };
  if (snapshot.curve.complete) throw new Error(GRADUATED_FEE_SPLIT);
  const { id, keys, config, curve } = snapshot;
  if (config ? !config.admin.equals(id.creator) || !curve.creator.equals(keys.sharingConfig) : !curve.creator.equals(id.creator)) throw new Error(FEE_SPLIT_NOT_CREATOR);
  await checkFeeRecipientAccounts(shares, { connection });
  const current = config ? config.shareholders.map((entry) => entry.address) : [id.creator];
  let vaultAccountMissing = false;
  if (!keys.sol) {
    // update_fee_shares_v2 pays any pending fees out through each current shareholder's quote account, so it must exist.
    const accounts = current.map((owner) => getAssociatedTokenAddressSync(keys.quoteMint, owner, true, keys.quoteTokenProgram));
    const read = await connection.getMultipleAccountsInfoAndContext([...accounts, keys.sharingVaultQuoteAccount!], "confirmed");
    if (accounts.some((_, index) => !read.value[index]?.owner.equals(keys.quoteTokenProgram))) throw new Error(`Your wallet needs a ${id.asset.symbol} token account before the split can be set. Receive any amount of ${id.asset.symbol} in this wallet, then try again`);
    vaultAccountMissing = !read.value[accounts.length];
  }
  const need = (config ? 0n : SHARING_CONFIG_RENT_LAMPORTS) + (vaultAccountMissing ? QUOTE_ACCOUNT_RENT_LAMPORTS : 0n) + FEE_SPLIT_FEE_ALLOWANCE + RENT_EXEMPT_MINIMUM_LAMPORTS;
  if (snapshot.creatorLamports < need) throw new Error(`Insufficient SOL: setting the split needs about ${(Number(need) / 1e9).toFixed(4)} SOL in this wallet for pump.fun's fee-sharing account rent and the network fee. Add SOL, then try again`);
  const plan = await makeWalletPlan(input, "fees", await feeShareInstructions(snapshot, shares, current), "0", options, { feeRecipients: shares });
  verifyFeeSharePlan(plan, input, shares);
  return plan;
}
/**
 * Exact wire size of the fee split transaction prepareFeeShareTransaction builds, with the config create (a coin with
 * no config yet), against the same pinned lookup table read. No blockhash, signing or send.
 */
export async function measureFeeShareTransaction(input: { creator: string; mint: string; quoteKey: PairKey; recipients: number }, options: { connection: Pick<LiveConnection, "getMultipleAccountsInfoAndContext"> }) {
  const asset = PAIR_ASSETS.find((candidate) => candidate.key === input.quoteKey);
  if (!asset) throw new Error("Choose a verified CardDex pair asset");
  const creator = publicKey(input.creator, "creator"), mint = publicKey(input.mint, "mint");
  const id = { asset, mint, creator, quoteMint: new PublicKey(asset.mint) } as ReturnType<typeof identity>;
  const keys = feeShareKeys(id);
  const recipients = Array.from({ length: input.recipients }, (_, index) => ({ address: new PublicKey(new Uint8Array(32).fill(index + 1)).toBase58(),
    bps: index === 0 ? TOTAL_BPS - Math.floor(TOTAL_BPS / input.recipients) * (input.recipients - 1) : Math.floor(TOTAL_BPS / input.recipients) }));
  const snapshot = { id, keys, config: null, curve: { creator } } as unknown as Awaited<ReturnType<typeof feeSplitSnapshot>>;
  const instructions = await feeShareInstructions(snapshot, recipients, [creator]);
  const table = pinnedLookupTable((await options.connection.getMultipleAccountsInfoAndContext([TABLE_ADDRESS], "confirmed")).value[0] ?? null);
  return { limit: WALLET_SIZE_TARGET, lookupTable: !!table, bytes: transactionBytes(compileWalletTransaction(creator, SIZE_BLOCKHASH, 1_400_000, 1_000, instructions, table).message) };
}
const TOTAL_BPS = 10_000;
/**
 * Finalized verification of the fee split: the landed transaction is exactly the approved one (wallet assertions
 * allowed only inside the message the server validated), and the coin's sharing config, read at that slot or newer, is
 * locked with exactly these recipients, administered by the creator and named as the curve's creator.
 */
export async function verifyFeeShareLanded(input: LiveLaunchInput, recipients: readonly FeeRecipient[], options: VerifyOptions) {
  const shares = recipients.map((entry) => ({ address: entry.address, bps: entry.bps })), connection = options.connection;
  await assertMainnet(connection);
  if (!options.signature) return { status: "pending" as const, creatorWallet: input.creator, tokenMint: input.mint };
  const transaction = await finalizedTransaction(connection, options.signature);
  if (!transaction) return { status: "pending" as const, signature: options.signature, creatorWallet: input.creator, tokenMint: input.mint };
  const details = signedTransactionDetails(transaction, options.expectedMessageSha256);
  const signers = details.message.staticAccountKeys.slice(0, details.message.header.numRequiredSignatures).map((key) => key.toBase58());
  const problem = feeShareInstructionsProblem(details.instructions.map((ix) => ({ program: ix.program, accounts: ix.accounts.map((key) => key.toBase58()), data: new Uint8Array(ix.data) })), feeShareExpected(input, shares));
  if (problem || signers.length !== 1 || signers[0] !== input.creator) throw new Error(`Finalized fee split transaction differs from the approved one${problem ? ` (${problem})` : ""}`);
  const snapshot = await feeSplitSnapshot(input, connection, "finalized", transaction.slot);
  if (!snapshot.config || !snapshot.locked || !sameFeeSplit(snapshot.shareholders!, shares) || !snapshot.config.admin.equals(snapshot.id.creator) ||
    !snapshot.curve.creator.equals(snapshot.keys.sharingConfig)) throw new Error("The coin's finalized fee split differs from the approved one");
  return { status: "verified" as const, signature: options.signature, slot: transaction.slot, messageSha256: details.messageSha256,
    creatorWallet: input.creator, tokenMint: input.mint, sharingConfig: snapshot.keys.sharingConfig.toBase58(), shareholders: snapshot.shareholders! };
}

async function expiredMintSnapshot(mint: PublicKey, options: LiveOptions & { lastValidBlockHeight?: number }, label: "NFT" | "token") {
  await assertMainnet(options.connection);
  // Epoch info binds finalized block height to its bank slot. The absence read
  // must use that slot or newer, including when a load-balanced RPC node lags.
  const epoch = await options.connection.getEpochInfo("finalized");
  const height = epoch.blockHeight;
  if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 0 || !Number.isSafeInteger(epoch.absoluteSlot) || epoch.absoluteSlot <= 0) throw new Error("RPC did not return a valid finalized expiry context");
  if (options.lastValidBlockHeight !== undefined && (!Number.isSafeInteger(options.lastValidBlockHeight) || options.lastValidBlockHeight < 0 || height <= options.lastValidBlockHeight)) throw new Error(`The previous ${label} transaction can still land; wait for its finalized block-height expiry`);
  const account = await options.connection.getAccountInfoAndContext(mint, { commitment: "finalized", minContextSlot: epoch.absoluteSlot });
  if (!Number.isSafeInteger(account.context.slot) || account.context.slot < epoch.absoluteSlot) throw new Error("RPC account absence context predates the finalized expiry check");
  return { height, account };
}

export async function assertNftMintReplaceable(input: LiveLaunchInput, options: LiveOptions & { lastValidBlockHeight?: number }) {
  identity(input);
  const { height, account } = await expiredMintSnapshot(new PublicKey(input.nftMint), options, "NFT");
  if (account.value) throw new Error("The previous NFT address already exists; recover and verify it instead of minting another");
  return { replaceable: true as const, finalizedBlockHeight: height, slot: account.context.slot, previousNftMint: input.nftMint };
}

export async function assertTokenMintReplaceable(input: LiveLaunchInput, options: LiveOptions & { lastValidBlockHeight?: number }) {
  const id = identity(input);
  const { height, account } = await expiredMintSnapshot(id.mint, options, "token");
  if (account.value) throw new Error("The token mint already exists; recover its launch instead of creating another");
  return { replaceable: true as const, finalizedBlockHeight: height, slot: account.context.slot, previousTokenMint: input.mint };
}

/** The message bytes of a serialized transaction (after its signatures), read strictly. */
function messageBytesOf(raw: Uint8Array) {
  const count = raw[0];
  if (raw.length < 1 || count === undefined || count >= 0x80) throw new Error("Invalid signed transaction encoding or size");
  return raw.subarray(1 + 64 * count);
}
/**
 * Verifies wallet+ephemeral signatures (the creator's alone for a fee split) without producing any signature itself. The returned message must be the
 * plan's message, or that message with only the changes the shared wallet rule accepts (appended read-only Lighthouse
 * assertions, and a refreshed blockhash that checkSignedWalletTransaction confirms is still valid). Both signatures are
 * checked over the returned message. `signedMessageSha256` is the hash every later finalization check expects.
 */
export function validateSignedWalletTransaction(plan: AnyWalletPlan, transactionBase64: string) {
  if (typeof transactionBase64 !== "string" || transactionBase64.length > 2000) throw new Error("Invalid signed transaction payload");
  const raw = Buffer.from(transactionBase64, "base64");
  if (raw.length > PACKET_LIMIT || raw.length === 0 || raw.toString("base64") !== transactionBase64) throw new Error("Invalid signed transaction encoding or size");
  const transaction = VersionedTransaction.deserialize(raw);
  if (transaction.version !== 0) throw new Error("Unexpected transaction version");
  const message = transaction.message.serialize(), rawMessage = messageBytesOf(raw);
  if (!Buffer.from(message).equals(Buffer.from(rawMessage))) throw new Error("Signed transaction has a non-canonical message encoding");
  const planned = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
  if (digest(planned.message.serialize()) !== plan.messageSha256 || planned.message.recentBlockhash !== plan.blockhash) throw new Error("The stored plan does not match its own message");
  let change: ReturnType<typeof walletMessageChange>;
  try { change = walletMessageChange(decodeV0Message(planned.message.serialize()), decodeV0Message(message), { allowBlockhashChange: true }); }
  catch (error) { throw new Error(`Signed transaction differs from the approved message${error instanceof WalletMessageRefused ? ` (${error.reason})` : ""}`); }
  const signers = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map((key) => key.toBase58());
  if (signers.length !== plan.requiredSigners.length || signers.some((key, index) => key !== plan.requiredSigners[index]) || signers[0] !== plan.feePayer) throw new Error("Signed transaction has unexpected signers or payer");
  for (let index = 0; index < signers.length; index++) {
    if (!ed25519.verify(transaction.signatures[index], message, transaction.message.staticAccountKeys[index].toBytes())) throw new Error(`Missing or invalid signature for ${signers[index]}`);
  }
  const signature = bs58.encode(transaction.signatures[0]);
  return { signature, transactionBase64, messageSha256: plan.messageSha256, signedMessageSha256: digest(message),
    blockhash: transaction.message.recentBlockhash, blockhashChanged: change.blockhashChanged, walletGuards: change.guards.length };
}

/**
 * What a wallet changed in a prepared transaction, for the server log only: sizes, signers, blockhash, compute budget,
 * the outer programs it added or removed, and what the shared wallet rule says (accepted with which assertions, or the
 * refusal reason). It never signs, sends or trusts the returned bytes, which cannot land without the new asset
 * signature that only the page holds.
 */
export function describeWalletChange(plan: AnyWalletPlan, transactionBase64: string) {
  const before = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
  const raw = Buffer.from(transactionBase64, "base64");
  const summary = { bytesBefore: Buffer.from(plan.transactionBase64, "base64").length, bytesAfter: raw.length, limit: PACKET_LIMIT };
  let after: VersionedTransaction;
  try { after = VersionedTransaction.deserialize(raw); } catch { return { ...summary, parsed: false as const }; }
  // Keys resolved through the pinned table when the message decodes, so a recompile's shifted indexes still compare.
  const resolved = new Map<VersionedTransaction, string[] | null>();
  const key = (tx: VersionedTransaction, index: number) => {
    if (!resolved.has(tx)) { try { resolved.set(tx, decodeV0Message(tx.message.serialize()).keys); } catch { resolved.set(tx, null); } }
    return resolved.get(tx)?.[index] ?? tx.message.staticAccountKeys[index]?.toBase58() ?? `lookup:${index}`;
  };
  const instructions = (tx: VersionedTransaction) => tx.message.compiledInstructions.map((ix) => ({ program: key(tx, ix.programIdIndex),
    id: `${key(tx, ix.programIdIndex)}|${ix.accountKeyIndexes.map((index) => key(tx, index)).join(",")}|${Buffer.from(ix.data).toString("hex")}` }));
  const signers = (tx: VersionedTransaction) => tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58()).join(",");
  const planned = instructions(before), returned = instructions(after);
  const compute = (list: typeof planned) => list.filter((ix) => ix.program === ComputeBudgetProgram.programId.toBase58()).map((ix) => ix.id).sort().join(";");
  let cursor = 0;
  for (const ix of returned) if (cursor < planned.length && ix.id === planned[cursor].id) cursor++;
  const programs = (list: typeof planned) => new Set(list.map((ix) => ix.program));
  // The rule's own answer, with each assertion as its discriminator, the plan key index it reads and its data size.
  let rule: { accepted: true; guards: { discriminator: number; target: number; dataBytes: number }[]; recompiled: boolean } | { accepted: false; reason: string };
  try {
    const change = walletMessageChange(decodeV0Message(before.message.serialize()), decodeV0Message(after.message.serialize()), { allowBlockhashChange: true });
    rule = { accepted: true, guards: change.guards, recompiled: change.recompiled };
  } catch (error) { rule = { accepted: false, reason: error instanceof WalletMessageRefused ? error.reason : "unreadable" }; }
  return { ...summary, parsed: true as const, version: after.version, lookupTables: after.message.addressTableLookups.length,
    messageSha256: digest(after.message.serialize()), blockhashChanged: after.message.recentBlockhash !== before.message.recentBlockhash,
    signersChanged: signers(after) !== signers(before), walletSigned: after.signatures[0]?.some(Boolean) ?? false,
    instructionsBefore: planned.length, instructionsAfter: returned.length, planInstructionsKept: cursor === planned.length,
    computeBudgetChanged: compute(returned) !== compute(planned),
    programsAdded: [...programs(returned)].filter((program) => !programs(planned).has(program)),
    programsRemoved: [...programs(planned)].filter((program) => !programs(returned).has(program)), rule };
}

/** A definite pre-send failure. Nothing was broadcast, so the same stage can be prepared again. */
export class SignedTransactionNotSent extends Error {
  constructor(readonly reason: "expired" | "simulation", message: string) { super(message); this.name = "SignedTransactionNotSent"; }
}
type SignedInput = { plan: AnyWalletPlan; transactionBase64: string };
/**
 * Blocks added to the RPC's newest last valid block height to bound a wallet-refreshed blockhash: it covers an RPC
 * node behind the one the wallet asked. Any blockhash that exists was produced at or before the newest block, so it
 * stops landing at or before that block height + 150; this margin keeps the bound above it.
 */
export const REFRESHED_BLOCKHASH_MARGIN = 64;
const EXPIRED = "The signed transaction blockhash expired before it was sent; prepare a fresh transaction";
/**
 * Read-only checks before any broadcast, in order: signatures against the plan, the signature status, blockhash
 * expiry, then a sigVerify simulation. "landed" means the chain already knows this signature (keep and recover it,
 * including a failed one). An expired blockhash or a failed simulation throws SignedTransactionNotSent.
 * `lastValidBlockHeight` is the height after which these signed bytes can no longer land: the plan's, or for a
 * wallet-refreshed blockhash (accepted only while the RPC still knows it) an upper bound from the newest blockhash.
 * The caller stores it with the bytes, and every abandon or replace gate waits past it.
 */
export async function checkSignedWalletTransaction(input: SignedInput, options: { connection: LiveConnection }) {
  const validated = validateSignedWalletTransaction(input.plan, input.transactionBase64);
  const connection = options.connection;
  await assertMainnet(connection);
  const bound = async () => {
    if (!validated.blockhashChanged) return input.plan.lastValidBlockHeight;
    const newest = await connection.getLatestBlockhash("processed");
    if (!Number.isSafeInteger(newest.lastValidBlockHeight) || newest.lastValidBlockHeight <= 0) throw new Error("RPC did not return a valid block height");
    return Math.max(input.plan.lastValidBlockHeight, newest.lastValidBlockHeight + REFRESHED_BLOCKHASH_MARGIN);
  };
  const checked = { signature: validated.signature, signedMessageSha256: validated.signedMessageSha256, walletGuards: validated.walletGuards, blockhashChanged: validated.blockhashChanged };
  const statuses = await connection.getSignatureStatuses([validated.signature], { searchTransactionHistory: true });
  const existing = statuses.value[0];
  if (existing) return { status: "landed" as const, ...checked, err: existing.err ?? null, lastValidBlockHeight: await bound() };
  if (validated.blockhashChanged && !(await connection.isBlockhashValid(validated.blockhash, { commitment: "processed" })).value) throw new SignedTransactionNotSent("expired", EXPIRED);
  const lastValidBlockHeight = await bound();
  const height = await connection.getBlockHeight("confirmed");
  if (height > lastValidBlockHeight) throw new SignedTransactionNotSent("expired", EXPIRED);
  const transaction = VersionedTransaction.deserialize(Buffer.from(validated.transactionBase64, "base64"));
  const simulation = await connection.simulateTransaction(transaction, { sigVerify: true, replaceRecentBlockhash: false, commitment: "confirmed", minContextSlot: input.plan.verifiedSlot });
  const err = simulation.value.err;
  // Someone else broadcast these exact bytes: recover them like any landed signature.
  if (err === "AlreadyProcessed") return { status: "landed" as const, ...checked, err: null, lastValidBlockHeight };
  if (err === "BlockhashNotFound") throw new SignedTransactionNotSent("expired", EXPIRED);
  if (err) throw new SignedTransactionNotSent("simulation", `Signed transaction simulation failed: ${JSON.stringify(err)}`);
  return { status: "ready" as const, ...checked, blocksLeft: lastValidBlockHeight - height, lastValidBlockHeight };
}

/**
 * Authorized server relay only. Run checkSignedWalletTransaction first, then persist the deterministic signature
 * and these exact signed bytes, then call this. Transport uncertainty returns the same signature; never replace or
 * re-sign it.
 */
/**
 * The RPC's own answer to a send, when it gave one: a JSON-RPC error from sendTransaction (a failed preflight, a
 * minimum context slot not reached, a malformed transaction) means that node did not forward these bytes, while
 * "already processed" means the chain has them. Anything else (a timeout, a dropped connection, an HTTP error) leaves
 * the outcome unknown. web3.js reports RPC errors as SendTransactionError, with the node's message.
 */
function rpcSendAnswer(error: unknown): { refused: true; reason: string } | { landed: true } | null {
  const message = (error as { transactionMessage?: unknown } | null)?.transactionMessage;
  if (!(error instanceof Error) || error.name !== "SendTransactionError" || typeof message !== "string") return null;
  if (/already been processed|AlreadyProcessed/i.test(message)) return { landed: true };
  return { refused: true, reason: message.slice(0, 300) };
}
export async function broadcastSignedWalletTransaction(input: SignedInput, options: { connection: LiveConnection }) {
  const validated = validateSignedWalletTransaction(input.plan, input.transactionBase64);
  const connection = options.connection;
  try {
    const signature = await connection.sendRawTransaction(Buffer.from(validated.transactionBase64, "base64"), {
      skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3, minContextSlot: input.plan.verifiedSlot,
    });
    if (signature !== validated.signature) throw new Error("RPC returned an unexpected transaction signature");
    return { status: "submitted" as const, signature };
  } catch (error) {
    const answer = rpcSendAnswer(error);
    if (answer && "landed" in answer) return { status: "submitted" as const, signature: validated.signature };
    // Refused by the node: not forwarded this time. The saved bytes can still be sent again until they expire.
    if (answer) return { status: "refused" as const, signature: validated.signature, reason: answer.reason };
    return { status: "submission-uncertain" as const, signature: validated.signature,
      reason: error instanceof Error ? error.message : "RPC transport failed" };
  }
}

/**
 * Sends saved signed bytes again while they can still land, for a launch whose confirmation is still pending (a dropped
 * send, a provider error, a closed tab). Always safe: the same bytes carry the same signature and land at most once.
 * Read-only first: a signature the chain already has is never sent again, and bytes past `lastValidBlockHeight` (the
 * saved bound, which covers a wallet-refreshed blockhash) are reported as expired. The node's preflight still runs, so
 * a transaction that would now fail is refused rather than charged. Never signs anything.
 */
export async function resendSignedWalletTransaction(input: SignedInput & { lastValidBlockHeight: number }, options: { connection: LiveConnection }) {
  const validated = validateSignedWalletTransaction(input.plan, input.transactionBase64);
  const connection = options.connection;
  const status = (await connection.getSignatureStatuses([validated.signature], { searchTransactionHistory: true })).value[0];
  if (status) return { status: "landed" as const, signature: validated.signature, err: status.err ?? null };
  const height = await connection.getBlockHeight("confirmed");
  if (!Number.isSafeInteger(input.lastValidBlockHeight) || height > input.lastValidBlockHeight) return { status: "expired" as const, signature: validated.signature };
  const sent = await broadcastSignedWalletTransaction(input, options);
  return sent.status === "submitted" ? { status: "resent" as const, signature: validated.signature, blocksLeft: input.lastValidBlockHeight - height }
    : { status: "not-resent" as const, signature: validated.signature, reason: sent.reason };
}

/** Checks, then broadcasts, for callers that keep no state between the two. */
export async function sendSignedWalletTransaction(input: SignedInput, options: { connection: LiveConnection }) {
  const checked = await checkSignedWalletTransaction(input, options);
  if (checked.status === "landed") {
    if (checked.err) throw new Error(`The signed transaction already failed: ${JSON.stringify(checked.err)}`);
    return { status: "already-submitted" as const, signature: checked.signature };
  }
  return broadcastSignedWalletTransaction(input, options);
}
