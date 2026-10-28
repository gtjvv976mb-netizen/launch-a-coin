// Pyth posting encoders (fix-plan §4.1, F3): byte for byte against @pythnetwork/pyth-solana-receiver 0.16.0. The fixture
// was generated once from a synthetic accumulator update with the official package (its IDLs and builders; script kept as
// test/fixtures/pyth/generate-reference.cjs.txt), so this test needs neither the package nor network access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromBase64, toHex } from "../src/bytes.ts";
import { PYTH_SOL_USD_PRICE_ACCOUNT, SOL_USD_FEED_ID } from "../src/constants.ts";
import {
  PYTH_PUSH_ORACLE_PROGRAM_ID,
  VAA_SPLIT_INDEX,
  WORMHOLE_RECEIVER_PROGRAM_ID,
  guardianSetIndexOf,
  parseAccumulatorUpdate,
  parsePriceFeedMessage,
  priceUpdatePublishTime,
  pythPostPlan,
  pythPriceFeedPda,
} from "../src/programs/pyth.ts";
import type { Instruction } from "../src/instruction.ts";

const FX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pyth", "post-update.json"), "utf8")) as {
  pnau: string;
  payer: string;
  encodedVaa: string;
  treasuryId: number;
  post: Array<{ programId: string; keys: Array<[string, boolean, boolean]>; data: string }>;
  close: Array<{ programId: string; keys: Array<[string, boolean, boolean]>; data: string }>;
  priceFeedAccount: string;
};

const asFixture = (ix: Instruction) => ({
  programId: ix.programId,
  keys: ix.accounts.map((m) => [m.address, m.isSigner, m.isWritable]),
  data: toHex(ix.data),
});

test("accumulator update parsing and the price message", () => {
  const u = parseAccumulatorUpdate(fromBase64(FX.pnau));
  assert.equal(u.updates.length, 1);
  assert.equal(guardianSetIndexOf(u.vaa), 4);
  assert.ok(u.vaa.length > VAA_SPLIT_INDEX);
  const m = parsePriceFeedMessage(u.updates[0].message);
  assert.equal(toHex(m.feedId), toHex(SOL_USD_FEED_ID));
  assert.deepEqual([m.price, m.conf, m.expo, m.publishTime, m.emaPrice], [15_012_345_678n, 7_654_321n, -8, 1_790_000_000n, 15_001_000_000n]);
  assert.equal(u.updates[0].proof.length, 3);
  assert.throws(() => parseAccumulatorUpdate(fromBase64(FX.pnau).subarray(0, 50)), /truncated/);
  const bad = fromBase64(FX.pnau);
  bad[0] = 0;
  assert.throws(() => parseAccumulatorUpdate(bad), /PNAU/);
  assert.equal(pythPriceFeedPda(0), PYTH_SOL_USD_PRICE_ACCOUNT);
});

test("the post plan equals the Pyth SDK's instructions byte for byte", () => {
  // rent of the fixture: (len + 128) * 6,960 lamports for len = vaa + 46
  const vaaLen = parseAccumulatorUpdate(fromBase64(FX.pnau)).vaa.length;
  const plan = pythPostPlan({
    payer: FX.payer,
    encodedVaa: FX.encodedVaa,
    updateData: fromBase64(FX.pnau),
    treasuryId: FX.treasuryId,
    rentLamports: BigInt((vaaLen + 46 + 128) * 6960),
  });
  const mine = plan.txs.flatMap((t) => t.instructions).map(asFixture);
  const want = [...FX.post, ...FX.close];
  assert.equal(mine.length, want.length);
  mine.forEach((ix, i) => assert.deepEqual(ix, want[i], `instruction ${i}`));
  assert.deepEqual(plan.priceFeedAccounts, { [toHex(SOL_USD_FEED_ID)]: FX.priceFeedAccount });
  assert.equal(plan.publishTime, 1_790_000_000n);
  assert.deepEqual(plan.txs.map((t) => t.instructions.map((i) => i.programId.slice(0, 6))), [
    ["111111", WORMHOLE_RECEIVER_PROGRAM_ID.slice(0, 6), WORMHOLE_RECEIVER_PROGRAM_ID.slice(0, 6)],
    [WORMHOLE_RECEIVER_PROGRAM_ID.slice(0, 6), WORMHOLE_RECEIVER_PROGRAM_ID.slice(0, 6)],
    [PYTH_PUSH_ORACLE_PROGRAM_ID.slice(0, 6), WORMHOLE_RECEIVER_PROGRAM_ID.slice(0, 6)],
  ]);
  assert.deepEqual(plan.txs[0].signers, [FX.payer, FX.encodedVaa]);
  assert.throws(() => pythPostPlan({ payer: FX.payer, encodedVaa: FX.encodedVaa, updateData: fromBase64(FX.pnau), treasuryId: 1, rentLamports: 1n, feedIds: [new Uint8Array(32)] }), /none of the requested/);
});

test("priceUpdatePublishTime reads a Full PriceUpdateV2", () => {
  const d = new Uint8Array(134);
  d[40] = 1;
  new DataView(d.buffer).setBigInt64(93, 1_790_000_123n, true);
  assert.equal(priceUpdatePublishTime(d), 1_790_000_123n);
  d[40] = 0;
  assert.equal(priceUpdatePublishTime(d), null);
});
