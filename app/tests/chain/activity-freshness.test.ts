import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_LIVE_WINDOW_MS,
  hasRecentActivity,
  isRecentActivityAt,
} from "../../src/lib/mintdex/activity-freshness";

const NOW = 1_792_238_400_000;

describe("activity freshness", () => {
  test("expires at the one-hour boundary even when the feed has not changed", () => {
    const event = { createdAt: NOW - ACTIVITY_LIVE_WINDOW_MS + 1 };
    expect(hasRecentActivity([event], NOW)).toBe(true);
    expect(hasRecentActivity([event], NOW + 1)).toBe(false);
  });

  test("old catch-up events do not qualify for live labels or arrival bursts", () => {
    expect(isRecentActivityAt(NOW - 14 * 24 * ACTIVITY_LIVE_WINDOW_MS, NOW)).toBe(false);
    expect(hasRecentActivity([{ createdAt: NOW - ACTIVITY_LIVE_WINDOW_MS }], NOW)).toBe(false);
  });

  test("finds recent activity without relying on feed order", () => {
    expect(hasRecentActivity([
      { createdAt: NOW - 2 * ACTIVITY_LIVE_WINDOW_MS },
      { createdAt: NOW - 1000 },
    ], NOW)).toBe(true);
    expect(hasRecentActivity([], NOW)).toBe(false);
  });

  test("unknown, malformed and future timestamps never establish live activity", () => {
    for (const at of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, NOW + 1]) {
      expect(isRecentActivityAt(at, NOW)).toBe(false);
    }
    expect(isRecentActivityAt(NOW, Number.NaN)).toBe(false);
    expect(isRecentActivityAt(NOW, NOW)).toBe(true);
  });
});
