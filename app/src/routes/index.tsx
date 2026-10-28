import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { CardBack, GyroChip, View3DHost, useMotionLevel } from "../components/mintdex/card3d";
import { CoinRow, EventItem, LaunchedItem, LaunchedSkeleton } from "../components/mintdex/feeds";
import { faceSlot, type CardData } from "../components/mintdex/MintCard";
import { EmptyState } from "../components/mintdex/empty-state";
import { prefersReducedMotion, revPoll, useNow, usePageKeys } from "../components/mintdex/hooks";
import {
  ButtonLink,
  Change,
  ChevronButton,
  CurveTrack,
  KpiGroup,
  LivePause,
  Num,
  PageFrame,
  PageHeader,
  SectionHead,
  Stepper,
  TextLink,
  useFlip,
  useLiveList,
  usePauseGate,
} from "../components/mintdex/ui";
import { SimTag } from "../components/mintdex/trust";
import { CHAIN_POLL_MS, chainHome, chainHomeLoader, chainInitial } from "../lib/chain/data";
import { getHome } from "../lib/mintdex/api";
import { hasRecentActivity } from "../lib/mintdex/activity-freshness";
import { CARD_BIDDING_SUSPENDED } from "../lib/mintdex/card-bidding";
import { getCardDesign } from "../lib/carddex/designs";
import { fetchLiveLaunches } from "../lib/carddex/live/launches";
import { marketCapText, marketCapWatch } from "../lib/carddex/quote-display";
import { HOME_COPY, IS_SIM, MODE_COPY, WORDS } from "../lib/mintdex/copy";
import { sol } from "../lib/mintdex/format";
import { tierForLevel } from "../lib/mintdex/tiers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, pageHead } from "../lib/mintdex/seo";
import type { CoinSummary, HomeData } from "../lib/mintdex/types";
import { Card3DView } from "../components/mintdex/card3d/Card3D";
import { Engine, motionLevel, type Body } from "../components/mintdex/card3d/motion3d";
import type { SceneCtl } from "../components/mintdex/card3d/scene";
import { ViewTabs } from "../components/carddex/ViewTabs";

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
 * Home answers "What is launching and moving right now, and can I launch mine?" (true-black-flat, Operate mode).
 *
 * PageHeader (the h1 and the one primary, Launch a coin), then three blocks:
 * - stage: the featured card on a calm surface panel (no halo, no glows, no ambient loops), its market line under it
 *   (market cap as the screen's one 30px figure, the 24h change, the bonding-curve track) and the carousel controls.
 * - feed: Trending (5 rows) and Recent activity (6 rows), simulated.
 * - side: the collection KPIs (simulated) and "Launched on pump.fun", the real mainnet launches (/api/live/launches).
 *
 * Widths (home.css): fit (1280x720 and up) puts the three side by side at main's height (5fr 4fr 3fr of the 1152px
 * column), each column scrolling in itself if a short window needs it; 1024 to 1279 and short windows flow, the stage
 * and the feed side by side over the side row; under 1024 the "Featured card / Collection pulse" tabs show the stage
 * (fitted to the screen) or the feed and side (in the page scroll).
 *
 * The card is a held 3D card (Card3D, depth hand) that rests on its front and turns to the next featured coin by itself
 * (16 s after each turn settles, 20 s at the lighter motion level, never under calm), paused while handling the card and briefly afterwards,
 * while the pointer is over the stage, focus is in the carousel, the stage is offscreen, the tab is hidden, a dialog
 * is open or Pause was pressed. Drag to rotate the current card; the arrows, dots and keys select another coin.
 */

/**
 * Auto-advance (L5): a full turn to the next featured coin after the last turn settled; between turns the card rests
 * with the engine's idle "breathe". Lite: a longer wait. Calm: no auto-advance.
 */
const ADVANCE_MS = 16000;
const ADVANCE_LITE_MS = 20000;
/** Let the viewer finish inspecting a card before the carousel resumes, without stopping its own motion. */
const INTERACTION_HOLD_MS = 6000;
/** The caption switches with the selection and fades in (mdx-fade, 160 ms); the class comes off after 260 ms. */
const CAPTION_HALF_MS = 130;
/** If a swap is never reported (a card that could not turn), the card's own link follows the selection after this. */
const CAPTION_FALLBACK_MS = 1800;
/** The visitor's Pause on the featured cards, kept for later visits (MOT-7). */
const PAUSE_KEY = "mdx-featured-paused";
const TRENDING_ROWS = 5;
const ACTIVITY_ROWS = 6;
/** Launched on pump.fun shows six rows before "Show all" (home.css counts them); the endpoint returns at most 12. */
const LAUNCHED_ROWS = 6;

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

/**
 * The featured card's market line: the name and its View coin, the ticker and design, then the market cap (the
 * screen's one 30px figure) with its 24h change, and the bonding-curve track. All of it is simulated demo data.
 * Not keyed on the coin: it fades around a swap by class, so View coin stays the same element and keeps focus.
 */
function LotCaption({ coin: c }: { coin: CoinSummary }) {
  return (
    <div className="cdx-home-lot">
      <div className="cdx-home-lot__head">
        <div className="min-w-0">
          <h2 className="mdx-name cdx-home-lot__name">{c.name}</h2>
          <p className="cdx-home-lot__meta">
            <span className="num">${c.ticker}</span> · {getCardDesign(c.cardTemplate).name} design
          </p>
        </div>
        <ButtonLink to="/coin/$id" params={{ id: c.id }} size="sm" variant="outline">
          {HOME_COPY.viewCoin}
        </ButtonLink>
      </div>
      <div className="cdx-home-lot__market">
        <dl className="cdx-home-lot__cap">
          <dt className="cdx-home-lot__label">
            Market cap <SimTag />
          </dt>
          <dd className="cdx-home-lot__figure">
            {/* The screen's one 30px figure. A poll that moves this coin's market cap flashes it up or down once;
                flashKey keeps a step to another coin from reading as a market move. No odometer roll (Operate mode:
                a step changes the coin, it is not a number to perform). */}
            <Num size="hero" watch={marketCapWatch(c)} flashKey={c.id}>
              {marketCapText(c)}
            </Num>
            <span className="cdx-home-lot__change">
              <Change v={c.change24h} pill />
              <span aria-hidden className="cdx-home-lot__period">
                24h
              </span>
            </span>
          </dd>
        </dl>
        <CurveTrack
          progress={c.curveProgress}
          graduated={c.graduated}
          className="cdx-home-lot__curve"
        />
      </div>
    </div>
  );
}

/** One sentence inside a block that has nothing to show yet (the block keeps its frame and header). */
function EmptyLine({ children }: { children: string }) {
  return <p className="cdx-home-panel__empty">{children}</p>;
}

/**
 * Launched on pump.fun: the real mainnet launches (never simulated). Loading keeps the rows' size; a failed read says
 * so inside the block with a retry; none yet invites the first launch.
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
  return (
    <section aria-labelledby={headId} className="cdx-home-panel cdx-home-launched">
      <div id={headId}>
        <SectionHead title="Launched on pump.fun" />
      </div>
      <p className="cdx-home-panel__meta">Real coins on Solana mainnet, newest first</p>
      {launches.isPending ? (
        <LaunchedSkeleton rows={3} />
      ) : launches.isError && !rows.length ? (
        <div role="alert" className="cdx-home-panel__error">
          <p>Couldn't load the launch list. Check your connection, then try again.</p>
          <TextLink onClick={() => void launches.refetch()} disabled={launches.isFetching}>
            {launches.isFetching ? "Trying again…" : "Try again"}
          </TextLink>
        </div>
      ) : rows.length ? (
        <>
          {/* Every row is rendered; past the first six they wait for "Show all" (home.css), except at fit, where the
              list scrolls inside its panel and needs no toggle. */}
          <ul className="cdx-home-launched__list" data-all={all || undefined}>
            {rows.map((l) => (
              <LaunchedItem key={l.tokenMint} launch={l} now={now} />
            ))}
          </ul>
          {rows.length > LAUNCHED_ROWS ? (
            <TextLink onClick={() => setAll((v) => !v)} className="cdx-home-launched__more">
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </TextLink>
          ) : null}
        </>
      ) : (
        <EmptyState
          inline
          className="cdx-home-launched__empty"
          title="No coins launched yet. Be the first."
          body="Coins launched here on pump.fun are listed with their card."
          action={
            <ButtonLink to="/launch" variant="outline">
              Launch a coin
            </ButtonLink>
          }
        />
      )}
    </section>
  );
}

/** The collection as type in one divided container: coin count, all-time volume and players, all from the demo. */
function CollectionKpis({ stats }: { stats: HomeData["stats"] }) {
  const headId = useId();
  return (
    <section aria-labelledby={headId} className="cdx-home-panel cdx-home-collection">
      <div id={headId}>
        <SectionHead title="Collection" right={<SimTag />} />
      </div>
      <KpiGroup
        size="lg"
        items={[
          { label: "Coins", value: stats.coins.toLocaleString("en-US") },
          {
            label: "Volume",
            value: stats.volume == null ? null : sol(stats.volume, 1),
            unit: "SOL",
            sub: "All time, in SOL terms",
          },
          { label: "Players", value: stats.players.toLocaleString("en-US"), sub: "Demo accounts" },
        ]}
      />
    </section>
  );
}

function Home() {
  const [homeView, setHomeView] = useState<"card" | "pulse">("card");
  const homeViewsId = useId();
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
  const level = useMotionLevel();

  // getHome lists the top coin of each design, lowest design first. The stepper starts on the rarest.
  const featured = useMemo(() => [...data.featured].reverse(), [data.featured]);
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

  // What the card shows right now: the swap happens while its back faces the viewer (onSwapped), and the card's own
  // link follows that. The caption (name, figures, View coin) follows the selection in the same render as the URL
  // and the dots (F5): a click on View coin always opens the coin the dots point at.
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
        sizes: "(max-width: 1023px) 260px, 400px",
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
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [stageLive, setStageLive] = useState(true);
  const turntableCtl = useRef<SceneCtl | null>(null);
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
  // Each frame keeps the swap's arc short on the fitted desktop stage. The card no longer spins on its own between
  // coins (Operate mode: the old 28 deg/s idle spin showed the back under the front's caption half the time); it
  // rests on its front with the engine's breathe, turns to the next coin on a step, and turns in your hand.
  const turntableFrame = (body: Body) => {
    body.turnArcScale = fittedTurntable.current ? 0.2 : 1;
  };
  useEffect(() => {
    const body = turntableCtl.current?.body;
    // Pause settles the card on its nearest front face (F7), never frozen edge-on or showing its back.
    if (!playing && body && !turntableCtl.current?.busy) {
      const front = Math.round(body.flip.x / 360) * 360;
      if (motionLevel() === "calm") body.flip.snap(front);
      else body.flip.t = front;
    }
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

  const trending = data.trending.slice(0, TRENDING_ROWS);
  // What the order means (the Worker ranks by 24h volume, then by the latest trade): on a quiet day every coin has
  // zero volume and the list is simply the most recently traded.
  const trendingBasis = trending.some((c) => (c.volume24h ?? 0) > 0)
    ? HOME_COPY.trendingByVolume
    : HOME_COPY.trendingByLatest;
  // A poll that reorders Trending glides the rows to their new places (M20); no entrance on mount (Operate mode).
  const trendingRef = useRef<HTMLOListElement>(null);
  useFlip(
    trendingRef,
    trending.map((c) => c.id),
  );
  // Live activity (P1-17): rows hold still under the pointer, with focus inside, or while paused; the rows
  // that arrived since get the wash, and screen readers hear "2 new activity events".
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

  return (
    <PageFrame className="cdx-home">
      <PageHeader
        title="Every coin is a card."
        context={
          !IS_SIM && CARD_BIDDING_SUSPENDED
            ? "Choose one premium design for your coin. Keep it from day one."
            : WORDS.heroBid
        }
        right={<ButtonLink to="/launch">Launch a coin</ButtonLink>}
      />
      {/* Phones and tablets: one view at a time, right under the header. Both views stay mounted (CSS shows one), so
          each tab points at its own element, which keeps its landmark role and name. */}
      <ViewTabs
        className="cdx-view-tabs cdx-home__tabs"
        label="Home views"
        idBase={homeViewsId}
        tabs={[
          {
            id: "card",
            label: "Featured card",
            selected: homeView === "card",
            onSelect: () => setHomeView("card"),
            panel: `${homeViewsId}-card`,
          },
          {
            id: "pulse",
            label: "Collection pulse",
            selected: homeView === "pulse",
            onSelect: () => setHomeView("pulse"),
            panel: `${homeViewsId}-pulse`,
          },
        ]}
      />
      <div
        className="mdx-home cdx-home__body"
        data-home-view={homeView}
        data-ambient-paused={!playing || undefined}
      >
        {/* ------------------------------------------------ stage: the featured cards (P1-21), a carousel of one slide
            at a time that turns to the next coin by itself, stepped by the dots, the chevrons or the arrow keys.
            Dragging rotates the current card in place. */}
        <section id={`${homeViewsId}-card`} aria-label="Featured card" className="cdx-home__stage">
          <div
            ref={stageRef}
            role="region"
            aria-roledescription="carousel"
            aria-label="Featured cards"
            aria-describedby={keysHint}
            className="cdx-home__carousel"
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
              Drag the card to rotate it. Left and Right arrow keys step through the featured cards.
            </p>
            <div
              role="group"
              aria-roledescription="slide"
              aria-label={lot.count ? `${lot.index + 1} of ${lot.count}` : "No cards yet"}
              className="cdx-home__slide"
            >
              {/* The size container the card fills: the card and its turn room fit its height and width. */}
              <div className="cdx-home__display">
                <div className="mdx-lot cdx-home__lot">
                  <div className="mdx-tt cdx-home__card">
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
                            ground="none"
                            onSwapped={onSwapped}
                            onSettled={() => setSettled((n) => n + 1)}
                          />
                        </Link>
                      </View3DHost>
                    ) : (
                      <div className="mdx-tt__card">
                        <CardBack depth="hand" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* The caption fades around a swap by class (not keyed), so View coin keeps focus (P1-21). */}
              <div className={`cdx-home__caption ${captionMotion}`}>
                {caption ? (
                  <LotCaption coin={caption} />
                ) : (
                  <div className="cdx-home-lot">
                    <h2 className="mdx-name">No cards yet</h2>
                    <p className="cdx-home-lot__meta">
                      Launch the first coin and its card will stand here.
                    </p>
                  </div>
                )}
              </div>
              {shown && target ? (
                <div className="mdx-phone-tilt cdx-home__gyro">
                  <GyroChip />
                </div>
              ) : null}
              {lot.count > 1 ? (
                <div className="cdx-home__controls">
                  <ChevronButton
                    dir="left"
                    label="Previous featured card"
                    onClick={() => lot.step((lot.index - 1 + lot.count) % lot.count)}
                  />
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
                    className="cdx-home__stepper"
                  />
                  <ChevronButton
                    dir="right"
                    label="Next featured card"
                    onClick={() => lot.step((lot.index + 1) % lot.count)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ the collection pulse: feed (simulated) and side */}
        <div id={`${homeViewsId}-pulse`} className="cdx-home__pulse">
          <div className="cdx-home__feed">
            <section aria-label="Trending" className="cdx-home-panel cdx-home-trending">
              <SectionHead title="Trending" right={<TextLink to="/discover">See all</TextLink>} />
              {trending.length ? (
                <>
                  <p className="cdx-home-panel__meta">
                    {trendingBasis}
                    <SimTag />
                  </p>
                  <ol ref={trendingRef} className="cdx-home-panel__list">
                    {trending.map((c, i) => (
                      <li key={c.id} data-flip={c.id}>
                        <CoinRow coin={c} rank={i + 1} curve />
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <EmptyLine>No coins yet. Trending fills in with the first trades.</EmptyLine>
              )}
            </section>
            <section aria-label="Recent activity" className="cdx-home-panel cdx-home-activity">
              {/* "Recent activity", not "Live activity": in the demo most rows are bots, and the line under the
                  heading says so. */}
              <SectionHead
                title="Recent activity"
                live={recent ? activity[0].id : undefined}
                livePaused={live.paused}
                right={
                  activity.length ? (
                    <LivePause paused={live.paused} onChange={live.setPaused} />
                  ) : undefined
                }
              />
              {MODE_COPY.botsNote ? (
                <p className="cdx-home-panel__meta">{MODE_COPY.botsNote}</p>
              ) : null}
              <p className="sr-only" role="status" aria-live="polite">
                {live.said}
              </p>
              {activity.length ? (
                <div {...live.bind} aria-label="Recent activity" className="cdx-home-panel__list">
                  {activity.slice(0, ACTIVITY_ROWS).map((e) => (
                    <EventItem key={e.id} e={e} now={now} isNew={live.fresh.has(e.id)} />
                  ))}
                </div>
              ) : (
                <EmptyLine>
                  No activity yet. Trades and launches show up here as they happen.
                </EmptyLine>
              )}
            </section>
          </div>
          <div className="cdx-home__side">
            <CollectionKpis stats={data.stats} />
            <LaunchedSection now={now} />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
