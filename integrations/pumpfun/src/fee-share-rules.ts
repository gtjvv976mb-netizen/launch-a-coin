/**
 * One rule for the creator fee-sharing transaction, shared by the browser (before the wallet opens) and the server
 * (when it prepares, before it relays, and after the transaction is finalized). Dependency-free, like wallet-guards.ts:
 * each side derives the program addresses itself and passes them in, so this file only compares.
 *
 * The transaction, verified by unsigned mainnet simulation on 31 October 2026, signed by the creator alone:
 *   2 compute-budget instructions,
 *   pump `sweep_creator_fee` (pays fees already earned to the creator's own pump.fun vault; without it a curve with
 *     earned fees refuses the config with 6095 CreatorFeesNotSwept),
 *   pump-fees `create_fee_sharing_config` (left out when the config already exists and is still editable),
 *   on a token quote only, one idempotent ATA create for the sharing vault's quote account (update_fee_shares_v2 fails
 *     InvalidAccountData without it),
 *   pump-fees `update_fee_shares` (SOL) or `update_fee_shares_v2` (any other quote), which locks the split for good.
 * Nothing else: no transfer, no other program, no second signer. Launch a Card is never a recipient.
 */

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_FEES_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Anchor discriminators (pump and pump-fees IDLs in @pump-fun/pump-sdk 4.1.0). */
export const FEE_SHARE_DISCRIMINATORS = {
  sweep: "20f6bf3408c949ba", create: "c34e564c6f34fbd5", update: "bd0d8863bba4ed23", updateV2: "6ffb31064e4e6a12",
} as const;
/**
 * The most recipients one split may have here. pump.fun allows 10, but the transaction must stay under the wallet size
 * target (1,072 bytes) with the config create on every pair: measured with the pinned lookup table, SOL fits 10, USDC 8
 * and other token quotes 7.
 */
export const MAX_FEE_RECIPIENTS = 7;
export const TOTAL_FEE_BPS = 10_000;

export type FeeRecipient = { address: string; bps: number };
type Instruction = { program: string; accounts: string[]; data: Uint8Array };
/** What the transaction must say, with the program addresses the caller derived. */
export type FeeShareExpected = {
  creator: string; mint: string; quoteMint: string; quoteTokenProgram: string; sol: boolean; recipients: readonly FeeRecipient[];
  bondingCurve: string; sharingConfig: string;
  /** creatorVaultPda(sharing config) and its quote token account (token quotes only). */
  sharingVault: string; sharingVaultQuoteAccount: string | null;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

/** The shareholder vector an update instruction carries (after its 8-byte discriminator): u32 count, then address + u16 bps. */
export function decodeFeeShares(data: Uint8Array): FeeRecipient[] {
  if (data.length < 12) throw new Error("The fee split data is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), count = view.getUint32(8, true);
  if (count > 10 || data.length !== 12 + 34 * count) throw new Error("The fee split data has an unexpected length.");
  return Array.from({ length: count }, (_, i) => ({ address: base58(data.slice(12 + 34 * i, 44 + 34 * i)), bps: view.getUint16(44 + 34 * i, true) }));
}
export const sameFeeSplit = (a: readonly FeeRecipient[], b: readonly FeeRecipient[]) =>
  a.length === b.length && a.every((entry, i) => entry.address === b[i].address && entry.bps === b[i].bps);

/**
 * Why a recipient list is not one this site accepts, or null. `isWallet` is the caller's on-curve check (a wallet
 * address; a PDA or other off-curve key is refused). `forbidden` names addresses that are never recipients (the coin,
 * its card, the quote mint, the curve, the sharing config, program ids).
 */
export function feeRecipientsProblem(recipients: readonly FeeRecipient[], options: { isWallet: (address: string) => boolean; forbidden?: readonly string[] }): string | null {
  if (!Array.isArray(recipients) || recipients.length < 1) return "Add at least one wallet to share creator fees with.";
  if (recipients.length > MAX_FEE_RECIPIENTS) return `A fee split can have at most ${MAX_FEE_RECIPIENTS} wallets.`;
  const seen = new Set<string>();
  let total = 0;
  for (const entry of recipients) {
    if (!entry || typeof entry.address !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry.address)) return "Each recipient must be a Solana wallet address.";
    if (!options.isWallet(entry.address)) return `${entry.address.slice(0, 4)}…${entry.address.slice(-4)} is not a Solana wallet address. Recipients must be Solana wallets.`;
    if (options.forbidden?.includes(entry.address)) return `${entry.address.slice(0, 4)}…${entry.address.slice(-4)} is this coin's own account, not a wallet. Recipients must be Solana wallets.`;
    if (seen.has(entry.address)) return "Each wallet can appear only once in the fee split.";
    if (!Number.isInteger(entry.bps) || entry.bps <= 0 || entry.bps > TOTAL_FEE_BPS) return "Each wallet's share must be more than 0%, in steps of 0.01%.";
    seen.add(entry.address); total += entry.bps;
  }
  return total === TOTAL_FEE_BPS ? null : `The shares add up to ${(total / 100).toFixed(2)}%. They must add up to exactly 100%.`;
}

/**
 * Why these instructions (resolved, wallet assertions already removed) are not the fee-sharing transaction for
 * `expected`, or null. Order and every checked account are exact; the update's shareholders must equal the stored
 * recipients address for address and share for share.
 */
export function feeShareInstructionsProblem(instructions: readonly Instruction[], expected: FeeShareExpected): string | null {
  const compute = instructions.slice(0, 2), rest = instructions.slice(2);
  if (compute.length !== 2 || compute.some(ix => ix.program !== COMPUTE_BUDGET_PROGRAM || ix.accounts.length) ||
    instructions.slice(2).some(ix => ix.program === COMPUTE_BUDGET_PROGRAM)) return "The fee split transaction has unexpected compute-budget operations.";
  const [sweep, ...after] = rest;
  if (!sweep || sweep.program !== PUMP_PROGRAM || hex(sweep.data) !== FEE_SHARE_DISCRIMINATORS.sweep || sweep.accounts.length !== 13 ||
    sweep.accounts[0] !== expected.creator || sweep.accounts[2] !== expected.mint || sweep.accounts[3] !== expected.quoteMint ||
    sweep.accounts[4] !== expected.quoteTokenProgram || sweep.accounts[7] !== expected.bondingCurve) return "The fee split transaction does not start by collecting this coin's earned creator fees.";
  let next = 0;
  if (after[next]?.program === PUMP_FEES_PROGRAM && hex(after[next].data) === FEE_SHARE_DISCRIMINATORS.create) {
    const create = after[next++];
    if (create.data.length !== 8 || create.accounts.length !== 13 || create.accounts[2] !== expected.creator || create.accounts[4] !== expected.mint ||
      create.accounts[5] !== expected.sharingConfig || create.accounts[7] !== expected.bondingCurve) return "The fee-sharing setup does not match this coin and creator.";
  }
  if (!expected.sol) {
    const ata = after[next++];
    if (!ata || ata.program !== ASSOCIATED_TOKEN_PROGRAM || ata.data.length !== 1 || ata.data[0] !== 1 || ata.accounts.length !== 6 ||
      ata.accounts[0] !== expected.creator || ata.accounts[1] !== expected.sharingVaultQuoteAccount || ata.accounts[2] !== expected.sharingVault ||
      ata.accounts[3] !== expected.quoteMint || ata.accounts[4] !== SYSTEM_PROGRAM || ata.accounts[5] !== expected.quoteTokenProgram) return "The fee split transaction opens an unexpected token account.";
  }
  const update = after[next++];
  if (!update || update.program !== PUMP_FEES_PROGRAM || hex(update.data.slice(0, 8)) !== (expected.sol ? FEE_SHARE_DISCRIMINATORS.update : FEE_SHARE_DISCRIMINATORS.updateV2) ||
    update.accounts[2] !== expected.creator || update.accounts[4] !== expected.mint || update.accounts[5] !== expected.sharingConfig ||
    update.accounts[6] !== expected.bondingCurve || update.accounts[7] !== expected.sharingVault) return "The fee split instruction does not match this coin and creator.";
  let shares: FeeRecipient[];
  try { shares = decodeFeeShares(update.data); } catch (error) { return error instanceof Error ? error.message : "The fee split data is unreadable."; }
  if (!sameFeeSplit(shares, expected.recipients)) return "The fee split differs from the wallets and shares you chose.";
  if (next !== after.length) return "The fee split transaction contains an unexpected operation.";
  return null;
}
