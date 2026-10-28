/**
 * The scene controller behind Card3D (and CardCase, Inspect): one body, its input (hover, press, drag, tap, keys,
 * gyro), face swaps on staged slots, side turns and the moments. Everything here is imperative and runs after
 * mount; React only renders the static markup (spec 4.4) and passes options in.
 */
import { CARD_BOX, extrude, paintEdge, type EdgeBox } from "./extrude";
import { backFacing, clamp, HAND_REST, sideFromAngle, TABLE_REST, type Light, type RestPose } from "./light";
import { Body, Engine, motionLevel, SPRINGS, type BodyKind, type IdleMode } from "./motion3d";
import { registerSpin } from "./spin";
import { autoGyro, coarsePointer, gyro, onGyro } from "./gyro";
import type { CardGround, CardSide, CardSwap, TierLight } from "./types";

export type SceneOpts = {
  depth: "table" | "hand";
  kind: BodyKind;
  flippable: boolean;
  tapTurns: boolean;
  /** tapTurns was not given: a card inside a link or button never turns on tap (the tap is the link's). */
  tapAuto?: boolean;
  drag: "turn" | "step" | "none";
  idle: IdleMode | "float";
  ground: CardGround;
  gyro: boolean;
  focusable: boolean;
  arrowsTurn: boolean;
  /** Corner segments for the card's own walls (hand/turntable 2, other table 1, in a case 2). */
  seg: number;
  /** Extra walls (the case): built with the card's. */
  caseEdges?: { host: () => HTMLElement | null; box: EdgeBox; paint: (nx: number, ny: number) => string } | null;
  onInteract?: (kind: "hover" | "drag" | "tap" | "key") => void;
  onStep?: (dir: 1 | -1) => void;
  onSideChange?: (side: CardSide) => void;
  onSwapped?: (key: string) => void;
  onSettled?: (key: string) => void;
  /** User-initiated turnovers announce the side (live region in the component). */
  announce: (side: CardSide) => void;
  tierOf: (key: string) => TierLight | null;
  /** The table back and edges mount on first hold or deal (React state in Card3D). */
  mountBack: () => void;
  /** Extra keys (I opens Inspect); return true when handled. */
  extraKeys?: (e: KeyboardEvent) => boolean;
  /** Called on every engine step of the body (the Inspect turntable). */
  frame?: (b: Body) => void;
  /** A list card that spins in place while it is in view (spin.ts; table cards only). */
  turntable?: boolean;
  /** Its phase seed (the dex number). */
  seed?: number;
};

const FINE = "(hover: hover) and (pointer: fine)";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The rest pose the scene's CSS gives this card (card3d.css --rest-rx / --rest-ry: the hand lean, a page's own,
 * or a shelf column's fan) and the light its face shows now. One style read, when a body is made.
 */
function readRest(scene: HTMLElement, lights: HTMLElement | null, hand: boolean): { pose: RestPose; light: Light | null } {
  const d = hand ? HAND_REST : TABLE_REST;
  try {
    const cs = getComputedStyle(scene);
    const num = (s: CSSStyleDeclaration, k: string) => {
      const v = Number.parseFloat(s.getPropertyValue(k));
      return Number.isFinite(v) ? v : null;
    };
    const pose = { rx: num(cs, "--rest-rx") ?? d.rx, ry: num(cs, "--rest-ry") ?? d.ry };
    const ls = lights ? getComputedStyle(lights) : null;
    const px = ls && num(ls, "--px");
    const py = ls && num(ls, "--py");
    const lit = ls && num(ls, "--lit");
    return { pose, light: px != null && py != null && lit != null ? { px, py, lit } : null };
  } catch {
    return { pose: d, light: null };
  }
}

/** Wait for a slot's images to decode, at most `cap` ms (spec 4.9: never turn onto an undecoded face). */
export function decodeSlot(slot: Element | null, cap = 600): Promise<void> {
  if (!slot) return Promise.resolve();
  const imgs = [...slot.querySelectorAll("img")].filter((i) => i.getAttribute("src"));
  if (!imgs.length) return Promise.resolve();
  return Promise.race([
    Promise.all(
      imgs.map((i) => {
        if (i.loading === "lazy") i.loading = "eager";
        return i.decode().catch(() => undefined);
      }),
    ).then(() => undefined),
    wait(cap),
  ]);
}

export class SceneCtl {
  body: Body | null = null;
  shown: string;
  private target: string;
  private side: CardSide = "face";
  private rect: DOMRect | null = null;
  private drag: {
    id: number;
    x0: number;
    y0: number;
    f0: number;
    lx: number;
    lt: number;
    v: number;
    moved: boolean;
    px: number;
    touch: boolean;
  } | null = null;
  private swallowUntil = 0;
  /** Calm only: a press that may become a sideways swipe on a turntable (drag "step"). */
  private calmSwipe: { id: number; x0: number; y0: number } | null = null;
  private lastPointer = "mouse";
  private stepDir: 0 | 1 | -1 = 0;
  private stepFrom = 0;
  private swapping = false;
  private lastJolt = 0;
  private flashAt = 0;
  private offs: Array<() => void> = [];
  private ro: ResizeObserver | null = null;
  /** The scene sits inside a link or button (set at mount). */
  private inLink = false;
  /** A moment (Ascend, reveal, claim) owns the body: turnovers wait. */
  busy = false;
  destroyed = false;

  constructor(
    readonly scene: HTMLElement,
    readonly pose: HTMLElement,
    readonly faces: HTMLElement,
    readonly edges: HTMLElement,
    readonly ground: HTMLElement | null,
    public opts: SceneOpts,
    shown: string,
  ) {
    this.shown = shown;
    this.target = shown;
    this.inLink = !!scene.parentElement?.closest("a, button");
    this.bind();
    // Grid cards can follow the phone without opening the viewer. Create their body only after a real
    // sensor reading and while they are on screen; the shared engine owns the frames and visibility gates.
    this.offs.push(onGyro(() => {
      if (this.body || !this.opts.gyro || !gyro.on || !coarsePointer() || motionLevel() === "calm") return;
      if (this.scene.dataset.state?.split(" ").includes("offscreen")) return;
      this.ensureBody();
    }));
    if (opts.gyro && motionLevel() !== "calm") autoGyro();
    if (opts.depth === "hand" && motionLevel() !== "calm") this.ensureBody();
    if (opts.turntable && opts.depth === "table") {
      this.offs.push(
        registerSpin(scene, {
          seed: opts.seed ?? 0,
          body: () => this.ensureBody(),
          prepare: () => {
            this.opts.mountBack();
            this.buildEdges();
            if (this.body) this.body.W = this.scene.offsetWidth || this.body.W;
          },
        }),
      );
    }
  }

  /* ------------------------------------------------------------------ the body */

  get hand() {
    return this.opts.depth === "hand";
  }

  private get taps() {
    return this.opts.tapTurns && !(this.opts.tapAuto && this.inLink);
  }

  ensureBody(): Body | null {
    if (this.destroyed || motionLevel() === "calm") return null;
    if (this.body) return this.body;
    const b = new Body(this.scene, this.pose, this.opts.kind);
    b.ground = this.ground;
    b.groundMode = this.opts.ground === "none" ? "none" : this.opts.ground;
    b.idle = this.hand && this.opts.idle !== "float" ? this.opts.idle : "none";
    b.useGyro = this.opts.gyro && coarsePointer();
    b.liveFollowsHold = !this.hand;
    // The light starts from the rest light the server painted and glides to the pose's (no pop on wake).
    b.live.snap(this.hand ? 1 : 0);
    const f = this.side === "back" ? 180 : 0;
    b.flip.snap(f);
    b.onFrame = () => this.opts.frame?.(b);
    this.body = b;
    this.syncLights();
    // The rest pose CSS painted (card3d.css --rest-*, a shelf's column fan): the springs start there, no jump. The
    // light starts from the one the face shows now (its rest, or where the scroll shimmer left it).
    const r = readRest(this.scene, b.lights[0] ?? null, this.hand);
    b.setRest(r.pose, r.light);
    this.buildEdges();
    if (this.hand && "ResizeObserver" in window) {
      this.ro = new ResizeObserver(() => {
        if (this.body) this.body.W = this.scene.offsetWidth || this.body.W;
      });
      this.ro.observe(this.scene);
    }
    Engine.add(b);
    return b;
  }

  /** A live idle change (the caller paused or resumed its ambient motion). */
  setIdle(idle: IdleMode | "float") {
    this.opts.idle = idle;
    const b = this.body;
    if (!b) return;
    const next = this.hand && idle !== "float" ? idle : "none";
    if (next === "spin" && b.idle !== "spin") b.spinFrom = performance.now();
    b.idle = next;
    Engine.kick();
  }

  dropBody() {
    const b = this.body;
    if (!b) return;
    Engine.remove(b);
    b.rest();
    b.pose.style.transform = "";
    for (const el of b.lights) {
      el.style.removeProperty("--px");
      el.style.removeProperty("--py");
      el.style.removeProperty("--lit");
    }
    for (const t of ["held", "dragging", "turning", "ascending", "awake", "moving"] as const) b.setToken(t, false);
    this.body = null;
    this.ro?.disconnect();
    this.ro = null;
  }

  /**
   * The slab's cut edge: one continuous ring of walls in the design's edge material (hand after mount, table on
   * first hold), plus the case's acrylic walls. Spinning and held list cards share this rounded perimeter:
   * a full-height rectangular side would protrude beyond the rounded faces at oblique angles.
   */
  buildEdges() {
    let built = this.edges.childElementCount === 0;
    extrude(this.edges, CARD_BOX, this.opts.seg, "var(--t)", paintEdge);
    const ce = this.opts.caseEdges;
    const host = ce?.host();
    if (ce && host) {
      built ||= host.childElementCount === 0;
      extrude(host, ce.box, 4, "var(--T)", ce.paint);
    }
    // New walls are new layers: the frames that build them are not ambient (the watchdog skips them).
    if (built) Engine.heavy();
  }

  /** Point the body's light writes at the shown slot's lights and the back's lights. */
  syncLights() {
    const b = this.body;
    if (!b) return;
    const lights: HTMLElement[] = [];
    const slot = this.slot(this.shown);
    const fl = slot?.querySelector<HTMLElement>(".mdx-card__lights, .mdx-card3d__back-lights");
    if (fl) lights.push(fl);
    const bl = this.pose.querySelector<HTMLElement>(":scope > .mdx-card3d__back .mdx-card3d__back-lights");
    if (bl) lights.push(bl);
    // The case's own gloss (CardCase) follows the whole turn with its local mirror sensitivity.
    b.glossLights = [...this.pose.querySelectorAll<HTMLElement>(":scope > .mdx-case__plate .mdx-case__gloss, :scope > .mdx-case__plate .mdx-case__holo")];
    // Values written on the old face's elements stay behind: hand them back to CSS.
    for (const el of b.lights) {
      if (lights.includes(el)) continue;
      el.style.removeProperty("--px");
      el.style.removeProperty("--py");
      el.style.removeProperty("--lit");
    }
    b.lights = lights;
    b.relight();
  }

  slot(key: string) {
    for (const el of this.faces.children) if ((el as HTMLElement).dataset.key === key) return el as HTMLElement;
    return null;
  }

  /* ------------------------------------------------------------------ face swaps */

  private showSlot(key: string) {
    for (const el of this.faces.children) {
      const s = el as HTMLElement;
      if (s.dataset.key === key) s.setAttribute("data-on", "");
      else s.removeAttribute("data-on");
    }
    this.shown = key;
    this.syncLights();
    this.opts.onSwapped?.(key);
  }

  /** Crossfade (calm, "fade", any swap the card cannot play): the new slot fades in over the old one. */
  private fadeTo(key: string, ms = 200) {
    const prev = this.slot(this.shown);
    this.showSlot(key);
    const next = this.slot(key);
    if (prev && next && prev !== next) {
      prev.setAttribute("data-leaving", "");
      const a = next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)" });
      a.onfinish = a.oncancel = () => prev.removeAttribute("data-leaving");
    }
    if (motionLevel() !== "calm" && this.hand) this.flash();
    window.setTimeout(() => this.opts.onSettled?.(key), ms);
  }

  /** Moments: show a staged face now (fade under calm or when asked). */
  swapIn(key: string, fade: boolean) {
    this.target = key;
    if (fade) this.fadeTo(key);
    else this.showSlot(key);
  }

  /** Moments: the side becomes the face without an announcement. */
  faceUp() {
    this.setSide("face", false);
  }

  mountBack() {
    this.opts.mountBack();
  }

  /** Called by Card3D when `front` changed. */
  setFront(key: string, swap: CardSwap, dir: 1 | -1, playAscend?: (short: boolean) => Promise<void>) {
    if (key === this.target && !this.stepDir) return;
    this.target = key;
    if (!this.slot(key)) return;
    const level = motionLevel();
    let kind: CardSwap = level === "calm" ? "fade" : swap;
    if (level === "lite" && kind === "ascend") kind = "ascend-short";
    const offscreen = this.scene.dataset.state?.includes("offscreen");
    if (offscreen && kind !== "instant") kind = "fade";
    if (kind === "instant") {
      this.showSlot(key);
      this.opts.onSettled?.(key);
      return;
    }
    if (kind === "fade") {
      this.fadeTo(key);
      return;
    }
    const b = this.ensureBody();
    if (!b) {
      this.fadeTo(key);
      return;
    }
    if ((kind === "ascend" || kind === "ascend-short") && playAscend) {
      void playAscend(kind === "ascend-short");
      return;
    }
    // A drag step already carries the turn: watch it for the back and land.
    if (this.stepDir) {
      const d = this.stepDir;
      const f0 = this.stepFrom;
      this.stepDir = 0;
      this.watchSwap(key, (f, Y) => backFacing(Y) || d * (f - f0) > 250);
      return;
    }
    void decodeSlot(this.slot(key)).then(() => {
      if (this.destroyed || this.target !== key || !this.body) return;
      this.turnTo(key, kind, dir);
    });
  }

  private turnTo(key: string, kind: CardSwap, dir: 1 | -1) {
    const b = this.body!;
    if (kind === "quick") {
      const from = b.flip.x;
      b.tween = {
        from,
        to: from + 90 * dir,
        t0: performance.now(),
        dur: 150,
        ease: (k) => k * k,
        done: () => {
          this.showSlot(key);
          b.tween = {
            from: from - 90 * dir,
            to: from,
            t0: performance.now(),
            dur: 150,
            ease: (k) => 1 - (1 - k) * (1 - k),
            done: () => this.opts.onSettled?.(key),
          };
        },
      };
      Engine.kick();
      return;
    }
    const springs = kind === "spin" ? SPRINGS.spin : kind === "print" ? SPRINGS.short : kind === "turn" ? SPRINGS.turntable : SPRINGS.flip;
    b.flip.tune(springs);
    const onBack = sideFromAngle(b.flip.t) === "back";
    b.flip.t = Math.round(b.flip.t / 180) * 180 + (onBack ? 180 : 360) * dir;
    this.setSide("face", false);
    this.watchSwap(key, (_f, Y) => backFacing(Y));
  }

  /** Swap the face the first time `when` holds, then report the settle. */
  private watchSwap(key: string, when: (f: number, Y: number) => boolean) {
    const b = this.body!;
    b.setToken("turning", true);
    this.swapping = true;
    let swapped = false;
    b.watchers.add((f, Y) => {
      if (!swapped && when(f, Y)) {
        swapped = true;
        this.showSlot(this.target === key ? key : this.target);
      }
      if (swapped && !b.flip.busy(0.6)) {
        b.setToken("turning", false);
        this.swapping = false;
        b.flip.tune(SPRINGS.flip);
        this.opts.onSettled?.(this.shown);
        return true;
      }
      return false;
    });
    Engine.kick();
  }

  /** The holo pass over the shown face (reveals and fast fades); at most one per 400 ms (WCAG 2.3.1). */
  flash() {
    const now = performance.now();
    if (now - this.flashAt < 400) return;
    this.flashAt = now;
    const lights = this.slot(this.shown)?.querySelector<HTMLElement>(".mdx-card__lights");
    if (!lights) return;
    lights.removeAttribute("data-flash");
    void lights.offsetWidth;
    lights.setAttribute("data-flash", "");
    window.setTimeout(() => lights.removeAttribute("data-flash"), 950);
  }

  /* ------------------------------------------------------------------ sides */

  getSide() {
    return this.side;
  }

  private setSide(side: CardSide, user: boolean) {
    if (side === this.side) return;
    this.side = side;
    this.scene.dataset.side = side;
    this.opts.onSideChange?.(side);
    if (user) this.opts.announce(side);
  }

  /** Half a turn toward dir (spec M3). Calm: a 200 ms crossfade between face and back. */
  turnOver(dir: 1 | -1 = 1, user = true) {
    if (!this.opts.flippable || this.busy || this.swapping) return;
    const b = motionLevel() === "calm" ? null : this.ensureBody();
    if (!b) {
      this.opts.mountBack();
      this.setSide(this.side === "face" ? "back" : "face", user);
      return;
    }
    this.opts.mountBack();
    b.flip.tune(SPRINGS.flip);
    b.flip.t = Math.round(b.flip.t / 180) * 180 + 180 * dir;
    this.setSide(sideFromAngle(b.flip.t), user);
    Engine.kick();
  }

  /** Controlled side (the `side` prop). */
  syncSide(side: CardSide | undefined) {
    if (!side || side === this.side) return;
    this.turnOver(side === "back" ? 1 : -1, false);
  }

  /* ------------------------------------------------------------------ moments the handle exposes */

  jolt() {
    const now = performance.now();
    if (now - this.lastJolt < 2000 || motionLevel() === "calm") return;
    this.lastJolt = now;
    const b = this.ensureBody();
    b?.jolt();
    Engine.kick();
  }

  peek() {
    if (motionLevel() === "calm") return;
    this.ensureBody()?.peek();
    Engine.kick();
  }

  settle() {
    if (motionLevel() === "calm" || !this.hand) return;
    this.body?.settle();
    Engine.kick();
  }

  /* ------------------------------------------------------------------ input */

  private on<K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) {
    el.addEventListener(type, fn as EventListener, opts);
    this.offs.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private toInput(e: PointerEvent) {
    const b = this.body;
    if (!b) return;
    if (!this.rect) this.rect = this.scene.getBoundingClientRect();
    const r = this.rect;
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    b.input.rx = (0.5 - py) * 2 * b.cfg.maxRx;
    b.input.ry = (px - 0.5) * 2 * b.cfg.maxRy;
  }

  private hold(on: boolean) {
    const b = on ? this.ensureBody() : this.body;
    if (!b) return;
    b.held = on;
    b.setToken("held", on);
    if (on) {
      this.opts.mountBack();
      this.buildEdges();
      b.W = this.scene.offsetWidth || b.W;
      b.lift.t = b.cfg.lift;
      b.sc.t = b.cfg.scale;
    } else {
      b.input.rx = b.input.ry = 0;
      b.lift.t = 0;
      b.sc.t = 1;
      this.rect = null;
    }
    Engine.kick();
  }

  private bind() {
    const el = this.scene;
    const fine = () => window.matchMedia?.(FINE).matches;
    this.on(el, "pointerenter", (e: PointerEvent) => {
      if (e.pointerType === "touch" || !fine() || motionLevel() === "calm") return;
      this.rect = el.getBoundingClientRect();
      this.hold(true);
      // Pick up toward the point the hand actually entered, even if the pointer then stops. Waiting for the
      // first pointermove left a stationary hover looking flat while the card was already lifted.
      this.toInput(e);
      this.opts.onInteract?.("hover");
    });
    this.on(el, "pointerleave", (e: PointerEvent) => {
      if (this.drag?.moved) return;
      // A press has no capture until it becomes a horizontal drag. Leaving before that threshold cancels it,
      // otherwise a release outside the scene could leave a stale press blocking every later interaction.
      if (this.drag) end(e, false);
      if (this.body?.held) this.hold(false);
    });
    this.on(el, "pointermove", (e: PointerEvent) => {
      const d = this.drag;
      const b = this.body;
      if (d && d.id === e.pointerId && e.buttons === 0) {
        // Recover if the browser missed the release (for example after switching windows). A pointer with no
        // button down may hover, but it must never continue an old drag.
        end(e, false);
        return;
      }
      if (d && b && d.id === e.pointerId && this.opts.drag !== "none") {
        const dx = e.clientX - d.x0;
        if (!d.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - d.y0)) {
          d.moved = true;
          b.dragging = true;
          b.setToken("dragging", true);
          this.opts.mountBack();
          this.buildEdges();
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          this.opts.onInteract?.("drag");
        }
        if (d.moved) {
          const now = performance.now();
          const dtt = Math.max(1, now - d.lt);
          b.flip.x = d.f0 + dx * 0.62;
          b.flip.t = b.flip.x;
          const v = ((e.clientX - d.lx) * 0.62 * 1000) / dtt;
          d.v = d.v * 0.55 + v * 0.45;
          d.lx = e.clientX;
          d.lt = now;
          b.input.rx = clamp((d.y0 - e.clientY) * 0.08, -10, 10);
          Engine.kick();
          return;
        }
      }
      if (e.pointerType !== "touch" && b?.held) {
        this.toInput(e);
        Engine.kick();
      }
    });
    this.on(el, "pointerdown", (e: PointerEvent) => {
      if (e.button !== 0 || e.isPrimary === false || this.drag || this.calmSwipe) return;
      this.lastPointer = e.pointerType;
      const touch = e.pointerType === "touch";
      // Horizontal touch turns the card right here. Vertical panning remains browser-owned through pan-y;
      // an unmoved tap on a linked card still opens its coin.
      if (touch && this.opts.drag === "none" && !this.hand) return;
      if (motionLevel() === "calm") {
        // Calm: no body and no spin, but a sideways swipe still steps a turntable (the swap crossfades).
        this.drag = null;
        this.calmSwipe = this.opts.drag === "step" ? { id: e.pointerId, x0: e.clientX, y0: e.clientY } : null;
        return;
      }
      const b = this.ensureBody();
      if (!b) return;
      this.rect = el.getBoundingClientRect();
      this.drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        f0: b.flip.x,
        lx: e.clientX,
        lt: performance.now(),
        v: 0,
        moved: false,
        px: clamp((e.clientX - this.rect.left) / this.rect.width, 0, 1),
        touch,
      };
      if (!this.busy && !(touch && !this.hand)) {
        b.sc.t = 0.985;
        b.lift.t = b.cfg.lift * (b.held ? 0.6 : 0.3);
        Engine.kick();
      }
    });
    const end = (e: Pick<PointerEvent, "type" | "pointerId" | "clientX" | "clientY">, allowTap = true) => {
      const cs = this.calmSwipe;
      if (cs && cs.id === e.pointerId) {
        this.calmSwipe = null;
        const dx = e.clientX - cs.x0;
        if (e.type === "pointerup" && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - cs.y0) * 1.2) {
          this.swallowUntil = performance.now() + 400;
          this.opts.onStep?.(dx > 0 ? 1 : -1);
        }
        return;
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      const b = this.body;
      if (!b) return;
      if (d.moved) {
        b.dragging = false;
        b.setToken("dragging", false);
        this.swallowUntil = performance.now() + 400;
        const v = clamp(d.v, -2400, 2400);
        if (e.type !== "pointerup") {
          // A browser-owned gesture, lost capture or an interrupted drag is not a fling. Return to the side
          // the user started from; never advance a featured card or leave a half-turned card behind.
          this.stepDir = 0;
          b.flip.tune(SPRINGS.flip);
          b.flip.v = 0;
          b.flip.t = Math.round(d.f0 / (this.opts.drag === "step" ? 360 : 180)) * (this.opts.drag === "step" ? 360 : 180);
          this.setSide(sideFromAngle(b.flip.t), false);
        } else if (this.opts.drag === "step") {
          const moved = b.flip.x - d.f0;
          const dir: 1 | -1 = moved + v * 0.2 >= 0 ? 1 : -1;
          if (Math.abs(moved) > 90 || Math.abs(v) > 600) {
            b.flip.tune(SPRINGS.turntable);
            b.flip.v = v;
            b.flip.t = Math.round(d.f0 / 360) * 360 + 360 * dir;
            this.stepDir = dir;
            this.stepFrom = d.f0;
            this.opts.onStep?.(dir);
            // The caller did not change front (no next card): land back on this face.
            window.setTimeout(() => {
              this.stepDir = 0;
            }, 120);
          } else {
            b.flip.v = v * 0.5;
            b.flip.t = Math.round(d.f0 / 360) * 360;
          }
        } else if (this.opts.turntable && !this.hand) {
          // A list turntable coasts on from the fling (inertia), then its slow spin takes over again.
          b.flip.tune(SPRINGS.turntable);
          b.flip.v = v;
          b.flip.t = b.flip.x + v * 0.32;
        } else {
          b.flip.tune(SPRINGS.flip);
          b.flip.v = v;
          let t = Math.round((b.flip.x + v * 0.2) / 180) * 180;
          if (!this.opts.flippable) t = Math.round((b.flip.x + v * 0.2) / 360) * 360;
          b.flip.t = t;
          this.setSide(sideFromAngle(t), true);
        }
      } else if (allowTap && e.type === "pointerup" && !d.touch && d.id >= 0 && this.lastPointer === "mouse" && this.taps && !this.busy) {
        // Mouse taps turn here; touch taps come through click (below) so scrolling never turns a card.
        this.opts.onInteract?.("tap");
        this.turnOver(d.px > 0.5 ? 1 : -1);
        this.swallowUntil = performance.now() + 50;
      }
      if (d.touch || e.type !== "pointerup" || !el.matches(":hover")) this.hold(false);
      b.sc.t = b.held ? b.cfg.scale : 1;
      b.lift.t = b.held ? b.cfg.lift : 0;
      Engine.kick();
    };
    this.on(el, "pointerup", end);
    this.on(el, "pointercancel", end);
    this.on(el, "lostpointercapture", (e: PointerEvent) => {
      // Touch starts with implicit capture on the artwork/text hit beneath this scene. Taking capture for
      // the drag makes that child lose it; its bubbling event must not cancel our newly captured gesture.
      if (e.target === el) end(e, false);
    });
    // Release outside the hit area also ends an uncaptured press. Local pointerup has already consumed an
    // inside release, so this fallback must not turn a card as though the outside release were a tap.
    this.on(window, "pointerup", (e: PointerEvent) => end(e, false));
    this.on(window, "pointercancel", (e: PointerEvent) => end(e, false));
    this.on(window, "blur", () => {
      const active = this.drag ?? this.calmSwipe;
      if (active) end({ type: "blur", pointerId: active.id, clientX: 0, clientY: 0 }, false);
    });
    // A drag never clicks through (cards inside links do not navigate after a drag), and touch taps turn here.
    this.on(
      el,
      "click",
      (e: MouseEvent) => {
        const now = performance.now();
        if (now < this.swallowUntil) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // detail 0: a click no pointer made (a screen reader's activation, a keyboard click on a link), so it turns.
        if (this.taps && (motionLevel() === "calm" || this.lastPointer === "touch" || this.lastPointer === "pen" || e.detail === 0)) {
          const r = el.getBoundingClientRect();
          this.opts.onInteract?.("tap");
          this.turnOver((e.clientX - r.left) / r.width > 0.5 ? 1 : -1);
        }
      },
      { capture: true },
    );
    this.on(el, "keydown", (e: KeyboardEvent) => {
      if (!this.opts.focusable || e.target !== el) return;
      if (this.opts.extraKeys?.(e)) return;
      const k = e.key;
      if (k === "f" || k === "F" || k === "Enter" || k === " ") {
        e.preventDefault();
        this.opts.onInteract?.("key");
        this.turnOver(1);
      } else if (this.opts.arrowsTurn && (k === "ArrowRight" || k === "ArrowLeft")) {
        e.preventDefault();
        this.opts.onInteract?.("key");
        this.turnOver(k === "ArrowRight" ? 1 : -1);
      }
    });
    // Keyboard focus on the enclosing link lifts the card (no tilt).
    const host = el.closest("a, button") ?? (this.opts.focusable ? el : null);
    if (host) {
      this.on(host, "focusin", () => {
        if (motionLevel() === "calm" || !host.matches(":focus-visible")) return;
        const b = this.ensureBody();
        if (!b) return;
        b.focusHold = true;
        b.lift.t = b.cfg.lift * 0.8;
        b.sc.t = b.cfg.scale;
        Engine.kick();
      });
      this.on(host, "focusout", () => {
        const b = this.body;
        if (!b || !b.focusHold) return;
        b.focusHold = false;
        if (!b.held) {
          b.lift.t = 0;
          b.sc.t = 1;
        }
        Engine.kick();
      });
    }
  }

  destroy() {
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.dropBody();
  }
}
