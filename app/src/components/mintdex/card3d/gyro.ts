/**
 * One baseline-relative phone tilt shared by cards and their light. Permission is capability-detected, never
 * requested while mounting or dragging. A listener is not proof of a sensor: `on` becomes true on a real reading.
 */
import { clamp } from "./light";

type OrientationCtor = { requestPermission?: () => Promise<"granted" | "denied"> };
export type GyroStatus =
  | "unsupported"
  | "idle"
  | "permission"
  | "requesting"
  | "waiting"
  | "active"
  | "unavailable"
  | "denied";

export const gyro = {
  on: false,
  rx: 0,
  ry: 0,
  b0: null as number | null,
  g0: null as number | null,
};

let listening = false;
let wanted = false;
let wired = false;
let blurred = false;
let permission: "unknown" | "granted" | "denied" = "unknown";
let status: GyroStatus = "idle";
let pending: Promise<boolean> | null = null;
let firstReadingTimer = 0;
let lastSample = 0;
let baselineAngle: number | null = null;
const FIRST_READING_MS = 4000;
const FILTER_MS = 90;

/** Chips update only for state changes, not on every sensor sample. */
export const GYRO_EVENT = "mdx:gyro";
function setStatus(next: GyroStatus) {
  if (status === next) return;
  status = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GYRO_EVENT));
}

let kick: () => void = () => {};
const readers = new Set<() => void>();
export function bindGyroKick(fn: () => void) {
  kick = fn;
}
/** Every reader shares the same sensor. Returns its unsubscribe. */
export function onGyro(fn: () => void) {
  readers.add(fn);
  return () => {
    readers.delete(fn);
  };
}
function publish() {
  kick();
  for (const fn of readers) fn();
}

/** Touch-capable hybrids can use a mouse and still tilt; a mouse-only desktop does not request sensors. */
export function coarsePointer() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(any-pointer: coarse)").matches;
}
function ctor() {
  return (window as unknown as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
}
function supported() {
  return (
    typeof window !== "undefined" && window.isSecureContext !== false && coarsePointer() && !!ctor()
  );
}
function motionAllowed() {
  return typeof document !== "undefined" && document.documentElement.dataset.motion !== "calm";
}
function screenAngle() {
  return (
    window.screen?.orientation?.angle ??
    (window as Window & { orientation?: number }).orientation ??
    0
  );
}
function angleDelta(value: number, baseline: number) {
  return ((((value - baseline + 180) % 360) + 360) % 360) - 180;
}

/** A relative tilt in screen coordinates: rotating the phone to landscape must rotate the response axes too. */
export function orientationTilt(beta: number, gamma: number, b0: number, g0: number, angle = 0) {
  const b = angleDelta(beta, b0);
  const g = angleDelta(gamma, g0);
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    rx: clamp(-(b * c - g * s) * 0.7, -12, 12),
    ry: clamp((g * c + b * s) * 0.7, -14, 14),
  };
}

export function gyroStatus(): GyroStatus {
  if (!supported()) return "unsupported";
  if (permission === "denied") return "denied";
  if (pending || status === "requesting") return "requesting";
  if (typeof ctor()?.requestPermission === "function" && permission !== "granted")
    return "permission";
  return status;
}
/** A button may ask for access only when this is true. Never infer permissions from a user-agent string. */
export function gyroNeedsPermission() {
  return gyroStatus() === "permission";
}

function clearReadingTimer() {
  if (firstReadingTimer) window.clearTimeout(firstReadingTimer);
  firstReadingTimer = 0;
}
function resetTilt() {
  gyro.on = false;
  gyro.rx = gyro.ry = 0;
  gyro.b0 = gyro.g0 = null;
  baselineAngle = null;
  lastSample = 0;
}
function awaitReading() {
  clearReadingTimer();
  setStatus("waiting");
  firstReadingTimer = window.setTimeout(() => {
    firstReadingTimer = 0;
    // Some browsers expose the API even without a sensor, or grant access but never emit usable values.
    if (listening && !gyro.on) setStatus("unavailable");
  }, FIRST_READING_MS);
}
function rebase() {
  resetTilt();
  if (listening) awaitReading();
  publish();
}
function onOrient(e: DeviceOrientationEvent) {
  if (
    !listening ||
    !Number.isFinite(e.beta) ||
    !Number.isFinite(e.gamma) ||
    e.beta == null ||
    e.gamma == null
  )
    return;
  const angle = screenAngle();
  if (baselineAngle !== angle) resetTilt();
  if (gyro.b0 == null || gyro.g0 == null) {
    gyro.b0 = e.beta;
    gyro.g0 = e.gamma;
    baselineAngle = angle;
  }
  const target = orientationTilt(e.beta, e.gamma, gyro.b0, gyro.g0, angle);
  // Time-based low pass gives the same damping on slower and faster sensor streams. Springs add the final ease.
  const dt = lastSample ? clamp(e.timeStamp - lastSample, 1, 64) : 16.7;
  const blend = 1 - Math.exp(-dt / FILTER_MS);
  lastSample = e.timeStamp;
  gyro.rx += (target.rx - gyro.rx) * blend;
  gyro.ry += (target.ry - gyro.ry) * blend;
  gyro.on = true;
  clearReadingTimer();
  setStatus("active");
  publish();
}
function detach() {
  clearReadingTimer();
  if (listening) window.removeEventListener("deviceorientation", onOrient);
  listening = false;
  resetTilt();
}
function pause() {
  detach();
  if (status !== "denied") setStatus("idle");
  publish();
}
function listen() {
  if (listening || !wanted || !supported() || !motionAllowed() || document.hidden || blurred)
    return;
  if (typeof ctor()?.requestPermission === "function" && permission !== "granted") return;
  listening = true;
  resetTilt();
  window.addEventListener("deviceorientation", onOrient, { passive: true });
  awaitReading();
}
function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else {
      blurred = false;
      listen();
    }
  });
  window.addEventListener("blur", () => {
    blurred = true;
    pause();
  });
  window.addEventListener("focus", () => {
    blurred = false;
    listen();
  });
  window.addEventListener("orientationchange", rebase);
  window.screen?.orientation?.addEventListener?.("change", rebase);
}

/** Automatically use sensors only when the browser does not require permission, or this session already granted it. */
export function autoGyro() {
  if (!supported() || !motionAllowed() || permission === "denied") return;
  wanted = true;
  wire();
  listen();
}

/** Called directly by the Enable phone tilt button. True means permission granted, not that readings have arrived. */
export function requestGyro(): Promise<boolean> {
  if (!supported() || !motionAllowed() || permission === "denied") return Promise.resolve(false);
  if (pending) return pending;
  const C = ctor();
  if (typeof C?.requestPermission !== "function" || permission === "granted") {
    autoGyro();
    return Promise.resolve(true);
  }
  let answer: Promise<"granted" | "denied">;
  try {
    // Keep this call before any await: Safari requires the button's transient user activation.
    answer = C.requestPermission();
  } catch {
    permission = "denied";
    setStatus("denied");
    return Promise.resolve(false);
  }
  setStatus("requesting");
  pending = answer.then(
    (value) => {
      permission = value === "granted" ? "granted" : "denied";
      pending = null;
      if (permission === "granted") {
        setStatus("idle");
        autoGyro();
        // Calm may have been selected while the permission sheet was open.
        if (!motionAllowed()) setStatus("idle");
        return true;
      }
      wanted = false;
      detach();
      setStatus("denied");
      return false;
    },
    () => {
      pending = null;
      permission = "denied";
      wanted = false;
      detach();
      setStatus("denied");
      return false;
    },
  );
  return pending;
}

/** Calm stops sensing and clears the pose; granting access remains valid when the user returns to full motion. */
export function stopGyro() {
  if (typeof window === "undefined") return;
  wanted = false;
  pause();
}
