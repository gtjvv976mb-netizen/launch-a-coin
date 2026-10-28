// Shared vectors with chain/programs/mintdex/src/evolve.rs (fix-plan §2.3): U4a to U4n, F2a to F2h, the ignore rule and
// a reference fuzz. Every literal below is the Rust test's, so a drift between the program and this mirror fails here.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WHO_CAP,
  WHO_OPEN,
  countCallIgnored,
  lowerOnIgnored,
  evolveCardOf,
  evolveGap,
  evolveProgress,
  evolveStep,
  fullEvolveCard,
  listingPausedUntilSlot,
  listingVoided,
  unlockingAbove,
  whoCount,
} from "../src/evolve.ts";
import type { EvolveCard, EvolveOutcome, EvolveParams, EvolveWho } from "../src/evolve.ts";

const P: EvolveParams = { holdSlots: 150, minObs: 3, maxStep: 2, minObservers: 0, epoch: 0 };
const A: EvolveParams = { ...P, minObservers: 1, epoch: 1 };
const CRANK = whoCount(0); // bit 1
const STANDBY = whoCount(1); // bit 2

type W = Required<EvolveCard>;
const card = (level: number): W => fullEvolveCard({ level, pendingLevel: 0, pendingObs: 0, pendingSinceSlot: 0n, pendingLastSlot: 0n });
const five = (w: W) => [w.level, w.pendingLevel, w.pendingObs, w.pendingSinceSlot, w.pendingLastSlot];
const NONE: EvolveOutcome = { expired: false, dipCleared: false, observed: null, evolved: null };

/** Mutating runner like the Rust `run_as`: returns the outcomes and leaves the final window in `box.w`. */
function runAs(box: { w: W }, p: EvolveParams, who: EvolveWho, obs: Array<[number, number]>): EvolveOutcome[] {
  return obs.map(([slot, live]) => {
    const r = evolveStep(box.w, live, BigInt(slot), p, who);
    box.w = r.card;
    return r.outcome;
  });
}
const run = (box: { w: W }, obs: Array<[number, number]>) => runAs(box, P, WHO_OPEN, obs);
const step = (box: { w: W }, live: number, slot: number, p: EvolveParams, who: EvolveWho) => {
  const r = evolveStep(box.w, live, BigInt(slot), p, who);
  box.w = r.card;
  return r.outcome;
};

/** The Rust test XorShift (test_utils.rs) is not needed bit for bit: the fuzz checks invariants, not outputs. */
function xorshift(seed: number) {
  let x = BigInt(seed) || 1n;
  return () => {
    x ^= (x << 13n) & 0xffffffffffffffffn;
    x ^= x >> 7n;
    x ^= (x << 17n) & 0xffffffffffffffffn;
    return Number(x & 0xffffffffn);
  };
}

test("gap is hold / (k + 1)", () => {
  assert.equal(evolveGap(P), 37n);
  assert.equal(evolveGap({ ...P, holdSlots: 9_000, minObs: 3 }), 2_250n);
  assert.equal(evolveGap({ ...P, holdSlots: 9_000, minObs: 8 }), 1_000n);
});

test("U4a a steady rise confirms only after 3 spaced obs and the hold", () => {
  const b = { w: card(1) };
  let o = run(b, [[1_000, 3]]);
  assert.deepEqual(o[0].observed, [3, 1]);
  assert.deepEqual([b.w.pendingLevel, b.w.pendingSinceSlot], [3, 1_000n]);
  o = run(b, [
    [1_040, 3],
    [1_080, 3],
  ]);
  assert.deepEqual(o[1].observed, [3, 3]);
  assert.ok(o.every((x) => x.evolved === null));
  assert.equal(run(b, [[1_149, 3]])[0].evolved, null);
  o = run(b, [[1_150, 3]]);
  assert.deepEqual(o[0].evolved, [1, 3]);
  assert.deepEqual(b.w, card(3));
  const h = { w: card(1) };
  const o2 = run(h, [
    [0, 3],
    [200, 3],
  ]);
  assert.deepEqual(o2[1].observed, [3, 2]);
  assert.deepEqual(run(h, [[240, 3]])[0].evolved, [1, 3]);
});

test("U4b a dip clears pending", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 3],
    [40, 3],
  ]);
  const o = run(b, [[80, 1]]);
  assert.ok(o[0].dipCleared);
  assert.equal(o[0].observed, null);
  assert.deepEqual(five(b.w), five(card(1)));
  const o2 = run(b, [
    [120, 3],
    [160, 3],
    [200, 3],
    [269, 3],
  ]);
  assert.ok(o2.every((x) => x.evolved === null));
  assert.deepEqual(run(b, [[270, 3]])[0].evolved, [1, 3]);
});

test("U4c a lower observation lowers pending; the confirm uses the minimum", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 5],
    [40, 2],
    [80, 5],
  ]);
  assert.deepEqual([b.w.pendingLevel, b.w.pendingSinceSlot], [2, 0n]);
  assert.deepEqual(run(b, [[150, 5]])[0].evolved, [1, 2]);
  assert.deepEqual([b.w.level, b.w.pendingLevel, b.w.pendingObs, b.w.pendingSinceSlot], [2, 5, 1, 150n]);
});

test("U4d pending expires after 4 x hold", () => {
  const b = { w: card(1) };
  run(b, [[0, 3]]);
  let o = run(b, [[600, 3]]);
  assert.ok(!o[0].expired);
  assert.deepEqual(o[0].observed, [3, 2]);
  const b2 = { w: card(1) };
  run(b2, [[0, 3]]);
  o = run(b2, [[601, 3]]);
  assert.ok(o[0].expired);
  assert.deepEqual(o[0].observed, [3, 1]);
  assert.deepEqual([b2.w.pendingSinceSlot, b2.w.pendingObs], [601n, 1]);
  const b3 = { w: card(1) };
  run(b3, [
    [0, 5],
    [40, 5],
  ]);
  o = run(b3, [[10_000, 5]]);
  assert.ok(o[0].expired && o[0].evolved === null);
  const b4 = { w: card(1) };
  run(b4, [[0, 5]]);
  o = run(b4, [[1_000, 1]]);
  assert.ok(o[0].expired && !o[0].dipCleared);
  assert.deepEqual(five(b4.w), five(card(1)));
});

test("U4e +2 cap per confirm, then climbing continues in the next window", () => {
  const b = { w: card(1) };
  let o = run(b, [
    [0, 9],
    [40, 9],
    [80, 9],
    [150, 9],
  ]);
  assert.deepEqual(o[3].evolved, [1, 3]);
  assert.deepEqual([b.w.level, b.w.pendingLevel, b.w.pendingSinceSlot, b.w.pendingObs], [3, 9, 150n, 1]);
  o = run(b, [
    [190, 9],
    [230, 9],
    [299, 9],
    [300, 9],
  ]);
  assert.equal(o[2].evolved, null);
  assert.deepEqual(o[3].evolved, [3, 5]);
  o = run(b, [
    [340, 9],
    [380, 9],
    [450, 9],
  ]);
  assert.deepEqual(o[2].evolved, [5, 7]);
  o = run(b, [
    [490, 8],
    [530, 8],
    [600, 8],
  ]);
  assert.deepEqual(o[2].evolved, [7, 8]);
  assert.deepEqual(b.w, card(8));
  o = run(b, [[700, 1]]);
  assert.deepEqual(o[0], NONE);
  assert.equal(b.w.level, 8);
});

test("U4f observe, sell, observe high, confirm: the attack fails", () => {
  const b = { w: card(1) };
  const o = run(b, [
    [0, 5],
    [10, 1],
    [40, 5],
    [55, 1],
    [80, 5],
    [120, 1],
    [150, 5],
  ]);
  assert.ok(o.every((x) => x.evolved === null));
  assert.deepEqual([b.w.level, b.w.pendingLevel, b.w.pendingObs, b.w.pendingSinceSlot], [1, 5, 1, 150n]);
  const b2 = { w: card(1) };
  const o2 = run(b2, [
    [0, 5],
    [40, 5],
    [80, 5],
    [150, 1],
  ]);
  assert.ok(o2.every((x) => x.evolved === null));
  assert.deepEqual(five(b2.w), five(card(1)));
});

test("U4g observations closer than the gap do not count", () => {
  const b = { w: card(1) };
  const o = run(b, [
    [0, 3],
    [36, 3],
    [37, 3],
    [73, 3],
    [74, 3],
  ]);
  assert.deepEqual(
    o.map((x) => x.observed![1]),
    [1, 1, 2, 2, 3],
  );
  assert.equal(b.w.pendingLastSlot, 74n);
  const b2 = { w: card(1) };
  const o2 = run(b2, [
    [0, 3],
    [0, 3],
    [0, 3],
    [150, 3],
  ]);
  assert.deepEqual(o2[2].observed, [3, 1]);
  assert.deepEqual(o2[3].observed, [3, 2]);
  assert.equal(o2[3].evolved, null);
  const b3 = { w: card(1) };
  assert.deepEqual(
    run(b3, [
      [0, 5],
      [1, 3],
    ])[1].observed,
    [3, 1],
  );
});

test("U4h live at or below the level is a no-op", () => {
  const b = { w: card(4) };
  for (const live of [1, 2, 3, 4]) {
    const before = b.w;
    assert.deepEqual(step(b, live, 1_000, P, WHO_OPEN), NONE);
    assert.deepEqual(b.w, before);
  }
});

test("U4i cap calls cannot start, count or confirm", () => {
  let b = { w: card(1) };
  const o = runAs(b, A, WHO_CAP, [
    [0, 5],
    [40, 5],
    [200, 5],
  ]);
  assert.ok(o.every((x) => JSON.stringify(x) === JSON.stringify(NONE)));
  assert.deepEqual(b.w, card(1));
  b = { w: card(1) };
  runAs(b, A, CRANK, [[0, 5]]);
  const o2 = runAs(b, A, WHO_CAP, [
    [40, 5],
    [80, 5],
    [150, 5],
    [200, 5],
  ]);
  assert.ok(o2.every((x) => x.evolved === null));
  assert.deepEqual([b.w.pendingObs, b.w.pendingLastSlot, b.w.observers], [1, 0n, 1]);
  assert.deepEqual(runAs(b, A, WHO_CAP, [[210, 3]])[0].observed, [3, 1]);
  assert.equal(b.w.pendingLevel, 3);
  assert.ok(runAs(b, A, WHO_CAP, [[220, 1]])[0].dipCleared);
  assert.equal(b.w.pendingLevel, 0);
  b = { w: card(1) };
  runAs(b, A, CRANK, [
    [0, 5],
    [40, 5],
    [80, 5],
  ]);
  assert.equal(runAs(b, A, WHO_CAP, [[150, 5]])[0].evolved, null);
  assert.deepEqual(runAs(b, A, CRANK, [[151, 5]])[0].evolved, [1, 3]);
});

test("U4j witness bits and min_observers", () => {
  const two: EvolveParams = { ...A, minObservers: 2 };
  const b = { w: card(1) };
  runAs(b, two, CRANK, [
    [0, 5],
    [40, 5],
    [80, 5],
  ]);
  assert.equal(b.w.observers, 1);
  assert.equal(runAs(b, two, CRANK, [[150, 5]])[0].evolved, null);
  assert.deepEqual(runAs(b, two, STANDBY, [[151, 5]])[0].evolved, [1, 3]);
  assert.deepEqual([b.w.pendingLevel, b.w.observers, b.w.epoch], [5, 2, 1]);
  runAs(b, two, CRANK, [[160, 5]]);
  assert.equal(b.w.observers, 3);
  runAs(b, two, WHO_CAP, [[170, 3]]);
  assert.deepEqual([b.w.pendingLevel, b.w.observers, b.w.epoch], [0, 0, 0]);
  runAs(b, two, STANDBY, [[180, 5]]);
  assert.equal(b.w.observers, 2);
  runAs(b, two, CRANK, [[180 + 601, 5]]);
  assert.equal(b.w.observers, 1, "expired, restarted by the crank");
  const o = { w: card(1) };
  assert.deepEqual(
    run(o, [
      [0, 3],
      [40, 3],
      [150, 3],
    ])[2].evolved,
    [1, 3],
  );
});

test("U4k bundle self-observations confirm in open mode and never open in attested mode", () => {
  const slots: Array<[number, number]> = Array.from({ length: 16 }, (_, i) => [i * 38, 5]);
  const b = { w: card(1) };
  assert.ok(run(b, slots).some((x) => JSON.stringify(x.evolved) === "[1,3]"));
  const a = { w: card(1) };
  const o = runAs(a, A, WHO_CAP, slots);
  assert.ok(o.every((x) => x.evolved === null && x.observed === null));
  assert.deepEqual(a.w, card(1));
});

test("U4l leaked COUNT key vs the watcher's clears", () => {
  const b = { w: card(1) };
  const r = xorshift(41);
  for (let i = 0; i < 40; i++) {
    const s = i * 38;
    step(b, 5, s, A, CRANK);
    step(b, 1, s + 1 + (r() % 36), A, WHO_CAP);
  }
  assert.equal(b.w.level, 1);
  const c = { w: card(1) };
  for (let i = 0; i < 5; i++) step(c, 5, i * 38, A, CRANK);
  assert.equal(c.w.level, 3);
});

test("U4m reference fuzz: level never decreases, confirms are bounded, cap calls never raise", () => {
  const r = xorshift(2026);
  for (let seq = 0; seq < 3_000; seq++) {
    const attested = seq % 2 === 1;
    const p: EvolveParams = {
      holdSlots: 150,
      minObs: 2 + (r() % 3),
      maxStep: 1 + (r() % 3),
      minObservers: attested ? 1 + (r() % 2) : 0,
      epoch: attested ? 1 + (r() % 3) : 0,
    };
    const b = { w: card(1 + (r() % 3)) };
    let slot = r() % 100;
    for (let k = 0; k < 60; k++) {
      slot += r() % 60;
      const live = 1 + (r() % 14);
      const who: EvolveWho = !attested ? WHO_OPEN : [WHO_CAP, CRANK, STANDBY][r() % 3];
      const before = b.w;
      const o = step(b, live, slot, p, who);
      assert.ok(b.w.level >= before.level, "level decreased");
      if (o.evolved) {
        const [from, to] = o.evolved;
        assert.ok(to > from && to <= from + p.maxStep, "confirm bound");
        assert.ok(to <= live);
        assert.notEqual(who.kind, "cap");
        assert.ok(before.pendingObs + 1 >= p.minObs);
        assert.ok(BigInt(slot) >= before.pendingSinceSlot + 150n);
      } else {
        assert.equal(b.w.level, before.level);
      }
      if (who.kind === "cap") {
        assert.ok(b.w.pendingObs <= before.pendingObs, "a cap call counted");
        assert.ok(b.w.pendingLevel <= before.pendingLevel, "a cap call raised or opened a window");
      }
    }
  }
});

test("U4n epoch restart", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 5],
    [40, 5],
    [80, 5],
  ]);
  assert.deepEqual([b.w.pendingObs, b.w.observers, b.w.epoch], [3, 0, 0]);
  assert.equal(runAs(b, A, CRANK, [[150, 5]])[0].evolved, null, "no inherited open-mode counts");
  assert.deepEqual([b.w.pendingSinceSlot, b.w.pendingObs, b.w.observers, b.w.epoch], [150n, 1, 1, 1]);
  runAs(b, A, CRANK, [
    [190, 5],
    [230, 5],
  ]);
  assert.equal(b.w.pendingObs, 3);
  assert.equal(runAs(b, { ...A, epoch: 2 }, CRANK, [[300, 5]])[0].evolved, null);
  assert.deepEqual([b.w.pendingSinceSlot, b.w.pendingObs, b.w.epoch], [300n, 1, 2]);
  runAs(b, { ...A, epoch: 3 }, WHO_CAP, [[310, 4]]);
  assert.deepEqual([b.w.pendingSinceSlot, b.w.pendingLevel, b.w.epoch], [300n, 4, 2]);
});

test("R2 a window opened before the last EVOLVE unpause restarts (evolve.rs r2_pause_restarts_windows)", () => {
  const b = { w: card(1) };
  runAs(b, A, CRANK, [[0, 5], [40, 5]]);
  assert.equal(b.w.pendingObs, 2);
  const resumed: EvolveParams = { ...A, resumedSlot: 100n };
  const o = runAs(b, resumed, CRANK, [[160, 5]]);
  assert.ok(o[0].expired);
  assert.equal(o[0].evolved, null);
  assert.deepEqual([b.w.pendingLevel, b.w.pendingObs, b.w.pendingSinceSlot], [5, 1, 160n]);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [5, 310n]);
  assert.equal(runAs(b, resumed, CRANK, [[200, 5], [240, 5]])[1].evolved, null);
  assert.deepEqual(runAs(b, resumed, CRANK, [[310, 5]])[0].evolved, [1, 3]);
  // a Cap call after the unpause drops the stale window and opens nothing
  const c = { w: card(1) };
  runAs(c, A, CRANK, [[0, 5]]);
  const oc = runAs(c, resumed, WHO_CAP, [[150, 5]]);
  assert.ok(oc[0].expired && oc[0].observed === null);
  assert.equal(c.w.pendingLevel, 0);
  // open mode follows the same rule
  const op = { w: card(1) };
  run(op, [[0, 3], [40, 3], [80, 3]]);
  const oo = step(op, 3, 150, { ...P, resumedSlot: 90n }, WHO_OPEN);
  assert.ok(oo.expired && oo.evolved === null);
  // a window opened at or after the unpause is untouched; no resumedSlot changes nothing
  const n = { w: card(1) };
  runAs(n, resumed, CRANK, [[100, 5], [140, 5], [180, 5]]);
  assert.deepEqual(runAs(n, resumed, CRANK, [[250, 5]])[0].evolved, [1, 3]);
  const z = { w: card(1) };
  runAs(z, A, CRANK, [[0, 5], [40, 5], [80, 5]]);
  assert.deepEqual(runAs(z, A, CRANK, [[150, 5]])[0].evolved, [1, 3]);
});

test("R2 an ignored counting call lowers the pending level to its cap (evolve.rs r2_ignored_call_lowers_to_its_cap)", () => {
  const b = { w: card(1) };
  runAs(b, A, CRANK, [[0, 5], [40, 5]]);
  const before = b.w;
  assert.ok(countCallIgnored(CRANK, 3, b.w.level, 2));
  const l = lowerOnIgnored(b.w, 3);
  assert.ok(l.changed);
  assert.deepEqual(l.card, { ...before, pendingLevel: 3 });
  b.w = l.card;
  for (const cap of [3, 4, 9, 1]) {
    const r = lowerOnIgnored(b.w, cap);
    assert.equal(r.changed, false);
    assert.deepEqual(r.card, b.w);
  }
  assert.equal(lowerOnIgnored(card(1), 3).changed, false);
  const wide: EvolveParams = { ...A, maxStep: 4 };
  const unlowered = { w: before };
  assert.deepEqual(runAs(unlowered, wide, CRANK, [[80, 5], [150, 5]])[1].evolved, [1, 5]);
  assert.deepEqual(runAs(b, wide, CRANK, [[80, 5], [150, 5]])[1].evolved, [1, 3]);
});

test("ignore rule truth table", () => {
  for (const [cap, level, onchain] of [
    [1, 1, 1],
    [3, 3, 1],
    [2, 3, 9],
  ]) {
    assert.ok(!countCallIgnored(CRANK, cap, level, onchain));
  }
  assert.ok(countCallIgnored(CRANK, 5, 1, 4));
  assert.ok(countCallIgnored(CRANK, 5, 1, 1));
  assert.ok(!countCallIgnored(CRANK, 5, 1, 5));
  assert.ok(!countCallIgnored(CRANK, 5, 1, 9));
  assert.ok(!countCallIgnored(WHO_CAP, 5, 1, 1));
  assert.ok(!countCallIgnored(WHO_OPEN, 5, 1, 1));
});

test("F2a a dip arms clamp(held, gap, hold)", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 3],
    [40, 3],
  ]);
  assert.ok(run(b, [[80, 1]])[0].dipCleared);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [3, 160n]);
  assert.ok(unlockingAbove(b.w, 1, 160n));
  assert.ok(!unlockingAbove(b.w, 1, 161n));
  assert.ok(!unlockingAbove(b.w, 3, 100n));
  const blip = { w: card(1) };
  run(blip, [
    [1_000, 3],
    [1_001, 1],
  ]);
  assert.equal(blip.w.hwmUntil, 1_001n + 37n);
  const l = { w: card(1) };
  run(l, [
    [0, 3],
    [40, 3],
    [100, 3],
  ]);
  l.w = { ...l.w, pendingObs: 1 };
  run(l, [[500, 1]]);
  assert.equal(l.w.hwmUntil, 650n);
});

test("F2b the mark keeps the max and survives further dips", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 5],
    [40, 3],
    [60, 1],
  ]);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [3, 120n]);
  run(b, [
    [70, 6],
    [75, 1],
  ]);
  assert.equal(b.w.hwmLevel, 6);
  assert.equal(b.w.hwmUntil, 120n > 112n ? 120n : 112n);
  const before = b.w;
  run(b, [[80, 1]]);
  assert.deepEqual(b.w, before);
});

test("F2c a confirm resets the mark", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 4],
    [10, 1],
  ]);
  assert.equal(b.w.hwmLevel, 4);
  const o = run(b, [
    [20, 4],
    [60, 4],
    [100, 4],
    [170, 4],
  ]);
  assert.deepEqual(o[3].evolved, [1, 3]);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [0, 0n]);
  assert.equal(b.w.pendingLevel, 4);
});

test("F2d lapse, then a fresh episode", () => {
  const b = { w: card(1) };
  run(b, [
    [0, 7],
    [50, 1],
  ]);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [7, 100n]);
  run(b, [[101, 3]]);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [0, 0n]);
  run(b, [[120, 1]]);
  assert.equal(b.w.hwmLevel, 3);
});

test("F2e a pre-upgrade window is adopted", () => {
  const b = { w: fullEvolveCard({ level: 1, pendingLevel: 4, pendingObs: 2, pendingSinceSlot: 100n, pendingLastSlot: 140n }) };
  run(b, [[200, 1]]);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [4, 300n]);
});

test("F2f expiry arms a full hold", () => {
  const b = { w: card(1) };
  run(b, [[0, 5]]);
  const o = run(b, [[601, 1]]);
  assert.ok(o[0].expired && !o[0].dipCleared);
  assert.deepEqual([b.w.hwmLevel, b.w.hwmUntil], [5, 751n]);
  const x = { w: card(1) };
  run(x, [[0, 5]]);
  run(x, [[700, 6]]);
  assert.deepEqual([x.w.hwmLevel, x.w.hwmUntil, x.w.pendingLevel], [5, 850n, 6]);
});

test("F2g a cap clear arms like any dip", () => {
  const b = { w: card(1) };
  runAs(b, A, CRANK, [
    [0, 5],
    [40, 5],
    [80, 5],
  ]);
  runAs(b, A, WHO_CAP, [[100, 1]]);
  assert.deepEqual([b.w.pendingLevel, b.w.hwmLevel, b.w.hwmUntil], [0, 5, 200n]);
});

test("F2h random sequences keep the pause inside every armed TTL unless a confirm happened", () => {
  const r = xorshift(99);
  const gap = 37n;
  const hold = 150n;
  for (let n = 0; n < 2_000; n++) {
    const b = { w: card(1) };
    let slot = 0n;
    let armed: [number, bigint] | null = null;
    for (let k = 0; k < 30; k++) {
      slot += BigInt(r() % 80);
      const live = 1 + (r() % 6);
      const before = b.w;
      const o = evolveStep(b.w, live, slot, P).outcome;
      b.w = evolveStep(before, live, slot, P).card;
      if (o.evolved) {
        armed = null;
        continue;
      }
      if (o.dipCleared || o.expired) {
        const held = slot - before.pendingSinceSlot;
        const ttl = o.dipCleared && !o.expired ? (held < gap ? gap : held > hold ? hold : held) : hold;
        const lvl = before.pendingLevel;
        armed = armed && slot <= armed[1] ? [Math.max(armed[0], lvl), armed[1] > slot + ttl ? armed[1] : slot + ttl] : [lvl, slot + ttl];
      }
      if (armed && slot <= armed[1] && armed[0] > b.w.level) {
        for (const t of [slot, (slot + armed[1]) / 2n, armed[1]]) assert.ok(unlockingAbove(b.w, b.w.level, t), "pause dropped inside the armed ttl");
      }
    }
  }
});

test("listing rules: VOID listings voided by level, mark, pending and PAUSE_EVOLVE; plain listings never", () => {
  const w = fullEvolveCard({ level: 2, pendingLevel: 0, pendingObs: 0, pendingSinceSlot: 0n, pendingLastSlot: 0n, hwmLevel: 4, hwmUntil: 500n });
  const voidL = { levelAtList: 2, flags: 1 };
  const plain = { levelAtList: 2, flags: 0 };
  assert.ok(listingVoided(voidL, w, 500n, 0), "mark active at until");
  assert.ok(!listingVoided(voidL, w, 501n, 0), "lapsed at until + 1");
  assert.ok(listingVoided(voidL, w, 501n, 2), "PAUSE_EVOLVE voids VOID listings");
  assert.ok(!listingVoided(plain, w, 400n, 2), "plain listings ignore the mark and the pause");
  assert.ok(listingVoided({ levelAtList: 1, flags: 1 }, w, 600n, 0), "level moved");
  const pending = { ...w, hwmLevel: 0, hwmUntil: 0n, pendingLevel: 3, pendingObs: 1, pendingSinceSlot: 1_000n, pendingLastSlot: 1_000n };
  assert.ok(listingVoided(voidL, pending, 1_010n, 0));
  // paused-until: a fresh window pauses at least one gap, a long one at most a hold
  assert.equal(listingPausedUntilSlot(voidL, pending, 1_010n, P), 1_010n + 37n);
  assert.equal(listingPausedUntilSlot(voidL, pending, 1_500n, P), 1_500n + 150n);
  assert.equal(listingPausedUntilSlot(voidL, w, 400n, P), 500n);
  assert.equal(listingPausedUntilSlot(voidL, w, 501n, P), null);
  assert.equal(listingPausedUntilSlot(plain, pending, 1_010n, P), null);
});

test("evolveCardOf reads the decoded Card (old cards without the fix-pack fields read 0)", () => {
  const old = evolveCardOf({ level: 2, pending_level: 3, pending_obs: 1, pending_since_slot: 10n, pending_last_slot: 10n });
  assert.deepEqual([old.hwmUntil, old.hwmLevel, old.observers, old.epoch], [0n, 0, 0, 0]);
  const now = evolveCardOf({
    level: 2,
    pending_level: 3,
    pending_obs: 1,
    pending_since_slot: 10n,
    pending_last_slot: 10n,
    pending_hwm_until: 99n,
    pending_hwm_level: 4,
    pending_observers: 3,
    pending_epoch: 2,
  });
  assert.deepEqual([now.hwmUntil, now.hwmLevel, now.observers, now.epoch], [99n, 4, 3, 2]);
  const prog = evolveProgress(now, 20n, A)!;
  assert.deepEqual([prog.witnesses, prog.witnessesNeeded, prog.pausedUntilSlot], [2, 1, 20n + 37n]);
});
