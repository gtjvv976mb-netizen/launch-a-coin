// Metaplex Token Metadata readers (card-program-v2 §18.17): the metadata account and the master edition of a card NFT
// registered with register_card_metaplex. Layouts: mpl-token-metadata `state/metadata.rs`, `state/master_edition.rs`.
import { toAddress } from "../address.ts";
import type { Address } from "../address.ts";
import { ByteReader } from "../bytes.ts";

/** Metaplex `Key` values used here. */
export const MPL_KEY = { MasterEditionV2: 6, MetadataV1: 4 } as const;
/** Metaplex `TokenStandard`. */
export const MPL_TOKEN_STANDARD = {
  NonFungible: 0,
  FungibleAsset: 1,
  Fungible: 2,
  NonFungibleEdition: 3,
  ProgrammableNonFungible: 4,
  ProgrammableNonFungibleEdition: 5,
} as const;

export interface MetaplexCreator {
  address: Address;
  verified: boolean;
  share: number;
}

export interface MetaplexMetadata {
  updateAuthority: Address;
  mint: Address;
  /** Trailing NUL padding (Metaplex pads name/symbol/uri to their max length) removed. */
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  creators: MetaplexCreator[] | null;
  primarySaleHappened: boolean;
  isMutable: boolean;
  editionNonce: number | null;
  tokenStandard: number | null;
  collection: { verified: boolean; key: Address } | null;
}

const trimNul = (s: string) => s.replace(/\0+$/, "");

function str(r: ByteReader): string {
  const n = r.u32();
  return trimNul(new TextDecoder().decode(r.bytes(n)));
}

/** Decodes a Metaplex metadata account (key MetadataV1). Throws on another account kind. */
export function decodeMetaplexMetadata(data: Uint8Array): MetaplexMetadata {
  const r = new ByteReader(data);
  const key = r.u8();
  if (key !== MPL_KEY.MetadataV1) throw new Error(`not a Metaplex metadata account (key ${key})`);
  const updateAuthority = toAddress(r.bytes(32));
  const mint = toAddress(r.bytes(32));
  const name = str(r);
  const symbol = str(r);
  const uri = str(r);
  const sellerFeeBasisPoints = r.u16();
  let creators: MetaplexCreator[] | null = null;
  if (r.u8() === 1) {
    const n = r.u32();
    creators = [];
    for (let i = 0; i < n; i++) creators.push({ address: toAddress(r.bytes(32)), verified: r.bool(), share: r.u8() });
  }
  const primarySaleHappened = r.bool();
  const isMutable = r.bool();
  const editionNonce = r.u8() === 1 ? r.u8() : null;
  const tokenStandard = r.u8() === 1 ? r.u8() : null;
  const collection = r.u8() === 1 ? { verified: r.bool(), key: toAddress(r.bytes(32)) } : null;
  return {
    updateAuthority,
    mint,
    name,
    symbol,
    uri,
    sellerFeeBasisPoints,
    creators,
    primarySaleHappened,
    isMutable,
    editionNonce,
    tokenStandard,
    collection,
  };
}

export interface MetaplexMasterEdition {
  supply: bigint;
  /** null = unlimited prints; 0n = a one-of-one (no prints). */
  maxSupply: bigint | null;
}

/** Decodes a Metaplex master edition (key MasterEditionV2). */
export function decodeMetaplexMasterEdition(data: Uint8Array): MetaplexMasterEdition {
  const r = new ByteReader(data);
  const key = r.u8();
  if (key !== MPL_KEY.MasterEditionV2) throw new Error(`not a Metaplex master edition (key ${key})`);
  const supply = r.u64();
  const maxSupply = r.u8() === 1 ? r.u64() : null;
  return { supply, maxSupply };
}
