/**
 * The table light (owner override 2026-10-11): resting table cards (grids, shelves, the phone coin hero) catch the
 * light as the page scrolls and, once the gyroscope is on, as the phone tilts, with no body and no pose change.
 *
 * One passive scroll listener and the gyro's readings, throttled to one frame. Each frame writes --px, --py and
 * --lit on the shown face's lights (and px, py on its art window) of at most 8 visible cards, the most visible
 * first. Nothing reads layout: a card's light follows how far the page has scrolled since the card came into view
 * (a smooth, bounded sweep), so it starts exactly at its CSS rest light and never pops. A card someone holds
 * belongs to its body; when the body lets go it hands back to CSS and this module puts its light back at once.
 * Calm: nothing (and everything written is handed back to CSS). Lite keeps it (event driven, no cost when idle).
 *
 * Hype arcade (owner 2026-10-17): at full motion the light also drifts by itself, so the holo on every visible
 * resting card keeps moving (ambientLight, stepped at 20 Hz, each card on its own phase). It stops while the tab is
 * hidden, when no card is in view, under lite and under calm.
 */
import { autoGyro, coarsePointer, gyro, onGyro } from "./gyro";
import { clamp, type Light } from "./light";
import { motionLevel, onMotionLevel } from "./motion3d";

type Entry = {
  scene: HTMLElement;
  visible: boolean;
  ratio: number;
  /** scrollY when the card first came into view (its rest light belongs there). */
  s0: number | null;
  rest: Light | null;
  lights: HTMLElement | null;
  art: HTMLElement | null;
  key: string;
  /** The ambient drift's phase (0..1), from the card's place in the registration order. */
  ph: number;
  off: () => void;
};

/** At most this many cards follow the light at once (spec 9.1 budget). */
export const TABLE_LIGHT_MAX = 8;

const entries = new Map<HTMLElement, Entry>();
let io: IntersectionObserver | null = null;
let raf = 0;
let wired = false;
let seq = 0;

/**
 * The light for a card that has moved `d` viewport heights up the screen since it came into view, with an optional
 * gyro tilt (gx, gy in -1..1). Bounded and smooth: d = 0 is exactly the rest light. Pure (tests/card3d).
 */
export function shimmerLight(
  rest: Light,
  d: number,
  g: { x: number; y: number } | null = null,
): Light {
  const a = d * 3.1;
  let px = rest.px + 0.3 * Math.sin(a);
  let py = rest.py + 0.14 * (1 - Math.cos(a));
  let lit = rest.lit + 0.28 * Math.abs(Math.sin(a * 0.5));
  if (g) {
    px += g.x * 0.32;
    py -= g.y * 0.22;
    lit += Math.min(0.3, Math.hypot(g.x, g.y) * 0.3);
  }
  return { px: clamp(px, 0.02, 0.98), py: clamp(py, 0.02, 0.98), lit: clamp(lit, 0, 1) };
}

/** The ambient drift's step (ms): 20 Hz looks smooth for a slow holo drift and halves the repaints. */
const AMBIENT_MS = 50;
let ambientTimer = 0;

/**
 * The light's own drift at time `t` (s) on top of a light, for a card with phase `ph` (0..1). Bounded, smooth and
 * small enough that the face reads the same; pure (tests/card3d).
 */
export function ambientLight(l: Light, t: number, ph: number): Light {
  const a = t * 0.9 + ph * 6.283;
  return {
    px: clamp(l.px + 0.24 * Math.sin(a), 0.02, 0.98),
    py: clamp(l.py + 0.1 * Math.sin(a * 0.77 + 1.3), 0.02, 0.98),
    lit: clamp(l.lit + 0.22 * (0.5 + 0.5 * Math.sin(a * 1.21 + 0.6)), 0, 1),
  };
}

function ambientOn() {
  return motionLevel() === "full" && !document.hidden && !document.body?.hasAttribute("data-scroll-locked");
}

function schedule() {
  if (!raf && entries.size) raf = requestAnimationFrame(frame);
}

/** Keep the drift going while anything is in view (one timer, then one frame). */
function scheduleAmbient() {
  if (ambientTimer || !entries.size) return;
  ambientTimer = window.setTimeout(() => {
    ambientTimer = 0;
    if (ambientOn()) schedule();
  }, AMBIENT_MS);
}

function resting(scene: HTMLElement) {
  return !/\b(held|awake|dealing|turning|ascending)\b/.test(scene.dataset.state ?? "");
}

function shown(e: Entry) {
  const slot = e.scene.querySelector<HTMLElement>(".mdx-card3d__slot[data-on]");
  const lights = slot?.querySelector<HTMLElement>(".mdx-card__lights") ?? null;
  if (lights !== e.lights) {
    e.lights = lights;
    e.art = slot?.querySelector<HTMLElement>(".mdx-card__art") ?? null;
    e.rest = null;
    e.key = "";
  }
  return lights;
}

function readLight(el: HTMLElement): Light | null {
  const cs = getComputedStyle(el);
  const n = (k: string) => Number.parseFloat(cs.getPropertyValue(k));
  const l = { px: n("--px"), py: n("--py"), lit: n("--lit") };
  return Number.isFinite(l.px) && Number.isFinite(l.py) && Number.isFinite(l.lit) ? l : null;
}

function write(e: Entry, key: string) {
  const [px, py, lit] = key.split("|");
  const s = e.lights?.style;
  if (s) {
    s.setProperty("--px", px);
    s.setProperty("--py", py);
    s.setProperty("--lit", lit);
  }
  const a = e.art?.style;
  if (a) {
    a.setProperty("--px", px);
    a.setProperty("--py", py);
  }
}

function clear(e: Entry) {
  for (const el of [e.lights, e.art]) {
    el?.style.removeProperty("--px");
    el?.style.removeProperty("--py");
    el?.style.removeProperty("--lit");
  }
  e.key = "";
  e.s0 = null;
}

function frame() {
  raf = 0;
  if (motionLevel() === "calm" || document.hidden) return;
  const vh = window.innerHeight || 1;
  const sy = window.scrollY;
  const g = gyro.on ? { x: clamp(gyro.ry / 14, -1, 1), y: clamp(gyro.rx / 12, -1, 1) } : null;
  const amb = ambientOn();
  const t = performance.now() / 1000;
  const pick = [...entries.values()]
    .filter((e) => e.visible && resting(e.scene))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, TABLE_LIGHT_MAX);
  // Reads first (a new card's CSS rest light, once), then writes: one style pass per frame at most.
  for (const e of pick) {
    const lights = shown(e);
    if (lights && !e.rest) e.rest = readLight(lights);
    if (e.s0 == null) e.s0 = sy;
  }
  for (const e of pick) {
    if (!e.lights || !e.rest) continue;
    const s0 = shimmerLight(e.rest, (sy - (e.s0 ?? sy)) / vh, g);
    const l = amb ? ambientLight(s0, t, e.ph) : s0;
    const key = `${l.px.toFixed(3)}|${l.py.toFixed(3)}|${l.lit.toFixed(3)}`;
    if (key === e.key) continue;
    e.key = key;
    write(e, key);
  }
  if (amb && pick.length) scheduleAmbient();
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("scroll", schedule, { passive: true });
  onGyro(schedule);
  onMotionLevel(() => {
    if (motionLevel() === "full") schedule();
    if (motionLevel() !== "calm") return;
    for (const e of entries.values()) clear(e);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule();
  });
  if ("IntersectionObserver" in window) {
    io = new IntersectionObserver(
      (list) => {
        for (const en of list) {
          const e = entries.get(en.target as HTMLElement);
          if (!e) continue;
          e.visible = en.isIntersecting;
          e.ratio = en.intersectionRatio;
        }
        schedule();
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
  }
}

/** Card3D registers every table scene; returns the unregister. */
export function registerTable(scene: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  wire();
  // Android shares the gyroscope without a prompt (iOS needs the "Tilt to shine" tap): the grids follow it too.
  if (coarsePointer() && motionLevel() !== "calm") autoGyro();
  // A body that let go handed the face back to CSS: put this card's light back at once (no flash of the rest).
  const onRest = () => {
    const e = entries.get(scene);
    if (e?.key && e.lights?.isConnected) write(e, e.key);
  };
  scene.addEventListener("mdx:rest", onRest);
  const e: Entry = {
    scene,
    visible: false,
    ratio: 0,
    s0: null,
    rest: null,
    lights: null,
    art: null,
    key: "",
    ph: (seq++ * 0.618034) % 1,
    off: () => scene.removeEventListener("mdx:rest", onRest),
  };
  entries.set(scene, e);
  io?.observe(scene);
  return () => {
    e.off();
    io?.unobserve(scene);
    entries.delete(scene);
  };
}
