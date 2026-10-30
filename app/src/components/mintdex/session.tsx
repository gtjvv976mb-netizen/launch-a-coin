import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { requestWallet, useChainMe, useChainRequireMe } from "../../lib/chain/identity";
import { enter, getMe } from "../../lib/mintdex/api";
import { IS_SIM } from "../../lib/mintdex/mode";
import { HANDLE_RE, isReservedHandle } from "../../lib/mintdex/constants";
import { cleanHandle } from "../../lib/mintdex/format";
import { FLOW, MODE_COPY } from "../../lib/mintdex/copy";
import type { Me } from "../../lib/mintdex/types";
import { setMe } from "./hooks";
import { isCoarsePointer } from "./sheet";
import {
  Button,
  Field,
  Input,
  Modal,
  useToast,
} from "./ui";

const rootApi = getRouteApi("__root__");

/**
 * The player, or null. Sim: the signed-in handle. Devnet: the connected wallet in the same shape
 * (lib/chain/identity.ts: address as id, handle or short address, devnet SOL balance, no faucet).
 */
export const useMe: () => Me = IS_SIM ? useSimMe : useChainMe;

/**
 * True on the devnet test site (lib/mintdex/site-host.ts), whose one-line banner above every page already says that
 * devnet SOL has no real value: Home and the rail then drop their own copy of that line (one notice per screen).
 * From the root loader, so the server HTML and the hydrating client agree. Always false in sim and mainnet builds.
 */
export function useDevnetSite(): boolean {
  return rootApi.useLoaderData({ select: (d) => !!(d as { devnetSite?: boolean } | undefined)?.devnetSite });
}

/** The signed-in player, or null. Polled every 20s only while signed in (P0-12): signed out, nothing changes. */
function useSimMe(): Me {
  const initial = rootApi.useLoaderData() as { me: Me } | undefined;
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(),
    initialData: initial?.me ?? null,
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data ? 20_000 : false),
  });
  return data ?? null;
}

/**
 * What the player was doing when the Enter dialog interrupted them (backlog P1-11): the dialog's button names it
 * ("Enter and buy 0.5 SOL of $GLORB"), and once the handle is in, `run` finishes it.
 */
export type Intent = { label: string; run: () => void };

type Ctx = { openEnter: (reason?: string, intent?: Intent) => void; openGuide: () => void };
const SessionCtx = createContext<Ctx>({ openEnter: () => {}, openGuide: () => {} });

export function useSessionUi() {
  return useContext(SessionCtx);
}

/**
 * Returns a guard: runs `fn` when signed in, otherwise opens the Enter dialog with `reason`. With `label`, the
 * dialog's button names the action ("Enter and launch") and `fn` runs as soon as the player is in (P1-11).
 */
export const useRequireMe: () => (fn: () => void, reason?: string, label?: string) => void = IS_SIM
  ? useSimRequireMe
  : useChainRequireMe;

function useSimRequireMe() {
  const me = useMe();
  const { openEnter } = useSessionUi();
  return useCallback(
    (fn: () => void, reason?: string, label?: string) => {
      if (me) fn();
      else openEnter(reason, label ? { label, run: fn } : undefined);
    },
    [me, openEnter],
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [enterOpen, setEnterOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const [intent, setIntent] = useState<Intent | undefined>();
  const openEnter = useCallback((r?: string, i?: Intent) => {
    // Devnet has no handle login: the wallet is the identity, so "enter" opens the wallet picker and finishes the
    // action once a wallet connects (lib/chain/identity.ts requestWallet).
    if (!IS_SIM) return requestWallet(i?.run);
    setReason(r);
    setIntent(i);
    setEnterOpen(true);
  }, []);
  // The guide is a page now (/how, the words rule): every "How it works" entry opens it.
  const navigate = useNavigate();
  const openGuide = useCallback(() => void navigate({ to: "/how" }), [navigate]);
  const value = useMemo(() => ({ openEnter, openGuide }), [openEnter, openGuide]);
  // An old ?guide=1 link redirects to /how in the root route's beforeLoad.
  return (
    <SessionCtx.Provider value={value}>
      {children}
      {IS_SIM ? (
        <EnterDialog
          open={enterOpen}
          onOpenChange={(o) => {
            setEnterOpen(o);
            if (!o) setIntent(undefined);
          }}
          reason={reason}
          intent={intent}
        />
      ) : null}
    </SessionCtx.Provider>
  );
}

/** The handle field's rule (the error repeats it). The field shows its length; it removes anything else as it is typed. */
const HANDLE_HELP = "3 to 16 letters, numbers or underscores.";
const HANDLE_HINT = "3–16 characters.";

function EnterDialog({
  open,
  onOpenChange,
  reason,
  intent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reason?: string;
  intent?: Intent;
}) {
  const [handle, setHandle] = useState("");
  // Anything the field removed as it was typed, said under it (as Launch's ticker field does).
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  // Touch screens: no autofocus, so the keyboard does not rise over the sheet while it slides in (P1-1).
  const [autoFocus] = useState(() => !isCoarsePointer());
  const clean = handle.trim().toLowerCase();
  const valid = HANDLE_RE.test(clean);
  // Official and demo bot handles are reserved (P0-6); say so before the round trip.
  const reserved = valid && isReservedHandle(clean);

  useEffect(() => {
    if (open) {
      setHandle("");
      setNote("");
      setError(null);
    }
  }, [open]);

  // A handle that cannot be used says why on the spot (Enter or the button), not only through the static help.
  const invalidReason = clean ? `Use ${HANDLE_HELP}` : "Pick a handle first.";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!valid) {
      setError(invalidReason);
      return;
    }
    if (reserved) {
      setError("That handle is reserved. Try another one.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await enter({ data: { handle } }).catch(() => ({
      ok: false as const,
      error: FLOW.connection,
    }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMe(qc, res.me);
    // Viewer-specific data (the coin page's holding and the portfolio) refreshes behind the dialog.
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    const then = intent;
    onOpenChange(false);
    setHandle("");
    // The welcome toast only when the dialog was opened on its own: a finished action is its own confirmation (a trade
    // says "Bought ...", a launch opens its card), and a toast there would sit over the screen's one button.
    if (!then) toast("ok", FLOW.welcome(res.me?.handle ?? ""));
    // Finish what they started (P1-11), once the dialog has handed focus back.
    if (then) setTimeout(then.run, 0);
  }

  // One page (coin-26): the gift (or why the demo opened), the handle, then Cancel and the one primary. What the demo
  // is lives on /how#demo.
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Try the demo">
      <form onSubmit={submit} className="cdx-enter" noValidate>
        <p className="cdx-enter__intro">
          {reason ? `${reason} ` : null}
          {MODE_COPY.enterGift}
        </p>
        {/* The length is shown (the field removes any other character as it is typed, and says so); the error repeats
            the whole rule when it fails. */}
        <Field
          label="Handle"
          htmlFor="handle"
          help={<><span aria-live="polite">{note}</span>{note ? null : HANDLE_HINT}</>}
          error={error ?? undefined}
        >
          <Input
            id="handle"
            prefix="@"
            autoFocus={autoFocus}
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            maxLength={16}
            onChange={(e) => {
              const next = cleanHandle(e.target.value);
              setHandle(next.handle);
              // Once something was removed the note stays until the field is emptied (typing on would hide it).
              setNote((was) => (next.removed ? "Only letters, numbers and _." : next.handle ? was : ""));
              if (error) setError(null);
            }}
            placeholder="your_handle"
            aria-invalid={!!error}
            aria-describedby="handle-help"
          />
        </Field>
        {MODE_COPY.accountNote ? <p className="cdx-enter__note">{MODE_COPY.accountNote}</p> : null}
        <div className="cdx-overlay-actions mdx-sheet-foot">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* Enabled with an empty handle too (one primary rule): a press says why under the field. */}
          <Button
            type="submit"
            pending={busy}
            pendingLabel="Starting..."
          >
            {intent ? intent.label : "Start the demo"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
