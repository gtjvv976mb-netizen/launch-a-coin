import { createHash } from "node:crypto";
import {
  GLOBAL_PDA, OnlinePumpSdk, PUMP_PROGRAM_ID, PUMP_SDK, QUOTE_CONTROL_PDA,
} from "@pump-fun/pump-sdk";
import {
  Connection, PublicKey, type AccountInfo, type Commitment,
  type GetMultipleAccountsConfig, type RpcResponseAndContext,
} from "@solana/web3.js";
import {
  AccountState, getDefaultAccountState, getPausableConfig, getPermanentDelegate, getTransferFeeConfig, getTransferHook, unpackMint,
  type Mint,
} from "@solana/spl-token";
import verifiedCatalog from "../../../reports/pump-pair-assets-2026-10-28.json";
import { isCardDesignKey } from "../../../app/src/lib/carddex/designs";
import { resolveLaunchQuote } from "../../../app/src/lib/carddex/pairs";
import { archivedDesignForHashes } from "../../../app/src/lib/carddex/design-versions";
import designAssets from "./design-assets.json";
import BN from "bn.js";
import { CREATOR_FEE_RATE_PAIR, createOptionsProblem, readCreateOptions, type CreateOptions, type CreateOptionsGlobal } from "./create-options.ts";

export type { CreateOptions, CreateOptionsGlobal };

export const SDK_VERSION = "4.1.0";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
export const PAIR_ASSETS = Object.freeze(verifiedCatalog.assets.map((asset) => Object.freeze(asset)));
export type PairKey = typeof PAIR_ASSETS[number]["key"];

/** Deliberately exposes only read operations; no wallet, signing or send methods. */
export interface PairReadConnection {
  getGenesisHash(): Promise<string>;
  getMultipleAccountsInfoAndContext(
    keys: PublicKey[], config?: Commitment | GetMultipleAccountsConfig,
  ): Promise<RpcResponseAndContext<(AccountInfo<Buffer> | null)[]>>;
}

export interface PrepareLaunchInput {
  creator: string;
  mint: string;
  name: string;
  symbol: string;
  tokenMetadataUri: string;
  quoteKey: PairKey;
  card: {
    designKey: string;
    frontUri: string;
    backUri: string;
    frontSha256: string;
    backSha256: string;
    nftMetadataUri: string;
  };
  /**
   * pump.fun holder rewards (create-options.ts): creator fees go to eligible holders, permanently. Absent (or false) for
   * a regular coin, exactly as every launch saved before this option.
   */
  holderReward?: boolean;
  /** A custom creator fee rate in basis points, custom (QuoteControl) pairs only; absent for pump.fun's standard rate. */
  creatorFeeBps?: number;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publicUri(value: string, label: string): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error(`${label}: invalid URI`);
  const url = new URL(value);
  if (url.protocol === "ipfs:" && url.hostname && !url.username && !url.password) return value;
  if (url.protocol === "https:" && !url.username && !url.password && url.hostname &&
    !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.localhost$|.*\.local$)/i.test(url.hostname)) return value;
  throw new Error(`${label}: use a public HTTPS or IPFS URI`);
}

export function publicKey(value: string, label: string): PublicKey {
  const key = new PublicKey(value);
  if (key.equals(PublicKey.default) || !PublicKey.isOnCurve(key.toBytes())) {
    throw new Error(`${label}: an on-curve signer public key is required`);
  }
  return key;
}

export function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

/**
 * Reads a fresh, single-slot mainnet snapshot and builds only create_v2.
 * No transaction, blockhash, signature, initial buy, upload or NFT is submitted.
 * Signing integration must refresh this plan, review costs and verify confirmation.
 */
/** The coin's own create_v2 fields: name, symbol and metadata URI. Returns the reviewed URI. */
export function reviewTokenFields(input: Pick<PrepareLaunchInput, "name" | "symbol" | "tokenMetadataUri">): string {
  if (typeof input.name !== "string" || !input.name.trim() || Buffer.byteLength(input.name, "utf8") > 32 || /[\x00-\x1f]/.test(input.name)) {
    throw new Error("Coin name must contain 1–32 UTF-8 bytes");
  }
  if (typeof input.symbol !== "string" || !/^[A-Za-z0-9]{1,13}$/.test(input.symbol)) {
    throw new Error("Coin symbol must contain 1–13 letters or digits");
  }
  const tokenMetadataUri = publicUri(input.tokenMetadataUri, "token metadata");
  if (Buffer.byteLength(tokenMetadataUri, "utf8") > 200) throw new Error("Token metadata URI exceeds 200 bytes");
  return tokenMetadataUri;
}

export function reviewLaunchInput(input: PrepareLaunchInput) {
  const asset = PAIR_ASSETS.find((candidate) => candidate.key === input.quoteKey);
  if (!asset) throw new Error("Choose a verified CardDex pair asset");
  const creator = publicKey(input.creator, "creator");
  const mint = publicKey(input.mint, "mint");
  const quoteMint = new PublicKey(asset.mint);
  if (mint.equals(creator) || mint.equals(quoteMint)) throw new Error("A distinct new mint public key is required");
  const tokenMetadataUri = reviewTokenFields(input);
  if (!input.card || !isCardDesignKey(input.card.designKey) || !(input.card.designKey in designAssets)) {
    throw new Error("A reviewed canonical card design key is required");
  }
  resolveLaunchQuote(input.card.designKey, { quoteAssetKey: asset.key, quoteMint: asset.mint });
  const reviewedArt = designAssets[input.card.designKey as keyof typeof designAssets];
  for (const field of ["frontSha256", "backSha256"] as const) {
    if (!/^[a-f0-9]{64}$/.test(input.card[field])) throw new Error(`${field}: lowercase SHA-256 required`);
  }
  // The current reviewed art, or a version of this design that launches recorded before a redesign replaced it
  // (design-versions.ts): a saved launch keeps, re-prepares and mints exactly the art its creator reviewed.
  const current = input.card.frontSha256 === reviewedArt.front.sha256 && input.card.backSha256 === reviewedArt.back.sha256;
  if (!current && !archivedDesignForHashes(input.card.designKey, input.card.frontSha256, input.card.backSha256)) {
    throw new Error("Card front/back hashes do not match the reviewed design manifest");
  }
  const card = {
    designKey: input.card.designKey,
    frontUri: publicUri(input.card.frontUri, "card front"),
    backUri: publicUri(input.card.backUri, "card back"),
    frontSha256: input.card.frontSha256,
    backSha256: input.card.backSha256,
    nftMetadataUri: publicUri(input.card.nftMetadataUri, "NFT metadata"),
  };
  let options: CreateOptions;
  try { options = readCreateOptions(input); } catch (error) { throw new Error(error instanceof Error ? error.message : "Invalid create options"); }
  const problem = createOptionsProblem(options, { admission: asset.admission });
  if (problem) throw new Error(problem);
  return { asset, creator, mint, quoteMint, tokenMetadataUri, card, options };
}

type DecodedGlobal = ReturnType<typeof PUMP_SDK.decodeGlobal>;
/** What pump.fun's Global allows for the create options, from a decoded Global. */
export function createOptionsGlobal(global: DecodedGlobal): CreateOptionsGlobal {
  // A u16 in the IDL (a number), read through toString() so a BN-typed decoder reads the same.
  const raw = (global as { maxConfigurableCreatorFeeBps?: { toString(): string } | number | null }).maxConfigurableCreatorFeeBps;
  const max = raw === undefined || raw === null ? 0 : Number(raw.toString());
  return { holderRewards: global.isHolderRewardEnabled === true, creatorFeeConfigurable: global.creatorFeeConfigurable === true,
    maxCreatorFeeBps: Number.isSafeInteger(max) && max > 0 ? max : 0 };
}
/** create_v2's option arguments for these options: mayhem and cashback always off; unset options encode as before. */
export function createV2Flags(options: CreateOptions) {
  return { mayhemMode: false, cashback: false, holderReward: options.holderReward === true,
    ...(options.creatorFeeBps ? { creatorFeeBps: new BN(options.creatorFeeBps) } : {}) };
}
/** The options as a binding adds them: nothing for a regular coin, so older bindings hash exactly as before. */
export function bindingOptions(options: CreateOptions) {
  return { ...(options.holderReward ? { holderReward: true as const } : {}), ...(options.creatorFeeBps ? { creatorFeeBps: options.creatorFeeBps } : {}) };
}

/**
 * Token-2022 quote extensions read at prepare time, so a later catalog or mint change cannot slip through. A transfer
 * fee (SDK 4.1.0 prices buys without it, so the minimum output would be wrong and the buy would fail simulation) or a
 * transfer-hook program (an extra program would run inside the buy) refuses the quote outright. A permanent delegate
 * (every tokenized-stock quote has one) is reported: wallets warn when a transaction spends such a token.
 */
export function quoteIssuerControls(mint: Mint) {
  const fee = getTransferFeeConfig(mint);
  if (fee && [fee.olderTransferFee, fee.newerTransferFee].some((entry) => entry.transferFeeBasisPoints > 0 || entry.maximumFee > 0n)) {
    throw new Error("Pair mint charges a transfer fee this launch cannot price");
  }
  const hook = getTransferHook(mint);
  if (hook && !hook.programId.equals(PublicKey.default)) throw new Error("Pair mint runs a transfer-hook program");
  const delegate = getPermanentDelegate(mint);
  return { permanentDelegate: !!delegate && !delegate.delegate.equals(PublicKey.default) };
}
/**
 * Whether a live launch may spend a permanent-delegate quote (the tokenized stocks) in its first buy. Wallets warn on
 * any transaction that moves such a token (Phantom's Token-2022 guidance), so by default those launches go without an
 * initial buy: the coin is created with the stock quote, and buying happens afterwards on pump.fun. Set true to
 * allow the buy again; the review already tells the creator about the notice before the wallet opens.
 */
// Before turning this on: GMEX, NVDAX and AAPLX carry a Token-2022 scaled-UI multiplier (about 1.0017 to 1.0053 at slot
// 463274173) that amounts here ignore (they convert by decimals only); convert entered amounts with the mint's current
// multiplier and show the wallet's figure in the review first.
export const ALLOW_PERMANENT_DELEGATE_QUOTE_BUY = false;
export const PERMANENT_DELEGATE_BUY_REFUSAL = "Wallets warn about tokenized-stock quotes in a first buy (the stock token has issuer controls); launch without an initial buy, then buy on pump.fun after launch";

export async function preparePumpLaunchPlan(
  input: PrepareLaunchInput,
  options: { connection?: PairReadConnection; now?: () => Date } = {},
) {
  const { asset, creator, mint, quoteMint, tokenMetadataUri, card, options: createOptions } = reviewLaunchInput(input);
  const connection = options.connection ?? new Connection(PUBLIC_MAINNET_RPC, "confirmed");
  const keys = [GLOBAL_PDA, QUOTE_CONTROL_PDA, quoteMint, mint];
  const [genesisHash, snapshot] = await Promise.all([
    connection.getGenesisHash(),
    connection.getMultipleAccountsInfoAndContext(keys, { commitment: "confirmed" }),
  ]);
  if (genesisHash !== MAINNET_GENESIS_HASH) throw new Error("Only a verified Solana mainnet snapshot is accepted");
  if (!Number.isSafeInteger(snapshot.context.slot) || snapshot.context.slot <= 0 || snapshot.value.length !== keys.length) {
    throw new Error("Invalid RPC account snapshot");
  }
  const [globalInfo, quoteControlInfo, quoteInfo, newMintInfo] = snapshot.value;
  if (newMintInfo !== null) throw new Error("The requested new mint account already exists");
  if (!globalInfo || !globalInfo.owner.equals(PUMP_PROGRAM_ID)) throw new Error("Invalid Pump Global account owner");
  if (quoteControlInfo && !quoteControlInfo.owner.equals(PUMP_PROGRAM_ID)) throw new Error("Invalid Pump QuoteControl account owner");
  if (!quoteInfo || quoteInfo.executable) throw new Error("Pair mint account is missing or executable");
  const global = PUMP_SDK.decodeGlobal(globalInfo);
  if (!global.createV2Enabled) throw new Error("Pump create_v2 is disabled");
  // The chosen options against what pump.fun allows right now: a change since the form was filled is refused here.
  const optionsProblem = createOptionsProblem(createOptions, { admission: asset.admission, global: createOptionsGlobal(global) });
  if (optionsProblem) throw new Error(optionsProblem);
  const quoteControl = quoteControlInfo ? PUMP_SDK.decodeQuoteControl(quoteControlInfo) : null;
  const inGlobal = global.whitelistedQuoteMints.some((key) => key.equals(quoteMint));
  const inControl = quoteControl?.mints.some((entry) => entry.mint.equals(quoteMint)) ?? false;
  if (asset.key !== "sol" && !inGlobal && !inControl) throw new Error("Pair asset is no longer directly admitted by Pump");

  // The official resolver reads this exact snapshot, avoiding a second mixed-slot
  // fetch. Only catalog assets are admitted; arbitrary/nested pump quotes are out.
  const byKey = new Map(keys.map((key, index) => [key.toBase58(), snapshot.value[index]]));
  const snapshotConnection = {
    getMultipleAccountsInfo: async (requested: PublicKey[]) => requested.map((key) => {
      if (!byKey.has(key.toBase58())) throw new Error("Unexpected SDK account request");
      return byKey.get(key.toBase58()) ?? null;
    }),
  } as unknown as Connection;
  const resolved = await new OnlinePumpSdk(snapshotConnection).resolveQuoteMint(quoteMint);
  if (resolved.source === "pumpCoin") throw new Error("Nested pump-coin quotes require separate review");
  // pump.fun stores a custom rate only for a QuoteControl quote and silently drops it elsewhere: never sent where ignored.
  if (createOptions.creatorFeeBps && resolved.source !== "quoteControl") throw new Error(CREATOR_FEE_RATE_PAIR);
  if (resolved.decimals !== asset.decimals || resolved.quoteTokenProgram.toBase58() !== asset.tokenProgram) {
    throw new Error("Pair mint decimals or token program changed from the reviewed catalog");
  }
  const mintState = unpackMint(quoteMint, quoteInfo, resolved.quoteTokenProgram);
  if (!mintState.isInitialized || getPausableConfig(mintState)?.paused ||
    getDefaultAccountState(mintState)?.state === AccountState.Frozen) {
    throw new Error("Pair mint is uninitialized, paused or frozen by default");
  }
  const issuerControls = quoteIssuerControls(mintState);
  if (resolved.initialVirtualQuoteReserves.lten(0)) throw new Error("Pair asset has no positive starting reserves");
  const instruction = await PUMP_SDK.createV2Instruction({
    mint, user: creator, creator, name: input.name, symbol: input.symbol,
    uri: tokenMetadataUri, quoteMint, quoteTokenProgram: resolved.quoteTokenProgram,
    ...createV2Flags(createOptions),
  });
  const binding = {
    network: "solana-mainnet-beta" as const,
    tokenMint: mint.toBase58(), creator: creator.toBase58(),
    name: input.name, symbol: input.symbol, tokenMetadataUri,
    quote: {
      key: asset.key, symbol: asset.symbol, name: asset.name, kind: asset.kind,
      mint: asset.mint, decimals: resolved.decimals, tokenProgram: asset.tokenProgram,
    },
    card,
    ...bindingOptions(createOptions),
  };
  const serializedInstruction = {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => ({
      address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable,
    })),
    dataBase64: Buffer.from(instruction.data).toString("base64"),
  };
  return immutable({
    version: 1 as const,
    status: "unsigned-review-only" as const,
    provider: "pump.fun" as const, sdkVersion: SDK_VERSION,
    preparedAt: (options.now?.() ?? new Date()).toISOString(),
    verifiedSlot: snapshot.context.slot, genesisHash,
    admission: resolved.source,
    quoteIssuerControls: issuerControls,
    initialVirtualQuoteReserves: resolved.initialVirtualQuoteReserves.toString(),
    binding, bindingSha256: hash(JSON.stringify(binding)),
    createInstruction: serializedInstruction,
    instructionSha256: hash(JSON.stringify(serializedInstruction)),
    requiredSigners: [...new Set(instruction.keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58()))],
    nft: {
      status: "not-issued" as const,
      requiredAfter: "confirmed-pump-create" as const,
      metadataUri: card.nftMetadataUri,
      tokenMint: binding.tokenMint, designKey: card.designKey,
      quoteMint: binding.quote.mint, bindingSha256: hash(JSON.stringify(binding)),
    },
    requiresBeforeSigning: [
      "Rebuild from fresh accounts and show wallet review, network/rent/priority fees and issuer eligibility.",
      "Fetch and verify public token/NFT metadata and front/back content hashes against this binding.",
      "Simulate the complete unsigned transaction, then obtain creator and mint signatures.",
      "After confirmation verify Pump curve quote_mint and create event before issuing the separate NFT.",
    ],
  });
}

export type UnsignedPumpLaunchPlan = Awaited<ReturnType<typeof preparePumpLaunchPlan>>;
