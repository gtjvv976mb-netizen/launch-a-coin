/** An observed post-trade market-cap value, in one consistent quote unit. */
export type MarketCapSample = {
  t: number;
  v: number;
  /** Trade sequence resolves simultaneous observations; it is not volume. */
  sequence?: number;
};

export type MarketCapCandle = {
  t: number;
  end: number;
  firstAt: number;
  lastAt: number;
  open: number;
  high: number;
  low: number;
  close: number;
  observations: number;
};

const INTERVALS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 3 * 60_000, 5 * 60_000,
  15 * 60_000, 30 * 60_000, 60 * 60_000, 3 * 60 * 60_000,
  6 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000,
  3 * 24 * 60 * 60_000, 7 * 24 * 60 * 60_000, 30 * 24 * 60 * 60_000,
];

/** Keep candles legible at the measured plot width, without changing their values. */
export function candleInterval(duration: number, target = 50): number {
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(target) || target < 1) return 60_000;
  const ideal = Math.max(1_000, duration / target);
  return INTERVALS.find((interval) => interval >= ideal)
    ?? Math.ceil(ideal / INTERVALS[INTERVALS.length - 1]) * INTERVALS[INTERVALS.length - 1];
}

/**
 * OHLC is taken only from actual observations inside the requested inclusive range.
 * Empty buckets stay empty. We never carry a prior close into an open, add a launch
 * baseline, repeat a value at "now", or infer a high/low between observations.
 */
export function aggregateCandles(
  samples: readonly MarketCapSample[],
  { from, to, interval }: { from: number; to: number; interval: number },
): MarketCapCandle[] {
  if (![from, to, interval].every(Number.isFinite) || from > to || interval <= 0) return [];
  const sorted = samples
    .map((sample, index) => ({ ...sample, index }))
    .filter((sample) => Number.isFinite(sample.t) && sample.t >= 0
      && Number.isFinite(sample.v) && sample.v >= 0 && sample.t >= from && sample.t <= to)
    .sort((a, b) => a.t - b.t
      || (Number.isFinite(a.sequence) ? a.sequence! : a.index) - (Number.isFinite(b.sequence) ? b.sequence! : b.index)
      || a.index - b.index);
  const candles: MarketCapCandle[] = [];
  for (const sample of sorted) {
    const t = Math.floor(sample.t / interval) * interval;
    const last = candles[candles.length - 1];
    if (!last || last.t !== t) {
      candles.push({ t, end: t + interval, firstAt: sample.t, lastAt: sample.t,
        open: sample.v, high: sample.v, low: sample.v, close: sample.v, observations: 1 });
    } else {
      last.high = Math.max(last.high, sample.v);
      last.low = Math.min(last.low, sample.v);
      last.close = sample.v;
      last.lastAt = sample.t;
      last.observations++;
    }
  }
  return candles;
}

export function candleIntervalLabel(interval: number): string {
  if (interval < 60_000) return `${interval / 1_000}s`;
  if (interval < 3_600_000) return `${interval / 60_000}m`;
  if (interval < 86_400_000) return `${interval / 3_600_000}h`;
  return `${interval / 86_400_000}d`;
}
