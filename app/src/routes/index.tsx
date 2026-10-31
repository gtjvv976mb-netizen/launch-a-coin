import { useQuery } from "@tanstack/react-query";
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
import { LaunchedItem, LaunchedSkeleton } from "../components/mintdex/feeds";
import { MintCardFace, faceSlot, type CardData } from "../components/mintdex/MintCard";
import { prefersReducedMotion, useNow, usePageKeys } from "../components/mintdex/hooks";
import {
  ButtonLink,
  Caption,
  SectionHead,
  ChevronButton,
  Stepper,
  TextLink,
  usePauseGate,
} from "../components/mintdex/ui";
import { PairLogo } from "../components/carddex/PairLogo";
import { launchCard, liveLaunchesQuery, SOLANA_ADDRESS, type PublicLiveLaunch } from "../lib/carddex/live/launches";
import { getLaunchedCoins } from "../lib/carddex/live/launched";
import { getCardDesign } from "../lib/carddex/designs";
import { designChipText, featuredStepText } from "../lib/carddex/featured-copy";
import { getPairAsset } from "../lib/carddex/pairs";
import { tierForLevel } from "../lib/mintdex/tiers";
import { EXPLORE_COINS, HOME_COPY, WORDS } from "../lib/mintdex/copy";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, pageHead } from "../lib/mintdex/seo";
import { OFFICIAL_SAME_AS } from "../lib/carddex/official";
import "../home-motion.css";
import { Card3DView } from "../components/mintdex/card3d/Card3D";
import { Engine, motionLevel, type Body } from "../components/mintdex/card3d/motion3d";
import type { SceneCtl } from "../components/mintdex/card3d/scene";

/**
 * Back keeps your place (P1-14): the featured card on the ledge is mirrored in the URL (/?card=<mint>), so
 * Back from its coin page returns to the same card. Hand-written validation: anything odd is ignored.
 */
type HomeSearch = { card?: string };
function validateHomeSearch(raw: Record<string, unknown>): HomeSearch {
  return { card: typeof raw.card === "string" && SOLANA_ADDRESS.test(raw.card) ? raw.card : undefined };
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
      // The official X account and the site's own pump.fun token page (lib/carddex/official.ts).
      sameAs: [...OFFICIAL_SAME_AS],
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
  loader: () => getLaunchedCoins(),
  head: () => ({
    ...pageHead({
      path: "/",
      title: "Launch a Card: every coin is a one-of-one card",
      description: SITE_DESCRIPTION,
    }),
    // SEO-5: what the site is, from facts it already states. sameAs: its official X account and pump.fun token page.
    scripts: [{ type: "application/ld+json", children: HOME_JSON_LD }],
  }),
  component: Home,
});

/*
 * Home (spec 8.1, family A; refs/alive-3d-spec.md 5.1, the Turntable vitrine): stage + aside.
 *
 * The MintDex home (mintdex.fun, in the D1 Logo Ground palette): headline and actions over the featured-card stage, the
 * rail with Launched on pump.fun on the right; phones stack the rail under the stage as one panel. Every coin here is
 * a finished mainnet launch (GET /api/live/launches): the newest four stand on the stage as the cards they minted.
 * Before the first launch the stage holds a card back and says so, and the rail says "No coins yet".
 *
 * Two regimes, one DOM:
 * - fit (1280x720 and up): the no-scroll template. The headline block sits top left; under it the featured card
 *   floats over a holo plinth in a size container that runs to the stage's foot, sized so the card and the whole
 *   plinth fit (alive.css). The card and its caption sit centered as one group (the previous coin's ghost has room
 *   on the left), a chevron on each card edge, the dots and Pause right under the caption. The aside lists the
 *   launches.
 * - everything else (phones, 1024 to 1279, short windows): natural flow. The card is up to 260px wide over its
 *   plinth, with a chevron on each edge, the caption, the dots and Pause, then the launches. Phones
 *   move the chevrons below the card into a dedicated control row so a full-width drag never hits an arrow.
 *   A compact caption keeps View card beside the name and pair; short phones scroll naturally.
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
/** Featured cards on the stage (MintDex: four), newest launch first. */
const FEATURED_COUNT = 4;
/** Launches the rail lists; "See all" opens the rest on Discover. */
const LAUNCHED_ROWS = 8;
/** The featured card's image sizes (LCP): the laid-out card at each width, so a 1.75x phone takes the 480w copy. */
const FACE_SIZES = "(max-width: 639px) 270px, (max-width: 1023px) 400px, (max-width: 1439px) 300px, 400px";

/**
 * The featured lot: which coin is selected and the step direction. The selection follows the coin (by id)
 * across polls, so a refetch never swaps the card under the viewer; if the coin leaves the featured set, the
 * same slot stays selected. Manual steps announce and call onSelect (the URL); auto steps do neither.
 */
/** A featured launch: its mint as the id (the coin page's address), its name, and the card it minted. */
type Featured = { id: string; name: string; ticker: string; level: number; cardTemplate: string; launch: PublicLiveLaunch; card: CardData };
function featuredOf(launch: PublicLiveLaunch): Featured {
  const card = launchCard(launch);
  return { id: launch.tokenMint, name: launch.name, ticker: launch.ticker, level: card.level, cardTemplate: launch.designKey, launch, card };
}

function useLot(featured: Featured[], initialId?: string, onSelect?: (id: string) => void) {
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
    setAnnounce(featuredStepText(to, target + 1, count));
    onSelect?.(to.id);
  }

  return { index, count, selected, dir, step, announce };
}

/** The face a featured coin shows on the turntable: the card it minted. */
function featuredCard(c: Featured): CardData {
  return c.card;
}

/** Exhibition light belongs to the site palette (D1: a soft amber halo of amber, antique gold, warm cream and deep
 *  amber); each card keeps its own foil colours. */
function auraColors(_level: number): string[] {
  return ["var(--halo-1)", "var(--halo-2)", "var(--halo-3)", "var(--halo-4)"];
}

/** The pool of light on the plinth: the tier's sheen (its second color for many-color tiers), else its ring. */
function poolColor(level: number) {
  const t = tierForLevel(level);
  return t.sheen.length > 1 ? t.sheen[1] : t.sheen[0] === "#FFFFFF" ? t.ring : t.sheen[0];
}

/** Bokeh, beam and dust for the vitrine: fixed positions (no randomness in render, SSR safe). */
const BOKEH = [
  { x: "8%", y: "18%", sz: 110, c: "var(--halo-4)", d: 18, del: -3, dx: "26px", dy: "-18px" },
  { x: "62%", y: "8%", sz: 80, c: "var(--light-1)", d: 22, del: -9, dx: "-20px", dy: "16px" },
  { x: "30%", y: "60%", sz: 64, c: "var(--light-2)", d: 16, del: -5, dx: "18px", dy: "-22px" },
  { x: "78%", y: "46%", sz: 96, c: "var(--light-5)", d: 20, del: -12, dx: "-24px", dy: "-12px" },
  { x: "46%", y: "28%", sz: 40, c: "var(--halo-1)", d: 14, del: -2, dx: "14px", dy: "20px" },
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
  prev: Featured | null;
  next: Featured | null;
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

/**
 * The featured caption: the coin's name, its design (from 1024px up: the card face names it too), its pair with the
 * pair's logo, and one View card button. Phones: a compact block under the card with the button beside the name and
 * pair, so the card, its name and the button share the first screen.
 */
function LotCaption({ coin: c }: { coin: Featured }) {
  const pair = getPairAsset(c.launch.quoteAssetKey);
  return (
    <div className="mdx-caption max-lg:grid max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:items-center max-lg:gap-x-4">
      <h2 className="mdx-name mt-0 truncate">{c.name}</h2>
      {/* The coin's one creator-chosen design (MintDex's design chip). */}
      <p className="cdx-home__design max-lg:hidden">
        <span className="cdx-home__chip">{designChipText(c)}</span>
      </p>
      <dl className="mdx-leaders mt-4 flex flex-col gap-2 max-lg:col-start-1 max-lg:mt-1">
        <div>
          <dt className="text-[13px] text-slate">Pair</dt>
          <dd className="flex min-w-0 items-center justify-end gap-2">
            <PairLogo asset={pair} size={20} />
            <span className="truncate">
              ${c.ticker} / {pair.symbol}
            </span>
          </dd>
        </div>
      </dl>
      <div className="mt-4 max-lg:col-start-2 max-lg:row-span-2 max-lg:row-start-1 max-lg:mt-0">
        {/* Phones: the secondary (suede) button, so Launch a coin, right under this caption there, is the page's one
            red action; from 1024px the caption keeps MintDex's primary. */}
        <ButtonLink to="/coin/$id" params={{ id: c.id }} size="sm" variant="outline" className="lg:hidden">
          {HOME_COPY.viewCoin}
        </ButtonLink>
        <ButtonLink to="/coin/$id" params={{ id: c.id }} size="sm" className="max-lg:hidden">
          {HOME_COPY.viewCoin}
        </ButtonLink>
      </div>
    </div>
  );
}

/** A line whose word "pair" links to what a pair is (/how#pairs): one tap to the definition, no new words. */
function PairLinked({ text }: { text: string }) {
  const at = text.search(/\bpair\b/);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <TextLink to="/how" hash="pairs" className="cdx-home__pair">pair</TextLink>
      {text.slice(at + 4)}
    </>
  );
}

/** The hero's two buttons: on the first screen from 1024px up; on phones right under the featured card's caption,
 *  so they are on the first screen there too (the tab bar carries Launch and Discover as well). */
function HeroActions({ className = "", guide = false }: { className?: string; guide?: boolean }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-3", className)}>
      <ButtonLink to="/launch">Launch a coin</ButtonLink>
      <ButtonLink to="/discover" variant="ghost">
        {EXPLORE_COINS}
      </ButtonLink>
      {/* The details page from the first screen (P1-7), desktop only: phones have the header's help button. */}
      {guide ? (
        <TextLink to="/how" className="ml-2 text-[14px]">
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
 * Launched on pump.fun: every coin the site lists, newest first. The rail shows the first LAUNCHED_ROWS; "See all"
 * opens Discover. Loading keeps one row's height, so the rail never jumps when the answer lands; before the first
 * launch it says "No coins yet" with the Launch link.
 */
function LaunchedSection({
  now,
  rows,
  pending,
  failed,
  retrying,
  retry,
}: {
  now: number;
  rows: PublicLiveLaunch[];
  pending: boolean;
  failed: boolean;
  retrying: boolean;
  retry: () => void;
}) {
  const headId = useId();
  return (
    <section aria-labelledby={headId} className="cdx-home-launched flex min-h-0 flex-1 flex-col gap-1">
      <SectionHead
        title={<span id={headId}>Launched on pump.fun</span>}
        right={rows.length > LAUNCHED_ROWS ? <TextLink to="/discover">See all {rows.length}</TextLink> : undefined}
      />
      {pending ? (
        <LaunchedSkeleton rows={1} />
      ) : failed && !rows.length ? (
        <div role="alert" className="cdx-home-launched__error">
          <p>Couldn't load launches.</p>
          <TextLink onClick={retry} disabled={retrying}>
            {retrying ? "Trying again…" : "Try again"}
          </TextLink>
        </div>
      ) : rows.length ? (
        <ul className="cdx-home-launched__list">
          {rows.slice(0, LAUNCHED_ROWS).map((l) => (
            <LaunchedItem key={l.tokenMint} launch={l} now={now} />
          ))}
        </ul>
      ) : (
        <EmptyLine>
          No coins yet. <TextLink to="/launch">Launch the first one</TextLink>
        </EmptyLine>
      )}
    </section>
  );
}

function Home() {
  const initial = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The server render's list seeds the shared query (Discover and the header search read the same one); a failed
  // server read leaves it to the browser.
  const launches = useQuery({ ...liveLaunchesQuery, initialData: initial ?? undefined });
  const rows = launches.data ?? [];
  const now = useNow();
  const level = useMotionLevel();
  // The newest launches stand on the stage, newest first.
  const featured = useMemo(() => rows.slice(0, FEATURED_COUNT).map(featuredOf), [rows]);
  // The 3D viewer steps through the featured cards in the stepper's order.
  const v3dList = useMemo(
    () => featured.map((c) => ({ id: c.id, card: featuredCard(c) })),
    [featured],
  );
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
    const add = (c: Featured | null | undefined) => {
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
          {/* What it is, in one line: a pump.fun launch whose pair picks its card. */}
          <p className="cdx-home__copy mdx-home-arrival mdx-home-arrival--copy">
            <PairLinked text={WORDS.heroBid} />
          </p>
          {/* MintDex: Launch a coin, Discover coins and How it works on the first screen from 1024px up; phones put the
              pair under the featured card (the tab bar carries Launch and Discover too). */}
          <HeroActions className="cdx-home__actions mdx-home-arrival mdx-home-arrival--actions max-lg:hidden" guide />
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
            aria-label={lot.count ? `${lot.index + 1} of ${lot.count}` : "No coins yet"}
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
                      <LotCaption coin={caption} />
                    ) : (
                      <Caption as="h2" name="No coins yet">
                        <p className="mt-2 text-[13px] leading-[1.45] text-slate">
                          Launch the first coin and its card will stand here.
                        </p>
                      </Caption>
                    )}
                  </div>
                </div>
                {stepper("cdx-home__stepper max-lg:hidden", "start")}
              </div>
              {/* Phones: Launch a coin and Discover coins right under the caption, so they are on the first screen
                  above the tab bar; the drag line, tilt chip, chevrons, Pause and dots follow. */}
              <HeroActions className="cdx-home__actions--phone lg:hidden" />
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
      </section>

      {/* ------------------------------------------------ aside (plinth)
          Desktop: one full-height aside (mdx-aside): flush with the top, right and bottom edges on short
          screens, floating 12px off them above 820px. The top padding takes the float gutter back, so
          the heading keeps its y either way. Like the Levels and Coin asides. */}
      <aside
        aria-label="Launched coins"
        className="cdx-home__aside mdx-plinth mdx-aside flex min-w-0 flex-col gap-6 lg:pt-[calc(2rem_-_var(--gutter))] short:gap-5 short:pt-6 fit:min-h-0 fit:overflow-hidden"
      >
        <LaunchedSection
          now={now}
          rows={rows}
          pending={launches.isPending}
          failed={launches.isError}
          retrying={launches.isFetching}
          retry={() => void launches.refetch()}
        />
      </aside>
    </div>
  );
}
