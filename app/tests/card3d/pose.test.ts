// The 3D card's pure state logic (refs/alive-3d-spec.md section 13): spring settle, side from angle, the light
// formula, wall counts, deterministic float phases, the ground rule (F4), idle shapes, and the copy rule for the
// card's own files.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { CARD_BOX, paintEdge, spinEye, wallFacesEye, walls, type Wall } from "../../src/components/mintdex/card3d/extrude";
import { edgeFill, TEMPLATE_KEYS, TEMPLATES, templateStyle } from "../../src/components/mintdex/card3d/templates";
import {
  backFacing,
  blendLight,
  breathe,
  CALM_REST_K,
  fanPose,
  fanVars,
  floatPhase,
  groundFromPose,
  HAND_REST,
  hashSeed,
  LIT_FLOOR,
  lightFromPose,
  litFloor,
  orbitLight,
  peekAmount,
  restAngle,
  restLight,
  sideFromAngle,
  STILL_LIGHT,
  TABLE_REST,
  turnLightX,
} from "../../src/components/mintdex/card3d/light";
import {
  classifyFrames,
  SPRINGS,
  Spring,
  stepSprings,
} from "../../src/components/mintdex/card3d/motion3d";
import { ambientLight, shimmerLight, TABLE_LIGHT_MAX } from "../../src/components/mintdex/card3d/tablelight";

/** Run a spring at 60 Hz from x to target; returns the settle time (s) and the peak overshoot (fraction). */
function settle(kc: readonly [number, number], from: number, to: number, dt = 1 / 60) {
  const s = new Spring(from, kc[0], kc[1]);
  s.t = to;
  let t = 0;
  let peak = 0;
  const span = Math.abs(to - from);
  while (t < 5) {
    stepSprings([s], dt);
    t += dt;
    peak = Math.max(peak, (s.x - to) * Math.sign(to - from));
    // Settled: within 1% of the span and nearly still (what the eye reads as landed).
    if (Math.abs(s.x - to) < span * 0.01 && Math.abs(s.v) < span * 0.05) break;
  }
  return { t, overshoot: peak / span };
}

describe("springs (spec 4.9)", () => {
  test("turnover flip (k52 c12.6) lands a half turn in about 0.7 to 1 s without a visible overshoot", () => {
    const r = settle(SPRINGS.flip, 0, 180);
    expect(r.t).toBeGreaterThan(0.6);
    expect(r.t).toBeLessThan(1.1);
    expect(r.overshoot).toBeLessThan(0.05);
  });

  test("the Ascend landing (k120 c11) bounces once", () => {
    const r = settle(SPRINGS.landing, 80, 0);
    expect(r.overshoot).toBeGreaterThan(0.05);
    expect(r.overshoot).toBeLessThan(0.3);
  });

  test("the turntable (k34 c10.2) is slower than the turnover and still settles a full turn", () => {
    const turn = settle(SPRINGS.turntable, 0, 360);
    const flip = settle(SPRINGS.flip, 0, 360);
    expect(turn.t).toBeGreaterThan(flip.t);
    expect(turn.t).toBeLessThan(2.4);
  });

  test("the short flip (Ascend short, Print) is the quickest full turn", () => {
    const short = settle(SPRINGS.short, 0, 360);
    for (const kc of [SPRINGS.flip, SPRINGS.ascend, SPRINGS.turntable])
      expect(short.t).toBeLessThan(settle(kc, 0, 360).t);
  });

  test("dt is clamped and substepped: 30 Hz and 120 Hz land within a frame of 60 Hz", () => {
    const a = settle(SPRINGS.flip, 0, 180, 1 / 60).t;
    const b = settle(SPRINGS.flip, 0, 180, 1 / 120).t;
    const c = settle(SPRINGS.flip, 0, 180, 1 / 30).t;
    expect(Math.abs(a - b)).toBeLessThan(0.06);
    expect(Math.abs(a - c)).toBeLessThan(0.09);
  });

  test("a long frame (a hitch) never makes the spring explode", () => {
    const s = new Spring(0, SPRINGS.flip[0], SPRINGS.flip[1]);
    s.t = 180;
    for (let i = 0; i < 90; i++) stepSprings([s], 0.5);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x - 180)).toBeLessThan(1);
  });
});

describe("side from angle", () => {
  test("even half turns show the face, odd ones the back, either direction", () => {
    expect(sideFromAngle(0)).toBe("face");
    expect(sideFromAngle(180)).toBe("back");
    expect(sideFromAngle(360)).toBe("face");
    expect(sideFromAngle(-180)).toBe("back");
    expect(sideFromAngle(540)).toBe("back");
    expect(sideFromAngle(720)).toBe("face");
    expect(sideFromAngle(-360)).toBe("face");
  });

  test("the staged face swaps only while the back faces the viewer (cos Y < -0.3)", () => {
    expect(backFacing(0)).toBe(false);
    expect(backFacing(100)).toBe(false);
    expect(backFacing(120)).toBe(true);
    expect(backFacing(180)).toBe(true);
    expect(backFacing(265)).toBe(false);
    expect(backFacing(-180)).toBe(true);
  });
});

describe("the light (spec 4.6)", () => {
  test("a full rotation never parks the foil for a broad range of angles", () => {
    const samples = Array.from({ length: 721 }, (_, angle) => lightFromPose(6, 0, angle, 0).px.toFixed(3));
    let longest = 0;
    let run = 0;
    for (let i = 1; i < samples.length; i++) {
      run = samples[i] === samples[i - 1] ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // Rounded sine extrema can hold a few degrees; the old amplified clamp held for 143 degrees.
    expect(longest).toBeLessThanOrEqual(6);
    expect(Number(samples[45]) - Number(samples[30])).toBeGreaterThan(0.05);
    expect(Number(samples[60]) - Number(samples[45])).toBeGreaterThan(0.05);
  });

  test("whole turns retain local tilt sensitivity and the mirrored back response", () => {
    for (const gain of [2, 3.2]) for (const lean of [-40, -20, -10, 0, 10, 20, 40]) {
      const rest = 0.5 + 0.5 * Math.max(-1, Math.min(1, Math.sin(lean * Math.PI / 180) * gain));
      expect(turnLightX(lean, 0, gain)).toBeCloseTo(rest, 9);
      expect(turnLightX(lean, 180, gain)).toBeCloseTo(1 - rest, 9);
    }
  });

  test("the light stays finite and continuous across reverse turns, wrapping and local saturation", () => {
    for (const lean of [-40, -10, 0, 14, 40]) for (let angle = -720; angle <= 720; angle += 5) {
      const px = turnLightX(lean, angle);
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThanOrEqual(1);
      expect(turnLightX(lean, angle + 360)).toBeCloseTo(px, 9);
    }
    expect(turnLightX(10, 359.999)).toBeCloseTo(turnLightX(10, -0.001), 9);
    const limit = Math.asin(1 / 3.2) * 180 / Math.PI;
    for (const angle of [0, 45, 90, 180, 270]) {
      expect(Math.abs(turnLightX(limit - 0.000001, angle) - turnLightX(limit + 0.000001, angle))).toBeLessThan(0.001);
    }
  });

  test("a card at rest is lit evenly and not catching", () => {
    const l = lightFromPose(0, 0, 0, 7);
    expect(l.px).toBeCloseTo(0.5, 6);
    expect(l.py).toBeCloseTo(0.5, 6);
    expect(l.lit).toBeCloseTo(0, 6);
  });

  test("turning right moves the light right; tilting back moves it up", () => {
    const r = lightFromPose(0, 10, 0, 7);
    expect(r.px).toBeCloseTo(0.5 + 0.5 * Math.sin((10 * Math.PI) / 180) * 3.2, 6);
    expect(r.py).toBeCloseTo(0.5, 6);
    const up = lightFromPose(5, 0, 0, 7);
    expect(up.py).toBeLessThan(0.5);
    expect(up.lit).toBeGreaterThan(0);
  });

  test("values stay in range and lit saturates at 1", () => {
    for (const [rx, ry, f] of [
      [40, 40, 0],
      [-40, -40, 0],
      [0, 0, 90],
      [10, 15, 270],
    ]) {
      const l = lightFromPose(rx, ry, f, 7);
      expect(l.px).toBeGreaterThanOrEqual(0);
      expect(l.px).toBeLessThanOrEqual(1);
      expect(l.py).toBeGreaterThanOrEqual(0);
      expect(l.py).toBeLessThanOrEqual(1);
      expect(l.lit).toBeLessThanOrEqual(1);
    }
  });

  test("a flip sweeps the light across and the arc leans the card edge-on", () => {
    const edge = lightFromPose(0, 0, 90, 7);
    expect(edge.px).toBeCloseTo(1, 6);
    expect(edge.X).toBeCloseTo(7, 6);
    const back = lightFromPose(0, 0, 180, 7);
    expect(back.px).toBeCloseTo(0.5, 6);
    expect(back.X).toBeCloseTo(0, 6);
  });

  test("a settling table card hands back exactly the CSS still light (lit at rest, owner override)", () => {
    const live = lightFromPose(6, -9, 0, 7);
    expect(blendLight(live, 0)).toEqual({
      px: STILL_LIGHT.px,
      py: STILL_LIGHT.py,
      lit: STILL_LIGHT.lit,
    });
    expect(STILL_LIGHT.lit).toBeGreaterThan(0);
    const full = blendLight(live, 1);
    expect(full.px).toBeCloseTo(live.px, 9);
    expect(full.lit).toBeCloseTo(live.lit, 9);
  });

  test("a card blends from its own rest light, not only the still light", () => {
    const rest = restLight(TABLE_REST);
    const live = lightFromPose(6, 12, 0, 7);
    expect(blendLight(live, 0, rest)).toEqual(rest);
    expect(blendLight(live, 0.5, rest).px).toBeCloseTo((rest.px + live.px) / 2, 9);
  });

  test("the light never drops below the floor on a posed card", () => {
    expect(litFloor(0)).toBe(LIT_FLOOR);
    expect(litFloor(0.9)).toBeCloseTo(0.9, 9);
    expect(litFloor(2)).toBe(1);
  });
});

/** The fallback number a CSS custom property declaration carries: `--rest-px: var(--hand-px, 0.222);`. */
function cssFallback(css: string, selector: string, prop: string): number {
  // The selector may head several blocks: read the one that declares the property.
  const re = new RegExp(`${prop}: var\\(--[a-z-]+, (-?[0-9.]+)\\);`);
  for (
    let at = css.indexOf(`\n${selector} {`);
    at >= 0;
    at = css.indexOf(`\n${selector} {`, at + 1)
  ) {
    const m = re.exec(css.slice(at, css.indexOf("}", at)));
    if (m) return Number(m[1]);
  }
  throw new Error(`${selector} declares no ${prop} fallback`);
}
/** A plain number declaration in a block: `--hand-px: 0.778;`. */
function cssNumber(css: string, selector: string, prop: string): number {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  const m = new RegExp(`${prop}: (-?[0-9.]+);`).exec(block);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe("the rest pose (owner override 2026-10-11)", () => {
  const card3d = fs.readFileSync(path.resolve(import.meta.dir, "../../src/card3d.css"), "utf8");
  const alive = fs.readFileSync(path.resolve(import.meta.dir, "../../src/alive.css"), "utf8");

  test("hand cards lean back and turn; the light they catch is lit well above the floor", () => {
    expect(HAND_REST).toEqual({ rx: 5, ry: -10 });
    const l = restLight(HAND_REST);
    expect(l.px).toBeLessThan(0.5);
    expect(l.py).toBeLessThan(0.5);
    expect(l.lit).toBeGreaterThan(0.6);
  });

  test("card3d.css fallbacks are the rest poses' own light and angle (hand and table)", () => {
    for (const [sel, pose] of [
      ['.mdx-card3d[data-depth="hand"]', HAND_REST],
      [".mdx-card3d", TABLE_REST],
    ] as const) {
      const l = restLight(pose);
      expect(cssFallback(card3d, sel, "--rest-rx")).toBe(pose.rx);
      expect(cssFallback(card3d, sel, "--rest-ry")).toBe(pose.ry);
      expect(cssFallback(card3d, sel, "--rest-a")).toBeCloseTo(restAngle(pose), 2);
      expect(cssFallback(card3d, sel, "--rest-px")).toBeCloseTo(l.px, 3);
      expect(cssFallback(card3d, sel, "--rest-py")).toBeCloseTo(l.py, 3);
      expect(cssFallback(card3d, sel, "--rest-lit")).toBeCloseTo(l.lit, 3);
    }
  });

  test("every page's own lean carries its own light and angle (alive.css, the phone hero, Inspect)", () => {
    const cases: Array<[string, string, string]> = [
      [alive, ".mdx-tt", "hand"],
      [alive, ".mdx-casehost", "hand"],
      [alive, ".mdx-cf__center", "hand"],
      [card3d, ".mdx-inspect__stage", "hand"],
      [card3d, ".mdx-card3d.mdx-card3d--hero", "fan"],
    ];
    for (const [css, sel, k] of cases) {
      const start = css.indexOf(`${sel} {`);
      const block = css.slice(start, css.indexOf("}", start));
      const num = (p: string, d: number) => {
        const m = new RegExp(`--${k}-${p}: (-?[0-9.]+);`).exec(block);
        return m ? Number(m[1]) : d;
      };
      const pose = {
        rx: num("rx", k === "hand" ? HAND_REST.rx : TABLE_REST.rx),
        ry: num("ry", k === "hand" ? HAND_REST.ry : TABLE_REST.ry),
      };
      const l = restLight(pose);
      expect({ sel, a: num("a", restAngle(pose)) }).toEqual({ sel, a: restAngle(pose) });
      expect({ sel, px: num("px", l.px) }).toEqual({ sel, px: l.px });
      expect({ sel, py: num("py", l.py) }).toEqual({ sel, py: l.py });
      expect({ sel, lit: num("lit", l.lit) }).toEqual({ sel, lit: l.lit });
    }
    expect(cssNumber(alive, ".mdx-tt", "--hand-ry")).toBeGreaterThan(0);
  });

  test("calm keeps the pose but never past 6 degrees on an axis", () => {
    expect(Math.abs(HAND_REST.rx * CALM_REST_K)).toBeLessThanOrEqual(6);
    expect(Math.abs(HAND_REST.ry * CALM_REST_K)).toBeLessThanOrEqual(6);
    expect(card3d).toContain(`--rest-k: ${CALM_REST_K};`);
    // Calm animates nothing: every ambient loop sits behind a :root:not(calm) guard (no media query any more).
    for (const name of ["mdx-sway", "mdx-glint", "mdx-pulse"]) {
      for (const m of card3d.matchAll(new RegExp(`animation: ${name}\\b`, "g"))) {
        const before = card3d.slice(0, m.index);
        const line = before.slice(before.lastIndexOf("\n"));
        expect({
          name,
          guarded: /not\(\[data-motion="calm"\]\)/.test(
            line + card3d.slice(m.index - 400, m.index),
          ),
        }).toEqual({ name, guarded: true });
      }
    }
  });

  test("a resting card is one flat layer: no will-change on the light layers", () => {
    expect(card3d).not.toMatch(/__holo2[^{]*\{\s*will-change/);
    expect(card3d).not.toMatch(/will-change: opacity/);
  });
});

describe("the table fan", () => {
  test("columns face the shelf's middle, every card leaned back", () => {
    for (const cols of [2, 3, 4, 5]) {
      const ry = Array.from({ length: cols }, (_, i) => fanPose(i, cols).ry);
      expect(ry.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
      expect(ry[0]).toBeGreaterThan(0);
      expect(ry[cols - 1]).toBeLessThan(0);
      for (let i = 1; i < cols; i++) expect(ry[i]).toBeLessThan(ry[i - 1]);
      for (let i = 0; i < cols; i++) expect(fanPose(i, cols).rx).toBe(TABLE_REST.rx);
    }
    expect(fanPose(0, 1)).toEqual({ rx: TABLE_REST.rx, ry: 0 });
    expect(Object.is(fanPose(1, 3).ry, -0)).toBe(false);
  });

  test("the fan stays within the calm cap per axis (6 degrees) up to four columns", () => {
    for (let i = 0; i < 4; i++) expect(Math.abs(fanPose(i, 4).ry)).toBeLessThanOrEqual(6);
  });

  test("a cell's CSS vars are deterministic (server and client agree) and carry the pose's light", () => {
    const v = fanVars(0, 4);
    expect(fanVars(0, 4)).toEqual(v);
    const l = restLight(fanPose(0, 4));
    expect(Number(v["--fan-px"])).toBe(l.px);
    expect(Number(v["--fan-lit"])).toBe(l.lit);
    expect(Number(v["--fan-a"])).toBeCloseTo(Math.hypot(5, 6), 3);
    expect(Object.keys(v).sort()).toEqual([
      "--fan-a",
      "--fan-lit",
      "--fan-px",
      "--fan-py",
      "--fan-rx",
      "--fan-ry",
    ]);
  });
});

describe("the light's motion", () => {
  test("the idle orbit circles inside its amplitudes and really moves", () => {
    let minX = 1;
    let maxX = -1;
    for (let t = 0; t < 20; t += 0.1) {
      const o = orbitLight(t);
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(Math.abs(o.dy)).toBeLessThanOrEqual(0.12 + 1e-9);
      expect(Math.abs(o.dl)).toBeLessThanOrEqual(0.12 + 1e-9);
      minX = Math.min(minX, o.dx);
      maxX = Math.max(maxX, o.dx);
    }
    expect(maxX - minX).toBeGreaterThan(0.35);
  });

  test("the ambient holo drift (hype arcade) keeps moving and stays on the card", () => {
    const rest = restLight(TABLE_REST);
    let minX = 1;
    let maxX = 0;
    for (let t = 0; t <= 12; t += 0.05) {
      for (const ph of [0, 0.37, 0.81]) {
        const l = ambientLight(rest, t, ph);
        for (const v of [l.px, l.py]) {
          expect(v).toBeGreaterThanOrEqual(0.02);
          expect(v).toBeLessThanOrEqual(0.98);
        }
        expect(l.lit).toBeGreaterThanOrEqual(0);
        expect(l.lit).toBeLessThanOrEqual(1);
        if (ph === 0) {
          minX = Math.min(minX, l.px);
          maxX = Math.max(maxX, l.px);
        }
      }
    }
    expect(maxX - minX).toBeGreaterThan(0.3);
    expect(ambientLight(rest, 3, 0.2)).toEqual(ambientLight(rest, 3, 0.2));
  });

  test("the scroll shimmer starts exactly at the rest light and stays on the card", () => {
    const rest = restLight(TABLE_REST);
    expect(shimmerLight(rest, 0)).toEqual(rest);
    let moved = 0;
    for (let d = -3; d <= 3; d += 0.05) {
      const l = shimmerLight(rest, d, { x: Math.sin(d), y: Math.cos(d) });
      for (const v of [l.px, l.py]) {
        expect(v).toBeGreaterThanOrEqual(0.02);
        expect(v).toBeLessThanOrEqual(0.98);
      }
      expect(l.lit).toBeLessThanOrEqual(1);
      moved = Math.max(moved, Math.abs(l.px - rest.px));
    }
    expect(moved).toBeGreaterThan(0.25);
    expect(TABLE_LIGHT_MAX).toBeLessThanOrEqual(8);
  });
});

describe("the watchdog (owner override 2026-10-11)", () => {
  const steady = (ms: number, n = 90) =>
    Array.from({ length: n }, (_, i) => ms + ((i % 3) - 1) * 0.3);

  test("a 60 Hz window is good, a steady 30 Hz one (Low Power Mode) is only capped", () => {
    expect(classifyFrames(steady(16.7))).toBe("good");
    expect(classifyFrames(steady(33.3))).toBe("capped");
    expect(classifyFrames([])).toBe("good");
  });

  test("an uneven slow window is bad, and past the 40 ms floor even a steady one is bad", () => {
    const uneven = Array.from({ length: 90 }, (_, i) => (i % 2 ? 18 : 40));
    expect(classifyFrames(uneven)).toBe("bad");
    expect(classifyFrames(steady(26))).toBe("bad");
    expect(classifyFrames(steady(45))).toBe("bad");
  });

  test("the lite drop is never sticky: no sessionStorage write in the engine", () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dir, "../../src/components/mintdex/card3d/motion3d.ts"),
      "utf8",
    );
    expect(src).not.toContain("sessionStorage.setItem");
  });
});

describe("the finish ladder (owner override 2026-10-11)", () => {
  const card3d = fs.readFileSync(path.resolve(import.meta.dir, "../../src/card3d.css"), "utf8");
  const tiers = [
    "spark",
    "surge",
    "nova",
    "tide",
    "apex",
    "ember",
    "bloom",
    "mythic",
    "aurora",
    "relic",
    "frost",
    "regal",
    "celestial",
    "legend",
  ];

  test("every one of the 14 designs has its own holo rainbow, rim and 3D template", () => {
    for (const t of tiers) {
      expect({
        t,
        rainbow: card3d.includes(`.mdx-card[data-tier="${t}"] .mdx-card__rainbow {`),
      }).toEqual({ t, rainbow: true });
      expect({
        t,
        rim: card3d.includes(`.mdx-card[data-tier="${t}"] .mdx-card__rim::before {`),
      }).toEqual({ t, rim: true });
      expect({ t, template: !!TEMPLATES[t as keyof typeof TEMPLATES] }).toEqual({ t, template: true });
    }
  });

  test("the pearl rungs stay soft (no color-dodge on I to III)", () => {
    for (const t of ["spark", "surge", "nova"]) {
      const start = card3d.indexOf(`.mdx-card[data-tier="${t}"] {`);
      const block = card3d.slice(start, card3d.indexOf("}", start));
      expect({ t, soft: /--h-blend: (soft-light|overlay);/.test(block) }).toEqual({
        t,
        soft: true,
      });
    }
  });

  test("the cut edge is painted in the design's template material, shaded by the room light", () => {
    const front = paintEdge(-0.55, -0.83);
    const back = paintEdge(0.55, 0.83);
    expect(front).toContain("var(--edge-fill");
    expect(front).not.toEqual(back);
  });
});

describe("the 14 card templates (owner 2026-10-17)", () => {
  test("one template per design, in ladder order", () => {
    expect(TEMPLATE_KEYS).toHaveLength(14);
    expect(Object.keys(TEMPLATES).sort()).toEqual([...TEMPLATE_KEYS].sort());
  });
  test("the edge climbs the ladder: card stock, lacquer, brushed metal, polished gold", () => {
    expect(TEMPLATES.spark.edge.material).toBe("stock");
    expect(TEMPLATES.surge.edge.material).toBe("stock");
    expect(TEMPLATES.tide.edge.material).toBe("lacquer");
    expect(TEMPLATES.frost.edge.material).toBe("brushed");
    expect(TEMPLATES.legend.edge.material).toBe("polished");
    const order = ["stock", "lacquer", "brushed", "polished"];
    let last = 0;
    for (const k of TEMPLATE_KEYS) {
      const i = order.indexOf(TEMPLATES[k].edge.material);
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
    // Every design wears its own edge and its own back.
    expect(new Set(TEMPLATE_KEYS.map((k) => edgeFill(TEMPLATES[k].edge))).size).toBe(14);
    expect(new Set(TEMPLATE_KEYS.map((k) => TEMPLATES[k].back.field)).size).toBe(14);
    expect(new Set(TEMPLATE_KEYS.map((k) => TEMPLATES[k].back.motif)).size).toBe(14);
  });
  test("the holo rung and the glow climb with the design", () => {
    const rungs = ["sheen", "holo", "cosmos", "radiant", "secret", "gold"];
    let r = 0;
    let g = 0;
    for (const k of TEMPLATE_KEYS) {
      const t = TEMPLATES[k];
      expect(rungs.indexOf(t.holo)).toBeGreaterThanOrEqual(r);
      expect(t.glow.k).toBeGreaterThan(g);
      r = rungs.indexOf(t.holo);
      g = t.glow.k;
    }
  });
  test("templateStyle sets the scene's edge, back and glow variables", () => {
    const st = templateStyle("legend") as Record<string, unknown>;
    for (const v of ["--e1", "--e2", "--core", "--e3", "--edge-fill", "--edge-shine", "--bk-field", "--bk-ink", "--bk-motif", "--bk-foil", "--glow", "--glow-k"]) {
      expect({ v, set: st[v] !== undefined }).toEqual({ v, set: true });
    }
  });
});

describe("one solid thin slab (owner 2026-10-17)", () => {
  const card3d = fs.readFileSync(path.resolve(import.meta.dir, "../../src/card3d.css"), "utf8");
  const block = (sel: string) => {
    const start = card3d.indexOf(`${sel} {`);
    expect({ sel, found: start >= 0 }).toEqual({ sel, found: true });
    return card3d.slice(start, card3d.indexOf("}", start));
  };
  test("the slab is thin: about 1.3% of the card width", () => {
    const m = block(".mdx-card3d__pose").match(/--t: max\((\d+)px, ([\d.]+)cqw\)/);
    expect(m).not.toBeNull();
    const pct = Number(m![2]);
    expect(pct).toBeGreaterThanOrEqual(1);
    expect(pct).toBeLessThanOrEqual(1.5);
  });
  test("no depth layers: no slab planes, no parked side wall, no wall/slab switch, no art parallax", () => {
    for (const gone of [".mdx-card3d__slab", "data-walls", "data-flat", ".mdx-card3d__spine"]) {
      expect({ gone, found: card3d.includes(gone) }).toEqual({ gone, found: false });
    }
    expect(block(".mdx-card__art img")).not.toContain("transform");
  });
  test("the cut edge follows rounded corners rather than filling their cutouts", () => {
    const { w, h, r } = CARD_BOX;
    for (const seg of [1, 2, 3]) {
      for (const wall of walls(CARD_BOX, seg)) {
        const x = wall.left + wall.len / 2;
        // Straight long sides stop at the corner tangent, on both ends.
        if (Math.abs(wall.nx) > 0.999 && Math.abs(wall.ny) < 0.001) {
          expect(wall.top - wall.len / 2).toBeCloseTo(r, 6);
          expect(wall.top + wall.len / 2).toBeCloseTo(h - r, 6);
        }
        // Every chord midpoint stays inside the rounded outline of the front/back planes.
        const dx = Math.max(r - x, 0, x - (w - r));
        const dy = Math.max(r - wall.top, 0, wall.top - (h - r));
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(r + 1e-6);
      }
    }
  });
  test("nothing inside the face is lifted off its plane", () => {
    // Every rule that targets the face's own parts (.mdx-card__*) stays in the plane: no translateZ, no 3D.
    const rules = card3d.split("}").filter((r) => /\.mdx-card__[a-z]/.test(r.split("{")[0] ?? ""));
    for (const r of rules) {
      const body = r.split("{")[1] ?? "";
      expect({ sel: r.split("{")[0].trim().slice(0, 80), z: /translateZ|translate3d|preserve-3d|rotate[XY]\(/.test(body) }).toEqual({
        sel: r.split("{")[0].trim().slice(0, 80),
        z: false,
      });
    }
  });
});

describe("thickness (spec 4.7)", () => {
  test("wall counts per corner segments: viewer 16, hand and case card 12, table 8", () => {
    expect(walls(CARD_BOX, 3)).toHaveLength(16);
    expect(walls(CARD_BOX, 2)).toHaveLength(12);
    expect(walls(CARD_BOX, 1)).toHaveLength(8);
    expect(walls({ x: -4, y: -25.5, w: 108, h: CARD_BOX.h + 29.5, r: 6 }, 4)).toHaveLength(20);
  });

  test("the walls close the rounded outline (their lengths add up to its perimeter)", () => {
    const { w, h, r } = CARD_BOX;
    const perimeter = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
    const sum = walls(CARD_BOX, 4).reduce((s, wl) => s + wl.len, 0);
    expect(sum).toBeGreaterThan(perimeter * 0.995);
    expect(sum).toBeLessThanOrEqual(perimeter + 1e-6);
  });

  test("every wall's outward normal points away from the card's center", () => {
    const cx = CARD_BOX.w / 2;
    const cy = CARD_BOX.h / 2;
    for (const wl of walls(CARD_BOX, 4)) {
      const mx = wl.left + wl.len / 2;
      expect((mx - cx) * wl.nx + (wl.top - cy) * wl.ny).toBeGreaterThan(0);
    }
  });
});

describe("rounded spinner wall visibility", () => {
  test("the local camera follows normal and cardinal views, including repeated turns", () => {
    const unit = 264 / 100;
    for (const [turn, x] of [[0, 0], [90, -640 / unit], [180, 0], [270, 640 / unit], [360, 0], [-90, 640 / unit]]) {
      const eye = spinEye(0, turn, 264);
      expect(eye[0]).toBeCloseTo(x, 10);
      expect(eye[1]).toBeCloseTo(0, 10);
    }
    const pitched = spinEye(30, 0, 264);
    expect(pitched[0]).toBeCloseTo(0, 10);
    expect(pitched[1]).toBeCloseTo(320 / unit, 10);
    expect(spinEye(30, 360, 264)[1]).toBeCloseTo(pitched[1], 10);
  });

  test("lift, screen translation and scale change the perspective camera", () => {
    // At a quarter turn, the 640px eye minus 140px lift is 500px from the card.
    const eye = spinEye(0, 90, 200, 12, 140, 1.25);
    expect(eye[0]).toBeCloseTo(-200, 10);
    expect(eye[1]).toBeCloseTo(-4.8, 10);
    const doubled = spinEye(0, 90, 200, 12, 140, 2.5);
    expect(doubled[0]).toBeCloseTo(eye[0] / 2, 10);
    expect(doubled[1]).toBeCloseTo(eye[1] / 2, 10);
  });

  test("quarter turns retain the near long wall and cull the opposite wall", () => {
    const mesh = walls(CARD_BOX, 2);
    const left = mesh.find((wall) => wall.nx < -0.999)!;
    const right = mesh.find((wall) => wall.nx > 0.999)!;
    expect(wallFacesEye(left, CARD_BOX, spinEye(0, 90, 264))).toBe(true);
    expect(wallFacesEye(right, CARD_BOX, spinEye(0, 90, 264))).toBe(false);
    expect(wallFacesEye(left, CARD_BOX, spinEye(0, 270, 264))).toBe(false);
    expect(wallFacesEye(right, CARD_BOX, spinEye(0, 270, 264))).toBe(true);
    expect(wallFacesEye(left, CARD_BOX, spinEye(0, 0, 264))).toBe(false);
    expect(wallFacesEye(right, CARD_BOX, spinEye(0, 0, 264))).toBe(false);
  });

  test("tangent and nearly tangent walls remain visible, with box offsets respected", () => {
    const box = { ...CARD_BOX, x: -6, y: -28 };
    const wall = walls(box, 2).find((part) => part.nx > 0.999)!;
    const tangentX = box.w / 2;
    expect(wallFacesEye(wall, box, [tangentX, 0])).toBe(true);
    expect(wallFacesEye(wall, box, [tangentX - 0.1, 0])).toBe(true);
    expect(wallFacesEye(wall, box, [tangentX - 0.3, 0])).toBe(false);
  });

  test("full turns agree with an independently rotated surface normal and retain at most half the facets", () => {
    const mesh = walls(CARD_BOX, 2);
    for (const pose of [
      { rx: 0, width: 205, y: 0, z: 0, scale: 1 },
      { rx: 6, width: 264, y: -2, z: 15, scale: 1.03 },
      { rx: -12, width: 400, y: 4, z: 32, scale: 0.98 },
    ]) {
      let peak = 0;
      for (let turn = -360; turn <= 360; turn += 15) {
        const rx = pose.rx * Math.PI / 180;
        const ry = turn * Math.PI / 180;
        const unit = pose.width * pose.scale / 100;
        // Forward-transform the point and its normal, then dot toward the fixed world-space eye.
        // This checks the inverse-camera helper without repeating its inverse rotation formula.
        const rotate = ([x, y, z]: readonly [number, number, number]): [number, number, number] => {
          const xx = x * Math.cos(ry) + z * Math.sin(ry);
          const zz = -x * Math.sin(ry) + z * Math.cos(ry);
          return [xx, y * Math.cos(rx) - zz * Math.sin(rx), y * Math.sin(rx) + zz * Math.cos(rx)];
        };
        const worldFacing = (wall: Wall) => {
          const mx = wall.left + wall.len / 2 - CARD_BOX.w / 2;
          const my = wall.top - CARD_BOX.h / 2;
          const point = rotate([mx * unit, my * unit, 0]);
          const normal = rotate([wall.nx, wall.ny, 0]);
          return (-normal[0] * point[0] - normal[1] * (point[1] + pose.y) + normal[2] * (640 - point[2] - pose.z)) / unit;
        };
        const eye = spinEye(pose.rx, turn, pose.width, pose.y, pose.z, pose.scale);
        for (const wall of mesh) {
          const mx = wall.left + wall.len / 2 - CARD_BOX.w / 2;
          const my = wall.top - CARD_BOX.h / 2;
          const dot = wall.nx * (eye[0] - mx) + wall.ny * (eye[1] - my);
          expect(dot).toBeCloseTo(worldFacing(wall), 9);
          expect(wallFacesEye(wall, CARD_BOX, eye)).toBe(worldFacing(wall) >= -0.2);
        }
        const visible = mesh.filter((wall) => wallFacesEye(wall, CARD_BOX, eye)).length;
        expect(visible).toBeLessThanOrEqual(mesh.length / 2);
        peak = Math.max(peak, visible);
      }
      // Perspective can hide more corner facets on wider cards, but an edge-on perimeter remains.
      expect(peak).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("float phases (L3) and idle", () => {
  test("deterministic from the dex number, within the spec ranges", () => {
    for (const n of [0, 1, 7, 42, 313, 9999]) {
      const a = floatPhase(n);
      expect(floatPhase(n)).toEqual(a);
      const dur = Number.parseFloat(a.dur);
      const delay = Number.parseFloat(a.delay);
      expect(dur).toBeGreaterThanOrEqual(6.4);
      expect(dur).toBeLessThan(9.4);
      expect(delay).toBeLessThanOrEqual(0);
      expect(delay).toBeGreaterThan(-9);
    }
    expect(floatPhase(1)).not.toEqual(floatPhase(2));
  });

  test("seeds from keys are stable", () => {
    expect(hashSeed("L7")).toBe(hashSeed("L7"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });

  test("breathe stays inside its amplitudes and peek only inside its window", () => {
    for (let t = 0; t < 30; t += 0.37) {
      const b = breathe(t, { rx: 2.4, ry: 5, y: 6 });
      expect(Math.abs(b.rx)).toBeLessThanOrEqual(2.4);
      expect(Math.abs(b.ry)).toBeLessThanOrEqual(5);
      expect(Math.abs(b.y)).toBeLessThanOrEqual(6);
    }
    let on = 0;
    let max = 0;
    for (let t = 0; t < 14; t += 0.01) {
      const p = peekAmount(t);
      if (p > 0) on += 0.01;
      max = Math.max(max, p);
    }
    expect(on).toBeGreaterThan(2.6);
    expect(on).toBeLessThan(3.0);
    expect(max).toBeCloseTo(1, 2);
  });
});

describe("the ground (F4)", () => {
  test("width follows the pose: full at rest, 0.32 edge-on, softer and narrower when lifted", () => {
    const rest = groundFromPose(0, 0, 0, 264, "shadow");
    expect(rest.sx).toBeCloseTo(1, 6);
    const edge = groundFromPose(90, 0, 0, 264, "shadow");
    expect(edge.sx).toBeCloseTo(0.32, 6);
    const lifted = groundFromPose(0, 0, 60, 264, "shadow");
    expect(lifted.sx).toBeLessThan(rest.sx);
    expect(lifted.o).toBeLessThan(rest.o);
    const floor = groundFromPose(90, 0, 0, 264, "floor");
    expect(floor.sx).toBeCloseTo(0.32, 6);
  });
});

describe("copy (card files)", () => {
  test("no em dashes, en dashes or middle dots in the card's own files", () => {
    const dir = path.resolve(import.meta.dir, "../../src/components/mintdex");
    const files = [
      path.join(dir, "MintCard.tsx"),
      ...fs.readdirSync(path.join(dir, "card3d")).map((f) => path.join(dir, "card3d", f)),
      path.resolve(import.meta.dir, "../../src/card3d.css"),
    ];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      expect({ f, bad: /[\u2013\u2014\u00b7]/.test(text) }).toEqual({ f, bad: false });
    }
  });
});
