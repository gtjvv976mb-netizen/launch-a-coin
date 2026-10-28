// Pyth price posting without the Pyth SDKs (fix-plan §4.1, F3 / tier B8): parse a Hermes accumulator update ("PNAU"),
// post its Wormhole VAA into an encoded-VAA account (create, init, write in two parts, verify), update the sponsored
// SOL/USD PriceUpdateV2 through the push oracle, then close the encoded VAA. Instruction bytes are checked against
// @pythnetwork/pyth-solana-receiver 0.16.0 (test/pyth.test.ts, fixture test/fixtures/pyth/post-update.json).
//
// Used by the Worker's Hermes refresh (chain-worker/src/watchdog/pyth-refresh.ts) when the sponsored feed is older than
// the plan's thresholds; the encoded-VAA account is a fresh keypair per refresh, closed in the last transaction (and by
// the next round if a refresh stops halfway).
import { pda, toAddress, toAddressBytes } from "../address.ts";
import type { Address, AddressLike } from "../address.ts";
import { ByteWriter, bytesEqual, readI64 } from "../bytes.ts";
import { PYTH_RECEIVER_PROGRAM_ID, SOL_USD_FEED_ID, SYSTEM_PROGRAM_ID } from "../constants.ts";
import { anchorDiscriminator } from "../idl.ts";
import { ro, rs, wr, ws } from "../instruction.ts";
import type { Instruction } from "../instruction.ts";

/** Wormhole core bridge (Solana receiver) and the Pyth push oracle, the same ids on devnet and mainnet. */
export const WORMHOLE_RECEIVER_PROGRAM_ID: Address = "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ";
export const PYTH_PUSH_ORACLE_PROGRAM_ID: Address = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";

/** Encoded VAA account = 46-byte header (discriminator, status, write authority, version, buffer length) + the VAA. */
export const ENCODED_VAA_HEADER_LEN = 46;
/** The first write carries this many VAA bytes (the rest goes with the verify, as in the Pyth SDK). */
export const VAA_SPLIT_INDEX = 721;
/** Compute units the Pyth SDK budgets per step (compute_budget.ts of the receiver SDK). */
export const PYTH_POST_CU = { init: 3_000, write: 3_000, verify: 350_000, updatePriceFeed: 55_000, close: 30_000 } as const;
/** Default push-oracle shard of the sponsored feeds. */
export const PYTH_SPONSORED_SHARD = 0;

const disc = (name: string) => Uint8Array.from(anchorDiscriminator("global", name));
const IX = {
  initEncodedVaa: disc("init_encoded_vaa"),
  writeEncodedVaa: disc("write_encoded_vaa"),
  verifyEncodedVaaV1: disc("verify_encoded_vaa_v1"),
  closeEncodedVaa: disc("close_encoded_vaa"),
  updatePriceFeed: disc("update_price_feed"),
};

// ---------------------------------------------------------------- Hermes accumulator updates

export interface MerklePriceUpdate {
  message: Uint8Array;
  /** 20-byte keccak160 hashes */
  proof: Uint8Array[];
}

export interface AccumulatorUpdate {
  vaa: Uint8Array;
  updates: MerklePriceUpdate[];
}

const MAGIC = Uint8Array.of(0x50, 0x4e, 0x41, 0x55); // "PNAU"

/** Parses a Hermes accumulator update (binary `encoding=base64` payload of /v2/updates/price/...). Throws when malformed. */
export function parseAccumulatorUpdate(data: Uint8Array): AccumulatorUpdate {
  if (data.length < 9 || !bytesEqual(data.subarray(0, 4), MAGIC) || data[4] !== 1 || data[5] !== 0) {
    throw new Error("not a Pyth accumulator update (PNAU v1.0)");
  }
  const need = (o: number, n: number) => {
    if (o + n > data.length) throw new Error("accumulator update truncated");
  };
  const be16 = (o: number) => {
    need(o, 2);
    return (data[o] << 8) | data[o + 1];
  };
  let c = 6;
  need(c, 1);
  c += 1 + data[c]; // trailing header
  c += 1; // update type (0 = WormholeMerkle)
  const vaaLen = be16(c);
  c += 2;
  need(c, vaaLen);
  const vaa = data.subarray(c, c + vaaLen);
  c += vaaLen;
  need(c, 1);
  const n = data[c];
  c += 1;
  const updates: MerklePriceUpdate[] = [];
  for (let i = 0; i < n; i++) {
    const mlen = be16(c);
    c += 2;
    need(c, mlen);
    const message = data.subarray(c, c + mlen);
    c += mlen;
    need(c, 1);
    const np = data[c];
    c += 1;
    const proof: Uint8Array[] = [];
    for (let j = 0; j < np; j++) {
      need(c, 20);
      proof.push(data.subarray(c, c + 20));
      c += 20;
    }
    updates.push({ message, proof });
  }
  if (c !== data.length) throw new Error("accumulator update has trailing bytes");
  return { vaa, updates };
}

export interface PriceFeedMessage {
  feedId: Uint8Array;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: bigint;
  prevPublishTime: bigint;
  emaPrice: bigint;
  emaConf: bigint;
}

/** A price-feed message (variant 0, big-endian fields). */
export function parsePriceFeedMessage(m: Uint8Array): PriceFeedMessage {
  if (m.length < 85 || m[0] !== 0) throw new Error("not a price feed message");
  const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
  return {
    feedId: m.subarray(1, 33),
    price: dv.getBigInt64(33, false),
    conf: dv.getBigUint64(41, false),
    expo: dv.getInt32(49, false),
    publishTime: dv.getBigInt64(53, false),
    prevPublishTime: dv.getBigInt64(61, false),
    emaPrice: dv.getBigInt64(69, false),
    emaConf: dv.getBigUint64(77, false),
  };
}

/** The guardian set index of a VAA (u32 big-endian at byte 1). */
export const guardianSetIndexOf = (vaa: Uint8Array): number =>
  ((vaa[1] << 24) >>> 0) + (vaa[2] << 16) + (vaa[3] << 8) + vaa[4];

// ---------------------------------------------------------------- PDAs

const u32be = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
export const wormholeGuardianSetPda = (index: number): Address => pda([new TextEncoder().encode("GuardianSet"), u32be(index)], WORMHOLE_RECEIVER_PROGRAM_ID);
export const pythReceiverConfigPda = (): Address => pda(["config"], PYTH_RECEIVER_PROGRAM_ID);
export const pythTreasuryPda = (treasuryId: number): Address => pda(["treasury", Uint8Array.of(treasuryId)], PYTH_RECEIVER_PROGRAM_ID);
/** The push-oracle price account of a feed: PDA([shard u16 LE, feed id]); shard 0 SOL/USD = 7UVim… */
export const pythPriceFeedPda = (shardId: number, feedId: Uint8Array = SOL_USD_FEED_ID): Address =>
  pda([Uint8Array.of(shardId & 0xff, (shardId >> 8) & 0xff), feedId], PYTH_PUSH_ORACLE_PROGRAM_ID);

// ---------------------------------------------------------------- instructions

/** System `create_account` of the encoded-VAA account (owner the Wormhole receiver), signed by payer and the new account. */
export function createEncodedVaaAccountIx(p: { payer: AddressLike; encodedVaa: AddressLike; vaaLength: number; lamports: bigint }): Instruction {
  const space = BigInt(p.vaaLength + ENCODED_VAA_HEADER_LEN);
  const data = new ByteWriter().u32(0).u64(p.lamports).u64(space).bytes(toAddressBytes(WORMHOLE_RECEIVER_PROGRAM_ID)).toBytes();
  return { programId: SYSTEM_PROGRAM_ID, accounts: [ws(p.payer), ws(p.encodedVaa)], data };
}

export const initEncodedVaaIx = (p: { writeAuthority: AddressLike; encodedVaa: AddressLike }): Instruction => ({
  programId: WORMHOLE_RECEIVER_PROGRAM_ID,
  accounts: [rs(p.writeAuthority), wr(p.encodedVaa)],
  data: IX.initEncodedVaa,
});

export function writeEncodedVaaIx(p: { writeAuthority: AddressLike; encodedVaa: AddressLike; index: number; data: Uint8Array }): Instruction {
  const w = new ByteWriter().bytes(IX.writeEncodedVaa).u32(p.index).u32(p.data.length).bytes(p.data);
  return { programId: WORMHOLE_RECEIVER_PROGRAM_ID, accounts: [rs(p.writeAuthority), wr(p.encodedVaa)], data: w.toBytes() };
}

export const verifyEncodedVaaV1Ix = (p: { writeAuthority: AddressLike; encodedVaa: AddressLike; guardianSetIndex: number }): Instruction => ({
  programId: WORMHOLE_RECEIVER_PROGRAM_ID,
  accounts: [rs(p.writeAuthority), wr(p.encodedVaa), ro(wormholeGuardianSetPda(p.guardianSetIndex))],
  data: IX.verifyEncodedVaaV1,
});

/** Closes the encoded VAA (rent back to the write authority). */
export const closeEncodedVaaIx = (p: { writeAuthority: AddressLike; encodedVaa: AddressLike }): Instruction => ({
  programId: WORMHOLE_RECEIVER_PROGRAM_ID,
  accounts: [ws(p.writeAuthority), wr(p.encodedVaa)],
  data: IX.closeEncodedVaa,
});

/** Push oracle `update_price_feed(params { merkle_price_update, treasury_id }, shard_id, feed_id)`. */
export function updatePriceFeedIx(p: {
  payer: AddressLike;
  encodedVaa: AddressLike;
  update: MerklePriceUpdate;
  treasuryId: number;
  shardId?: number;
  feedId?: Uint8Array;
}): Instruction {
  const shardId = p.shardId ?? PYTH_SPONSORED_SHARD;
  const feedId = p.feedId ?? parsePriceFeedMessage(p.update.message).feedId;
  const w = new ByteWriter().bytes(IX.updatePriceFeed).u32(p.update.message.length).bytes(p.update.message).u32(p.update.proof.length);
  for (const h of p.update.proof) {
    if (h.length !== 20) throw new Error("proof hashes are 20 bytes");
    w.bytes(h);
  }
  w.u8(p.treasuryId).u16(shardId).bytes(feedId);
  return {
    programId: PYTH_PUSH_ORACLE_PROGRAM_ID,
    accounts: [
      ws(p.payer),
      ro(PYTH_RECEIVER_PROGRAM_ID),
      ro(p.encodedVaa),
      ro(pythReceiverConfigPda()),
      wr(pythTreasuryPda(p.treasuryId)),
      wr(pythPriceFeedPda(shardId, feedId)),
      ro(SYSTEM_PROGRAM_ID),
    ],
    data: w.toBytes(),
  };
}

export interface PythPostPlan {
  /** Transactions in order, each with its CU need: [create + init + write 1], [write 2 + verify], [update(s) + close]. */
  txs: Array<{ instructions: Instruction[]; computeUnits: number; signers: Address[] }>;
  /** The encoded-VAA account (write it down before the first send; close it if a later step fails). */
  encodedVaa: Address;
  /** feed id hex -> push-oracle account updated by the plan. */
  priceFeedAccounts: Record<string, Address>;
  /** Highest publish time in the update (unix seconds). */
  publishTime: bigint;
}

/**
 * The three transactions that post a Hermes update for the sponsored feed(s) (non-atomic path of the Pyth SDK: the full
 * VAA is verified by the Wormhole receiver, then each feed's merkle update goes through the push oracle). `rentLamports`
 * is `getMinimumBalanceForRentExemption(vaa.length + 46)`; it comes back at the close.
 */
export function pythPostPlan(p: {
  payer: AddressLike;
  encodedVaa: AddressLike;
  updateData: Uint8Array;
  treasuryId: number;
  rentLamports: bigint;
  shardId?: number;
  /** Only post updates for these feeds (default: every feed in the payload). */
  feedIds?: Uint8Array[];
}): PythPostPlan {
  const { vaa, updates } = parseAccumulatorUpdate(p.updateData);
  const payer = toAddressOf(p.payer);
  const encodedVaa = toAddressOf(p.encodedVaa);
  const tx1: Instruction[] = [
    createEncodedVaaAccountIx({ payer, encodedVaa, vaaLength: vaa.length, lamports: p.rentLamports }),
    initEncodedVaaIx({ writeAuthority: payer, encodedVaa }),
    writeEncodedVaaIx({ writeAuthority: payer, encodedVaa, index: 0, data: vaa.subarray(0, VAA_SPLIT_INDEX) }),
  ];
  const tx2: Instruction[] = [];
  if (vaa.length > VAA_SPLIT_INDEX) {
    tx2.push(writeEncodedVaaIx({ writeAuthority: payer, encodedVaa, index: VAA_SPLIT_INDEX, data: vaa.subarray(VAA_SPLIT_INDEX) }));
  }
  tx2.push(verifyEncodedVaaV1Ix({ writeAuthority: payer, encodedVaa, guardianSetIndex: guardianSetIndexOf(vaa) }));
  const tx3: Instruction[] = [];
  const priceFeedAccounts: Record<string, Address> = {};
  let publishTime = 0n;
  for (const u of updates) {
    const m = parsePriceFeedMessage(u.message);
    if (p.feedIds && !p.feedIds.some((f) => bytesEqual(f, m.feedId))) continue;
    tx3.push(updatePriceFeedIx({ payer, encodedVaa, update: u, treasuryId: p.treasuryId, shardId: p.shardId, feedId: m.feedId }));
    priceFeedAccounts[hex(m.feedId)] = pythPriceFeedPda(p.shardId ?? PYTH_SPONSORED_SHARD, m.feedId);
    if (m.publishTime > publishTime) publishTime = m.publishTime;
  }
  if (!tx3.length) throw new Error("the update carries none of the requested feeds");
  tx3.push(closeEncodedVaaIx({ writeAuthority: payer, encodedVaa }));
  return {
    txs: [
      { instructions: tx1, computeUnits: 20_000 + PYTH_POST_CU.init + PYTH_POST_CU.write, signers: [payer, encodedVaa] },
      { instructions: tx2, computeUnits: PYTH_POST_CU.write + PYTH_POST_CU.verify, signers: [payer] },
      { instructions: tx3, computeUnits: (tx3.length - 1) * PYTH_POST_CU.updatePriceFeed + PYTH_POST_CU.close, signers: [payer] },
    ],
    encodedVaa,
    priceFeedAccounts,
    publishTime,
  };
}

const toAddressOf = (a: AddressLike): Address => toAddress(a);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The SOL/USD PriceUpdateV2 publish time (unix seconds) from raw account data, or null when it does not parse. */
export function priceUpdatePublishTime(data: Uint8Array): bigint | null {
  if (data.length < 101 || data[40] !== 1) return null;
  return readI64(data, 93);
}
