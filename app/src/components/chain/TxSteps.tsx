/**
 * The signing state machine of every devnet money action (backlog P1-8 on devnet; refs/chain/m3-contract.md §7.1):
 *
 *   idle → building → verifying → awaiting-wallet → sending → confirming → done
 *                         └──────────────┴──────────────┴──────────┴──→ error (from any running phase)
 *
 * The client's flow steps (lib/chain/client.ts TxStep) drive it; "verifying" is where the SDK verifier runs, and a
 * VERIFY_FAILED stops the machine there, before "awaiting-wallet", so the wallet never opens (C8). A step back to
 * building after the wallet signed is the one allowed rebuild (FEES_BELOW_FLOOR: fresh fee reads, sign again).
 * It maps onto the existing feedback states of ui.tsx (ActionState: pending, signing, confirming, success, error),
 * so a Button shows "Approve in wallet" while the wallet is open and the drawn check or the shake when it ends.
 *
 * Owner: app:wallet. app:pages may use useTxPhase + TxSteps, or its own runner over the same client steps.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { OnTxStep, TxProgress, TxStep } from "../../lib/chain/client";
import { chainErrorText, PHASE_LABEL, PHASE_STEPS, phaseOfStep, type TxPhase } from "../../lib/chain/tx-copy";
import type { ActionState, Feedback } from "../mintdex/ui";

export type { TxPhase } from "../../lib/chain/tx-copy";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Running phases in order (done last). */
export const PHASE_ORDER: readonly TxPhase[] = ["building", "verifying", "awaiting-wallet", "sending", "confirming", "done"];

export type TxEvent = { type: "start" } | { type: "step"; step: TxStep } | { type: "error" } | { type: "reset" };

/**
 * The pure transition. Steps only move forward, except the rebuild (back to building or verifying after the wallet
 * was asked), and nothing moves a finished machine except start and reset.
 */
export function nextPhase(cur: TxPhase, ev: TxEvent): TxPhase {
  switch (ev.type) {
    case "start":
      return "building";
    case "reset":
      return "idle";
    case "error":
      return cur === "idle" || cur === "done" ? cur : "error";
    case "step": {
      if (cur === "idle" || cur === "done" || cur === "error") return cur;
      const to = phaseOfStep(ev.step);
      const from = PHASE_ORDER.indexOf(cur);
      const next = PHASE_ORDER.indexOf(to);
      if (next >= from) return to;
      // A rebuild after the wallet was asked (fresh fee reads, then sign again).
      const rebuild = (to === "building" || to === "verifying") && from >= PHASE_ORDER.indexOf("awaiting-wallet");
      return rebuild ? to : cur;
    }
  }
}

/** The ui.tsx feedback state for a phase (Button `feedback`, P1-8). */
export function actionStateOf(phase: TxPhase): ActionState {
  switch (phase) {
    case "idle":
      return "idle";
    case "building":
    case "verifying":
    case "sending":
      return "pending";
    case "awaiting-wallet":
      return "signing";
    case "confirming":
      return "confirming";
    case "done":
      return "success";
    case "error":
      return "error";
  }
}

/** How long the done state holds before the machine goes back to idle (the sim's useAction holds 1.1 s). */
const DONE_HOLD_MS = 1100;

/**
 * One action's machine. `run(call)` walks it through a client flow: call is `(onStep) => client.buy(input, onStep)`
 * and the like. Errors end in "error" with a sentence (never a raw RPC text); done holds 1.1 s, then idle.
 */
export function useTxPhase() {
  const [state, setState] = useState<{ phase: TxPhase; seq: number; error: string | null; progress: TxProgress | null }>(
    { phase: "idle", seq: 0, error: null, progress: null },
  );
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hold.current), []);

  const dispatch = useCallback((ev: TxEvent, extra: { error?: string | null; progress?: TxProgress | null } = {}) => {
    setState((s) => {
      const phase = nextPhase(s.phase, ev);
      const ends = phase === "done" || phase === "error";
      return {
        phase,
        seq: ends || ev.type === "start" ? s.seq + 1 : s.seq,
        error: phase === "error" ? (extra.error ?? s.error) : null,
        progress: extra.progress !== undefined ? extra.progress : ev.type === "start" || ev.type === "reset" ? null : s.progress,
      };
    });
  }, []);

  const onStep: OnTxStep = useCallback((p: TxProgress) => dispatch({ type: "step", step: p.step }, { progress: p }), [dispatch]);

  const run = useCallback(
    async <R,>(call: (onStep: OnTxStep) => Promise<R>): Promise<R | null> => {
      clearTimeout(hold.current);
      dispatch({ type: "start" });
      try {
        const r = await call(onStep);
        dispatch({ type: "step", step: "confirmed" });
        hold.current = setTimeout(() => dispatch({ type: "reset" }), DONE_HOLD_MS);
        return r;
      } catch (e) {
        dispatch({ type: "error" }, { error: chainErrorText(e) });
        return null;
      }
    },
    [dispatch, onStep],
  );

  const actionState = actionStateOf(state.phase);
  const feedback: Feedback =
    state.phase === "done" || state.phase === "error" ? { state: actionState, seq: state.seq } : null;
  return {
    phase: state.phase,
    error: state.error,
    progress: state.progress,
    actionState,
    feedback,
    busy: actionState === "pending" || actionState === "signing" || actionState === "confirming",
    label: PHASE_LABEL[state.phase],
    run,
    onStep,
    reset: () => dispatch({ type: "reset" }),
  };
}

/**
 * The four visible steps (Check, Approve, Send, Confirm) with the current one marked and a live status line.
 * Nothing while idle. Color only (no motion), so reduced motion needs nothing extra.
 */
export function TxSteps({
  phase,
  error,
  className = "",
}: {
  phase: TxPhase;
  error?: string | null;
  className?: string;
}) {
  if (phase === "idle") return null;
  const at = phase === "building" ? 0 : PHASE_STEPS.findIndex((s) => s.phase === phase);
  const done = phase === "done";
  const failed = phase === "error";
  return (
    <div className={cx("min-w-0", className)} data-testid="tx-steps" data-phase={phase}>
      <ol className="flex items-center gap-1.5" aria-hidden>
        {PHASE_STEPS.map((s, i) => {
          const passed = done || (at >= 0 && i < at);
          const current = !done && !failed && i === Math.max(at, 0);
          return (
            <li key={s.phase} className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={cx(
                  "h-1 rounded-pill transition-colors duration-(--t-base) ease-room",
                  passed ? "bg-up" : current ? "bg-ink" : "bg-track",
                )}
              />
              <span className={cx("truncate text-[12px] leading-4", current ? "text-ink" : "text-slate")}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className={cx("mt-1.5 text-[13px] leading-5", failed ? "text-down" : "text-slate")}>
        {failed ? (error ?? PHASE_LABEL.error) : PHASE_LABEL[phase]}
      </p>
    </div>
  );
}
