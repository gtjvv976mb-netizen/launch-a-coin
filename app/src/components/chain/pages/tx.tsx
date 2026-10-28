/**
 * Shared pieces of the devnet pages (refs/chain/m3-contract.md §2.2, §7.1): who is viewing (the connected
 * wallet), the transaction runner that follows the client's steps (build, verify, sign, submit, confirm), chain
 * errors as sentences, and the small links every devnet surface uses (faucets, Solana Explorer).
 *
 * Owner: app:pages. The flows themselves live in lib/chain/client.ts (app:wallet); this file only calls them and
 * says what is happening. Nothing here signs, and no key or wallet object is ever stored.
 */
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ChainClientError, type OnTxStep, type TxProgress, type TxStep } from "../../../lib/chain/client";
import { boost } from "../../../lib/chain/data";
import { explorerUrl } from "../../../lib/chain/env";
import { IS_DEVNET } from "../../../lib/mintdex/mode";
import { useWalletSnapshot, wallet } from "../../../lib/chain/wallet";
import { CHAIN_COPY, CHAIN_ERRORS, DEVNET_FAUCETS, SWITCH_COPY } from "../../../lib/mintdex/copy";
import { capFromDetails, capSol, isExitOnly } from "../../../lib/chain/launch-caps";
import { useMe } from "../../mintdex/session";
import { Button, useToast, type ActionState, type Feedback, type ToastAction } from "../../mintdex/ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** The apex remains a read-only preview until the funded mainnet release. The devnet subdomain stays usable. */
const rootApi = getRouteApi("__root__");
export const SITE_TRANSACTION_HOLD_NOTICE = "Transactions are paused while mainnet funding is pending.";
export function useSiteTransactionHold(): boolean {
  const { devnetSite } = rootApi.useLoaderData();
  return IS_DEVNET && !devnetSite;
}

// ---------------------------------------------------------------- the viewer

export type Viewer = {
  /** The Wallet Standard host loaded (false during SSR and the first frames). */
  ready: boolean;
  connected: boolean;
  connecting: boolean;
  address: string | null;
  /** The account lists solana:devnet (else signing is refused: "Switch your wallet to devnet"). */
  clusterOk: boolean;
  /** Lamports, from the devnet identity (useMe) when it matches the wallet; null while unknown. */
  balance: number | null;
  /** The MintDex handle when set, else null. */
  handle: string | null;
};

/** The connected wallet as the devnet pages need it. EMPTY during SSR (useWalletSnapshot is SSR safe). */
export function useViewer(): Viewer {
  const w = useWalletSnapshot();
  const me = useMe();
  const mine = !!me && !!w.address && me.id === w.address;
  return {
    ready: w.ready,
    connected: w.connected && !!w.address,
    connecting: w.connecting,
    address: w.connected ? w.address : null,
    clusterOk: w.clusterOk,
    balance: mine ? me!.balance : null,
    handle: mine && me!.handle && !me!.handle.includes("...") ? me!.handle : null,
  };
}

/** Opens the wallet picker (queued until the lazy host loads). */
export function openWallet() {
  wallet.openModal();
}

// ---------------------------------------------------------------- errors

/** A chain error as one sentence people can act on (never a raw RPC text: those can carry keys). */
export function chainErrorText(e: unknown): string {
  if (e instanceof ChainClientError) {
    const program = e.apiError?.programError?.name;
    if (e.code === "FEES_BELOW_FLOOR" || program === "FeesBelowFloor") return CHAIN_COPY.feesMoved;
    // Exit-only engine mode names what still works (launch-plan §4.3); full off keeps the plain sentence.
    if (e.code === "ENGINE_OFF" && isExitOnly(e.apiError?.details)) return SWITCH_COPY.engineExitOnly;
    if (e.code === "AMOUNT_ABOVE_LAUNCH_CAP") {
      const cap = capFromDetails(e.apiError?.details);
      if (cap != null) return SWITCH_COPY.capError(capSol(cap));
    }
    return CHAIN_ERRORS[e.code] ?? e.apiError?.message ?? CHAIN_ERRORS.NETWORK;
  }
  if (e instanceof TypeError) return CHAIN_ERRORS.NETWORK;
  return "Something went wrong. Try again.";
}

/** The machine code of a chain error (client or API), for the few flows that react to one. */
export function chainErrorCode(e: unknown): string | null {
  return e instanceof ChainClientError ? e.code : null;
}

// ---------------------------------------------------------------- the transaction runner

type TxState = {
  state: ActionState;
  seq: number;
  step: TxStep | null;
  error: string | null;
  /** A one-line note that stays with the action (FEES_BELOW_FLOOR re-sign, confirm timeout). */
  note: string | null;
  signature: string | null;
};

export type TxRunOptions<R> = {
  /** Toast on success. */
  success?: string | ((r: R) => string | null);
  /** A link on the success toast. */
  action?: ToastAction;
  /** Queries to refetch once confirmed (always also the wallet and the viewer's identity). */
  keys?: QueryKey[];
  /** Mints whose pages should poll fast (and re-read the chain once) for the next 2 minutes. */
  mints?: string[];
};

/** How long the success label holds on the button (the sim's useAction uses the same). */
const SUCCESS_HOLD_MS = 1100;

/** Steps in the order they run, for "3 of 7" progress lines. */
export const TX_STEPS: TxStep[] = ["building", "verifying", "signing", "submitting", "confirming", "confirmed"];

/**
 * Runs client flows (each `(input, onStep) => Promise<TxResult>`), one status per action key: pending with the
 * current step, success (held 1.1 s), or error with a sentence. Mirrors the sim's useAction so buttons behave the
 * same: the label follows the step ("Approve in your wallet..."), errors toast and stay on the key until reset.
 * A step that goes back to building after the wallet signed means the client rebuilt the sale with fresh fee
 * reads (FEES_BELOW_FLOOR): the note says so while the wallet asks again.
 */
export function useTx() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Record<string, TxState>>({});
  const seq = useRef(0);
  const holds = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const viewer = useViewer();
  const address = viewer.address;
  const siteHold = useSiteTransactionHold();

  useEffect(() => {
    const map = holds.current;
    return () => map.forEach(clearTimeout);
  }, []);

  const patch = useCallback((key: string, next: Partial<TxState> | null) => {
    const h = holds.current.get(key);
    if (h && next?.state !== undefined) {
      clearTimeout(h);
      holds.current.delete(key);
    }
    setStatus((s) => {
      const copy = { ...s };
      const prev = copy[key] as TxState | undefined;
      if (next === null) delete copy[key];
      else
        copy[key] = {
          state: "pending",
          seq: 0,
          step: null,
          error: null,
          note: null,
          signature: null,
          ...prev,
          ...next,
        };
      return copy;
    });
  }, []);

  const run = useCallback(
    async <R,>(
      key: string,
      call: (onStep: OnTxStep) => Promise<R>,
      opts: TxRunOptions<R> = {},
    ): Promise<R | null> => {
      if (siteHold) {
        patch(key, { state: "error", seq: ++seq.current, step: null, error: SITE_TRANSACTION_HOLD_NOTICE, note: null, signature: null });
        toast("err", SITE_TRANSACTION_HOLD_NOTICE);
        return null;
      }
      patch(key, { state: "pending", seq: ++seq.current, step: null, error: null, note: null, signature: null });
      let last: TxStep | null = null;
      const onStep: OnTxStep = (p: TxProgress) => {
        const resign = (p.step === "building" || p.step === "verifying") && (last === "signing" || last === "submitting");
        last = p.step;
        patch(key, {
          state: p.step === "signing" ? "signing" : p.step === "confirming" ? "confirming" : "pending",
          step: p.step,
          signature: p.signature ?? null,
          ...(resign ? { note: CHAIN_COPY.feesMoved } : null),
        });
      };
      try {
        const r = await call(onStep);
        for (const m of opts.mints ?? []) boost(m);
        if (address) boost(`wallet:${address}`);
        patch(key, { state: "success", seq: ++seq.current, step: "confirmed", note: null });
        holds.current.set(
          key,
          setTimeout(() => {
            holds.current.delete(key);
            setStatus((s) => {
              if (s[key]?.state !== "success") return s;
              const copy = { ...s };
              delete copy[key];
              return copy;
            });
          }, SUCCESS_HOLD_MS),
        );
        const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
        if (msg) toast("ok", msg, opts.action ? { action: opts.action } : undefined);
        for (const k of opts.keys ?? []) void qc.invalidateQueries({ queryKey: k });
        void qc.invalidateQueries({ queryKey: ["chain-wallet"] });
        void qc.invalidateQueries({ queryKey: ["me"] });
        return r;
      } catch (e) {
        const code = chainErrorCode(e);
        const text = chainErrorText(e);
        // A timeout may still land: poll the pages as if it had, and say so instead of calling it a failure.
        if (code === "CONFIRM_TIMEOUT") for (const m of opts.mints ?? []) boost(m);
        patch(key, { state: "error", seq: ++seq.current, error: text, note: null });
        toast("err", text);
        return null;
      }
    },
    [patch, qc, toast, address, siteHold],
  );

  const pendingKey = Object.keys(status).find((k) => {
    const st = status[k].state;
    return st === "pending" || st === "signing" || st === "confirming";
  }) ?? null;

  return {
    run,
    /** The action key that is running, if any (one wallet prompt at a time). */
    busy: pendingKey,
    pending: (key: string) => {
      const st = status[key]?.state;
      return st === "pending" || st === "signing" || st === "confirming";
    },
    /** The button label for the running step ("Approve in your wallet..."). */
    label: (key: string, fallback = "Working...") => {
      const step = status[key]?.step;
      return step ? (CHAIN_COPY.steps[step] ?? fallback) : fallback;
    },
    step: (key: string) => status[key]?.step ?? null,
    feedback: (key: string): Feedback =>
      status[key] && (status[key].state === "success" || status[key].state === "error")
        ? { state: status[key].state, seq: status[key].seq }
        : null,
    error: (key: string) => (status[key]?.state === "error" ? status[key].error : null),
    note: (key: string) => status[key]?.note ?? null,
    reset: (key: string) => {
      if (status[key]?.state === "error") patch(key, null);
    },
  };
}

export type Tx = ReturnType<typeof useTx>;

// ---------------------------------------------------------------- small pieces

/**
 * "Get free devnet SOL from a public faucet. Solana faucet, QuickNode faucet.": the public faucets (no in-app faucet
 * on devnet). Mainnet has no faucet: "Add SOL to your wallet to continue." and no link.
 */
export function FaucetLinks({ className = "", lead = true }: { className?: string; lead?: boolean }) {
  if (!IS_DEVNET) return <span className={className}>{CHAIN_COPY.getSol}</span>;
  return (
    <span className={className}>
      {lead ? <>{CHAIN_COPY.getSol} </> : null}
      {DEVNET_FAUCETS.map((f, i) => (
        <span key={f.href}>
          {i > 0 ? ", " : null}
          <a href={f.href} target="_blank" rel="noopener noreferrer" className="mdx-link mdx-hit">
            {f.label}
          </a>
        </span>
      ))}
      .
    </span>
  );
}

/** A Solana Explorer link (the build's cluster) for an address or a transaction. */
export function ExplorerLink({
  kind = "address",
  id,
  children,
  className = "",
}: {
  kind?: "address" | "tx";
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={explorerUrl(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("mdx-link mdx-hit", className)}
    >
      {children}
    </a>
  );
}

/** The button that stands in for an action while no wallet is connected: opens the wallet picker. */
export function ConnectButton({
  label = CHAIN_COPY.connect,
  className = "",
  size,
  block,
  variant = "primary",
}: {
  label?: ReactNode;
  className?: string;
  size?: "md" | "sm" | "lg";
  block?: boolean;
  variant?: "primary" | "outline";
}) {
  const v = useViewer();
  return (
    <Button
      variant={variant}
      size={size}
      block={block}
      className={className}
      pending={v.connecting}
      pendingLabel="Connecting..."
      onClick={openWallet}
    >
      {label}
    </Button>
  );
}

/**
 * Why an action cannot be signed right now, or null: no wallet, the wrong network. Shown in the action's message
 * slot, so the button keeps a stable label.
 */
export function signBlocker(v: Viewer): string | null {
  if (!v.connected) return null;
  if (!v.clusterOk) return CHAIN_COPY.switchNetwork;
  return null;
}

/** A thin progress line for a multi-step flow: "Step 3 of 6. Approve in your wallet..." with a 4px bar. */
export function StepLine({ steps, step, className = "" }: { steps: TxStep[]; step: TxStep | null; className?: string }) {
  if (!step) return null;
  const i = Math.max(0, steps.indexOf(step));
  const label = CHAIN_COPY.steps[step] ?? "";
  return (
    <div className={cx("min-w-0", className)} role="status" aria-live="polite">
      <div className="mdx-progress" aria-hidden>
        <div className="mdx-progress__fill" style={{ width: `${Math.round(((i + 1) / steps.length) * 100)}%` }} />
      </div>
      <p className="mt-1.5 truncate text-[13px] leading-5 text-slate">
        <span className="num text-ink">
          {i + 1} of {steps.length}
        </span>{" "}
        {label}
      </p>
    </div>
  );
}
