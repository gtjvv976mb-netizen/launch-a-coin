/**
 * The entrances (spec 6.3): deal (M7), rise (M8 under lite), unbox (M10), lift-in (M11). WAAPI on __enter
 * (transform) and fades on the scene root (opacity), never inside the 3D chain. The reveals (Ascend, mint reveal,
 * claim) are in reveal.ts, a lazy chunk.
 */
import { motionLevel } from "./motion3d";

/* ------------------------------------------------------------------ entrances */

type DealOpts = { deck: HTMLElement | null; index: number; quick: boolean; onStart: () => void; onEnd: () => void };
type DealJob = { scene: HTMLElement; enter: HTMLElement; ground: HTMLElement | null; o: DealOpts };

/** Deals asked for in this commit: measured together, then started together (one layout for a whole shelf). */
let dealQueue: DealJob[] = [];
let dealFlush = false;

/**
 * M7 deal: from the deck, face down and small, to rest; the back shows until edge-on; the ground stays at opacity
 * 0 until 62% of the flight (F2), then fades in widening from .3. Lite: Rise. Calm: a 180 ms fade, all at once.
 * Every card of a shelf mounts in one commit: each card only hides itself there (two cheap writes), and the deals
 * run together in the next frame, reading every card's box and the deck's first and writing after. Twelve cards
 * cost one layout instead of twelve write-then-read cycles, outside the navigation's own task (QA: 37 forced
 * layouts and a 130 ms task on a 4x slowed CPU).
 */
export function deal(scene: HTMLElement, enter: HTMLElement, ground: HTMLElement | null, o: DealOpts) {
  const level = motionLevel();
  if (level === "calm") {
    scene.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
    return;
  }
  if (level === "lite") {
    rise(scene, o.index);
    return;
  }
  // Out of sight until its flight starts (the flight's own backwards fill takes over from this).
  scene.style.opacity = "0";
  scene.dataset.state = `${scene.dataset.state ?? ""} dealing`.trim();
  dealQueue.push({ scene, enter, ground, o });
  if (dealFlush) return;
  dealFlush = true;
  requestAnimationFrame(() => {
    dealFlush = false;
    const jobs = dealQueue.filter((j) => j.scene.isConnected);
    dealQueue = [];
    const boxes = jobs.map((j) => ({ r: j.scene.getBoundingClientRect(), d: j.o.deck?.getBoundingClientRect() ?? null }));
    jobs.forEach((j, i) => fly(j, boxes[i].r, boxes[i].d));
  });
}

/** Half a sway period, negative: a dealt card's sway starts at the middle of its swing, the rest pose (card3d.css). */
function swayFromRest(scene: HTMLElement) {
  const dur = parseFloat(scene.style.getPropertyValue("--float-dur")) || 7;
  scene.style.setProperty("--float-delay", `${(-dur / 2).toFixed(2)}s`);
}

function fly({ scene, enter, ground, o }: DealJob, r: DOMRect, d: DOMRect | null) {
  const fromX = d ? d.left + d.width / 2 : r.left + r.width / 2;
  const fromY = d ? d.top + d.height / 2 : r.top - 120;
  const dx = fromX - (r.left + r.width / 2);
  const dy = fromY - (r.top + r.height / 2);
  const rz = (Math.random() < 0.5 ? -1 : 1) * 12;
  const duration = o.quick ? 480 : 720;
  const delay = Math.min(o.index, 11) * (o.quick ? 30 : 60);
  const timing: KeyframeAnimationOptions = { duration, delay, easing: "cubic-bezier(.22,1.12,.36,1)", fill: "backwards" };
  o.onStart();
  const fly = enter.animate(
    [
      { transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 120px) rotateZ(${rz}deg) rotateY(180deg) scale(0.62)` },
      { transform: "translate3d(0, 0, 0) rotateZ(0deg) rotateY(0deg) scale(1)" },
    ],
    timing,
  );
  // Dealt off the top of the deck: the card appears at once (a slow fade would read as a grey ghost over the wall).
  scene.animate([{ opacity: 0 }, { opacity: 1, offset: 0.04 }, { opacity: 1 }], { ...timing, easing: "linear" });
  scene.style.opacity = "";
  ground?.animate(
    [
      { opacity: 0, transform: "scaleX(0.3)" },
      { opacity: 0, transform: "scaleX(0.3)", offset: 0.62 },
      { opacity: 1, transform: "scaleX(1)" },
    ],
    { ...timing, easing: "linear" },
  );
  // The deck goes away as soon as this card has left it (not when the last one lands): it never sits over a card
  // that is already face up (QA).
  let away = false;
  const leave = () => {
    if (away) return;
    away = true;
    o.onEnd();
  };
  const left = window.setTimeout(leave, delay + duration * 0.35);
  let ended = false;
  const done = () => {
    if (ended) return;
    ended = true;
    clearTimeout(left);
    leave();
    swayFromRest(scene);
    scene.dataset.state = (scene.dataset.state ?? "").replace(/\bdealing\b/, "").replace(/\s+/g, " ").trim();
    if (!scene.dataset.state) delete scene.dataset.state;
  };
  fly.onfinish = done;
  fly.oncancel = done;
}

/**
 * The wave (a hard load of a shelf, full motion): the server painted the cards at rest, so instead of a deal a
 * lean and a pass of light run along the shelf once, card after card, added on top of each card's sway (so it
 * hands back without a jump). Skipped for a card offscreen, in a hidden tab or under a dialog when its turn comes.
 */
export function wave(scene: HTMLElement, enter: HTMLElement, index: number) {
  if (typeof window === "undefined") return;
  const at = 650 + Math.min(index, 11) * 80;
  window.setTimeout(() => {
    if (!scene.isConnected || document.hidden || motionLevel() !== "full") return;
    if (/\b(offscreen|held|dealing|awake)\b/.test(scene.dataset.state ?? "")) return;
    if (document.body.hasAttribute("data-scroll-locked")) return;
    enter.animate(
      [
        { transform: "translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg)" },
        { transform: "translate3d(0, -8px, 18px) rotateX(5deg) rotateY(-18deg)", offset: 0.38 },
        { transform: "translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg)" },
      ],
      { duration: 980, easing: "cubic-bezier(.33,0,.2,1)", composite: "add" },
    );
    window.setTimeout(() => {
      if (!scene.isConnected) return;
      scene.setAttribute("data-sheen", "");
      window.setTimeout(() => scene.removeAttribute("data-sheen"), 950);
    }, 220);
  }, at);
}

/** M8 rise (used for a deal under lite): fade plus 6px, 260 ms, stagger 24 ms capped at 10. */
export function rise(scene: HTMLElement, index: number) {
  scene.animate(
    [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 260, delay: Math.min(index, 10) * 24, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
  );
}

/** M10 unbox: the case rises in and tips forward (client navigation, Inspect open). Calm: a 180 ms fade. */
export function unbox(scene: HTMLElement, enter: HTMLElement) {
  if (motionLevel() === "calm") {
    scene.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    return;
  }
  scene.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], { duration: 1100, easing: "linear", fill: "backwards" });
  enter.animate(
    [
      { transform: "translate3d(0, 70px, -120px) rotateX(32deg) rotateY(-14deg)" },
      { transform: "translate3d(0, -6px, 10px) rotateX(-3deg) rotateY(3deg)", offset: 0.72 },
      { transform: "translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg)" },
    ],
    { duration: 1100, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
  );
}

/** M11 lift-in: cards inside dialogs and sheets settle into place after the dialog's 280 ms entrance. */
export function liftin(enter: HTMLElement) {
  if (motionLevel() === "calm") return;
  enter.animate(
    [{ transform: "translate3d(0, 0, -80px) rotateX(12deg)" }, { transform: "translate3d(0, 0, 0) rotateX(0deg)" }],
    { duration: 420, delay: 280, easing: "cubic-bezier(.34,1.36,.64,1)", fill: "backwards" },
  );
}
