import { useEffect, useState } from "react";

/** How long after the load event warm-up fetches wait: past the largest paint, which can trail `load`. */
const AFTER_LOAD_MS = 3000;

/**
 * Runs `fn` a little after the page has loaded, when the main thread is idle, so code fetched ahead of need never
 * competes with the first paints. Returns the cancel.
 */
export function afterLoadIdle(fn: () => void): () => void {
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    timer = setTimeout(() => {
      idle = window.requestIdleCallback?.(fn, { timeout: 4000 });
      if (idle === undefined) fn();
    }, AFTER_LOAD_MS);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    clearTimeout(timer);
  };
}

/**
 * For dialogs and sheets whose code is a lazy chunk: true from the first time `open` is true (so the closing
 * animation still plays), and `prefetch` runs after load (afterLoadIdle) so the first open does not wait on the network.
 */
export function useOpenedOnce(open: boolean, prefetch: () => unknown): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  useEffect(() => afterLoadIdle(() => void prefetch()), [prefetch]);
  return opened;
}
