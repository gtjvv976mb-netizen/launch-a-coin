import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { CardBack, GyroChip, View3DHost, useMotionLevel } from "../components/mintdex/card3d";
import { CoinRow, EventItem, LaunchedItem, LaunchedSkeleton } from "../components/mintdex/feeds";
import { faceSlot, preloadCard, type CardData } from "../components/mintdex/MintCard";
import { EmptyState } from "../components/mintdex/empty-state";
import { prefersReducedMotion, revPoll, useNow, usePageKeys } from "../components/mintdex/hooks";
import {
  ButtonLink,
  Change,
  CurveTrack,
  KpiGroup,
  LivePause,
  Num,
  PageFrame,
  PageHeader,
  SectionHead,
  TextLink,
  Thumb,
  useFlip,
  useLiveList,
  usePauseGate,
} from "../components/mintdex/ui";
import { SimTag } from "../components/mintdex/trust";
import { CardControlButton } from "../components/carddex/CardControls";
import { CHAIN_POLL_MS, chainHome, chainHomeLoader, chainInitial } from "../lib/chain/data";
import { getHome } from "../lib/mintdex/api";
import { hasRecentActivity } from "../lib/mintdex/activity-freshness";
import { CARD_BIDDING_SUSPENDED } from "../lib/mintdex/card-bidding";
import { getCardDesign } from "../lib/carddex/designs";
import { fetchLiveLaunches } from "../lib/carddex/live/launches";
import { marketCapText, marketCapWatch } from "../lib/carddex/quote-display";
import { HOME_COPY, IS_SIM, MODE_COPY, WORDS } from "../lib/mintdex/copy";
import { sol } from "../lib/mintdex/format";
import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, pageHead } from "../lib/mintdex/seo";
import type { CoinSummary, HomeData } from "../lib/mintdex/types";
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
 * Home answers "What is launching and moving right now, and can I launch mine?" (true-black-flat, Operate mode,
 * density rules R1-R8 in .taste-skill/density/rules.md). One page at every width: no tabs, no carousel controls.
 *
 * PageHeader: the h1, its context line and the one primary (Launch a coin); from 1280 the Collection KPI strip
 * (simulated) sits on the same row, so the header's middle carries data. Then the body:
 * - stage: the featured card on a calm surface panel (no halo, glows or ambient loops), its market line (the name
 *   with $TICKER and design, the market cap as the screen's one 30px figure, the 24h change, the bonding-curve
 *   track), then the picks: a wrapping row of the featured coins' art (a radiogroup, every coin one click away) with
 *   Pause at its end.
 * - pulse: Trending (5 rows) and Recent activity (6 rows), simulated; Collection (below 1280); "Launched on
 *   pump.fun", the real mainnet launches (/api/live/launches), every row the endpoint returns (at most 12).
 *
 * Widths (home.css): from 1024 the stage is a sticky column (no taller than the screen) beside the pulse column
 * (13fr 11fr to 1279, 5fr 7fr from 1280); under 1024 everything stacks in that order, the card sized so its market
 * line and the first line of picks stay in the first screen; phones held sideways put the card beside its caption.
 *
 * The card is a held 3D card (Card3D, depth hand) that rests on its front and turns to the next featured coin by
 * itself (16 s after each turn settles, 20 s at the lighter motion level, never under calm), paused while handling
 * the card and briefly afterwards, while the pointer is over the stage, keyboard focus is in it, the stage is
 * offscreen, the tab is hidden, a dialog is open or Pause was pressed. Drag to rotate the current card; the picks
 * and the Left and Right arrow keys select another coin.
 */

/**
 * Auto-advance (L5): a full turn to the next featured coin after the last turn settled; between turns the card rests
 * with the engine's idle "breathe". Lite: a longer wait. Calm: no auto-advance.
 */
const ADVANCE_MS = 16000;
const ADVANCE_LITE_MS = 20000;
/** Let the viewer finish inspecting a card before the stage resumes, without stopping its own motion. */
const INTERACTION_HOLD_MS = 6000;
/** The caption switches with the selection and fades in (mdx-fade, 160 ms); the class comes off after 260 ms. */
const CAPTION_HALF_MS = 130;
/** If a swap is never reported (a card that could not turn), the card's own link follows the selection after this. */
const CAPTION_FALLBACK_MS = 1800;
/** The visitor's Pause on the featured cards, kept for later visits (MOT-7). */
const PAUSE_KEY = "mdx-featured-paused";
const TRENDING_ROWS = 5;
const ACTIVITY_ROWS = 6;
/**
 * At most ten featured coins, rarest first: one line of picks on every desktop stage (10 x 40 + Pause fits the 1024
 * stage), so the card never shrinks for them. The rest stay one click away on Discover.
 */
const FEATURED_MAX = 10;
/** The staged faces' sizes (the card is at most 320px on phones, 400px from 640px; 351px on a 1440 stage). */
const FACE_SIZES = "(max-width: 639px) 280px, 400px";

/**
 * The featured lot: which coin is selected and the step direction. The selection follows the coin (by id)
 * across polls, so a refetch never swaps the card under the viewer; if the coin leaves the featured set, the
 * same slot stays selected. Manual steps announce and call onSelect (the URL); auto steps do neither.
 */
function useLot(featured: CoinSummary[], initialId?: string, onSelect?: (id: string) => void) {
  const [sel, setSel] = useState<{ id: string | null; i: number }>({ id: initialId ?? null, i: 0 });
  // What the stage's live region says after a step (P1-21): set on a manual step only, so polls never repeat it.
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
    // The picks and the arrow keys hand over indexes that already wrapped: last to first is a step forward,
    // first to last a step back.
    const wrapped = count > 2 && Math.abs(target - index) === count - 1;
    setDir(wrapped ? (target === 0 ? 1 : -1) : target > index ? 1 : -1);
    setSel({ id: to.id, i: target });
    if (how === "auto") return;
    // The design the card and its caption name (getCardDesign), never the level's tier.
    setAnnounce(
      `${to.name}, ${getCardDesign(to.cardTemplate).name} design, market cap ${marketCapText(to)}, ${target + 1} of ${count}`,
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
 * The featured card's market line: the name with its $TICKER and design (desktop) and View coin on one row, then the
 * market cap (the screen's one 30px figure) with its 24h change, and the bonding-curve track. All of it is simulated
 * demo data. Not keyed on the coin: it fades around a swap by class, so View coin stays the same element and keeps
 * focus.
 */
function LotCaption({ coin: c }: { coin: CoinSummary }) {
  return (
    <div className="cdx-home-lot">
      <div className="cdx-home-lot__head">
        <div className="cdx-home-lot__id">
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

/**
 * The featured coins as a wrapping row of their art (density R2 and R4: every coin one click away, no swipe, no
 * dots): a radiogroup with one tab stop. The arrow keys move the choice (and focus) with wrap, Home and End jump to
 * the ends; each key is handled here (preventDefault), so the page's own arrow keys do not step a second time.
 * Hover and focus warm the coin's card art, so a click turns to a face that is already decoded.
 */
function FeaturedPicks({
  coins,
  index,
  onPick,
}: {
  coins: CoinSummary[];
  index: number;
  onPick: (i: number) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const warmed = useRef(new Set<string>());
  const warm = (c: CoinSummary) => {
    if (warmed.current.has(c.id)) return;
    warmed.current.add(c.id);
    void preloadCard(featuredCard(c), FACE_SIZES);
  };
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const n = coins.length;
    let next: number;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + n) % n;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    onPick(next);
  }
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Featured coins"
      className="cdx-home__picks"
      onKeyDown={onKeyDown}
    >
      {coins.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          aria-label={`${c.name} ($${c.ticker})`}
          data-tip={c.name}
          className="cdx-home__pick"
          onClick={() => onPick(i)}
          onPointerEnter={() => warm(c)}
          onFocus={() => warm(c)}
        >
          <Thumb src={c.image} size={36} />
        </button>
      ))}
    </div>
  );
}

/**
 * Launched on pump.fun: the real mainnet launches (never simulated), every row the endpoint returns (at most 12) as
 * tiles in an auto-fill grid. Loading keeps the tiles' size; a failed read says so inside the block with a retry; none
 * yet is one line and the launch action.
 */
function LaunchedSection({ now }: { now: number }) {
  const headId = useId();
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
      <SectionHead
        title={<span id={headId}>Launched on pump.fun</span>}
        right={<span className="cdx-home-panel__meta">Real · Solana mainnet</span>}
      />
      {launches.isPending ? (
        <LaunchedSkeleton rows={2} />
      ) : launches.isError && !rows.length ? (
        <div role="alert" className="cdx-home-panel__error">
          <p>Couldn't load the launch list. Check your connection, then try again.</p>
          <TextLink onClick={() => void launches.refetch()} disabled={launches.isFetching}>
            {launches.isFetching ? "Trying again…" : "Try again"}
          </TextLink>
        </div>
      ) : rows.length ? (
        <ul className="cdx-home-launched__list">
          {rows.map((l) => (
            <LaunchedItem key={l.tokenMint} launch={l} now={now} />
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          title="No coins launched yet. Be the first."
          action={
            <ButtonLink to="/launch" variant="outline" size="sm">
              Launch a coin
            </ButtonLink>
          }
        />
      )}
    </section>
  );
}

/**
 * The collection as a one-row KPI strip (density R6): coin count, all-time volume and players, all from the demo.
 * Two places, one shown per width (home.css): "head" sits in the PageHeader row from 1280, "body" is a slim panel in
 * the pulse below 1280. The hidden copy is display:none, so only one reaches the accessibility tree.
 */
function CollectionKpis({ stats, place }: { stats: HomeData["stats"]; place: "head" | "body" }) {
  const headId = useId();
  const strip = (
    <KpiGroup
      strip
      size="md"
      className="cdx-home-collection__strip"
      items={[
        { label: "Coins", value: stats.coins.toLocaleString("en-US") },
        {
          label: "All-time volume",
          value: stats.volume == null ? null : sol(stats.volume, 1),
          unit: "SOL",
        },
        { label: "Players", value: stats.players.toLocaleString("en-US") },
      ]}
    />
  );
  if (place === "head") {
    return (
      <section aria-labelledby={headId} className="cdx-home-collection" data-place="head">
        <p className="cdx-home-collection__label">
          <span id={headId}>Collection</span>
          <SimTag />
        </p>
        {strip}
      </section>
    );
  }
  return (
    <section
      aria-labelledby={headId}
      className="cdx-home-panel cdx-home-collection"
      data-place="body"
    >
      <div className="cdx-home-collection__body">
        <div className="cdx-home-collection__head">
          <h2 id={headId} className="mdx-h2">
            Collection
          </h2>
          <SimTag />
        </div>
        {strip}
      </div>
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
  const level = useMotionLevel();

  // getHome lists the top coin of each design, lowest design first. The picks start on the rarest, at most ten.
  const featured = useMemo(
    () => [...data.featured].reverse().slice(0, FEATURED_MAX),
    [data.featured],
  );
  // The 3D viewer steps through the featured cards in the picks' order.
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
  // and the picks (F5): a click on View coin always opens the coin the picks point at.
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
      /* storage blocked: the stage starts playing */
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
    // The desktop stage (a panel no taller than the screen, 0.06W of turn room): the swap's arc stays short.
    const media = window.matchMedia("(min-width: 1024px)");
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
  // Each frame keeps the swap's arc short on the desktop stage. The card no longer spins on its own between coins
  // (Operate mode: the old 28 deg/s idle spin showed the back under the front's caption half the time); it rests on
  // its front with the engine's breathe, turns to the next coin on a step, and turns in your hand.
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
  const stageRef = useRef<HTMLElement>(null);
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
        aside={<CollectionKpis place="head" stats={data.stats} />}
        right={<ButtonLink to="/launch">Launch a coin</ButtonLink>}
      />
      <div className="mdx-home cdx-home__body" data-ambient-paused={!playing || undefined}>
        {/* ------------------------------------------------ stage: the featured card (P1-21), which turns to the
            next coin by itself; the picks under it select any featured coin in one click. Dragging rotates the
            current card in place. */}
        <section
          ref={stageRef}
          aria-label="Featured card"
          aria-describedby={keysHint}
          className="cdx-home__stage"
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setHover(true);
          }}
          onPointerLeave={() => setHover(false)}
          // Keyboard focus inside the stage pauses it; a mouse click on a pick does not (the hover already does).
          onFocus={(e) => {
            if ((e.target as HTMLElement).matches?.(":focus-visible")) setFocusIn(true);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false);
          }}
        >
          <p id={keysHint} className="sr-only">
            Drag the card to rotate it. Choose a featured coin below, or use the Left and Right arrow
            keys.
          </p>
          {/* What a manual step selected (the picks, the arrow keys): never an auto step or a poll. */}
          <p className="sr-only" aria-live="polite">
            {lot.announce}
          </p>
          {/* The card's box: on desktop a size container the card fits (its 88/63 height plus turn room); under
              1024 the card is sized from the column and the screen (home.css). */}
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
                <p className="cdx-home-lot__empty">
                  Launch the first coin and its card will stand here.
                </p>
              </div>
            )}
          </div>
          {lot.count > 1 ? (
            <div className="cdx-home__picks-row">
              <FeaturedPicks coins={featured} index={lot.index} onPick={(i) => lot.step(i)} />
              {/* Always rendered: calm never advances, and home.css hides Pause there from the first paint (the
                  head script sets html[data-motion] before it), so hydration never reflows the row. */}
              <CardControlButton
                icon={playing ? "pause" : "play"}
                label={playing ? "Pause featured cards" : "Play featured cards"}
                tip={playing ? "Pause" : "Play"}
                className="cdx-home__play"
                onClick={togglePlay}
              />
            </div>
          ) : null}
          {shown && target ? (
            <div className="mdx-phone-tilt cdx-home__gyro">
              <GyroChip />
            </div>
          ) : null}
        </section>

        {/* ------------------------------------------------ the pulse: Trending and Recent activity (simulated),
            Collection (below 1280; the header shows it from 1280) and the real launches */}
        <section aria-label="Trending" className="cdx-home-panel cdx-home-trending">
          <SectionHead
            title="Trending"
            right={
              <span className="cdx-home-head__right">
                {trending.length ? (
                  <span className="cdx-home-panel__meta">
                    {trendingBasis}
                    <SimTag />
                  </span>
                ) : null}
                <TextLink to="/discover">See all</TextLink>
              </span>
            }
          />
          {trending.length ? (
            <ol ref={trendingRef} className="cdx-home-panel__list">
              {trending.map((c, i) => (
                <li key={c.id} data-flip={c.id}>
                  <CoinRow coin={c} rank={i + 1} curve />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState compact title="No coins yet." body="Trending fills in with the first trades." />
          )}
        </section>
        <section aria-label="Recent activity" className="cdx-home-panel cdx-home-activity">
          {/* "Recent activity", not "Live activity": in the demo most rows are bots, and the note beside the
              heading says so. */}
          <SectionHead
            title="Recent activity"
            live={recent ? activity[0].id : undefined}
            livePaused={live.paused}
            right={
              MODE_COPY.botsNote || activity.length ? (
                <span className="cdx-home-head__right">
                  {MODE_COPY.botsNote ? (
                    <span className="cdx-home-panel__meta">{MODE_COPY.botsNote}</span>
                  ) : null}
                  {activity.length ? (
                    <LivePause paused={live.paused} onChange={live.setPaused} />
                  ) : null}
                </span>
              ) : undefined
            }
          />
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
            <EmptyState
              compact
              title="No activity yet."
              body="Trades and launches show up here as they happen."
            />
          )}
        </section>
        <CollectionKpis place="body" stats={data.stats} />
        <LaunchedSection now={now} />
      </div>
    </PageFrame>
  );
}
