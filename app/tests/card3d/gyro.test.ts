import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { orientationTilt } from "../../src/components/mintdex/card3d/gyro";

describe("phone tilt screen projection", () => {
  test("uses the way the phone is being held as neutral", () => {
    expect(orientationTilt(52, -7, 52, -7)).toEqual({ rx: -0, ry: 0 });
    expect(orientationTilt(62, 3, 52, -7)).toEqual({ rx: -7, ry: 7 });
  });

  test("follows screen axes in either landscape orientation and upside down", () => {
    const left = orientationTilt(10, 20, 0, 0, 90);
    expect(left.rx).toBeCloseTo(12); // Bounded, rather than throwing the card edge-on.
    expect(left.ry).toBeCloseTo(7);
    const right = orientationTilt(10, 20, 0, 0, -90);
    expect(right.rx).toBeCloseTo(-12);
    expect(right.ry).toBeCloseTo(-7);
    const upsideDown = orientationTilt(10, 20, 0, 0, 180);
    expect(upsideDown.rx).toBeCloseTo(7);
    expect(upsideDown.ry).toBeCloseTo(-14);
  });

  test("crossing the beta wrap boundary does not reverse or jump to the limit", () => {
    expect(orientationTilt(-179, 0, 179, 0).rx).toBeCloseTo(-1.4);
    expect(orientationTilt(179, 0, -179, 0).rx).toBeCloseTo(1.4);
  });

  test("large movements stay within the card's readable pose range", () => {
    expect(orientationTilt(100, -80, 0, 0)).toEqual({ rx: -12, ry: -14 });
  });
});

class WindowStub extends EventTarget {
  coarse = true;
  isSecureContext = true;
  DeviceOrientationEvent: { requestPermission?: () => Promise<"granted" | "denied"> } | undefined =
    {};
  screen = { orientation: Object.assign(new EventTarget(), { angle: 0 }) };
  timers = new Map<number, () => void>();
  nextTimer = 1;
  sensorAdds = 0;
  sensorRemoves = 0;
  matchMedia = () => ({ matches: this.coarse });
  setTimeout = (fn: () => void) => {
    const id = this.nextTimer++;
    this.timers.set(id, fn);
    return id;
  };
  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === "deviceorientation") this.sensorAdds++;
    super.addEventListener(type, listener, options);
  }
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (type === "deviceorientation") this.sensorRemoves++;
    super.removeEventListener(type, listener, options);
  }
  expireTimers() {
    const tasks = [...this.timers.values()];
    this.timers.clear();
    for (const task of tasks) task();
  }
  sample(beta: number | null, gamma: number | null, at = 16) {
    const event = Object.assign(new Event("deviceorientation"), { beta, gamma });
    Object.defineProperty(event, "timeStamp", { value: at });
    this.dispatchEvent(event);
  }
}

let originalWindow: PropertyDescriptor | undefined;
let originalDocument: PropertyDescriptor | undefined;
let win: WindowStub;
let doc: EventTarget & { hidden: boolean; documentElement: { dataset: Record<string, string> } };
let sensor: typeof import("../../src/components/mintdex/card3d/gyro");
let moduleId = 0;

beforeEach(async () => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  win = new WindowStub();
  doc = Object.assign(new EventTarget(), { hidden: false, documentElement: { dataset: {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: win });
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: doc });
  // Each case gets its own browser-session state, including a permission decision that intentionally survives Calm.
  sensor = await import(`../../src/components/mintdex/card3d/gyro.ts?session=${++moduleId}`);
});
afterEach(() => {
  sensor.stopGyro();
  for (const [key, previous] of [
    ["window", originalWindow],
    ["document", originalDocument],
  ] as const) {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("shared phone sensor lifecycle", () => {
  test("starts without a prompt where no permission method is exposed, and waits for actual data", () => {
    sensor.autoGyro();
    sensor.autoGyro();
    expect(win.sensorAdds).toBe(1);
    expect(sensor.gyroStatus()).toBe("waiting");
    expect(sensor.gyro.on).toBe(false);
    win.sample(55, -4);
    expect(sensor.gyroStatus()).toBe("active");
    expect(sensor.gyro.on).toBe(true);
    expect(sensor.gyro.rx).toBe(0);
    win.sample(65, 6, 32);
    expect(sensor.gyro.rx).toBeLessThan(0);
    expect(sensor.gyro.rx).toBeGreaterThan(-7); // Filtered, not an abrupt target jump.
    expect(sensor.gyro.ry).toBeGreaterThan(0);
  });

  test("only an explicit request calls the permission method, synchronously within its gesture", async () => {
    let calls = 0;
    let resolve!: (answer: "granted" | "denied") => void;
    win.DeviceOrientationEvent = {
      requestPermission: () => {
        calls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    };
    sensor.autoGyro();
    expect(calls).toBe(0);
    expect(sensor.gyroNeedsPermission()).toBe(true);
    expect(win.sensorAdds).toBe(0);
    const request = sensor.requestGyro();
    expect(calls).toBe(1);
    expect(sensor.gyroStatus()).toBe("requesting");
    expect(sensor.requestGyro()).toBe(request);
    resolve("granted");
    expect(await request).toBe(true);
    expect(win.sensorAdds).toBe(1);
    expect(sensor.gyro.on).toBe(false);
    expect(sensor.gyroStatus()).toBe("waiting");
  });

  test("a granted permission with no usable sensor readings is unavailable, and can recover later", async () => {
    win.DeviceOrientationEvent = { requestPermission: async () => "granted" };
    await sensor.requestGyro();
    win.sample(null, null);
    win.sample(Number.NaN, 10);
    win.sample(10, Number.POSITIVE_INFINITY);
    expect(sensor.gyro.on).toBe(false);
    win.expireTimers();
    expect(sensor.gyroStatus()).toBe("unavailable");
    expect(sensor.gyro.on).toBe(false);
    win.sample(40, 2);
    expect(sensor.gyroStatus()).toBe("active");
    expect(sensor.gyro.b0).toBe(40);
  });

  for (const answer of ["denied", "throw", "reject"] as const) {
    test(`does not claim active or prompt again after permission ${answer}`, async () => {
      let calls = 0;
      win.DeviceOrientationEvent = {
        requestPermission: () => {
          calls++;
          if (answer === "throw") throw new Error("Gesture denied");
          if (answer === "reject") return Promise.reject(new Error("Blocked"));
          return Promise.resolve("denied");
        },
      };
      expect(await sensor.requestGyro()).toBe(false);
      expect(sensor.gyroStatus()).toBe("denied");
      sensor.autoGyro();
      expect(await sensor.requestGyro()).toBe(false);
      expect(calls).toBe(1);
      expect(win.sensorAdds).toBe(0);
      expect(sensor.gyro.on).toBe(false);
    });
  }

  test("Calm stops sensing and a return to full resumes a previously granted session without a new prompt", async () => {
    let calls = 0;
    win.DeviceOrientationEvent = {
      requestPermission: async () => {
        calls++;
        return "granted";
      },
    };
    await sensor.requestGyro();
    win.sample(30, 0);
    win.sample(40, 10, 32);
    doc.documentElement.dataset.motion = "calm";
    sensor.stopGyro();
    expect(sensor.gyro.on).toBe(false);
    expect(sensor.gyro.rx).toBe(0);
    sensor.autoGyro();
    expect(await sensor.requestGyro()).toBe(false);
    expect(win.sensorAdds).toBe(1);
    delete doc.documentElement.dataset.motion;
    sensor.autoGyro();
    expect(calls).toBe(1);
    expect(win.sensorAdds).toBe(2);
    expect(sensor.gyroStatus()).toBe("waiting");
    win.sample(60, 20, 48);
    expect(sensor.gyro.rx).toBe(0);
    expect(sensor.gyro.ry).toBe(0);
  });

  test("choosing Calm during a permission dialog does not turn sensors on when the promise resolves", async () => {
    let resolve!: (answer: "granted" | "denied") => void;
    win.DeviceOrientationEvent = {
      requestPermission: () =>
        new Promise((r) => {
          resolve = r;
        }),
    };
    const request = sensor.requestGyro();
    doc.documentElement.dataset.motion = "calm";
    sensor.stopGyro();
    resolve("granted");
    await request;
    expect(win.sensorAdds).toBe(0);
    expect(sensor.gyroStatus()).toBe("idle");
    delete doc.documentElement.dataset.motion;
    sensor.autoGyro();
    expect(win.sensorAdds).toBe(1);
  });

  test("one sensor serves multiple card readers and removing a reader leaves the others working", () => {
    let a = 0;
    let b = 0;
    const offA = sensor.onGyro(() => {
      a++;
    });
    const offB = sensor.onGyro(() => {
      b++;
    });
    sensor.autoGyro();
    sensor.autoGyro();
    win.sample(0, 0);
    offA();
    win.sample(5, 5, 32);
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(win.sensorAdds).toBe(1);
    offB();
  });

  test("hidden and blurred pages detach the sensor, then use a fresh neutral hold on return", () => {
    sensor.autoGyro();
    win.sample(30, 0);
    win.sample(40, 10, 32);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(win.sensorRemoves).toBe(1);
    expect(sensor.gyro.on).toBe(false);
    expect(win.timers.size).toBe(0);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    win.sample(60, 20, 48);
    expect(sensor.gyro.rx).toBe(0);
    win.dispatchEvent(new Event("blur"));
    expect(win.sensorRemoves).toBe(2);
    win.dispatchEvent(new Event("focus"));
    expect(win.sensorAdds).toBe(3);
    win.sample(10, -20, 64);
    expect(sensor.gyro.ry).toBe(0);
  });

  test("rotating to landscape rebases instead of inheriting portrait tilt, even without a change event", () => {
    sensor.autoGyro();
    win.sample(20, 0);
    win.sample(30, 10, 32);
    win.screen.orientation.angle = 90;
    win.sample(70, 20, 48);
    expect(sensor.gyro.rx).toBe(0);
    expect(sensor.gyro.ry).toBe(0);
    win.sample(80, 20, 64);
    expect(sensor.gyro.rx).toBeCloseTo(0);
    expect(sensor.gyro.ry).toBeGreaterThan(0);
    win.screen.orientation.dispatchEvent(new Event("change"));
    expect(sensor.gyro.on).toBe(false);
    expect(sensor.gyroStatus()).toBe("waiting");
  });

  test("does not offer or request unsupported, insecure or mouse-only sensors", async () => {
    for (const unsupported of ["coarse", "secure", "api"] as const) {
      win.coarse = unsupported !== "coarse";
      win.isSecureContext = unsupported !== "secure";
      win.DeviceOrientationEvent = unsupported === "api" ? undefined : {};
      sensor.autoGyro();
      expect(await sensor.requestGyro()).toBe(false);
      expect(sensor.gyroStatus()).toBe("unsupported");
    }
    expect(win.sensorAdds).toBe(0);
  });
});
