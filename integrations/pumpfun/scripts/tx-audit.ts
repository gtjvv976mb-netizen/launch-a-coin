// Read-only mainnet audit of the two launch transactions, built exactly as production builds them.
//
//   bun scripts/tx-audit.ts [outDir]
//
// The coin transaction comes from the production prepareTokenTransaction and measureTokenTransaction. The card
// transaction comes from the production prepareCreatorNftAheadOfCoin, the card plan one wallet approval signs together
// with its coin; it is built while the coin is not on chain.
// Every simulation runs with sigVerify off. Nothing is signed or sent, and no secret is read: the fee payer is a
// public, well-funded mainnet address used only as a simulation input, and the coin mint and card asset are
// throwaway public keys (their secret halves are dropped unused). RPC calls are counted, throttled and logged.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import BN from "bn.js";
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionInstruction,
  VersionedTransaction, type AccountInfo, type MessageV0,
} from "@solana/web3.js";
import {
  ExtensionType, getAssociatedTokenAddressSync, getExtensionTypes, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  unpackAccount, unpackMint,
} from "@solana/spl-token";
import {
  bondingCurvePda, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_PROGRAM_ID, PUMP_SDK, QUOTE_CONTROL_PDA,
} from "@pump-fun/pump-sdk";
import { getCreateV2InstructionDataSerializer, getUpdateV1InstructionDataSerializer } from "@metaplex-foundation/mpl-core";
import pumpIdl from "../node_modules/@pump-fun/pump-sdk/src/idl/pump.json";
import art from "../src/design-assets.json";
import { PAIR_ASSETS, PUBLIC_MAINNET_RPC } from "../src/index.ts";
import {
  CORE_PROGRAM_ID, PACKET_LIMIT, PUMP_LOOKUP_TABLE, WALLET_SIZE_TARGET,
  describeWalletChange, measureTokenTransaction, prepareCreatorNftAheadOfCoin,
  prepareTokenTransaction, transactionBytes, validateSignedWalletTransaction, type LiveLaunchInput, type WalletTransactionPlan,
} from "../src/live.ts";
import { WalletMessageRefused, decodeV0Message, keyFlags, walletMessageChange } from "../src/wallet-guards.ts";
import { messageOf, payerGuardData, phantomGuarded, tokenGuardData, unsignedTransaction } from "../tests/message-fixtures.ts";
import {
  parseLiveTransaction, validateLivePlan, validateWalletFirstResult, WalletChangedTransaction, type ExpectedPlan,
} from "../../../app/src/components/carddex/live/transaction";

const OUT = process.argv[2] ?? "/Users/michaelkennethbrillantes/code/launch-a-card-audit/mainnet/tx-audit";
mkdirSync(OUT, { recursive: true });
const ORIGIN = "https://launchacard.fun";
const LIGHTHOUSE = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
const LIGHTHOUSE_V0 = new PublicKey("L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = "11111111111111111111111111111111";
const save = (name: string, value: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");

// ---- Counted, throttled RPC (public endpoint, no key) -------------------------------------------------------
const calls: { method: string; at: string }[] = [];
let lastCall = 0;
const throttledFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const wait = lastCall + 400 - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  lastCall = Date.now();
  try {
    const body = JSON.parse(String(init?.body ?? "{}"));
    for (const request of Array.isArray(body) ? body : [body]) calls.push({ method: request.method, at: new Date().toISOString() });
  } catch { calls.push({ method: "unknown", at: new Date().toISOString() }); }
  return fetch(input, init);
};
const base = new Connection(PUBLIC_MAINNET_RPC, { commitment: "confirmed", fetch: throttledFetch as never });
const genesis = await base.getGenesisHash();
// The production code asks for the genesis hash on every call; answer repeats from the one read above.
const connection = new Proxy(base, { get(target, prop) {
  if (prop === "getGenesisHash") return async () => genesis;
  const value = Reflect.get(target, prop);
  return typeof value === "function" ? value.bind(target) : value;
} }) as Connection;
async function rpc<T = any>(method: string, params: unknown[]): Promise<T> {
  const response = await throttledFetch(PUBLIC_MAINNET_RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await response.json() as { result?: T; error?: unknown };
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result as T;
}

// ---- Fee payer: a public exchange hot wallet with SOL and USDC (simulation input only) ----------------------
const USDC = PAIR_ASSETS.find((asset) => asset.key === "usdc")!, TSLAX = PAIR_ASSETS.find((asset) => asset.key === "tslax")!;
const candidates = [
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm",
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD", "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2",
].map((key) => new PublicKey(key));
const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(new PublicKey(USDC.mint), owner, false, TOKEN_PROGRAM_ID);
const candidateInfo = await base.getMultipleAccountsInfo([...candidates, ...candidates.map(usdcAta)], "confirmed");
const payerChoice = candidates.map((key, index) => {
  const account = candidateInfo[index], ata = candidateInfo[candidates.length + index];
  const usdcBalance = ata && ata.owner.equals(TOKEN_PROGRAM_ID) ? unpackAccount(usdcAta(key), ata, TOKEN_PROGRAM_ID).amount : 0n;
  return { address: key.toBase58(), onCurve: PublicKey.isOnCurve(key.toBytes()), lamports: account?.lamports ?? 0,
    systemOwned: account?.owner.toBase58() === SYSTEM, dataLength: account?.data.length ?? null, usdcBaseUnits: usdcBalance.toString() };
});
const chosen = payerChoice.find((entry) => entry.onCurve && entry.systemOwned && entry.dataLength === 0 && entry.lamports > 5_000_000_000 && BigInt(entry.usdcBaseUnits) > 10_000_000n);
if (!chosen) throw new Error(`No public fee payer qualified: ${JSON.stringify(payerChoice)}`);
const payer = new PublicKey(chosen.address);
save("00-fee-payer.json", { note: "Public mainnet address used only as a simulation input (fee payer and creator). Never signed for.", chosen: chosen.address, candidates: payerChoice });

// ---- Chain context read once: Pump state, quote mints, Lighthouse programs, shared write-lock fees ------------
const [globalInfo, quoteControlInfo, feeConfigInfo, usdcMintInfo, tslaxMintInfo] = await base.getMultipleAccountsInfo(
  [GLOBAL_PDA, QUOTE_CONTROL_PDA, PUMP_FEE_CONFIG_PDA, new PublicKey(USDC.mint), new PublicKey(TSLAX.mint)], "confirmed");
const global = PUMP_SDK.decodeGlobal(globalInfo!);
const programHeaders = await rpc<{ value: ({ owner: string; executable: boolean; lamports: number; data: [string, string]; space?: number } | null)[] }>("getMultipleAccounts", [[
  LIGHTHOUSE.toBase58(), "CJ5WEjifs4d77pEA9DpewppByFjHcAkNv3YYSuSoDk7c", LIGHTHOUSE_V0.toBase58(), "ANC1ZM2a4brTcY24AQMUvb5U5TkMDD9K2GqLh9QYcHqw",
], { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 45 } }]);
/** UpgradeableLoaderState: 2 = Program (programdata address), 3 = ProgramData (last deploy slot, upgrade authority). */
const programdataHeader = (entry: typeof programHeaders.value[number]) => {
  if (!entry) return null;
  const bytes = Buffer.from(entry.data[0], "base64"), kind = bytes.readUInt32LE(0);
  if (kind === 2) return { owner: entry.owner, executable: entry.executable, space: entry.space ?? null, programdata: new PublicKey(bytes.subarray(4, 36)).toBase58() };
  return { owner: entry.owner, executable: entry.executable, space: entry.space ?? null, lastDeploySlot: Number(bytes.readBigUInt64LE(4)),
    upgradeAuthority: bytes[12] ? new PublicKey(bytes.subarray(13, 45)).toBase58() : null };
};
const mintExtensions = (info: AccountInfo<Buffer> | null, mint: string) => {
  if (!info) return null;
  const program = info.owner;
  const state = unpackMint(new PublicKey(mint), info, program);
  return { program: program.toBase58(), decimals: state.decimals, mintAuthority: state.mintAuthority?.toBase58() ?? null, freezeAuthority: state.freezeAuthority?.toBase58() ?? null,
    extensions: program.equals(TOKEN_2022_PROGRAM_ID) ? getExtensionTypes(state.tlvData).map((type) => ExtensionType[type] ?? String(type)) : [] };
};
const sampleCreate = await PUMP_SDK.createV2Instruction({ mint: Keypair.generate().publicKey, user: payer, creator: payer, name: "x", symbol: "X",
  uri: `${ORIGIN}/m/${"A".repeat(43)}`, quoteMint: new PublicKey("So11111111111111111111111111111111111111112"), quoteTokenProgram: TOKEN_PROGRAM_ID, mayhemMode: false, cashback: false, holderReward: false });
const sharedWritable = sampleCreate.keys.filter((key, index) => key.isWritable && ![0, 2, 3, 5].includes(index)).map((key) => key.pubkey);
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length * p)] ?? 0; };
const feeSummary = (samples: { prioritizationFee: number }[]) => { const fees = samples.map((s) => s.prioritizationFee);
  return { slots: fees.length, nonZero: fees.filter(Boolean).length, p25: percentile(fees, 0.25), p50: percentile(fees, 0.5), p75: percentile(fees, 0.75), p90: percentile(fees, 0.9), max: Math.max(0, ...fees) }; };
const sharedLockFees = feeSummary(await base.getRecentPrioritizationFees({ lockedWritableAccounts: sharedWritable }));
save("01-chain-context.json", {
  rpc: PUBLIC_MAINNET_RPC, genesis,
  pumpGlobal: { createV2Enabled: global.createV2Enabled, mayhemModeEnabled: global.mayhemModeEnabled, whitelistedQuoteMints: global.whitelistedQuoteMints.map((k) => k.toBase58()),
    buybackFeeRecipients: global.buybackFeeRecipients.map((k) => k.toBase58()), dataLength: globalInfo!.data.length },
  quoteMints: { usdc: mintExtensions(usdcMintInfo, USDC.mint), tslax: mintExtensions(tslaxMintInfo, TSLAX.mint) },
  lighthouse: { "L2TEx (v2, Phantom's)": programdataHeader(programHeaders.value[0]), "L2TEx programdata": programdataHeader(programHeaders.value[1]),
    "L1TEV (v0.1)": programdataHeader(programHeaders.value[2]), "L1TEV programdata": programdataHeader(programHeaders.value[3]) },
  sharedWriteLocksEveryCreateTakes: sharedWritable.map((k) => k.toBase58()),
  priorityFeesOnSharedWriteLocks: sharedLockFees,
});

// ---- Decoding ------------------------------------------------------------------------------------------------
const PROGRAM_NAMES: Record<string, string> = {
  [ComputeBudgetProgram.programId.toBase58()]: "ComputeBudget", [PUMP_PROGRAM_ID.toBase58()]: "pump.fun (Pump)",
  [ATA_PROGRAM.toBase58()]: "Associated Token", [CORE_PROGRAM_ID.toBase58()]: "Metaplex Core", [LIGHTHOUSE.toBase58()]: "Lighthouse v2 (Phantom guard)",
};
const idlByDiscriminator = new Map((pumpIdl as any).instructions.map((ix: any) => [Buffer.from(ix.discriminator).toString("hex"), ix]));
const CORE_ACCOUNTS: Record<number, string[]> = { 20: ["asset", "collection", "authority", "payer", "owner", "update_authority", "system_program", "log_wrapper"], 15: ["asset", "collection", "payer", "authority", "system_program", "log_wrapper"] };
const LIGHTHOUSE_NAMES = ["MemoryWrite", "MemoryClose", "AssertAccountData", "AssertAccountDataMulti", "AssertAccountDelta", "AssertAccountInfo", "AssertAccountInfoMulti", "AssertMintAccount", "AssertMintAccountMulti", "AssertTokenAccount", "AssertTokenAccountMulti"];
function decodeData(program: string, data: Buffer) {
  if (program === ComputeBudgetProgram.programId.toBase58()) {
    if (data[0] === 2) return { op: "SetComputeUnitLimit", units: data.readUInt32LE(1) };
    if (data[0] === 3) return { op: "SetComputeUnitPrice", microLamportsPerUnit: data.readBigUInt64LE(1).toString() };
    return { op: `compute-budget ${data[0]}` };
  }
  if (program === PUMP_PROGRAM_ID.toBase58()) {
    const ix: any = idlByDiscriminator.get(data.subarray(0, 8).toString("hex"));
    if (!ix) return { op: "unknown pump instruction" };
    let offset = 8;
    const text = () => { const length = data.readUInt32LE(offset); const value = data.subarray(offset + 4, offset + 4 + length).toString("utf8"); offset += 4 + length; return value; };
    if (ix.name === "create_v2") {
      const name = text(), symbol = text(), uri = text(), creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
      return { op: "create_v2", name, symbol, uri, uriBytes: Buffer.byteLength(uri), creator, isMayhemMode: data[offset], isCashbackEnabled: data[offset + 1],
        creatorFeeBps: data.readBigUInt64LE(offset + 2).toString(), isHolderReward: data[offset + 10], dataBytes: data.length };
    }
    if (ix.name === "buy_exact_quote_in_v3") return { op: "buy_exact_quote_in_v3", spendableQuoteIn: data.readBigUInt64LE(8).toString(), minTokensOut: data.readBigUInt64LE(16).toString(), partialFill: data[24] };
    return { op: ix.name };
  }
  if (program === ATA_PROGRAM.toBase58()) return { op: data.length === 0 ? "Create" : data[0] === 1 ? "CreateIdempotent" : `ATA ${data[0]}` };
  if (program === CORE_PROGRAM_ID.toBase58()) {
    if (data[0] === 20) { const [value] = getCreateV2InstructionDataSerializer().deserialize(data); return { op: "CreateV2", ...JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)) }; }
    if (data[0] === 15) { const [value] = getUpdateV1InstructionDataSerializer().deserialize(data); return { op: "UpdateV1", ...JSON.parse(JSON.stringify(value)) }; }
    return { op: `core ${data[0]}` };
  }
  if (program === LIGHTHOUSE.toBase58()) return { op: LIGHTHOUSE_NAMES[data[0]] ?? `lighthouse ${data[0]}`, logLevel: data[1], assertions: data[2] };
  return { op: "unknown" };
}
function accountLabels(program: string, data: Buffer): string[] {
  if (program === PUMP_PROGRAM_ID.toBase58()) {
    const ix: any = idlByDiscriminator.get(data.subarray(0, 8).toString("hex"));
    const names: string[] = ix ? ix.accounts.map((a: any) => a.name) : [];
    return ix?.name === "create_v2" ? [...names, "remaining: quote_mint", "remaining: associated_quote_bonding_curve", "remaining: quote_token_program", "remaining: quote_control"] : names;
  }
  if (program === ATA_PROGRAM.toBase58()) return ["payer", "associated_token", "owner", "mint", "system_program", "token_program"];
  if (program === CORE_PROGRAM_ID.toBase58()) return CORE_ACCOUNTS[data[0]] ?? [];
  if (program === LIGHTHOUSE.toBase58()) return ["target"];
  return [];
}
function dumpTransaction(transaction: VersionedTransaction) {
  const message = transaction.message as MessageV0, keys = message.staticAccountKeys;
  // Static and lookup-resolved keys (through the pinned pump.fun table), as instruction indexes refer to them.
  const view = decodeV0Message(message.serialize()), all = view.keys.map((key) => new PublicKey(key));
  const flags = (index: number) => ({ ...keyFlags(view, index), lookup: index >= keys.length });
  const bytes = transactionBytes(message);
  const computeLimit = message.compiledInstructions.map((ix) => Buffer.from(ix.data)).find((d, i) => keys[message.compiledInstructions[i].programIdIndex].equals(ComputeBudgetProgram.programId) && d[0] === 2);
  const computePrice = message.compiledInstructions.map((ix) => Buffer.from(ix.data)).find((d, i) => keys[message.compiledInstructions[i].programIdIndex].equals(ComputeBudgetProgram.programId) && d[0] === 3);
  const units = computeLimit?.readUInt32LE(1) ?? 200_000, micro = computePrice?.readBigUInt64LE(1) ?? 0n;
  return {
    version: message.version, header: message.header, feePayer: keys[0].toBase58(),
    requiredSigners: keys.slice(0, message.header.numRequiredSignatures).map((k) => k.toBase58()),
    recentBlockhash: message.recentBlockhash, addressTableLookups: message.addressTableLookups.length,
    wireBytes: bytes, packetLimit: PACKET_LIMIT, headroomBytes: PACKET_LIMIT - bytes,
    computeUnitLimit: units, microLamportsPerUnit: micro.toString(), priorityFeeLamports: ((BigInt(units) * micro + 999_999n) / 1_000_000n).toString(),
    lookupTable: message.addressTableLookups.map((lookup) => ({ table: lookup.accountKey.toBase58(), writableIndexes: lookup.writableIndexes, readonlyIndexes: lookup.readonlyIndexes })),
    accountKeys: all.map((key, index) => ({ index, address: key.toBase58(), ...flags(index) })),
    instructions: message.compiledInstructions.map((ix, position) => {
      const program = keys[ix.programIdIndex].toBase58(), data = Buffer.from(ix.data), labels = accountLabels(program, data);
      return { position, program, programName: PROGRAM_NAMES[program] ?? "UNKNOWN", dataHex: data.toString("hex"), dataBytes: data.length,
        decoded: decodeData(program, data),
        accounts: ix.accountKeyIndexes.map((index, i) => ({ index, label: labels[i] ?? `account ${i}`, address: all[index].toBase58(), ...flags(index) })) };
    }),
  };
}

// ---- Simulation ----------------------------------------------------------------------------------------------
type SimAccount = { lamports: number; owner: string; data: [string, string] } | null;
async function simulate(label: string, transaction: VersionedTransaction, watch: PublicKey[]) {
  const addresses = watch.map((k) => k.toBase58());
  const before = await rpc<{ context: { slot: number }; value: SimAccount[] }>("getMultipleAccounts", [addresses, { encoding: "base64", commitment: "confirmed" }]);
  const result = await rpc<{ context: { slot: number }; value: any }>("simulateTransaction", [Buffer.from(transaction.serialize()).toString("base64"), {
    encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", innerInstructions: true,
    accounts: { encoding: "base64", addresses } }]);
  const value = result.value;
  // Exact SOL leaving the fee payer, from the parsed inner System instructions (independent of other activity).
  const outflows: { kind: string; to: string; lamports: number }[] = [];
  for (const group of value.innerInstructions ?? []) for (const ix of group.instructions) {
    const info = ix.parsed?.info, type = ix.parsed?.type;
    if (ix.program !== "system" || !info) continue;
    if (type === "createAccount" && info.source === payer.toBase58()) outflows.push({ kind: "createAccount (rent)", to: info.newAccount, lamports: info.lamports });
    if (type === "transfer" && info.source === payer.toBase58()) outflows.push({ kind: "transfer", to: info.destination, lamports: info.lamports });
  }
  const accounts = addresses.map((address, index) => {
    const pre = before.value[index], post: SimAccount = value.accounts?.[index] ?? null;
    const token = (entry: SimAccount) => {
      if (!entry || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(entry.owner)) return null;
      const data = Buffer.from(entry.data[0], "base64");
      if (data.length < 165) return null;
      try { const decoded = unpackAccount(new PublicKey(address), { data, owner: new PublicKey(entry.owner), lamports: entry.lamports, executable: false }, new PublicKey(entry.owner));
        return { mint: decoded.mint.toBase58(), owner: decoded.owner.toBase58(), amount: decoded.amount.toString() }; } catch { return null; }
    };
    return { address, preLamports: pre?.lamports ?? null, postLamports: post?.lamports ?? null, preOwner: pre?.owner ?? null, postOwner: post?.owner ?? null,
      postDataLength: post ? Buffer.from(post.data[0], "base64").length : null, preToken: token(pre), postToken: token(post) };
  });
  const record = { label, slot: result.context.slot, preReadSlot: before.context.slot, err: value.err, unitsConsumed: value.unitsConsumed,
    loadedAccountsDataSize: value.loadedAccountsDataSize ?? null, replacementBlockhash: value.replacementBlockhash ?? null,
    fee: value.fee ?? null, payerOutflows: outflows, payerOutflowLamports: outflows.reduce((total, o) => total + o.lamports, 0),
    accounts, logs: value.logs, innerInstructionCount: (value.innerInstructions ?? []).reduce((n: number, g: any) => n + g.instructions.length, 0) };
  return record;
}

// ---- Phantom-shaped Lighthouse guards (byte shapes copied from Phantom's real tx 4WC4bx...) ------------------
type GuardSpec = { target: PublicKey; data: Uint8Array };
/** AssertAccountInfoMulti: Lamports >= min, KnownOwner == System, DataLength == 0 (26 data bytes). */
const payerGuard = (target: PublicKey, minLamports: bigint): GuardSpec => ({ target, data: payerGuardData(minLamports) });
/** AssertTokenAccountMulti: Amount >= min, Delegate == None, DelegatedAmount <= 0, TokenAccountOwnerIsDerived (27 data bytes). */
const tokenGuard = (target: PublicKey, minAmount: bigint): GuardSpec => ({ target, data: tokenGuardData(minAmount) });
/**
 * The plan's message as Phantom returned it: the Lighthouse key inserted mid-way through the readonly keys, indexes
 * remapped, lookups kept, the guards appended after every plan instruction (tests/message-fixtures.ts).
 */
function withGuards(plan: { transactionBase64: string }, guards: GuardSpec[], newKeys: PublicKey[] = []) {
  const message = phantomGuarded(messageOf(Buffer.from(plan.transactionBase64, "base64")), guards.map((guard) => ({ target: guard.target.toBase58(), data: guard.data })), { newKeys: newKeys.map((key) => key.toBase58()) });
  const bytes = 1 + 128 + message.length, fits = bytes <= PACKET_LIMIT;
  return { message, bytes, fits, transaction: fits ? VersionedTransaction.deserialize(unsignedTransaction(message)) : null };
}
/**
 * What the shipped rule and checks say about a wallet-returned guarded message. The bytes are unsigned, so the
 * browser and server checks can only stop at the creator signature once the message passes the rule.
 */
function shippedChecks(plan: WalletTransactionPlan, guarded: VersionedTransaction) {
  const unsigned = Buffer.from(plan.transactionBase64, "base64"), returned = guarded.serialize();
  let rule: unknown, browser: string, server: string;
  try { const change = walletMessageChange(decodeV0Message(messageOf(unsigned)), decodeV0Message(messageOf(returned)), { allowBlockhashChange: true }); rule = { accepted: true, guards: change.guards }; }
  catch (error) { rule = { accepted: false, reason: error instanceof WalletMessageRefused ? error.reason : (error as Error).message }; }
  try { validateWalletFirstResult(new Uint8Array(unsigned), returned, plan.feePayer); browser = "accepted"; }
  catch (error) { browser = `${error instanceof WalletChangedTransaction ? "WalletChangedTransaction" : (error as Error).name}: ${(error as Error).message}`; }
  try { validateSignedWalletTransaction(plan, Buffer.from(returned).toString("base64")); server = "accepted"; }
  catch (error) { server = (error as Error).message; }
  let parsed: string;
  try { const wire = parseLiveTransaction(returned); parsed = `parses: ${wire.instructions.length} instructions, ${wire.keys.length} keys`; } catch (error) { parsed = (error as Error).message; }
  return { sharedRule: rule, browserValidateWalletFirstResult: browser, browserPassedRule: !browser.startsWith("WalletChangedTransaction"),
    serverValidateSignedWalletTransaction: server, serverPassedRule: !/differs from the approved message/.test(server), browserParser: parsed,
    serverDescribeWalletChange: describeWalletChange(plan, Buffer.from(returned).toString("base64")) };
}

/**
 * Worst-case compute margin: nine guards (the most reported), the payer guard plus eight token-account guards on a
 * token account the plan already has (the new coin account), so no key is added; it measures compute only.
 */
async function stressGuards(plan: { transactionBase64: string }, limit: number, baseUnits: number, tokenAccount: PublicKey | null) {
  const guards = [payerGuard(payer, 0n), ...Array.from({ length: 8 }, () => tokenAccount ? tokenGuard(tokenAccount, 0n) : payerGuard(payer, 0n))];
  const guarded = withGuards(plan, guards);
  if (!guarded.transaction) return { guardCount: 9, bytesAfter: guarded.bytes, fitsPacket: false };
  const result = await simulate("nine-guard compute stress", guarded.transaction, [payer]);
  return { guardCount: 9, bytesAfter: guarded.bytes, fitsPacket: true, unitsConsumed: result.unitsConsumed, guardUnits: result.unitsConsumed - baseUnits,
    planLimit: limit, withinPlanLimit: result.err === null && result.unitsConsumed <= limit, err: result.err, loadedAccountsDataSize: result.loadedAccountsDataSize,
    logsTail: result.logs?.slice(-6) };
}

// ---- Inputs as production builds them ------------------------------------------------------------------------
const digest = (seed: string) => createHash("sha256").update(seed).digest("hex");
const metadataUri = (seed: string) => `${ORIGIN}/m/${Buffer.from(digest(seed), "hex").toString("base64url")}`;
const throwaway = () => Keypair.generate().publicKey.toBase58();
function liveInput(label: string, quoteKey: LiveLaunchInput["quoteKey"], designKey: keyof typeof art, name: string, symbol: string, buy: string): LiveLaunchInput {
  const design = art[designKey];
  return { creator: payer.toBase58(), mint: throwaway(), nftMint: throwaway(), name, symbol, quoteKey, nftName: name,
    tokenMetadataUri: metadataUri(`${label} token`), initialBuyQuoteBaseUnits: buy, slippageBps: 100,
    renderedCardSha256: digest(`${label} card`), nftMetadataSha256: digest(`${label} nft`),
    card: { designKey, frontUri: `${ORIGIN}/api/live/assets/${design.front.sha256}.webp`, backUri: `${ORIGIN}/api/live/assets/${design.back.sha256}.webp`,
      frontSha256: design.front.sha256, backSha256: design.back.sha256, nftMetadataUri: metadataUri(`${label} nft`) } };
}
function expectedFor(input: LiveLaunchInput, plan: WalletTransactionPlan): ExpectedPlan {
  const quote = PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!;
  return { kind: plan.kind, creator: input.creator, mint: plan.kind === "token" ? input.mint : input.nftMint, tokenMint: input.mint,
    name: input.name, symbol: input.symbol, tokenMetadataUri: input.tokenMetadataUri, nftMetadataUri: input.card.nftMetadataUri,
    cardTemplate: input.card.designKey, cardImageSha256: input.renderedCardSha256!, nftMetadataSha256: input.nftMetadataSha256!,
    bindingSha256: plan.bindingSha256, quoteKey: quote.key, quoteMint: quote.mint, quoteTokenProgram: quote.tokenProgram, quoteDecimals: quote.decimals,
    initialBuyQuoteBaseUnits: plan.kind === "token" ? input.initialBuyQuoteBaseUnits ?? "0" : "0", launchInitialBuyQuoteBaseUnits: input.initialBuyQuoteBaseUnits ?? "0" };
}
function browserAccepts(input: LiveLaunchInput, plan: WalletTransactionPlan) {
  try { validateLivePlan(plan as never, expectedFor(input, plan)); return "accepted (the wallet would open)"; } catch (error) { return `refused: ${(error as Error).message}`; }
}

// ---- Coin transactions ---------------------------------------------------------------------------------------
const summary: Record<string, unknown> = {};
type CoinCase = { id: string; quoteKey: LiveLaunchInput["quoteKey"]; design: keyof typeof art; name: string; symbol: string; buy: string };
const coinCases: CoinCase[] = [
  { id: "A-sol-create-only", quoteKey: "sol", design: "pokemon-classic", name: "Card Launch Test", symbol: "CARDT", buy: "0" },
  { id: "B-sol-create-buy", quoteKey: "sol", design: "pokemon-classic", name: "Card Launch Test", symbol: "CARDT", buy: "100000000" },
  { id: "D-usdc-create-only", quoteKey: "usdc", design: "pokemon-classic", name: "Card Launch Test", symbol: "CARDT", buy: "0" },
  { id: "F-tslax-create-only", quoteKey: "tslax", design: "stock-tsla", name: "Card Launch Test", symbol: "CARDT", buy: "0" },
  // Refused before the change (over 1,232 bytes); now compiled against pump.fun's create table.
  { id: "C-sol-create-buy-max-name", quoteKey: "sol", design: "pokemon-classic", name: "A".repeat(32), symbol: "B".repeat(13), buy: "100000000" },
  { id: "E-usdc-create-buy", quoteKey: "usdc", design: "pokemon-classic", name: "Card Launch Test", symbol: "CARDT", buy: "1000000" },
  // Refused by policy: a first buy that spends a permanent-delegate stock quote.
  { id: "H-tslax-create-buy", quoteKey: "tslax", design: "stock-tsla", name: "Card Launch Test", symbol: "CARDT", buy: "1000" },
];
const coinPlans = new Map<string, { input: LiveLaunchInput; plan: WalletTransactionPlan }>();
for (const item of coinCases) {
  const input = liveInput(item.id, item.quoteKey, item.design, item.name, item.symbol, item.buy);
  let plan: WalletTransactionPlan;
  try { plan = await prepareTokenTransaction(input, { connection: connection as never }); }
  catch (error) { summary[item.id] = { prepared: false, refusal: (error as Error).message }; save(`${item.id}.json`, { input, prepared: false, refusal: (error as Error).message }); continue; }
  coinPlans.set(item.id, { input, plan });
  const transaction = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
  const dump = dumpTransaction(transaction);
  const quote = PAIR_ASSETS.find((asset) => asset.key === item.quoteKey)!;
  const coinAta = getAssociatedTokenAddressSync(new PublicKey(input.mint), payer, false, TOKEN_2022_PROGRAM_ID);
  const watch = [payer, new PublicKey(input.mint), bondingCurvePda(new PublicKey(input.mint)), coinAta,
    ...(item.quoteKey !== "sol" ? [getAssociatedTokenAddressSync(new PublicKey(quote.mint), payer, false, new PublicKey(quote.tokenProgram))] : [])];
  const simulation = await simulate(item.id, transaction, watch);
  // Phantom's observed guard set: the fee payer, plus each creator token account whose balance changes.
  const quoteAta = getAssociatedTokenAddressSync(new PublicKey(quote.mint), payer, false, new PublicKey(quote.tokenProgram));
  const guards = [payerGuard(payer, 0n), ...(BigInt(item.buy) > 0n ? [tokenGuard(coinAta, BigInt(plan.review.minimumTokensOut))] : []),
    ...(BigInt(item.buy) > 0n && item.quoteKey !== "sol" ? [tokenGuard(quoteAta, 0n)] : [])];
  const guarded = withGuards(plan, guards);
  const guardedSimulation = guarded.transaction ? await simulate(`${item.id} + Phantom-shaped guards`, guarded.transaction, [payer]) : null;
  const stress = ["B-sol-create-buy", "E-usdc-create-buy"].includes(item.id) ? await stressGuards(plan, dump.computeUnitLimit, simulation.unitsConsumed, coinAta) : null;
  const record = {
    input, plan, browserValidateLivePlan: browserAccepts(input, plan), review: plan.review, stressNineGuards: stress, instructionSummary: plan.instructionSummary,
    preparedBlockHeight: plan.preparedBlockHeight, lastValidBlockHeight: plan.lastValidBlockHeight, signingWindowBlocks: plan.lastValidBlockHeight - plan.preparedBlockHeight,
    transaction: dump, simulation,
    phantomGuards: { guardCount: guards.length, bytesAfter: guarded.bytes, addedBytes: guarded.bytes - dump.wireBytes, fitsPacket: guarded.fits,
      unitsConsumed: guardedSimulation?.unitsConsumed ?? null, guardUnits: guardedSimulation ? guardedSimulation.unitsConsumed - simulation.unitsConsumed : null,
      withinPlanLimit: guardedSimulation ? guardedSimulation.err === null && guardedSimulation.unitsConsumed <= dump.computeUnitLimit : null,
      loadedAccountsDataSize: guardedSimulation?.loadedAccountsDataSize ?? null, err: guardedSimulation?.err ?? (guarded.fits ? null : "not simulated: over the packet limit"),
      shippedChecks: guarded.transaction ? shippedChecks(plan, guarded.transaction) : "guarded message exceeds 1232 bytes; the server refuses it by size and the browser parser by size" },
  };
  save(`${item.id}.json`, record);
  summary[item.id] = { prepared: true, bytes: dump.wireBytes, headroom: dump.headroomBytes, walletTargetHeadroom: WALLET_SIZE_TARGET - dump.wireBytes,
    lookupTable: plan.review.lookupTable ?? null, cuLimit: dump.computeUnitLimit, cuUsed: simulation.unitsConsumed, cuMargin: dump.computeUnitLimit - simulation.unitsConsumed,
    microLamports: dump.microLamportsPerUnit, priorityFeeLamports: dump.priorityFeeLamports, simErr: simulation.err, loadedData: simulation.loadedAccountsDataSize,
    payerOutflowLamports: simulation.payerOutflowLamports, totalDebitReview: plan.review.totalDebitLamports, browser: record.browserValidateLivePlan,
    guarded: { count: guards.length, bytes: guarded.bytes, fits: guarded.fits, units: record.phantomGuards.unitsConsumed, withinLimit: record.phantomGuards.withinPlanLimit,
      loadedData: record.phantomGuards.loadedAccountsDataSize, err: record.phantomGuards.err,
      rule: guarded.transaction ? (shippedChecks(plan, guarded.transaction).sharedRule as { accepted: boolean }).accepted : null },
    stressNineGuards: stress ? { units: stress.unitsConsumed, withinLimit: stress.withinPlanLimit, bytes: stress.bytesAfter } : null };
}

// ---- Size preflight (production measureTokenTransaction) for the cases prepare refuses -----------------------
// One batched read serves every measure call: Pump Global, QuoteControl and each quote's buyback-recipient ATA.
const buyback = global.buybackFeeRecipients.find((key) => !key.equals(PublicKey.default))!;
const buybackAtas = PAIR_ASSETS.map((asset) => getAssociatedTokenAddressSync(new PublicKey(asset.mint), buyback, true, new PublicKey(asset.tokenProgram)));
const sizeKeys = [GLOBAL_PDA, QUOTE_CONTROL_PDA, new PublicKey(PUMP_LOOKUP_TABLE.address), ...PAIR_ASSETS.map((asset) => new PublicKey(asset.mint)), ...buybackAtas];
const sizeSnapshot = await base.getMultipleAccountsInfoAndContext(sizeKeys, "confirmed");
const cached = new Map(sizeKeys.map((key, index) => [key.toBase58(), sizeSnapshot.value[index]]));
const sizeConnection = { getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: sizeSnapshot.context, value: keys.map((key) => cached.has(key.toBase58()) ? cached.get(key.toBase58())! : null) }) };
const names = [["Card", "CARD"], ["Card Launch Test", "CARDT"], ["A".repeat(32), "B".repeat(13)]] as const;
const matrix = [];
for (const asset of PAIR_ASSETS) for (const [name, symbol] of names) {
  const size = await measureTokenTransaction({ creator: payer.toBase58(), name, symbol, quoteKey: asset.key, tokenMetadataUri: metadataUri("size") }, { connection: sizeConnection as never });
  // Phantom-shaped guards: program key 32 B + payer 30 B + coin ATA 31 B (+ quote ATA 31 B on a token quote).
  const guardBytes = 32 + 30 + 31 + (asset.key === "sol" ? 0 : 31);
  matrix.push({ quote: asset.key, tokenProgram: asset.tokenProgram.slice(0, 6), nameBytes: Buffer.byteLength(name), symbolBytes: symbol.length,
    createBytes: size.createBytes, createFits: size.createBytes <= size.limit, buyBytes: size.buyBytes, buyFits: size.buyBytes <= size.limit && !size.buyBlocked,
    buyLookupTable: size.lookupTable, buyBlocked: size.buyBlocked, buyWithGuardsBytes: size.buyBytes + guardBytes, createWithPayerGuardBytes: size.createBytes + 62 });
}
save("10-size-matrix.json", { note: "Production measureTokenTransaction, 69-byte metadata URI on launchacard.fun; buyback ATAs read once from mainnet.", buybackRecipient: buyback.toBase58(), rows: matrix });
const allowed = matrix.filter((r) => !r.buyBlocked);
summary["size-matrix"] = { quotes: PAIR_ASSETS.length, walletSizeTarget: WALLET_SIZE_TARGET,
  buyBlockedQuotes: [...new Set(matrix.filter((r) => r.buyBlocked).map((r) => r.quote))],
  buyFitsAllAllowed: allowed.every((r) => r.buyFits), buyRefusedAllowed: allowed.filter((r) => !r.buyFits).map((r) => `${r.quote}@${r.nameBytes}/${r.symbolBytes}`),
  createFitsAll: matrix.every((r) => r.createFits), buyBytesRange: [Math.min(...allowed.map((r) => r.buyBytes)), Math.max(...allowed.map((r) => r.buyBytes))],
  createBytesRange: [Math.min(...matrix.map((r) => r.createBytes)), Math.max(...matrix.map((r) => r.createBytes))],
  buyWithGuardsMaxBytes: Math.max(...allowed.map((r) => r.buyWithGuardsBytes)), buyFitsWithGuardsAll: allowed.every((r) => r.buyWithGuardsBytes <= PACKET_LIMIT) };

// ---- Card transaction: production prepareCreatorNftAheadOfCoin, the plan one approval signs with its coin ------
// The coin is never on chain here (nothing is sent), so this is also the proof that the card plan needs no coin.
const cardSource = coinPlans.get("B-sol-create-buy") ?? coinPlans.get("A-sol-create-only")!;
{
  const input = cardSource.input;
  const prepared = await prepareCreatorNftAheadOfCoin(input, { connection: connection as never });
  if (prepared.status !== "wallet-signature-required") throw new Error("The throwaway card asset already exists");
  const plan = prepared as WalletTransactionPlan, computeUnitLimit = Number(plan.review.computeUnitLimit), microLamports = plan.review.microLamportsPerComputeUnit;
  const transaction = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
  const dump = dumpTransaction(transaction);
  const simulation = await simulate("card", transaction, [payer, new PublicKey(input.nftMint)]);
  const guarded = withGuards(plan, [payerGuard(payer, 0n)]);
  const guardedSimulation = guarded.transaction ? await simulate("card + Phantom-shaped payer guard", guarded.transaction, [payer]) : null;
  const stress = await stressGuards(plan, computeUnitLimit, simulation.unitsConsumed, null);
  // One approval for both (Backpack by default; never Phantom): the coin and this card prepared together, with the
  // server's rule that the wallet must cover both debits plus the coin's reserve before the card joins the prompt.
  const coin = cardSource.plan;
  const pair = { coinMessageSha256: coin.messageSha256, cardMessageSha256: plan.messageSha256, sameBinding: coin.bindingSha256 === plan.bindingSha256,
    coinTotalDebitLamports: coin.review.totalDebitLamports, cardTotalDebitLamports: plan.review.totalDebitLamports, reserveBufferLamports: coin.review.reserveBufferLamports,
    walletBalanceLamports: coin.review.walletBalanceLamports,
    bothFit: BigInt(coin.review.walletBalanceLamports) >= BigInt(coin.review.totalDebitLamports) + BigInt(plan.review.totalDebitLamports) + BigInt(coin.review.reserveBufferLamports),
    cardSigningWindowBlocks: plan.lastValidBlockHeight - plan.preparedBlockHeight, cardSimErrWithoutCoin: simulation.err };
  const record = {
    input, plan, pair, stressNineGuards: stress, note: "Production prepareCreatorNftAheadOfCoin: Core create reads no token account, so the card prepares and simulates while its coin is not on chain.",
    browserValidateLivePlan: browserAccepts(input, plan), computeUnitLimit, microLamports,
    preparedBlockHeight: plan.preparedBlockHeight, lastValidBlockHeight: plan.lastValidBlockHeight, transaction: dump, simulation,
    phantomGuards: { guardCount: 1, bytesAfter: guarded.bytes, addedBytes: guarded.bytes - dump.wireBytes, fitsPacket: guarded.fits,
      unitsConsumed: guardedSimulation?.unitsConsumed ?? null, guardUnits: guardedSimulation ? guardedSimulation.unitsConsumed - simulation.unitsConsumed : null,
      withinPlanLimit: guardedSimulation ? guardedSimulation.err === null && guardedSimulation.unitsConsumed <= computeUnitLimit : null,
      loadedAccountsDataSize: guardedSimulation?.loadedAccountsDataSize ?? null, err: guardedSimulation?.err ?? null,
      shippedChecks: guarded.transaction ? shippedChecks(plan, guarded.transaction) : null },
  };
  save("G-card.json", record);
  summary["G-card"] = { bytes: dump.wireBytes, headroom: dump.headroomBytes, cuLimit: computeUnitLimit, cuUsed: simulation.unitsConsumed, cuMargin: computeUnitLimit - simulation.unitsConsumed, microLamports, simErr: simulation.err,
    loadedData: simulation.loadedAccountsDataSize, payerOutflowLamports: simulation.payerOutflowLamports, totalDebitReview: plan.review.totalDebitLamports, browser: record.browserValidateLivePlan,
    pair: { bothFit: pair.bothFit, sameBinding: pair.sameBinding, cardSigningWindowBlocks: pair.cardSigningWindowBlocks },
    guarded: { bytes: guarded.bytes, units: record.phantomGuards.unitsConsumed, withinLimit: record.phantomGuards.withinPlanLimit, loadedData: record.phantomGuards.loadedAccountsDataSize,
      rule: guarded.transaction ? (shippedChecks(plan, guarded.transaction).sharedRule as { accepted: boolean }).accepted : null },
    stressNineGuards: { units: stress.unitsConsumed, withinLimit: stress.withinPlanLimit, bytes: stress.bytesAfter } };
}

save("99-rpc-calls.json", { total: calls.length, byMethod: calls.reduce<Record<string, number>>((acc, c) => { acc[c.method] = (acc[c.method] ?? 0) + 1; return acc; }, {}), calls });
save("summary.json", { ranAt: new Date().toISOString(), readOnly: true, signed: false, sent: false, feePayer: payer.toBase58(), sharedLockFees, cases: summary, rpcCalls: calls.length });
console.log(JSON.stringify({ out: OUT, rpcCalls: calls.length, cases: summary }, null, 2));
