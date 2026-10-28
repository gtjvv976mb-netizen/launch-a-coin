/**
 * Thickness (spec 4.7, owner 2026-10-17 solid slab): the card's continuous cut edge, a rounded rectangle extruded into side walls. Each wall is a <b> turned on its edge
 * (rotateZ(phi) rotateX(90deg)), overlapping its neighbour by 0.7px so no seam shows, and shaded once from its
 * outward normal against the room light (upper left).
 *
 * Geometry is in cqw of the scene (the scene is an inline-size container, 100cqw = the card width), so the walls
 * follow any resize without a rebuild and never read layout. Wall height is a CSS variable (--t for card stock,
 * --T for the acrylic case).
 */
import { D2R } from "./light";

/** A rounded box in cqw: x, y of its top left corner, width, height and corner radius. */
export type EdgeBox = { x: number; y: number; w: number; h: number; r: number };
export type Wall = { left: number; top: number; len: number; phi: number; nx: number; ny: number };

type EdgeMesh = { box: EdgeBox; parts: Array<{ el: HTMLElement; wall: Wall; shown: boolean }>; culled: boolean };
const meshes = new WeakMap<HTMLElement, EdgeMesh>();

/** Camera position in a spinning card's local cqw plane, including its perspective, lift and scale. */
export function spinEye(rx: number, ry: number, width: number, y = 0, z = 0, scale = 1): [number, number] {
  const x = rx * D2R;
  const turn = ry * D2R;
  const unit = Math.max(0.0001, (width * scale) / 100);
  const depth = y * Math.sin(x) + (640 - z) * Math.cos(x);
  return [-depth * Math.sin(turn) / unit, (-y * Math.cos(x) + (640 - z) * Math.sin(x)) / unit];
}

/** A convex perimeter needs only the walls facing the camera; retain near-tangent walls conservatively. */
export function wallFacesEye(wall: Wall, box: EdgeBox, eye: readonly [number, number]): boolean {
  const mx = wall.left + wall.len / 2 - (box.x + box.w / 2);
  const my = wall.top - (box.y + box.h / 2);
  return wall.nx * (eye[0] - mx) + wall.ny * (eye[1] - my) >= -0.2;
}

/** Cull hidden spinner walls without layout reads. Restore all walls before a held/resting pose takes over. */
export function edgeView(host: HTMLElement, eye: readonly [number, number] | null) {
  const mesh = meshes.get(host);
  if (!mesh || (!eye && !mesh.culled)) return;
  for (const part of mesh.parts) {
    const shown = !eye || wallFacesEye(part.wall, mesh.box, eye);
    if (shown === part.shown) continue;
    part.shown = shown;
    part.el.style.display = shown ? "" : "none";
  }
  mesh.culled = !!eye;
}

/** The card itself: 63 x 88 with a 5.04% (of width) corner radius. */
export const CARD_BOX: EdgeBox = { x: 0, y: 0, w: 100, h: (100 * 88) / 63, r: 5.04 };

/** Walls of an extruded rounded box: 4 x (seg + 1) of them (seg arc steps per corner plus four straight sides). */
export function walls(box: EdgeBox, seg: number): Wall[] {
  const { x, y, w, h, r } = box;
  const pts: Array<[number, number]> = [];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = (a0 + ((a1 - a0) * i) / seg) * D2R;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(x + w - r, y + r, -90, 0);
  arc(x + w - r, y + h - r, 0, 90);
  arc(x + r, y + h - r, 90, 180);
  arc(x + r, y + r, 180, 270);
  const out: Wall[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.02) continue;
    const phi = Math.atan2(y2 - y1, x2 - x1);
    out.push({ left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2, len, phi, nx: Math.sin(phi), ny: -Math.cos(phi) });
  }
  return out;
}

/** The room light, as a unit vector in the card plane (upper left). */
const LIGHT: [number, number] = (() => {
  const x = -0.55;
  const y = -0.83;
  const n = Math.hypot(x, y);
  return [x / n, y / n];
})();

/** How much a wall faces the light, -1..1. */
export function facing(nx: number, ny: number) {
  return nx * LIGHT[0] + ny * LIGHT[1];
}

/**
 * The cut edge (owner 2026-10-17, templates.ts): the template's material in --edge-fill, set per design on the scene,
 * so a wall built once follows every face swap. The wall's top is the card's back, its bottom the face. Shaded once
 * against the room light by a flat veil; the shine that moves with the angle is the wall's ::after (card3d.css).
 */
export function paintEdge(nx: number, ny: number) {
  const d = facing(nx, ny);
  const veil = d >= 0 ? `rgb(255 255 255 / ${(0.3 * d).toFixed(3)})` : `rgb(20 14 6 / ${(-0.32 * d).toFixed(3)})`;
  return `linear-gradient(${veil}, ${veil}), var(--edge-fill, linear-gradient(#e9e1cf, #e9e1cf))`;
}

/** Acrylic: translucent blue-white with bright face rims. */
export function paintAcrylic(nx: number, ny: number) {
  const d = facing(nx, ny);
  const a = (0.34 + 0.16 * d).toFixed(3);
  return `linear-gradient(to bottom, rgb(255 255 255 / 0.95) 0 7%, rgb(214 228 238 / ${a}) 24%, rgb(188 206 222 / ${a}) 50%, rgb(214 228 238 / ${a}) 76%, rgb(255 255 255 / 0.95) 93%)`;
}

/**
 * Build the walls into `host` (once; cqw geometry needs no rebuild). `thick` is the CSS length of the wall
 * height, e.g. "var(--t)". Each wall carries its outward normal (--nx, --ny) for the shine (card3d.css). Returns
 * the number of walls.
 */
export function extrude(host: HTMLElement, box: EdgeBox, seg: number, thick: string, paint: (nx: number, ny: number) => string) {
  if (host.childElementCount) return host.childElementCount;
  const frag = document.createDocumentFragment();
  const list = walls(box, seg);
  const mesh: EdgeMesh = { box, parts: [], culled: false };
  for (const wl of list) {
    const b = document.createElement("b");
    b.style.cssText =
      `width:calc(${wl.len.toFixed(3)}cqw + 0.7px);height:${thick};` +
      `left:calc(${wl.left.toFixed(3)}cqw - 0.35px);top:calc(${wl.top.toFixed(3)}cqw - ${thick} / 2);` +
      `transform:rotateZ(${wl.phi.toFixed(4)}rad) rotateX(90deg);background:${paint(wl.nx, wl.ny)};` +
      `--nx:${wl.nx.toFixed(3)};--ny:${wl.ny.toFixed(3)}`;
    frag.appendChild(b);
    mesh.parts.push({ el: b, wall: wl, shown: true });
  }
  meshes.set(host, mesh);
  host.appendChild(frag);
  return list.length;
}
