import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouterState } from "@tanstack/react-router";
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
import { CONNECT_COPY } from "../../lib/chain/connect-copy";
import { enter, getMe } from "../../lib/mintdex/api";
import { IS_SIM } from "../../lib/mintdex/mode";
import { HANDLE_RE, isReservedHandle } from "../../lib/mintdex/constants";
import { FLOW, MODE_COPY } from "../../lib/mintdex/copy";
import type { Me } from "../../lib/mintdex/types";
import { setMe } from "./hooks";
import { isCoarsePointer } from "./sheet";
import { ViewportPages } from "../carddex/live/ViewportPages";
import {
  Button,
  CalmSwitch,
  Field,
  Input,
  Modal,
  TextLink,
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
  const [guideOpen, setGuideOpen] = useState(false);
  const openEnter = useCallback((r?: string, i?: Intent) => {
    // Devnet has no handle login: the wallet is the identity, so "enter" opens the wallet picker and finishes the
    // action once a wallet connects (lib/chain/identity.ts requestWallet).
    if (!IS_SIM) return requestWallet(i?.run);
    setReason(r);
    setIntent(i);
    setEnterOpen(true);
  }, []);
  const openGuide = useCallback(() => setGuideOpen(true), []);
  const value = useMemo(() => ({ openEnter, openGuide }), [openEnter, openGuide]);

  // A linkable guide (P1-7): any page with ?guide=1 opens it after load (never in the server HTML); closing
  // it drops the flag, so Back and a refresh do not reopen it.
  const navigate = useNavigate();
  const linked = useRouterState({
    select: (st) => {
      const g = (st.location.search as { guide?: unknown }).guide;
      return g === 1 || g === "1";
    },
  });
  useEffect(() => {
    if (linked) setGuideOpen(true);
  }, [linked]);
  const onGuideChange = (o: boolean) => {
    setGuideOpen(o);
    if (!o && linked) {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, guide: undefined }),
        replace: true,
        resetScroll: false,
      } as never);
    }
  };
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
      <GuideDialog open={guideOpen} onOpenChange={onGuideChange} onEnter={() => openEnter()} />
    </SessionCtx.Provider>
  );
}

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
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
      setError(null);
      setPage(0);
    }
  }, [open]);

  // A handle that cannot be used says why on the spot (Enter or the button), not only through the static help.
  const invalidReason = clean
    ? "Handles need 3 to 16 characters: letters, numbers or underscores."
    : "Pick a handle first.";

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
    toast("ok", FLOW.welcome(res.me?.handle ?? ""));
    // Finish what they started (P1-11), once the dialog has handed focus back.
    if (then) setTimeout(then.run, 0);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Try the demo">
      {page === 0 ? <div className="cdx-enter-intro cdx-overlay-deck">
        <div className="cdx-overlay-copy">
          <p>{reason ?? "Pick a handle to launch coins and build your collection."}{MODE_COPY.enterGift ? ` ${MODE_COPY.enterGift}` : null}</p>
          {MODE_COPY.accountNote ? <p>{MODE_COPY.accountNote}</p> : null}
        </div>
        <div className="cdx-overlay-actions"><span aria-live="polite">1 / 2</span><Button onClick={() => setPage(1)}>Choose a handle</Button></div>
      </div> : <form onSubmit={submit} className="cdx-enter-form cdx-overlay-deck" noValidate>
        <Field
          label="Handle"
          htmlFor="handle"
          help="3 to 16 characters: letters, numbers or underscores."
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
              setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase());
              if (error) setError(null);
            }}
            placeholder="your_handle"
            aria-invalid={!!error}
            aria-describedby="handle-help"
          />
        </Field>
        <div className="cdx-enter-submit mdx-sheet-foot">
          <Button variant="outline" onClick={() => setPage(0)}>Back</Button>
          <Button
            type="submit"
            disabled={!valid}
            onBlocked={() => setError(invalidReason)}
            pending={busy}
            pendingLabel="Starting..."
          >
            {intent ? intent.label : "Start the demo"}
          </Button>
        </div>
      </form>}
    </Modal>
  );
}

// ---------------------------------------------------------------- guide (every figure from copy.ts and tiers.ts)

const STEPS: Array<{ title: string; body: string; visual: ReactNode; phoneVisual?: boolean }> = [
  {
    title: "Launch your coin",
    body: "Give your coin a name, ticker and artwork. Choose its supported quote asset, then review the pump.fun launch in your wallet.",
    visual: null,
  },
  {
    title: "Choose its permanent card",
    body: "Pick a premium design before launch. After the coin is verified, approve the separate one-of-one NFT card delivery to your creator wallet.",
    visual: null,
  },
  {
    title: "Trade the coin. Keep the card.",
    body: "Open your real coin on pump.fun and keep the separate card NFT in your wallet. The demo lets you explore with test SOL.",
    visual: null,
  },
];

const FEE_ROWS: Array<{ label: string; value: string }> = IS_SIM
  ? [{ label: "Demo", value: "Demo balances and trades are simulated. Wallet launches show real network costs separately before you sign." }]
  : [{ label: "Coin trading", value: "Review the fee and price impact shown before confirming a trade." }];

/**
 * The guide keeps all three steps, fees, legal links and motion settings on explicit pages.
 * The same bounded deck is used in desktop dialogs and phone sheets. Linkable with ?guide=1.
 */
function GuideDialog({
  open,
  onOpenChange,
  onEnter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onEnter: () => void;
}) {
  const me = useMe();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="How Launch a Card works" width={560}>
      <div className="cdx-overlay-deck"><ViewportPages label="How Launch a Card works pages" pages={[
        ...STEPS.map(s => <section key={s.title} className="cdx-overlay-copy"><h3>{s.title}</h3><p>{s.body}</p>{s.visual}</section>),
        <section key="fees" className="cdx-overlay-copy"><h3>Costs and risks</h3>{MODE_COPY.guideNote ? <p>{MODE_COPY.guideNote}</p> : null}<dl>{FEE_ROWS.map(r => <div key={r.label}><dt className="font-semibold text-ink">{r.label}</dt><dd>{r.value}</dd></div>)}</dl><TextLink to="/legal" search={{ tab: "fees" }} onClick={() => onOpenChange(false)}>Fees, terms and risks</TextLink></section>,
        <section key="settings" className="cdx-overlay-copy"><h3>Make it yours</h3><CalmSwitch size="md" />{!me ? <Button block onClick={() => { onOpenChange(false); onEnter(); }}>{IS_SIM ? "Try the demo" : CONNECT_COPY.connect}</Button> : null}</section>,
      ]} /></div>
    </Modal>
  );
}
