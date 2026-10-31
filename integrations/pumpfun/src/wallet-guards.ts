/**
 * One rule, shared by the browser (before the page co-signs) and the server (before it stores or relays): what a
 * wallet may change in a prepared launch transaction it signs first. Dependency-free so the browser bundle can use it.
 *
 * Phantom documents that it may add Lighthouse assertion instructions and may refresh the blockhash during
 * solana:signTransaction. A real Phantom wallet-first two-signer v0 transaction (mainnet 4WC4bx…, 2026-10-28) got five
 * assertions from Lighthouse v2 appended after every app instruction, with the message recompiled: the program key
 * sits mid-way through the readonly section, so indexes shift. So messages are compared decompiled (program, account
 * keys with their signer and writable flags, data), never as bytes or indexes.
 *
 * Accepted, and nothing else:
 * - the same decompiled message (a byte-identical one, or the same keys and instructions recompiled), or
 * - that message with read-only Lighthouse assertions appended after the last plan instruction: program exactly
 *   LIGHTHOUSE_PROGRAM_ID, an Assert* discriminator that reads one account (AccountInfo, MintAccount or TokenAccount,
 *   single or Multi), exactly one account that the plan already has, at most MAX_GUARD_DATA_BYTES of data; the only
 *   new key is the Lighthouse program, read-only and unsigned; every plan key keeps its signer and writable flags;
 * - with `allowBlockhashChange`, a different recentBlockhash. The server accepts it only after its RPC confirms the
 *   blockhash is still valid, and then bounds every expiry gate by an effective last valid block height.
 * The signer header, the signer keys and their order (the creator first), the lookup tables and every plan
 * instruction, both compute-budget instructions included, stay exactly as prepared.
 */

/** Lighthouse v2.0.0: declare_id! and README mainnet id in Jac0xb/lighthouse; immutable on mainnet (no upgrade authority). */
export const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
/**
 * Lighthouse v2 instruction variants (Borsh index) that only read exactly one account: 5 AssertAccountInfo,
 * 6 AssertAccountInfoMulti, 7 AssertMintAccount, 8 AssertMintAccountMulti, 9 AssertTokenAccount,
 * 10 AssertTokenAccountMulti. MemoryWrite (0) and MemoryClose (1) write a memory account and need the payer's
 * signature; the old v0.1 program L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK (still upgradeable, shifted enum) is
 * never accepted.
 */
export const LIGHTHOUSE_GUARD_DISCRIMINATORS: readonly number[] = [5, 6, 7, 8, 9, 10];
export const MAX_GUARD_DATA_BYTES = 200;
/** Five to nine assertions have been seen on real Phantom transactions; the packet limit bounds the rest. */
export const MAX_WALLET_GUARDS = 16;
/** The most instructions a launch transaction may carry, wallet assertions included. */
export const MAX_LAUNCH_INSTRUCTIONS = 32;
/** Solana's packet limit for one signed transaction. */
export const PACKET_LIMIT = 1232;
/**
 * Bytes kept free under the packet limit for a wallet's appended assertions: 32 for the Lighthouse program key and
 * about 31 per assertion (186 bytes for five on the real Phantom transaction; a launch gets the payer and each creator
 * token account whose balance changes, so one to three). Phantom also names "close to the size limit" as a trigger for
 * its red warning, so prepare never offers a transaction above WALLET_SIZE_TARGET.
 */
export const WALLET_GUARD_RESERVE_BYTES = 160;
export const WALLET_SIZE_TARGET = PACKET_LIMIT - WALLET_GUARD_RESERVE_BYTES;

/**
 * pump.fun's own create lookup table (the one its create_v2 + buy transactions on mainnet load), pinned to the
 * entries the coin transaction uses. Table entries never change once written (a table only grows, deactivates and
 * closes, and a closed address cannot be created again), so a pinned index always means the same address. The server
 * re-reads the table before each use (owner, never deactivated, every pinned entry) and otherwise builds the
 * transaction without it; the browser resolves lookups only through these pinned entries and refuses any other.
 *
 * Indexes 5, 6, 13 and 151 (31 October 2026, read on mainnet) serve the creator fee-sharing transaction, whose
 * pump-fees instructions list the AMM program, its event authority and the ATA program as accounts. An invoked program
 * is always a static key, so pinning one never moves it into the table. Saved messages only reference older indexes,
 * so they decode exactly as before; a create-only coin prepared from now on is 31 bytes smaller (the ATA program is a
 * create_v2 account there). The pump-fees program itself (index 15) is invoked and is never pinned.
 */
export const PUMP_LOOKUP_TABLE = {
  address: "Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP",
  entries: [
    [1, "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"], // Pump global
    [3, "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"], // Pump event authority
    [5, "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"], // Pump AMM program (pump-fees account)
    [6, "GS4CU59F31iL7aR2Q8zVS8DRrcRnXX1yjQ66TqNVQnaR"], // Pump AMM event authority
    [10, "11111111111111111111111111111111"], // System program
    [11, "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"], // Token-2022
    [12, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], // SPL Token
    [13, "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"], // Associated token program
    [14, "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"], // Pump fee config
    [16, "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e"], // Mayhem program (create_v2 account)
    [18, "13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ"], // Pump global params
    [19, "BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s"], // Mayhem sol vault
    [29, "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD"], // Pump buyback fee recipient
    [71, "6oCkp6gpyjxVTeL6ahMYcekN2x2pzt1KY8g2LqemaTNE"], // that recipient's USDC account
    [124, "So11111111111111111111111111111111111111112"], // wrapped SOL
    [125, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"], // USDC
    [151, "D6QxXDt6hhcCpto4HiZKkN2YQ2iZRF5R7S3caCHpUsML"], // pump-fees event authority
    [158, "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"], // Pump mint authority
  ] as ReadonlyArray<readonly [number, string]>,
} as const;
const PINNED_TABLES: ReadonlyMap<string, ReadonlyMap<number, string>> = new Map([[PUMP_LOOKUP_TABLE.address, new Map(PUMP_LOOKUP_TABLE.entries)]]);

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export type MessageLookup = { table: string; writable: number[]; readonly: number[] };
export type MessageInstruction = { program: number; accounts: number[]; data: Uint8Array };
/** A decoded v0 message. `keys` is the static keys, then the lookup-resolved writable and readonly keys. */
export type MessageView = {
  bytes: Uint8Array;
  header: { required: number; readonlySigned: number; readonlyUnsigned: number };
  staticKeys: string[];
  lookups: MessageLookup[];
  keys: string[];
  blockhash: string;
  instructions: MessageInstruction[];
};

/**
 * Strict canonical decoder for a v0 message (the bytes after the signatures). Lookups resolve only through the pinned
 * tables, invoked programs must be static keys, and no key may repeat. It never fetches anything.
 */
export function decodeV0Message(bytes: Uint8Array): MessageView {
  let offset = 0;
  const take = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error("The transaction message is truncated.");
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
  if (byte() !== 0x80) throw new Error("This launch requires a version 0 transaction.");
  const required = byte(), readonlySigned = byte(), readonlyUnsigned = byte();
  const keyCount = length();
  if (required < 1 || readonlySigned >= required || keyCount < required || keyCount > 256 || readonlyUnsigned > keyCount - required) throw new Error("Invalid transaction account header.");
  const staticKeys = Array.from({ length: keyCount }, () => base58(take(32)));
  const blockhash = base58(take(32));
  const instructionCount = length(), raw: MessageInstruction[] = [];
  if (!instructionCount || instructionCount > MAX_LAUNCH_INSTRUCTIONS) throw new Error("Unexpected launch instruction count.");
  for (let i = 0; i < instructionCount; i++) {
    const program = byte();
    if (program === 0 || program >= keyCount) throw new Error("Invalid transaction program.");
    raw.push({ program, accounts: Array.from(take(length())), data: take(length()) });
  }
  const lookupCount = length(), lookups: MessageLookup[] = [], writableKeys: string[] = [], readonlyKeys: string[] = [];
  for (let i = 0; i < lookupCount; i++) {
    const table = base58(take(32)), writable = Array.from(take(length())), readonly = Array.from(take(length()));
    const pinned = PINNED_TABLES.get(table);
    if (!pinned || lookups.some(lookup => lookup.table === table)) throw new Error("The transaction loads an unexpected address lookup table.");
    const resolve = (index: number) => { const key = pinned.get(index); if (!key) throw new Error("The transaction loads an unexpected lookup-table entry."); return key; };
    writableKeys.push(...writable.map(resolve)); readonlyKeys.push(...readonly.map(resolve));
    lookups.push({ table, writable, readonly });
  }
  if (offset !== bytes.length) throw new Error("The transaction contains unexpected trailing bytes.");
  const keys = [...staticKeys, ...writableKeys, ...readonlyKeys];
  if (new Set(keys).size !== keys.length) throw new Error("The transaction repeats an account.");
  for (const ix of raw) for (const account of ix.accounts) if (account >= keys.length) throw new Error("Invalid instruction account.");
  return { bytes: bytes.slice(), header: { required, readonlySigned, readonlyUnsigned }, staticKeys, lookups, keys, blockhash, instructions: raw };
}

/** Signer and writable flags of the key at `index`, from the header (static keys) or the lookup section. */
export function keyFlags(view: MessageView, index: number): { signer: boolean; writable: boolean } {
  const { required, readonlySigned, readonlyUnsigned } = view.header, statics = view.staticKeys.length;
  if (index < statics) return { signer: index < required, writable: index < required ? index < required - readonlySigned : index < statics - readonlyUnsigned };
  const lookupWritable = view.lookups.reduce((total, lookup) => total + lookup.writable.length, 0);
  return { signer: false, writable: index < statics + lookupWritable };
}

export type ResolvedInstruction = { program: string; accounts: string[]; data: Uint8Array };
export const resolveInstructions = (view: MessageView): ResolvedInstruction[] =>
  view.instructions.map(ix => ({ program: view.keys[ix.program], accounts: ix.accounts.map(index => view.keys[index]), data: ix.data }));
const sameInstruction = (a: ResolvedInstruction, b: ResolvedInstruction) =>
  a.program === b.program && sameBytes(a.data, b.data) && a.accounts.length === b.accounts.length && a.accounts.every((key, i) => key === b.accounts[i]);

/** One appended assertion, for the log: its discriminator, the plan key index it reads and its data size. */
export type WalletGuard = { discriminator: number; target: number; dataBytes: number };
export type WalletMessageChange = { identical: boolean; recompiled: boolean; blockhashChanged: boolean; guards: WalletGuard[] };
export type WalletChangeRefusal = "header" | "signers" | "lookups" | "blockhash" | "instructions" | "guard" | "accounts" | "flags";
export class WalletMessageRefused extends Error {
  constructor(readonly reason: WalletChangeRefusal) { super(`The wallet changed the prepared transaction (${reason}).`); this.name = "WalletMessageRefused"; }
}

/** Whether one resolved instruction is an accepted Lighthouse assertion shape: program, discriminator, one account, size. */
export function isLighthouseGuard(ix: ResolvedInstruction): boolean {
  return ix.program === LIGHTHOUSE_PROGRAM_ID && ix.data.length >= 2 && ix.data.length <= MAX_GUARD_DATA_BYTES &&
    LIGHTHOUSE_GUARD_DISCRIMINATORS.includes(ix.data[0]) && ix.accounts.length === 1;
}
/**
 * Finalized-transaction form of the rule: the instructions before any trailing Lighthouse assertions. With
 * `allowGuards` false (the landed message was not the one the server validated), any Lighthouse instruction refuses;
 * with it true, Lighthouse instructions must be a suffix of accepted assertion shapes, each reading one of the
 * message's other keys (`keys`: every static and loaded key), exactly as walletMessageChange accepted them.
 */
export function withoutWalletGuards<T extends ResolvedInstruction>(instructions: T[], allowGuards: boolean, keys: readonly string[]): T[] {
  const first = instructions.findIndex(ix => ix.program === LIGHTHOUSE_PROGRAM_ID);
  if (first < 0) return instructions;
  const plan = instructions.slice(0, first), guards = instructions.slice(first);
  const known = new Set(keys.filter(key => key !== LIGHTHOUSE_PROGRAM_ID));
  if (!allowGuards || guards.length > MAX_WALLET_GUARDS || !guards.every(ix => isLighthouseGuard(ix) && known.has(ix.accounts[0]))) throw new WalletMessageRefused("guard");
  return plan;
}

/**
 * The shared rule. Throws WalletMessageRefused for anything outside it; otherwise says whether the message is
 * byte-identical, recompiled, carries a refreshed blockhash, and which assertions were appended.
 */
export function walletMessageChange(plan: MessageView, returned: MessageView, options: { allowBlockhashChange?: boolean } = {}): WalletMessageChange {
  if (sameBytes(plan.bytes, returned.bytes)) return { identical: true, recompiled: false, blockhashChanged: false, guards: [] };
  const refuse = (reason: WalletChangeRefusal): never => { throw new WalletMessageRefused(reason); };
  if (returned.header.required !== plan.header.required || returned.header.readonlySigned !== plan.header.readonlySigned) refuse("header");
  for (let i = 0; i < plan.header.required; i++) if (returned.staticKeys[i] !== plan.staticKeys[i]) refuse("signers");
  if (returned.lookups.length !== plan.lookups.length || returned.lookups.some((lookup, i) => lookup.table !== plan.lookups[i].table ||
    lookup.writable.join() !== plan.lookups[i].writable.join() || lookup.readonly.join() !== plan.lookups[i].readonly.join())) refuse("lookups");
  const blockhashChanged = returned.blockhash !== plan.blockhash;
  if (blockhashChanged && !options.allowBlockhashChange) refuse("blockhash");
  // Every plan instruction, unchanged and in order (both compute-budget instructions included), then only assertions.
  const planned = resolveInstructions(plan), actual = resolveInstructions(returned);
  if (actual.length < planned.length || planned.some((ix, i) => !sameInstruction(ix, actual[i]))) refuse("instructions");
  const extra = actual.slice(planned.length), planKeys = new Map(plan.keys.map((key, i) => [key, i]));
  if (extra.length > MAX_WALLET_GUARDS) refuse("guard");
  const guards = extra.map(ix => {
    if (!isLighthouseGuard(ix) || !planKeys.has(ix.accounts[0])) refuse("guard");
    return { discriminator: ix.data[0], target: planKeys.get(ix.accounts[0])!, dataBytes: ix.data.length };
  });
  // Keys: the plan's static keys, plus only the Lighthouse program when assertions were appended, read-only and unsigned.
  const added = returned.staticKeys.filter(key => !planKeys.has(key));
  const expectedAdded = guards.length ? [LIGHTHOUSE_PROGRAM_ID] : [];
  if (returned.staticKeys.length !== plan.staticKeys.length + expectedAdded.length || added.join() !== expectedAdded.join() ||
    returned.keys.length !== plan.keys.length + expectedAdded.length || plan.staticKeys.some(key => !returned.staticKeys.includes(key))) refuse("accounts");
  const returnedIndex = new Map(returned.keys.map((key, i) => [key, i]));
  for (const [key, index] of planKeys) {
    const before = keyFlags(plan, index), at = returnedIndex.get(key);
    if (at === undefined) refuse("accounts");
    const after = keyFlags(returned, at!);
    if (before.signer !== after.signer || before.writable !== after.writable) refuse("flags");
  }
  if (guards.length) {
    const flags = keyFlags(returned, returnedIndex.get(LIGHTHOUSE_PROGRAM_ID)!);
    if (flags.signer || flags.writable) refuse("flags");
  }
  if (returned.header.readonlyUnsigned !== plan.header.readonlyUnsigned + expectedAdded.length) refuse("flags");
  return { identical: false, recompiled: true, blockhashChanged, guards };
}
