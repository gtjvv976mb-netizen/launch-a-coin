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
    <Modal open={open} onOpenChange={onOpenChange} title="Enter CardDex">
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <p className="text-[15px] leading-[1.5] text-slate">
          {reason ?? "Pick a handle to launch tokens and build your collection."}
          {MODE_COPY.enterGift ? ` ${MODE_COPY.enterGift}` : null}
        </p>
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
        <div className="mdx-sheet-foot">
          <Button
            type="submit"
            block
            disabled={!valid}
            onBlocked={() => setError(invalidReason)}
            pending={busy}
            pendingLabel="Entering..."
          >
            {intent ? intent.label : "Enter CardDex"}
          </Button>
        </div>
        {/* Sign out would strand the account (P0-7): say where it lives, up front. */}
        {MODE_COPY.accountNote ? (
          <p className="-mt-2 text-[13px] leading-[1.45] text-slate">{MODE_COPY.accountNote}</p>
        ) : null}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- guide (every figure from copy.ts and tiers.ts)

const STEPS: Array<{ title: string; body: string; visual: ReactNode; phoneVisual?: boolean }> = [
  {
    title: "Launch your token",
    body: "Give your token a name, ticker and artwork. CardDex's production flow is designed for token launches through pump.fun.",
    visual: null,
  },
  {
    title: "Choose its permanent card",
    body: "Pick a premium design before launch. Your one-of-one NFT card uses your token's artwork and keeps that design.",
    visual: null,
  },
  {
    title: "Trade the token. Keep the card.",
    body: "Buy and sell tokens, follow the market and view your creator card in your collection.",
    visual: null,
  },
];

const FEE_ROWS: Array<{ label: string; value: string }> = IS_SIM
  ? [{ label: "Local demo", value: "All balances and trades are simulated. No real token or NFT is minted." }]
  : [{ label: "Token trading", value: "Review the fee and price impact shown before confirming a trade." }];

/**
 * How CardDex works (P1-7): the three steps stacked, so all of it can be scanned at once, then the fees and the
 * Terms link. Desktop: a 560px dialog that fits a 1280x720 screen with no inner scroll. Phones: a bottom sheet with
 * the same column, the site-wide motion switch and Connect pinned to the bottom. Linkable with ?guide=1.
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
    <Modal open={open} onOpenChange={onOpenChange} title="How CardDex works" width={560}>
      <ol className="flex flex-col gap-5 short:gap-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
            <span className="mdx-plate text-[20px] leading-[1.2] text-slate" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{s.title}</h3>
              <p className="mt-1 text-pretty text-[15px] leading-[1.45] text-slate short:text-[14px]">{s.body}</p>
              <div className={s.phoneVisual ? "mt-2.5 short:mt-2" : "mt-2.5 max-lg:hidden short:mt-2"}>
                {s.visual}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 border-t border-hairline pt-4 text-[13px] leading-[1.45] text-slate short:mt-4 short:pt-3">
        {/* What the money is (devnet) and the Terms link on one row, then the fees as label and value rows. */}
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {MODE_COPY.guideNote ? <p className="font-medium text-ink">{MODE_COPY.guideNote}</p> : null}
          <TextLink to="/legal" onClick={() => onOpenChange(false)}>
            Terms, privacy and risks
          </TextLink>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          {FEE_ROWS.map((r) => (
            <div key={r.label} className="contents">
              <dt className="font-medium text-ink">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {/* Phones: the site-wide Calm motion switch, reachable signed out from the header's guide button (desktop
          has it in the rail). WCAG 2.2.2: a way to stop the ambient motion on every page. The whole row toggles;
          pb-2.5 with -mb-2.5 makes it a 44px tap target without moving anything. */}
      <CalmSwitch size="md" className="mt-4 -mb-2.5 border-t border-hairline pb-2.5 pt-3 lg:hidden" />
      {!me && (
        <div className="mdx-sheet-foot mt-5 short:mt-4">
          <Button
            block
            onClick={() => {
              onOpenChange(false);
              onEnter();
            }}
          >
            {IS_SIM ? "Enter CardDex" : CONNECT_COPY.connect}
          </Button>
        </div>
      )}
    </Modal>
  );
}
