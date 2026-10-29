import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { LIVE_PACKET_LIMIT } from "../../../lib/carddex/live/types";
// The one wallet rule and v0 decoder the server also uses (dependency-free; no RPC, no web3.js in the bundle).
import {
  LIGHTHOUSE_PROGRAM_ID, PUMP_LOOKUP_TABLE, decodeV0Message, resolveInstructions, walletMessageChange, type MessageView,
} from "../../../../../integrations/pumpfun/src/wallet-guards";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MAINNET_CHAIN = "solana:mainnet" as const;
export const LIVE_PROGRAMS = {
  compute: "ComputeBudget111111111111111111111111111111",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  core: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
  /** Lighthouse v2, whose read-only assertions Phantom may append; never part of a prepared plan. */
  lighthouse: LIGHTHOUSE_PROGRAM_ID,
} as const;
/** The highest priority fee a plan may carry, in micro-lamports per compute unit (the server's cap). */
export const MAX_MICRO_LAMPORTS = 200_000n;

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
export function fromBase58(value: string): Uint8Array {
  let n = 0n;
  for (const c of value) {
    const index = ALPHABET.indexOf(c);
    if (index < 0) throw new Error("Invalid Solana address.");
    n = n * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of value) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export const hexHash = (bytes: Uint8Array) => Array.from(sha256(bytes), b => b.toString(16).padStart(2, "0")).join("");
export const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
export const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

/** Seeds exist only in this page's memory and are never uploaded or placed in browser storage. */
export type EphemeralSigner = { readonly address: string; readonly seed: Uint8Array };
export function createEphemeralSigner(): EphemeralSigner {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  return { address: base58(ed25519.getPublicKey(seed)), seed };
}
export function destroyEphemeralSigner(signer: EphemeralSigner | null) { signer?.seed.fill(0); }

export type TransactionPlan = {
  kind: "token" | "nft";
  network: "solana:mainnet";
  transactionBase64: string;
  messageSha256: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** Block height when prepared; lastValidBlockHeight minus this is the signing window in blocks. */
  preparedBlockHeight?: number;
  /** Server time the plan was built (ISO). The page times freshness from when it received the plan instead. */
  preparedAt?: string;
  requiredSigners: readonly string[];
  feePayer: string;
  bindingSha256: string;
  instructionPrograms: readonly string[];
  verifiedSlot: number;
  review: {
    networkFeeLamports: string | number;
    priorityFeeLamports: string | number;
    rentAndProgramCostLamports: string | number;
    totalDebitLamports: string | number;
    initialBuyQuoteBaseUnits: string;
    quoteKey: string;
    quoteMint: string;
    quoteDecimals: number;
    minimumTokensOut: string;
    /** Serialized wire size and Solana's packet limit, measured by the server. Older saved plans have neither. */
    transactionBytes?: number;
    packetLimit?: number;
    [key: string]: unknown;
  };
};

type WireInstruction = { program: string; accounts: string[]; data: Uint8Array };
type Wire = { bytes: Uint8Array; message: Uint8Array; signatureOffset: number; signatures: Uint8Array[]; signers: string[]; blockhash: string; programs: string[]; keys: string[]; instructions: WireInstruction[]; view: MessageView };
/**
 * Narrow parser for this adapter's v0 transactions: exactly two required signers (the creator, then the new asset),
 * no readonly signer. Lookups resolve only through pump.fun's pinned create table (wallet-guards.ts), so every check
 * below sees real addresses; any other table or entry is refused.
 */
export function parseLiveTransaction(bytes: Uint8Array): Wire {
  if (bytes.length > LIVE_PACKET_LIMIT || bytes.length < 134) throw new Error("The prepared transaction has an invalid size.");
  if (bytes[0] !== 2) throw new Error("This launch must require only the creator and new asset signatures.");
  const signatureOffset = 1, signatures = [bytes.slice(1, 65), bytes.slice(65, 129)], message = bytes.slice(129);
  const view = decodeV0Message(message);
  if (view.header.required !== 2 || view.header.readonlySigned !== 0) throw new Error("Invalid transaction account header.");
  const instructions = resolveInstructions(view);
  return { bytes, message, signatureOffset, signatures, signers: view.staticKeys.slice(0, 2), blockhash: view.blockhash,
    programs: instructions.map(ix => ix.program), keys: view.keys, instructions, view };
}

export type ExpectedPlan = {
  kind: "token" | "nft"; creator: string; mint: string; tokenMint: string; name: string; symbol: string;
  tokenMetadataUri: string; nftMetadataUri: string; cardTemplate: string; cardImageSha256: string; nftMetadataSha256: string;
  bindingSha256: string; quoteKey: string; quoteMint: string; quoteTokenProgram: string; quoteDecimals: number;
  initialBuyQuoteBaseUnits: string; launchInitialBuyQuoteBaseUnits: string;
};
function dataReader(data: Uint8Array) {
  let offset = 0;
  const take = (n: number) => { if (n < 0 || offset + n > data.length) throw new Error("Invalid launch instruction data."); const out = data.slice(offset, offset + n); offset += n; return out; };
  const byte = () => take(1)[0];
  const u32 = () => { const b = take(4); return new DataView(b.buffer).getUint32(0, true); };
  const text = () => { const n = u32(); if (n > 2048) throw new Error("Unexpected instruction string length."); return new TextDecoder("utf-8", { fatal: true }).decode(take(n)); };
  return { take, byte, u32, text, done: () => offset === data.length };
}
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const u64 = (bytes: Uint8Array) => { let n = 0n; for (let i = bytes.length - 1; i >= 0; i--) n = n * 256n + BigInt(bytes[i]); return n.toString(); };
function validateOperations(wire: Wire, expected: ExpectedPlan, plan: TransactionPlan) {
  const compute = wire.instructions.filter(i => i.program === LIVE_PROGRAMS.compute);
  for (const ix of compute) if (ix.accounts.length || !(ix.data.length === 5 && ix.data[0] === 2 || ix.data.length === 9 && ix.data[0] === 3)) throw new Error("Unexpected compute-budget operation.");
  if (compute.length !== 2 || new Set(compute.map(i => i.data[0])).size !== 2) throw new Error("Unexpected compute-budget operation count.");
  const limitBytes = compute.find(i => i.data[0] === 2)!.data.slice(1);
  const limit = new DataView(limitBytes.buffer).getUint32(0, true);
  const micro = BigInt(u64(compute.find(i => i.data[0] === 3)!.data.slice(1)));
  const priority = (BigInt(limit) * micro + 999_999n) / 1_000_000n;
  if (limit <= 0 || limit > 1_400_000 || micro < 1000n || micro > MAX_MICRO_LAMPORTS || plan.review.computeUnitLimit !== limit || String(plan.review.microLamportsPerComputeUnit) !== micro.toString() || String(plan.review.priorityFeeLamports) !== priority.toString()) throw new Error("The actual priority fee differs from the cost review.");
  if (expected.kind === "token") {
    const pump = wire.instructions.filter(i => i.program === LIVE_PROGRAMS.pump);
    if (pump.length !== (BigInt(expected.initialBuyQuoteBaseUnits) > 0n ? 2 : 1)) throw new Error("The token transaction has unexpected Pump operations.");
    const create = pump[0], r = dataReader(create.data);
    if (hex(r.take(8)) !== "d6904cec5f8b31b4" || r.text() !== expected.name || r.text() !== expected.symbol || r.text() !== expected.tokenMetadataUri || base58(r.take(32)) !== expected.creator || r.take(11).some(Boolean) || !r.done()) throw new Error("The token creation arguments do not match your launch.");
    if (create.accounts.length !== (expected.quoteKey === "sol" ? 16 : 20) || create.accounts[0] !== expected.tokenMint || create.accounts[5] !== expected.creator || expected.quoteKey !== "sol" && (create.accounts[16] !== expected.quoteMint || create.accounts[18] !== expected.quoteTokenProgram)) throw new Error("The token creation accounts do not match your mint, creator or quote.");
    if (pump[1]) {
      const buy = pump[1];
      if (buy.data.length !== 25 || hex(buy.data.slice(0, 8)) !== "e1f7501ed5b38488" || u64(buy.data.slice(8, 16)) !== expected.initialBuyQuoteBaseUnits || u64(buy.data.slice(16, 24)) !== plan.review.minimumTokensOut || BigInt(plan.review.minimumTokensOut) <= 0n || buy.data[24] !== 0 || buy.accounts.length !== 17 || buy.accounts[1] !== expected.tokenMint || buy.accounts[2] !== expected.quoteMint || buy.accounts[3] !== TOKEN_2022 || buy.accounts[4] !== expected.quoteTokenProgram || buy.accounts[8] !== expected.creator) throw new Error("The initial buy differs from the quote spend or minimum output you reviewed.");
    }
    for (const ix of wire.instructions.filter(i => i.program === LIVE_PROGRAMS.associatedToken)) {
      if (!pump[1] || ix.data.length !== 1 || ix.data[0] !== 1 || ix.accounts.length !== 6 || ix.accounts[0] !== expected.creator || ![expected.tokenMint, expected.quoteMint].includes(ix.accounts[3]) || ix.accounts[4] !== "11111111111111111111111111111111" || ix.accounts[5] !== (ix.accounts[3] === expected.tokenMint ? TOKEN_2022 : expected.quoteTokenProgram)) throw new Error("Unexpected associated-token account operation.");
    }
  } else {
    const core = wire.instructions.filter(i => i.program === LIVE_PROGRAMS.core);
    if (core.length !== 2) throw new Error("Card issuance must create one Core asset and remove its metadata authority.");
    const create = core[0], update = core[1], r = dataReader(create.data);
    if (r.byte() !== 20 || r.byte() !== 0 || r.text() !== expected.name || r.text() !== expected.nftMetadataUri || r.byte() !== 1 || r.u32() !== 1 || r.byte() !== 6 || r.u32() !== 6) throw new Error("The NFT creation does not match your permanent card metadata.");
    const wanted: Record<string, string> = { token_mint: expected.tokenMint, quote_mint: expected.quoteMint, card_design: expected.cardTemplate, binding_sha256: expected.bindingSha256, card_sha256: expected.cardImageSha256, metadata_sha256: expected.nftMetadataSha256 };
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) { const key = r.text(), value = r.text(); if (seen.has(key) || wanted[key] !== value) throw new Error("The card NFT attributes differ from this token and design."); seen.add(key); }
    if (r.byte() !== 1 || r.byte() !== 0 || r.byte() !== 1 || r.u32() !== 0 || !r.done()) throw new Error("The card NFT contains an unexpected plugin or authority.");
    const expectedCreate = [expected.mint, LIVE_PROGRAMS.core, expected.creator, expected.creator, expected.creator, expected.creator, "11111111111111111111111111111111", LIVE_PROGRAMS.core];
    const expectedUpdate = [expected.mint, LIVE_PROGRAMS.core, expected.creator, expected.creator, "11111111111111111111111111111111", LIVE_PROGRAMS.core];
    if (create.accounts.length !== 8 || create.accounts.some((key, i) => key !== expectedCreate[i]) || hex(update.data) !== "0f00000100" || update.accounts.length !== 6 || update.accounts.some((key, i) => key !== expectedUpdate[i])) throw new Error("The card NFT owner or permanent metadata authority is not the one reviewed.");
  }
}
/** The plain refusal for a transaction over Solana's size limit, before the wallet opens. */
export function oversizedPlanError(bytes: number) {
  return `This transaction is ${bytes.toLocaleString("en-US")} bytes, over Solana's ${LIVE_PACKET_LIMIT.toLocaleString("en-US")}-byte limit, so your wallet was not opened. Use a shorter name or symbol, or launch without an initial buy.`;
}
export function validateLivePlan(plan: TransactionPlan, expected: ExpectedPlan): Wire {
  const bytes = fromBase64(plan.transactionBase64);
  if (bytes.length > LIVE_PACKET_LIMIT) throw new Error(oversizedPlanError(bytes.length));
  if (plan.review.transactionBytes !== undefined && plan.review.transactionBytes !== bytes.length) throw new Error("The transaction size differs from the review. Prepare it again.");
  const wire = parseLiveTransaction(bytes);
  if (plan.network !== MAINNET_CHAIN) throw new Error("This launch transaction is not for Solana mainnet.");
  if (plan.kind !== expected.kind || plan.feePayer !== expected.creator || wire.signers[0] !== expected.creator) throw new Error("The transaction fee payer does not match your connected wallet.");
  if (wire.signers[1] !== expected.mint || plan.requiredSigners.length !== 2 || plan.requiredSigners.some((s, i) => s !== wire.signers[i])) throw new Error("The transaction requires an unexpected signer.");
  if (wire.blockhash !== plan.blockhash || hexHash(wire.message) !== plan.messageSha256 || plan.bindingSha256 !== expected.bindingSha256) throw new Error("The transaction does not match this launch commitment.");
  // Only a coin transaction may load pump.fun's create table (the decoder already refused any other table).
  if (wire.view.lookups.length && (expected.kind !== "token" || wire.view.lookups.some(lookup => lookup.table !== PUMP_LOOKUP_TABLE.address))) throw new Error("The transaction loads an unexpected address lookup table.");
  if (!Number.isSafeInteger(plan.lastValidBlockHeight) || plan.lastValidBlockHeight <= 0 || !Number.isSafeInteger(plan.verifiedSlot) || plan.verifiedSlot <= 0) throw new Error("The transaction has no valid verification window.");
  if (plan.review.quoteKey !== expected.quoteKey || plan.review.quoteMint !== expected.quoteMint || plan.review.quoteDecimals !== expected.quoteDecimals || plan.review.initialBuyQuoteBaseUnits !== expected.initialBuyQuoteBaseUnits || plan.review.launchInitialBuyQuoteBaseUnits !== expected.launchInitialBuyQuoteBaseUnits) throw new Error("The transaction quote or initial buy changed. Prepare it again.");
  if (expected.kind === "token" && expected.quoteKey !== "sol" && !wire.keys.includes(expected.quoteMint)) throw new Error("The transaction does not include the selected quote mint.");
  for (const amount of [plan.review.networkFeeLamports, plan.review.priorityFeeLamports, plan.review.rentAndProgramCostLamports, plan.review.totalDebitLamports]) {
    if (!/^(0|[1-9][0-9]*)$/.test(String(amount))) throw new Error("The transaction review contains an invalid SOL amount.");
  }
  const allowed: readonly string[] = expected.kind === "token" ? [LIVE_PROGRAMS.compute, LIVE_PROGRAMS.pump, LIVE_PROGRAMS.associatedToken] : [LIVE_PROGRAMS.compute, LIVE_PROGRAMS.core];
  if (wire.programs.some(p => !allowed.includes(p)) || !wire.programs.includes(expected.kind === "token" ? LIVE_PROGRAMS.pump : LIVE_PROGRAMS.core)) throw new Error("The transaction calls an unexpected program.");
  if (!Array.isArray(plan.instructionPrograms) || new Set(plan.instructionPrograms).size !== new Set(wire.programs).size || wire.programs.some(p => !plan.instructionPrograms.includes(p))) throw new Error("The transaction programs differ from the review.");
  validateOperations(wire, expected, plan);
  return wire;
}
export function partiallySignPlan(plan: TransactionPlan, expected: ExpectedPlan, signer: EphemeralSigner): Uint8Array {
  const wire = validateLivePlan(plan, expected);
  if (signer.address !== expected.mint || wire.signatures.some(signature => signature.some(Boolean))) throw new Error("The prepared transaction already contains an unexpected signature.");
  const out = wire.bytes.slice();
  out.set(ed25519.sign(wire.message, signer.seed), wire.signatureOffset + 64);
  return out;
}
/**
 * The page-first order, for wallets not yet tested with wallet-first: checks what the wallet returns for a pre-signed
 * plan. The page's signature covers the exact message, so it must come back byte for byte.
 */
export function validateWalletResult(before: Uint8Array, signed: Uint8Array, creator: string): Uint8Array {
  const original = parseLiveTransaction(before);
  let result: Wire;
  try { result = parseLiveTransaction(signed); } catch { throw new WalletChangedTransaction(signed.slice()); }
  if (!sameBytes(original.message, result.message)) throw new WalletChangedTransaction(signed.slice());
  if (result.signers[0] !== creator || !sameBytes(original.signatures[1], result.signatures[1])) throw new Error("Your wallet changed the prepared transaction. Nothing was submitted.");
  if (!result.signatures.every((sig, i) => ed25519.verify(sig, result.message, fromBase58(result.signers[i])))) throw new Error("The wallet returned invalid or incomplete transaction signatures. Nothing was submitted.");
  return signed;
}

/**
 * Who signs first. "wallet-first": the wallet signs the unsigned plan, then this page adds the new coin or card
 * signature to exactly what the wallet returned (Phantom's documented order). "page-first": the earlier order.
 */
export type SigningOrder = "wallet-first" | "page-first";
export function signingOrderFor(walletName: string | null | undefined, walletFirst: readonly string[] | undefined): SigningOrder {
  const name = walletName?.trim().toLowerCase();
  return name && walletFirst?.some(entry => entry === "*" || entry.trim().toLowerCase() === name) ? "wallet-first" : "page-first";
}
/**
 * Whether this wallet approves the coin and its card in one prompt (a multi-input solana:signTransaction), from the
 * server's list (readiness.walletBatch). Never Phantom, whatever the list says: Phantom blocks multi-transaction requests
 * from a site it has not reviewed (its red "Request blocked" screen).
 */
export function signsBothFor(walletName: string | null | undefined, walletBatch: readonly string[] | undefined): boolean {
  const name = walletName?.trim().toLowerCase();
  return !!name && name !== "phantom" && !!walletBatch?.some(entry => entry === "*" || entry.trim().toLowerCase() === name);
}
export const WALLET_CHANGED_TRANSACTION = "Nothing was sent and nothing was charged. Your wallet returned a different transaction from the one you reviewed, so this page stopped before adding its own signature. Close this review and try again.";
/**
 * The wallet returned a different message. `returned` holds its bytes for the server's change log; they cannot land
 * unsigned by this page. For one prompt with several transactions, `changes` lists every refused one by its position.
 */
export class WalletChangedTransaction extends Error {
  readonly changes: readonly {index: number; returned: Uint8Array}[];
  constructor(readonly returned: Uint8Array, changes?: readonly {index: number; returned: Uint8Array}[]) {
    super(WALLET_CHANGED_TRANSACTION); this.name = "WalletChangedTransaction"; this.changes = changes ?? [{index: 0, returned}];
  }
}
/** The wallet did not return one signed transaction for each one it was asked to sign in a single prompt. */
export class WalletBatchUnsupported extends Error {
  constructor() { super("Your wallet did not sign both transactions in one approval."); this.name = "WalletBatchUnsupported"; }
}
/**
 * Wallet-first: the wallet must return the reviewed message, or that message with only what the shared wallet rule
 * accepts (wallet-guards.ts: read-only Lighthouse assertions appended after every plan instruction, a recompiled key
 * order, a refreshed blockhash that the server re-checks before it relays anything), signed by the creator (the fee
 * payer) in the first slot over the returned message, with the new asset's slot still empty. Anything else is
 * refused, never co-signed.
 */
export function validateWalletFirstResult(unsigned: Uint8Array, signed: Uint8Array, creator: string): Uint8Array {
  const original = parseLiveTransaction(unsigned);
  let result: Wire;
  try { result = parseLiveTransaction(signed); walletMessageChange(original.view, result.view, { allowBlockhashChange: true }); }
  catch { throw new WalletChangedTransaction(signed.slice()); }
  if (result.signers[0] !== creator || !ed25519.verify(result.signatures[0], result.message, fromBase58(creator))) throw new Error("Your wallet did not return a valid signature from the creator wallet. Nothing was submitted.");
  if (result.signatures[1].some(Boolean)) throw new Error("The wallet returned an unexpected second signature. Nothing was submitted.");
  return signed;
}
/** Adds the new coin or card signature to the wallet-signed bytes, then checks both signatures on the final bytes. */
export function addEphemeralSignature(walletSigned: Uint8Array, signer: EphemeralSigner, mint: string): Uint8Array {
  const wire = parseLiveTransaction(walletSigned);
  if (signer.address !== mint || wire.signers[1] !== mint) throw new Error("This page holds a different new-address key than this transaction needs. Nothing was submitted.");
  if (wire.signatures[1].some(Boolean)) throw new Error("The transaction already has a second signature. Nothing was submitted.");
  const out = wire.bytes.slice();
  out.set(ed25519.sign(wire.message, signer.seed), wire.signatureOffset + 64);
  const final = parseLiveTransaction(out);
  if (!sameBytes(final.message, wire.message) || !final.signatures.every((sig, i) => ed25519.verify(sig, final.message, fromBase58(final.signers[i])))) throw new Error("The signed transaction failed its signature check. Nothing was submitted.");
  return out;
}
/**
 * Validates the plan, asks the wallet to sign in the chosen order and returns bytes signed by both the creator and
 * the new asset. `walletSign` is the wallet prompt; it returns whatever the wallet hands back.
 */
export async function signPlanWithWallet(plan: TransactionPlan, expected: ExpectedPlan, signer: EphemeralSigner, order: SigningOrder,
  walletSign: (transaction: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const wire = validateLivePlan(plan, expected);
  if (signer.address !== expected.mint || wire.signatures.some(signature => signature.some(Boolean))) throw new Error("The prepared transaction already contains an unexpected signature.");
  if (order === "page-first") {
    const partial = partiallySignPlan(plan, expected, signer);
    return validateWalletResult(partial, await walletSign(partial), expected.creator);
  }
  const unsigned = wire.bytes.slice();
  const returned = await walletSign(unsigned.slice());
  validateWalletFirstResult(unsigned, returned, expected.creator);
  return addEphemeralSignature(returned, signer, expected.mint);
}

/**
 * Several plans in one wallet prompt (the coin and its card), each checked exactly as signPlanWithWallet checks one:
 * page-first, each pre-signed plan must come back byte for byte; wallet-first, each returned message must pass the
 * shared wallet rule before the page adds its signature. A result count that differs from the request throws
 * WalletBatchUnsupported (nothing was co-signed). Any refused message throws one WalletChangedTransaction listing
 * them all, and nothing is returned.
 */
export async function signPlansWithWallet(items: readonly {plan: TransactionPlan; expected: ExpectedPlan; signer: EphemeralSigner}[], order: SigningOrder,
  walletSignAll: (transactions: Uint8Array[]) => Promise<Uint8Array[]>): Promise<Uint8Array[]> {
  const unsigned = items.map(({plan, expected, signer}) => {
    const wire = validateLivePlan(plan, expected);
    if (signer.address !== expected.mint || wire.signatures.some(signature => signature.some(Boolean))) throw new Error("The prepared transaction already contains an unexpected signature.");
    return wire.bytes.slice();
  });
  const shown = order === "page-first" ? items.map(({plan, expected, signer}) => partiallySignPlan(plan, expected, signer)) : unsigned;
  const returned = await walletSignAll(shown.map(bytes => bytes.slice()));
  if (!Array.isArray(returned) || returned.length !== items.length) throw new WalletBatchUnsupported();
  const changes: {index: number; returned: Uint8Array}[] = [];
  const signed = items.map(({expected, signer}, index) => {
    try {
      if (order === "page-first") return validateWalletResult(shown[index], returned[index], expected.creator);
      validateWalletFirstResult(shown[index], returned[index], expected.creator);
      return addEphemeralSignature(returned[index], signer, expected.mint);
    } catch (error) {
      if (!(error instanceof WalletChangedTransaction)) throw error;
      changes.push({index, returned: error.returned}); return null;
    }
  });
  if (changes.length) throw new WalletChangedTransaction(changes[0].returned, changes);
  return signed as Uint8Array[];
}

/** A plan this page received more than ~30 s ago is prepared again before the wallet opens, so its blockhash is fresh. */
export const PLAN_FRESH_MS = 30_000;
/**
 * The coin and card prepared together are fresh for ~15 s: the card's blockhash must outlive the wallet prompt, the
 * coin's landing and its finalized verification (about 20 s) before the card can be sent, inside its ~150-block window.
 */
export const PAIR_FRESH_MS = 15_000;
export const planIsStale = (receivedAt: number, now: number, maxAgeMs = PLAN_FRESH_MS) => !(receivedAt > 0) || now - receivedAt > maxAgeMs;
/**
 * Whether a re-prepared plan can go to the wallet without another review: same stage, quote and initial buy, a SOL
 * total that rose by no more than the priority-fee change, and a minimum coin output that did not fall.
 */
export function refreshKeepsReview(previous: TransactionPlan, next: TransactionPlan): boolean {
  const before = previous.review, after = next.review;
  const priorityRise = BigInt(after.priorityFeeLamports) > BigInt(before.priorityFeeLamports) ? BigInt(after.priorityFeeLamports) - BigInt(before.priorityFeeLamports) : 0n;
  return next.kind === previous.kind && after.quoteMint === before.quoteMint && after.initialBuyQuoteBaseUnits === before.initialBuyQuoteBaseUnits &&
    BigInt(after.totalDebitLamports) <= BigInt(before.totalDebitLamports) + priorityRise && BigInt(after.minimumTokensOut) >= BigInt(before.minimumTokensOut);
}
/**
 * The plan to open the wallet with. A fresh plan goes as it is. A stale one is prepared again through `refresh`
 * (which validates it): "refreshed" when nothing reviewed moved, "changed" when the review must be shown again,
 * "gone" when the stage no longer needs this transaction.
 */
export async function planForWallet(plan: TransactionPlan, receivedAt: number, refresh: () => Promise<TransactionPlan | null>, now = Date.now()):
  Promise<{status: "fresh" | "refreshed" | "changed"; plan: TransactionPlan} | {status: "gone"}> {
  if (!planIsStale(receivedAt, now)) return {status: "fresh", plan};
  const next = await refresh();
  if (!next) return {status: "gone"};
  return {status: refreshKeepsReview(plan, next) ? "refreshed" : "changed", plan: next};
}
/**
 * The next step for a signed transaction the server did not broadcast, from the stage read back afterwards: "prepare"
 * when nothing is saved and the server will never send those bytes, "resend" when nothing is saved and the same
 * signed bytes can go again, null when the stage holds a saved signature (recover that instead).
 */
export function unsentStageNext(stage: { status: string; nftSignature: string | null }, kind: "token" | "nft", unsendable: boolean): "prepare" | "resend" | null {
  const unsaved = kind === "token" ? stage.status === "prepared" : stage.status === "nft_pending" && !stage.nftSignature;
  return !unsaved ? null : unsendable ? "prepare" : "resend";
}
