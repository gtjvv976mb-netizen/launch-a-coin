/**
 * Particles on one lazy fixed canvas (dynamic import on first use). Created on the first burst, removed when the
 * last particle dies. DPR capped at 1.5, at most 220 live particles, pointer-events none, above dialogs.
 * Never runs under calm (callers check; the canvas checks again).
 */
type Shape = "star" | "dot" | "rect" | "card";
type P = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  age: number;
  life: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: Shape;
  flip: number;
};

const MAX = 220;
let cv: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let parts: P[] = [];
let raf = 0;
let last = 0;
let dpr = 1;

function calm() {
  // Only the Calm motion switch stops it: full motion is the default, whatever the device's reduced motion setting.
  return document.documentElement.dataset.motion === "calm";
}

function size() {
  if (!cv || !ctx) return;
  dpr = Math.min(1.5, window.devicePixelRatio || 1);
  cv.width = Math.round(window.innerWidth * dpr);
  cv.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ensure() {
  if (cv) return;
  cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000";
  document.body.appendChild(cv);
  ctx = cv.getContext("2d");
  size();
  window.addEventListener("resize", size);
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.28 : r;
    const an = (i * Math.PI) / 4;
    c.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
  }
  c.closePath();
  c.fill();
  c.restore();
}

function clear() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  parts = [];
  window.removeEventListener("resize", size);
  cv?.remove();
  cv = null;
  ctx = null;
  last = 0;
}

function frame(now: number) {
  raf = 0;
  // Calm may be selected after a burst started. Canvas effects need the live check too.
  if (calm() || document.hidden || !cv || !ctx) {
    clear();
    return;
  }
  const c = ctx;
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  c.clearRect(0, 0, cv.width, cv.height);
  parts = parts.filter((p) => (p.age += dt) < p.life);
  for (const p of parts) {
    p.vx *= 1 - p.drag * dt;
    p.vy *= 1 - p.drag * dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const k = p.age / p.life;
    c.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    c.fillStyle = p.color;
    if (p.shape === "star") star(c, p.x, p.y, p.size * (1 - k * 0.4), p.rot);
    else if (p.shape === "dot") {
      c.beginPath();
      c.arc(p.x, p.y, p.size * 0.5 * (1 - k * 0.5), 0, 6.283);
      c.fill();
    } else if (p.shape === "card") {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(Math.cos(p.age * p.flip), 1);
      c.fillStyle = "#fffefc";
      c.fillRect(-p.size * 0.5, -p.size * 0.7, p.size, p.size * 1.4);
      c.fillStyle = p.color;
      c.fillRect(-p.size * 0.38, -p.size * 0.56, p.size * 0.76, p.size * 0.6);
      c.restore();
    } else {
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(1, Math.cos(p.age * p.flip));
      c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      c.restore();
    }
  }
  c.globalAlpha = 1;
  if (parts.length && !document.hidden) raf = requestAnimationFrame(frame);
  else clear();
}

function add(list: P[]) {
  if (calm() || document.hidden) return;
  ensure();
  parts.push(...list);
  if (parts.length > MAX) parts.splice(0, parts.length - MAX);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

const HOLO = ["#f6c6dd", "#f7eac2", "#c8f0de", "#c6e0f5", "#dccdf5", "#fffefc"];
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

export function burst(
  x: number,
  y: number,
  { n = 30, colors = HOLO, speed = 360, life = 1.1, size = 6, g = 380, shape = "star" as Shape | Shape[], drag = 2.2 } = {},
) {
  add(
    Array.from({ length: n }, () => {
      const an = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.65);
      return {
        x,
        y,
        vx: Math.cos(an) * sp,
        vy: Math.sin(an) * sp - speed * 0.2,
        g,
        drag,
        age: 0,
        life: life * (0.82 + Math.random() * 0.36),
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 10,
        size: size * (0.6 + Math.random() * 0.7),
        color: pick(colors),
        shape: Array.isArray(shape) ? pick(shape) : shape,
        flip: 6 + Math.random() * 8,
      };
    }),
  );
}

/** M14: 120 particles from both bottom corners, 1 in 9 a mini card, holo palette plus the tier sheen, 2.4 s. */
export function confetti(extra: string[] = [], only = false) {
  const H = window.innerHeight;
  const W = window.innerWidth;
  // `only`: the site's own celebration (a launch) throws just the palette it passes; card reveals keep the foil mix.
  const colors = only && extra.length ? extra : HOLO.concat(["#c2307f", "#2f6fd0", "#0f8a68", "#ffd36b"], extra);
  const list: P[] = [];
  for (const side of [0, 1]) {
    for (let i = 0; i < 60; i++) {
      const an = side ? -Math.PI * (0.62 + Math.random() * 0.16) : -Math.PI * (0.22 + Math.random() * 0.16);
      const sp = 900 + Math.random() * 700;
      list.push({
        x: side ? W - 20 : 20,
        y: H - 20,
        vx: Math.cos(an) * sp,
        vy: Math.sin(an) * sp,
        g: 900,
        drag: 1.6,
        age: 0,
        life: 2.1 + Math.random() * 0.5,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        size: 8 + Math.random() * 7,
        color: pick(colors),
        shape: i % 9 === 0 ? "card" : i % 4 === 0 ? "star" : "rect",
        flip: 5 + Math.random() * 9,
      });
    }
  }
  add(list);
}
