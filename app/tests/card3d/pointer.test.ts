import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Body } from "../../src/components/mintdex/card3d/motion3d";
import { SceneCtl, type SceneOpts } from "../../src/components/mintdex/card3d/scene";

// Exercise the real controller and springs with EventTarget dispatch. Only browser layout and window are
// stubbed; the body is attached directly so these input tests do not start the shared animation scheduler.
class ElementStub extends EventTarget {
  dataset: Record<string, string> = {};
  style = { transform: "", removeProperty() {}, setProperty() {} };
  parentElement = null;
  offsetWidth = 200;
  childElementCount = 1;
  hover = true;
  captured: number[] = [];

  closest() { return null; }
  matches(selector: string) { return selector === ":hover" && this.hover; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 280 }; }
  setPointerCapture(id: number) { this.captured.push(id); }
}

function pointer(type: string, values: Partial<PointerEvent> = {}) {
  return Object.assign(new Event(type), {
    pointerId: 1,
    clientX: 100,
    clientY: 120,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    isPrimary: true,
    ...values,
  });
}

let win: EventTarget;
let originalWindow: PropertyDescriptor | undefined;
let controllers: SceneCtl[];

beforeEach(() => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  win = Object.assign(new EventTarget(), {
    matchMedia: (query: string) => ({ matches: query.includes("pointer: fine") }),
    setTimeout: globalThis.setTimeout,
  });
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: win });
  controllers = [];
});

afterEach(() => {
  try {
    for (const ctl of controllers) ctl.destroy();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

function fixture() {
  const scene = new ElementStub();
  const pose = new ElementStub();
  const sides: string[] = [];
  const steps: number[] = [];
  const announcements: string[] = [];
  const opts: SceneOpts = {
    depth: "table", kind: "hand", flippable: true, tapTurns: true, drag: "turn", idle: "none",
    ground: "none", gyro: false, focusable: false, arrowsTurn: false, seg: 2,
    tierOf: () => null,
    mountBack() {},
    announce: (side) => announcements.push(side),
    onSideChange: (side) => sides.push(side),
    onStep: (dir) => steps.push(dir),
  };
  const asElement = (el: ElementStub) => el as unknown as HTMLElement;
  const ctl = new SceneCtl(asElement(scene), asElement(pose), asElement(new ElementStub()), asElement(new ElementStub()), null, opts, "L1");
  controllers.push(ctl);
  // Bind the normal hand input handlers without registering a body with the global engine.
  opts.depth = "hand";
  const body = new Body(asElement(scene), asElement(pose), "hand");
  ctl.body = body;
  return { scene, ctl, body, sides, steps, announcements, opts };
}

describe("card pointer interruption", () => {
  test("touch rotates an inline table card without opening a viewer or stepping coins", () => {
    const f = fixture();
    f.opts.depth = "table";
    f.opts.turntable = false;
    f.opts.tapTurns = false;
    f.scene.dispatchEvent(pointer("pointerdown", { pointerType: "touch" }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: 165, clientY: 125 }));
    expect(f.body.dragging).toBe(true);
    expect(f.body.flip.x).toBeCloseTo(40.3);
    expect(f.scene.captured).toEqual([1]);
    f.scene.dispatchEvent(pointer("pointerup", { pointerType: "touch", clientX: 165, clientY: 125, buttons: 0 }));
    expect(f.body.dragging).toBe(false);
    expect(f.body.held).toBe(false);
    expect(f.steps).toEqual([]);
  });

  test("vertical touch scrolling never captures or rotates an inline card", () => {
    const f = fixture();
    f.opts.depth = "table";
    f.opts.tapTurns = false;
    f.scene.dispatchEvent(pointer("pointerdown", { pointerType: "touch" }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: 104, clientY: 190 }));
    f.scene.dispatchEvent(pointer("pointercancel", { pointerType: "touch", clientX: 104, clientY: 190, buttons: 0 }));
    expect(f.scene.captured).toEqual([]);
    expect(f.body.flip.x).toBe(0);
    expect(f.body.dragging).toBe(false);
    expect(f.steps).toEqual([]);
    f.scene.dispatchEvent(pointer("pointerdown", { pointerType: "touch", pointerId: 2 }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", pointerId: 2, clientX: 150 }));
    expect(f.body.dragging).toBe(true);
  });

  test("a second touch cannot move or end the active card drag", () => {
    const f = fixture();
    f.opts.depth = "table";
    f.scene.dispatchEvent(pointer("pointerdown", { pointerType: "touch" }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: 150 }));
    const turn = f.body.flip.x;
    f.scene.dispatchEvent(pointer("pointerdown", { pointerType: "touch", pointerId: 2, isPrimary: false }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", pointerId: 2, clientX: 195, isPrimary: false }));
    f.scene.dispatchEvent(pointer("pointerup", { pointerType: "touch", pointerId: 2, buttons: 0, isPrimary: false }));
    expect(f.body.flip.x).toBe(turn);
    expect(f.body.dragging).toBe(true);
    f.scene.dispatchEvent(pointer("pointercancel", { pointerType: "touch", clientX: 150, buttons: 0 }));
    expect(f.body.dragging).toBe(false);
    expect(f.body.flip.v).toBe(0);
  });

  test("taking capture from nested artwork does not cancel the active touch drag", () => {
    const f = fixture();
    f.opts.depth = "table";
    f.scene.dispatchEvent(pointer("pointerdown", { pointerType: "touch" }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: 130 }));
    const childLoss = pointer("lostpointercapture", { pointerType: "touch" });
    Object.defineProperty(childLoss, "target", { value: new ElementStub() });
    f.scene.dispatchEvent(childLoss);
    expect(f.body.dragging).toBe(true);
    f.scene.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientX: 175 }));
    expect(f.body.flip.x).toBeCloseTo(46.5);
    f.scene.dispatchEvent(pointer("lostpointercapture", { pointerType: "touch" }));
    expect(f.body.dragging).toBe(false);
  });

  for (const terminal of ["pointercancel", "lostpointercapture"]) {
    test(`${terminal} restores the starting side after interrupting a turn`, () => {
      const f = fixture();
      // A previous turn is still moving toward its back when the next drag interrupts it.
      f.body.flip.x = 120;
      f.body.flip.t = 180;
      f.scene.dispatchEvent(pointer("pointerdown"));
      f.scene.dispatchEvent(pointer("pointermove", { clientX: 160 }));
      expect(f.body.dragging).toBe(true);
      expect(f.scene.captured).toEqual([1]);

      f.scene.dispatchEvent(pointer(terminal, { clientX: 160, buttons: 0 }));

      expect(f.body.flip.t).toBe(180);
      expect(f.body.flip.v).toBe(0);
      expect(f.ctl.getSide()).toBe("back");
      expect(f.scene.dataset.side).toBe("back");
      expect(f.body.dragging).toBe(false);
      expect(f.body.held).toBe(false);
      expect(f.sides).toEqual(["back"]);
      expect(f.steps).toEqual([]);
      expect(f.announcements).toEqual([]);
    });
  }

  test("an unmoved press leaving vertically cannot block the next drag", () => {
    const f = fixture();
    f.scene.dispatchEvent(pointer("pointerdown"));
    f.scene.hover = false;
    f.scene.dispatchEvent(pointer("pointerleave", { clientY: 300 }));
    win.dispatchEvent(pointer("pointerup", { clientY: 300, buttons: 0 }));
    expect(f.body.flip.t).toBe(0);
    expect(f.scene.captured).toEqual([]);

    f.scene.hover = true;
    f.scene.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 140 }));

    expect(f.body.dragging).toBe(true);
    expect(f.scene.captured).toEqual([2]);
    expect(f.body.flip.x).toBeCloseTo(24.8);
    expect(f.announcements).toEqual([]);
  });

  test("outside release clears an uncaptured press without treating it as a tap", () => {
    const f = fixture();
    f.scene.dispatchEvent(pointer("pointerenter", { clientX: 160 }));
    expect(f.body.held).toBe(true);
    f.scene.dispatchEvent(pointer("pointerdown"));
    f.scene.hover = false;
    win.dispatchEvent(pointer("pointerup", { clientY: 350, buttons: 0 }));

    expect(f.body.flip.t).toBe(0);
    expect(f.body.held).toBe(false);
    expect(f.announcements).toEqual([]);
    // A new press must be accepted after the outside release, even if pointerleave was never delivered.
    f.scene.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 140 }));
    expect(f.scene.captured).toEqual([2]);
  });

  test("a pointermove without buttons cannot continue a stale press", () => {
    const f = fixture();
    f.scene.dispatchEvent(pointer("pointerdown"));
    f.scene.dispatchEvent(pointer("pointermove", { clientX: 180, buttons: 0 }));

    expect(f.body.dragging).toBe(false);
    expect(f.body.flip.t).toBe(0);
    expect(f.scene.captured).toEqual([]);
    f.scene.dispatchEvent(pointer("pointermove", { clientX: 190, buttons: 0 }));
    expect(f.body.flip.x).toBe(0);

    f.scene.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 140 }));
    expect(f.scene.captured).toEqual([2]);
  });

  test("window blur terminates a drag without stepping the turntable", () => {
    const f = fixture();
    f.opts.drag = "step";
    f.scene.dispatchEvent(pointer("pointerdown"));
    f.scene.dispatchEvent(pointer("pointermove", { clientX: 400 }));
    expect(f.body.dragging).toBe(true);
    win.dispatchEvent(new Event("blur"));

    expect(f.body.dragging).toBe(false);
    expect(f.body.flip.t).toBe(0);
    expect(f.steps).toEqual([]);
    expect(f.announcements).toEqual([]);
    f.scene.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));
    f.scene.dispatchEvent(pointer("pointermove", { pointerId: 2, clientX: 140 }));
    expect(f.scene.captured).toEqual([1, 2]);
  });
});
