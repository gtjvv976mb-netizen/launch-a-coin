import * as Popover from "@radix-ui/react-popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { chainCoinList } from "../../lib/chain/data";
import { claimFaucet, listCoins, signOut } from "../../lib/mintdex/api";
import { IS_DEVNET, IS_SIM } from "../../lib/mintdex/mode";
import { ChainHeaderAccount, ChainRailWallet } from "../chain/ConnectWallet";
import { FAUCET_AMOUNT, FAUCET_BELOW } from "../../lib/mintdex/constants";
import { FLOW, MODE_COPY } from "../../lib/mintdex/copy";
import { sol, untilText } from "../../lib/mintdex/format";
import type { CoinSummary, Me } from "../../lib/mintdex/types";
import { DEVNET_SITE_NOTE } from "../../lib/mintdex/site-host";
import { writeViewport } from "../../lib/mintdex/viewport";
import { setMe } from "./hooks";
import { useMe, useSessionUi } from "./session";
import { Sheet } from "./sheet";
import { Ticker } from "./Ticker";
import { LiveWalletButton } from "../carddex/live/LiveWalletButton";
import { LiveLaunchGuide } from "../carddex/live/LiveLaunchGuide";
import { useLiveWallet } from "../carddex/live/wallet";
import { useLiveLaunchOpen } from "../carddex/live/readiness";
import "../../royal-motion.css";
import "../../carddex-viewport.css";
import { GyroChip } from "./card3d/GyroChip";
import { ConfirmDialog } from "./trust";
import {
  Avatar,
  Button,
  CalmSwitch,
  GenIcon,
  Hallmark,
  isDialogOpen,
  isTypingTarget,
  Num,
  Thumb,
  useToast,
  type GenIconName,
} from "./ui";

type TabPath = "/" | "/discover" | "/launch" | "/market" | "/levels" | "/portfolio";

const TABS: Array<{ to: TabPath; label: string; icon: GenIconName; exact?: boolean }> = [
  { to: "/", label: "Home", icon: "cards", exact: true },
  { to: "/discover", label: "Discover", icon: "volume" },
  { to: "/launch", label: "Launch", icon: "launch" },
  // "Designs" is the one word for the card looks (backlog P0-9); the URL stays /levels.
  { to: "/levels", label: "Designs", icon: "levelup" },
  { to: "/portfolio", label: "Portfolio", icon: "deed" },
];

/** Which rail tab owns a path. Coin pages belong to Discover (the dex). */
function tabIndex(pathname: string) {
  if (pathname === "/") return 0;
  if (pathname.startsWith("/coin/")) return 1;
  return TABS.findIndex(
    (t) => t.to !== "/" && (pathname === t.to || pathname.startsWith(`${t.to}/`)),
  );
}

function useActiveTab() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return tabIndex(pathname);
}

/** A page change that is still loading after 120ms (P0-2): fast changes never flash a loading state. */
const PENDING_AFTER_MS = 120;

function useRoutePending() {
  const pending = useRouterState({ select: (s) => s.status === "pending" });
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), PENDING_AFTER_MS);
    return () => clearTimeout(t);
  }, [pending]);
  return shown;
}

/**
 * The page-change line (backlog P0-2): a 2px ink line along the top of the content column that creeps toward
 * the end while the next page loads (only after 120ms) and completes and fades when it lands. The rail and tab
 * bar already show the new tab (decision C2). Reduced motion: a still line while loading, gone when done.
 */
function RouteProgress({ loading }: { loading: boolean }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  useEffect(() => {
    if (loading) {
      setPhase("loading");
      return;
    }
    setPhase((p) => (p === "loading" ? "done" : p));
  }, [loading]);
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 480);
    return () => clearTimeout(t);
  }, [phase]);
  return <div aria-hidden className="mdx-routebar" data-phase={phase} />;
}

/**
 * Page changes for keyboard and screen reader users (backlog P1-16). After a new page renders (a path change,
 * never a search change such as a filter or the Home card, and never the first load), focus moves to the
 * page's heading, unless it already sits on something inside the page (a field that took focus on purpose),
 * and the new page title is read out through a polite status region.
 */
function RouteAnnouncer() {
  const router = useRouter();
  const [said, setSaid] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = router.subscribe("onRendered", (e) => {
      if (!e.pathChanged) return;
      clearTimeout(timer);
      // After the page's own effects (a search field focusing itself) and the head's new title.
      timer = setTimeout(() => {
        const main = document.getElementById("content");
        if (!main) return;
        const active = document.activeElement;
        const settled = active instanceof HTMLElement && active !== main && main.contains(active);
        if (!settled && !isTypingTarget(active)) {
          const heading = Array.from(main.querySelectorAll<HTMLElement>("h1")).find(
            (h) => h.getClientRects().length > 0,
          );
          const target = heading ?? main;
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
          target.focus({ preventScroll: true });
        }
        // A trailing no-break space alternates, so returning to the same page is announced again.
        setSaid((prev) => (prev === document.title ? `${document.title}\u00a0` : document.title));
      }, 60);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [router]);
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {said}
    </div>
  );
}

/** The simplified collection has no unread marketplace notifications. */
function unreadOf(me: Me) {
  return 0;
}

// ---------------------------------------------------------------- rail pieces

/** A sculpted card-and-crown symbol anchors the original navigation rail. */
function Lockup() {
  return (
    <Link to="/" aria-label="Launch a Card home" className="flex h-[52px] w-[52px] flex-none items-center self-start">
      <Hallmark size={52} />
    </Link>
  );
}

/** "glorb", "$GLORB", " Glorb ": the search text people type, compared without case or the "$". */
function norm(text: string) {
  return text.trim().replace(/^\$+/, "").toLowerCase();
}

/** Up to five coins for the suggestion list: exact name or ticker first, then prefixes, then the rest. */
function suggest(coins: CoinSummary[], text: string) {
  const t = norm(text);
  if (!t) return [];
  const rank = (c: CoinSummary) => {
    const name = c.name.toLowerCase();
    const ticker = c.ticker.toLowerCase();
    if (name === t || ticker === t) return 0;
    if (ticker.startsWith(t) || name.startsWith(t)) return 1;
    if (name.includes(t) || ticker.includes(t)) return 2;
    return 3;
  };
  return coins
    .map((c, i) => ({ c, r: rank(c), i }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, 5)
    .map((x) => x.c);
}

/**
 * Rail search (P1-14). It reads the query from the router, so it always shows the search on screen (Clear
 * empties it). On Discover it merges into the current filters (the design and sort stay); elsewhere it opens
 * Discover with just the search. An exact name or ticker goes straight to the coin. While typing, a list of up
 * to five matches from the coin list opens under the field: arrow keys move, Enter opens, Escape closes
 * (ARIA combobox pattern).
 */
function SearchBox({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const navigate = useNavigate();
  const listId = useId();
  const location = useRouterState({ select: (st) => st.location });
  const onDiscover = location.pathname === "/discover";
  const routerQ = onDiscover ? ((location.search as { q?: string }).q ?? "") : "";
  const [q, setQ] = useState(routerQ);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);

  // Follow the router: a Clear on Discover, Back, or leaving Discover shows the search that is on screen.
  useEffect(() => setQ(routerQ), [routerQ]);

  // The coin list for suggestions, fetched the first time the field is used (shared with Discover's cache).
  const [wanted, setWanted] = useState(false);
  const { data: coins } = useQuery({
    queryKey: ["coins", {}],
    queryFn: () => (IS_SIM ? listCoins({ data: {} }) : chainCoinList()),
    enabled: wanted,
    staleTime: 60_000,
  });
  const matches = useMemo(() => suggest(coins ?? [], q), [coins, q]);
  const open = focused && !dismissed && matches.length > 0;

  function go(coin: CoinSummary) {
    setActive(-1);
    setDismissed(true);
    inputRef.current?.blur();
    void navigate({ to: "/coin/$id", params: { id: coin.id } });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (open && active >= 0 && matches[active]) {
      go(matches[active]);
      return;
    }
    const t = norm(q);
    // An exact name or ticker goes straight to the coin.
    const exact = t ? (coins ?? []).find((c) => c.ticker.toLowerCase() === t || c.name.toLowerCase() === t) : undefined;
    if (exact) {
      go(exact);
      return;
    }
    const next = q.trim() || undefined;
    if (onDiscover) {
      void navigate({ to: "/discover", search: (p) => ({ ...p, q: next, page: undefined }) });
    } else {
      void navigate({ to: "/discover", search: { q: next } });
    }
    setDismissed(true);
    inputRef.current?.blur();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      setDismissed(false);
      const n = matches.length;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Escape") {
      // First Escape closes the list, the second leaves the field.
      if (open) {
        e.preventDefault();
        setDismissed(true);
        setActive(-1);
      } else {
        e.currentTarget.blur();
      }
    }
  }

  const activeId = open && active >= 0 && matches[active] ? `${listId}-${matches[active].id}` : undefined;

  return (
    <form onSubmit={submit} role="search" className="relative w-full">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden
        fill="none"
      >
        <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="m10.5 10.5 3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <label htmlFor="rail-search" className="sr-only">
        Search coins
      </label>
      <input
        ref={inputRef}
        id="rail-search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(-1);
          setDismissed(false);
          setWanted(true);
        }}
        onFocus={() => {
          setFocused(true);
          setWanted(true);
        }}
        onBlur={() => {
          setFocused(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search coins"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
        className="mdx-input h-10 rounded-pill pl-9 pr-9 text-[14px]"
      />
      {!focused && !q && (
        <kbd
          aria-hidden
          className="num pointer-events-none absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-chip bg-tint text-[12px] text-slate"
        >
          /
        </kbd>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching coins"
        hidden={!open}
        className="mdx-menu mdx-pop absolute inset-x-0 top-[calc(100%_+_6px)] z-50"
      >
        {open
          ? matches.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${c.id}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                // Keep focus in the field while picking with the pointer.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(c)}
                onMouseEnter={() => setActive(i)}
                className="mdx-menu-item mdx-suggest cursor-pointer gap-2.5"
              >
                <Thumb src={c.image} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{c.name}</span>
                <span className="flex-none text-[12px] text-slate">${c.ticker}</span>
              </li>
            ))
          : null}
      </ul>
    </form>
  );
}

/**
 * Six tabs with one sliding sheet pill under the active row; the active tab's icon tile wears the foil
 * (each row catches it at its own angle, --row). Coin pages light Discover.
 */
function RailNav({ pending }: { pending: boolean }) {
  const active = useActiveTab();
  const unread = unreadOf(useMe());
  return (
    <nav aria-label="Main" className="relative flex flex-col">
      {TABS.map((t, i) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: !!t.exact }}
          className="mdx-tab"
          data-active={i === active}
          // The tab the page belongs to without being its route (coin pages light Discover): the router
          // marks its own route aria-current="page", which wins over this (P1-16).
          aria-current={i === active ? "location" : undefined}
          data-pending={(pending && i === active) || undefined}
          style={{ "--row": i } as CSSProperties}
        >
          <span className="mdx-tab__tile">
            {/* The active tile's foil drifts slowly (L11): an oversized sheet moved by transform. */}
            <span aria-hidden className="mdx-tab__foil">
              <i />
            </span>
            <GenIcon name={t.icon} size={18} />
          </span>
          {t.label}
          {t.to === "/portfolio" && unread > 0 ? <UnreadBadge count={unread} /> : null}
        </Link>
      ))}
      {/* One pill for the whole nav: it springs to the active row (z-index keeps it under the links). */}
      <span
        aria-hidden
        className="mdx-rail-pill"
        style={{ "--i": Math.max(0, active), opacity: active < 0 ? 0 : 1 } as CSSProperties}
      />
    </nav>
  );
}

/** The unread count on the Portfolio tab (P1-13): an ink pill, read as ", 3 new" by screen readers. */
function UnreadBadge({ count, dot = false }: { count: number; dot?: boolean }) {
  const text = count > 9 ? "9+" : String(count);
  return (
    <>
      <span aria-hidden className={dot ? "mdx-badge mdx-badge--dot" : "mdx-badge num"}>
        {dot ? null : text}
      </span>
      <span className="sr-only">, {count} new</span>
    </>
  );
}

function useWalletActions(close: () => void) {
  const toast = useToast();
  const qc = useQueryClient();
  const { openEnter } = useSessionUi();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function faucet() {
    setBusy(true);
    try {
      const r = await claimFaucet();
      if (r.ok) {
        toast("ok", `Faucet sent ${sol(FAUCET_AMOUNT, 0)} ${MODE_COPY.walletUnit}.`);
        close();
        // The answer carries the fresh wallet (P0-12): show it now, refresh the portfolio in the background.
        setMe(qc, r.me);
        void qc.invalidateQueries({ queryKey: ["portfolio"] });
      } else toast("err", r.error);
    } catch {
      toast("err", FLOW.connection);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Start over (backlog P0-7, decision C12): leaves this test account for good, behind a ConfirmDialog that
   * says exactly what is lost. There is no Sign out in test mode, because a handle cannot be entered again.
   */
  async function leave(handle: string) {
    setLeaving(true);
    try {
      const r = await signOut().catch(() => null);
      if (!r?.ok) {
        toast("err", `${FLOW.connection} You are still @${handle}.`);
        return false;
      }
      qc.setQueryData(["me"], null);
      // Viewer-specific data (holdings, bids, the portfolio) refreshes in the background; the wallet is set.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      toast("ok", `You left @${handle}.`);
      openEnter("Pick a new handle to start again.");
      return true;
    } finally {
      setLeaving(false);
    }
  }

  return { faucet, leave, busy, leaving };
}

/** The faucet row's words: claim now, when it opens again, or the balance it opens under. */
function faucetLabelOf(me: NonNullable<Me>) {
  return me.canFaucet
    ? FLOW.claimFaucet
    : me.balance < FAUCET_BELOW && me.faucetReadyAt
      ? `Faucet opens ${untilText(me.faucetReadyAt)}`
      : `Faucet opens under ${sol(FAUCET_BELOW, 0)} SOL`;
}

/** Start over (P0-7): leaving a test account for good, behind a dialog that says exactly what is lost. */
function StartOverDialog({
  handle,
  open,
  onOpenChange,
  leaving,
  leave,
}: {
  handle: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leaving: boolean;
  leave: (handle: string) => Promise<boolean>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start over with a new handle?"
      confirmLabel={`Leave @${handle}`}
      cancelLabel="Keep playing"
      pending={leaving}
      pendingLabel="Leaving..."
      onConfirm={async () => {
        if (await leave(handle)) onOpenChange(false);
      }}
    >
      <p>
        You leave @{handle} on this browser for good. Its tokens and cards stay with
        @{handle}, and nobody can enter it again, you included. The handle stays taken.
      </p>
    </ConfirmDialog>
  );
}

function WalletBlock() {
  const me = useMe();
  const { openEnter } = useSessionUi();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { faucet, leave, busy, leaving } = useWalletActions(() => setOpen(false));

  if (!me) {
    return (
      <div className="flex flex-col gap-2">
        <Button block onClick={() => openEnter()}>
          Try the demo
        </Button>
        {MODE_COPY.railStart ? (
          <p className="text-[11px] leading-[1.3] text-slate">Test funds. No wallet needed.</p>
        ) : null}
      </div>
    );
  }

  const faucetLabel = faucetLabelOf(me);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-[52px] items-center gap-3 rounded-pop bg-sheet px-3 text-left shadow-raise transition-[box-shadow,translate] duration-(--t-base) ease-room hover:-translate-y-px hover:shadow-lift data-[state=open]:shadow-lift"
        >
          <Avatar handle={me.handle} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-[1.3] text-slate">
              @{me.handle}
            </span>
            <span className="block leading-[1.2]">
              <Num size="md" watch={me.balance} tick>
                {sol(me.balance, 2)}
              </Num>
              <span className="text-[13px] font-medium text-slate"> SOL</span>
            </span>
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="mdx-menu mdx-pop z-50 flex w-[var(--radix-popover-trigger-width)] min-w-[200px] flex-col outline-none"
        >
          <Link to="/portfolio" className="mdx-menu-item" onClick={() => setOpen(false)}>
            Open portfolio
          </Link>
          <button
            type="button"
            className="mdx-menu-item"
            onClick={faucet}
            disabled={!me.canFaucet || busy}
          >
            {busy ? "Claiming..." : faucetLabel}
          </button>
          <button
            type="button"
            className="mdx-menu-item"
            onClick={() => {
              setOpen(false);
              setConfirm(true);
            }}
          >
            Start over
          </button>
        </Popover.Content>
      </Popover.Portal>
      <StartOverDialog
        handle={me.handle}
        open={confirm}
        onOpenChange={setConfirm}
        leaving={leaving}
        leave={leave}
      />
    </Popover.Root>
  );
}

function Rail({
  searchRef,
  pending,
  liveLaunch = false,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  pending: boolean;
  liveLaunch?: boolean;
}) {
  const me = useMe();
  const { openGuide } = useSessionUi();
  return (
    <aside className="mdx-rail mdx-scroll hidden w-[224px] flex-none flex-col overflow-y-auto overflow-x-hidden px-4 pb-4 pt-5 lg:flex">
      {/* The test-mode pill sits inline beside the wordmark (backlog P0-5), so it adds no rail row. */}
      <div className="flex items-center gap-1">
        <Lockup />
      </div>
      <div className="mt-5">
        <SearchBox inputRef={searchRef} />
      </div>
      <div className="mt-5">
        <RailNav pending={pending} />
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        {/* Two quiet links, each at least 24px tall (WCAG 2.5.8 target size). */}
        <div className="flex flex-col items-start gap-0.5">
          {liveLaunch ? <LiveLaunchGuide /> : <button
            type="button"
            onClick={openGuide}
            className="mdx-link inline-flex min-h-6 items-center text-[14px]"
          >
            How Launch a Card works
          </button>}
          <Link
            to="/legal"
            className="mdx-link inline-flex min-h-6 items-center text-[13px] font-normal text-slate"
          >
            Terms, privacy and risks
          </Link>
        </div>
        {liveLaunch ? <LiveWalletButton /> : IS_SIM ? <WalletBlock /> : <ChainRailWallet />}
        {!liveLaunch && me && MODE_COPY.walletNote ? (
          <p className="text-[12px] leading-[1.3] text-slate">{MODE_COPY.walletNote}</p>
        ) : null}
        {/* Under the wallet block: the site-wide Calm motion switch (10.2). */}
        <CalmSwitch />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- mobile

/**
 * Open the next sheet once the closing one has gone (its 200ms slide, and its focus handed back to the header
 * button), so the next sheet remembers that button and returns focus to it.
 */
function afterSheet(fn: () => void) {
  setTimeout(fn, 260);
}

function SearchGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none">
      <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One-tap search (P1-6). On Discover the tap focuses its search field right away. Elsewhere it focuses an
 * off-screen field first (inside the tap, so the phone keyboard opens), then opens /discover?focus=1, where
 * the real field takes focus and keeps the keyboard up.
 */
function SearchButton() {
  const proxy = useRef<HTMLInputElement>(null);
  return (
    <>
      <Link
        to="/discover"
        search={{ focus: 1 }}
        aria-label="Search coins"
        className="grid h-11 w-11 place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track"
        onClick={(e) => {
          const field = document.getElementById("token-search") ?? document.getElementById("discover-search");
          if (field instanceof HTMLInputElement && field.offsetParent !== null) {
            e.preventDefault();
            field.focus();
            return;
          }
          proxy.current?.focus({ preventScroll: true });
        }}
      >
        <SearchGlyph />
      </Link>
      <input
        ref={proxy}
        aria-hidden
        tabIndex={-1}
        inputMode="search"
        autoComplete="off"
        className="mdx-kb-proxy"
        onBlur={(e) => {
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}

function GuideGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none">
      <circle cx="10" cy="10" r="7.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.9 7.9a2.15 2.15 0 1 1 3.02 1.97c-.55.25-.92.72-.92 1.33v.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="13.9" r="0.95" fill="currentColor" />
    </svg>
  );
}

/**
 * The account sheet (P1-6): handle and wallet, then Portfolio, the faucet with its timer, How Launch a Card works,
 * Terms, privacy and risks, and Start over. On devnet this is where wallet connect, disconnect, the address
 * copy and the network badge go.
 */
function AccountSheet({
  me,
  open,
  onOpenChange,
}: {
  me: NonNullable<Me>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { openGuide } = useSessionUi();
  const [accountTab,setAccountTab] = useState("account");
  const [confirm, setConfirm] = useState(false);
  const close = () => onOpenChange(false);
  const { faucet, leave, busy, leaving } = useWalletActions(close);
  const unread = unreadOf(me);
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Your account">
        <div className="cdx-view-tabs" aria-label="Account sections"><button type="button" aria-pressed={accountTab==="account"} onClick={()=>setAccountTab("account")}>Account</button><button type="button" aria-pressed={accountTab==="help"} onClick={()=>setAccountTab("help")}>Help & settings</button></div>
        {accountTab === "account" ? <>
        <div className="flex items-center gap-3 rounded-pop bg-sheet p-3 shadow-raise">
          <Avatar handle={me.handle} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[14px] leading-[1.3] text-slate">@{me.handle}</p>
            <p className="leading-[1.2]">
              <Num size="lg" watch={me.balance} tick>
                {sol(me.balance, 2)}
              </Num>
              <span className="text-[14px] font-medium text-slate"> SOL</span>
            </p>
          </div>
          {MODE_COPY.walletNote ? (
            <span className="ml-auto self-start whitespace-nowrap text-[12px] leading-[1.3] text-slate">
              {MODE_COPY.walletNote}
            </span>
          ) : null}
        </div>
        {/* Devnet: wallet connect and disconnect, the address copy and the network badge go here. */}
        <nav aria-label="Account" className="-mx-3 mt-3 flex flex-col">
          <Link to="/portfolio" className="mdx-menu-item gap-2 text-[15px]" onClick={close}>
            Portfolio
            {unread > 0 ? (
              <span className="text-[13px] text-slate">
                <span className="num">{unread}</span> new
              </span>
            ) : null}
          </Link>
          <button
            type="button"
            className="mdx-menu-item text-[15px]"
            onClick={faucet}
            disabled={!me.canFaucet || busy}
          >
            {busy ? "Claiming..." : faucetLabelOf(me)}
          </button>
        </nav></> : <><nav aria-label="Help and settings" className="mt-3 flex flex-col">
          <button
            type="button"
            className="mdx-menu-item text-[15px]"
            onClick={() => {
              close();
              afterSheet(openGuide);
            }}
          >
            How Launch a Card works
          </button>
          <Link to="/legal" className="mdx-menu-item text-[15px]" onClick={close}>
            Terms, privacy and risks
          </Link>
          <button
            type="button"
            className="mdx-menu-item text-[15px] text-slate"
            onClick={() => {
              close();
              afterSheet(() => setConfirm(true));
            }}
          >
            Start over
          </button>
        </nav>
        <CalmSwitch size="md" className="mt-2 border-t border-rule pt-3" /></>}
      </Sheet>
      <StartOverDialog
        handle={me.handle}
        open={confirm}
        onOpenChange={setConfirm}
        leaving={leaving}
        leave={leave}
      />
    </>
  );
}

/**
 * Phone header (P1-6): the Launch a Card mark and the test-mode pill, then one-tap search and either the wallet button
 * (balance and avatar: opens the account sheet, with a dot for unread notifications) or the guide icon and
 * Enter Launch a Card. 44px targets; the side insets clear a notch held sideways.
 */
function MobileHeader({ liveLaunch = false }: { liveLaunch?: boolean }) {
  const me = useMe();
  const { openEnter, openGuide } = useSessionUi();
  const [account, setAccount] = useState(false);
  const unread = unreadOf(me);
  return (
    <header className="mdx-mhead sticky top-0 z-30 flex h-14 flex-none items-center gap-3 bg-wall px-4 lg:hidden">
      <Link to="/" aria-label="Launch a Card home" className="-ml-2 grid h-11 w-11 place-items-center">
        <Hallmark size={28} />
      </Link>
      <div className="-mr-1.5 ml-auto flex items-center gap-1">
        <SearchButton />
        {liveLaunch ? <><LiveLaunchGuide compact /><LiveWalletButton compact /></> : !IS_SIM ? (
          <ChainHeaderAccount />
        ) : me ? (
          <button
            type="button"
            onClick={() => setAccount(true)}
            aria-haspopup="dialog"
            aria-label={`Your account, @${me.handle}, ${sol(me.balance, 2)} ${MODE_COPY.walletUnit}${unread ? `, ${unread} new` : ""}`}
            className="flex h-11 items-center gap-2 rounded-pill pl-2 pr-1 transition-colors duration-(--t-fast) ease-room hover:bg-track"
          >
            <span className="whitespace-nowrap">
              <Num size="sm" watch={me.balance} tick className="text-[15px]!">
                {sol(me.balance, 2)}
              </Num>
              <span className="text-[13px] font-medium text-slate">&nbsp;SOL</span>
            </span>
            <span className="relative">
              <Avatar handle={me.handle} size={30} />
              {unread > 0 ? (
                <span
                  aria-hidden
                  className="mdx-badge mdx-badge--dot -right-0.5 -top-0.5 shadow-[0_0_0_2px_var(--color-wall)]"
                />
              ) : null}
            </span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={openGuide}
              aria-label="How Launch a Card works"
              className="grid h-11 w-11 place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track"
            >
              <GuideGlyph />
            </button>
            <Button size="sm" className="ml-1" onClick={() => openEnter()}>
              <span className="max-[359px]:hidden">Enter Launch a Card</span>
              <span className="hidden max-[359px]:inline">Enter</span>
            </Button>
          </>
        )}
      </div>
      {!liveLaunch && IS_SIM && me ? <AccountSheet me={me} open={account} onOpenChange={setAccount} /> : null}
    </header>
  );
}

/**
 * html[data-keyboard] while the on-screen keyboard is actually up (QA): a text field has focus AND the viewport
 * has shrunk well below the tallest height seen at this width. A field that keeps focus after the keyboard is
 * closed (Android's back gesture) brings the tab bar back, which a rule keyed on focus alone never did.
 * Client only: the server HTML and the first frame always show the bar.
 */
function useKeyboardFlag() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    let tall = 0;
    let width = window.innerWidth;
    const update = () => {
      // A rotation (new width) starts the tallest height again.
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tall = 0;
      }
      const h = Math.min(window.innerHeight, vv?.height ?? window.innerHeight);
      tall = Math.max(tall, h);
      const up = isTypingTarget(document.activeElement) && h < tall - 120;
      root.toggleAttribute("data-keyboard", up);
    };
    update();
    vv?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      vv?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.removeAttribute("data-keyboard");
    };
  }, []);
}

function MobileTabs({ pending }: { pending: boolean }) {
  const active = useActiveTab();
  const unread = unreadOf(useMe());
  useKeyboardFlag();
  return (
    <nav
      aria-label="Main"
      data-tabbar
      className="mdx-mobile-tabs fixed inset-x-0 bottom-0 z-30 flex rounded-t-panel bg-plinth pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-14px_rgb(58_44_28/0.22)] lg:hidden"
    >
      {TABS.map((t, i) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: !!t.exact }}
          className="mdx-mtab h-16"
          data-active={i === active}
          aria-current={i === active ? "location" : undefined}
          data-pending={(pending && i === active) || undefined}
        >
          <span className="mdx-mtab__icon">
            <GenIcon name={t.icon} size={20} />
            {t.to === "/portfolio" && unread > 0 ? <UnreadBadge count={unread} dot /> : null}
          </span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- shell

/**
 * Desktop: a 224px rail on the canvas (Launch a Card lockup, pill search, five tabs with one sliding pill, guide,
 * wallet card) and the canvas content area. No top bar, no rail panel, no edge line.
 * At 1280x720 and up `main` never scrolls; 1024 to 1279 may scroll as a fallback. `mdx-main` gives full
 * height asides their --gutter (12px float above 820px tall, flush below) and --bleed.
 * Phones (under 1024): 56px canvas header (search, account sheet or guide and Enter), 64px panel tab bar with
 * rounded top corners (44px when held sideways), natural page scroll, safe-area insets on every side.
 */
/**
 * The devnet test site's one line (launch-plan §6 APP, lib/mintdex/site-host.ts): above the page on every width,
 * one row of slate text identifying its configured network.
 */
function DevnetSiteNote() {
  const n = DEVNET_SITE_NOTE;
  return (
    <p
      role="note"
      data-testid="devnet-site-note"
      className="flex-none border-b border-hairline bg-plinth px-4 py-1.5 text-center text-[13px] leading-5 text-slate lg:px-6"
    >
      {n.lead}
      {n.link ? (
        <>
          {" "}
          <a href={n.href} className="mdx-link mdx-hit font-medium text-ink">
            {n.link}
          </a>
          .
        </>
      ) : null}
    </p>
  );
}

/**
 * Collector paper and engraving sit behind the existing slow light and perspective floor. Only the two
 * ambient light layers and floor move; the engraving stays crisp. Hidden documents, Calm and reduced motion
 * keep a still composition.
 */
function Sky() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => el.toggleAttribute("data-paused", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return (
    <div ref={ref} aria-hidden className="mdx-sky">
      <i className="mdx-sky__engraving" />
      <i className="mdx-sky__stars" />
      <i className="mdx-sky__floor">
        <i>
          <b />
        </i>
      </i>
      <i className="mdx-sky__a mdx-sky__a--1" />
      <i className="mdx-sky__a mdx-sky__a--2" />
    </div>
  );
}

function LocalDemoNote() {
  return <p role="note" data-testid="local-demo-note" className="flex-none border-b border-hairline bg-plinth px-4 py-1.5 text-center text-[12px] leading-5 text-slate"><span className="font-semibold text-ink">Demo collection</span><span aria-hidden> · </span>Test balances and trading.</p>;
}

export function AppShell({ children, devnetSite = false }: { children: ReactNode; devnetSite?: boolean }) {
  useLiveWallet();
  const searchRef = useRef<HTMLInputElement>(null);
  const pending = useRoutePending();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // The mainnet banner and wallet chrome show only for an explicit mainnet choice while the owner has launches on.
  const liveLaunch = useLiveLaunchOpen(useRouterState({ select: s => s.location.pathname === "/launch" && (s.location.search as { mode?: string }).mode === "live" }));

  // Dynamic browser chrome and software keyboards resize the actual usable canvas.
  useEffect(() => {
    const root=document.documentElement;
    const vv=window.visualViewport;
    const sync=()=>{if(!vv || vv.scale===1)root.style.setProperty("--cdx-app-height",`${Math.min(window.innerHeight,vv?.height??window.innerHeight)}px`);};
    sync();
    vv?.addEventListener("resize",sync);
    window.addEventListener("resize",sync);
    return()=>{vv?.removeEventListener("resize",sync);window.removeEventListener("resize",sync);root.style.removeProperty("--cdx-app-height");};
  },[]);

  // The viewport cookie (P1-20): the next server render lays out fitted grids for this screen.
  useEffect(() => {
    writeViewport();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(writeViewport, 400);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
    };
  }, []);

  // "/" focuses the rail search from anywhere (not while typing in a field or inside a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      const el = searchRef.current;
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      el.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    // relative isolate: the sky (L9) sits behind every page on the wall, above this root's own background.
    <div data-screen={path === "/" ? "home" : path.split("/")[1]} className="cdx-app cdx-viewport relative isolate flex min-h-dvh bg-wall text-ink lg:h-dvh lg:overflow-hidden">
      <Sky />
      {/* First stop for keyboard users (P1-24): skips the rail's search, six tabs and wallet. */}
      <a
        href="#content"
        className="mdx-skip"
        onClick={(e) => {
          // Move focus without writing #content into the URL (the router owns the address).
          const main = document.getElementById("content");
          if (!main) return;
          e.preventDefault();
          main.focus();
        }}
      >
        Skip to content
      </a>
      <Rail searchRef={searchRef} pending={pending} liveLaunch={liveLaunch} />
      <div className="cdx-shell-content flex min-w-0 flex-1 flex-col">
        <RouteProgress loading={pending} />
        <RouteAnnouncer />
        {/* IS_DEVNET is a literal: the note and its words are not in the mainnet or sim bundle. */}
        {IS_DEVNET && devnetSite ? <DevnetSiteNote /> : null}
        {liveLaunch ? <p role="note" data-testid="live-launch-note" className="flex-none border-b border-hairline bg-plinth px-4 py-1.5 text-center text-[12px] leading-5 text-slate"><span className="font-semibold text-ink">Solana mainnet</span><span aria-hidden> · </span>Wallet approval required.</p> : IS_SIM ? <LocalDemoNote /> : null}
        <MobileHeader liveLaunch={liveLaunch} />
        {/* The live trade ticker (hype arcade): the real activity feed, scrolling. */}
        {/* Deep-linked card grids need the same explicit permission option as the Home display. */}
        {/* --main-pad mirrors the padding so full-height asides can bleed to the content edges with
            calc(var(--main-pad) * -1) instead of copying 24px / 16px.
            Phones clip sideways (clip, not hidden: no scroll container, sticky still works): before
            hydration a measured view renders at its desktop fallback size, and the page must never
            scroll horizontally while it does. Bleeds into the padding stay visible. */}
        <main
          id="content"
          data-scroll-restoration-id="content"
          tabIndex={-1}
          aria-busy={pending || undefined}
          className="cdx-viewport-main mdx-main mdx-scroll min-h-0 flex-1 p-4 pb-[calc(80px_+_env(safe-area-inset-bottom))] [--main-pad:16px] max-lg:overflow-x-clip lg:overflow-x-hidden lg:overflow-y-auto lg:p-6 lg:[--main-pad:24px] short:p-4 short:[--main-pad:16px]">
          {children}
        </main>
        <MobileTabs pending={pending} />
      </div>
    </div>
  );
}
