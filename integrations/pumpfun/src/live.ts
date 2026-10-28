import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import BN from "bn.js";
import {
  ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction, type AccountInfo,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getTokenMetadata, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  unpackAccount, unpackMint,
} from "@solana/spl-token";
import {
  bondingCurvePda, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID,
  PUMP_SDK, QUOTE_CONTROL_PDA, getBuyV3TokenAmountFromQuoteAmount,
  newBondingCurve,
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
  MAINNET_GENESIS_HASH, PUBLIC_MAINNET_RPC, hash, immutable,
  preparePumpLaunchPlan, publicKey, reviewLaunchInput, type PrepareLaunchInput,
} from "./index.ts";

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
  "getSignatureStatuses" | "getBlockHeight" | "getEpochInfo" | "sendRawTransaction"
>;
export type LiveOptions = { connection: LiveConnection; now?: () => Date };
export type VerifyOptions = { connection: LiveConnection; signature?: string; expectedMessageSha256?: string };

export function createMainnetConnection(rpcUrl: string): Connection {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("A server-side HTTPS mainnet RPC URL is required");
  return new Connection(rpcUrl, "confirmed");
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

async function makeWalletPlan(input: LiveLaunchInput, kind: "token" | "nft", instructions: TransactionInstruction[],
  minimumTokensOut: string, options: LiveOptions) {
  const id = identity(input), connection = options.connection;
  const [latest, payerAccount, prioritySamples] = await Promise.all([
    connection.getLatestBlockhash("confirmed"),
    connection.getAccountInfoAndContext(id.creator, "confirmed"),
    connection.getRecentPrioritizationFees({ lockedWritableAccounts: [id.creator] }),
  ]);
  const payerBefore = safeLamports(payerAccount.value?.lamports ?? 0, "Wallet balance");
  const fees = prioritySamples.map((sample) => sample.prioritizationFee).filter((fee) => Number.isSafeInteger(fee) && fee >= 0).sort((a, b) => a - b);
  const microLamports = Math.min(100_000, Math.max(1_000, fees[Math.floor(fees.length * 0.75)] ?? 1_000));
  function compile(limit: number) {
    return new VersionedTransaction(new TransactionMessage({
      payerKey: id.creator, recentBlockhash: latest.blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: limit }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports }), ...instructions],
    }).compileToV0Message());
  }
  const first = compile(1_400_000);
  let packetBytes: number;
  try { packetBytes = first.serialize().length; }
  catch (error) {
    if (/encoding overruns|overrun|transaction too large/i.test(error instanceof Error ? error.message : "")) {
      throw new Error("Launch transaction exceeds Solana's 1232-byte packet limit; use an initial buy of 0 or shorter metadata URIs");
    }
    throw error;
  }
  if (packetBytes > 1232) throw new Error(`Launch transaction is ${packetBytes} bytes and exceeds Solana's 1232-byte packet limit; use an initial buy of 0 or shorter metadata URIs`);
  const firstSimulation = await connection.simulateTransaction(first, {
    sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [input.creator] },
  });
  if (firstSimulation.value.err) throw new Error(`Transaction simulation failed: ${JSON.stringify(firstSimulation.value.err)}`);
  const consumed = firstSimulation.value.unitsConsumed;
  if (!consumed || !Number.isSafeInteger(consumed) || consumed > 1_400_000) throw new Error("RPC did not return a valid compute estimate");
  const computeUnitLimit = Math.min(1_400_000, Math.max(100_000, Math.ceil(consumed * 1.2) + 10_000));
  const transaction = compile(computeUnitLimit);
  const [simulation, fee] = await Promise.all([
    connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [input.creator] } }),
    connection.getFeeForMessage(transaction.message, "confirmed"),
  ]);
  if (simulation.value.err) throw new Error(`Final transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
  if (fee.value === null) throw new Error("RPC could not price this transaction");
  const payerAfterAccount = simulation.value.accounts?.[0];
  if (!payerAfterAccount) throw new Error("RPC did not return the simulated wallet balance");
  const payerAfter = safeLamports(payerAfterAccount.lamports, "Simulated wallet balance");
  const totalFee = safeLamports(fee.value, "Network fee");
  const priorityFee = (BigInt(computeUnitLimit) * BigInt(microLamports) + 999_999n) / 1_000_000n;
  const debit = payerBefore > payerAfter ? payerBefore - payerAfter : 0n;
  const totalDebit = debit > totalFee ? debit : totalFee;
  const nativeBuy = kind === "token" && id.asset.key === "sol" ? id.buy : 0n;
  const rentAndProgram = totalDebit > totalFee + nativeBuy ? totalDebit - totalFee - nativeBuy : 0n;
  const reserveBuffer = 50_000n;
  if (payerBefore < totalDebit + reserveBuffer) throw new Error(`Insufficient SOL: keep at least ${(totalDebit + reserveBuffer).toString()} lamports for this transaction and its buffer`);
  const requiredSigners = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map((key) => key.toBase58());
  const expectedSigner = kind === "token" ? input.mint : input.nftMint;
  if (requiredSigners.length !== 2 || !requiredSigners.includes(input.creator) || !requiredSigners.includes(expectedSigner)) throw new Error("Unexpected transaction signer set");
  return immutable({
    kind, network: "solana:mainnet" as const, status: "wallet-signature-required" as const,
    transactionBase64: Buffer.from(transaction.serialize()).toString("base64"),
    messageSha256: digest(transaction.message.serialize()),
    blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
    requiredSigners, feePayer: input.creator, bindingSha256: id.bindingSha256,
    verifiedSlot: Math.max(payerAccount.context.slot, simulation.context.slot),
    preparedAt: (options.now?.() ?? new Date()).toISOString(),
    instructionPrograms: [...new Set(transaction.message.compiledInstructions.map((ix) => transaction.message.staticAccountKeys[ix.programIdIndex].toBase58()))],
    instructionSummary: kind === "token" ? ["Create pump.fun Token-2022 coin", ...(id.buy > 0n ? ["Buy with the selected quote asset"] : [])] : ["Create separate Core NFT owned by creator", "Permanently remove metadata update authority"],
    review: {
      quoteKey: id.asset.key, quoteMint: id.asset.mint, quoteDecimals: id.asset.decimals, tokenDecimals: 6,
      initialBuyQuoteBaseUnits: kind === "token" ? id.buy.toString() : "0",
      launchInitialBuyQuoteBaseUnits: id.buy.toString(), minimumTokensOut,
      networkFeeLamports: (totalFee > priorityFee ? totalFee - priorityFee : 0n).toString(),
      priorityFeeLamports: priorityFee.toString(), rentAndProgramCostLamports: rentAndProgram.toString(),
      totalDebitLamports: totalDebit.toString(), reserveBufferLamports: reserveBuffer.toString(),
      walletBalanceLamports: payerBefore.toString(), computeUnitLimit, microLamportsPerComputeUnit: microLamports,
    },
  });
}
export type WalletTransactionPlan = Awaited<ReturnType<typeof makeWalletPlan>>;

/** Real unsigned v0 transaction. This function never signs or sends it. */
export async function prepareTokenTransaction(input: LiveLaunchInput, options: LiveOptions): Promise<WalletTransactionPlan> {
  const id = identity(input), connection = options.connection;
  const validated = await preparePumpLaunchPlan(input, { connection, now: options.now });
  const instructions = [decodeInstruction(validated.createInstruction)];
  let minimumTokensOut = "0";
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
    const curve = { ...newBondingCurve(global, id.quoteMint, quoteControl), creator: id.creator, isMayhemMode: false };
    const estimate = getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: global.tokenTotalSupply,
      bondingCurve: curve, amount: new BN(id.buy.toString()), curveBaseTokenBalance: global.tokenTotalSupply });
    if (estimate.lten(0)) throw new Error("The selected initial buy is too small to receive any token units");
    minimumTokensOut = estimate.muln(10_000 - id.slippageBps).divn(10_000).toString();
    if (minimumTokensOut === "0") throw new Error("The slippage-adjusted initial buy would receive zero token units");
    const buybackFeeRecipient = global.buybackFeeRecipients.find((key) => !key.equals(PublicKey.default));
    const firstBuy = await PUMP_SDK.buyExactQuoteInV3Instructions({
      mint: id.mint, user: id.creator, bondingCurve: curve, associatedUserAccountInfo: null,
      amount: estimate, quoteAmount: new BN(id.buy.toString()), slippage: 0,
      quoteTokenProgram: new PublicKey(id.asset.tokenProgram), tokenProgram: TOKEN_2022_PROGRAM_ID,
      buybackFeeRecipient,
    });
    // The convenience builder rounds percentages to tenths. Use its public raw
    // instruction builder for the exact integer-bps minimum shown in review.
    firstBuy[firstBuy.length - 1] = await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({
      mint: id.mint, user: id.creator, spendableQuoteIn: new BN(id.buy.toString()),
      minTokensOut: new BN(minimumTokensOut), quoteMint: id.quoteMint,
      quoteTokenProgram: new PublicKey(id.asset.tokenProgram), tokenProgram: TOKEN_2022_PROGRAM_ID,
      buybackFeeRecipient, partialFill: false,
    });
    instructions.push(...firstBuy);
  }
  // The SDK emits idempotent ATA creation even when an ATA already exists.
  // Removing only a freshly verified matching ATA saves its owner key and
  // setup bytes, allowing many custom-quote creates + first buys to stay atomic.
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
  return makeWalletPlan(input, "token", instructions.filter((ix) => !omit.has(ix)), minimumTokensOut, options);
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
  if (!transaction.meta || transaction.meta.err) throw new Error(`The finalized transaction failed: ${JSON.stringify(transaction.meta?.err)}`);
  const message = transaction.transaction.message;
  const messageSha256 = digest(message.serialize());
  if (expectedMessageSha256 && expectedMessageSha256 !== messageSha256) throw new Error("The finalized transaction message differs from the approved plan");
  const keys = message.getAccountKeys({ accountKeysFromLookups: transaction.meta.loadedAddresses });
  const instructions = message.compiledInstructions.map((ix) => ({
    programId: keys.get(ix.programIdIndex)!,
    accounts: ix.accountKeyIndexes.map((index) => keys.get(index)!), data: Buffer.from(ix.data),
  }));
  return { message, messageSha256, keys, instructions };
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
  if (state?.err) throw new Error(`Transaction failed: ${JSON.stringify(state.err)}`);
  return transaction && state?.confirmationStatus === "finalized" ? transaction : null;
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
    name: input.name, symbol: input.symbol, uri: input.tokenMetadataUri, mayhemMode: false, cashback: false,
    holderReward: false, quoteMint: id.quoteMint, quoteTokenProgram: new PublicKey(id.asset.tokenProgram) });
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
  if (!mintState.isInitialized || mintState.decimals !== 6 || !curve.creator.equals(id.creator) || !curve.quoteMint.equals(expectedStoredQuote) || curve.isMayhemMode || curve.isHolderReward) {
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

export async function recoverCreatorLaunch(input: LiveLaunchInput, options: LiveOptions & { tokenSignature?: string; nftSignature?: string; tokenMessageSha256?: string; nftMessageSha256?: string }) {
  const token = await verifyTokenLaunch(input, { connection: options.connection, signature: options.tokenSignature, expectedMessageSha256: options.tokenMessageSha256 });
  if (token.status !== "verified") return { status: "token-pending" as const, token };
  const nft = await verifyCreatorNft(input, { connection: options.connection, signature: options.nftSignature, expectedMessageSha256: options.nftMessageSha256 });
  return nft.status === "verified" ? { status: "complete" as const, token, nft } : { status: "token-created-nft-pending" as const, token, nft };
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

/** Verifies wallet+ephemeral signatures without producing any signature itself. */
export function validateSignedWalletTransaction(plan: WalletTransactionPlan, transactionBase64: string) {
  if (typeof transactionBase64 !== "string" || transactionBase64.length > 2000) throw new Error("Invalid signed transaction payload");
  const raw = Buffer.from(transactionBase64, "base64");
  if (raw.length > 1232 || raw.length === 0 || raw.toString("base64") !== transactionBase64) throw new Error("Invalid signed transaction encoding or size");
  const transaction = VersionedTransaction.deserialize(raw);
  if (transaction.version !== 0 || transaction.message.addressTableLookups.length !== 0) throw new Error("Unexpected transaction version or lookup tables");
  const message = transaction.message.serialize();
  if (digest(message) !== plan.messageSha256 || transaction.message.recentBlockhash !== plan.blockhash) throw new Error("Signed transaction differs from the approved message");
  const signers = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures).map((key) => key.toBase58());
  if (signers.length !== plan.requiredSigners.length || signers.some((key, index) => key !== plan.requiredSigners[index]) || signers[0] !== plan.feePayer) throw new Error("Signed transaction has unexpected signers or payer");
  for (let index = 0; index < signers.length; index++) {
    if (!ed25519.verify(transaction.signatures[index], message, transaction.message.staticAccountKeys[index].toBytes())) throw new Error(`Missing or invalid signature for ${signers[index]}`);
  }
  const signature = bs58.encode(transaction.signatures[0]);
  return { signature, transactionBase64, messageSha256: plan.messageSha256 };
}

/**
 * Authorized server relay only. The caller MUST persist the deterministic
 * signature and these exact signed bytes before invoking this function.
 * Transport uncertainty returns the same signature; never replace or re-sign it.
 */
export async function sendSignedWalletTransaction(input: { plan: WalletTransactionPlan; transactionBase64: string }, options: { connection: LiveConnection }) {
  const validated = validateSignedWalletTransaction(input.plan, input.transactionBase64);
  const connection = options.connection;
  await assertMainnet(connection);
  const statuses = await connection.getSignatureStatuses([validated.signature], { searchTransactionHistory: true });
  const existing = statuses.value[0];
  if (existing?.err) throw new Error(`The signed transaction already failed: ${JSON.stringify(existing.err)}`);
  if (existing) return { status: "already-submitted" as const, signature: validated.signature };
  if (await connection.getBlockHeight("confirmed") > input.plan.lastValidBlockHeight) throw new Error("The signed transaction blockhash expired; prepare a fresh transaction after recovery checks");
  const transaction = VersionedTransaction.deserialize(Buffer.from(validated.transactionBase64, "base64"));
  const simulation = await connection.simulateTransaction(transaction, { sigVerify: true, replaceRecentBlockhash: false, commitment: "confirmed", minContextSlot: input.plan.verifiedSlot });
  if (simulation.value.err) throw new Error(`Signed transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
  try {
    const signature = await connection.sendRawTransaction(Buffer.from(validated.transactionBase64, "base64"), {
      skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3, minContextSlot: input.plan.verifiedSlot,
    });
    if (signature !== validated.signature) throw new Error("RPC returned an unexpected transaction signature");
    return { status: "submitted" as const, signature };
  } catch (error) {
    return { status: "submission-uncertain" as const, signature: validated.signature,
      reason: error instanceof Error ? error.message : "RPC transport failed" };
  }
}
