// The turntables (owner 2026-10-17): the list turntable's edge, the Body's inline spin (lands on its front when it
// stops, turns as the solid slab with the edge on the side facing you), and the copy rule for the viewer's files.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { Body } from "../../src/components/mintdex/card3d/motion3d";
import { gyro } from "../../src/components/mintdex/card3d/gyro";

type Fake = ReturnType<typeof fakeEl>;
/** A stand-in element: what Body touches (attributes, dataset, style), nothing else. `child` is what it finds. */
function fakeEl(child: Fake | null = null): {
  offsetWidth: number;
  dataset: Record<string, string>;
  style: { transform: string; props: Record<string, string>; setProperty(k: string, v: string): void; removeProperty(k: string): void };
  attrs: Set<string>;
  querySelector: () => unknown;
  toggleAttribute(n: string, on: boolean): void;
  setAttribute(n: string): void;
  removeAttribute(n: string): void;
  hasAttribute(n: string): boolean;
  dispatchEvent(): boolean;
} {
  const attrs = new Set<string>();
  const props: Record<string, string> = {};
  return {
    offsetWidth: 200,
    dataset: {} as Record<string, string>,
    style: {
      transform: "",
      props,
      setProperty(k: string, v: string) {
        props[k] = v;
      },
      removeProperty(k: string) {
        delete props[k];
      },
    },
    attrs,
    querySelector: () => child,
    toggleAttribute(n: string, on: boolean) {
      if (on) attrs.add(n);
      else attrs.delete(n);
    },
    setAttribute(n: string) {
      attrs.add(n);
    },
    removeAttribute(n: string) {
      attrs.delete(n);
    },
    hasAttribute: (n: string) => attrs.has(n),
    dispatchEvent() {
      return true;
    },
  };
}

const DIR = path.resolve(import.meta.dir, "../../src/components/mintdex/card3d");

describe("the inline spin (Body)", () => {
  test("a showcase can bound its turn arc without changing angles or other cards", () => {
    const normalPose = fakeEl(), fittedPose = fakeEl();
    const normal = new Body(fakeEl() as never, normalPose as never, "hand");
    const fitted = new Body(fakeEl() as never, fittedPose as never, "hand");
    expect(normal.turnArcScale).toBe(1);
    fitted.turnArcScale = 0.2;
    normal.dragging = fitted.dragging = true;
    for (const angle of [0, 45, 90, 135, 180, 225, 270, 315, 360]) {
      normal.flip.snap(angle); fitted.flip.snap(angle);
      normal.step(1 / 60, 1000 + angle, "full", false);
      fitted.step(1 / 60, 1000 + angle, "full", false);
      const normalZ = Number(normalPose.style.transform.match(/translate3d\(0, [^,]+, ([\d.-]+)px\)/)?.[1] ?? 0);
      const fittedZ = Number(fittedPose.style.transform.match(/translate3d\(0, [^,]+, ([\d.-]+)px\)/)?.[1] ?? 0);
      expect(fittedZ).toBeCloseTo(normalZ * 0.2, 1);
      expect(fittedPose.style.transform.match(/rotateY\(([^)]+)\)/)?.[1]).toBe(normalPose.style.transform.match(/rotateY\(([^)]+)\)/)?.[1]);
      expect(fitted.side()).toBe(normal.side());
    }
    expect(normal.cfg.arcLift).toBe(0.16);
    expect(normal.cfg.arcTilt).toBe(7);
    expect(new Body(fakeEl() as never, fakeEl() as never, "hand").turnArcScale).toBe(1);
  });
  test("the metallic edge follows the pose even when rounded foil values match", () => {
    const edge = fakeEl();
    const foil = fakeEl();
    const b = new Body(fakeEl() as never, fakeEl(edge) as never, "table");
    b.lights = [foil as never];
    b.dragging = true;
    b.live.x = 1;
    for (const [angle, now] of [[87, 1000], [89, 1100]]) {
      b.flip.x = angle;
      b.step(1 / 60, now, "full", false);
    }
    const light = { ...foil.style.props };
    expect(edge.style.props["--ey"]).toBe("89.0deg");
    b.flip.x = 91;
    b.step(1 / 60, 1200, "full", false);
    expect(foil.style.props).toEqual(light);
    expect(edge.style.props["--ey"]).toBe("91.0deg");
  });

  test("case gloss keeps sweeping through the old saturated range", () => {
    const gloss = fakeEl();
    const b = new Body(fakeEl() as never, fakeEl() as never, "hand");
    b.glossLights = [gloss as never];
    b.dragging = true;
    const positions: number[] = [];
    for (const [angle, now] of [[30, 1000], [45, 1100], [60, 1200]]) {
      b.flip.x = angle;
      b.step(1 / 60, now, "full", false);
      positions.push(Number(gloss.style.props["--px"]));
    }
    expect(positions[1] - positions[0]).toBeGreaterThan(0.05);
    expect(positions[2] - positions[1]).toBeGreaterThan(0.05);
  });

  const run = (b: Body, from: number, secs: number) => {
    let t = from;
    for (let i = 0; i < secs * 60; i++) {
      t += 1000 / 60;
      b.step(1 / 60, t, "full", false);
    }
    return t;
  };
  test("spins steadily with its shared rounded edge, then lands on its front", () => {
    const el = fakeEl();
    const edge = fakeEl();
    const pose = fakeEl(edge);
    const b = new Body(el as never, pose as never, "table");
    b.spinCard = true;
    b.spinRate = 30;
    b.spinFrom = 0;
    let t = run(b, 0, 4);
    expect(b.flip.x).toBeGreaterThan(60);
    expect(el.attrs.has("data-spin3d")).toBe(true);
    expect(el.attrs.has("data-edge")).toBe(false);
    expect(pose.style.transform).toContain("perspective(");
    expect(b.edges).toBe(edge as never);
    expect(edge.style.props["--ey"]).toMatch(/deg$/);
    b.spinRate = 0;
    t = run(b, t, 4);
    // Landed on its front: one flat layer again.
    expect(el.attrs.has("data-spin3d")).toBe(false);
    expect(Math.abs(b.flip.x - Math.round(b.flip.x / 360) * 360)).toBeLessThan(0.5);
  });
  test("pointing at it pauses the spin and turns it to the front", () => {
    const el = fakeEl();
    const b = new Body(el as never, fakeEl() as never, "table");
    b.spinCard = true;
    b.spinRate = 30;
    b.spinFrom = 0;
    const t = run(b, 0, 3);
    b.held = true;
    run(b, t, 3);
    expect(b.spinOn).toBe(false);
    expect(Math.abs(b.flip.x - Math.round(b.flip.x / 360) * 360)).toBeLessThan(0.5);
  });
  test("no spin below full motion", () => {
    const b = new Body(fakeEl() as never, fakeEl() as never, "table");
    b.spinCard = true;
    b.spinRate = 30;
    let t = 0;
    for (let i = 0; i < 120; i++) b.step(1 / 60, (t += 16.7), "lite", false);
    expect(b.flip.x).toBe(0);
  });
  test("phone tilt owns the pose until near neutral, without ambient spin fighting it", () => {
    const previous = { ...gyro };
    try {
      const b = new Body(fakeEl() as never, fakeEl() as never, "table");
      b.spinCard = true;
      b.spinRate = 30;
      b.useGyro = true;
      gyro.on = true;
      gyro.rx = 0;
      gyro.ry = 0;
      let t = run(b, 0, 3);
      expect(b.spinOn).toBe(true);
      gyro.rx = -5;
      gyro.ry = 7;
      t = run(b, t, 3);
      expect(b.spinOn).toBe(false);
      expect(b.rx.t).toBe(-5);
      expect(b.ry.t).toBe(7);
      gyro.rx = 0;
      gyro.ry = 0.3;
      t = run(b, t, 1);
      expect(b.spinOn).toBe(false);
      gyro.ry = 0.1;
      run(b, t, 3);
      expect(b.spinOn).toBe(true);
    } finally {
      Object.assign(gyro, previous);
    }
  });
});

describe("viewer copy", () => {
  for (const f of ["view3d.tsx", "TurntableStage.tsx", "spin.ts"]) {
    test(`${f}: no em dashes, en dashes or middle dots`, () => {
      expect(fs.readFileSync(path.join(DIR, f), "utf8")).not.toMatch(/[—–·]/);
    });
  }
  test("the deep link is a search param outside the router", () => {
    const src = fs.readFileSync(path.join(DIR, "view3d.tsx"), "utf8");
    expect(src).toContain('VIEW3D_PARAM = "view3d"');
    expect(src).toContain("history.replaceState");
  });
});
