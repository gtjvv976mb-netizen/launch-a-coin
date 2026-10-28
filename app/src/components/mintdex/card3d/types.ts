/**
 * The 3D card contract (refs/alive-3d-spec.md section 4.2). Frozen: additive optional props only without the
 * other builder's agreement.
 */
import type { CSSProperties, ReactNode, Ref } from "react";
import type { Finish } from "../../../lib/mintdex/tiers";
import type { EditionKey } from "../../../lib/mintdex/editions";
import type { MemeIconKey } from "../../../lib/mintdex/meme-icons";

export type CardDepth = "flat" | "table" | "hand";
export type CardSide = "face" | "back";
export type MotionLevel = "full" | "lite" | "calm";
/** How a change of `front` plays (Card3D picks "fade" for every swap under calm). */
export type CardSwap = "turn" | "spin" | "quick" | "ascend" | "ascend-short" | "print" | "fade" | "instant";
export type CardEnter = "none" | "deal" | "rise" | "liftin" | "unbox";
/** "turntable" (table cards): the card spins in place while it is in view (spin.ts), resting facing front otherwise. */
export type CardIdle = "breathe" | "breathe-peek" | "spin" | "float" | "turntable" | "none";
export type CardGround = "shadow" | "floor" | "none";
/** `key` (additive, CARD): the design key, so the scene wears the design's 3D template (templates.ts). */
export type TierLight = { finish: Finish; sheen: string[]; ring: string; key?: string };

/** One face the card can show. `node` is a MintCardFace; `tier` colors the bursts and the light pool. */
export type CardBackTheme = { cardTemplate?: string; edition?: EditionKey; memeIcon?: MemeIconKey };
export type FaceSlot = { key: string; node: ReactNode; tier: TierLight; backTheme?: CardBackTheme };

export type Card3DHandle = {
  side(): CardSide;
  /** Half turn toward dir; ignored while a moment runs. */
  turnOver(dir?: 1 | -1): void;
  /** M15; resolves when settled (at most 1000 ms). */
  claim(): Promise<void>;
  /** M17; rate limited to 1 per 2 s. */
  jolt(): void;
  /** One L2 peek on demand. */
  peek(): void;
};

export type Card3DProps = {
  /** The face-side slots; others stay mounted hidden (staged). */
  faces: FaceSlot[];
  /** Cosmetic reverse design; staged faces may carry their own matching theme. */
  backTheme?: CardBackTheme;
  /** Key of the face to show; changing it plays `swap`. */
  front: string;
  /** Default: hand "turn", table "fade". */
  swap?: CardSwap;
  /** Default 1. */
  swapDir?: 1 | -1;
  /** Default "table". */
  depth?: "table" | "hand";
  /** aria-label of the scene (role="img"). */
  label: string;
  /** Default: hand true, table false. */
  flippable?: boolean;
  /** Controlled back/face (optional). */
  side?: CardSide;
  onSideChange?: (side: CardSide) => void;
  /** Default: hand && the card is not inside an <a> or <button>. */
  tapTurns?: boolean;
  /** Default "turn": sideways dragging rotates the inline card while vertical gestures scroll. */
  drag?: "turn" | "step" | "none";
  /** drag "step": released past 90 deg or flung; the caller changes `front`. */
  onStep?: (dir: 1 | -1) => void;
  /** Default: hand "breathe-peek", table "float". */
  idle?: CardIdle;
  /** Default: from CardMotionProvider, else "none". */
  enter?: CardEnter;
  /** Default "shadow". */
  ground?: CardGround;
  /** Default true (coarse pointers only): device tilt follows the card in place. */
  gyro?: boolean;
  /** Show the phone tilt permission control when needed; default false. */
  gyroChip?: boolean;
  /** tabIndex 0 + keys (F, Enter, Space; arrows only if arrowsTurn). */
  focusable?: boolean;
  /** Default false (arrows keep their page meaning). */
  arrowsTurn?: boolean;
  onInteract?: (kind: "hover" | "drag" | "tap" | "key") => void;
  /** Fired at the swap moment (back facing the viewer). */
  onSwapped?: (key: string) => void;
  /** Fired when the swap motion has settled. */
  onSettled?: (key: string) => void;
  /**
   * Additive (CARD): "mint" plays the post-launch reveal once on mount (M14): the card starts face down, turns
   * one and a half times and lands face up in a burst. MintCard passes it for reveal="mint" / evolveOnMount.
   */
  reveal?: "none" | "mint";
  className?: string;
  style?: CSSProperties;
  ref?: Ref<Card3DHandle>;
};
