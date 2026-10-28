/**
 * The motion engine (spec section 3): motion levels, springs, bodies, one shared rAF loop, gating (offscreen,
 * hidden tab, open dialogs), the watchdog, and the reveal bus pages wait on (whenRevealed).
 *
 * A body is one physical object (a card in hand, a card picked up off the table, the case). Its pose is a few
 * springs: rx, ry (tilt), flip (turnover angle), lift (z), sc (scale), hold (how much the idle gives way to the
 * hand) and live (how much the light follows the pose rather than the still light). Inputs, idle and moments only
 * move spring targets; each frame the engine writes one transform on the pose, three variables on each light
 * container and a transform and opacity on the ground, after reading nothing.
 */
import { useRef, useSyncExternalStore } from "react";

import { autoGyro, bindGyroKick, gyro, stopGyro } from "./gyro";
import { edgeView, spinEye } from "./extrude";
import {
  blendLight,
  breathe,
  clamp,
  groundFromPose,
  groundTransform,
  lightFromPose,
  litFloor,
  orbitLight,
  peekAmount,
  sideFromAngle,
  STILL_LIGHT,
  turnLightX,
  type Light,
  type RestPose,
} from "./light";
import type { CardSide, MotionLevel } from "./types";

/* ------------------------------------------------------------------ motion level */

const LITE_KEY = "mdx-motion-lite";
// Start returning visitors in full motion too; preserve new explicit Calm choices after this release.
const CALM_KEY = "mdx-motion-v2";

let hydrated = false;
/** SITE calls it once in the root's first effect: later mounts are client navigation (Deal and Unbox may play). */
export function markHydrated() {
  hydrated = true;
}
export function isHydrated() {
  return hydrated;
}

const noSubscribe = () => () => {};
/**
 * True only when this component's first render is a fresh client render after hydration (a client navigation, a
 * dialog opening): Deal, Unbox and Lift-in may play. False while it hydrates server HTML, even when its code-split
 * route hydrates after the root's effects (React hydrates with the server snapshot, so the first value tells), and
 * false before markHydrated (a client render that replaces failed hydration). Kept for the component's life.
 */
export function useFreshMount(): boolean {
  const live = useSyncExternalStore(noSubscribe, () => true, () => false);
  const first = useRef<boolean | null>(null);
  if (first.current === null) first.current = live && hydrated;
  return first.current;
}

/**
 * "full" on the server. Calm wins (only the Calm motion switch: the device's prefers-reduced-motion setting no
 * longer turns motion off by itself, owner 2026-10-17), then lite (the frame-rate watchdog, this page only).
 */
export function motionLevel(): MotionLevel {
  if (typeof document === "undefined") return "full";
  const a = document.documentElement.dataset.motion;
  if (a === "calm") return "calm";
  if (a === "lite") return "lite";
  return "full";
}

const levelListeners = new Set<() => void>();
let levelWired = false;
let lastLevel: MotionLevel = "full";
function emitLevel() {
  const l = motionLevel();
  if (l === lastLevel) return;
  lastLevel = l;
  if (l === "calm") stopGyro();
  else autoGyro();
  for (const fn of levelListeners) fn();
  Engine.kick();
}
function wireLevel() {
  if (levelWired || typeof window === "undefined") return;
  levelWired = true;
  lastLevel = motionLevel();
  new MutationObserver(emitLevel).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
}
function subscribeLevel(fn: () => void) {
  wireLevel();
  levelListeners.add(fn);
  return () => {
    levelListeners.delete(fn);
  };
}
/** Subscribe to level changes (engine-internal and for controllers). */
export const onMotionLevel = subscribeLevel;

/** "full" on the server and on the first client render (hydration), then the live level. */
export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribeLevel, motionLevel, () => "full");
}

/**
 * Why this page runs lite: only the frame-rate watchdog, for this page only (owner override 2026-10-11: a slow
 * moment on one page no longer costs every later page its motion). There is no device boot heuristic any more
 * (owner 2026-10-17: full motion is the default for everyone).
 */
let liteSource: "watchdog" | null = null;

/** The Calm motion switch: localStorage["mdx-motion-v2"] and html[data-motion], live. */
export function setCalm(on: boolean) {
  if (typeof document === "undefined") return;
  try {
    if (on) localStorage.setItem(CALM_KEY, "calm");
    else localStorage.removeItem(CALM_KEY);
  } catch {
    /* storage blocked: the attribute still applies for this page */
  }
  const d = document.documentElement;
  if (on) d.dataset.motion = "calm";
  else if (liteSource) d.dataset.motion = "lite";
  else delete d.dataset.motion;
  emitLevel();
  window.dispatchEvent(new Event("mdx:motion"));
}

/** Drop to lite until the next page (the watchdog). */
export function setLite() {
  if (typeof document === "undefined") return;
  liteSource = "watchdog";
  const d = document.documentElement;
  if (d.dataset.motion !== "calm") d.dataset.motion = "lite";
  emitLevel();
  window.dispatchEvent(new Event("mdx:motion"));
}

/** A new page gets full motion again when only the watchdog had dropped the last one to lite. */
function clearWatchdogLite() {
  if (liteSource !== "watchdog" || typeof document === "undefined") return;
  liteSource = null;
  const d = document.documentElement;
  if (d.dataset.motion === "lite") delete d.dataset.motion;
  emitLevel();
  window.dispatchEvent(new Event("mdx:motion"));
}

/*
 * No boot heuristic (owner 2026-10-17: full motion is the default for everyone): the data saver, core count and memory no
 * longer start a page in lite. Every page starts full; the watchdog still drops a page that cannot keep up to lite.
 */
if (typeof window !== "undefined") {
  // After the head script (it already set calm from the switch); never during render. A lite left by an older
  // build's sticky session key is dropped and the page starts full.
  queueMicrotask(() => {
    try {
      if (sessionStorage.getItem(LITE_KEY)) {
        sessionStorage.removeItem(LITE_KEY);
        const d = document.documentElement;
        if (d.dataset.motion === "lite") {
          delete d.dataset.motion;
          emitLevel();
        }
      }
    } catch {
      /* storage blocked: nothing was stored either */
    }
  });
}

/* ------------------------------------------------------------------ springs */

/** Semi-implicit Euler spring. Constants per use in spec 4.9 (SPRINGS below). */
export class Spring {
  x: number;
  v = 0;
  t: number;
  constructor(
    x: number,
    public k: number,
    public c: number,
  ) {
    this.x = x;
    this.t = x;
  }
  step(dt: number) {
    const a = this.k * (this.t - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  busy(eps = 0.02) {
    return Math.abs(this.v) > eps || Math.abs(this.t - this.x) > eps;
  }
  snap(x = this.t) {
    this.x = this.t = x;
    this.v = 0;
  }
  tune(kc: readonly [number, number]) {
    this.k = kc[0];
    this.c = kc[1];
  }
}

/** Spring constants, [k, c] (spec 4.9). */
export const SPRINGS = {
  tilt: [170, 19],
  flip: [52, 12.6],
  turntable: [34, 10.2],
  spin: [60, 13],
  ascend: [44, 11],
  short: [70, 13],
  lift: [190, 17],
  landing: [120, 11],
  scale: [210, 18],
  hold: [60, 15],
} as const;

/** dt is clamped to 34 ms, with 2 substeps above 17 ms, so 120 Hz screens behave the same. */
export function stepSprings(springs: Spring[], dtSec: number) {
  const dt = Math.min(0.034, dtSec);
  const n = dt > 0.017 ? 2 : 1;
  for (let i = 0; i < n; i++) for (const s of springs) s.step(dt / n);
}

/* ------------------------------------------------------------------ bodies */

export type BodyKind = "hand" | "table" | "case" | "inspect";
/** "spin" (hype arcade, the Home turntable): the card keeps turning gently on its stand between steps. */
export type IdleMode = "breathe" | "breathe-peek" | "spin" | "none";

type KindCfg = {
  maxRx: number;
  maxRy: number;
  lift: number;
  scale: number;
  arcLift: number;
  arcTilt: number;
  /** The pose breathe (inspect only now: the other idle bodies hold their rest pose and orbit the light). */
  amp: { rx: number; ry: number; y: number };
  /** Idle moves the light, not the pose (owner override 2026-10-11): the text stays still and sharp. */
  orbit: boolean;
};
export const KINDS: Record<BodyKind, KindCfg> = {
  hand: { maxRx: 14, maxRy: 18, lift: 22, scale: 1.025, arcLift: 0.16, arcTilt: 7, amp: { rx: 0, ry: 0, y: 0 }, orbit: true },
  table: { maxRx: 16, maxRy: 20, lift: 30, scale: 1.03, arcLift: 0.16, arcTilt: 7, amp: { rx: 0, ry: 0, y: 0 }, orbit: false },
  case: { maxRx: 12, maxRy: 22, lift: 18, scale: 1.02, arcLift: 0.1, arcTilt: 5, amp: { rx: 0, ry: 0, y: 0 }, orbit: true },
  inspect: { maxRx: 12, maxRy: 24, lift: 10, scale: 1.015, arcLift: 0.06, arcTilt: 4, amp: { rx: 3, ry: 0, y: 6 }, orbit: false },
};

/** Frames after a wall rebuild or a turn's last step are not ambient (the watchdog skips them). */
const HEAVY_MS = 400;

export type FrameVerdict = "good" | "capped" | "bad";

/**
 * The watchdog's read of one window of frame times (ms), owner override 2026-10-11:
 *   good    median up to 22 ms;
 *   capped  a steady 30 Hz cadence (an iPhone in Low Power Mode, a 30 Hz display): not slow, only capped. The page
 *           stays full and only the idle light orbit stops;
 *   bad     anything slower, and always past the hard floor (median over 40 ms).
 */
export function classifyFrames(dts: number[]): FrameVerdict {
  if (!dts.length) return "good";
  const s = [...dts].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  const med = at(0.5);
  if (med > 40) return "bad";
  if (med <= 22) return "good";
  if (med >= 30 && med <= 36.5 && at(0.25) >= 28 && at(0.75) <= 38) return "capped";
  return "bad";
}

/** A flip angle override over time (quick swaps, the Inspect turntable), replacing the flip spring while it runs. */
type Tween = { from: number; to: number; t0: number; dur: number; ease: (k: number) => number; done?: () => void };

export type AngleWatcher = (flip: number, Y: number) => boolean | void;

/** "moving": the pose itself is changing (will-change goes on only then, so a pose at rest re-rasters sharp). */
export type StateToken = "held" | "dragging" | "turning" | "ascending" | "dealing" | "awake" | "offscreen" | "moving";

/** data-state is a token list on the scene (spec 4.4), shared by the body, moments and the gating observer. */
export function setStateToken(el: HTMLElement, t: StateToken, on: boolean) {
  const cur = el.dataset.state ? el.dataset.state.split(" ").filter(Boolean) : [];
  if (on === cur.includes(t)) return;
  const next = on ? [...cur, t] : cur.filter((x) => x !== t);
  if (next.length) el.dataset.state = next.join(" ");
  else delete el.dataset.state;
}
export function hasStateToken(el: HTMLElement, t: StateToken) {
  return (el.dataset.state ?? "").split(" ").includes(t);
}

export class Body {
  readonly cfg: KindCfg;
  W = 0;
  lights: HTMLElement[] = [];
  /**
   * The rest pose CSS already draws above the pose (the scene's --rest-rx / --rest-ry as a static `rotate` on
   * __enter, owner override 2026-10-11): the springs pose from zero on top of it, and the light adds it.
   */
  cssRest: RestPose = { rx: 0, ry: 0 };
  /** The light a resting card shows (where a table card's light hands back to). */
  restLight: Light = STILL_LIGHT;
  /** Case gloss sheets: a sensitive mirror catch that stays live throughout a whole turn. */
  glossLights: HTMLElement[] = [];
  ground: HTMLElement | null = null;
  groundMode: "shadow" | "floor" | "none" = "shadow";
  rx = new Spring(0, ...SPRINGS.tilt);
  ry = new Spring(0, ...SPRINGS.tilt);
  flip = new Spring(0, ...SPRINGS.flip);
  lift = new Spring(0, ...SPRINGS.lift);
  sc = new Spring(1, ...SPRINGS.scale);
  hold = new Spring(0, ...SPRINGS.hold);
  live = new Spring(0, ...SPRINGS.hold);
  /** Extra light on top of the pose's (jolt, claim): decays to 0. */
  boost = new Spring(0, ...SPRINGS.hold);
  input = { rx: 0, ry: 0 };
  held = false;
  /** Keyboard focus hold: lift only, no tilt. */
  focusHold = false;
  dragging = false;
  idle: IdleMode = "none";
  useGyro = false;
  /** Physical tilt owns the pose until the phone comes back near neutral (separate thresholds avoid chatter). */
  private gyroHeld = false;
  /** Rest the light on the still light when the body is not held (table cards). */
  liveFollowsHold = false;
  visible = true;
  awake = false;
  moments = 0;
  watchers = new Set<AngleWatcher>();
  tween: Tween | null = null;
  /** Called after each step with the pose (deg, deg, px) for showcase extras (the Inspect turntable). */
  onFrame: ((Y: number, X: number, z: number) => void) | null = null;
  /** Called once each time the body comes to rest. */
  onRest: (() => void) | null = null;
  private t0 = typeof performance !== "undefined" ? performance.now() : 0;
  private peekAt = -1e9;
  /** When the spin idle (re)started: it eases in from rest. */
  spinFrom = 0;
  private lastLight = "";
  private lastGloss = "";
  private lastLightAt = 0;
  private lastPose = "";
  private lastGround = "";
  private edge = false;
  private lastEdge = "";
  private moving = false;
  private stillFrames = 0;
  private spun = false;
  /**
   * The inline turntable (owner 2026-10-17, table cards in a list): deg/s while spin.ts lets this card spin (0 when
   * not). Pointing at the card, dragging it, focus, a turn or a moment pause it; it lands on its front, then goes on.
   */
  spinRate = 0;
  /** Extra deg/s from scrolling (spin.ts), decaying. */
  spinBoost = 0;
  /** The spin is driving the flip now (it eases in from spinFrom). */
  spinOn = false;
  private spinV = 0;
  /**
   * A spinning list card (owner 2026-10-17, "one solid thin 3d card") turns as the solid slab in a 3D context of its
   * own (data-spin3d): the face plane half the stock in front, the printed holo back half the stock behind (backface
   * culling picks the side), and the same rounded cut edge it uses while held. The rest lean moves into the pose
   * transform with its own perspective(), so nothing above the pose is 3D.
   */
  private flat = false;
  /** spin.ts picked this card at least once: it turns (and lands back on its front) as a spin3d card. */
  spinCard = false;
  /** The rounded cut edge's walls; their shine reads --ex, --ey in both spinning and held modes. */
  edges: HTMLElement | null = null;
  dead = false;

  constructor(
    readonly el: HTMLElement,
    readonly pose: HTMLElement,
    readonly kind: BodyKind,
  ) {
    this.cfg = KINDS[kind];
    this.W = el.offsetWidth || 200;
    this.edges = pose.querySelector?.<HTMLElement>(":scope > .mdx-card3d__edges") ?? null;
  }

  side(): CardSide {
    return sideFromAngle(this.flip.t);
  }

  setToken(t: StateToken, on: boolean) {
    setStateToken(this.el, t, on);
  }
  has(t: StateToken) {
    return hasStateToken(this.el, t);
  }

  /** One manual L2 peek. */
  peek() {
    this.peekAt = performance.now();
  }

  /** Spec M17: lift 6px plus a flash of light, as a spring impulse. */
  jolt() {
    this.lift.v += 170;
    this.boost.v += 7.4;
  }

  /** Spec M18: a small ry impulse. */
  settle() {
    this.ry.v += 40;
  }

  /** A turn, a moment or a swap watcher owns the body (frames now are not ambient). */
  turning() {
    return !!this.tween || this.moments > 0 || this.watchers.size > 0 || this.flip.busy(2);
  }

  /** Does the idle want frames? The orbit (full, not capped), a peek (full), or the inspect breathe. */
  private idleWants(idleOk: boolean, level: MotionLevel, orbitOk: boolean) {
    if (!idleOk || this.idle === "none") return false;
    if (!this.cfg.orbit) return true;
    return orbitOk || ((this.idle === "breathe-peek" || this.idle === "spin") && level === "full");
  }

  /** Is anything still moving or wanted (idle, held, a gyro)? */
  busy(idleOk: boolean, level: MotionLevel = "full", orbitOk = true) {
    return (
      this.idleWants(idleOk, level, orbitOk) ||
      this.held ||
      this.focusHold ||
      this.dragging ||
      !!this.tween ||
      this.watchers.size > 0 ||
      this.moments > 0 ||
      (this.useGyro && gyro.on) ||
      (this.spinRate > 0 && level === "full") ||
      this.rx.busy() ||
      this.ry.busy() ||
      this.flip.busy(0.05) ||
      this.lift.busy() ||
      this.sc.busy(0.0008) ||
      this.hold.busy(0.004) ||
      this.live.busy(0.004) ||
      this.boost.busy(0.004)
    );
  }

  step(dtSec: number, now: number, level: MotionLevel, idleOk: boolean, orbitOk = level === "full"): boolean {
    const cfg = this.cfg;
    const t = (now - this.t0) / 1000;
    let idRx = 0;
    let idRy = 0;
    let idY = 0;
    let ox = 0;
    let oy = 0;
    let ol = 0;
    let peeking = false;
    if (idleOk && this.idle !== "none") {
      if (cfg.orbit) {
        // The pose holds its rest lean; the light circles over it (owner override 2026-10-11). Stepped at 30 Hz: a
        // 7 to 9 s orbit looks the same, and a card that only orbits repaints half as often.
        if (orbitOk) {
          const o = orbitLight(Math.floor(t * 30) / 30);
          ox = o.dx;
          oy = o.dy;
          ol = o.dl;
        }
      } else {
        const b = breathe(t, cfg.amp);
        idRx = b.rx;
        idRy = b.ry;
        idY = b.y;
      }
      if (this.idle === "breathe-peek" && level === "full") {
        const pk = peekAmount(t);
        idRy += 24 * pk;
        peeking = pk > 0;
      }
      if (this.idle === "spin" && level === "full") {
        // A slow turntable sway: 20 degrees each way over 6.4 s with a small nod, eased in from the rest pose over
        // the first second (so a card that just settled from a turn never jumps).
        const ramp = clamp((now - this.spinFrom) / 1000, 0, 1);
        const k = ramp * ramp * (3 - 2 * ramp);
        idRy += 20 * k * Math.sin((t * Math.PI * 2) / 6.4);
        idRx += 2.4 * k * Math.sin((t * Math.PI * 2) / 4.1);
        peeking = true;
      }
    }
    const sincePeek = now - this.peekAt;
    if (sincePeek < 2800) {
      idRy += 24 * Math.sin((sincePeek / 2800) * Math.PI) ** 2;
      peeking = true;
    }
    const gyroStrength = this.useGyro && gyro.on ? Math.hypot(gyro.rx, gyro.ry) : 0;
    if (gyroStrength > 0.5) this.gyroHeld = true;
    else if (gyroStrength < 0.2) this.gyroHeld = false;
    const idleAmt = this.gyroHeld ? 0 : clamp(1 - this.hold.x, 0, 1);
    const gx = this.useGyro && gyro.on ? gyro.rx : 0;
    const gy = this.useGyro && gyro.on ? gyro.ry : 0;
    if (!this.dragging) {
      this.rx.t = clamp(this.input.rx + idRx * idleAmt + gx, -cfg.maxRx - 6, cfg.maxRx + 6);
      this.ry.t = clamp(this.input.ry + idRy * idleAmt + gy, -cfg.maxRy - 8, cfg.maxRy + 8);
    } else this.rx.t = this.input.rx;
    // The inline turntable: a slow, steady turn (plus a scroll push) that hands over to the springs whenever
    // someone points at the card, drags it, focuses it, or a turn or moment owns it; it then lands on the front.
    const spinWant =
      this.spinRate > 0 &&
      level === "full" &&
      !this.gyroHeld &&
      !this.held &&
      !this.dragging &&
      !this.focusHold &&
      !this.tween &&
      this.moments === 0 &&
      this.watchers.size === 0;
    if (spinWant && !this.spinOn && !this.flip.busy(3)) {
      this.spinOn = true;
      this.spinFrom = Math.max(this.spinFrom, now);
    } else if (!spinWant && this.spinOn) {
      this.spinOn = false;
      if (!this.dragging) {
        this.flip.tune(SPRINGS.flip);
        this.flip.v = this.spinV;
        this.flip.t = Math.round(this.flip.x / 360) * 360;
      }
      this.spinBoost = 0;
    }
    const spinning = this.spinOn;
    if (spinning) {
      const ramp = clamp((now - this.spinFrom) / 1400, 0, 1);
      const v = this.spinRate * ramp * ramp * (3 - 2 * ramp) + this.spinBoost;
      this.spinBoost *= Math.exp(-dtSec * 2.4);
      if (this.spinBoost < 0.5) this.spinBoost = 0;
      this.spinV = v;
      let x = this.flip.x + v * dtSec;
      // Whole turns only, so the pose never changes when the number wraps.
      if (x > 36000) x -= 36000;
      this.flip.x = x;
      this.flip.t = x;
      this.flip.v = 0;
    }

    this.hold.t = this.held || this.dragging ? 1 : 0;
    this.live.t = this.liveFollowsHold ? (this.held || this.dragging || this.focusHold || this.moments > 0 || spinning || (this.useGyro && gyro.on) ? 1 : 0) : 1;

    const springs = [this.rx, this.ry, this.lift, this.sc, this.hold, this.live, this.boost];
    if (!this.dragging && !this.tween && !spinning) springs.push(this.flip);
    stepSprings(springs, dtSec);
    if (this.tween) {
      const tw = this.tween;
      const k = clamp((now - tw.t0) / tw.dur, 0, 1);
      const prev = this.flip.x;
      this.flip.x = tw.from + (tw.to - tw.from) * tw.ease(k);
      this.flip.v = (this.flip.x - prev) / Math.max(0.001, dtSec);
      if (k >= 1) {
        this.tween = null;
        this.flip.t = this.flip.x;
        this.flip.v = 0;
        tw.done?.();
      }
    }
    this.live.x = clamp(this.live.x, 0, 1.6);
    // Settled springs land exactly, so a pose at rest is exactly at rest (no transform below: a sharp face).
    if (!this.rx.busy(0.01)) this.rx.snap();
    if (!this.ry.busy(0.01)) this.ry.snap();
    if (!this.lift.busy(0.01)) this.lift.snap();
    if (!this.sc.busy(0.0002)) this.sc.snap();
    if (!this.dragging && !this.tween && !spinning && !this.flip.busy(0.01)) this.flip.snap();

    const f = this.flip.x;
    const e = Math.abs(Math.sin((f * Math.PI) / 180));
    // P: the pose the transform draws, on top of the rest CSS already draws above it; L: the whole pose (rest
    // included), which the light and the ground follow.
    // A list turntable turns in place: only a trace of the hand's arc (lift and lean edge-on), so it stays on its
    // pedestal and inside its tray.
    const arcK = spinning || (this.spinRate > 0 && this.kind === "table") ? 0.2 : 1;
    const P = lightFromPose(this.rx.x, this.ry.x, f, cfg.arcTilt * arcK);
    const L = lightFromPose(this.rx.x + this.cssRest.rx, this.ry.x + this.cssRest.ry, f, cfg.arcTilt * arcK);
    const z = this.lift.x + e * cfg.arcLift * arcK * this.W;
    const y = idY * idleAmt;
    // Written only when it changes, and no transform at all while the pose sits at rest: an identity 3D transform
    // still makes the pose its own layer under the rest pose's perspective, and Chrome draws that layer's face at a
    // low scale (QA 2026-10-11 at 3x: jagged text). With none, the face rasterizes sharp under the orbiting light.
    const turnY = ((((P.Y + 180) % 360) + 360) % 360) - 180;
    const still =
      Math.abs(y) < 0.005 && Math.abs(z) < 0.005 && Math.abs(P.X) < 0.005 && Math.abs(turnY) < 0.005 && Math.abs(this.sc.x - 1) < 0.00005;
    const flat =
      this.kind === "table" &&
      this.spinCard &&
      level === "full" &&
      !this.held &&
      !this.dragging &&
      !this.focusHold &&
      this.moments === 0 &&
      !this.tween &&
      // Only while it turns: landed on its front it goes back to one flat layer (sharp text at rest).
      (spinning || this.flip.busy(0.05) || Math.abs(turnY) > 0.005);
    if (flat !== this.flat) {
      this.flat = flat;
      this.el.toggleAttribute("data-spin3d", flat);
    }
    // Only hidden convex walls are culled. Keep this in lockstep with the pose, outside the foil cadence gate.
    if (this.edges) edgeView(this.edges, flat ? spinEye(L.X, L.Y, this.W, y, z, this.sc.x) : null);
    const tf = still
      ? ""
      : flat
        ? // spin3d: the rest lean comes off __enter (card3d.css), so the pose draws the whole pose (L) itself.
          `perspective(640px) translate3d(0, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${L.X.toFixed(2)}deg) ` +
          `rotateY(${L.Y.toFixed(2)}deg) scale(${this.sc.x.toFixed(4)})`
        : `translate3d(0, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${P.X.toFixed(2)}deg) ` +
          `rotateY(${P.Y.toFixed(2)}deg) scale(${this.sc.x.toFixed(4)})`;
    if (tf !== this.lastPose) {
      this.lastPose = tf;
      this.pose.style.transform = tf;
    }
    this.spun = true;

    const l = blendLight(L, this.live.x, this.restLight);
    const lpx = clamp(l.px + ox * idleAmt, 0, 1);
    const lpy = clamp(l.py + oy * idleAmt, 0, 1);
    const llit = clamp(litFloor(l.lit + ol * idleAmt) + this.boost.x, 0, 1);
    const key = `${lpx.toFixed(3)}|${lpy.toFixed(3)}|${llit.toFixed(3)}`;
    // During a turn the light steps at 30 Hz while the pose keeps 60 (each light step repaints the whole lit face;
    // QA 2026-10-11: a climb kept its frame rate). The settled light is always written.
    // The spin idle (Home) moves the pose all the time: its light steps at 30 Hz too.
    // A spinning list card steps its light at 20 Hz (up to eight of them repaint their faces).
    const stepLight = spinning
      ? now - this.lastLightAt >= 48
      : (!this.turning() && this.idle !== "spin") || now - this.lastLightAt >= 31;
    if (stepLight) {
      this.lastLightAt = now;
      const [px, py, lit] = key.split("|");
      if (key !== this.lastLight) {
        this.lastLight = key;
        for (const el of this.lights) {
          const s = el.style;
          s.setProperty("--px", px);
          s.setProperty("--py", py);
          s.setProperty("--lit", lit);
        }
      }
      // The edge follows its own pose key, including when rounded foil values happen to match.
      const host = flat || this.edge ? this.edges : null;
      if (host) {
        const ek = `${flat ? 1 : 0}|${L.X.toFixed(1)}|${L.Y.toFixed(1)}`;
        if (ek !== this.lastEdge) {
          this.lastEdge = ek;
          host.style.setProperty("--ex", `${L.X.toFixed(1)}deg`);
          host.style.setProperty("--ey", `${L.Y.toFixed(1)}deg`);
        }
      }
      if (this.glossLights.length) {
        const gpx = turnLightX(this.ry.x, f, 2).toFixed(3);
        const glossKey = `${gpx}|${py}`;
        if (glossKey !== this.lastGloss) {
          this.lastGloss = glossKey;
          for (const el of this.glossLights) {
            el.style.setProperty("--px", gpx);
            el.style.setProperty("--py", py);
          }
        }
      }
    }
    if (this.ground && this.groundMode !== "none" && (this.kind !== "table" || this.hold.x > 0.002 || this.moments)) {
      const g = groundFromPose(L.Y, L.X, z, this.W, this.groundMode);
      const gt = groundTransform(g);
      const go = g.o.toFixed(3);
      if (gt + go !== this.lastGround) {
        this.lastGround = gt + go;
        this.ground.style.transform = gt;
        this.ground.style.opacity = go;
      }
    }

    // The 3D context (data-edge) only while the pose moves off its rest (a hold, a drag, a peek, a turn, a lift):
    // a card at rest is one flat layer under its CSS rest pose and rasterizes its face sharp; in 3D Chrome draws the
    // face at a low scale (QA, 2026-10-11 at 3x: the text box went jagged with the context on at rest). A peek
    // counts from its first frame, so the card goes 3D near rest and never pops mid-lean. Hysteresis, and never off
    // mid-turn (each toggle is a layout and new layers). In 3D the card is the solid slab: face, back and the
    // continuous cut edge.
    const lean = flat ? 0 : Math.max(Math.abs(Math.sin((P.Y * Math.PI) / 180)), Math.abs(Math.sin((P.X * Math.PI) / 180)) * 0.7);
    const turning = (spinning && !flat) || this.dragging || this.moments > 0 || this.watchers.size > 0 || !!this.tween || this.flip.busy(2);
    const edge =
      !flat &&
      (turning ||
      this.held ||
      peeking ||
      Math.abs(this.lift.x) > 1 ||
      lean > (this.edge ? 0.08 : 0.14));
    if (edge !== this.edge) {
      this.edge = edge;
      this.el.toggleAttribute("data-edge", edge);
    }

    // will-change only while the pose itself moves (card3d.css): at rest Chrome re-rasters the face at the pose,
    // so the text is sharp while the light orbits. On at once, off after half a second of stillness.
    const moving =
      spinning ||
      this.dragging ||
      !!this.tween ||
      peeking ||
      this.moments > 0 ||
      this.rx.busy(0.05) ||
      this.ry.busy(0.05) ||
      this.flip.busy(0.05) ||
      this.lift.busy(0.3) ||
      this.sc.busy(0.0008) ||
      Math.abs(y) > 0.05;
    this.stillFrames = moving ? 0 : this.stillFrames + 1;
    const mv = moving || (this.moving && this.stillFrames < 30);
    if (mv !== this.moving) {
      this.moving = mv;
      this.setToken("moving", mv);
    }

    if (this.watchers.size) for (const w of [...this.watchers]) if (w(f, P.Y)) this.watchers.delete(w);
    this.onFrame?.(P.Y, P.X, z);
    const busy = this.busy(idleOk, level, orbitOk) || this.moving;
    if (!busy) this.onRest?.();
    return busy;
  }

  /** Clear everything the engine wrote, so a resting table card promotes nothing and shows the CSS rest light. */
  rest() {
    if (this.edges) edgeView(this.edges, null);
    if (this.flat) {
      this.flat = false;
      this.el.removeAttribute("data-spin3d");
    }
    if (this.edge) {
      this.edge = false;
      this.el.removeAttribute("data-edge");
    }
    if (this.moving) {
      this.moving = false;
      this.setToken("moving", false);
    }
    if (!this.spun) return;
    this.spun = false;
    this.pose.style.transform = "";
    this.lastLight = "";
    this.lastGloss = "";
    this.lastPose = "";
    this.lastGround = "";
    this.lastEdge = "";
    for (const el of [...this.lights, ...this.glossLights]) {
      el.style.removeProperty("--px");
      el.style.removeProperty("--py");
      el.style.removeProperty("--lit");
    }
    if (this.ground) {
      this.ground.style.transform = "";
      this.ground.style.opacity = "";
    }
    // The table light (scroll shimmer, gyro) puts its own light back on the face at once (tablelight.ts).
    if (this.kind === "table") this.el.dispatchEvent(new Event("mdx:rest"));
  }

  /** New light targets (a face swap): the next step writes them even if the light has not moved. */
  relight() {
    this.lastLight = "";
    this.lastGloss = "";
    Engine.kick();
  }

  /** The rest pose and its light (scene.ts reads them from the scene's CSS once, when the body is made). */
  setRest(rest: RestPose, light: Light | null) {
    this.cssRest = rest;
    if (light) this.restLight = light;
  }

  wake() {
    if (this.awake) return;
    this.awake = true;
    this.setToken("awake", true);
  }
  sleep() {
    if (!this.awake) return;
    this.awake = false;
    this.setToken("awake", false);
    if (this.moving) {
      this.moving = false;
      this.stillFrames = 0;
      this.setToken("moving", false);
    }
    if (this.kind === "table" && !this.held && Math.abs(this.flip.x % 360) < 0.5) this.rest();
  }
}

/* ------------------------------------------------------------------ the loop */

function openDialog(): Element | null {
  if (typeof document === "undefined") return null;
  const all = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
  return all.length ? all[all.length - 1] : null;
}

class EngineImpl {
  bodies = new Set<Body>();
  private raf = 0;
  private last = 0;
  private dialog: Element | null = null;
  private dialogAt = 0;
  private dialogTimer = 0;
  private dts: number[] = [];
  /** Running one-shot moments (the watchdog skips them; frames during a moment are not ambient). */
  moments = 0;
  /** A steady 30 Hz cadence was seen on this page: full motion stays, only the idle light orbit stops. */
  capped = false;
  private bad = 0;
  /** The watchdog counts nothing before the page has loaded plus 2 s (images decoding, the first turn). */
  private armedAt = Infinity;
  private heavyUntil = 0;
  private path = "";
  private io: IntersectionObserver | null = null;
  private wired = false;

  private arm() {
    this.armedAt = performance.now() + 2000;
  }

  /** A wall rebuild or a heavy one-off: the next frames are not ambient. */
  heavy(ms = HEAVY_MS) {
    if (typeof performance !== "undefined") this.heavyUntil = Math.max(this.heavyUntil, performance.now() + ms);
  }

  /** A new page: the watchdog starts over (and a page the watchdog dropped to lite does not pass it on). */
  private checkRoute() {
    if (typeof location === "undefined") return;
    const p = location.pathname;
    if (p === this.path) return;
    const first = !this.path;
    this.path = p;
    if (first) return;
    this.dts.length = 0;
    this.bad = 0;
    this.capped = false;
    if (document.readyState === "complete") this.arm();
    clearWatchdogLite();
  }

  private wire() {
    if (this.wired || typeof window === "undefined") return;
    this.wired = true;
    this.path = location.pathname;
    if (document.readyState === "complete") this.arm();
    else window.addEventListener("load", () => this.arm(), { once: true });
    bindGyroKick(this.kick);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      } else this.kick();
    });
    if ("IntersectionObserver" in window) {
      this.io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const el = en.target as HTMLElement & { __body?: Body };
            setStateToken(el, "offscreen", !en.isIntersecting);
            if (el.__body) el.__body.visible = en.isIntersecting;
          }
          this.kick();
        },
        { rootMargin: "100px" },
      );
    }
  }

  /** Every scene (with or without a body) is watched, so CSS loops pause offscreen (data-state~="offscreen"). */
  observe(el: HTMLElement) {
    this.wire();
    this.checkRoute();
    this.io?.observe(el);
    return () => this.io?.unobserve(el);
  }

  add(b: Body) {
    this.wire();
    this.bodies.add(b);
    (b.el as HTMLElement & { __body?: Body }).__body = b;
    b.visible = !hasStateToken(b.el, "offscreen");
    if (b.useGyro) autoGyro();
    this.kick();
  }

  remove(b: Body) {
    this.bodies.delete(b);
    b.dead = true;
    delete (b.el as HTMLElement & { __body?: Body }).__body;
  }

  kick = () => {
    if (this.raf || typeof document === "undefined" || document.hidden || !this.bodies.size) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  };

  private tick = (now: number) => {
    this.raf = 0;
    if (document.hidden) return;
    const raw = this.last ? now - this.last : 16.7;
    this.last = now;
    const dt = Math.min(34, raw) / 1000;
    const level = motionLevel();
    if (level === "calm") return;
    if (now >= this.dialogAt) {
      this.dialogAt = now + 500;
      this.dialog = openDialog();
    }
    let more = false;
    let gated = false;
    let ambient = false;
    let turning = false;
    let slots = 3;
    const orbitOk = level === "full" && !this.capped;
    for (const b of this.bodies) {
      if (!b.visible || (this.dialog && !this.dialog.contains(b.el))) {
        if (this.dialog && b.visible) gated = true;
        b.sleep();
        continue;
      }
      let idleOk = false;
      if (b.idle !== "none" && slots > 0) {
        idleOk = true;
        slots--;
      }
      const busy = b.step(dt, now, level, idleOk, orbitOk);
      if (busy) {
        b.wake();
        more = true;
        if (b.turning() || b.held || b.dragging) turning = true;
        else if (idleOk || b.spinOn) ambient = true;
      } else b.sleep();
    }
    // Turns, moments, holds and wall rebuilds are not ambient frames (owner override 2026-10-11).
    if (turning) this.heavyUntil = Math.max(this.heavyUntil, now + 200);
    this.watch(raw, ambient && !turning && this.moments === 0 && level === "full" && now >= this.heavyUntil, now);
    if (more) this.raf = requestAnimationFrame(this.tick);
    else if (gated && !this.dialogTimer) {
      // Every body here is asleep under a dialog: look again in a moment (the loop itself is stopped).
      this.dialogTimer = window.setTimeout(() => {
        this.dialogTimer = 0;
        this.dialogAt = 0;
        this.kick();
      }, 500);
    }
  };

  /**
   * Watchdog (spec 9.2, owner override 2026-10-11): windows of 90 ambient frames, counted from the page's load plus
   * 2 s. Two bad windows in a row drop this page to lite; a steady 30 Hz only stops the idle orbit (capped); a
   * good window clears the count. A new page starts full again (checkRoute).
   */
  private watch(raw: number, ambient: boolean, now: number) {
    this.checkRoute();
    if (!ambient || raw > 250 || now < this.armedAt) {
      if (!ambient) this.dts.length = 0;
      return;
    }
    this.dts.push(raw);
    if (this.dts.length < 90) return;
    const v = classifyFrames(this.dts);
    this.dts.length = 0;
    if (v === "capped") {
      this.capped = true;
      this.bad = 0;
    } else if (v === "good") this.bad = 0;
    else if (++this.bad >= 2) {
      this.bad = 0;
      setLite();
    }
  }
}

export const Engine = new EngineImpl();

/* ------------------------------------------------------------------ one Ascend at a time */

let ascendBusy = false;
const ascendQueue: Array<() => Promise<void>> = [];

/**
 * At most one Ascend runs per page; up to 3 more queue, any beyond swap with a fade. `run` starts the Ascend and
 * resolves when it settled; returns false when the caller should fade instead.
 */
export function requestAscend(run: () => Promise<void>): boolean {
  if (!ascendBusy) {
    ascendBusy = true;
    void run().finally(nextAscend);
    return true;
  }
  if (ascendQueue.length >= 3) return false;
  ascendQueue.push(run);
  return true;
}
function nextAscend() {
  const run = ascendQueue.shift();
  if (!run) {
    ascendBusy = false;
    return;
  }
  void run().finally(nextAscend);
}

/* ------------------------------------------------------------------ reveals (whenRevealed) */

export type RevealTracker = { dexNo: number; shown: () => number; visible: () => boolean };
const trackers = new Map<number, Set<RevealTracker>>();
type Waiter = { dexNo: number; level: number; resolve: () => void; timer: number };
const waiters = new Set<Waiter>();

/** MintCard registers each 3D card of a coin, so a page can wait for its reveal. Returns the unregister. */
export function trackReveal(t: RevealTracker) {
  let set = trackers.get(t.dexNo);
  if (!set) trackers.set(t.dexNo, (set = new Set()));
  set.add(t);
  return () => {
    set.delete(t);
    if (!set.size) trackers.delete(t.dexNo);
  };
}

function finish(w: Waiter) {
  if (!waiters.delete(w)) return;
  clearTimeout(w.timer);
  w.resolve();
}

/**
 * Resolves at the Ascend burst for this coin and level, immediately under calm or when no card of it is on
 * screen, at the latest after maxMs (default 1500).
 */
export function whenRevealed(dexNo: number, level: number, maxMs = 1500): Promise<void> {
  if (typeof window === "undefined" || motionLevel() === "calm") return Promise.resolve();
  const set = trackers.get(dexNo);
  const pending = !!set && [...set].some((t) => t.visible() && t.shown() < level);
  if (!pending) return Promise.resolve();
  return new Promise((resolve) => {
    const w: Waiter = { dexNo, level, resolve, timer: 0 };
    w.timer = window.setTimeout(() => finish(w), maxMs);
    waiters.add(w);
  });
}

/** The burst (or a calm crossfade) showed `level` for this coin: release everyone waiting for it. */
export function notifyRevealed(dexNo: number, level: number) {
  for (const w of [...waiters]) if (w.dexNo === dexNo && w.level <= level) finish(w);
}
