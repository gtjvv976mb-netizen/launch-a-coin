import { useQuery } from "@tanstack/react-query";
import { getLiveLaunchReadiness } from "../../../lib/carddex/live/api";

/**
 * True only when the owner has turned mainnet launches on (CARDDEX_LIVE_LAUNCH_ENABLED). It shares the
 * readiness query with LiveLaunchPanel, and stays false while loading, on error and when `active` is false.
 */
export function useLiveLaunchOpen(active = true): boolean {
  const readiness = useQuery({ queryKey: ["live-launch-readiness"], queryFn: () => getLiveLaunchReadiness(), staleTime: 30_000, retry: 1, enabled: active });
  return active && readiness.data?.enabled === true;
}
