import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { chainCoinList } from "../../lib/chain/data";
import { claimFaucet, listCoins, signOut } from "../../lib/mintdex/api";
import { IS_DEVNET, IS_SIM } from "../../lib/mintdex/mode";
import { ChainHeaderAccount } from "../chain/ConnectWallet";
import { FAUCET_AMOUNT, FAUCET_BELOW } from "../../lib/mintdex/constants";
import { FLOW, MODE_COPY } from "../../lib/mintdex/copy";
import { sol, untilText } from "../../lib/mintdex/format";
import type { CoinSummary, Me } from "../../lib/mintdex/types";
import { DEVNET_SITE_NOTE } from "../../lib/mintdex/site-host";
import { writeViewport } from "../../lib/mintdex/viewport";
import { setMe } from "./hooks";
import { useMe, useSessionUi } from "./session";
import { Sheet } from "./sheet";
import { afterLoadIdle } from "./opened-once";
import { useLiveRecoveryOpen } from "../carddex/live/readiness";
import { ConfirmDialog } from "./confirm";
import { ModeBadge } from "./trust";
import {
  Avatar,
  Button,
  CalmSwitch,
  GenIcon,
  Hallmark,
  Icon,
  IconButton,
  isDialogOpen,
  isTypingTarget,
  Num,
  Thumb,
  useToast,
  type GenIconName,
} from "./ui";

// Live launch chrome shows only on /launch?mode=live. Its wallet code (wallet-standard, ed25519) loads on demand so
// it stays out of every page's first download.
const LiveWalletButton = lazy(() => import("../carddex/live/LiveWalletButton").then((m) => ({ default: m.LiveWalletButton })));
const LiveLaunchGuide = lazy(() => import("../carddex/live/LiveLaunchGuide").then((m) => ({ default: m.LiveLaunchGuide })));

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

/** The product's mark and name on the column's left edge (the name folds away on narrow phones; the link keeps it). */
function Brand() {
  return (
    <Link to="/" aria-label="Launch a Card home" className="cdx-brand">
      <Hallmark size={24} />
      <span className="cdx-brand__name" aria-hidden>
        Launch a Card
      </span>
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
    <form onSubmit={submit} role="search" className="cdx-search">
      <Icon name="search" className="cdx-search__glyph" />
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
        className="cdx-search__input"
      />
      {!focused && !q && (
        <kbd
          aria-hidden
          className="cdx-search__key num"
        >
          /
        </kbd>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching coins"
        hidden={!open}
        className="mdx-menu mdx-pop cdx-search__list"
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
                className="mdx-menu-item mdx-suggest cursor-pointer gap-3"
              >
                <Thumb src={c.image} size={24} />
                <span className="min-w-0 flex-1 truncate text-body text-ink">{c.name}</span>
                <span className="flex-none text-caption text-slate">${c.ticker}</span>
              </li>
            ))
          : null}
      </ul>
    </form>
  );
}

/**
 * The desktop nav in the top bar (1024px and up): five text links, 14px slate, the current one in ink. Coin pages
 * light Discover. No pill, no icon tile, no hue (true-black-flat: brightness marks the active item).
 */
function TopNav({ pending }: { pending: boolean }) {
  const active = useActiveTab();
  const unread = unreadOf(useMe());
  return (
    <nav aria-label="Main" className="cdx-topnav">
      {TABS.map((t, i) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: !!t.exact }}
          className="cdx-topnav__link"
          data-active={i === active}
          // The tab the page belongs to without being its route (coin pages light Discover): the router
          // marks its own route aria-current="page", which wins over this (P1-16).
          aria-current={i === active ? "location" : undefined}
          data-pending={(pending && i === active) || undefined}
        >
          {t.label}
          {t.to === "/portfolio" && unread > 0 ? <UnreadBadge count={unread} /> : null}
        </Link>
      ))}
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

export function useWalletActions(close: () => void) {
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
export function faucetLabelOf(me: NonNullable<Me>) {
  return me.canFaucet
    ? FLOW.claimFaucet
    : me.balance < FAUCET_BELOW && me.faucetReadyAt
      ? `Faucet opens ${untilText(me.faucetReadyAt)}`
      : `Faucet opens under ${sol(FAUCET_BELOW, 0)} SOL`;
}

/** Start over (P0-7): leaving a test account for good, behind a dialog that says exactly what is lost. */
export function StartOverDialog({
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
      tone="danger"
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

const loadWalletMenu = () => import("./wallet-menu");
const WalletMenu = lazy(loadWalletMenu);

/** The pill shows "99.88 SOL": its name keeps those words together (WCAG 2.5.3) and says the kind after them. */
const BALANCE_NOTE = MODE_COPY.walletUnit === "SOL" ? "" : `, ${MODE_COPY.walletUnit.replace(/ SOL$/, "")} balance`;

/** The signed-in wallet's face in the top bar: avatar and balance in one 36px pill. The Radix menu around it
 * (wallet-menu.tsx) is a lazy chunk. */
export function WalletButton({ me, ...rest }: { me: NonNullable<Me> } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={`Wallet, @${me.handle}, ${sol(me.balance, 2)} SOL${BALANCE_NOTE}`}
      // Where focus lands when "Try the demo" leaves with the sign-in it opened (focus.ts focusNear).
      data-focus-home=""
      {...rest}
      className="cdx-wallet"
    >
      <Avatar handle={me.handle} size={24} />
      <span className="cdx-wallet__balance">
        <Num size="sm" watch={me.balance} tick>
          {sol(me.balance, 2)}
        </Num>
        <span className="mdx-unit"> SOL</span>
      </span>
    </button>
  );
}

/** Desktop account control: "Try the demo" (secondary) or the wallet menu. */
function AccountControl() {
  const me = useMe();
  const { openEnter } = useSessionUi();
  if (!me) {
    return (
      <Button size="sm" variant="outline" onClick={() => openEnter()}>
        Try the demo
      </Button>
    );
  }
  // Server HTML keeps its menu markup while the chunk loads; a fresh sign-in shows the plain button meanwhile.
  return (
    <Suspense fallback={<WalletButton me={me} />}>
      <WalletMenu me={me} />
    </Suspense>
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
        title="Search coins"
        className="mdx-btn mdx-btn--ghost mdx-btn--icon cdx-topbar__searchbtn"
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
        <Icon name="search" />
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

/**
 * The Menu sheet (phones, signed in; SPEC 3.3): one list, no tabs. The account card (handle and balance), Portfolio
 * and the faucet, How Launch a Card works, Terms, privacy and risks, the Calm motion switch, then Start over last.
 * On devnet this is where wallet connect, disconnect, the address copy and the network badge go.
 */
function MenuSheet({
  me,
  open,
  onOpenChange,
}: {
  me: NonNullable<Me>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { openGuide } = useSessionUi();
  const [confirm, setConfirm] = useState(false);
  const close = () => onOpenChange(false);
  const { faucet, leave, busy, leaving } = useWalletActions(close);
  const unread = unreadOf(me);
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Menu">
        <div className="cdx-menu-account">
          <Avatar handle={me.handle} size={40} />
          <div className="min-w-0">
            <p className="truncate text-body text-slate">@{me.handle}</p>
            <p>
              <Num size="lg" watch={me.balance} tick>
                {sol(me.balance, 2)}
              </Num>
              <span className="mdx-unit"> SOL</span>
            </p>
          </div>
          {MODE_COPY.walletNote ? <span className="ml-auto self-start text-caption text-slate">{MODE_COPY.walletNote}</span> : null}
        </div>
        <nav aria-label="Menu" className="cdx-menu-list">
          <Link to="/portfolio" className="mdx-menu-item gap-2" onClick={close}>
            Portfolio
            {unread > 0 ? (
              <span className="text-body text-slate">
                <span className="num">{unread}</span> new
              </span>
            ) : null}
          </Link>
          <button type="button" className="mdx-menu-item" onClick={faucet} aria-disabled={!me.canFaucet || busy || undefined} disabled={!me.canFaucet || busy}>
            {busy ? "Claiming..." : faucetLabelOf(me)}
          </button>
          <button
            type="button"
            className="mdx-menu-item"
            onClick={() => {
              close();
              afterSheet(openGuide);
            }}
          >
            How Launch a Card works
          </button>
          <Link to="/legal" className="mdx-menu-item" onClick={close}>
            Terms, privacy and risks
          </Link>
          <CalmSwitch size="md" className="cdx-menu-calm" />
          <button
            type="button"
            className="mdx-menu-item cdx-menu-danger"
            onClick={() => {
              close();
              afterSheet(() => setConfirm(true));
            }}
          >
            Start over
          </button>
        </nav>
      </Sheet>
      <StartOverDialog handle={me.handle} open={confirm} onOpenChange={setConfirm} leaving={leaving} leave={leave} />
    </>
  );
}

/**
 * The top bar, one 48px row on the page ground at every width (SHELL DECISION): the mark and name on the column's
 * left edge, the one demo signal (the Demo pill, which opens the explainer), the five nav links from 1024px, then
 * search (a field from 1024px, an icon below), help, Calm motion (from 1024px; phones have it in the footer and
 * the Menu sheet) and the demo or wallet control. It takes a 1px rule once the page scrolls under it.
 */
function TopBar({
  searchRef,
  pending,
  liveLaunch = false,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  pending: boolean;
  liveLaunch?: boolean;
}) {
  const me = useMe();
  const { openEnter, openGuide } = useSessionUi();
  const [menu, setMenu] = useState(false);
  const unread = unreadOf(me);
  // Discover has its own search field under its title: the bar hands over to it (the icon and "/" focus that
  // field), so a desktop screen never shows two search fields (browse-13, chrome-13).
  const pageSearch = useRouterState({ select: (s) => s.location.pathname === "/discover" });
  return (
    <header className="cdx-topbar" data-topbar>
      <div className="cdx-topbar__inner">
        <div className="cdx-topbar__lead">
          <Brand />
          {liveLaunch ? null : <ModeBadge className="cdx-demo-pill" />}
        </div>
        <TopNav pending={pending} />
        <div className="cdx-topbar__tools" data-page-search={pageSearch || undefined}>
          <div className="cdx-topbar__search">
            <SearchBox inputRef={searchRef} />
          </div>
          <SearchButton />
          {liveLaunch ? (
            <Suspense fallback={null}>
              <LiveLaunchGuide compact />
            </Suspense>
          ) : (
            <IconButton icon="help" label="How Launch a Card works" onClick={openGuide} />
          )}
          <CalmSwitch compact className="cdx-topbar__calm" />
          {liveLaunch ? (
            <Suspense fallback={null}>
              <LiveWalletButton compact quiet />
            </Suspense>
          ) : !IS_SIM ? (
            <ChainHeaderAccount />
          ) : me ? (
            <>
              <div className="cdx-only-desk">
                <AccountControl />
              </div>
              <button
                type="button"
                onClick={() => setMenu(true)}
                aria-haspopup="dialog"
                aria-label={`Menu, @${me.handle}, ${sol(me.balance, 2)} SOL${BALANCE_NOTE}${unread ? `, ${unread} new` : ""}`}
                data-focus-home=""
                className="cdx-wallet cdx-only-phone"
              >
                <span className="relative">
                  <Avatar handle={me.handle} size={24} />
                  {unread > 0 ? <span aria-hidden className="mdx-badge mdx-badge--dot -right-0.5 -top-0.5" /> : null}
                </span>
                <span className="cdx-wallet__balance">
                  <Num size="sm" watch={me.balance} tick>
                    {sol(me.balance, 2)}
                  </Num>
                  <span className="mdx-unit"> SOL</span>
                </span>
              </button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => openEnter()}>
              <span className="max-[359px]:hidden">Try the demo</span>
              <span className="hidden max-[359px]:inline">Demo</span>
            </Button>
          )}
        </div>
      </div>
      {!liveLaunch && IS_SIM && me ? <MenuSheet me={me} open={menu} onOpenChange={setMenu} /> : null}
    </header>
  );
}

/**
 * The page foot, at the end of every page's scroll: How Launch a Card works and Terms, privacy and risks, plus the
 * Calm motion switch on phones (the top bar carries it from 1024px).
 */
function Footer({ liveLaunch = false }: { liveLaunch?: boolean }) {
  const { openGuide } = useSessionUi();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <footer className="cdx-footer">
      <nav aria-label="About Launch a Card" className="cdx-footer__links">
        {liveLaunch ? (
          <Suspense fallback={null}>
            <LiveLaunchGuide />
          </Suspense>
        ) : (
          <button type="button" className="mdx-link mdx-hit" onClick={openGuide}>
            How Launch a Card works
          </button>
        )}
        <Link to="/legal" className="mdx-link mdx-hit" aria-current={path === "/legal" ? "page" : undefined}>
          Terms, privacy and risks
        </Link>
      </nav>
      <CalmSwitch className="cdx-footer__calm" />
    </footer>
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
      className="mdx-mobile-tabs cdx-tabbar"
    >
      {TABS.map((t, i) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: !!t.exact }}
          className="mdx-mtab"
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
 * The shell: the 48px top bar, then <main> (the page's one scroller at every width: views grow with their content,
 * nothing inside a page scrolls on its own), then the phone tab bar below 1024px (44px when held sideways).
 * Safe-area insets on every side.
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
      className="cdx-shellnote"
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

/** Keeps the live wallet registry open across pages, loaded once the page has loaded and is idle. */
function useLiveWalletRegistry() {
  useEffect(() => {
    let release: (() => void) | undefined;
    let gone = false;
    const cancel = afterLoadIdle(() => void import("../carddex/live/wallet").then((m) => { if (!gone) release = m.mountRegistry(); }));
    return () => {
      gone = true;
      cancel();
      release?.();
    };
  }, []);
}

export function AppShell({ children, devnetSite = false }: { children: ReactNode; devnetSite?: boolean }) {
  useLiveWalletRegistry();
  const searchRef = useRef<HTMLInputElement>(null);
  const pending = useRoutePending();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // The mainnet banner and wallet chrome show only for an explicit mainnet choice while the owner has launches, or
  // at least saved-launch recovery, on.
  const liveLaunch = useLiveRecoveryOpen(useRouterState({ select: s => s.location.pathname === "/launch" && (s.location.search as { mode?: string }).mode === "live" }));

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

  // While a modal dialog is open (the demo, guide, 3D, Inspect or account dialog, portaled outside this root), the
  // page behind it is inert: Radix's aria-hidden skips live regions and their ancestors, so the activity log and its
  // links stayed reachable. Popovers and menus are not modal (no aria-modal) and leave the page alone. The flag
  // drops as soon as the dialog reports data-state="closed", before Radix hands focus back to the opener.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    const sync = () => {
      const open = !!document.querySelector('[aria-modal="true"][data-state="open"]');
      if (open !== root.inert) root.inert = open;
    };
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-modal"] });
    sync();
    return () => {
      mo.disconnect();
      root.inert = false;
    };
  }, []);

  // main's scrollbar width as --sbw: the top bar's row and the toasts add it on their right, so their edges meet the
  // column's under classic scrollbars (overlay scrollbars measure 0).
  useEffect(() => {
    const main = document.getElementById("content");
    if (!main || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--sbw", `${Math.max(0, main.offsetWidth - main.clientWidth)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(main);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sbw");
    };
  }, []);

  // The top bar takes its 1px rule once the page scrolls under it (main is the one scroller at every width).
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = document.getElementById("content");
    const bar = shellRef.current?.querySelector<HTMLElement>("[data-topbar]");
    if (!main || !bar) return;
    const sync = () => bar.toggleAttribute("data-scrolled", main.scrollTop > 0);
    sync();
    main.addEventListener("scroll", sync, { passive: true });
    return () => main.removeEventListener("scroll", sync);
  }, []);

  // "/" focuses the top bar search from anywhere (not while typing in a field or inside a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      // The bar's field, or the page's own (Discover hides the bar's).
      const page = document.getElementById("token-search");
      const el = searchRef.current?.offsetParent ? searchRef.current : page instanceof HTMLInputElement ? page : null;
      if (!el || el.offsetParent === null) {
        // No field on screen (the bar's search is an icon at this width): press the icon, which opens Discover's.
        const icon = document.querySelector<HTMLElement>(".cdx-topbar__searchbtn");
        if (icon?.offsetParent) {
          e.preventDefault();
          icon.click();
        }
        return;
      }
      e.preventDefault();
      el.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        shellRef.current = el;
      }}
      data-screen={path === "/" ? "home" : path.split("/")[1]}
      className="cdx-app cdx-viewport"
    >
      {/* First stop for keyboard users (P1-24): skips the top bar's links, search and account controls. */}
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
      <RouteProgress loading={pending} />
      <RouteAnnouncer />
      {/* IS_DEVNET is a literal: the note and its words are not in the mainnet or sim bundle. */}
      {IS_DEVNET && devnetSite ? <DevnetSiteNote /> : null}
      {/* The real-funds warning stays: one row, only on the mainnet launch panel. */}
      {liveLaunch ? (
        <p role="note" data-testid="live-launch-note" className="cdx-shellnote">
          <span className="font-semibold text-ink">Solana mainnet</span>
          <span aria-hidden> · </span>Wallet approval required.
        </p>
      ) : null}
      <TopBar searchRef={searchRef} pending={pending} liveLaunch={liveLaunch} />
      {/* main is the one scroller at every width (density R1). Its inline padding centres the column (up to 1600px;
          the top bar uses the same arithmetic). Views grow with their content, at least main's height, and the
          footer follows the page. */}
      <main
        id="content"
        data-scroll-restoration-id="content"
        tabIndex={-1}
        aria-busy={pending || undefined}
        className="cdx-viewport-main mdx-main mdx-scroll"
      >
        {children}
        <Footer liveLaunch={liveLaunch} />
      </main>
      <MobileTabs pending={pending} />
    </div>
  );
}
