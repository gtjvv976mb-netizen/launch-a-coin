import type { LiveReadiness } from "../../../lib/carddex/live/types";

/** Mainnet mode can open: for new launches or for a saved launch alone. The page and the root loader share this rule. */
export function liveModeOpen(readiness: Pick<LiveReadiness, "ready" | "recoveryReady"> | null | undefined): boolean {
  return readiness?.ready === true || readiness?.recoveryReady === true;
}
