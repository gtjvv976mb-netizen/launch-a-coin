import { describe, expect, test } from "bun:test";
import { aggregateCandles, candleInterval, candleIntervalLabel } from "../../src/lib/carddex/candles";

describe("observed market-cap candles", () => {
  test("uses the first, maximum, minimum and last observations in chronological order", () => {
    const samples = [{ t: 55, v: 13 }, { t: 10, v: 10 }, { t: 30, v: 18 }, { t: 45, v: 7 }];
    expect(aggregateCandles(samples, { from: 0, to: 100, interval: 100 })).toEqual([
      { t: 0, end: 100, firstAt: 10, lastAt: 55, open: 10, high: 18, low: 7, close: 13, observations: 4 },
    ]);
    expect(samples[0]).toEqual({ t: 55, v: 13 });
  });

  test("bucket boundaries belong to the following bucket and empty buckets remain gaps", () => {
    const candles = aggregateCandles([{ t: 99, v: 3 }, { t: 100, v: 7 }, { t: 400, v: 2 }], { from: 0, to: 400, interval: 100 });
    expect(candles.map((c) => c.t)).toEqual([0, 100, 400]);
    expect(candles.map((c) => [c.open, c.high, c.low, c.close])).toEqual([[3, 3, 3, 3], [7, 7, 7, 7], [2, 2, 2, 2]]);
  });

  test("simultaneous trades retain sequence and repeated observations do not invent extrema", () => {
    const candles = aggregateCandles([
      { t: 10, v: 8, sequence: 3 }, { t: 10, v: 5, sequence: 1 },
      { t: 10, v: 12, sequence: 2 }, { t: 10, v: 8, sequence: 3 },
    ], { from: 0, to: 100, interval: 100 });
    expect(candles[0]).toMatchObject({ open: 5, high: 12, low: 5, close: 8 });
    expect(aggregateCandles([{ t: 10, v: 4 }, { t: 10, v: 9 }], { from: 0, to: 100, interval: 100 })[0]).toMatchObject({ open: 4, close: 9 });
  });

  test("only includes observed values inside the selected range, including its edges", () => {
    expect(aggregateCandles([{ t: 9, v: 100 }, { t: 10, v: 4 }, { t: 20, v: 7 }, { t: 21, v: 500 }], { from: 10, to: 20, interval: 100 })[0])
      .toMatchObject({ open: 4, high: 7, low: 4, close: 7, observations: 2 });
    expect(aggregateCandles([{ t: 1, v: 10 }], { from: 10, to: 20, interval: 100 })).toEqual([]);
  });

  test("rejects invalid samples and ranges while retaining zero and flat values", () => {
    const invalid = [{ t: NaN, v: 2 }, { t: -1, v: 2 }, { t: 2, v: Infinity }, { t: 3, v: -4 }];
    expect(aggregateCandles(invalid, { from: 0, to: 100, interval: 100 })).toEqual([]);
    expect(aggregateCandles([{ t: 1, v: 0 }, { t: 2, v: 0 }], { from: 0, to: 100, interval: 100 })[0])
      .toMatchObject({ open: 0, high: 0, low: 0, close: 0 });
    for (const range of [{ from: 10, to: 0, interval: 1 }, { from: 0, to: Infinity, interval: 1 }, { from: 0, to: 10, interval: 0 }]) {
      expect(aggregateCandles([{ t: 1, v: 3 }], range)).toEqual([]);
    }
  });

  test("chooses readable intervals without changing observation units", () => {
    expect(candleInterval(3_600_000, 60)).toBe(60_000);
    expect(candleInterval(6 * 3_600_000, 60)).toBe(15 * 60_000);
    expect(candleInterval(86_400_000, 50)).toBe(30 * 60_000);
    expect(candleInterval(0)).toBe(1_000);
    expect(candleInterval(NaN)).toBe(60_000);
    expect(candleIntervalLabel(30_000)).toBe("30s");
    expect(candleIntervalLabel(300_000)).toBe("5m");
    expect(candleIntervalLabel(3_600_000)).toBe("1h");
    expect(candleIntervalLabel(86_400_000)).toBe("1d");
    expect(aggregateCandles([{ t: 1, v: .00007 }, { t: 2, v: .00009 }], { from: 0, to: 10, interval: 10 })[0])
      .toMatchObject({ open: .00007, close: .00009 });
  });
});
