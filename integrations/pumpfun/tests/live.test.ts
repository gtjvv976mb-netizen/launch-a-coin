import { describe, expect, test } from "bun:test";
import BN from "bn.js";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { AccountLayout, AccountState, AccountType, ExtensionType, MintLayout, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { pack } from "@solana/spl-token-metadata";
import { bondingCurvePda, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_PROGRAM_ID, PUMP_SDK, QUOTE_CONTROL_PDA, newBondingCurve } from "@pump-fun/pump-sdk";
import { getCreateV2InstructionDataSerializer, getUpdateV1InstructionDataSerializer, getPluginHeaderV1AccountDataSerializer, getPluginSerializer, Key, PluginType } from "@metaplex-foundation/mpl-core";
import { getAssetV1AccountDataSerializer as rawAssetSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js";
import { getPluginRegistryV1AccountDataSerializer as rawRegistrySerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/pluginRegistryV1AccountData.js";
import { publicKey as umiKey } from "@metaplex-foundation/umi";
import { MAINNET_GENESIS_HASH, PAIR_ASSETS } from "../src/index.ts";
import { RENT_EXEMPT_MINIMUM_LAMPORTS, RPC_TIMEOUT_MS, TransactionFailedOnChain, resendSignedWalletTransaction, rpcFetchWithTimeout } from "../src/live.ts";
import { CORE_PROGRAM_ID, PACKET_LIMIT, PUMP_LOOKUP_TABLE, REFRESHED_BLOCKHASH_MARGIN, WALLET_SIZE_TARGET, pinnedLookupTable, SignedTransactionNotSent, assertNftMintReplaceable, broadcastSignedWalletTransaction, checkSignedWalletTransaction, assertTokenMintReplaceable, creatorNftInstructions, describeWalletChange, measureTokenTransaction, prepareCreatorNftAheadOfCoin, prepareCreatorNftTransaction, prepareTokenTransaction, recoverCreatorLaunch, sendSignedWalletTransaction, transactionBytes, validateSignedWalletTransaction, verifyCreatorNft, verifyTokenLaunch, type LiveConnection, type LiveLaunchInput, type WalletTransactionPlan } from "../src/live.ts";
import fixture from "./fixtures/mainnet-pair-accounts-2026-10-28.json";
import feeFixture from "./fixtures/mainnet-fee-account-2026-10-28.json";
import tableFixture from "./fixtures/mainnet-pump-lookup-table-2026-10-29.json";
import art from "../src/design-assets.json";
import { signPlanWithWallet, validateLivePlan, WalletChangedTransaction, type ExpectedPlan } from "../../../app/src/components/carddex/live/transaction";
import { ALLOW_PERMANENT_DELEGATE_QUOTE_BUY } from "../src/index.ts";
import { messageOf, payerGuardData, phantomGuarded, tokenGuardData, unsignedTransaction } from "./message-fixtures.ts";
import { decodeV0Message } from "../src/wallet-guards.ts";
import { MEME_PAIR_PRESETS } from "../../../app/src/lib/carddex/design-pairings";

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
function expectedPlan(input: LiveLaunchInput, plan: WalletTransactionPlan): ExpectedPlan {
  const quote = PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!;
  return { kind: plan.kind, creator: input.creator, mint: plan.kind === "token" ? input.mint : input.nftMint,
    tokenMint: input.mint, name: input.name, symbol: input.symbol, tokenMetadataUri: input.tokenMetadataUri,
    nftMetadataUri: input.card.nftMetadataUri, cardTemplate: input.card.designKey, cardImageSha256: input.renderedCardSha256!,
    nftMetadataSha256: input.nftMetadataSha256!, bindingSha256: plan.bindingSha256, quoteKey: quote.key,
    quoteMint: quote.mint, quoteTokenProgram: quote.tokenProgram, quoteDecimals: quote.decimals,
    initialBuyQuoteBaseUnits: plan.kind === "token" ? input.initialBuyQuoteBaseUnits ?? "0" : "0",
    launchInitialBuyQuoteBaseUnits: input.initialBuyQuoteBaseUnits ?? "0" };
}

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
  accounts.set(tableFixture.address, accountFromFixture(tableFixture.value));
  accounts.set(creatorKey.publicKey.toBase58(), info(PublicKey.default, new Uint8Array(), 10_000_000_000));
  const transactions = new Map<string, any>();
  let simulationError: unknown = null, height = 1000, sent = 0, transportFails = false, blockhashValid = true;
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
    isBlockhashValid: async () => ({ context: { slot }, value: blockhashValid }),
    getEpochInfo: async () => ({ epoch: 1000, slotIndex: 100, slotsInEpoch: 432_000, absoluteSlot: slot, blockHeight: height }),
    sendRawTransaction: async (bytes: Uint8Array) => { sent++; if (transportFails) throw new Error("Transport timed out"); return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0]); },
  } as unknown as LiveConnection;
  function remember(plan: WalletTransactionPlan | { transactionBase64: string }, signature: string) {
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    // Lookup keys as the RPC reports them: resolved through the (pinned) table, writable first.
    const view = decodeV0Message(tx.message.serialize()), statics = view.staticKeys.length;
    const writable = view.lookups.reduce((total, lookup) => total + lookup.writable.length, 0);
    const loaded = (keys: string[]) => keys.map((key) => new PublicKey(key));
    transactions.set(signature, { slot, transaction: { message: tx.message, signatures: [signature] }, meta: {
      err: null, fee: 11000, preBalances: [], postBalances: [],
      loadedAddresses: { writable: loaded(view.keys.slice(statics, statics + writable)), readonly: loaded(view.keys.slice(statics + writable)) },
    } });
  }
  function addQuoteBalance(input: LiveLaunchInput, amount: bigint, ownerAddress = input.creator) {
    const quote = PAIR_ASSETS.find((asset) => asset.key === input.quoteKey)!;
    const mint = new PublicKey(quote.mint), owner = new PublicKey(ownerAddress), tokenProgram = new PublicKey(quote.tokenProgram);
    const data = Buffer.alloc(165);
    AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized,
      isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    accounts.set(getAssociatedTokenAddressSync(mint, owner, true, tokenProgram).toBase58(), info(tokenProgram, data));
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
    simulationError: (error: unknown) => simulationError = error, height: (value: number) => height = value, transportFails: () => transportFails = true,
    blockhashValid: (value: boolean) => blockhashValid = value };
}

describe("mainnet wallet preparation, independent confirmation and separate NFT recovery", () => {
  test("actual SDK plans pass the independent browser verifier for all 25 quotes and Core NFT issuance", async () => {
    for (const quote of PAIR_ASSETS) {
      const input = defaultInput(); input.quoteKey = quote.key;
      input.card = { ...input.card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 };
      const plan = await prepareTokenTransaction(input, { connection: mockRpc().connection });
      expect(validateLivePlan(plan, expectedPlan(input, plan)).signers).toEqual([input.creator, input.mint]);
    }
    const input = defaultInput(), rpc = mockRpc();
    const token = await prepareTokenTransaction(input, { connection: rpc.connection });
    rpc.remember(token, tokenSignature); await rpc.addToken(input);
    const nft = await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature });
    if (nft.status !== "wallet-signature-required") throw new Error("Expected a fresh NFT plan");
    expect(validateLivePlan(nft, expectedPlan(input, nft)).signers).toEqual([input.creator, input.nftMint]);
  });

  for (const {design: designKey, quote: quoteKey} of MEME_PAIR_PRESETS) test(`${designKey}/${quoteKey} themed preset preserves exact identity through actual SDK token and NFT plans`, async () => {
    const input = defaultInput(), design = art[designKey];
    input.quoteKey = quoteKey;
    input.card = {...input.card, designKey, frontSha256:design.front.sha256, backSha256:design.back.sha256};
    const quote=PAIR_ASSETS.find(asset=>asset.key===quoteKey)!,rpc=mockRpc();
    const token=await prepareTokenTransaction(input,{connection:rpc.connection});
    const wire=validateLivePlan(token,expectedPlan(input,token));
    const create=wire.instructions.find(instruction=>instruction.program===PUMP_PROGRAM_ID.toBase58())!;
    expect(create.accounts[16]).toBe(quote.mint);
    expect(create.accounts[18]).toBe(quote.tokenProgram);
    expect(token.review).toMatchObject({quoteKey,quoteMint:quote.mint,quoteDecimals:quote.decimals,initialBuyQuoteBaseUnits:"0"});
    expect(wire.signatures.every(signature=>signature.every(byte=>byte===0))).toBe(true);
    rpc.remember(token,tokenSignature);await rpc.addToken(input);
    const nft=await prepareCreatorNftTransaction(input,{connection:rpc.connection,tokenSignature,tokenMessageSha256:token.messageSha256});
    if(nft.status!=="wallet-signature-required")throw Error("Expected a fresh NFT plan");
    expect(validateLivePlan(nft,expectedPlan(input,nft)).signers).toEqual([input.creator,input.nftMint]);
    expect(nft.bindingSha256).toBe(token.bindingSha256);
    expect(nft.review).toMatchObject({quoteKey,quoteMint:quote.mint,quoteDecimals:quote.decimals});
    rpc.remember(nft,nftSignature);rpc.addNft(input);
    expect(await verifyCreatorNft(input,{connection:rpc.connection,signature:nftSignature,expectedMessageSha256:nft.messageSha256})).toMatchObject({status:"verified",quoteMint:quote.mint,bindingSha256:token.bindingSha256});
    expect(rpc.sent()).toBe(0);
  });

  const stockPairs = {"stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax", "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx", gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx"};
  for (const [designKey, quoteKey] of Object.entries(stockPairs)) test(`${designKey} actual SDK token and Core plans preserve the exact stock binding`, async () => {
    const input = defaultInput(), design = art[designKey as keyof typeof art];
    input.quoteKey = quoteKey;
    input.card = {...input.card, designKey, frontSha256: design.front.sha256, backSha256: design.back.sha256};
    const quote = PAIR_ASSETS.find(asset => asset.key === quoteKey)!, rpc = mockRpc();
    const token = await prepareTokenTransaction(input, {connection: rpc.connection});
    const tokenWire = validateLivePlan(token, expectedPlan(input, token));
    const create = tokenWire.instructions.find(instruction => instruction.program === PUMP_PROGRAM_ID.toBase58())!;
    expect(create.accounts[16]).toBe(quote.mint);
    expect(create.accounts[18]).toBe(quote.tokenProgram);
    expect(token.review).toMatchObject({quoteKey, quoteMint: quote.mint, quoteDecimals: quote.decimals, initialBuyQuoteBaseUnits: "0"});
    expect(tokenWire.signatures.every(signature => signature.every(byte => byte === 0))).toBe(true);
    rpc.remember(token, tokenSignature); await rpc.addToken(input);
    const nft = await prepareCreatorNftTransaction(input, {connection: rpc.connection, tokenSignature, tokenMessageSha256: token.messageSha256});
    if (nft.status !== "wallet-signature-required") throw new Error("Expected a fresh NFT plan");
    expect(validateLivePlan(nft, expectedPlan(input, nft)).signers).toEqual([input.creator, input.nftMint]);
    expect(nft.bindingSha256).toBe(token.bindingSha256);
    expect(nft.review).toMatchObject({quoteKey, quoteMint: quote.mint, quoteDecimals: quote.decimals});
    rpc.remember(nft, nftSignature); rpc.addNft(input);
    expect(await verifyCreatorNft(input, {connection: rpc.connection, signature: nftSignature, expectedMessageSha256: nft.messageSha256})).toMatchObject({status: "verified", quoteMint: quote.mint, bindingSha256: token.bindingSha256});
    expect(rpc.sent()).toBe(0);
  });

  test("token transaction is unsigned v0 against pump.fun's checked table (or none without it) with exact cost/pair review", async () => {
    const input = defaultInput(), rpc = mockRpc();
    const plan = await prepareTokenTransaction(input, { connection: rpc.connection, now });
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64"));
    // Every coin transaction loads pump.fun's own create table, as pump.fun's creates do (WW-4); the create alone too.
    expect(tx.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58())).toEqual([PUMP_LOOKUP_TABLE.address]);
    expect(plan.review.lookupTable).toBe(PUMP_LOOKUP_TABLE.address);
    // The wallet must keep Solana's rent minimum, not a smaller buffer (WW-3).
    expect(plan.review.reserveBufferLamports).toBe(RENT_EXEMPT_MINIMUM_LAMPORTS.toString());
    const bare = mockRpc(); bare.accounts.delete(PUMP_LOOKUP_TABLE.address);
    const plain = await prepareTokenTransaction(input, { connection: bare.connection, now });
    expect(VersionedTransaction.deserialize(Buffer.from(plain.transactionBase64, "base64")).message.addressTableLookups).toEqual([]);
    expect(plain.review.lookupTable).toBeNull();
    expect(plain.review.transactionBytes).toBeGreaterThan(plan.review.transactionBytes);
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(true);
    expect(plan.requiredSigners).toEqual([input.creator, input.mint]);
    expect(plan.messageSha256).toBe(createHash("sha256").update(tx.message.serialize()).digest("hex"));
    expect(plan.review.quoteKey).toBe("tslax"); expect(plan.review.quoteDecimals).toBe(8); expect(plan.review.tokenDecimals).toBe(6);
    expect(BigInt(plan.review.totalDebitLamports)).toBeGreaterThan(BigInt(plan.review.networkFeeLamports));
    expect(rpc.sent()).toBe(0);
  });

  test("a wallet short of SOL gets one plain sentence, and a table that cannot be read leaves the coin without it", async () => {
    const input = defaultInput(), rpc = mockRpc();
    for (const err of [{ InsufficientFundsForRent: { account_index: 0 } }, "InsufficientFundsForFee"]) {
      rpc.simulationError(err);
      await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow(`Insufficient SOL: add SOL to this wallet. Solana requires it to keep at least ${RENT_EXEMPT_MINIMUM_LAMPORTS} lamports`);
    }
    // Rent short on another account is not the wallet's balance: the raw failure stays.
    rpc.simulationError({ InsufficientFundsForRent: { account_index: 3 } });
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("Transaction simulation failed");
    const flaky = mockRpc();
    (flaky.connection as { getAccountInfo: unknown }).getAccountInfo = async () => { throw new Error("429 Too Many Requests"); };
    expect((await prepareTokenTransaction(input, { connection: flaky.connection })).review.lookupTable).toBeNull();
    expect(rpc.sent() + flaky.sent()).toBe(0);
  });

  test("initial buy uses exact quote units, current price and fees, minimum output and actual quote balance", async () => {
    const base = defaultInput(), card = { ...base.card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 };
    const input: LiveLaunchInput = { ...base, quoteKey: "usdc", card, initialBuyQuoteBaseUnits: "100000", slippageBps: 1 }, rpc = mockRpc();
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("wallet needs USDC");
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
    // A token-quote create + first buy is over the wallet size target without a table, so it loads pump.fun's own.
    expect(tx.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58())).toEqual([PUMP_LOOKUP_TABLE.address]);
    expect(plan.review).toMatchObject({ lookupTable: PUMP_LOOKUP_TABLE.address, walletSizeTarget: WALLET_SIZE_TARGET });
    expect(plan.review.transactionBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET);
    expect(validateLivePlan(plan, expectedPlan(input, plan)).view.lookups[0].table).toBe(PUMP_LOOKUP_TABLE.address);
    const pumpInstructions = tx.message.compiledInstructions.filter((ix) => tx.message.staticAccountKeys[ix.programIdIndex].equals(PUMP_PROGRAM_ID));
    expect(pumpInstructions).toHaveLength(2);
    expect(Buffer.from(pumpInstructions[1].data).readBigUInt64LE(8)).toBe(100_000n);
    expect(Buffer.from(pumpInstructions[1].data).readBigUInt64LE(16)).toBe(BigInt(plan.review.minimumTokensOut));
  });

  for (const quoteKey of ["pengu", "giga", "spx", "trump", "useless", "chillguy"]) test(`${quoteKey} initial buy retains exact atoms when it fits and explicitly rejects oversized metadata`, async () => {
    const preset = MEME_PAIR_PRESETS.find(preset => preset.quote === quoteKey)!;
    const input = defaultInput(), design = art[preset.design], rpc = mockRpc();
    input.quoteKey = quoteKey;
    input.card = {...input.card, designKey: preset.design, frontSha256: design.front.sha256, backSha256: design.back.sha256};
    input.initialBuyQuoteBaseUnits = "1234567";
    const quote = PAIR_ASSETS.find(asset => asset.key === quoteKey)!;
    rpc.addQuoteBalance(input, 1_234_566n);
    await expect(prepareTokenTransaction(input, {connection: rpc.connection})).rejects.toThrow(`Insufficient or frozen ${quote.symbol}`);
    rpc.addQuoteBalance(input, 1_234_567n);
    const global = PUMP_SDK.decodeGlobal(rpc.accounts.get(GLOBAL_PDA.toBase58())!);
    const recipient = global.buybackFeeRecipients.find(key => !key.equals(PublicKey.default))!;
    rpc.addQuoteBalance(input, 0n, recipient.toBase58());
    // The app's real 69-byte metadata URI: compiled against pump.fun's create table, the buy fits with wallet room.
    const plan = await prepareTokenTransaction(input, {connection: rpc.connection});
    const wire = validateLivePlan(plan, expectedPlan(input, plan));
    expect(wire.view.lookups.map(lookup => lookup.table)).toEqual([PUMP_LOOKUP_TABLE.address]);
    expect(wire.bytes.length).toBeLessThanOrEqual(WALLET_SIZE_TARGET);
    const pump = wire.instructions.filter(instruction => instruction.program === PUMP_PROGRAM_ID.toBase58());
    expect(pump).toHaveLength(2);
    expect(pump[1].accounts[2]).toBe(quote.mint);
    expect(pump[1].accounts[4]).toBe(quote.tokenProgram);
    expect(Buffer.from(pump[1].data).readBigUInt64LE(8)).toBe(1_234_567n);
    expect(plan.review).toMatchObject({quoteKey, quoteMint: quote.mint, quoteDecimals: quote.decimals, initialBuyQuoteBaseUnits: "1234567", launchInitialBuyQuoteBaseUnits: "1234567"});
    expect(Buffer.from(pump[1].data).readBigUInt64LE(16)).toBe(BigInt(plan.review.minimumTokensOut));
    expect(BigInt(plan.review.minimumTokensOut)).toBeGreaterThan(0n);
    expect(wire.signatures.every(signature => signature.every(byte => byte === 0))).toBe(true);
    // Without the table (unavailable, or not as pinned) the same buy is refused before the wallet opens, never dropped.
    rpc.accounts.delete(PUMP_LOOKUP_TABLE.address);
    await expect(prepareTokenTransaction(input, {connection: rpc.connection})).rejects.toThrow(`${WALLET_SIZE_TARGET}-byte wallet limit`);
    expect(rpc.sent()).toBe(0);
  });

  test("oversized custom-pair initial buys fail explicitly instead of dropping the buy", async () => {
    const base = defaultInput(), card = { ...base.card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 };
    // The longest name, symbol and metadata URI pump.fun accepts: over the wallet target even with the table.
    const input: LiveLaunchInput = { ...base, quoteKey: "usdc", card, name: "N".repeat(32), symbol: "S".repeat(13), tokenMetadataUri: "https://launchacard.fun/m/" + "x".repeat(174), initialBuyQuoteBaseUnits: "100000" }, rpc = mockRpc();
    rpc.addQuoteBalance(input, 1_000_000n);
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow(`${WALLET_SIZE_TARGET}-byte wallet limit (Solana's 1232-byte packet limit less 160 bytes for wallet safety checks); launch without an initial buy, or use a shorter name or symbol`);
    expect(rpc.sent()).toBe(0);
  });

  test("a tokenized-stock first buy is refused before anything is built; the stock coin alone still prepares", async () => {
    expect(ALLOW_PERMANENT_DELEGATE_QUOTE_BUY).toBe(false);
    const input = { ...defaultInput(), initialBuyQuoteBaseUnits: "100000" }, rpc = mockRpc();
    rpc.addQuoteBalance(input, 1_000_000n);
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("tokenized-stock quotes in a first buy");
    expect((await measureTokenTransaction({ ...input, quoteKey: "tslax" }, { connection: rpc.connection })).buyBlocked).toBe("issuer-controls");
    expect((await measureTokenTransaction({ ...input, quoteKey: "usdc" }, { connection: rpc.connection })).buyBlocked).toBeNull();
    expect((await prepareTokenTransaction({ ...input, initialBuyQuoteBaseUnits: "0" }, { connection: rpc.connection })).review.initialBuyQuoteBaseUnits).toBe("0");
    expect(rpc.sent()).toBe(0);
  });

  describe("initial-buy size preflight", () => {
    // Every quote works with this finish, so each case isolates the quote, name and symbol.
    const sized = (quoteKey: string, name = "Collector", symbol = "COLLECT", initialBuyQuoteBaseUnits = "100000"): LiveLaunchInput => {
      const input = defaultInput();
      return { ...input, quoteKey: quoteKey as LiveLaunchInput["quoteKey"], name, symbol, initialBuyQuoteBaseUnits,
        card: { ...input.card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 } };
    };
    const measure = (input: LiveLaunchInput, rpc = mockRpc()) => measureTokenTransaction({ creator: input.creator, name: input.name, symbol: input.symbol, tokenMetadataUri: input.tokenMetadataUri, quoteKey: input.quoteKey }, { connection: rpc.connection });
    const wire = (plan: WalletTransactionPlan) => Buffer.from(plan.transactionBase64, "base64").length;
    function seedBuybackAta(rpc: ReturnType<typeof mockRpc>, quoteKey: string) {
      const global = PUMP_SDK.decodeGlobal(rpc.accounts.get(GLOBAL_PDA.toBase58())!);
      const recipient = global.buybackFeeRecipients.find((key) => !key.equals(PublicKey.default))!;
      const quote = PAIR_ASSETS.find((asset) => asset.key === quoteKey)!;
      const data = Buffer.alloc(165);
      AccountLayout.encode({ mint: new PublicKey(quote.mint), owner: recipient, amount: 0n, delegateOption: 0, delegate: PublicKey.default,
        state: AccountState.Initialized, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
      rpc.accounts.set(getAssociatedTokenAddressSync(new PublicKey(quote.mint), recipient, true, new PublicKey(quote.tokenProgram)).toBase58(), info(new PublicKey(quote.tokenProgram), data));
    }
    test("byte count matches the serialized wire size of prepared plans", async () => {
      for (const input of [sized("sol"), sized("sol", "Collector", "COLLECT", "0"), defaultInput()]) {
        const plan = await prepareTokenTransaction(input, { connection: mockRpc().connection });
        expect(transactionBytes(VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")).message)).toBe(wire(plan));
      }
    });
    test("SOL with a short name: the buy fits, exactly as prepare builds it", async () => {
      const input = sized("sol"), size = await measure(input);
      const withBuy = await prepareTokenTransaction(input, { connection: mockRpc().connection });
      const withoutBuy = await prepareTokenTransaction({ ...input, initialBuyQuoteBaseUnits: "0" }, { connection: mockRpc().connection });
      expect(size.limit).toBe(WALLET_SIZE_TARGET); expect(size.packetLimit).toBe(PACKET_LIMIT);
      expect(size.buyBytes).toBe(wire(withBuy)); expect(size.createBytes).toBe(wire(withoutBuy));
      expect(size.buyBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET); expect(size.lookupTable).toBe(true);
    });
    const withoutTable = () => { const rpc = mockRpc(); rpc.accounts.delete(PUMP_LOOKUP_TABLE.address); return rpc; };
    test("SOL with a 32-byte name and 13-character symbol: the buy fits with pump.fun's table; without it only the coin alone does", async () => {
      const input = sized("sol", "N".repeat(32), "S".repeat(13)), size = await measure(input);
      expect(size.buyBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET);
      expect(wire(await prepareTokenTransaction(input, { connection: mockRpc().connection }))).toBe(size.buyBytes);
      const plain = await measure(input, withoutTable());
      expect(plain.buyBytes).toBeGreaterThan(WALLET_SIZE_TARGET); expect(plain.createBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET); expect(plain.lookupTable).toBe(false);
      // No name is short enough for this buy without the table, so the error only offers launching without it.
      await expect(prepareTokenTransaction(input, { connection: withoutTable().connection })).rejects.toThrow(`${plain.buyBytes} bytes and exceeds the ${WALLET_SIZE_TARGET}-byte wallet limit (Solana's 1232-byte packet limit less 160 bytes for wallet safety checks); launch without an initial buy`);
      expect(wire(await prepareTokenTransaction({ ...input, initialBuyQuoteBaseUnits: "0" }, { connection: withoutTable().connection }))).toBe(plain.createBytes);
      expect(size.createBytes).toBeLessThan(plain.createBytes);
    });
    test("USDC with a buy fits with pump.fun's table; without it, the coin alone does", async () => {
      const input = sized("usdc"), rpc = mockRpc(); rpc.addQuoteBalance(input, 1_000_000n);
      const size = await measure(input, rpc);
      expect(size.buyBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET); expect(size.createBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET);
      const bare = withoutTable(); bare.addQuoteBalance(input, 1_000_000n);
      const plain = await measure(input, bare);
      expect(plain.buyBytes).toBeGreaterThan(WALLET_SIZE_TARGET);
      const error = await prepareTokenTransaction(input, { connection: bare.connection }).then(() => null, (caught: Error) => caught.message);
      expect(error).toEndWith(`${plain.buyBytes} bytes and exceeds the ${WALLET_SIZE_TARGET}-byte wallet limit (Solana's 1232-byte packet limit less 160 bytes for wallet safety checks); launch without an initial buy`);
    });
    test("a table that is deactivated or lost a pinned entry is never used", () => {
      const account = { ...(mockRpc().accounts.get(PUMP_LOOKUP_TABLE.address)!) };
      expect(pinnedLookupTable(account)?.state.addresses[19].toBase58()).toBe("BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s");
      const deactivated = Buffer.from(account.data); deactivated.writeBigUInt64LE(5n, 4);
      expect(pinnedLookupTable({ ...account, data: deactivated })).toBeNull();
      const changed = Buffer.from(account.data); changed.fill(9, 56 + 32 * 19, 56 + 32 * 20);
      expect(pinnedLookupTable({ ...account, data: changed })).toBeNull();
      expect(pinnedLookupTable({ ...account, owner: PublicKey.default })).toBeNull();
      expect(pinnedLookupTable(null)).toBeNull();
    });
    test("an existing buyback account is left out exactly as prepare leaves it out", async () => {
      const input = sized("bonk"), rpc = mockRpc(); rpc.addQuoteBalance(input, 1_000_000n);
      const missing = await measure(input, rpc);
      seedBuybackAta(rpc, "bonk");
      const present = await measure(input, rpc);
      expect(present.buyBytes).toBeLessThan(missing.buyBytes);
      expect(present.buyBytes).toBeLessThanOrEqual(WALLET_SIZE_TARGET);
      expect(wire(await prepareTokenTransaction(input, { connection: rpc.connection }))).toBe(present.buyBytes);
      expect(present.createBytes).toBe(missing.createBytes);
      expect(rpc.sent()).toBe(0);
    });
  });

  test("the cost review takes the debit from the simulation's own inner instructions when the RPC returns them", async () => {
    const input = defaultInput(), rpc = mockRpc(), simulate = rpc.connection.simulateTransaction;
    const system = (type: string, source: string, lamports: number) => ({ program: "system", programId: PublicKey.default, parsed: { type, info: { source, lamports } } });
    rpc.connection.simulateTransaction = (async (transaction: unknown, config: any) => {
      const result: any = await simulate(transaction as never, config);
      if (config.innerInstructions) result.value.innerInstructions = [{ index: 2, instructions: [system("createAccount", input.creator, 1_500_000), system("transfer", input.creator, 3_000),
        system("transfer", "SomeoneElse1111111111111111111111111111111", 9_999), system("allocate", input.creator, 0)] }];
      return result;
    }) as never;
    // The earlier balance read is stale (the wallet was funded since): the review must not use it.
    rpc.accounts.set(input.creator, info(PublicKey.default, new Uint8Array(), 1_000));
    const plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    expect(plan.review.totalDebitLamports).toBe(String(1_503_000 + 11_000));
    expect(plan.review.walletBalanceLamports).toBe(String(9_990_000_000 + 1_503_000 + 11_000));
    expect(plan.review.rentAndProgramCostLamports).toBe("1503000");
    rpc.connection.simulateTransaction = (async (transaction: unknown, config: any) => {
      const result: any = await simulate(transaction as never, config);
      if (config.innerInstructions) result.value.innerInstructions = [{ index: 2, instructions: [system("transfer", input.creator, 1.5)] }];
      return result;
    }) as never;
    // Anything unreadable falls back to comparing the balances (here the stale read refuses the launch).
    await expect(prepareTokenTransaction(input, { connection: rpc.connection })).rejects.toThrow("Insufficient SOL");
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

  test("the card can be prepared with its coin, before the coin exists: Core reads no token account", async () => {
    const input = defaultInput(), rpc = mockRpc(), reads: string[] = [];
    const connection = new Proxy(rpc.connection, { get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === "getMultipleAccountsInfoAndContext" || prop === "getAccountInfoAndContext" || prop === "getAccountInfo") return async (keys: PublicKey | PublicKey[], ...rest: unknown[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) reads.push(key.toBase58());
        return (value as (...args: unknown[]) => unknown).call(target, keys, ...rest);
      };
      return typeof value === "function" ? value.bind(target) : value;
    } }) as LiveConnection;
    const card = await prepareCreatorNftAheadOfCoin(input, { connection });
    if (card.status !== "wallet-signature-required") throw new Error("Expected a fresh card plan");
    expect(card.kind).toBe("nft"); expect(card.requiredSigners).toEqual([input.creator, input.nftMint]);
    expect(validateLivePlan(card, expectedPlan(input, card)).signers).toEqual([input.creator, input.nftMint]);
    // Nothing about the coin is read: not its mint, its curve or any token account.
    expect(reads).not.toContain(input.mint);
    expect(reads).not.toContain(bondingCurvePda(new PublicKey(input.mint)).toBase58());
    expect(new Set(reads)).toEqual(new Set([input.nftMint, input.creator]));
    // The same card as the one prepared after the coin: the same instructions and binding.
    const token = await prepareTokenTransaction(input, { connection: rpc.connection });
    rpc.remember(token, tokenSignature); await rpc.addToken(input);
    const after = await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature });
    if (after.status !== "wallet-signature-required") throw new Error("Expected a fresh card plan");
    expect(after.messageSha256).toBe(card.messageSha256); expect(after.bindingSha256).toBe(card.bindingSha256);
    rpc.addNft(input);
    expect((await prepareCreatorNftAheadOfCoin(input, { connection: rpc.connection })).status).toBe("already-created");
    expect(rpc.sent()).toBe(0);
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
    // A refreshed blockhash is within the wallet rule, but these signatures cover the old message.
    const altered = VersionedTransaction.deserialize(Buffer.from(signed, "base64")); altered.message.recentBlockhash = PublicKey.default.toBase58();
    expect(() => validateSignedWalletTransaction(plan, Buffer.from(altered.serialize()).toString("base64"))).toThrow("invalid signature");
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
  test("pre-send checks name definite failures, recover landed signatures and never broadcast", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    expect(plan.preparedBlockHeight).toBe(1000); expect(plan.lastValidBlockHeight - plan.preparedBlockHeight).toBe(200);
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")); tx.sign([creatorKey, tokenKey]);
    const signed = { plan, transactionBase64: Buffer.from(tx.serialize()).toString("base64") }, signature = bs58.encode(tx.signatures[0]);
    const rejected = async (reason: string) => {
      const error = await checkSignedWalletTransaction(signed, { connection: rpc.connection }).catch((caught) => caught);
      expect(error).toBeInstanceOf(SignedTransactionNotSent); expect(error.reason).toBe(reason);
    };
    expect(() => validateSignedWalletTransaction(plan, plan.transactionBase64)).toThrow("invalid signature");
    await expect(checkSignedWalletTransaction({ plan, transactionBase64: plan.transactionBase64 }, { connection: rpc.connection })).rejects.toThrow("invalid signature");
    rpc.height(1201); await rejected("expired");
    rpc.height(1000); rpc.simulationError("BlockhashNotFound"); await rejected("expired");
    rpc.simulationError({ InstructionError: [2, "InsufficientFunds"] }); await rejected("simulation");
    rpc.simulationError("AlreadyProcessed");
    expect(await checkSignedWalletTransaction(signed, { connection: rpc.connection })).toMatchObject({ status: "landed", signature, err: null });
    rpc.simulationError(null);
    expect(await checkSignedWalletTransaction(signed, { connection: rpc.connection })).toEqual({ status: "ready", signature, blocksLeft: 200, lastValidBlockHeight: 1200,
      signedMessageSha256: plan.messageSha256, walletGuards: 0, blockhashChanged: false });
    expect(rpc.sent()).toBe(0);
    expect(await broadcastSignedWalletTransaction(signed, { connection: rpc.connection })).toEqual({ status: "submitted", signature });
    expect(rpc.sent()).toBe(1);
    rpc.remember(plan, signature); rpc.height(1300);
    expect((await checkSignedWalletTransaction(signed, { connection: rpc.connection })).status).toBe("landed");
    rpc.connection.getSignatureStatuses = async () => ({ context: { slot }, value: [{ slot, confirmations: null, err: { InstructionError: [2, "Custom"] }, confirmationStatus: "confirmed" }] }) as any;
    expect(await checkSignedWalletTransaction(signed, { connection: rpc.connection })).toMatchObject({ status: "landed", signature, err: { InstructionError: [2, "Custom"] } });
    await expect(sendSignedWalletTransaction(signed, { connection: rpc.connection })).rejects.toThrow("already failed");
    expect(rpc.sent()).toBe(1);
  });
});

describe("landing and recovery helpers (mock RPC only)", () => {
  // What web3.js throws when the RPC answers sendTransaction with a JSON-RPC error (here: a failed preflight).
  const rpcError = (transactionMessage: string) => Object.assign(new Error(`Simulation failed. \nMessage: ${transactionMessage}.`), { name: "SendTransactionError", transactionMessage });
  const signedFor = async (rpc: ReturnType<typeof mockRpc>) => {
    const plan = await prepareTokenTransaction(defaultInput(), { connection: rpc.connection });
    const tx = VersionedTransaction.deserialize(Buffer.from(plan.transactionBase64, "base64")); tx.sign([creatorKey, tokenKey]); // Synthetic keys, mock RPC.
    return { plan, transactionBase64: Buffer.from(tx.serialize()).toString("base64"), signature: bs58.encode(tx.signatures[0]) };
  };
  test("a transaction that landed and failed is its own error, for the signature status and for the finalized meta", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    rpc.remember(plan, tokenSignature);
    const failure = { InstructionError: [2, { Custom: 6001 }] };
    const statuses = rpc.connection.getSignatureStatuses;
    rpc.connection.getSignatureStatuses = async () => ({ context: { slot }, value: [{ slot, confirmations: null, err: failure, confirmationStatus: "finalized" }] }) as any;
    const fromStatus = await verifyTokenLaunch(input, { connection: rpc.connection, signature: tokenSignature }).catch((error) => error);
    expect(fromStatus).toBeInstanceOf(TransactionFailedOnChain); expect(fromStatus.name).toBe("TransactionFailedOnChain"); expect(fromStatus.chainError).toEqual(failure);
    rpc.connection.getSignatureStatuses = statuses;
    rpc.transactions.get(tokenSignature).meta.err = failure;
    await expect(verifyTokenLaunch(input, { connection: rpc.connection, signature: tokenSignature })).rejects.toBeInstanceOf(TransactionFailedOnChain);
  });
  test("a send the RPC answered with an error is refused (not forwarded), 'already processed' is landed, anything else is uncertain", async () => {
    const rpc = mockRpc(), signed = await signedFor(rpc);
    rpc.connection.sendRawTransaction = async () => { throw rpcError("Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1"); };
    expect(await broadcastSignedWalletTransaction(signed, { connection: rpc.connection })).toEqual({ status: "refused", signature: signed.signature, reason: "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1" });
    rpc.connection.sendRawTransaction = async () => { throw rpcError("Transaction simulation failed: This transaction has already been processed"); };
    expect(await broadcastSignedWalletTransaction(signed, { connection: rpc.connection })).toEqual({ status: "submitted", signature: signed.signature });
    rpc.connection.sendRawTransaction = async () => { throw new Error("fetch failed"); };
    expect((await broadcastSignedWalletTransaction(signed, { connection: rpc.connection })).status).toBe("submission-uncertain");
  });
  test("saved bytes are sent again only while they can land and the chain does not have them", async () => {
    const rpc = mockRpc(), signed = await signedFor(rpc), resend = (lastValidBlockHeight: number) => resendSignedWalletTransaction({ ...signed, lastValidBlockHeight }, { connection: rpc.connection });
    expect(await resend(1200)).toEqual({ status: "resent", signature: signed.signature, blocksLeft: 200 });
    expect(rpc.sent()).toBe(1);
    rpc.height(1201);
    expect(await resend(1200)).toEqual({ status: "expired", signature: signed.signature });
    // A wallet-refreshed bound beyond the plan's keeps it sendable.
    expect((await resend(1264)).status).toBe("resent");
    expect(rpc.sent()).toBe(2);
    rpc.remember(signed.plan, signed.signature);
    expect(await resend(1264)).toEqual({ status: "landed", signature: signed.signature, err: null });
    expect(rpc.sent()).toBe(2);
    rpc.transactions.clear(); rpc.height(1000);
    rpc.connection.sendRawTransaction = async () => { throw rpcError("Transaction simulation failed: Blockhash not found"); };
    expect(await resend(1200)).toEqual({ status: "not-resent", signature: signed.signature, reason: "Transaction simulation failed: Blockhash not found" });
    // Never other bytes than the plan's.
    await expect(resendSignedWalletTransaction({ plan: signed.plan, transactionBase64: signed.plan.transactionBase64, lastValidBlockHeight: 1200 }, { connection: rpc.connection })).rejects.toThrow("invalid signature");
  });
  test("every RPC request gets a timeout unless the caller set its own signal", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const wrapped = rpcFetchWithTimeout(async (_input, init) => { seen.push(init?.signal); return new Response("{}"); });
    await wrapped("https://rpc.invalid", { method: "POST" });
    const own = new AbortController().signal;
    await wrapped("https://rpc.invalid", { method: "POST", signal: own });
    expect(seen[0]).toBeInstanceOf(AbortSignal); expect(seen[0]!.aborted).toBe(false); expect(seen[1]).toBe(own);
    expect(RPC_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    const timed = rpcFetchWithTimeout(async (_input, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))), 5);
    await expect(timed("https://rpc.invalid")).rejects.toThrow();
  });
});

// A wallet that signs first: it signs only the creator slot of the bytes it is shown (synthetic key, mock RPC only).
function walletSigns(change?: (tx: VersionedTransaction) => VersionedTransaction) {
  const shown: Uint8Array[] = [];
  return { shown, sign: async (bytes: Uint8Array) => {
    shown.push(bytes.slice());
    const tx = change ? change(VersionedTransaction.deserialize(bytes)) : VersionedTransaction.deserialize(bytes);
    tx.sign([creatorKey]);
    return tx.serialize();
  } };
}
const LIGHTHOUSE = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
/** pump.fun's create table as a compile input, for a wallet that decompiles and recompiles a coin message with it. */
const pumpTables = () => [pinnedLookupTable(accountFromFixture(tableFixture.value))!];
// What a guard-adding wallet would do: append one read-only assertion instruction and refresh the blockhash.
function withGuard(tx: VersionedTransaction) {
  const decompiled = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: pumpTables() });
  decompiled.instructions.push(new TransactionInstruction({ programId: LIGHTHOUSE, keys: [], data: Buffer.from([1, 2, 3]) }));
  decompiled.recentBlockhash = new PublicKey(new Uint8Array(32).fill(45)).toBase58();
  return new VersionedTransaction(decompiled.compileToV0Message(pumpTables()));
}

describe("wallet-first signing against the server's checks", () => {
  test("a coin and card the wallet signed first and the page co-signed pass every pre-send check", async () => {
    const input = defaultInput(), rpc = mockRpc();
    const token = await prepareTokenTransaction(input, { connection: rpc.connection });
    const wallet = walletSigns();
    const signed = await signPlanWithWallet(token, expectedPlan(input, token), { address: input.mint, seed: tokenKey.secretKey.slice(0, 32) }, "wallet-first", wallet.sign);
    expect(VersionedTransaction.deserialize(wallet.shown[0]).signatures.every((signature) => signature.every((byte) => byte === 0))).toBe(true);
    const base64 = Buffer.from(signed).toString("base64");
    const validated = validateSignedWalletTransaction(token, base64);
    expect(validated.messageSha256).toBe(token.messageSha256);
    expect((await checkSignedWalletTransaction({ plan: token, transactionBase64: base64 }, { connection: rpc.connection })).status).toBe("ready");
    rpc.remember(token, tokenSignature); await rpc.addToken(input);
    const nft = await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature, tokenMessageSha256: token.messageSha256 });
    if (nft.status !== "wallet-signature-required") throw new Error("Expected a fresh NFT plan");
    const card = await signPlanWithWallet(nft, expectedPlan(input, nft), { address: input.nftMint, seed: nftKey.secretKey.slice(0, 32) }, "wallet-first", walletSigns().sign);
    expect(validateSignedWalletTransaction(nft, Buffer.from(card).toString("base64")).messageSha256).toBe(nft.messageSha256);
    expect(rpc.sent()).toBe(0);
  });
  test("a transaction signed only by the wallet is refused before any send", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    const walletOnly = Buffer.from(await walletSigns().sign(Buffer.from(plan.transactionBase64, "base64"))).toString("base64");
    expect(() => validateSignedWalletTransaction(plan, walletOnly)).toThrow(`Missing or invalid signature for ${input.mint}`);
    await expect(checkSignedWalletTransaction({ plan, transactionBase64: walletOnly }, { connection: rpc.connection })).rejects.toThrow("invalid signature");
    expect(rpc.sent()).toBe(0);
  });
  test("a wallet that adds a Lighthouse instruction outside the rule is refused, never co-signed, and its change is described for the log", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    const refused = await signPlanWithWallet(plan, expectedPlan(input, plan), { address: input.mint, seed: tokenKey.secretKey.slice(0, 32) }, "wallet-first", walletSigns(withGuard).sign).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletChangedTransaction);
    const returned = Buffer.from((refused as WalletChangedTransaction).returned).toString("base64");
    expect(VersionedTransaction.deserialize(Buffer.from(returned, "base64")).signatures[1].every((byte) => byte === 0)).toBe(true);
    expect(() => validateSignedWalletTransaction(plan, returned)).toThrow("approved message (guard)");
    const change = describeWalletChange(plan, returned);
    expect(change).toMatchObject({ parsed: true, version: 0, lookupTables: 1, blockhashChanged: true, signersChanged: false, walletSigned: true,
      planInstructionsKept: true, computeBudgetChanged: false, programsAdded: [LIGHTHOUSE.toBase58()], programsRemoved: [], limit: PACKET_LIMIT,
      rule: { accepted: false, reason: "guard" } });
    if (!change.parsed) throw new Error("Expected a readable changed transaction");
    expect(change.instructionsAfter).toBe(change.instructionsBefore + 1);
    expect(change.bytesAfter).toBeGreaterThan(change.bytesBefore);
    expect(describeWalletChange(plan, plan.transactionBase64)).toMatchObject({ parsed: true, blockhashChanged: false, programsAdded: [], planInstructionsKept: true, bytesAfter: change.bytesBefore });
    expect(describeWalletChange(plan, Buffer.from("not a transaction").toString("base64"))).toMatchObject({ parsed: false });
    expect(rpc.sent()).toBe(0);
  });
  test("each plan records its wire size and the packet limit, and the browser checks the size", async () => {
    for (const input of [defaultInput(), { ...defaultInput(), quoteKey: "sol" as const, initialBuyQuoteBaseUnits: "100000",
      card: { ...defaultInput().card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 } }]) {
      const plan = await prepareTokenTransaction(input, { connection: mockRpc().connection });
      expect(plan.review.transactionBytes).toBe(Buffer.from(plan.transactionBase64, "base64").length);
      expect(plan.review.packetLimit).toBe(PACKET_LIMIT);
      expect(plan.review.transactionBytes).toBeLessThanOrEqual(PACKET_LIMIT);
      expect(validateLivePlan(plan, expectedPlan(input, plan)).bytes.length).toBe(plan.review.transactionBytes);
      expect(() => validateLivePlan({ ...plan, review: { ...plan.review, transactionBytes: plan.review.transactionBytes - 1 } } as typeof plan, expectedPlan(input, plan))).toThrow("size differs");
    }
  });
});

// A wallet that signs first and returns its own version of the message (as Phantom does with Lighthouse): `change`
// rewrites the message bytes; the wallet signs only the creator slot of what it returns. Synthetic key, mock RPC only.
function walletReturns(change: (message: Uint8Array) => Uint8Array) {
  return async (bytes: Uint8Array) => {
    const tx = VersionedTransaction.deserialize(unsignedTransaction(change(messageOf(bytes))));
    tx.sign([creatorKey]);
    return tx.serialize();
  };
}
const coinAta = (input: LiveLaunchInput) => getAssociatedTokenAddressSync(new PublicKey(input.mint), new PublicKey(input.creator), false, TOKEN_2022_PROGRAM_ID).toBase58();
const solBuy = (): LiveLaunchInput => ({ ...defaultInput(), quoteKey: "sol", initialBuyQuoteBaseUnits: "100000",
  card: { ...defaultInput().card, designKey: "obsidian-archive", frontSha256: art["obsidian-archive"].front.sha256, backSha256: art["obsidian-archive"].back.sha256 } });

describe("Phantom's Lighthouse assertions under the shared wallet rule, end to end", () => {
  test("coin and card: the page co-signs the guarded message, the server stores its hash, and finalization expects that hash", async () => {
    const input = solBuy(), rpc = mockRpc();
    const token = await prepareTokenTransaction(input, { connection: rpc.connection });
    // Phantom's shape on a SOL create + first buy: the payer and the new coin account asserted, message recompiled.
    const guards = [{ target: input.creator, data: payerGuardData(9_000_000_000n) }, { target: coinAta(input), data: tokenGuardData(BigInt(token.review.minimumTokensOut)) }];
    const signed = await signPlanWithWallet(token, expectedPlan(input, token), { address: input.mint, seed: tokenKey.secretKey.slice(0, 32) }, "wallet-first", walletReturns((message) => phantomGuarded(message, guards)));
    const base64 = Buffer.from(signed).toString("base64"), landed = VersionedTransaction.deserialize(signed);
    expect(landed.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58())).toEqual([PUMP_LOOKUP_TABLE.address]);
    expect(signed.length).toBeLessThanOrEqual(PACKET_LIMIT);
    const validated = validateSignedWalletTransaction(token, base64);
    expect(validated).toMatchObject({ messageSha256: token.messageSha256, walletGuards: 2, blockhashChanged: false });
    expect(validated.signedMessageSha256).toBe(createHash("sha256").update(landed.message.serialize()).digest("hex"));
    expect(validated.signedMessageSha256).not.toBe(token.messageSha256);
    expect(await checkSignedWalletTransaction({ plan: token, transactionBase64: base64 }, { connection: rpc.connection })).toMatchObject({ status: "ready", lastValidBlockHeight: token.lastValidBlockHeight, signedMessageSha256: validated.signedMessageSha256, walletGuards: 2 });
    expect(describeWalletChange(token, base64)).toMatchObject({ programsAdded: [LIGHTHOUSE.toBase58()], planInstructionsKept: true, computeBudgetChanged: false,
      rule: { accepted: true, guards: [{ discriminator: 6, target: 0, dataBytes: 26 }, { discriminator: 10, dataBytes: 27 }] } });
    // The guarded transaction lands. Only the stored signed hash verifies it; the plan hash or no hash refuses it.
    rpc.remember({ transactionBase64: base64 }, validated.signature); await rpc.addToken(input);
    expect(await verifyTokenLaunch(input, { connection: rpc.connection, signature: validated.signature, expectedMessageSha256: validated.signedMessageSha256 })).toMatchObject({ status: "verified", messageSha256: validated.signedMessageSha256 });
    await expect(verifyTokenLaunch(input, { connection: rpc.connection, signature: validated.signature, expectedMessageSha256: token.messageSha256 })).rejects.toThrow("differs from the approved plan");
    await expect(verifyTokenLaunch(input, { connection: rpc.connection, signature: validated.signature })).rejects.toThrow("unexpected wallet instructions");
    // The card, prepared from the coin under its signed hash, gets the payer assertion the same way.
    const nft = await prepareCreatorNftTransaction(input, { connection: rpc.connection, tokenSignature: validated.signature, tokenMessageSha256: validated.signedMessageSha256 });
    if (nft.status !== "wallet-signature-required") throw new Error("Expected a fresh NFT plan");
    expect(nft.review.lookupTable).toBeNull();
    const card = await signPlanWithWallet(nft, expectedPlan(input, nft), { address: input.nftMint, seed: nftKey.secretKey.slice(0, 32) }, "wallet-first", walletReturns((message) => phantomGuarded(message, [guards[0]])));
    const cardBase64 = Buffer.from(card).toString("base64"), cardValidated = validateSignedWalletTransaction(nft, cardBase64);
    expect(cardValidated.walletGuards).toBe(1);
    rpc.remember({ transactionBase64: cardBase64 }, cardValidated.signature); rpc.addNft(input);
    expect(await verifyCreatorNft(input, { connection: rpc.connection, signature: cardValidated.signature, expectedMessageSha256: cardValidated.signedMessageSha256 })).toMatchObject({ status: "verified", messageSha256: cardValidated.signedMessageSha256 });
    await expect(verifyCreatorNft(input, { connection: rpc.connection, signature: cardValidated.signature })).rejects.toThrow("unexpected wallet instructions");
    expect(rpc.sent()).toBe(0);
  });

  test("assertions that write, add accounts or signers, use another program, sit among the plan, or change the compute budget are refused", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    const seed = { address: input.mint, seed: tokenKey.secretKey.slice(0, 32) };
    const global = GLOBAL_PDA.toBase58(), payer = { target: input.creator, data: payerGuardData() };
    // Real web3.js recompiles: a Lighthouse instruction whose account meta is writable or a signer moves that key's flags.
    const recompiled = (extra: TransactionInstruction) => (message: Uint8Array) => {
      const decompiled = TransactionMessage.decompile(VersionedTransaction.deserialize(unsignedTransaction(message)).message, { addressLookupTableAccounts: pumpTables() });
      decompiled.instructions.push(extra);
      return new VersionedTransaction(decompiled.compileToV0Message(pumpTables())).message.serialize();
    };
    const assertion = (keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[], data = payerGuardData()) => new TransactionInstruction({ programId: LIGHTHOUSE, keys, data: Buffer.from(data) });
    const changes: Array<[string, (message: Uint8Array) => Uint8Array]> = [
      ["writable assertion target", recompiled(assertion([{ pubkey: GLOBAL_PDA, isSigner: false, isWritable: true }]))],
      ["signer assertion target", recompiled(assertion([{ pubkey: GLOBAL_PDA, isSigner: true, isWritable: false }]))],
      ["MemoryWrite with a new memory account", recompiled(assertion([{ pubkey: creatorKey.publicKey, isSigner: true, isWritable: true }, { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }], Uint8Array.from([0, 0, 0])))],
      ["the old Lighthouse program", (message) => phantomGuarded(message, [{ ...payer, program: "L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK" }])],
      ["a non-Lighthouse program", (message) => phantomGuarded(message, [{ ...payer, program: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" }])],
      ["an assertion among the plan instructions", (message) => phantomGuarded(message, [payer], { at: 2 })],
      ["an assertion on an account the plan lacks", (message) => phantomGuarded(message, [{ target: getAssociatedTokenAddressSync(new PublicKey(PAIR_ASSETS[1].mint), creatorKey.publicKey).toBase58(), data: payerGuardData() }], { newKeys: [getAssociatedTokenAddressSync(new PublicKey(PAIR_ASSETS[1].mint), creatorKey.publicKey).toBase58()] })],
      ["an added compute-budget instruction", recompiled(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_500_000 }))],
      // Phantom's own fee insertion: the reviewed price replaced by 2,500,000 micro-lamports, plus a payer assertion.
      ["a changed priority fee", (message) => {
        const decompiled = TransactionMessage.decompile(VersionedTransaction.deserialize(unsignedTransaction(message)).message, { addressLookupTableAccounts: pumpTables() });
        decompiled.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_500_000 });
        return phantomGuarded(new VersionedTransaction(decompiled.compileToV0Message(pumpTables())).message.serialize(), [payer]);
      }],
    ];
    for (const [label, change] of changes) {
      const refused = await signPlanWithWallet(plan, expectedPlan(input, plan), seed, "wallet-first", walletReturns(change)).then(() => null, (error: unknown) => error);
      expect([label, refused instanceof WalletChangedTransaction]).toEqual([label, true]);
      const returned = Buffer.from((refused as WalletChangedTransaction).returned).toString("base64");
      // Never co-signed: even a server that received these bytes refuses them.
      expect([label, (() => { try { validateSignedWalletTransaction(plan, returned); return "accepted"; } catch (error) { return (error as Error).message; } })()]).not.toEqual([label, "accepted"]);
    }
    expect(global).toBe(GLOBAL_PDA.toBase58());
    expect(rpc.sent()).toBe(0);
  });

  test("a wallet-refreshed blockhash is relayed only while the RPC still knows it, and its expiry bound outlasts the refreshed hash", async () => {
    const input = defaultInput(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    const refreshed = new PublicKey(new Uint8Array(32).fill(46)).toBase58();
    const signed = await signPlanWithWallet(plan, expectedPlan(input, plan), { address: input.mint, seed: tokenKey.secretKey.slice(0, 32) }, "wallet-first",
      walletReturns((message) => phantomGuarded(message, [{ target: input.creator, data: payerGuardData() }], { blockhash: refreshed })));
    const base64 = Buffer.from(signed).toString("base64");
    expect(validateSignedWalletTransaction(plan, base64)).toMatchObject({ blockhashChanged: true, blockhash: refreshed, walletGuards: 1 });
    rpc.blockhashValid(false);
    const expired = await checkSignedWalletTransaction({ plan, transactionBase64: base64 }, { connection: rpc.connection }).catch((error) => error);
    expect(expired).toBeInstanceOf(SignedTransactionNotSent); expect(expired.reason).toBe("expired");
    rpc.blockhashValid(true);
    // Newest last valid height 1200 (mock) + margin: an upper bound for any blockhash that exists now.
    expect(await checkSignedWalletTransaction({ plan, transactionBase64: base64 }, { connection: rpc.connection })).toMatchObject({ status: "ready", blockhashChanged: true, lastValidBlockHeight: 1200 + REFRESHED_BLOCKHASH_MARGIN, blocksLeft: 1200 + REFRESHED_BLOCKHASH_MARGIN - 1000 });
    // A landed refreshed transaction reports the same bound, for the abandon and replace gates.
    rpc.remember({ transactionBase64: base64 }, bs58.encode(VersionedTransaction.deserialize(signed).signatures[0]));
    expect(await checkSignedWalletTransaction({ plan, transactionBase64: base64 }, { connection: rpc.connection })).toMatchObject({ status: "landed", lastValidBlockHeight: 1200 + REFRESHED_BLOCKHASH_MARGIN });
    expect(rpc.sent()).toBe(0);
  });

  test("a coin compiled against pump.fun's table must come back with the same lookups", async () => {
    const input = solBuy(), rpc = mockRpc(), plan = await prepareTokenTransaction(input, { connection: rpc.connection });
    const table = pinnedLookupTable(rpc.accounts.get(PUMP_LOOKUP_TABLE.address)!)!;
    const withoutTable = (message: Uint8Array) => {
      const decompiled = TransactionMessage.decompile(VersionedTransaction.deserialize(unsignedTransaction(message)).message, { addressLookupTableAccounts: [table] });
      return new VersionedTransaction(decompiled.compileToV0Message()).message.serialize();
    };
    const refused = await signPlanWithWallet(plan, expectedPlan(input, plan), { address: input.mint, seed: tokenKey.secretKey.slice(0, 32) }, "wallet-first", walletReturns(withoutTable)).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(WalletChangedTransaction);
    expect(() => validateSignedWalletTransaction(plan, Buffer.from((refused as WalletChangedTransaction).returned).toString("base64"))).toThrow();
    expect(rpc.sent()).toBe(0);
  });
});
