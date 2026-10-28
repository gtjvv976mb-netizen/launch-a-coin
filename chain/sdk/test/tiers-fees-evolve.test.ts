// Tier math (U3 mirror), sale splits (U7 mirror), withdrawable breakdown (L4 formula) and the evolve state
// machine (U4 mirror, scenarios a to h).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEVNET_PRICE,
  levelFor,
  levelMinMcapLamports,
  liveLevel,
  MAX_LEVEL,
  mcapUsdE6,
  TIER_MIN_USD_E6,
  TIER_THRESHOLDS_USD,
  TIERS,
  adminSolUsdE6,
} from "../src/tiers.ts";
import { saleSplits, sellerFeeFloor, withdrawableBreakdown, effectiveFeeBps } from "../src/fees.ts";
import { evolveGap, evolveProgress, evolveStep, fullEvolveCard } from "../src/evolve.ts";
import type { EvolveCard, EvolveParams } from "../src/evolve.ts";
import { ChainCheckError } from "../src/accounts/types.ts";
import { rng } from "./helpers.ts";

test("14 designs: names, level minimums in micro-USD, 13 Config thresholds", () => {
  assert.equal(TIERS.length, MAX_LEVEL);
  assert.equal(TIER_MIN_USD_E6.length, 14);
  assert.equal(TIER_THRESHOLDS_USD.length, 13);
  assert.deepEqual(
    TIERS.map((t) => t.name),
    [
      "Spark",
      "Surge",
      "Nova",
      "Tide",
      "Apex",
      "Ember",
      "Bloom",
      "Mythic",
      "Aurora",
      "Relic",
      "Frost",
      "Regal",
      "Celestial",
      "Legend",
    ]
  );
  assert.equal(TIER_MIN_USD_E6[0], 0n);
  assert.equal(TIER_MIN_USD_E6[1], 15_000_000_000n);
  assert.equal(TIER_MIN_USD_E6[13], 1_000_000_000_000n);
});

test("U3 mirror: level_for at each threshold −1 / 0 / +1 micro-USD", () => {
  TIER_THRESHOLDS_USD.forEach((t, i) => {
    const at = t * 1_000_000n;
    assert.equal(levelFor(at - 1n), i + 1);
    assert.equal(levelFor(at), i + 2);
    assert.equal(levelFor(at + 1n), i + 2);
  });
  assert.equal(levelFor(0n), 1);
  assert.equal(levelFor(10n ** 30n), 14);
});

test("devnet calibration at $118 × 100 matches the card-program-v2 §6 table", () => {
  const sol = (lamports: bigint) => Number(lamports) / 1e9;
  const expect: [number, number][] = [
    [2, 1.27],
    [3, 4.24],
    [4, 8.47],
    [5, 12.71],
    [6, 16.95],
    [8, 33.9],
    [10, 50.85],
    [14, 84.75],
  ];
  for (const [level, s] of expect) {
    const min = levelMinMcapLamports(level, DEVNET_PRICE);
    assert.equal(Math.round(sol(min) * 100) / 100, s, `level ${level}`);
    assert.equal(liveLevel(min, DEVNET_PRICE), level);
    assert.equal(liveLevel(min - 1n, DEVNET_PRICE), level - 1);
  }
  // launch 0.932 SOL = $11.0K → Spark; completion 13.696 SOL → Apex
  assert.equal(mcapUsdE6(931_966_449n, DEVNET_PRICE.solUsdE6, DEVNET_PRICE.mcapMultiplier), 10_997_204_098n);
  assert.equal(liveLevel(931_966_449n, DEVNET_PRICE), 1);
  assert.equal(liveLevel(13_696_005_619n, DEVNET_PRICE), 5);
  assert.throws(() => mcapUsdE6(1n << 100n, 1n << 30n, 1000), ChainCheckError);
});

test("admin price staleness: max age 0 disables the check (devnet)", () => {
  const c = { solUsdE6: 118_000_000n, solUsdUpdatedAt: 1000n, maxPriceAgeSecs: 0 };
  assert.equal(adminSolUsdE6(c, 10n ** 12n), 118_000_000n);
  assert.throws(() => adminSolUsdE6({ ...c, maxPriceAgeSecs: 60 }, 1061n), ChainCheckError);
  assert.equal(adminSolUsdE6({ ...c, maxPriceAgeSecs: 60 }, 1060n), 118_000_000n);
});

test("U7 mirror: 10k sale splits sum to the price; royalty 0 when the launcher sells", () => {
  const r = rng(7);
  for (let i = 0; i < 10_000; i++) {
    const price = 30_000_000n + r.bigint(1_000_000_000_000n - 30_000_000n + 1n);
    const launcherSells = i % 7 === 0;
    const s = saleSplits(price, 250, 500, launcherSells);
    assert.equal(s.protocolFee + s.royalty + s.sellerNet, price);
    assert.equal(s.protocolFee, (price * 250n) / 10_000n);
    assert.equal(s.royalty, launcherSells ? 0n : (price * 500n) / 10_000n);
  }
  // devnet min_bid: both fee legs ≥ rent(0) = 650,240
  const atMin = saleSplits(30_000_000n, 250, 500, false);
  assert.equal(atMin.protocolFee, 750_000n);
  assert.equal(atMin.royalty, 1_500_000n);
  assert.equal(effectiveFeeBps(250, 500, true), 250);
  assert.equal(effectiveFeeBps(250, 500, false), 750);
});

test("withdrawable breakdown follows §8 and the L4 formula (curve + AMM legs netted in pump's vault)", () => {
  const rent0 = 650_240n;
  // coin 2 today: vault at rent, pump creator vault 709,500
  const c2 = withdrawableBreakdown({
    vaultLamports: 650_240n,
    pumpCreatorVaultLamports: 709_500n,
    ammVaultAtaAmount: null,
    vaultWsolAccountLamports: [],
    rent0,
  });
  assert.equal(c2.total, 59_260n);
  assert.equal(c2.topUp, 0n);
  // coin 1: vault 16,421,687 → 15,771,447 (card-program-v2 §13 step 9)
  const c1 = withdrawableBreakdown({
    vaultLamports: 16_421_687n,
    pumpCreatorVaultLamports: 650_240n,
    ammVaultAtaAmount: 0n,
    vaultWsolAccountLamports: [],
    rent0,
  });
  assert.equal(c1.total, 15_771_447n);
  // empty vault: the holder pays the one-time top-up
  const fresh = withdrawableBreakdown({
    vaultLamports: 0n,
    pumpCreatorVaultLamports: 2_000_000n,
    ammVaultAtaAmount: null,
    vaultWsolAccountLamports: [],
    rent0,
  });
  assert.equal(fresh.topUp, rent0);
  assert.equal(fresh.total, 2_000_000n - rent0);
  assert.equal(fresh.netToHolder, 2_000_000n - 2n * rent0);
  // AMM fees with a pump vault below rent: netted, not double counted
  const amm = withdrawableBreakdown({
    vaultLamports: rent0,
    pumpCreatorVaultLamports: 0n,
    ammVaultAtaAmount: 1_000_000n,
    vaultWsolAccountLamports: [2_000_000n],
    rent0,
    tokenAccountRent: 1_488_440n,
  });
  assert.equal(amm.total, 1_000_000n - rent0 + 2_000_000n);
  assert.equal(amm.ammLegMaybeSkipped, false); // L7: pAMM transfers balances below token-account rent too
});

test("sellerFeeFloor is the sale's fees_to_seller right now (card-program-v2 §18.9, audit A1)", () => {
  const rent0 = 890_880n; // local rent, the A1 numbers
  const accrued = {
    vaultLamports: rent0,
    pumpCreatorVaultLamports: rent0,
    ammVaultAtaAmount: 2_962_963n,
    vaultWsolAccountLamports: [],
    rent0,
  };
  assert.equal(sellerFeeFloor(accrued), withdrawableBreakdown(accrued).total);
  assert.equal(sellerFeeFloor(accrued), 2_962_963n);
  // after a hide (pAMM collect_coin_creator_fee into a fresh 165-byte WSOL account owned by the vault) the same fees
  // sit in that account: the floor counts its lamports once it is listed among the vault-owned WSOL accounts
  const hidden = { ...accrued, ammVaultAtaAmount: 0n, vaultWsolAccountLamports: [2_039_280n + 2_962_963n] };
  assert.equal(sellerFeeFloor(hidden), 2_962_963n + 2_039_280n);
  // ...and a sale that leaves it out pays less than the floor the seller signed (the program then fails it)
  assert.ok(sellerFeeFloor({ ...hidden, vaultWsolAccountLamports: [] }) < sellerFeeFloor(accrued));
});

// ---------------------------------------------------------------- evolve (U4 mirror)

const P: EvolveParams = { holdSlots: 150, minObs: 3, maxStep: 2 };
const fresh = (level = 1): EvolveCard => ({
  level,
  pendingLevel: 0,
  pendingObs: 0,
  pendingSinceSlot: 0n,
  pendingLastSlot: 0n,
});
function run(card: EvolveCard, obs: [number, number][]) {
  let c = card;
  const events = [];
  for (const [slot, live] of obs) {
    const r = evolveStep(c, live, BigInt(slot), P);
    c = r.card;
    events.push(...r.events);
  }
  return { card: c, events };
}

test("U4 (a): a steady rise confirms only after 3 spaced observations and ≥ 150 slots", () => {
  assert.equal(evolveGap(P), 37n);
  const early = run(fresh(), [
    [1000, 3],
    [1037, 3],
    [1074, 3],
  ]);
  assert.equal(early.card.level, 1, "3 observations but only 74 slots");
  assert.equal(early.card.pendingObs, 3);
  const done = run(early.card, [[1150, 3]]);
  assert.equal(done.card.level, 3);
  assert.equal(done.card.pendingLevel, 0);
  const two = run(fresh(), [
    [1000, 3],
    [1150, 3],
  ]);
  assert.equal(two.card.level, 1, "150 slots but only 2 observations");
  assert.equal(run(two.card, [[1187, 3]]).card.level, 3);
});

test("U4 (b) a dip clears pending; (h) live ≤ level is a no-op", () => {
  const r = run(fresh(), [
    [1000, 3],
    [1040, 1],
  ]);
  assert.equal(r.card.pendingLevel, 0);
  assert.ok(r.events.some((e) => e.kind === "EvolvePendingCleared" && e.reason === "dip"));
  const noop = evolveStep(fresh(4), 4, 5000n, P);
  assert.deepEqual(noop.card, fullEvolveCard(fresh(4)));
  assert.deepEqual(noop.events, []);
});

test("U4 (c): a lower observation lowers pending and the confirm uses the minimum", () => {
  const r = run(fresh(), [
    [1000, 5],
    [1040, 2],
    [1080, 5],
    [1150, 5],
  ]);
  assert.equal(r.card.level, 2);
});

test("U4 (d): a pending level expires after 4 × hold", () => {
  const r = run(fresh(), [
    [1000, 3],
    [1601, 3],
  ]);
  assert.ok(r.events.some((e) => e.kind === "EvolvePendingCleared" && e.reason === "expired"));
  assert.equal(r.card.pendingSinceSlot, 1601n, "restarted");
  assert.equal(r.card.pendingObs, 1);
  const notYet = run(fresh(), [
    [1000, 3],
    [1600, 3],
  ]);
  assert.equal(notYet.card.level, 1, "only 2 counted observations");
  assert.equal(notYet.card.pendingSinceSlot, 1000n);
});

test("U4 (e): +2 cap per confirm, climbing continues in the next window", () => {
  const r1 = run(fresh(), [
    [1000, 7],
    [1040, 7],
    [1150, 7],
  ]);
  assert.equal(r1.card.level, 3);
  assert.equal(r1.card.pendingLevel, 7, "a new window starts at the confirm");
  assert.equal(r1.card.pendingSinceSlot, 1150n);
  const r2 = run(r1.card, [
    [1190, 7],
    [1230, 7],
    [1300, 7],
  ]);
  assert.equal(r2.card.level, 5);
});

test("U4 (f): observe → sell → observe-high → confirm attack fails", () => {
  const r = run(fresh(), [
    [1000, 5],
    [1040, 1],
    [1150, 5],
  ]);
  assert.equal(r.card.level, 1);
  assert.equal(r.card.pendingSinceSlot, 1150n);
  assert.equal(r.card.pendingObs, 1);
});

test("U4 (g): observations closer than the gap do not count", () => {
  const r = run(fresh(), [
    [1000, 3],
    [1030, 3],
    [1150, 3],
  ]);
  assert.equal(r.card.level, 1);
  assert.equal(r.card.pendingObs, 2);
  const ok = run(fresh(), [
    [1000, 3],
    [1036, 3],
    [1072, 3],
    [1150, 3],
  ]);
  assert.equal(ok.card.level, 3);
  const prog = evolveProgress(run(fresh(), [[1000, 3]]).card, 1060n, P)!;
  assert.deepEqual(prog, {
    pendingLevel: 3,
    obs: 1,
    obsNeeded: 3,
    slotsLeft: 90n,
    expiresAtSlot: 1600n,
    witnesses: 0,
    witnessesNeeded: 0,
    pausedUntilSlot: 1060n + 60n,
  });
});
