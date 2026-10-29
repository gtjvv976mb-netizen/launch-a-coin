/**
 * The big bursts (hype arcade), a lazy chunk: a design unlock (tier up) or a launch fills the screen for a moment
 * with a flash, a shockwave ring, a burst of sparks and confetti in that design's colors. Transform and opacity
 * only (WAAPI) plus the shared particle canvas (card3d/fx.ts); every node removes itself. Never under the Calm
 * motion switch (the device's reduced motion setting alone no longer stops it), never in a hidden tab.
 */
import { tierForLevel } from "../../lib/mintdex/tiers";

function calm() {
  return document.hidden || document.documentElement.dataset.motion === "calm";
}

/** The site palette's exhibition light (carddex-theme.css --light-1 to --light-5: lit gold, antique gold, ivory,
 *  card red, bronze), read at run time so the canvas paints the same colours the sheets do. */
function lights(...n: number[]): string[] {
  const css = getComputedStyle(document.documentElement);
  return n.map((i) => css.getPropertyValue(`--light-${i}`).trim()).filter(Boolean);
}

/** The design's burst palette: its sheen, its ring, plus the site's gold where the sheen is plain white. */
export function tierColors(level: number): string[] {
  const t = tierForLevel(level);
  const sheen = t.sheen.filter((c) => c.toUpperCase() !== "#FFFFFF");
  const base = sheen.length ? sheen : lights(1, 2);
  return [...base, t.ring, ...lights(3)];
}

function node(css: string) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:fixed;pointer-events:none;z-index:2147482990;${css}`;
  document.body.appendChild(el);
  return el;
}

function done(el: HTMLElement, a: Animation) {
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
  window.setTimeout(() => el.remove(), 4000);
}

/**
 * The burst itself at (x, y) (screen px): a flash of the palette over the page, a ring, two waves of sparks and,
 * when `confetti`, confetti from both bottom corners. `label` pops a short line over the flash.
 */
let lastAt = 0;

export function bigBurst(
  colors: string[],
  at?: { x: number; y: number },
  opts: { confetti?: boolean; label?: string; paletteOnly?: boolean } = {},
) {
  if (typeof window === "undefined" || calm()) return;
  // One at a time: two unlocks landing together play one burst.
  const now = performance.now();
  if (now - lastAt < 1500) return;
  lastAt = now;
  const x = at?.x ?? window.innerWidth / 2;
  const y = at?.y ?? window.innerHeight * 0.42;
  const [c1, c2 = c1, c3 = c2] = colors;

  const flash = node(
    `inset:0;opacity:0;mix-blend-mode:screen;background:radial-gradient(circle at ${x}px ${y}px, ${c1}cc 0%, ${c2}66 18%, ${c3}22 42%, transparent 66%)`,
  );
  done(
    flash,
    flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], {
      duration: 900,
      easing: "cubic-bezier(.2,.8,.2,1)",
      fill: "forwards",
    }),
  );

  for (const [i, c] of [c1, c2].entries()) {
    const ring = node(
      `left:${x - 40}px;top:${y - 40}px;width:80px;height:80px;border-radius:50%;border:3px solid ${c};box-shadow:0 0 24px ${c},inset 0 0 18px ${c};opacity:0`,
    );
    done(
      ring,
      ring.animate(
        [
          { opacity: 0.95, transform: "scale(0.3)" },
          { opacity: 0, transform: `scale(${i ? 9 : 14})` },
        ],
        {
          duration: i ? 1100 : 900,
          delay: i * 140,
          easing: "cubic-bezier(.1,.8,.2,1)",
          fill: "forwards",
        },
      ),
    );
  }

  if (opts.label) {
    const lab = node(
      `left:0;right:0;top:${Math.max(24, y - 120)}px;text-align:center;font:700 clamp(28px,5vw,56px)/1 var(--font-sans);font-stretch:78%;letter-spacing:-0.01em;color:#fff;text-shadow:0 0 18px ${c1},0 0 42px ${c2};opacity:0`,
    );
    lab.textContent = opts.label;
    done(
      lab,
      lab.animate(
        [
          { opacity: 0, transform: "translateY(16px) scale(0.7)" },
          { opacity: 1, transform: "translateY(0) scale(1.06)", offset: 0.22 },
          { opacity: 1, transform: "translateY(-4px) scale(1)", offset: 0.7 },
          { opacity: 0, transform: "translateY(-18px) scale(1)" },
        ],
        { duration: 1800, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      ),
    );
  }

  void import("./card3d/fx").then((fx) => {
    const palette = [...colors, ...lights(3)];
    fx.burst(x, y, {
      n: 64,
      colors: palette,
      speed: 820,
      life: 1.5,
      size: 9,
      g: 520,
      shape: ["star", "rect", "dot"],
      drag: 1.6,
    });
    window.setTimeout(
      () =>
        fx.burst(x, y, {
          n: 40,
          colors: palette,
          speed: 480,
          life: 1.3,
          size: 7,
          g: 300,
          shape: "star",
        }),
      160,
    );
    if (opts.confetti) fx.confetti(palette, opts.paletteOnly);
  });
}

/** A design unlock: the big burst in that design's colors, with its name. */
export function tierBurst(level: number, at?: { x: number; y: number }) {
  const t = tierForLevel(level);
  bigBurst(tierColors(level), at, { confetti: level >= 7, label: `${t.name} unlocked` });
}

/** After a successful launch: confetti in the site's own gold, cream and card red only (carddex-theme.css --light-*),
 *  no foil pastels. */
export function launchBurst(at?: { x: number; y: number }) {
  bigBurst(lights(1, 2, 3, 4, 5), at, { confetti: true, paletteOnly: true });
}

/**
 * D1's launch spark (Higgsfield spark-burst.mp4: a 3-second gold burst on black, 16:9, no audio): played once,
 * screen-blended over the new card on a launch's success state (demo and live), then removed. Never on load (callers
 * fire it on the success transition only), never under Calm motion or the device's reduced-motion setting (unless the
 * visitor chose full motion), never in a hidden tab.
 */
export function sparkBurst(target: Element | null | undefined) {
  if (typeof window === "undefined" || !target || calm()) return;
  const root = document.documentElement;
  if (root.dataset.motion || (window.matchMedia("(prefers-reduced-motion: reduce)").matches && root.dataset.motionPref !== "full")) return;
  const card = target.matches(".mdx-card") ? target : (target.querySelector(".mdx-card") ?? target);
  const r = card.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const w = Math.max(r.width, r.height) * 1.9;
  const h = (w * 9) / 16;
  const v = document.createElement("video");
  v.className = "mdx-spark";
  v.setAttribute("aria-hidden", "true");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.disablePictureInPicture = true;
  v.style.cssText = `left:${r.left + r.width / 2 - w / 2}px;top:${r.top + r.height / 2 - h / 2}px;width:${w}px;height:${h}px;`;
  v.src = "/assets/site/d1/spark-burst.mp4";
  const remove = () => v.remove();
  v.addEventListener("ended", remove, { once: true });
  v.addEventListener("error", remove, { once: true });
  window.setTimeout(remove, 5000);
  document.body.appendChild(v);
  v.play().catch(remove);
}

/** The center of an element on screen (for a burst from a card). */
export function centerOf(el: Element | null | undefined): { x: number; y: number } | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (!r.width) return undefined;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
