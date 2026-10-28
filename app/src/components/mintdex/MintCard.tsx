import { useContext, useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { getCardDesign, type CardDesign } from "../../lib/carddex/designs";
import { GeneratedCardFront, GeneratedCardFinish, generatedCardStyle } from "../carddex/GeneratedCardArt";
import { TradingCardFace } from "./TradingCardFace";
import "../../carddex-cards.css";

import { usdCompact } from "../../lib/mintdex/format";
import { cardArtSources } from "../../lib/mintdex/art";
import {
  MAX_LEVEL,
  frameLayout,
  frameLightMapSrc,
  frameMiniSrc,
  frameSrc,
  frameSrcSet,
  tierForLevel,
  type Box,
  type FrameLayout,
  type TierKey,
} from "../../lib/mintdex/tiers";
import { Card3DView } from "./card3d/Card3D";
import { TierCraft } from "./TierCraft";
import { CardPrint, boxStyle } from "./CardPrint";
import { EditionCard } from "./EditionCard";
import { getEdition, type EditionKey } from "../../lib/mintdex/editions";
import { MemeIconCard } from "./MemeIconCard";
import { getMemeIcon, type MemeIconKey } from "../../lib/mintdex/meme-icons";
import { FaceDepth } from "./card3d/faceContext";
import { motionLevel, notifyRevealed, requestAscend, trackReveal } from "./card3d/motion3d";
import type { SceneCtl } from "./card3d/scene";
import type {
  Card3DHandle,
  CardDepth,
  CardEnter,
  CardGround,
  CardIdle,
  CardSide,
  CardSwap,
  FaceSlot,
  TierLight,
} from "./card3d/types";

export type CardData = {
  /** The creator-selected permanent print. Price and market cap never change it. */
  cardTemplate?: string;
  /** Cosmetic preview identity, independent from the token's earned market-cap tier. Not an entitlement. */
  edition?: EditionKey;
  /** Cosmetic template preview applied to this token's identity; never a purchased entitlement. */
  memeIcon?: MemeIconKey;
  name: string;
  ticker: string;
  image: string;
  level: number;
  mcapUsd: number;
  /** A preview without a current quote can name the unavailable value instead of inventing a market cap. */
  mcapLabel?: string;
  holders: number;
  dexNo: number;
  lore?: string;
  ownerHandle?: string;
  /** The owner is a demo bot (test mode, backlog P0-6): the footer marks it, as every list does. */
  ownerIsBot?: boolean;
  mintAddress?: string | null;
  /** Overrides the dex number shown on the card (e.g. "NEW" in the launch preview). */
  dexLabel?: string;
};

/** Resolve every surface from one permanent creator choice, including legacy cosmetic previews. */
export function cardDesign(card: CardData): CardDesign {
  return getCardDesign(card.cardTemplate ?? card.memeIcon ?? card.edition);
}
export function designedCard(card: CardData): CardData {
  const design = cardDesign(card);
  return { ...card, cardTemplate: design.key, level: design.materialLevel, edition: design.edition, memeIcon: design.memeIcon };
}
export function cardLight(card: CardData): TierLight {
  const design = cardDesign(card);
  const tier = tierForLevel(design.materialLevel);
  return { finish: design.finish, sheen: [design.palette[1], design.palette[2], ...tier.sheen], ring: design.palette[1], key: tier.key };
}
export function cardBackTheme(card: CardData) {
  const design = cardDesign(card);
  return { cardTemplate: design.key, edition: design.edition, memeIcon: design.memeIcon };
}

const DECODE_CAP_MS = 600;
const SPARKLE = new Set<TierKey>(["spark", "surge", "nova", "tide", "apex", "ember", "bloom", "mythic", "aurora", "relic", "frost", "regal", "celestial", "legend"]);
const ART_HOLO = new Set<TierKey>(["frost", "regal", "celestial", "legend"]);
const HOLES = new Map<TierKey, string>();
function foilHoles(key: TierKey, layout: FrameLayout): string {
  let url = HOLES.get(key);
  if (!url) {
    const w = 1000, h = w * 88 / 63;
    const rect = (b: Box) => `<rect x='${b.x*w}' y='${b.y*h}' width='${b.w*w}' height='${b.h*h}' rx='8'/>`;
    url = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>${[layout.name, layout.type, layout.text, ...layout.footer].map(rect).join("")}</svg>`)}")`;
    HOLES.set(key, url);
  }
  return url;
}

/**
 * Fetch a design's frame ahead of time at the copy a card img with these `sizes` would pick: the same srcset
 * and sizes, so the browser makes the same choice and the card later finds it in the cache (never a second copy).
 * Resolves once decoded (or failed).
 */
export function preloadFrame(key: TierKey, sizes: string): Promise<void> {
  const img = new Image();
  img.decoding = "async";
  img.sizes = sizes;
  img.srcset = frameSrcSet(key);
  img.src = frameSrc(key);
  return img.decode().catch(() => undefined);
}

/**
 * Decode the art copy and the frame copy a face will pick at `sizes` (the Home turntable stages the next coin
 * with it). Never throws; resolves in at most 600 ms.
 */
export function preloadCard(card: CardData, sizes: string, level = card.level): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const design = cardDesign(card);
  const jobs: Promise<unknown>[] = design.layout ? [] : [preloadFrame(tierForLevel(design.materialLevel).key, sizes)];
  if (card.image) {
    const img = new Image();
    img.decoding = "async";
    const set = cardArtSources(card.image);
    if (set) {
      img.sizes = sizes;
      img.srcset = set.srcSet;
      img.src = set.card;
    } else img.src = card.image;
    jobs.push(img.decode().catch(() => undefined));
  }
  return Promise.race([
    Promise.all(jobs).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, DECODE_CAP_MS)),
  ]);
}

/** The frame img's sizes when the caller does not say: eager cards by viewport, lazy ones by their laid-out width. */
function defaultFrameSizes(priority: boolean, compact: boolean) {
  if (priority) return compact ? "200px" : "(max-width: 1023px) 260px, 400px";
  return `auto, ${compact ? "180px" : "300px"}`;
}

/**
 * Coin art comes in sized copies (backlog P1-4): uploads at 96, 320 and 800 px, the seeded creatures at 96 and
 * 320 px beside the 800 px original (art.ts). The browser picks the copy that fits the art window (about 82% of
 * the card width): a lazy card reads its laid-out width (sizes="auto"), an eager one uses the card's own sizes
 * (a slight overestimate). Anything else loads as is. Lite faces take the 96 px copy.
 */
function artSources(src: string, compact: boolean, priority: boolean, cardSizes: string | undefined, lite: boolean) {
  const set = cardArtSources(src);
  if (!set) return { src };
  if (lite) return { src: set.card, srcSet: set.srcSet, sizes: "96px" };
  return {
    src: set.card,
    srcSet: set.srcSet,
    sizes: priority ? (cardSizes ?? (compact ? "150px" : "300px")) : `auto, ${compact ? "150px" : "300px"}`,
  };
}

/** The light a design throws (bursts, the light pool), from tiers.ts. */
export function tierLight(level: number): TierLight {
  const t = tierForLevel(level);
  return { finish: t.finish, sheen: t.sheen, ring: t.ring, key: t.key };
}

/** The scene's label (the old card's aria-label, unchanged). */
export function cardLabel(card: CardData, _level = card.level) {
  return `${card.name} ($${card.ticker}), ${cardDesign(card).name} trading card, market cap ${card.mcapLabel ?? usdCompact(card.mcapUsd)}${card.ownerHandle ? `, creator @${card.ownerHandle}` : ""}`;
}

type FaceProps = {
  card: CardData;
  /** Design shown (default card.level). */
  level?: number;
  compact?: boolean;
  priority?: boolean;
  sizes?: string;
  /** Staged slots load eagerly at low fetch priority. */
  eager?: boolean;
  /** Frame mini plus 96 px art, no lights (ghosts, far coverflow cards). */
  lite?: boolean;
};

/**
 * One face: name and the design's numeral on top, the coin's image, then the italic description (two lines) and
 * token details in the text box, under the design's frame. Its finish (tiers.ts) sets how the border takes the
 * light, in .mdx-card__lights. Under 210px wide the face switches to its compact text layout by itself (a
 * container query); `compact` forces it.
 *   flat  the 2D card (MintCard depth="flat"): role="img" with the card's label, a still light, its own shadow.
 *   3d    inside a Card3D slot (or a coverflow side card): every light layer, no role (the scene carries it).
 *   lite  the miniature frame and the smallest art copy, no lights.
 */
type RenderFaceProps = FaceProps & { mode: "flat" | "3d" | "lite"; className?: string; style?: CSSProperties };
function Face(input: RenderFaceProps) {
  const props = { ...input, card: designedCard(input.card), level: cardDesign(input.card).materialLevel };
  const design = cardDesign(props.card);
  if (design.layout) return <TradingCardFace card={props.card} design={design} priority={props.priority || props.eager} sizes={props.sizes} compact={props.compact || props.mode === "lite"} className={props.className} style={props.style} label={props.mode === "flat" ? cardLabel(props.card) : undefined} />;
  const icon = getMemeIcon(props.card.memeIcon);
  if (icon) return <MemeIconCard icon={icon} card={props.card} compact={props.compact || props.mode === "lite"} priority={props.priority || props.eager} sizes={props.sizes} className={props.className} />;
  const edition = getEdition(props.card.edition);
  if (edition) return <EditionCard edition={edition} card={props.card} compact={props.compact || props.mode === "lite"} priority={props.priority || props.eager} sizes={props.sizes} className={props.className} />;
  return <StandardFace {...props} />;
}

function StandardFace({
  card,
  level,
  compact = false,
  priority = false,
  sizes,
  eager = false,
  mode,
  className = "",
  style,
}: FaceProps & { mode: "flat" | "3d" | "lite"; className?: string; style?: CSSProperties }) {
  const depth = useContext(FaceDepth);
  const frameRef = useRef<HTMLImageElement>(null);
  const design = cardDesign(card);
  const tier = tierForLevel(design.materialLevel);
  const layout = frameLayout(tier.key);
  const lite = mode === "lite";
  const frameSizes = sizes ?? defaultFrameSizes(priority, compact);

  // The finish's light map is the frame copy the browser actually loaded for this card (its srcset pick for this
  // width and screen density), read back once the frame is in: one download per design, never a second copy
  // just for the mask. Until then the finish layers stay hidden (data-lit), so they never light an unmasked card.
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    const img = frameRef.current;
    if (!img || lite) return;
    const sync = () => {
      if (img.complete && img.naturalWidth > 0 && img.currentSrc) setLit(img.currentSrc);
    };
    sync();
    img.addEventListener("load", sync);
    return () => img.removeEventListener("load", sync);
  }, [lite]);

  // Card guard: exactly a Pokemon card, 63 x 88 mm with 1/8 in corners. The radius is a
  // fraction of the width; as an elliptical border-radius that is r% / (r * 63/88)%.
  const r = (layout.radius ?? 0.0504) * 100;
  const sheen = cardLight(card).sheen;
  const holes = foilHoles(tier.key, layout);
  // The light's map: the frame itself (its luminance is the foil), the very copy the frame img loaded, or the
  // design's own light map (Legend's gold), which needs no wait.
  const map = frameLightMapSrc(tier.key);
  const maskSrc = lite ? null : (map ?? lit);
  const vars = {
    ...generatedCardStyle(card.cardTemplate),
    "--accent": tier.accent,
    // The finish's light (tiers.ts sheen), repeated to five stops.
    "--s1": sheen[0],
    "--s2": sheen[1 % sheen.length],
    "--s3": sheen[2 % sheen.length],
    "--s4": sheen[3 % sheen.length],
    "--s5": sheen[4 % sheen.length],
    // Every finish layer wears this mask: the frame (or the light map), minus the panel holes.
    ...(maskSrc ? { "--foil-mask": `url("${maskSrc}"), ${holes}` } : null),
    // The text panels alone: the full-art holo (card3d.css .mdx-card__poke) covers the card minus these.
    ...(lite ? null : { "--foil-holes": holes }),
    // 3D faces carry the design's 1KB miniature as their own background until the frame arrives.
    ...(mode === "3d" ? { backgroundImage: `url("${frameMiniSrc(tier.key)}")` } : null),
    ...style,
    "--card-radius": `${r.toFixed(2)}% / ${((r * 63) / 88).toFixed(2)}%`,
    aspectRatio: "63 / 88",
  } as CSSProperties;
  const art = card.image ? artSources(card.image, compact, priority, sizes, lite) : null;
  const loading = priority || eager ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : eager ? "low" : undefined;

  return (
    <div
      className={`mdx-card ${compact ? "mdx-card--compact" : ""} ${lite ? "mdx-card--lite" : ""} ${className}`}
      data-tier={tier.key}
      data-finish={design.finish}
      data-card-template={design.key}
      data-carddex-premium=""
      data-lit={maskSrc ? "" : undefined}
      style={vars}
      role={mode === "flat" ? "img" : undefined}
      aria-label={mode === "flat" ? cardLabel(card, tier.level) : undefined}
    >
      {mode === "flat" ? <div className="mdx-card__shadow" /> : null}
      {/* The design's 1KB miniature, stretched under the art and the frame: until the frame arrives (a slow
          phone connection) the card already shows its colors and panels, never a frameless ghost. */}
      {mode === "flat" ? <div className="mdx-card__ghost" style={{ backgroundImage: `url("${frameMiniSrc(tier.key)}")` }} /> : null}
      <div className="mdx-card__art" style={boxStyle(layout.window, 0.004)}>
        {art ? (
          <img {...art} alt="" draggable={false} loading={loading} fetchPriority={fetchPriority} decoding="async" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_50%_40%,#ece2c8,#d8cba9)] text-center">
            <span className="px-[8cqw] font-display text-[5.5cqw] leading-tight text-[#6b6455]">Your art here</span>
          </div>
        )}
      </div>
      {/* The frame at the copy that fits (360, 600 or 900px; sizes="auto" reads the laid-out width of a lazy
          image, the fallback covers browsers without it). The finish's mask reuses whatever copy this loads. */}
      {lite ? (
        <img className="mdx-card__frame" src={frameMiniSrc(tier.key)} alt="" draggable={false} decoding="async" />
      ) : (
        <img
          ref={frameRef}
          className="mdx-card__frame"
          src={frameSrc(tier.key)}
          srcSet={frameSrcSet(tier.key)}
          sizes={frameSizes}
          alt=""
          draggable={false}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
        />
      )}

      <GeneratedCardFront cardTemplate={design.key} priority={priority || eager} />
      <TierCraft tier={tier} layout={layout} lite={lite} />

      <CardPrint card={card} layout={layout} tier={tier} />
      {/* The light (spec 4.6, owner override 2026-10-11): every layer in one container on top; the engine writes
          --px, --py, --lit here (and px, py on the art window) only. Each design's finish (card3d.css, keyed on
          data-tier) is a holo group (its rainbow, times its foil texture, times a light spot, so the rainbow lives
          around the light), the metal specular along the keylines, glitter that flares near the light, and the
          die-cut foil rim. Every layer but the rim and the glare wears the frame minus the text panels, so the
          parchment and its text never shimmer. Flat faces show the same finish at the still light. */}
      {lite ? null : (
        <div className="mdx-card__lights">
          <GeneratedCardFinish cardTemplate={design.key} />
          <div className="mdx-card__holo2">
            <i className="mdx-card__rainbow" />
            <i className="mdx-card__tex" />
            <i className="mdx-card__spot" />
          </div>
          <div className="mdx-card__shine" />
          {SPARKLE.has(tier.key) ? <div className="mdx-card__sparkle" /> : null}
          {/* Holo art (the full-art designs, 3D only): a faint rainbow or glitter over the picture, in the light. */}
          {mode === "3d" && ART_HOLO.has(tier.key) ? <div className="mdx-card__holo" style={boxStyle(layout.window, 0.004)} /> : null}
          {/* The Pokemon-style holo (3D only): one element, its ::before the design's holo pattern (color-dodge
              rainbow, glitter, texture, sliding with the light) and its ::after the glare that follows the
              pointer. Both read --px, --py, --lit from this container: no extra JS, no extra layer. */}
          {mode === "3d" ? <i className="mdx-card__poke" /> : null}
          {mode === "3d" ? <div className="mdx-card__gloss" /> : null}
          <div className="mdx-card__rim" />
          {mode === "3d" && depth === "table" ? <div className="mdx-card__glint" /> : null}
        </div>
      )}
    </div>
  );
}

/**
 * The face only (today's markup plus the lights container). No role, no aria (the scene carries them).
 */
export function MintCardFace(p: FaceProps) {
  return <Face {...p} mode={p.lite ? "lite" : "3d"} />;
}

/** Default key `${dexNo}:${level}`; the Home turntable passes `key: coin.id`, Levels passes `key: "L" + level`. */
export function faceSlot(
  card: CardData,
  opts: { key?: string; level?: number; sizes?: string; priority?: boolean; eager?: boolean } = {},
): FaceSlot {
  const level = cardDesign(card).materialLevel;
  return {
    key: opts.key ?? `${card.dexNo}:${cardDesign(card).key}`,
    node: <MintCardFace card={card} sizes={opts.sizes} priority={opts.priority} eager={opts.eager} />,
    tier: cardLight(card),
    backTheme: cardBackTheme(card),
  };
}

export type MintCardProps = {
  card: CardData;
  compact?: boolean;
  /** Default "table"; tilt={false} means "flat" (back-compat). */
  depth?: CardDepth;
  /** @deprecated use depth="flat" */
  tilt?: boolean;
  flippable?: boolean;
  side?: CardSide;
  onSideChange?: (s: CardSide) => void;
  idle?: CardIdle;
  enter?: CardEnter;
  ground?: CardGround;
  /** "mint" = the post-launch reveal (M14). */
  reveal?: "none" | "mint";
  /** Kept: same as reveal="mint". */
  evolveOnMount?: boolean;
  gyroChip?: boolean;
  focusable?: boolean;
  priority?: boolean;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<Card3DHandle>;
};

/** The frame img's sizes for a level-rise preload: a lazy card's laid-out width (a detached Image reads no "auto"). */
function preloadSizes(sizes: string, el: Element | null) {
  return sizes.startsWith("auto") ? `${Math.round(el?.getBoundingClientRect().width ?? 300)}px` : sizes;
}

type FixedSlot = { key: string; design: string; image: string };
type FixedSlots = { id: number; rev: number; slots: FixedSlot[]; front: string; swap: CardSwap };

/** A fixed creator print; only an explicit design selection or artwork edit stages a new face. */
export function useCardSlots(
  card: CardData,
  o: { ascend: "ascend" | "ascend-short"; art: CardSwap; compact?: boolean; priority?: boolean; sizes?: string; hand: boolean },
) {
  const design = cardDesign(card);
  const base = (): FixedSlots => ({ id: card.dexNo, rev: 0, slots: [{ key: `D${design.key}:0`, design: design.key, image: card.image }], front: `D${design.key}:0`, swap: "instant" });
  const [state, setState] = useState(base);
  let view = state;
  const active = state.slots.find((slot) => slot.key === state.front) ?? state.slots[0];
  if (state.id !== card.dexNo) {
    view = base();
    setState(view);
  } else if (active.design !== design.key || active.image !== card.image) {
    const rev = state.rev + 1;
    const next = { key: `D${design.key}:${rev}`, design: design.key, image: card.image };
    view = { ...state, rev, front: next.key, slots: [...state.slots, next], swap: active.design !== design.key ? "fade" : o.art };
    setState(view);
  }
  const ctl = useRef<SceneCtl | null>(null);
  const handle = useRef<(Card3DHandle & { settle?: () => void }) | null>(null);
  const [shown, setShown] = useState(view.front);
  const shownSlot = view.slots.find((slot) => slot.key === shown) ?? view.slots.find((slot) => slot.key === view.front)!;
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) { typed.current = true; return; }
    if (!o.hand) return;
    const timer = window.setTimeout(() => handle.current?.settle?.(), 300);
    return () => clearTimeout(timer);
  }, [card.name, card.ticker, card.lore, o.hand]);
  const faces: FaceSlot[] = view.slots.map((slot) => {
    const print = designedCard({ ...card, cardTemplate: slot.design, image: slot.image });
    return { key: slot.key, tier: cardLight(print), backTheme: cardBackTheme(print), node: <Face mode="3d" card={print} compact={o.compact} priority={!!o.priority && slot.key === view.front} sizes={o.sizes} eager={slot.key !== view.front} /> };
  });
  return {
    faces, front: view.front, swap: view.swap, level: getCardDesign(shownSlot.design).materialLevel,
    onBurst: (_key: string) => {}, onSwapped: (key: string) => setShown(key),
    onSettled: (key: string) => { setShown(key); setState((value) => value.slots.length > 1 && value.front === key ? { ...value, slots: value.slots.filter((slot) => slot.key === key) } : value); },
    ctl, handle,
  };
}

/**
 * A MintDex card, sized like a classic trading card. depth "flat" is the 2D face (still light, no motion);
 * "table" (the default) and "hand" are physical cards (Card3D): thickness, a printed back, a light that follows
 * the pose, idle life and the reveals. `evolveOnMount` (or reveal="mint") plays the post-launch reveal once.
 * `sizes` is the card's rendered width as an img sizes value, when the caller knows it better than the defaults.
 */
export function MintCard(props: MintCardProps) {
  const depth: CardDepth = props.depth ?? (props.tilt === false ? "flat" : "table");
  if (depth === "flat") {
    return (
      <Face
        mode="flat"
        card={props.card}
        compact={props.compact}
        priority={props.priority}
        sizes={props.sizes}
        className={props.className}
        style={props.style}
      />
    );
  }
  return <MintCard3D {...props} depth={depth} />;
}

function MintCard3D(p: MintCardProps & { depth: "table" | "hand" }) {
  const hand = p.depth === "hand";
  const slots = useCardSlots(p.card, {
    ascend: hand ? "ascend" : "ascend-short",
    art: hand ? "print" : "fade",
    compact: p.compact,
    priority: p.priority,
    sizes: p.sizes,
    hand,
  });
  const reveal = p.reveal ?? (p.evolveOnMount ? "mint" : "none");
  const setRef = (h: Card3DHandle | null) => {
    slots.handle.current = h;
    const r = p.ref;
    if (typeof r === "function") r(h);
    else if (r) (r as { current: Card3DHandle | null }).current = h;
  };
  return (
    <Card3DView
      depth={p.depth}
      label={cardLabel(p.card, slots.level)}
      faces={slots.faces}
      front={slots.front}
      swap={slots.swap}
      flippable={p.flippable}
      side={p.side}
      onSideChange={p.onSideChange}
      idle={p.idle}
      enter={p.enter}
      ground={p.ground}
      gyroChip={p.gyroChip}
      focusable={p.focusable}
      reveal={reveal}
      seed={p.card.dexNo}
      onBurst={slots.onBurst}
      onSwapped={slots.onSwapped}
      onSettled={slots.onSettled}
      className={p.className}
      style={p.style}
      ref={setRef}
      ctlRef={slots.ctl}
    />
  );
}
