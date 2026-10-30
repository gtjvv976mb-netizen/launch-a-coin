/**
 * One card render at a time in a Worker isolate. An isolate has 128 MB for everything it runs, and the card renderer's
 * WebAssembly memory (about 50 to 70 MB once a card is printed, depending on the artwork; it never shrinks) is shared
 * by every request in it. A card and case print or a coin-image export holds 10 to 30 MB more while it runs and stores
 * its files; two of them interleaved at their awaits would hold both sets at once. Each job holds the slot from its
 * first render until what it made is stored and read back.
 *
 * A waiting request polls a timer rather than awaiting the holder's promise: Workers cancel a request that waits only
 * on another request's promise. The slot is a lease: a holder whose request was cancelled mid-job (its promise never
 * settles) stops blocking the isolate once the lease ends.
 */
export const BUSY = "Card images are being made for other launches. Nothing was sent. Try again in a moment.";
export function createRendererSlot({leaseMs = 30_000, waitMs = 120_000, pollMs = 25, busy = () => new Error(BUSY)}: {leaseMs?: number; waitMs?: number; pollMs?: number; busy?: () => Error} = {}) {
  let heldUntil = 0, holder = 0;
  return async function withRendererSlot<T>(job: () => Promise<T>): Promise<T> {
    const giveUp = Date.now() + waitMs;
    while (Date.now() < heldUntil) {
      if (Date.now() > giveUp) throw busy();
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    const mine = ++holder;
    heldUntil = Date.now() + leaseMs;
    try { return await job(); } finally { if (holder === mine) heldUntil = 0; }
  };
}
