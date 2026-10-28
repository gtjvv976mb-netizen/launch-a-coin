/** Match Home's one-hour window before activity can be described as live. */
export const ACTIVITY_LIVE_WINDOW_MS = 60 * 60 * 1000;

/** Future or malformed timestamps cannot establish that real activity happened recently. */
export function isRecentActivityAt(createdAt: number, now: number): boolean {
  return (
    Number.isFinite(createdAt) &&
    createdAt > 0 &&
    Number.isFinite(now) &&
    createdAt <= now &&
    now - createdAt < ACTIVITY_LIVE_WINDOW_MS
  );
}

/** The feed need not arrive sorted; any real event inside the window establishes recent activity. */
export function hasRecentActivity(rows: readonly { createdAt: number }[], now: number): boolean {
  return rows.some((row) => isRecentActivityAt(row.createdAt, now));
}
