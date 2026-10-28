/**
 * Pure pose math (no DOM): the one light in the room, the ground under a body, which side faces the viewer and
 * the deterministic float phases. Unit tested in tests/card3d.
 */
import type { CardSide } from "./types";

export const D2R = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The light a face shows with no pose at all (a flat card, the CSS fallback on .mdx-card__lights): as if lit from
 * 30% / 22%, already catching (owner override 2026-10-11: every card is lit at rest, never flat and dark).
 */
export const STILL_LIGHT = { px: 0.3, py: 0.22, lit: 0.45 } as const;

/** The light never drops below this on a posed card (a card face-on to you still shows its holo). */
export const LIT_FLOOR = 0.3;

export type Light = { px: number; py: number; lit: number };

/** A rest pose in degrees (rx leans the top back, ry turns the face toward +x). */
export type RestPose = { rx: number; ry: number };

/**
 * The rest poses (owner override 2026-10-11: every card is a posed object at rest). Hand cards lean back and
 * turn a little toward the left; table cards lean back and fan by column (fanPose). CSS draws the rest as a
 * static `rotate` above the pose, on one flat layer, so the face rasterizes sharp; the engine's pose and light
 * add to it. card3d.css carries the same numbers as its fallbacks (tests/card3d checks them).
 */
export const HAND_REST: RestPose = { rx: 5, ry: -10 };
export const TABLE_REST: RestPose = { rx: 5, ry: -4 };
/** Calm keeps the pose but never past 6 degrees on an axis (card3d.css --rest-k). */
export const CALM_REST_K = 0.6;

/** Preserve sensitive local leans, then rotate that light through whole turns without pinning it at an edge. */
export function turnLightX(lean: number, turn: number, gain = 3.2): number {
  const phase = Math.asin(clamp(Math.sin(lean * D2R) * gain, -1, 1));
  return 0.5 + 0.5 * Math.sin(turn * D2R + phase);
}

/**
 * The light combines a sensitive local lean with a periodic whole turn. X/Y still describe the physical pose:
 * Y is tilt plus flip, X is the tilt plus the arc's edge-on lean. The back's local x is already mirrored, so the
 * same light sweeps both printed faces through a full rotation.
 */
export function lightFromPose(rx: number, ry: number, flip: number, arcTilt: number): Light & { X: number; Y: number } {
  const Y = ry + flip;
  const X = rx + Math.abs(Math.sin(flip * D2R)) * arcTilt;
  // Amplify only the local lean. Amplifying the full turn clipped the foil at 18 degrees and parked it for
  // most of each half-turn, even though the physical card kept rotating.
  const px = turnLightX(ry, flip);
  const ux = (px - 0.5) * 2;
  const uy = clamp(Math.sin(X * D2R) * 4.1, -1, 1);
  return { px, py: 0.5 - 0.5 * uy, lit: Math.min(1, 1.15 * Math.hypot(ux, uy)), X, Y };
}

/**
 * Blend from a resting light (amt 0: the still light, or the card's own rest light) to a live light (amt 1), so a
 * card that settles hands back exactly what CSS paints at rest.
 */
export function blendLight(l: Light, amt: number, from: Light = STILL_LIGHT): Light {
  const a = clamp(amt, 0, 1);
  return {
    px: from.px + (l.px - from.px) * a,
    py: from.py + (l.py - from.py) * a,
    lit: from.lit + (l.lit - from.lit) * a,
  };
}

/** Lift a lit value to the floor (a posed card always shows some holo). */
export function litFloor(lit: number) {
  return clamp(Math.max(lit, LIT_FLOOR), 0, 1);
}

/** The light a card at this rest pose catches: the pose's own light, floored. Rounded like the CSS values. */
export function restLight(p: RestPose): Light {
  const l = lightFromPose(p.rx, p.ry, 0, 0);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { px: r(l.px), py: r(l.py), lit: r(litFloor(l.lit)) };
}

/**
 * The table fan (owner override 2026-10-11): a shelf's columns face its middle, ry = (col - (cols - 1) / 2) x -4
 * deg, every card leaned back 5 deg. Static: set once per layout, never per frame.
 */
export function fanPose(col: number, cols: number): RestPose {
  const n = Math.max(1, cols);
  const ry = (clamp(col, 0, n - 1) - (n - 1) / 2) * -4;
  return { rx: TABLE_REST.rx, ry: ry === 0 ? 0 : ry };
}

/** The rest pose as one CSS `rotate` angle about the axis (rx, ry, 0): small leans compose like rotateX then rotateY. */
export function restAngle(p: RestPose) {
  return Math.round(Math.hypot(p.rx, p.ry) * 1000) / 1000;
}

/**
 * The CSS custom properties a shelf cell sets for its column (Card3D's table scene reads them as its rest): the
 * pose (also the axis of the CSS `rotate` on __enter, so a deal or a sway on `transform` composes with it), its
 * angle, and the light it catches.
 */
export function fanVars(col: number, cols: number): Record<string, string> {
  const p = fanPose(col, cols);
  const l = restLight(p);
  return {
    "--fan-rx": String(p.rx),
    "--fan-ry": String(p.ry),
    "--fan-a": String(restAngle(p)),
    "--fan-px": String(l.px),
    "--fan-py": String(l.py),
    "--fan-lit": String(l.lit),
  };
}

/**
 * The idle orbit of a held card's light (owner override 2026-10-11): the pose holds still at rest (its text stays
 * sharp) and the light circles, px +/- .2 at 9.3 s, py +/- .12 at 7.1 s, with a slow swell of the catch.
 */
export function orbitLight(t: number) {
  const tau = Math.PI * 2;
  return {
    dx: 0.2 * Math.sin((t * tau) / 9.3 + 0.4),
    dy: 0.12 * Math.sin((t * tau) / 7.1),
    dl: 0.12 * Math.sin((t * tau) / 5.3 + 1.1),
  };
}

/**
 * The ground under a body (spec F4): its width follows the pose (0.32 + 0.68 x |cos Y| of rest), it slides away
 * from the light as the card turns, and it softens and shrinks as the card lifts (z in px). Returns a transform
 * and an opacity, the only two things the engine ever writes on a ground.
 */
export function groundFromPose(Y: number, X: number, z: number, W: number, mode: "shadow" | "floor") {
  const c = Math.abs(Math.cos(Y * D2R));
  const w = 0.32 + 0.68 * c;
  const s = Math.sin(Y * D2R);
  if (mode === "floor") {
    const lift = clamp(z / Math.max(1, W), 0, 1.5);
    return {
      tx: -s * 0.04 * W,
      ty: 0,
      sx: w * (1 - lift * 0.25),
      sy: 1 - lift * 0.35,
      o: clamp(0.95 - lift * 0.9, 0.25, 0.95),
    };
  }
  const lift = clamp(z / Math.max(1, W), -0.2, 1.5);
  return {
    tx: -s * 0.06 * W,
    ty: z * 0.16 + X * 0.25,
    sx: w * (1 - lift * 0.18),
    sy: 1 - lift * 0.1,
    o: clamp(0.92 - lift * 0.85, 0.2, 0.95),
  };
}

export function groundTransform(g: ReturnType<typeof groundFromPose>) {
  return `translate3d(${g.tx.toFixed(1)}px, ${g.ty.toFixed(1)}px, 0) scale(${g.sx.toFixed(3)}, ${g.sy.toFixed(3)})`;
}

/** Which side a flip angle (deg) leaves facing the viewer: the back for odd half turns. */
export function sideFromAngle(flip: number): CardSide {
  const m = ((Math.round(flip / 180) % 2) + 2) % 2;
  return m ? "back" : "face";
}

/** True while the back faces the viewer (the moment a staged face may be swapped in unseen). */
export function backFacing(Y: number): boolean {
  return Math.cos(Y * D2R) < -0.3;
}

/** A stable number from a string (FNV-1a), for float phases of cards that carry no dex number. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 997;
}

/**
 * L3 float phase per card (spec 6.2): period 6.4 + (dexNo x 1.37 mod 3) s, delay -(dexNo x 2.11 mod 9) s. Derived
 * from the dex number only, so the server and the client agree and neighbours never move in step.
 */
export function floatPhase(seed: number) {
  const dur = 6.4 + ((seed * 1.37) % 3);
  const delay = -((seed * 2.11) % 9);
  return { dur: `${dur.toFixed(2)}s`, delay: `${delay.toFixed(2)}s` };
}

/** Breathe (L1): a slow Lissajous, rx at 7.1 s, ry at 9.3 s, y at 5.3 s. Amplitudes per body kind. */
export function breathe(t: number, amp: { rx: number; ry: number; y: number }) {
  const tau = Math.PI * 2;
  return {
    rx: amp.rx * Math.sin((t * tau) / 7.1),
    ry: amp.ry * Math.sin((t * tau) / 9.3 + 0.4),
    y: -amp.y * Math.sin((t * tau) / 5.3),
  };
}

/** Peek (L2): every 14 s ry eases to +24 deg and back over 2.8 s (0 outside the window, 0..1 inside). */
export function peekAmount(t: number, period = 14, window = 2.8) {
  const p = ((t % period) + period) % period;
  const start = period - window - 1.2;
  if (p < start || p > start + window) return 0;
  const k = (p - start) / window;
  return (1 - Math.cos(k * Math.PI * 2)) / 2;
}
