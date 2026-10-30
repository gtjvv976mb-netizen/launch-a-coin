import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
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

import { IS_DEVNET } from "../../lib/mintdex/mode";
import { liveLaunchesQuery, type PublicLiveLaunch } from "../../lib/carddex/live/launches";
import { DEVNET_SITE_NOTE } from "../../lib/mintdex/site-host";
import { writeViewport } from "../../lib/mintdex/viewport";
import { afterLoadIdle } from "./opened-once";
import { useMotionLevel } from "./card3d/motion3d";
import { GyroChip } from "./card3d/GyroChip";
// The live launch sheet stays here (lazy chrome below) so the global CSS keeps its order.
import "../../carddex-live.css";
import { useLiveRecoveryOpen } from "../carddex/live/readiness";
import { LiveLaunchGuide } from "../carddex/live/LiveLaunchGuide";
import {
  CalmSwitch,
  GenIcon,
  Hallmark,
  isDialogOpen,
  isTypingTarget,
  Thumb,
  type GenIconName,
} from "./ui";

// The mainnet wallet control, in the rail and the phone header on every page (Portfolio reads the wallet it connects;
// Launch signs with it). Its wallet code (wallet-standard, ed25519) loads on demand so it stays out of every page's
// first download; on Launch its help control is a plain link to /how#wallet.
const LiveWalletButton = lazy(() => import("../carddex/live/LiveWalletButton").then((m) => ({ default: m.LiveWalletButton })));

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
/** The pages where MintDex shows "Enable phone tilt" above the content on phones. */
const PHONE_TILT_PAGES = new Set(["/discover", "/levels", "/portfolio"]);

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

// ---------------------------------------------------------------- rail pieces

/** The rail's logo row (MintDex: mark and wordmark, 32px tall): Launch a Card's own mark and name. */
function Lockup() {
  return (
    <Link to="/" aria-label="Launch a Card home" className="mdx-lockup">
      <Hallmark size={32} />
      <span aria-hidden className="mdx-lockup__name">
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
function suggest(coins: PublicLiveLaunch[], text: string) {
  const t = norm(text);
  if (!t) return [];
  const rank = (c: PublicLiveLaunch) => {
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

  // The launched coins for suggestions, fetched the first time the field is used (shared with Home and Discover).
  const [wanted, setWanted] = useState(false);
  const { data: coins } = useQuery({ ...liveLaunchesQuery, enabled: wanted });
  const matches = useMemo(() => suggest(coins ?? [], q), [coins, q]);
  const open = focused && !dismissed && matches.length > 0;

  function go(coin: PublicLiveLaunch) {
    setActive(-1);
    setDismissed(true);
    inputRef.current?.blur();
    void navigate({ to: "/coin/$id", params: { id: coin.tokenMint } });
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

  const activeId = open && active >= 0 && matches[active] ? `${listId}-${matches[active].tokenMint}` : undefined;

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
                key={c.tokenMint}
                id={`${listId}-${c.tokenMint}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                // Keep focus in the field while picking with the pointer.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(c)}
                onMouseEnter={() => setActive(i)}
                className="mdx-menu-item mdx-suggest cursor-pointer gap-2.5"
              >
                <Thumb src={c.image ?? ""} size={24} />
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

function Rail({
  searchRef,
  pending,
  liveLaunch = false,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  pending: boolean;
  liveLaunch?: boolean;
}) {
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
        {/* Two quiet links, each at least 24px tall (WCAG 2.5.8 target size): the details page (MintDex's "How MintDex
            works" item, in the same place) and the terms. On a mainnet launch the first lands on the wallet steps. */}
        <div className="flex flex-col items-start gap-0.5">
          <Link
            to="/how"
            hash={liveLaunch ? "wallet" : undefined}
            className="mdx-link inline-flex min-h-6 items-center text-[14px]"
          >
            How it works
          </Link>
          <Link
            to="/legal"
            className="mdx-link inline-flex min-h-6 items-center text-[14px] font-normal text-slate"
          >
            Terms &amp; risks
          </Link>
        </div>
        <Suspense fallback={null}>
          <LiveWalletButton />
        </Suspense>
        {/* Under the wallet block: the site-wide Calm motion switch (10.2). */}
        <CalmSwitch />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- mobile

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
        data-search-btn=""
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
 * Phone header (P1-6): the Launch a Card mark, then one-tap search, How it works (on Launch, the wallet guide) and the
 * mainnet wallet button. 44px targets; the side insets clear a notch held sideways.
 */
function MobileHeader({ liveLaunch = false }: { liveLaunch?: boolean }) {
  return (
    <header className="mdx-mhead sticky top-0 z-30 flex h-14 flex-none items-center gap-3 bg-wall px-4 lg:hidden">
      <Link to="/" aria-label="Launch a Card home" className="-ml-2 grid h-11 w-11 place-items-center">
        <Hallmark size={28} />
      </Link>
      <div className="-mr-1.5 ml-auto flex items-center gap-1">
        <SearchButton />
        {liveLaunch ? (
          <LiveLaunchGuide compact />
        ) : (
          <Link
            to="/how"
            aria-label="How it works"
            className="grid h-11 w-11 place-items-center rounded-pill text-ink transition-colors duration-(--t-fast) ease-room hover:bg-track"
          >
            <GuideGlyph />
          </Link>
        )}
        <Suspense fallback={null}>
          <LiveWalletButton compact />
        </Suspense>
      </div>
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
  useKeyboardFlag();
  return (
    <nav
      aria-label="Main"
      data-tabbar
      className="mdx-mobile-tabs fixed inset-x-0 bottom-0 z-30 flex rounded-t-panel bg-plinth pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-14px_rgb(var(--rgb-shade)/0.7)] lg:hidden"
    >
      {TABS.map((t, i) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: !!t.exact }}
          className="mdx-mtab h-(--tabbar-h)"
          data-active={i === active}
          aria-current={i === active ? "location" : undefined}
          data-pending={(pending && i === active) || undefined}
        >
          <span className="mdx-mtab__icon">
            <GenIcon name={t.icon} size={20} />
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
    <p role="note" data-testid="devnet-site-note" className="mdx-status">
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

/** The D1 stage loops (Higgsfield, creative/higgsfield/jobs-site-d1.json): 5-second seamless loops of the logo's
 *  chocolate suede wall, landscape for desktop and tablets (and phones held sideways), portrait for phones. */
const STAGE_LOOPS = {
  wide: ["/assets/site/d1/stage-loop-1344.webm", "/assets/site/d1/stage-loop-1344.mp4"],
  tall: ["/assets/site/d1/stage-loop-phone-768.webm", "/assets/site/d1/stage-loop-phone-768.mp4"],
} as const;
/** The breathing glow is strong at full speed (jobs-site-d1.json notes): the loop plays at half speed. */
const STAGE_RATE = 0.5;
const TALL_QUERY = "(orientation: portrait) and (max-width: 1023.98px)";

/**
 * The stage behind every page (MintDex's sky, D1): the moving suede wall, then still dust and scanlines, a perspective
 * grid floor of thin gold lines that run toward you, and two drifting amber aurora layers. The loop's poster is the
 * sky's own CSS background, so it paints at once; the video gets its source only after load and idle (afterLoadIdle),
 * so it never becomes or delays the LCP, and it fades in once it truly plays. It plays only at full motion, in a
 * visible tab, on screen (an IntersectionObserver: the Inspect stage hides the sky) and with no dialog open; Calm
 * motion and reduced motion (mapped to Calm) keep the still poster. Data Saver skips the video.
 */
function Sky() {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const level = useMotionLevel();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => el.toggleAttribute("data-paused", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => {
    const el = ref.current;
    const v = videoRef.current;
    if (!el || !v || level !== "full") return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    let attached = "";
    let onScreen = true;
    const tall = window.matchMedia(TALL_QUERY);
    const want = () => !document.hidden && onScreen && !document.body.hasAttribute("data-scroll-locked");
    const attach = () => {
      const kind = tall.matches ? "tall" : "wide";
      if (attached === kind) return;
      attached = kind;
      v.removeAttribute("data-playing");
      v.replaceChildren(
        ...STAGE_LOOPS[kind].map((src) => {
          const source = document.createElement("source");
          source.src = src;
          source.type = src.endsWith(".webm") ? "video/webm" : "video/mp4";
          return source;
        }),
      );
      v.load();
    };
    const update = () => {
      if (!attached) return;
      if (want()) {
        v.defaultPlaybackRate = STAGE_RATE;
        v.playbackRate = STAGE_RATE;
        v.play().catch(() => {});
      } else v.pause();
    };
    const onPlaying = () => {
      v.playbackRate = STAGE_RATE;
      v.setAttribute("data-playing", "");
    };
    const onLoaded = () => update();
    const onOrientation = () => {
      if (!attached) return;
      attach();
    };
    v.addEventListener("playing", onPlaying);
    v.addEventListener("loadeddata", onLoaded);
    tall.addEventListener("change", onOrientation);
    document.addEventListener("visibilitychange", update);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      update();
    });
    io.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-scroll-locked"] });
    const cancel = afterLoadIdle(() => {
      attach();
      update();
    });
    return () => {
      cancel();
      io.disconnect();
      mo.disconnect();
      tall.removeEventListener("change", onOrientation);
      document.removeEventListener("visibilitychange", update);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("loadeddata", onLoaded);
      v.pause();
    };
  }, [level]);
  return (
    <div ref={ref} aria-hidden className="mdx-sky">
      <video
        ref={videoRef}
        className="mdx-sky__stage"
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload="none"
        tabIndex={-1}
      />
      <i className="mdx-sky__veil" />
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

/**
 * The status strip (MintDex: "Transactions are paused." above the page): what is real on this screen, in one 13/20
 * slate line on the walnut panel with a hairline under it. On phones it sits above the header and scrolls away.
 */
function StatusStrip({ testId, lead, rest }: { testId: string; lead: string; rest: string }) {
  return (
    <p role="note" data-testid={testId} className="mdx-status">
      <span className="font-semibold text-ink">{lead}</span>
      <span aria-hidden> · </span>
      {rest}
    </p>
  );
}

/** The hover wait before the first tooltip shows (the 400ms in styles/shared.css). */
const TIP_DELAY_MS = 400;
/** How long the tooltips stay warm after the pointer leaves one. */
const TIP_COOL_MS = 600;

/**
 * Tooltips ([data-tip]): the first one a mouse rests on waits a beat; while one is showing, or just after, its
 * neighbours open at once with no fade (html[data-tips-warm]), so running along a row of card controls reads every
 * name without waiting at each. Touch never shows them; keyboard focus shows them at once.
 */
function useWarmTips() {
  useEffect(() => {
    const root = document.documentElement;
    let wait: ReturnType<typeof setTimeout> | undefined;
    let cool: ReturnType<typeof setTimeout> | undefined;
    const tipOf = (target: EventTarget | null) => (target instanceof Element ? target.closest("[data-tip]") : null);
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !tipOf(e.target)) return;
      clearTimeout(cool);
      if (root.hasAttribute("data-tips-warm")) return;
      clearTimeout(wait);
      wait = setTimeout(() => root.setAttribute("data-tips-warm", ""), TIP_DELAY_MS);
    };
    const out = (e: PointerEvent) => {
      const tip = tipOf(e.target);
      if (!tip || (e.relatedTarget instanceof Node && tip.contains(e.relatedTarget))) return;
      clearTimeout(wait);
      clearTimeout(cool);
      cool = setTimeout(() => root.removeAttribute("data-tips-warm"), TIP_COOL_MS);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    return () => {
      clearTimeout(wait);
      clearTimeout(cool);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      root.removeAttribute("data-tips-warm");
    };
  }, []);
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
  useWarmTips();
  const searchRef = useRef<HTMLInputElement>(null);
  const pending = useRoutePending();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // On Launch, while the owner has launches (or at least saved-launch recovery) on, the strip asks for the wallet and
  // the phone header carries the wallet guide.
  const liveLaunch = useLiveRecoveryOpen(useRouterState({ select: s => s.location.pathname === "/launch" }));

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

  // D1's second-state art (the primary's hover skin and glint, the secondary's pressed skin) loads after the page
  // has, so it never competes with the first paint; until then a hover keeps the rest skin.
  useEffect(() => afterLoadIdle(() => document.documentElement.setAttribute("data-skins", "")), []);

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

  // While a modal dialog is open (the wallet, guide, 3D or Inspect dialog, portaled outside this root), the
  // page behind it is inert: Radix's aria-hidden skips live regions and their ancestors, so the activity log and its
  // links stayed reachable. Popovers and menus are not modal (no aria-modal) and leave the page alone. The flag
  // drops as soon as the dialog reports data-state="closed", before Radix hands focus back to the opener.
  const rootRef = useRef<HTMLDivElement>(null);
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

  // "/" focuses the rail search from anywhere (not while typing in a field or inside a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      const el = searchRef.current;
      if (!el || el.offsetParent === null) {
        // Phones have no rail field: press the header's search icon, which opens Discover's.
        const icon = document.querySelector<HTMLElement>("[data-search-btn]");
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
    // relative isolate: the sky (L9) sits behind every page on the wall, above this root's own background.
    <div ref={rootRef} data-screen={path === "/" ? "home" : path.split("/")[1]} className="cdx-app cdx-viewport relative isolate flex min-h-dvh bg-wall text-ink lg:h-dvh lg:overflow-hidden">
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
        {/* The status strip (MintDex): what is real here. IS_DEVNET is a literal: the devnet line and its words are not
            in the mainnet bundle. */}
        {IS_DEVNET && devnetSite ? (
          <DevnetSiteNote />
        ) : (
          <StatusStrip
            testId="mainnet-note"
            lead="Solana mainnet"
            rest={liveLaunch ? "Wallet approval required." : "Real coins on pump.fun."}
          />
        )}
        <MobileHeader liveLaunch={liveLaunch} />
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
          className="cdx-viewport-main mdx-main mdx-scroll min-h-0 flex-1 p-4 pb-[calc(var(--tabbar-h)_+_16px_+_env(safe-area-inset-bottom))] [--main-pad:16px] max-lg:overflow-x-clip lg:overflow-x-hidden lg:overflow-y-auto lg:p-6 lg:[--main-pad:24px] short:p-4 short:[--main-pad:16px]">
          {/* MintDex's phone tilt prompt at the top of the card pages (Home and the coin case carry their own). */}
          {PHONE_TILT_PAGES.has(path) ? (
            <div className="mdx-phone-tilt mdx-phone-tilt--page flex lg:hidden">
              <GyroChip />
            </div>
          ) : null}
          {children}
        </main>
        <MobileTabs pending={pending} />
      </div>
    </div>
  );
}
