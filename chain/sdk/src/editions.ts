/**
 * Creator-edition identity and metadata preparation. These helpers NEVER prove an NFT exists, verify a
 * purchaser, reserve inventory, grant an entitlement, or construct/sign/send a transaction. An issuer must
 * live-verify the original Card.launcher and finalized issuance receipt before publishing/activating anything.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { isAddress } from "./address.ts";
import { base58Decode, base58Encode, fromBase64, toBase64, toHex, utf8Encode } from "./bytes.ts";

export const CREATOR_EDITION_POLICY_VERSION = "creator-edition-v1" as const;
export const CREATOR_EDITION_TEMPLATE_KEYS = [
  "doge", "pepe", "shib", "bonk", "wif", "popcat", "gamestop", "amc", "blackberry", "nokia",
  "coinbase", "binance", "kraken", "strategy", "wildtype", "ronin", "astral", "neon-circuit", "sovereign", "abyssal",
] as const;
export type CreatorEditionTemplateKey = typeof CREATOR_EDITION_TEMPLATE_KEYS[number];
export type CreatorEditionCluster = "devnet" | "mainnet-beta";

export function isCreatorEditionTemplate(value: unknown): value is CreatorEditionTemplateKey {
  return typeof value === "string" && (CREATOR_EDITION_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export interface CreatorEditionIdentity {
  cluster: CreatorEditionCluster;
  tokenMint: string;
  /** Immutable original Card.launcher, never the current fee-card holder or Pump vault PDA. */
  originalCreator: string;
  templateKey: CreatorEditionTemplateKey;
}

function assertIdentity(input: CreatorEditionIdentity): void {
  if (input.cluster !== "devnet" && input.cluster !== "mainnet-beta") throw new Error("Unsupported edition cluster");
  if (!isAddress(input.tokenMint) || !isAddress(input.originalCreator)) throw new Error("Invalid edition identity address");
  if (!isCreatorEditionTemplate(input.templateKey)) throw new Error("Unknown creator edition template");
}

/**
 * Lifetime uniqueness is cluster + token + design. Neither a new art version, new buyer, transfer nor burn
 * makes a new slot. This is an off-chain key, NOT a Solana receipt PDA or proof of on-chain enforcement.
 */
export function creatorEditionIssuanceKey(input: Pick<CreatorEditionIdentity, "cluster" | "tokenMint" | "templateKey">): string {
  if (input.cluster !== "devnet" && input.cluster !== "mainnet-beta") throw new Error("Unsupported edition cluster");
  if (!isAddress(input.tokenMint) || !isCreatorEditionTemplate(input.templateKey)) throw new Error("Invalid edition issuance key");
  return `${input.cluster}:${input.tokenMint}:${input.templateKey}`;
}

/** Fixed field order and domain separator; owner/purchase price/live stats never enter immutable identity. */
export function creatorEditionIdentityCommitment(input: CreatorEditionIdentity): string {
  assertIdentity(input);
  return toHex(sha256(utf8Encode(JSON.stringify([
    CREATOR_EDITION_POLICY_VERSION, input.cluster, input.tokenMint, input.originalCreator, input.templateKey,
  ]))));
}

export interface CreatorEditionMetadataInput extends CreatorEditionIdentity {
  /** A proposed independent Core asset. It must never reuse the coin mint or existing earned card mint. */
  assetAddress: string;
  earnedCardMint: string;
  collectionAddress: string;
  templateVersion: string;
  tokenName: string;
  tokenTicker: string;
  designName: string;
  editionNumber: number;
  lifetimeCap: number;
  /** Actual earned level captured for the fixed collectible artwork, not a purchased tier. */
  earnedLevelAtIssue: number;
  /** Issuer must inspect bytes and verify MIME and SHA-256 before passing the pinned reference here. */
  front: CreatorEditionArt;
  back: CreatorEditionArt;
}

export interface CreatorEditionArt {
  uri: string;
  sha256: string;
  type: "image/png" | "image/webp" | "image/jpeg";
}

/** Restricted, structurally validated CID forms: CIDv0 or CIDv1 dag-pb/raw with a 32-byte SHA-256 multihash. */
function isArtCid(value: string): boolean {
  try {
    if (value.startsWith("Qm")) {
      if (value.length !== 46) return false;
      const bytes = base58Decode(value);
      return bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20 && base58Encode(bytes) === value;
    }
    if (value.length !== 59 || !/^b[a-z2-7]+$/.test(value)) return false;
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const character of value.slice(1)) {
      buffer = (buffer << 5) | alphabet.indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
        buffer &= (1 << bits) - 1;
      }
    }
    // These supported canonical single-byte codec/hash identifiers form a 36-byte binary CID.
    return bits < 5 && buffer === 0 && bytes.length === 36 &&
      bytes[0] === 1 && (bytes[1] === 0x70 || bytes[1] === 0x55) && bytes[2] === 0x12 && bytes[3] === 0x20;
  } catch { return false; }
}

function isArweaveId(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = fromBase64(value);
  const canonical = toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return bytes.length === 32 && canonical === value;
}

function safeText(value: string, field: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value) || utf8Encode(value).length > maxBytes) {
    throw new Error(`Invalid ${field}`);
  }
  return value.trim();
}

/** No mutable R2 URL, local/blob/data URL, query string or URL credentials may masquerade as frozen art. */
function immutableArt(input: CreatorEditionArt): CreatorEditionArt {
  if (!input || typeof input.uri !== "string" || input.uri.length > 512 || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new Error("Invalid edition art commitment");
  }
  const contentAddress = /^(ipfs|ar):\/\/([^/]+)((?:\/[A-Za-z0-9._-]+)*)$/;
  const match = input.uri.match(contentAddress);
  if (!match || input.uri.split("/").some(part => part === "." || part === "..") ||
      !(match[1] === "ipfs" ? isArtCid(match[2]) : isArweaveId(match[2]))) {
    throw new Error("Edition artwork must use a content-addressed IPFS or Arweave URI");
  }
  if (!["image/png", "image/webp", "image/jpeg"].includes(input.type)) throw new Error("Invalid edition image MIME type");
  return { uri: input.uri, sha256: input.sha256, type: input.type };
}

export function buildCreatorEditionMetadataDraft(input: CreatorEditionMetadataInput) {
  assertIdentity(input);
  for (const address of [input.assetAddress, input.earnedCardMint, input.collectionAddress]) {
    if (!isAddress(address)) throw new Error("Invalid collectible asset/collection address");
  }
  if (new Set([input.assetAddress, input.earnedCardMint, input.tokenMint, input.collectionAddress]).size !== 4) {
    throw new Error("Collectible, collection, token and earned card must have separate addresses");
  }
  if (!Number.isSafeInteger(input.lifetimeCap) || input.lifetimeCap < 1 ||
      !Number.isSafeInteger(input.editionNumber) || input.editionNumber < 1 || input.editionNumber > input.lifetimeCap) {
    throw new Error("Edition serial must fit a configured positive lifetime cap");
  }
  if (!Number.isInteger(input.earnedLevelAtIssue) || input.earnedLevelAtIssue < 1 || input.earnedLevelAtIssue > 14) {
    throw new Error("Invalid earned level snapshot");
  }
  if (typeof input.templateVersion !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.templateVersion)) throw new Error("Invalid template version");
  const tokenName = safeText(input.tokenName, "token name", 128);
  const tokenTicker = safeText(input.tokenTicker, "token ticker", 40);
  const designName = safeText(input.designName, "design name", 128);
  const front = immutableArt(input.front);
  const back = immutableArt(input.back);
  if (front.uri === back.uri || front.sha256 === back.sha256) throw new Error("Matching front and reverse require separate artwork");
  const identityCommitment = creatorEditionIdentityCommitment(input);
  const immutableIdentity = {
    policyVersion: CREATOR_EDITION_POLICY_VERSION,
    cluster: input.cluster, tokenMint: input.tokenMint, originalCreator: input.originalCreator,
    templateKey: input.templateKey, templateVersion: input.templateVersion,
    assetAddress: input.assetAddress, collectionAddress: input.collectionAddress,
    editionNumber: input.editionNumber, lifetimeCap: input.lifetimeCap,
    tokenName, tokenTicker, designName, earnedLevelAtIssue: input.earnedLevelAtIssue,
    front, back,
  };
  const metadata = {
    name: `${tokenName} — ${designName}`,
    symbol: "MDXLE",
    description: `A separate ${designName} collectible for ${tokenName} ($${tokenTicker}). The NFT stays linked to this token. Its transfer or burn does not remove the token's permanent styling. It carries no creator-fee rights, token control or reusable template license. Artwork and earned level are an issuance snapshot.`,
    image: front.uri,
    external_url: `https://mintdex.fun/coin/${input.tokenMint}`,
    attributes: [
      { trait_type: "Token mint", value: input.tokenMint },
      { trait_type: "Original creator", value: input.originalCreator },
      { trait_type: "Design", value: input.templateKey },
      { trait_type: "Design version", value: input.templateVersion },
      { trait_type: "Edition", value: input.editionNumber },
      { trait_type: "Lifetime design cap", value: input.lifetimeCap },
      { trait_type: "Earned level at issue", value: input.earnedLevelAtIssue },
      { trait_type: "Creator-fee rights", value: "None" },
    ],
    properties: {
      category: "image",
      files: [{ uri: front.uri, type: front.type }, { uri: back.uri, type: back.type }],
      mintdex: {
        ...immutableIdentity,
        identityCommitment,
        stylingRemainsWithToken: true,
        collectibleTransferable: true,
        creatorFeeRights: false,
        reusableTemplateLicense: false,
        statsMode: "issuance-snapshot",
      },
    },
  };
  return {
    kind: "metadata-draft" as const,
    issuanceKey: creatorEditionIssuanceKey(input),
    identityCommitment,
    /** Commit all frozen identity/art/serial fields, not only the token/design uniqueness key. */
    contentCommitment: toHex(sha256(utf8Encode(JSON.stringify(immutableIdentity)))),
    metadata,
  };
}
