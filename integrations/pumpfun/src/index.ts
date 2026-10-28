import { createHash } from "node:crypto";
import {
  GLOBAL_PDA, OnlinePumpSdk, PUMP_PROGRAM_ID, PUMP_SDK, QUOTE_CONTROL_PDA,
} from "@pump-fun/pump-sdk";
import {
  Connection, PublicKey, type AccountInfo, type Commitment,
  type GetMultipleAccountsConfig, type RpcResponseAndContext,
} from "@solana/web3.js";
import { AccountState, getDefaultAccountState, getPausableConfig, unpackMint } from "@solana/spl-token";
import verifiedCatalog from "../../../reports/pump-pair-assets-2026-10-28.json";
import { isCardDesignKey } from "../../../app/src/lib/carddex/designs";
import { resolveLaunchQuote } from "../../../app/src/lib/carddex/pairs";
import designAssets from "./design-assets.json";

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
}

function hash(value: string): string {
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

function publicKey(value: string, label: string): PublicKey {
  const key = new PublicKey(value);
  if (key.equals(PublicKey.default) || !PublicKey.isOnCurve(key.toBytes())) {
    throw new Error(`${label}: an on-curve signer public key is required`);
  }
  return key;
}

function immutable<T>(value: T): T {
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
export async function preparePumpLaunchPlan(
  input: PrepareLaunchInput,
  options: { connection?: PairReadConnection; now?: () => Date } = {},
) {
  const asset = PAIR_ASSETS.find((candidate) => candidate.key === input.quoteKey);
  if (!asset) throw new Error("Choose a verified CardDex pair asset");
  const creator = publicKey(input.creator, "creator");
  const mint = publicKey(input.mint, "mint");
  const quoteMint = new PublicKey(asset.mint);
  if (mint.equals(creator) || mint.equals(quoteMint)) throw new Error("A distinct new mint public key is required");
  if (typeof input.name !== "string" || !input.name.trim() || Buffer.byteLength(input.name, "utf8") > 32 || /[\x00-\x1f]/.test(input.name)) {
    throw new Error("Coin name must contain 1–32 UTF-8 bytes");
  }
  if (typeof input.symbol !== "string" || !/^[A-Za-z0-9]{1,13}$/.test(input.symbol)) {
    throw new Error("Coin symbol must contain 1–13 letters or digits");
  }
  const tokenMetadataUri = publicUri(input.tokenMetadataUri, "token metadata");
  if (Buffer.byteLength(tokenMetadataUri, "utf8") > 200) throw new Error("Token metadata URI exceeds 200 bytes");
  if (!input.card || !isCardDesignKey(input.card.designKey) || !(input.card.designKey in designAssets)) {
    throw new Error("A reviewed canonical card design key is required");
  }
  resolveLaunchQuote(input.card.designKey, { quoteAssetKey: asset.key, quoteMint: asset.mint });
  const reviewedArt = designAssets[input.card.designKey as keyof typeof designAssets];
  for (const field of ["frontSha256", "backSha256"] as const) {
    if (!/^[a-f0-9]{64}$/.test(input.card[field])) throw new Error(`${field}: lowercase SHA-256 required`);
  }
  if (input.card.frontSha256 !== reviewedArt.front.sha256 || input.card.backSha256 !== reviewedArt.back.sha256) {
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
  if (resolved.decimals !== asset.decimals || resolved.quoteTokenProgram.toBase58() !== asset.tokenProgram) {
    throw new Error("Pair mint decimals or token program changed from the reviewed catalog");
  }
  const mintState = unpackMint(quoteMint, quoteInfo, resolved.quoteTokenProgram);
  if (!mintState.isInitialized || getPausableConfig(mintState)?.paused ||
    getDefaultAccountState(mintState)?.state === AccountState.Frozen) {
    throw new Error("Pair mint is uninitialized, paused or frozen by default");
  }
  if (resolved.initialVirtualQuoteReserves.lten(0)) throw new Error("Pair asset has no positive starting reserves");
  const instruction = await PUMP_SDK.createV2Instruction({
    mint, user: creator, creator, name: input.name, symbol: input.symbol,
    uri: tokenMetadataUri, quoteMint, quoteTokenProgram: resolved.quoteTokenProgram,
    mayhemMode: false, cashback: false, holderReward: false,
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
