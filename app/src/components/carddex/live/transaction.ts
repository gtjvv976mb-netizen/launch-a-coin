import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MAINNET_CHAIN = "solana:mainnet" as const;
export const LIVE_PROGRAMS = {
  compute: "ComputeBudget111111111111111111111111111111",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  core: "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
} as const;

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
    [key: string]: unknown;
  };
};

type WireInstruction = { program: string; accounts: string[]; data: Uint8Array };
type Wire = { bytes: Uint8Array; message: Uint8Array; signatureOffset: number; signatures: Uint8Array[]; signers: string[]; blockhash: string; programs: string[]; keys: string[]; instructions: WireInstruction[] };
/** Narrow parser for this adapter's v0 transactions. Lookup tables and additional signers are refused. */
export function parseLiveTransaction(bytes: Uint8Array): Wire {
  if (bytes.length > 1232 || bytes.length < 134) throw new Error("The prepared transaction has an invalid size.");
  let offset = 0;
  const take = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error("The transaction is truncated.");
    const out = bytes.slice(offset, offset + length); offset += length; return out;
  };
  const byte = () => take(1)[0];
  const length = () => {
    let n = 0, shift = 0;
    for (let i = 0; i < 3; i++) {
      const b = byte(); n |= (b & 127) << shift;
      if (!(b & 128)) { if (i > 0 && b === 0) throw new Error("Non-canonical transaction length."); return n; }
      shift += 7;
    }
    throw new Error("Invalid transaction length.");
  };
  const count = length();
  if (count !== 2) throw new Error("This launch must require only the creator and new asset signatures.");
  const signatureOffset = offset;
  const signatures = Array.from({ length: count }, () => take(64));
  const messageOffset = offset;
  if (byte() !== 0x80) throw new Error("This launch requires a version 0 transaction.");
  const required = byte(), readonlySigned = byte(), readonlyUnsigned = byte();
  const keyCount = length();
  if (required !== count || readonlySigned !== 0 || keyCount < required || keyCount > 256 || readonlyUnsigned > keyCount - required) throw new Error("Invalid transaction account header.");
  const keys = Array.from({ length: keyCount }, () => base58(take(32)));
  if (new Set(keys).size !== keys.length) throw new Error("The transaction repeats an account.");
  const blockhash = base58(take(32));
  const instructionCount = length(), programs: string[] = [], instructions: WireInstruction[] = [];
  if (!instructionCount || instructionCount > 20) throw new Error("Unexpected launch instruction count.");
  for (let i = 0; i < instructionCount; i++) {
    const program = byte();
    if (program >= keyCount || program === 0) throw new Error("Invalid transaction program.");
    programs.push(keys[program]);
    const indexes = take(length());
    for (const account of indexes) if (account >= keyCount) throw new Error("Invalid instruction account.");
    instructions.push({ program: keys[program], accounts: Array.from(indexes, i => keys[i]), data: take(length()) });
  }
  if (length() !== 0) throw new Error("Address lookup tables are not used by this launch adapter.");
  if (offset !== bytes.length) throw new Error("The transaction contains unexpected trailing bytes.");
  return { bytes, message: bytes.slice(messageOffset), signatureOffset, signatures, signers: keys.slice(0, required), blockhash, programs, keys, instructions };
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
  if (limit <= 0 || limit > 1_400_000 || micro < 1000n || micro > 100_000n || plan.review.computeUnitLimit !== limit || String(plan.review.microLamportsPerComputeUnit) !== micro.toString() || String(plan.review.priorityFeeLamports) !== priority.toString()) throw new Error("The actual priority fee differs from the cost review.");
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
export function validateLivePlan(plan: TransactionPlan, expected: ExpectedPlan): Wire {
  const wire = parseLiveTransaction(fromBase64(plan.transactionBase64));
  if (plan.network !== MAINNET_CHAIN) throw new Error("This launch transaction is not for Solana mainnet.");
  if (plan.kind !== expected.kind || plan.feePayer !== expected.creator || wire.signers[0] !== expected.creator) throw new Error("The transaction fee payer does not match your connected wallet.");
  if (wire.signers[1] !== expected.mint || plan.requiredSigners.length !== 2 || plan.requiredSigners.some((s, i) => s !== wire.signers[i])) throw new Error("The transaction requires an unexpected signer.");
  if (wire.blockhash !== plan.blockhash || hexHash(wire.message) !== plan.messageSha256 || plan.bindingSha256 !== expected.bindingSha256) throw new Error("The transaction does not match this launch commitment.");
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
export function validateWalletResult(before: Uint8Array, signed: Uint8Array, creator: string): Uint8Array {
  const original = parseLiveTransaction(before), result = parseLiveTransaction(signed);
  if (!sameBytes(original.message, result.message) || result.signers[0] !== creator || !sameBytes(original.signatures[1], result.signatures[1])) throw new Error("Your wallet changed the prepared transaction. Nothing was submitted.");
  if (!result.signatures.every((sig, i) => ed25519.verify(sig, result.message, fromBase58(result.signers[i])))) throw new Error("The wallet returned invalid or incomplete transaction signatures. Nothing was submitted.");
  return signed;
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
