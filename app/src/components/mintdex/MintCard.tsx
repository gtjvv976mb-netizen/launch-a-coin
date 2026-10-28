import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { getCardDesign, type CardDesign } from "../../lib/carddex/designs";
import { CanonicalCardFace } from "../carddex/CanonicalCardFace";
import { canonicalSkinAsset } from "../carddex/CanonicalCardSkin";
import { generatedCardAssets } from "../../lib/carddex/generated-assets";
import { marketCapText } from "../../lib/carddex/quote-display";
import "../../carddex-cards.css";

import { cardArtSources } from "../../lib/mintdex/art";
import {
  MAX_LEVEL,
  frameSrc,
  frameSrcSet,
  tierForLevel,
  type TierKey,
} from "../../lib/mintdex/tiers";
import { Card3DView } from "./card3d/Card3D";
import { type EditionKey } from "../../lib/mintdex/editions";
import { type MemeIconKey } from "../../lib/mintdex/meme-icons";
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
  quoteAssetKey?: string;
  quoteMint?: string;
  tradingPair?: string;
  mcapQuote?: number;
  /** Cosmetic preview identity, independent from the token's earned market-cap tier. Not an entitlement. */
  edition?: EditionKey;
  /** Cosmetic template preview applied to this token's identity; never a purchased entitlement. */
  memeIcon?: MemeIconKey;
  name: string;
  ticker: string;
  image: string;
  level: number;
  mcapUsd: number | null;
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
  const generated = generatedCardAssets(design.key);
  const skin = canonicalSkinAsset(design.key,card.quoteAssetKey);
  const jobs: Promise<unknown>[] = [{source:skin?.path,small:skin?.previewPath},{source:generated.back,small:generated.back320}].filter(asset=>asset.source).map(({source,small}) => {
    const image = new Image();
    if (small) { image.srcset = `${small} 320w, ${source} 1260w`; image.sizes = sizes; }
    image.src = source!; image.decoding = "async";
    return image.decode().catch(() => undefined);
  });
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

/** The light a design throws (bursts, the light pool), from tiers.ts. */
export function tierLight(level: number): TierLight {
  const t = tierForLevel(level);
  return { finish: t.finish, sheen: t.sheen, ring: t.ring, key: t.key };
}

/** The scene's label (the old card's aria-label, unchanged). */
export function cardLabel(card: CardData, _level = card.level) {
  return `${card.name} ($${card.ticker}), ${cardDesign(card).name} trading card, market cap ${card.mcapLabel ?? marketCapText(card)}${card.ownerHandle ? `, creator @${card.ownerHandle}` : ""}`;
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
  const card = designedCard(input.card);
  const design = cardDesign(card);
  return <CanonicalCardFace card={card} design={design} priority={input.priority || input.eager} sizes={input.sizes} compact={input.compact} lite={input.mode === "lite"} className={input.className} style={input.style} label={input.mode === "flat" ? cardLabel(card) : undefined} />;
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
