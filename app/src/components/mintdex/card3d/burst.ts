/**
 * The burst behind a card (spec M12 to M15): a glow, 24 rays and a ring, WAAPI on transform and opacity only, in a
 * host mounted for the burst and clipped (inset -30%, overflow: clip). Sparks and confetti go to the lazy fx canvas.
 */
import type { Finish } from "../../../lib/mintdex/tiers";
import { motionLevel, onMotionLevel } from "./motion3d";
import type { TierLight } from "./types";

const C = "translate(-50%, -50%)";
const EASE_BURST = "cubic-bezier(.1,.8,.2,1)";

/** Mount the burst host behind the card (after the ground, before the 3D chain). Removes itself after `ms`. */
function host(scene: HTMLElement, ms: number) {
  if (motionLevel() === "calm") return null;
  const el = document.createElement("div");
  el.className = "mdx-card3d__fxb";
  el.setAttribute("aria-hidden", "true");
  const ground = scene.querySelector(":scope > .mdx-card3d__ground");
  scene.insertBefore(el, ground ? ground.nextSibling : scene.firstChild);
  let removed = false;
  let timer = 0;
  let stopWatching = () => {};
  const remove = () => {
    if (removed) return;
    removed = true;
    window.clearTimeout(timer);
    stopWatching();
    // Detached WAAPI effects may keep running; cancel them before discarding this decorative host.
    for (const animation of el.getAnimations({ subtree: true })) animation.cancel();
    el.remove();
  };
  stopWatching = onMotionLevel(() => {
    if (motionLevel() === "calm") remove();
  });
  timer = window.setTimeout(remove, ms);
  return el;
}

function bit(parent: HTMLElement, cls: string, bg: string) {
  const i = document.createElement("i");
  i.className = cls;
  i.style.background = bg;
  parent.appendChild(i);
  return i;
}

/**
 * The Ascend charge (F1): a soft radial disc in the ring color, 1.3W, peaking at .5 and gone by 380 ms, so it never
 * reads as a pale panel once the card turns edge-on.
 */
export function chargeGlow(scene: HTMLElement, tier: TierLight) {
  const h = host(scene, 420);
  if (!h) return;
  const g = bit(h, "mdx-fx-charge", `radial-gradient(closest-side, ${tier.ring} 0%, ${tier.ring}99 38%, transparent 72%)`);
  g.animate(
    [
      { opacity: 0, transform: `${C} scale(0.7)` },
      { opacity: 0.5, transform: `${C} scale(1)`, offset: 0.42 },
      { opacity: 0, transform: `${C} scale(1.08)` },
    ],
    { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
  );
}

/** Full burst (Ascend, mint reveal): glow, rays and ring. `rays` false gives the short burst (ring only). */
export function burst(scene: HTMLElement, tier: TierLight, { rays = true, glow = true }: { rays?: boolean; glow?: boolean } = {}) {
  const h = host(scene, 1500);
  if (!h) return;
  const s = tier.sheen.length > 1 ? tier.sheen : [tier.sheen[0], tier.ring, "#ffffff"];
  if (glow) {
    const g = bit(h, "mdx-fx-glow", `radial-gradient(closest-side, ${s[0]} 0%, ${s[2 % s.length]}88 35%, transparent 70%)`);
    g.animate(
      [
        { opacity: 0, transform: `${C} scale(0.4)` },
        { opacity: 0.95, transform: `${C} scale(1)`, offset: 0.25 },
        { opacity: 0, transform: `${C} scale(1.25)` },
      ],
      { duration: 1100, easing: EASE_BURST, fill: "forwards" },
    );
  }
  if (rays) {
    const stops: string[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i * 360) / 24;
      const c = s[i % s.length];
      stops.push(`transparent ${a}deg`, `${c} ${a + 4.5}deg`, `#fff ${a + 5.5}deg`, `${c} ${a + 6.5}deg`, `transparent ${a + 11}deg`);
    }
    const r = bit(h, "mdx-fx-rays", `conic-gradient(from 0deg, ${stops.join(",")})`);
    r.animate(
      [
        { opacity: 0, transform: `${C} scale(0.35) rotate(0deg)` },
        { opacity: 1, transform: `${C} scale(1) rotate(14deg)`, offset: 0.3 },
        { opacity: 0, transform: `${C} scale(1.35) rotate(38deg)` },
      ],
      { duration: 1300, easing: EASE_BURST, fill: "forwards" },
    );
  }
  const ring = bit(h, "mdx-fx-ring", "transparent");
  ring.style.boxShadow = `0 0 26px 6px ${s[1 % s.length]}, inset 0 0 18px 2px ${s[0]}`;
  ring.animate(
    [
      { opacity: 1, transform: `${C} scale(0.2)` },
      { opacity: 0, transform: `${C} scale(1.9)` },
    ],
    { duration: 800, easing: EASE_BURST, fill: "forwards" },
  );
}

/** Sparks per finish (M12): 20 for print to foil, 32 holo, 44 prism and gold. */
export function sparkCount(finish: Finish, short: boolean) {
  if (short) return 10;
  return finish === "prism" || finish === "gold" ? 44 : finish === "holo" ? 32 : 20;
}

/** Sparks from the card's center on the fx canvas (lazy chunk, loaded on first use). */
export function sparks(scene: HTMLElement, tier: TierLight, n: number) {
  const r = scene.getBoundingClientRect();
  const colors = [...tier.sheen, tier.ring, "#ffffff", "#fffefc"];
  void import("./fx").then((fx) =>
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, {
      n,
      colors,
      speed: Math.max(260, r.width * 1.6),
      life: 1.1,
      size: Math.max(4, r.width / 40),
      shape: ["star", "dot", "star"],
    }),
  );
}

/** Confetti from both bottom corners (M14), above dialogs. */
export function confetti(tier: TierLight) {
  void import("./fx").then((fx) => fx.confetti([...tier.sheen, tier.ring]));
}
