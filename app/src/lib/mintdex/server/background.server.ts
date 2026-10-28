// Work that must not hold up a response (backlog P0-3): hand it to the Workers runtime with waitUntil, so the
// request answers first and the isolate stays alive until the task settles.
//
// `waitUntil` is exported by the `cloudflare:workers` built-in (workerd 2025 and later). The repo's module
// declaration only types `env`, so read it off the namespace defensively; if a runtime ever lacks it, the task
// still starts, it just is not guaranteed to finish after the response (fine for best-effort work).
import * as workers from "cloudflare:workers";

type WaitUntil = (promise: Promise<unknown>) => void;

export function runInBackground(label: string, task: () => Promise<unknown>) {
  let promise: Promise<unknown>;
  try {
    promise = task().catch((e) => console.warn(`${label} skipped`, e));
  } catch (e) {
    console.warn(`${label} skipped`, e);
    return;
  }
  const waitUntil = (workers as unknown as { waitUntil?: WaitUntil }).waitUntil;
  if (typeof waitUntil === "function") {
    try {
      waitUntil(promise);
    } catch {
      // Outside a request context (tests, build tooling): the task simply runs unattached.
    }
  }
}
