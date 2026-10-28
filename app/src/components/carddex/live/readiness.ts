import { useQuery } from "@tanstack/react-query";
import { useMatch } from "@tanstack/react-router";
import { getLiveLaunchReadiness } from "../../../lib/carddex/live/api";
import type { LiveReadiness } from "../../../lib/carddex/live/types";
import { liveModeOpen } from "./mode";

export { liveModeOpen };

/**
 * The one readiness query (F17): every reader shares this key and freshness, so a /launch load asks the server
 * once. Route loaders seed it with `ensureQueryData`, so the server HTML already knows the mode.
 */
export const liveReadinessQuery = {
  queryKey: ["live-launch-readiness"] as const,
  queryFn: () => getLiveLaunchReadiness(),
  staleTime: 30_000,
  retry: 1,
};

/** The readiness the /launch loader read on the server, so hydration starts in the mode the HTML was drawn in. */
export function useLoadedReadiness(): LiveReadiness | undefined {
  const match = useMatch({ from: "/launch", shouldThrow: false });
  return (match?.loaderData as { readiness?: LiveReadiness | null } | undefined)?.readiness ?? undefined;
}

/** The shared readiness query, starting from the loader's answer when the page has one. */
export function useLiveReadiness(active = true) {
  const loaded = useLoadedReadiness();
  return useQuery({ ...liveReadinessQuery, enabled: active, initialData: loaded });
}

/**
 * True only when mainnet launches can actually finish (readiness.ready: configured, switched on by
 * CARDDEX_LIVE_LAUNCH_ENABLED, and recovery on too). Stays false while loading, on error and when `active` is false.
 */
export function useLiveLaunchOpen(active = true): boolean {
  const readiness = useLiveReadiness(active);
  return active && readiness.data?.ready === true;
}

/**
 * True when a creator can still reach a saved mainnet launch (readiness.recoveryReady: configured, and
 * CARDDEX_LIVE_RECOVERY_ENABLED is not "false"), including while new launches are off.
 */
export function useLiveRecoveryOpen(active = true): boolean {
  const readiness = useLiveReadiness(active);
  return active && liveModeOpen(readiness.data);
}
