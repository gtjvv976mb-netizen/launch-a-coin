import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  Card3D,
  CardBack,
  GyroChip,
  View3DHost,
  useMotionLevel,
} from "../components/mintdex/card3d";
import { CoinRow, EventItem, LaunchedItem, LaunchedSkeleton } from "../components/mintdex/feeds";
import { MintCardFace, faceSlot, type CardData } from "../components/mintdex/MintCard";
import { useSessionUi } from "../components/mintdex/session";
import { prefersReducedMotion, revPoll, useNow, usePageKeys } from "../components/mintdex/hooks";
import {
  ButtonLink,
  Caption,
  LivePause,
  Num,
  SectionHead,
  ChevronButton,
  Stepper,
  TextLink,
  TierTag,
  useFlip,
  useLiveList,
  usePauseGate,
  useSettled,
} from "../components/mintdex/ui";
import { SimTag } from "../components/mintdex/trust";
import { CHAIN_POLL_MS, chainHome, chainHomeLoader, chainInitial } from "../lib/chain/data";
import { getHome } from "../lib/mintdex/api";
import { hasRecentActivity } from "../lib/mintdex/activity-freshness";
import { CARD_BIDDING_SUSPENDED } from "../lib/mintdex/card-bidding";
import { fetchLiveLaunches } from "../lib/carddex/live/launches";
import { getCardDesign } from "../lib/carddex/designs";
import { marketCapText, marketCapWatch } from "../lib/carddex/quote-display";
import { EXPLORE_COINS, HOME_COPY, IS_SIM, MODE_COPY, WORDS } from "../lib/mintdex/copy";
import { sol, usdCompact } from "../lib/mintdex/format";
import { tierForLevel } from "../lib/mintdex/tiers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, pageHead } from "../lib/mintdex/seo";
import type { CoinSummary } from "../lib/mintdex/types";
import "../home-motion.css";
import { Card3DView } from "../components/mintdex/card3d/Card3D";
import { Engine, motionLevel, type Body } from "../components/mintdex/card3d/motion3d";
import type { SceneCtl } from "../components/mintdex/card3d/scene";

/**
 * Back keeps your place (P1-14): the featured card on the ledge is mirrored in the URL (/?card=glorb), so
 * Back from its coin page returns to the same card. Hand-written validation: anything odd is ignored.
 */
type HomeSearch = { card?: string };
/** A coin id: the sim's slug, or a mint address on devnet. */
const CARD_PARAM = IS_SIM ? /^[a-z0-9_]{2,16}$/ : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function validateHomeSearch(raw: Record<string, unknown>): HomeSearch {
  return { card: typeof raw.card === "string" && CARD_PARAM.test(raw.card) ? raw.card : undefined };
}

const HOME_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_ORIGIN}/#organization`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/assets/brand/carddex-512.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
  ],
}).replace(/</g, "\\u003c");

export const Route = createFileRoute("/")({
  validateSearch: validateHomeSearch,
  // Stepping the featured card stays on this match: no reload (the polled query keeps the data fresh).
  shouldReload: ({ cause }) => cause !== "stay",
  loader: IS_SIM ? () => getHome() : chainHomeLoader,
  head: () => ({
    ...pageHead({
      path: "/",
      title: "Launch a Card: every coin is a one-of-one card",
      description: SITE_DESCRIPTION,
    }),
    // SEO-5: who runs the site and what it is, from facts the site already states. No sameAs: the site links
    // no Launch a Card social account yet ([TO FILL: official X and Telegram URLs]).
    scripts: [{ type: "application/ld+json", children: HOME_JSON_LD }],
  }),
  component: Home,
});

/*
 * Home (spec 8.1, family A; refs/alive-3d-spec.md 5.1, the Turntable vitrine): stage + aside.
 *
 * The MintDex home (mintdex.fun, re-paletted classic dark): headline and actions over the featured-card stage, the
 * rail with Trending, Launched on pump.fun (real mainnet launches) and Activity on the right; phones stack the rail
 * under the stage as one panel.
 *
 * Two regimes, one DOM:
 * - fit (1280x720 and up): the no-scroll template. The headline block sits top left; under it the featured card
 *   floats over a holo plinth in a size container that runs to the stage's foot, sized so the card and the whole
 *   plinth fit (alive.css). The card and its caption sit centered as one group (the previous coin's ghost has room
 *   on the left), a chevron on each card edge, the dots and Pause right under the caption. The aside fits
 *   Trending (5) and as many activity rows as fit.
 * - everything else (phones, 1024 to 1279, short windows): natural flow. The card is up to 260px wide over its
 *   plinth, with a chevron on each edge, the caption, the dots and Pause, then Trending (5) and Activity (5). Phones
 *   move the chevrons below the card into a dedicated control row so a full-width drag never hits an arrow.
 *   A compact caption keeps View coin beside the name and figures; short phones scroll naturally.
 *
 * One "no real value" per screen: on the devnet test site (useDevnetSite) the banner above the page says it, and the
 * hero keeps only the bid line.
 *
 * The card is a held 3D card (Card3D, depth hand) that advances 3.5 seconds after each turn settles (7 s at the
 * lighter motion level, never under calm), paused while handling the card and briefly afterwards, while the
 * pointer is over the stage, focus is in the carousel, the tab is hidden, a dialog is open or Pause was pressed.
 * Drag to rotate the current card;
 * arrows, dots and keys select another coin. Behind it: a slow aura in the tier's colors, the previous and next
 * coins out of focus, bokeh, a light beam and dust (all paused offscreen and by Pause, gone under calm).
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Auto-advance (L5; hype arcade, owner 2026-10-17: the featured card never sits still): a full turn to the next
 * featured coin 3.5 s after the last turn settled, and between turns the card keeps swaying on its stand (idle
 * "spin"). Lite: every 7 s, no sway. Calm: no auto-advance.
 */
const ADVANCE_MS = 16000;
const ADVANCE_LITE_MS = 20000;
/** Let the viewer finish inspecting a card before the carousel resumes, without stopping its ambient motion. */
const INTERACTION_HOLD_MS = 6000;
/** The caption switches with the selection and fades in (mdx-fade, 160 ms); the class comes off after 260 ms. */
const CAPTION_HALF_MS = 130;
/** If a swap is never reported (a card that could not turn), the card's own link follows the selection after this. */
const CAPTION_FALLBACK_MS = 1800;
const HINT_KEY = "mdx-hint-drag";
/** The visitor's Pause on the featured cards, kept for later visits (MOT-7). */
const PAUSE_KEY = "mdx-featured-paused";
/** Featured cards on the stage (MintDex: four), rarest design first. */
const FEATURED_COUNT = 4;
/** Trending rows in the rail (MintDex: five, ranked 01 to 05). */
const TRENDING_ROWS = 5;
/** Activity rows the rail renders: as many as its height holds show (the rest wrap out of view, never cut); phones
 *  show the first five (alive.css .cdx-home__activity). */
const ACTIVITY_ROWS = 10;
/** Launches the rail lists at first; the rest open in place. */
const LAUNCHED_ROWS = 3;
/** The featured card's image sizes (LCP): the laid-out card at each width, so a 1.75x phone takes the 480w copy. */
const FACE_SIZES = "(max-width: 639px) 270px, (max-width: 1023px) 400px, (max-width: 1439px) 300px, 400px";

/**
 * The featured lot: which coin is selected and the step direction. The selection follows the coin (by id)
 * across polls, so a refetch never swaps the card under the viewer; if the coin leaves the featured set, the
 * same slot stays selected. Manual steps announce and call onSelect (the URL); auto steps do neither.
 */
function useLot(featured: CoinSummary[], initialId?: string, onSelect?: (id: string) => void) {
  const [sel, setSel] = useState<{ id: string | null; i: number }>({ id: initialId ?? null, i: 0 });
  // What the stepper's live region says after a step (P1-21): set on a manual step only, so polls never repeat it.
  const [announce, setAnnounce] = useState("");
  // Step direction for the turn: 1 for next, -1 for previous (read from the requested index).
  const [dir, setDir] = useState<1 | -1>(1);

  const count = featured.length;
  let index = sel.id ? featured.findIndex((c) => c.id === sel.id) : -1;
  if (index < 0) index = Math.min(Math.max(0, sel.i), Math.max(0, count - 1));
  const selected = featured[index] ?? null;

  function step(next: number, how: "manual" | "auto" = "manual") {
    if (count <= 1) return;
    const target = ((next % count) + count) % count;
    const to = featured[target];
    if (!to || target === index) return;
    // The Stepper and the arrow keys hand over indexes that already wrapped: last to first is a step
    // forward, first to last a step back.
    const wrapped = count > 2 && Math.abs(target - index) === count - 1;
    setDir(wrapped ? (target === 0 ? 1 : -1) : target > index ? 1 : -1);
    setSel({ id: to.id, i: target });
    if (how === "auto") return;
    setAnnounce(
      `${to.name}, ${tierForLevel(to.level).name} design, market cap ${marketCapText(to)}, ${target + 1} of ${count}`,
    );
    onSelect?.(to.id);
  }

  return { index, count, selected, dir, step, announce };
}

/** The face a featured coin shows on the turntable (no owner line, as before). */
function featuredCard(c: CoinSummary): CardData {
  return { ...c, ownerHandle: undefined };
}

/** Exhibition light belongs to the site palette (lit gold, antique gold, ivory, card red); each card keeps its own
 *  foil colours. */
function auraColors(_level: number): string[] {
  return ["var(--light-1)", "var(--light-2)", "var(--light-3)", "var(--light-4)"];
}

/** The pool of light on the plinth: the tier's sheen (its second color for many-color tiers), else its ring. */
function poolColor(level: number) {
  const t = tierForLevel(level);
  return t.sheen.length > 1 ? t.sheen[1] : t.sheen[0] === "#FFFFFF" ? t.ring : t.sheen[0];
}

/** Bokeh, beam and dust for the vitrine: fixed positions (no randomness in render, SSR safe). */
const BOKEH = [
  { x: "8%", y: "18%", sz: 110, c: "var(--light-4)", d: 18, del: -3, dx: "26px", dy: "-18px" },
  { x: "62%", y: "8%", sz: 80, c: "var(--light-1)", d: 22, del: -9, dx: "-20px", dy: "16px" },
  { x: "30%", y: "60%", sz: 64, c: "var(--light-2)", d: 16, del: -5, dx: "18px", dy: "-22px" },
  { x: "78%", y: "46%", sz: 96, c: "var(--light-5)", d: 20, del: -12, dx: "-24px", dy: "-12px" },
  { x: "46%", y: "28%", sz: 40, c: "var(--light-4)", d: 14, del: -2, dx: "14px", dy: "20px" },
  { x: "18%", y: "78%", sz: 72, c: "var(--light-3)", d: 19, del: -7, dx: "22px", dy: "-14px" },
];
/** Dust in three drifts of five motes each: a drift rises and fades as one (three layers, not fourteen). */
const DUST = [0, 1, 2].map((g) => ({
  d: [12, 15, 18][g],
  del: [-2, -7, -11][g],
  dx: ["14px", "-18px", "8px"][g],
  motes: Array.from({ length: 5 }, (_, j) => {
    const i = g * 5 + j;
    return {
      x: `${((i * 37 + 11) % 92) + 4}%`,
      y: `${((i * 53 + 29) % 64) + 30}%`,
      s: 3 + (i % 3),
      o: 0.5 + ((i * 3) % 5) / 10,
    };
  }),
}));

/**
 * The vitrine's dressing (L8): bokeh, one light beam and dust motes, clipped by the stage. Its gate pauses every
 * loop of the stage (the aura, the ghosts and the headline ink follow `onLive`) once the stage has left the
 * screen (no margin: on a phone the stage is taller than the screen), in a hidden tab, under a dialog, and while
 * the viewer holds Pause (WCAG 2.2.2: Pause stops the ambient motion too, not only the turntable).
 */
function Vitrine({ hold, onLive }: { hold: boolean; onLive: (live: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePauseGate(ref, { margin: "0px", hold, onChange: onLive });
  return (
    <div ref={ref} aria-hidden className="mdx-vitrine">
      <div className="mdx-vitrine__bokeh">
        {BOKEH.map((b, i) => (
          <b
            key={i}
            style={
              {
                "--x": b.x,
                "--y": b.y,
                "--sz": `${b.sz}px`,
                "--c": b.c,
                "--d": `${b.d}s`,
                "--del": `${b.del}s`,
                "--dx": b.dx,
                "--dy": b.dy,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="mdx-vitrine__beam" />
      <div className="mdx-vitrine__dust">
        {DUST.map((g, k) => (
          <div
            key={k}
            style={{ "--d": `${g.d}s`, "--del": `${g.del}s`, "--dx": g.dx } as CSSProperties}
          >
            {g.motes.map((m, j) => (
              <i
                key={j}
                style={{ "--x": m.x, "--y": m.y, "--s": `${m.s}px`, opacity: m.o } as CSSProperties}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The aura (L7): a 1.6W disc of four soft glows in the tier's colors behind the card, turning once every 26 s.
 * Two stacked layers crossfade (600 ms) when the coin changes. No mask: the radial glows fade by themselves.
 */
function Aura({ level, paused }: { level: number; paused: boolean }) {
  const [layers, setLayers] = useState(() => ({ a: level, b: level, on: "a" as "a" | "b" }));
  if (level !== (layers.on === "a" ? layers.a : layers.b)) {
    setLayers((l) => (l.on === "a" ? { ...l, b: level, on: "b" } : { ...l, a: level, on: "a" }));
  }
  const glow = (lvl: number) => {
    const c = auraColors(lvl);
    return { "--a1": c[0], "--a2": c[1], "--a3": c[2], "--a4": c[3] } as CSSProperties;
  };
  return (
    <div aria-hidden className={cx("mdx-tt__aura", paused && "is-paused")}>
      <div className="mdx-tt__aura-spin">
        <i style={glow(layers.a)} data-on={layers.on === "a" || undefined} />
        <i style={glow(layers.b)} data-on={layers.on === "b" || undefined} />
      </div>
    </div>
  );
}

/** The display's light travels around its rim; its own wrapper leaves the card engine's transforms alone. */
function Plinth({ level, paused }: { level: number | null; paused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  usePauseGate(ref, { margin: "0px", hold: paused });
  return (
    <div
      ref={ref}
      aria-hidden
      className={cx("mdx-tt__plinth", paused && "is-paused")}
      data-lit={level != null || undefined}
      style={level != null ? ({ "--pool": poolColor(level) } as CSSProperties) : undefined}
    >
      <i className="mdx-tt__band" />
      <i className="mdx-tt__rim" />
      <i className="mdx-tt__top" />
      {level != null ? <i className="mdx-tt__pool" /> : null}
      <span className="mdx-tt__orbit">
        <b />
      </span>
      <span className="mdx-tt__charge">
        <b />
      </span>
    </div>
  );
}

/**
 * The previous and next featured coins far behind the card, out of focus (the depth-of-field ghosts). Decorative:
 * hidden from assistive tech and never focusable; a click steps to that coin. Their art loads now at low priority at
 * a small size (the 320 px copy), so a blurred ghost never waits on lazy loading or becomes the page's largest paint.
 */
function Ghosts({
  prev,
  next,
  onStep,
  paused,
}: {
  prev: CoinSummary | null;
  next: CoinSummary | null;
  onStep: (dir: 1 | -1) => void;
  paused: boolean;
}) {
  return (
    <div aria-hidden className={cx("mdx-tt__ghosts", paused && "is-paused")}>
      {prev ? (
        <div className="mdx-tt__ghost mdx-tt__ghost--prev" onClick={() => onStep(-1)}>
          <div className="mdx-tt__float">
            <div className="mdx-tt__lens">
              <MintCardFace card={featuredCard(prev)} lite eager sizes="160px" />
            </div>
          </div>
        </div>
      ) : null}
      {next && next.id !== prev?.id ? (
        <div className="mdx-tt__ghost mdx-tt__ghost--next" onClick={() => onStep(1)}>
          <div className="mdx-tt__float">
            <div className="mdx-tt__lens">
              <MintCardFace card={featuredCard(next)} lite eager sizes="160px" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A caption figure: right-aligned so every number in the caption shares one right edge. */
function Figure({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 items-baseline justify-end gap-2">{children}</span>;
}

/** How many figure rows a coin's caption shows: market cap always, Buy now and Top bid only when there is one. */
function figureRows(c: CoinSummary) {
  return 1;
}

/**
 * The featured caption: the coin's name, its design (from 1024px up: the card face names it too), only the figures
 * it has (market cap always, without a 0.0% pill; Buy now and Top bid only when there is one) and one View coin
 * button. Phones: a compact block under the card with the button beside the name and figures, so the card, its
 * name, its market cap and the button share the first screen. `rows` reserves room for the most rows any featured
 * coin shows, so a turn to the next coin never moves what is under the caption.
 */
function LotCaption({ coin: c, rows }: { coin: CoinSummary; rows: number }) {
  return (
    <div className="mdx-caption max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:items-center max-lg:gap-x-4">
      <h2 className="mdx-name mt-0 truncate">{c.name}</h2>
      {/* The coin's one creator-chosen design (MintDex's design chip), then the demo's Simulated tag. */}
      <p className="cdx-home__design max-lg:hidden">
        <span className="cdx-home__chip">{getCardDesign(c.cardTemplate).name} design</span>
        <SimTag className="self-center" />
      </p>
      <dl
        className="mdx-leaders mt-4 flex flex-col gap-2 max-lg:col-start-1 max-lg:mt-1"
        style={{ minHeight: `${rows * 30 - 8}px` }}
      >
        <div>
          <dt className="text-[13px] text-slate">Market cap</dt>
          <dd>
            <Figure>
              {/* The odometer stays mounted across a step and rolls to the next coin's figure; flashKey keeps the
                  up/down flash for real moves of one coin only (a step is not a market move). */}
              <Num size="lg" watch={marketCapWatch(c)} flashKey={c.id} odo>
                {marketCapText(c)}
              </Num>
              <SimTag className="self-center lg:hidden" />
            </Figure>
          </dd>
        </div>
      </dl>
      <div className="mt-4 max-lg:col-start-2 max-lg:row-span-2 max-lg:row-start-1 max-lg:mt-0">
        <ButtonLink to="/coin/$id" params={{ id: c.id }} size="sm">
          {HOME_COPY.viewCoin}
        </ButtonLink>
      </div>
    </div>
  );
}

/** The hero's two buttons: on the first screen from 1024px up, under the featured card on phones (the tab bar
 *  carries Launch and Discover there too). */
function HeroActions({ className = "", guide }: { className?: string; guide?: () => void }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-3", className)}>
      <ButtonLink to="/launch">Launch a coin</ButtonLink>
      <ButtonLink to="/discover" variant="ghost">
        {EXPLORE_COINS}
      </ButtonLink>
      {/* The guide from the first screen (P1-7), desktop only: phones have the header's guide button. */}
      {guide ? (
        <TextLink onClick={guide} className="ml-2 text-[14px]">
          {HOME_COPY.howItWorks}
        </TextLink>
      ) : null}
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[13px] leading-[1.45] text-slate">{children}</p>;
}

/**
 * Launched on pump.fun: the real mainnet launches (never simulated), newest first, from the public launch list (at most
 * 12). The rail lists the first three; "Show all" opens the rest in place. Loading keeps one row's height, so the
 * rail never jumps when the answer lands.
 */
function LaunchedSection({ now }: { now: number }) {
  const headId = useId();
  const [all, setAll] = useState(false);
  const launches = useQuery({
    queryKey: ["live-launches"],
    queryFn: fetchLiveLaunches,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const rows = launches.data ?? [];
  const shown = all ? rows : rows.slice(0, LAUNCHED_ROWS);
  return (
    <section aria-labelledby={headId} className="cdx-home-launched flex flex-none flex-col gap-1">
      <SectionHead
        title={<span id={headId}>Launched on pump.fun</span>}
        right={
          rows.length > LAUNCHED_ROWS ? (
            <TextLink onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </TextLink>
          ) : undefined
        }
      />
      <p className="text-[12px] leading-4 text-slate">Real launches on Solana mainnet</p>
      {launches.isPending ? (
        <LaunchedSkeleton rows={1} />
      ) : launches.isError && !rows.length ? (
        <div role="alert" className="cdx-home-launched__error">
          <p>Couldn't load the launch list. Check your connection, then try again.</p>
          <TextLink onClick={() => void launches.refetch()} disabled={launches.isFetching}>
            {launches.isFetching ? "Trying again…" : "Try again"}
          </TextLink>
        </div>
      ) : rows.length ? (
        <ul className="cdx-home-launched__list">
          {shown.map((l) => (
            <LaunchedItem key={l.tokenMint} launch={l} now={now} />
          ))}
        </ul>
      ) : (
        <p className="cdx-home-launched__empty">
          No coins launched yet. Be the first.{" "}
          <TextLink to="/launch">Launch a coin</TextLink>
        </p>
      )}
    </section>
  );
}

function Home() {
  const initial = Route.useLoaderData();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useQuery({
    queryKey: ["home"],
    // Skips the refetch when nothing changed since the last poll (P0-12).
    queryFn: IS_SIM ? revPoll(qc, ["home"], () => getHome()) : revPoll(qc, ["home"], chainHome),
    initialData: initial,
    ...(IS_SIM ? null : chainInitial(initial)),
    staleTime: 10_000,
    refetchInterval: IS_SIM ? 15_000 : CHAIN_POLL_MS,
  });
  const now = useNow();
  const { openGuide } = useSessionUi();
  const level = useMotionLevel();
  // The devnet test site's banner already says devnet SOL has no real value: the hero leaves its own line out.

  // getHome lists the top coin of each design, lowest design first. The stepper starts on the rarest.
  const featured = useMemo(() => [...data.featured].reverse().slice(0, FEATURED_COUNT), [data.featured]);
  // The 3D viewer steps through the featured cards in the stepper's order.
  const v3dList = useMemo(
    () => featured.map((c) => ({ id: c.id, card: featuredCard(c) })),
    [featured],
  );
  const captionRows = featured.reduce((n, c) => Math.max(n, figureRows(c)), 1);
  const lot = useLot(
    featured,
    search.card,
    (id) => void navigate({ search: { card: id }, replace: true, resetScroll: false }),
  );
  usePageKeys(lot.index, lot.count, lot.step, { wrap: true });

  const target = lot.selected;
  const count = lot.count;
  const prevCoin = count > 1 ? featured[(lot.index - 1 + count) % count] : null;
  const nextCoin = count > 1 ? featured[(lot.index + 1) % count] : null;

  // What the card shows right now: the swap happens while its back faces the viewer (onSwapped), and the aura and
  // the card's own link follow that. The caption (name, figures, View coin) follows the selection in the same
  // render as the URL and the dots (F5): a click on View coin always opens the coin the dots point at.
  const [shownId, setShownId] = useState<string | null>(target?.id ?? null);
  const shown = featured.find((c) => c.id === shownId) ?? target;
  const [capPhase, setCapPhase] = useState<"idle" | "in">("idle");
  const caption = target ?? shown;
  const [captionFor, setCaptionFor] = useState<string | null>(target?.id ?? null);
  if ((target?.id ?? null) !== captionFor) {
    // A new selection: the caption's text changes now and fades in (no fade under calm).
    setCaptionFor(target?.id ?? null);
    setCapPhase(prefersReducedMotion() ? "idle" : "in");
  }
  useEffect(() => {
    if (capPhase !== "in") return;
    const t = setTimeout(() => setCapPhase("idle"), CAPTION_HALF_MS * 2);
    return () => clearTimeout(t);
  }, [capPhase, captionFor]);
  function onSwapped(key: string) {
    setShownId(key);
  }
  // A swap that is never reported (the card could not turn): the caption follows the selection anyway.
  useEffect(() => {
    if (!target || target.id === shownId) return;
    const t = setTimeout(() => onSwapped(target.id), CAPTION_FALLBACK_MS);
    return () => clearTimeout(t);
    // onSwapped is a fresh closure each render; the target is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, shownId]);

  // The faces staged on the card: what it shows now, the target and its neighbours (decoded ahead of the turn).
  const faces = useMemo(() => {
    const ids: string[] = [];
    const add = (c: CoinSummary | null | undefined) => {
      if (c && !ids.includes(c.id)) ids.push(c.id);
    };
    add(shown);
    add(prevCoin);
    add(target);
    add(nextCoin);
    return ids.map((id) => {
      const c = featured.find((x) => x.id === id)!;
      const isTarget = id === target?.id;
      return faceSlot(featuredCard(c), {
        key: c.id,
        priority: isTarget,
        eager: !isTarget,
        sizes: FACE_SIZES,
      });
    });
  }, [featured, shown, prevCoin, target, nextCoin]);

  // Auto-advance (L5): after the last turn settles, paused while handling the card and briefly afterwards, while
  // the pointer is over the stage, focus is inside, the stage is offscreen, the tab is hidden, a dialog is open or
  // Pause was pressed. Calm: never. Auto steps neither write the URL nor announce.
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(PAUSE_KEY) === "1") setPlaying(false);
    } catch {
      /* storage blocked: the carousel starts playing */
    }
  }, []);
  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    try {
      if (next) localStorage.removeItem(PAUSE_KEY);
      else localStorage.setItem(PAUSE_KEY, "1");
    } catch {
      /* storage blocked: the choice holds for this visit */
    }
  };
  // The stage's own loops run while the stage is on screen and the viewer has not pressed Pause.
  const [ambientLive, setAmbientLive] = useState(true);
  const still = !playing || !ambientLive;
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [stageLive, setStageLive] = useState(true);
  const turntableCtl = useRef<SceneCtl | null>(null);
  const turntableLastFrame = useRef(0);
  const turntableLastInput = useRef(0);
  const fittedTurntable = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px) and (min-height: 720px)");
    const sync = () => {
      fittedTurntable.current = media.matches;
      const body = turntableCtl.current?.body;
      if (body) body.turnArcScale = media.matches ? 0.2 : 1;
      Engine.kick();
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      const body = turntableCtl.current?.body;
      if (body) body.turnArcScale = 1;
    };
  }, []);
  const turntableFrame = (body: Body) => {
    body.turnArcScale = fittedTurntable.current ? 0.2 : 1;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (turntableLastFrame.current || now)) / 1000);
    turntableLastFrame.current = now;
    if (
      !playing ||
      motionLevel() !== "full" ||
      body.held ||
      body.dragging ||
      body.focusHold ||
      turntableCtl.current?.busy ||
      now - turntableLastInput.current < 2200
    )
      return;
    body.flip.t += 28 * dt;
  };
  useEffect(() => {
    const body = turntableCtl.current?.body;
    // Pause settles the card on its nearest front face (F7), never frozen edge-on or showing its back.
    if (!playing && body && !turntableCtl.current?.busy) {
      const front = Math.round(body.flip.x / 360) * 360;
      if (motionLevel() === "calm") body.flip.snap(front);
      else body.flip.t = front;
    }
    turntableLastFrame.current = 0;
    Engine.kick();
  }, [playing]);
  const [interactionHeld, setInteractionHeld] = useState(false);
  const cardPointers = useRef(new Set<number>());
  const [settled, setSettled] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const stageRef = useRef<HTMLDivElement>(null);
  usePauseGate(stageRef, { onChange: setStageLive });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const pointers = cardPointers.current;
    let resume: ReturnType<typeof setTimeout> | undefined;
    const coolDown = () => {
      clearTimeout(resume);
      resume = setTimeout(() => setInteractionHeld(false), INTERACTION_HOLD_MS);
    };
    const press = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element) || !e.target.closest(".mdx-card3d"))
        return;
      clearTimeout(resume);
      pointers.add(e.pointerId);
      setInteractionHeld(true);
    };
    const release = (e: PointerEvent) => {
      if (pointers.delete(e.pointerId) && pointers.size === 0) coolDown();
    };
    const lostCapture = (e: PointerEvent) => {
      // Scene takes capture from the artwork when a drag starts. Only losing the scene's own capture ends it.
      if (e.target instanceof Element && e.target.matches(".mdx-card3d")) release(e);
    };
    const move = (e: PointerEvent) => {
      if (e.buttons === 0) release(e);
    };
    const interrupted = () => {
      if (!pointers.size) return;
      pointers.clear();
      coolDown();
    };
    const visibility = () => {
      if (document.hidden) interrupted();
    };
    // Track the whole press, not just the drag-start notification: a held finger must never time out mid-drag.
    stage.addEventListener("pointerdown", press, true);
    stage.addEventListener("lostpointercapture", lostCapture, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("blur", interrupted);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(resume);
      pointers.clear();
      stage.removeEventListener("pointerdown", press, true);
      stage.removeEventListener("lostpointercapture", lostCapture, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("blur", interrupted);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (
      !mounted ||
      level === "calm" ||
      !playing ||
      hover ||
      focusIn ||
      interactionHeld ||
      !stageLive ||
      count < 2
    )
      return;
    const t = setTimeout(
      () => {
        if (cardPointers.current.size === 0) lot.step(lot.index + 1, "auto");
      },
      level === "lite" ? ADVANCE_LITE_MS : ADVANCE_MS,
    );
    return () => clearTimeout(t);
    // lot.step is a fresh closure each render; the index and the gates are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mounted,
    level,
    playing,
    hover,
    focusIn,
    interactionHeld,
    stageLive,
    count,
    lot.index,
    settled,
  ]);

  // "Drag the card to rotate" (first visit only): fades after the first drag or 6 s, and goes the moment the
  // card turns to another coin (auto-advance, dots, chevrons, keys): a turn sweeps far past the card's box (QA: the
  // chip drew over its top edge mid-turn). It holds the coin it was shown over, so it leaves in the render that
  // starts the turn. After mount, never under calm.
  const [hintOn, setHintOn] = useState<string | null>(null);
  useEffect(() => {
    if (count < 2) return;
    try {
      if (localStorage.getItem(HINT_KEY)) return;
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      return;
    }
    setHintOn(target?.id ?? null);
    const t = setTimeout(() => setHintOn(null), 6000);
    return () => clearTimeout(t);
    // Armed once, over the coin in view; the selection changing must not clear its timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  const hint = hintOn !== null && hintOn === target?.id;

  const trending = data.trending.slice(0, TRENDING_ROWS);
  // What the order means (the Worker ranks by 24h volume, then by the latest trade): on a quiet day every coin has
  // zero volume and the list is simply the most recently traded.
  const trendingBasis = trending.some((c) => (c.volume24h ?? 0) > 0)
    ? HOME_COPY.trendingByVolume
    : HOME_COPY.trendingByLatest;
  // A poll that only reorders Trending must not replay the rows' entrance (delta 13.4); rows glide to their new
  // places instead (M20).
  const trendingSettled = useSettled();
  const trendingRef = useRef<HTMLDivElement>(null);
  useFlip(
    trendingRef,
    trending.map((c) => c.id),
  );
  // Live activity (P1-17): rows hold still under the pointer, with focus inside, or while paused; the rows
  // that arrived since enter with the sky wash, and screen readers hear "2 new activity events".
  const live = useLiveList(data.activity, (e) => e.id, ["activity event", "activity events"]);
  // Newest first across every coin (seeded ids are grouped by coin, so the time decides, then the id).
  const activity = useMemo(
    () => [...live.shown].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
    [live.shown],
  );
  // The live dot means "this is happening now": only while the newest event is under an hour old.
  const recent = hasRecentActivity(activity, now);
  const keysHint = useId();

  const captionMotion = capPhase === "in" ? "mdx-fade" : "";

  // A click on the card opens the coin it shows, writing that coin to the URL first, so Back returns to it.
  function openShown(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (
      !shown ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    if (search.card === shown.id) return;
    e.preventDefault();
    const id = shown.id;
    void navigate({ search: { card: id }, replace: true, resetScroll: false }).then(() =>
      navigate({ to: "/coin/$id", params: { id } }),
    );
  }

  const stepper = (cls: string, align: "center" | "start") => (
    <Stepper
      index={lot.index}
      count={lot.count}
      onStep={lot.step}
      announce={lot.announce}
      prevLabel="Previous featured card"
      nextLabel="Next featured card"
      // Calm never advances the carousel, so there is nothing to pause: no Pause button that says otherwise.
      playing={playing}
      onTogglePlay={level === "calm" ? undefined : togglePlay}
      dotsOnly
      align={align}
      className={cls}
    />
  );

  return (
    <div
      data-ambient-paused={still || undefined}
      className="mdx-page mdx-home cdx-home grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_calc(var(--aside)_-_var(--main-pad))] lg:gap-5 lg:max-xl:[--aside:300px] xl:[--aside:348px] fit:h-full fit:grid-rows-[minmax(0,1fr)]"
    >
      {/* ------------------------------------------------ stage (wall) */}
      <section aria-label="Featured" className="cdx-home-stage relative isolate flex min-w-0 flex-col fit:min-h-0">
        {/* The vitrine's light, bokeh and dust behind the whole stage (the beam falls from the top edge). */}
        <Vitrine hold={!playing} onLive={setAmbientLive} />
        {/* Headline block: Home's header. */}
        <div className="cdx-home__intro flex-none">
          {/* "card." wears a deep holo ink and catches a white sheen once on load. The h1 is the LCP text, so it has
              no arrival: it paints fully visible and in place on the first frame; only the copy and actions arrive. */}
          <h1 className="mdx-display">
            Every coin is a <span className={cx("mdx-holo-ink", still && "is-paused")}>card.</span>
          </h1>
          {/* What is real first (P0-5), then why anyone bids (P1-27). On the devnet test site the banner above
              the page already says what is real, so the hero keeps one line. */}
          <p className="cdx-home__copy mdx-home-arrival mdx-home-arrival--copy">
            {!IS_SIM && CARD_BIDDING_SUSPENDED
              ? "Choose one premium design for your coin. Keep it from day one."
              : WORDS.heroBid}
          </p>
          {/* MintDex: Launch a coin, Explore coins and How it works on the first screen from 1024px up; phones put the
              pair under the featured card (the tab bar carries Launch and Discover too). */}
          <HeroActions className="cdx-home__actions mdx-home-arrival mdx-home-arrival--actions max-lg:hidden" guide={openGuide} />
        </div>

        {/* The featured cards (P1-21): a carousel of one slide at a time that turns to the next coin by itself,
            stepped by the dots, the chevrons or the arrow keys. Dragging rotates the current card in place. */}
        <div
          ref={stageRef}
          role="region"
          aria-roledescription="carousel"
          aria-label="Featured cards"
          aria-describedby={keysHint}
          className="mdx-stage relative flex min-w-0 flex-col fit:min-h-0 fit:flex-1"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setHover(true);
          }}
          onPointerLeave={() => setHover(false)}
          // Keyboard focus inside the carousel pauses it; a mouse click on a dot does not (the hover already does).
          onFocus={(e) => {
            if ((e.target as HTMLElement).matches?.(":focus-visible")) setFocusIn(true);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
          }}
        >
          <p id={keysHint} className="sr-only">
            Left and Right arrow keys step through the featured cards.
          </p>
          {/* The lot: card over its plinth + caption. At fit this is the size container the card fills. */}
          <div
            role="group"
            aria-roledescription="slide"
            aria-label={lot.count ? `${lot.index + 1} of ${lot.count}` : "No cards yet"}
            className="cdx-home__display relative fit:min-h-0 fit:flex-1 fit:[container-type:size]"
          >
            {/* Phones: reserve room for the funding notice, sticky header, ticker, headline, caption and the
                full Pause/stepper controls above the tab bar. Short phones retain a readable 190px card and
                natural scrolling. This overrides alive.css's older header-only height allowance. */}
            <div className="mdx-lot cdx-home__lot relative flex flex-col items-center fit:h-full">
              {/* Desktop chevrons stay at the edges. Phones keep the entire card clear for direct rotation,
                  with navigation and Pause in a separate row below the caption. */}
              <div className="mdx-tt relative flex-none">
                {shown ? <Aura level={shown.level} paused={still} /> : null}
                <Ghosts
                  prev={prevCoin}
                  next={nextCoin}
                  onStep={(d) => lot.step(lot.index + d)}
                  paused={still}
                />
                <Plinth level={shown ? shown.level : null} paused={still} />
                {shown && target ? (
                  <View3DHost
                    item={{ id: shown.id, card: featuredCard(shown) }}
                    list={v3dList}
                    className="mdx-tt__card"
                    btnClassName="mdx-v3dbtn--stage"
                  >
                    <Link
                      to="/coin/$id"
                      params={{ id: shown.id }}
                      tabIndex={-1}
                      aria-hidden
                      draggable={false}
                      className="block"
                      onClick={openShown}
                    >
                      {/* The card itself is a rotation surface. A short tap still opens its coin; a drag stays
                        here and pauses auto-advance so another coin cannot replace the card in your hand. */}
                      <Card3DView
                        ctlRef={turntableCtl}
                        frame={turntableFrame}
                        faces={faces}
                        front={target.id}
                        swap="turn"
                        swapDir={lot.dir === 1 ? -1 : 1}
                        depth="hand"
                        label={`${shown.name} card, ${getCardDesign(shown.cardTemplate).name} design`}
                        drag="turn"
                        tapTurns={false}
                        gyro
                        idle={playing ? "breathe" : "none"}
                        ground="floor"
                        onSwapped={onSwapped}
                        onSettled={() => setSettled((n) => n + 1)}
                        onInteract={(kind) => {
                          turntableLastInput.current = performance.now();
                          if (kind === "drag") {
                            setHintOn(null);
                          }
                        }}
                      />
                    </Link>
                  </View3DHost>
                ) : (
                  <div className="mdx-tt__card">
                    <CardBack depth="hand" />
                  </div>
                )}
                {/* "Drag the card to rotate": first visit only, over the card's top right (MintDex), gone at the first
                    turn and under Calm motion. */}
                {hint ? (
                  <span aria-hidden className="mdx-tt__hint">
                    Drag the card to rotate
                  </span>
                ) : null}
                {/* From 1024px up a chevron sits on each card edge at mid-height (MintDex); phones keep the whole card
                    clear for direct rotation and step from the row below. */}
                {lot.count > 1 ? (
                  <>
                    <ChevronButton
                      dir="left"
                      label="Previous featured card"
                      className="cdx-home__chev cdx-home__chev--prev max-lg:hidden"
                      onClick={() => lot.step((lot.index - 1 + lot.count) % lot.count)}
                    />
                    <ChevronButton
                      dir="right"
                      label="Next featured card"
                      className="cdx-home__chev cdx-home__chev--next max-lg:hidden"
                      onClick={() => lot.step((lot.index + 1) % lot.count)}
                    />
                  </>
                ) : null}
              </div>
              {/* The caption column (right of the card at fit, under it elsewhere). The caption is not keyed on the
                  coin: it fades out and in around the swap by class, so "View coin" stays the same element and keeps
                  focus (P1-21). Its figures are keyed inside LotCaption. The dots and Pause sit right under it. */}
              <div className="cdx-home__side">
                <div className="cdx-home__caption">
                  <div className={captionMotion}>
                    {caption ? (
                      <LotCaption coin={caption} rows={captionRows} />
                    ) : (
                      <Caption as="h2" name="No cards yet">
                        <p className="mt-2 text-[13px] leading-[1.45] text-slate">
                          Launch the first coin and its card will stand here.
                        </p>
                      </Caption>
                    )}
                  </div>
                </div>
                {stepper("cdx-home__stepper max-lg:hidden", "start")}
              </div>
              {shown && target ? (
                <div className="cdx-home__touchtools lg:hidden">
                  <p className="text-center text-[12px] leading-4 text-slate">Drag the card to rotate</p>
                  <GyroChip className="mdx-tt__phonegyro" />
                </div>
              ) : null}
              {/* Phones (MintDex): the 44px chevrons with Pause between them, the dots under them. */}
              {lot.count > 1 ? (
                <div className="cdx-home__controls lg:hidden">
                  <span className="sr-only" aria-live="polite">
                    {lot.announce}
                  </span>
                  <div className="cdx-home__controls-row">
                    <ChevronButton
                      dir="left"
                      label="Previous featured card"
                      onClick={() => lot.step((lot.index - 1 + lot.count) % lot.count)}
                    />
                    {level === "calm" ? (
                      <span aria-hidden className="h-11 w-11 flex-none" />
                    ) : (
                      <button
                        type="button"
                        onClick={togglePlay}
                        aria-label={playing ? "Pause featured cards" : "Play featured cards"}
                        className="mdx-playbtn grid h-11 w-11 flex-none place-items-center rounded-pill text-ink"
                      >
                        <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden fill="currentColor">
                          {playing ? (
                            <>
                              <rect x="2" y="1.5" width="2.2" height="7" rx="0.8" />
                              <rect x="5.8" y="1.5" width="2.2" height="7" rx="0.8" />
                            </>
                          ) : (
                            <path d="M2.5 1.6v6.8a.6.6 0 0 0 .9.5l5.4-3.4a.6.6 0 0 0 0-1L3.4 1.1a.6.6 0 0 0-.9.5Z" />
                          )}
                        </svg>
                      </button>
                    )}
                    <ChevronButton
                      dir="right"
                      label="Next featured card"
                      onClick={() => lot.step((lot.index + 1) % lot.count)}
                    />
                  </div>
                  <div role="group" aria-label="Featured cards" className="cdx-home__dots">
                    {featured.map((c, k) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => lot.step(k)}
                        aria-label={`Show card ${k + 1} of ${lot.count}`}
                        aria-current={k === lot.index || undefined}
                        className="grid h-11 w-11 flex-none place-items-center rounded-pill"
                      >
                        <span className="mdx-step-dot" data-active={k === lot.index || undefined} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

            </div>
          </div>
        </div>
        {/* Phones: Launch and Explore under the featured card (the first screen keeps the card and its caption). */}
        <HeroActions className="cdx-home__actions--phone mt-6 lg:hidden" />
      </section>

      {/* ------------------------------------------------ aside (plinth)
          Desktop: one full-height aside (mdx-aside): flush with the top, right and bottom edges on short
          screens, floating 12px off them above 820px. The top padding takes the float gutter back, so
          "Trending" keeps its y either way. Like the Market, Levels and Coin asides. */}
      <aside
        aria-label="Trending and activity"
        className="cdx-home__aside mdx-plinth mdx-aside flex min-w-0 flex-col gap-6 lg:pt-[calc(2rem_-_var(--gutter))] short:gap-5 short:pt-6 fit:min-h-0 fit:overflow-hidden"
      >
        <section className="flex flex-none flex-col gap-1">
          <SectionHead title="Trending" right={<TextLink to="/discover">See all</TextLink>} />
          {trending.length ? (
            <>
              <p className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-slate">{trendingBasis}<SimTag /></p>
              <div ref={trendingRef} className="mdx-stagger" data-settled={trendingSettled || undefined}>
                {trending.map((c, i) => (
                  <CoinRow key={c.id} coin={c} rank={i + 1} flipId={c.id} />
                ))}
              </div>
            </>
          ) : (
            <EmptyLine>No coins yet.</EmptyLine>
          )}
        </section>
        <LaunchedSection now={now} />
        <section className="flex min-h-0 flex-1 flex-col gap-1">
          {/* "Activity" (MintDex), never "Live activity": in test mode most rows are demo bots, and the line under the
              heading says so. */}
          <SectionHead
            title="Activity"
            live={recent ? activity[0].id : undefined}
            livePaused={live.paused}
            right={activity.length ? <LivePause paused={live.paused} onChange={live.setPaused} /> : undefined}
          />
          {MODE_COPY.botsNote ? <p className="text-[12px] leading-4 text-slate">{MODE_COPY.botsNote}</p> : null}
          <p className="sr-only" role="status" aria-live="polite">
            {live.said}
          </p>
          {activity.length ? (
            <div {...live.bind} aria-label="Recent activity" className="cdx-home__activity mdx-stagger">
              {activity.slice(0, ACTIVITY_ROWS).map((e) => (
                <EventItem key={e.id} e={e} now={now} isNew={live.fresh.has(e.id)} />
              ))}
            </div>
          ) : (
            <EmptyLine>No activity yet.</EmptyLine>
          )}
        </section>
      </aside>
    </div>
  );
}
