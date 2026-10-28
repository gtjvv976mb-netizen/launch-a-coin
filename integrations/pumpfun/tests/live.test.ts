import { describe, expect, test } from "bun:test";
import BN from "bn.js";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { AccountLayout, AccountState, AccountType, ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { pack } from "@solana/spl-token-metadata";
import { bondingCurvePda, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_PROGRAM_ID, PUMP_SDK, QUOTE_CONTROL_PDA, newBondingCurve } from "@pump-fun/pump-sdk";
import { getCreateV2InstructionDataSerializer, getUpdateV1InstructionDataSerializer, getPluginHeaderV1AccountDataSerializer, getPluginSerializer, Key, PluginType } from "@metaplex-foundation/mpl-core";
import { getAssetV1AccountDataSerializer as rawAssetSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js";
import { getPluginRegistryV1AccountDataSerializer as rawRegistrySerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js";
import { publicKey as umiKey } from "@metaplex-foundation/umi";
import { MAINNET_GENESIS_HASH, PAIR_ASSETS } from "../src/index.ts";
import { CORE_PROGRAM_ID, assertNftMintReplaceable, assertTokenMintReplaceable, creatorNftInstructions, prepareCreatorNftTransaction, prepareTokenTransaction, recoverCreatorLaunch, sendSignedWalletTransaction, validateSignedWalletTransaction, verifyCreatorNft, verifyTokenLaunch, type LiveConnection, type LiveLaunchInput, type WalletTransactionPlan } from "../src/live.ts";
import fixture from "./fixtures/mainnet-pair-accounts-2026-10-28.json";
import feeFixture from "./fixtures/mainnet-fee-account-2026-10-28.json";
import art from "../src/design-assets.json";
import { validateLivePlan, type ExpectedPlan } from "../../../app/src/components/carddex/live/transaction";

// Synthetic keys and blockhash are confined to this offline RPC mock. No test
// connection has a network transport; signed fixtures can never be submitted.
const creatorKey = Keypair.fromSeed(new Uint8Array(32).fill(111));
const tokenKey = Keypair.fromSeed(new Uint8Array(32).fill(112));
const nftKey = Keypair.fromSeed(new Uint8Array(32).fill(113));
const now = () => new Date("2026-10-28T15:00:00Z");
const tokenSignature = bs58.encode(new Uint8Array(64).fill(71));
const nftSignature = bs58.encode(new Uint8Array(64).fill(72));
const slot = fixture.context.slot + 10;
const defaultInput = (): LiveLaunchInput => ({
  creator: creatorKey.publicKey.toBase58(), mint: tokenKey.publicKey.toBase58(), nftMint: nftKey.publicKey.toBase58(),
    name: "Collector", symbol: "COLLECT", tokenMetadataUri: "https://launchacard.fun/m/" + "x".repeat(43), quoteKey: "tslax",
  card: { designKey: "stock-tsla", frontUri: "https://launchacard.fun/assets/front.webp", backUri: "https://launchacard.fun/assets/back.webp",
    frontSha256: art["stock-tsla"].front.sha256, backSha256: art["stock-tsla"].back.sha256,
    nftMetadataUri: "https://launchacard.fun/m/" + "2".repeat(64) },
  renderedCardSha256: "3".repeat(64), nftMetadataSha256: "4".repeat(64), initialBuyQuoteBaseUnits: "0", slippageBps: 100,
});

function accountFromFixture(value: any): AccountInfo<Buffer> {
  return { executable: value.executable, owner: new PublicKey(value.owner), lamports: value.lamports,
    data: Buffer.from(value.data[0], "base64"), rentEpoch: value.rentEpoch };
}
function info(owner: PublicKey, data: Uint8Array, amount = 5_000_000): AccountInfo<Buffer> {
  return { owner, data: Buffer.from(data), lamports: amount, executable: false, rentEpoch: 0 };
}
function mockRpc() {
  const accounts = new Map<string, AccountInfo<Buffer>>(Object.entries(fixture.accounts).map(([key, value]) => [key, accountFromFixture(value)]));
  accounts.set(feeFixture.address, accountFromFixture(feeFixture.value[0]));
  accounts.set(creatorKey.publicKey.toBase58(), info(PublicKey.default, new Uint8Array(), 10_000_000_000));
  const transactions = new Map<string, any>();
  let simulationError: unknown = null, height = 1000, sent = 0, transportFails = false;
  const connection = {
    getGenesisHash: async () => MAINNET_GENESIS_HASH,
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot }, value: keys.map((key) => accounts.get(key.toBase58()) ?? null) }),
    getAccountInfoAndContext: async (key: PublicKey) => ({ context: { slot }, value: accounts.get(key.toBase58()) ?? null }),
    getAccountInfo: async (key: PublicKey) => accounts.get(key.toBase58()) ?? null,
    getLatestBlockhash: async () => ({ blockhash: new PublicKey(new Uint8Array(32).fill(44)).toBase58(), lastValidBlockHeight: 1200 }),
    getRecentPrioritizationFees: async () => [{ slot, prioritizationFee: 2000 }],
    getFeeForMessage: async () => ({ context: { slot }, value: 11_000 }),
    simulateTransaction: async (_transaction: unknown, config: any) => ({ context: { slot }, value: { err: simulationError, logs: [], unitsConsumed: 300_000,
      accounts: config.accounts ? [{ lamports: 9_990_000_000, owner: PublicKey.default.toBase58(), data: ["", "base64"], executable: false, rentEpoch: 0 }] : undefined } }),
    getTransaction: async (signature: string) => transactions.get(signature) ?? null,
    getSignatureStatuses: async (signatures: string[]) => ({ context: { slot }, value: signatures.map((signature) => transactions.has(signature) ? { err: null, confirmations: null, confirmationStatus: "finalized", slot } : null) }),
    getBlockHeight: async () => height,
    getEpochInfo: async () => ({ epoch: 1000, slotIndex: 100, slotsInEpoch: 432_000, absoluteSlot: slot, blockHeight: height }),
    sendRawTransaction: async (bytes: Uint8Array) => { sent++; if (transportFails) throw new Error("Transport timed out"); return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]); },
  } as unknown as LiveConnection;
  function remember(plan: WalletTransactionPlan, signature: string) {
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    transactions.set(signature, { slot, transaction: { message: tx.message, signatures: [signature] }, meta: {
      err: null, fee: 11000, preBalances: [], postBalances: [], loadedAddresses: { readonly: [], writable: [] },
    } });
  }
  function addQuoteBalance(input: LiveLaunchInput, amount: bigint) {
    const quote = PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!;
    const mint = new PublicKey(quote.mint), owner = new PublicKey(input.creator), tokenProgram = new PublicKey(quote.tokenProgram);
    const data = Buffer.alloc(165);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized,
      isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    accounts.set(getAssociatedTokenAddressSync(mint, owner, false, tokenProgram).toBase58(), info(tokenProgram, data));
  }
  async function addToken(input: LiveLaunchInput) {
    const mint = new PublicKey(input.mint);
    const metadata = pack({ mint, name: input.name, symbol: input.symbol, uri: input.tokenMetadataUri, additionalMetadata: [] });
    const data = Buffer.alloc(170 + metadata.length);
    MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1_000_000_000_000_000n, decimals: 6,
      isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data.subarray(0, 82));
    data[165] = AccountType.Mint; data.writeUInt16LE(ExtensionType.TokenMetadata, 166); data.writeUInt16LE(metadata.length, 168); data.set(metadata, 170);
    accounts.set(input.mint, info(TOKEN_2022_PROGRAM_ID, data));
    const global = PUMP_SDK.decodeGlobal(accounts.get(GLOBAL_PDA.toBase58())!);
    const quoteControl = PUMP_SDK.decodeQuoteControl(accounts.get(QUOTE_CONTROL_PDA.toBase58())!);
    const quote = new PublicKey(PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!.mint);
    const curve = { ...newBondingCurve(global, quote, quoteControl), creator: new PublicKey(input.creator), isMayhemMode: false };
    const curveData = await (PUMP_SDK as any).offlinePumpProgram.coder.accounts.encode("bondingCurve", curve);
    accounts.set(bondingCurvePda(mint).toBase58(), info(PUMP_PROGRAM_ID, curveData));
  }
  function addNft(input: LiveLaunchInput, mutate?: (attributes: { key: string; value: string }[]) => void) {
    const instructions = creatorNftInstructions(input);
    const [args] = getCreateV2InstructionDataSerializer().deserialize(instructions[0].data);
    if (args.plugins.__option !== "Some") throw new Error("Missing plugin");
    const attributePlugin = args.plugins.value[0].plugin;
    if (attributePlugin.__kind !== "Attributes") throw new Error("Missing Attributes");
    const attributes = attributePlugin.fields[0].attributeList; mutate?.(attributes);
    const asset = rawAssetSerializer().serialize({ key: Key.AssetV1, owner: umiKey(input.creator), updateAuthority: { __kind: "None" },
      name: args.name, uri: args.uri, seq: null });
    const plugin = getPluginSerializer().serialize({ __kind: "Attributes", fields: [{ attributeList: attributes }] });
    const header = getPluginHeaderV1AccountDataSerializer().serialize({ key: Key.PluginHeaderV1, pluginRegistryOffset: asset.length + 9 + plugin.length });
    const registry = rawRegistrySerializer().serialize({ key: Key.PluginRegistryV1, registry: [{ pluginType: PluginType.Attributes,
      authority: { __kind: "None" }, offset: asset.length + 9 }], externalRegistry: [] });
    accounts.set(input.nftMint, info(CORE_PROGRAM_ID, Buffer.concat([asset, header, plugin, registry])));
  }
  return { connection, accounts, transactions, remember, addToken, addNft, addQuoteBalance, sent: () => sent,
    simulationError: (error: unknown) => simulationError = error, height: (value: number) => height = value, transportFails: () => transportFails = true };
}

describe("mainnet wallet preparation, independent confirmation and separate NFT recovery", () => {
  test("actual SDK plans pass the independent browser verifier for all16quotes and Core NFT issuance", async () => {
    function expected(input: LiveLaunchInput, plan: WalletTransactionPlan): ExpectedPlan {
      const quote = PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!;
      return { kind: plan.kind, creator: input.creator, mint: plan.kind === "token" ? input.mint : input.nftMint,
        tokenMint: input.mint, name: input.name, symbol: input.symbol, tokenMetadataUri: input.tokenMetadataUri,
        nftMetadataUri: input.card.nftMetadataUri, cardTemplate: input.card.designKey, cardImageSha256: input.renderedCardSha256!,
        nftMetadataSha256: input.nftMetadataSha256!, bindingSha256: plan.bindingSha256, quoteKey: quote.key,
        quoteMint: quote.mint, quoteTokenProgram: quote.tokenProgram, quoteDecimals: quote.decimals,
        initialBuyQuoteBaseUnits: plan.kind === "token" ? input.initialBuyQuoteBaseUnits ?? "0" : "0",
        launchInitialBuyQuoteBaseUnits: input.initialBuyQuoteBaseUnits ?? "0" };
    }
    for (const quote of PAIR_ASSETS) {
      const input = defaultInput(); input.quoteKey = quote.key;
      input.card = { ...input.card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 };
      const plan = await prepareTokenTransaction(input, { connection: mockRpc().connection });
      expect(validateLivePlan(plan, expected(input, plan)).signers).toEqual([input.creator, input.mint]);
    }
    const input = defaultInput(), rpc = mockRpc();
    const token = await prepareTokenTransaction(input, { connection: rpc.connection });
    rpc.remember(token, tokenSignature); await rpc.addToken(input);
    const nft = await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature });
    if (nft.status !== "wallet-signature-required") throw new Error("Expected a fresh NFT plan");
    expect(validateLivePlan(nft, expected(input, nft)).signers).toEqual([input.creator, input.nftMint]);
  });

  test("token transaction is unsigned v0 with no lookup tables and exact cost/pair review", async () => {
    const input = defaultInput(), rpc = mockRpc();
    const plan = await prepareTokenTransaction(input, { connection: rpc.connection, now });
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    expect(tx.message.addressTableLookups).toEqual([]);
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(plan.requiredSigners).toEqual([input.creator, input.mint]);
    expect(plan.messageSha256).toBe(createHash("sha256").update(tx.message.serialize()).digest("hex"));
    expect(plan.review.quoteKey).toBe("tslax"); expect(plan.review.quoteDecimals).toBe(8); expect(plan.review.tokenDecimals).toBe(6);
    expect(BigInt(plan.review.totalDebitLamports)).toBeGreaterThan(BigInt(plan.review.networkFeeLamports));
    expect(rpc.sent()).toBe(0);
  });

  test("initial buy uses exact quote units, current price and fees, minimum output and actual quote balance", async () => {
    const input = { ...defaultInput(), initialBuyQuoteBaseUnits: "100000", slippageBps: 1 }, rpc = mockRpc();
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("wallet needs TSLAX");
    rpc.addQuoteBalance(input, 99_999n);
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("Insufficient or frozen");
    rpc.addQuoteBalance(input, 1_000_000n);
    const global = PUMP_SDK.decodeGlobal(rpc.accounts.get(GLOBAL_PDA.toBase58())!);
    const recipient = global.buybackFeeRecipients.find((key) => !key.equals(PublicKey.default))!;
    const quote = PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!;
    const ata = getAssociatedTokenAddressSync(new PublicKey(quote.mint), recipient, true, new PublicKey(quote.tokenProgram));
    const data = Buffer.alloc(165);
    AccountLayout.encode({ mint: new PublicKey(quote.mint), owner: recipient, amount: 0n, delegateOption: 0, delegate: PublicKey.default,
      state: AccountState.Initialized, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    rpc.accounts.set(ata.toBase58(), info(new PublicKey(quote.tokenProgram), data));
    const plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    expect(plan.review.initialBuyQuoteBaseUnits).toBe("100000");
    expect(BigInt(plan.review.minimumTokensOut)).toBeGreaterThan(0n);
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    const pumpInstructions = tx.message.compiledInstructions.filter((ix) => tx.message.staticAccountKeys[ix.programIdIndex].equals(PUMP_PROGRAM_ID));
    expect(pumpInstructions).toHaveLength(2);
    expect(Buffer.from(pumpInstructions[1].data).readBigUInt64LE(8)).toBe(100_000n);
    expect(Buffer.from(pumpInstructions[1].data).readBigUInt64LE(16)).toBe(BigInt(plan.review.minimumTokensOut));
  });

  test("oversized custom-pair initial buys fail explicitly instead of dropping the buy", async () => {
    const input = { ...defaultInput(), tokenMetadataUri: "https://launchacard.fun/m/" + "x".repeat(160), initialBuyQuoteBaseUnits: "100000" }, rpc = mockRpc();
    rpc.addQuoteBalance(input, 1_000_000n);
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("1232-byte packet limit");
    expect(rpc.sent()).toBe(0);
  });

  test("simulation failure prevents offering a transaction to the wallet", async () => {
    const rpc = mockRpc(); rpc.simulationError({ InstructionError: [2, "InsufficientFunds"] });
    await expect(prepareTokenTransaction(defaultInput(), { connection: rpc.connection })).rejects.toThrow("simulation failed");
    expect(rpc.sent()).toBe(0);
  });

  test("NFT instructions have no Royalties, immutable binding attributes and update authority None", () => {
    const input = defaultInput(), instructions = creatorNftInstructions(input);
    expect(instructions).toHaveLength(2);
    const [create] = getCreateV2InstructionDataSerializer().deserialize(instructions[0].data);
    const [update] = getUpdateV1InstructionDataSerializer().deserialize(instructions[1].data);
    expect(create.plugins.__option).toBe("Some");
    if (create.plugins.__option === "Some") {
      expect(create.plugins.value).toHaveLength(1); expect(create.plugins.value[0].plugin.__kind).toBe("Attributes");
      expect(create.plugins.value[0].authority).toEqual({ __option: "Some", value: { __kind: "None" } });
    }
    expect(update.newUpdateAuthority).toEqual({ __option: "Some", value: { __kind: "None" } });
    expect(instructions.every((ix) => ix.programId.equals(CORE_PROGRAM_ID))).toBe(true);
  });

  test("NFT stage waits for final token verification and permits token-created/NFT-pending recovery", async () => {
    const input = defaultInput(), rpc = mockRpc();
    expect((await recoverCreatorLaunch(input, { connection: rpc.connection })).status).toBe("token-pending");
    await expect(prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature })).rejects.toThrow("finalized pump.fun");
    const tokenPlan = await prepareTokenTransaction(input, { connection: rpc.connection });
    rpc.remember(tokenPlan, tokenSignature); await rpc.addToken(input);
    expect((await verifyTokenLaunch(input, { connection: rpc.connection, signature: tokenSignature, expectedMessageSha256: tokenPlan.messageSha256 })).status).toBe("verified");
    expect((await recoverCreatorLaunch(input, { connection: rpc.connection, tokenSignature })).status).toBe("token-created-nft-pending");
    const nftPlan = await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature });
    expect(nftPlan.status).toBe("wallet-signature-required");
    if (nftPlan.status === "wallet-signature-required") {
      expect(nftPlan.requiredSigners).toEqual([input.creator, input.nftMint]);
      expect(nftPlan.review.initialBuyQuoteBaseUnits).toBe("0");
      expect(nftPlan.bindingSha256).toBe(tokenPlan.bindingSha256);
      rpc.remember(nftPlan, nftSignature);
    }
    rpc.addNft(input);
    expect((await recoverCreatorLaunch(input, { connection: rpc.connection, tokenSignature, nftSignature })).status).toBe("complete");
    expect((await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature })).status).toBe("already-created");
    expect(rpc.sent()).toBe(0);
  });

  test("rejects altered confirmed token metadata/quote/message and detects account-only NFT recovery", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: mockRpc().connection });
    rpc.remember(plan, tokenSignature); await rpc.addToken(input);
    await expect(verifyTokenLaunch({ ...input, tokenMetadataUri: "https://launchacard.fun/changed" }, { connection: rpc.connection, signature: tokenSignature })).rejects.toThrow("exact creator/token/quote/metadata");
    await expect(verifyTokenLaunch(input, { connection: rpc.connection, signature: tokenSignature, expectedMessageSha256: "a".repeat(64) })).rejects.toThrow("differs from the approved plan");
    rpc.addNft(input);
    const recovered = await verifyCreatorNft(input, { connection: rpc.connection });
    expect(recovered.status).toBe("verified"); if (recovered.status === "verified") expect(recovered.recoveredFromAccount).toBe(true);
    rpc.addNft(input, (attributes) => attributes.find((entry) => entry.key === "quote_mint")!.value = PAIR_ASSETS.find((asset) => asset.key === "gmex")!.mint);
    await expect(verifyCreatorNft(input, { connection: rpc.connection })).rejects.toThrow("immutable token/design/quote binding");
  });

  test("replacement keys require finalized expiry and absent previous mint accounts", async () => {
    const input = defaultInput(), rpc = mockRpc();
    await expect(assertNftMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("can still land");
    await expect(assertTokenMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("can still land");
    rpc.height(1201);
    expect((await assertNftMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).replaceable).toBe(true);
    expect((await assertTokenMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).replaceable).toBe(true);
    await rpc.addToken(input); rpc.addNft(input);
    await expect(assertNftMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("already exists");
    await expect(assertTokenMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("already exists");
  });

  test("replacement absence is checked at or after the same finalized bank that proves expiry", async () => {
    const input = defaultInput(), rpc = mockRpc(); rpc.height(1201);
    const reads: unknown[] = [];
    rpc.connection.getEpochInfo = async (commitment) => {
      reads.push(commitment);
      return { epoch: 1000, slotIndex: 100, slotsInEpoch: 432_000, absoluteSlot: slot, blockHeight: 1201 };
    };
    // Model a lagging account backend returning a pre-creation absence while
    // another backend has already observed the finalized block-height expiry.
    rpc.connection.getAccountInfoAndContext = async (_mint, config) => {
      reads.push(config);
      return { context: { slot: slot - 1 }, value: null };
    };
    for (const check of [assertNftMintReplaceable, assertTokenMintReplaceable]) {
      await expect(check(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("predates the finalized expiry check");
    }
    expect(reads).toEqual(["finalized", { commitment: "finalized", minContextSlot: slot }, "finalized", { commitment: "finalized", minContextSlot: slot }]);
    rpc.connection.getAccountInfoAndContext = async (_mint, config) => {
      expect(config).toEqual({ commitment: "finalized", minContextSlot: slot });
      return { context: { slot }, value: info(CORE_PROGRAM_ID, new Uint8Array()) };
    };
    await expect(assertNftMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("already exists");
    rpc.connection.getEpochInfo = async () => ({ epoch: 1000, slotIndex: 100, slotsInEpoch: 432_000, absoluteSlot: slot });
    await expect(assertNftMintReplaceable(input, { connection: rpc.connection, lastValidBlockHeight: 1200 })).rejects.toThrow("valid finalized expiry context");
  });

  test("an expired unissued NFT can change signer address without changing its immutable binding", async () => {
    const input = defaultInput(), rotated = { ...input, nftMint: Keypair.fromSeed(new Uint8Array(32).fill(114)).publicKey.toBase58() };
    const original = getCreateV2InstructionDataSerializer().deserialize(creatorNftInstructions(input)[0].data)[0];
    const replacement = getCreateV2InstructionDataSerializer().deserialize(creatorNftInstructions(rotated)[0].data)[0];
    expect(original).toEqual(replacement);
    expect(creatorNftInstructions(input)[0].keys[0].pubkey.equals(creatorNftInstructions(rotated)[0].keys[0].pubkey)).toBe(false);
  });

  test("signed relay rejects missing/changed signatures, persists deterministic signature and retries exact bytes", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    expect(() => validateSignedWalletTransaction(plan, plan.transactionBase64)).toThrow("invalid signature");
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    tx.sign([creatorKey, tokenKey]); // Synthetic fixture only; fake blockhash and mock-only RPC.
    const signed = Buffer.from(tx.serialize()).toString("base64");
    const validated = validateSignedWalletTransaction(plan, signed);
    expect(validated.signature).toBe(bs58.encode(tx.signatures[0]));
    const altered = VersionedTransaction.deserialize(Buffer.from(signed, "base64")); altered.message.recentBlockhash = PublicKey.default.toBase58();
    expect(() => validateSignedWalletTransaction(plan, Buffer.from(altered.serialize()).toString("base64"))).toThrow("approved message");
    rpc.transportFails();
    const uncertain = await sendSignedWalletTransaction({ plan, transactionBase64: signed }, { connection: rpc.connection });
    expect(uncertain.status).toBe("submission-uncertain"); expect(uncertain.signature).toBe(validated.signature);
    rpc.remember(plan, validated.signature);
    expect((await sendSignedWalletTransaction({ plan, transactionBase64: signed }, { connection: rpc.connection })).status).toBe("already-submitted");
    expect(rpc.sent()).toBe(1);
  });

  test("signed relay refuses expired blockhashes and failed preflight before any send", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")); tx.sign([creatorKey, tokenKey]);
    const signed = Buffer.from(tx.serialize()).toString("base64");
    rpc.height(1201);
    await expect(sendSignedWalletTransaction({ plan, transactionBase64: signed }, { connection: rpc.connection })).rejects.toThrow("blockhash expired");
    rpc.height(1000); rpc.simulationError({ InstructionError: [2, "InsufficientFunds"] });
    await expect(sendSignedWalletTransaction({ plan, transactionBase64: signed }, { connection: rpc.connection })).rejects.toThrow("Signed transaction simulation failed");
    expect(rpc.sent()).toBe(0);
  });
});
