/**
 * Inspect (spec 4.10): this tiny wrapper is in the main chunk; the velvet stage itself (InspectStage.tsx) is its
 * own lazy chunk, fetched on first use or ahead of time by prefetchInspect() (hover, focus or touchstart of an
 * Inspect control).
 */
import { lazy } from "react";

const load = () => import("./InspectStage");

export const InspectDialog = lazy(load);

let prefetched = false;
export function prefetchInspect() {
  if (prefetched) return;
  prefetched = true;
  void load();
}
