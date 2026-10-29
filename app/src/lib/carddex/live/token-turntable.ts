import { GIFEncoder, quantize } from "gifenc";

/** Increment when the permanent token animation's composition or encoding changes. */
export const TOKEN_ANIMATION_FORMAT = "launchacard-turntable-gif-v1";
export const TOKEN_ANIMATION_SIZE = 1024;
export const TOKEN_ANIMATION_FRAMES = 64;
export const TOKEN_ANIMATION_FRAME_MS = 40;
export const TOKEN_ANIMATION_HOLD_MS = 600;
export const TOKEN_ANIMATION_MAX_BYTES = 12 * 1024 * 1024;
export const TOKEN_ANIMATION_CARD_HEIGHT = TOKEN_ANIMATION_SIZE * .76;
export const TOKEN_ANIMATION_BACKGROUND = Object.freeze([245, 239, 226] as const);

export type TokenCardPixels = { pixels: Uint8Array; width: number; height: number };
type IndexedFace = { pixels: Uint8Array; width: number; height: number };
const ASPECT = 63 / 88;
const CARD_WIDTH = TOKEN_ANIMATION_CARD_HEIGHT * ASPECT;
const DISTANCE = TOKEN_ANIMATION_SIZE * 3;
const HALF = TOKEN_ANIMATION_SIZE / 2;
const SAMPLE_PIXELS = 120_000;

function validateFace(face: TokenCardPixels) {
  if (!face || !(face.pixels instanceof Uint8Array) || !Number.isInteger(face.width) || !Number.isInteger(face.height)
    || face.width < 2 || face.height < 2 || face.width > 2048 || face.height > 2048
    || face.pixels.length !== face.width * face.height * 4 || Math.abs(face.width / face.height - ASPECT) > .015) {
    throw new Error("Supply complete RGBA card faces in the canonical 63:88 proportions.");
  }
}

function paletteFor(front: TokenCardPixels, back: TokenCardPixels): number[][] {
  // Quantize a bounded, tightly packed sample. gifenc reads the entire backing
  // ArrayBuffer, so never pass a subarray of the renderer's WebAssembly memory.
  const count = front.width * front.height + back.width * back.height;
  const stride = Math.max(1, Math.ceil(count / SAMPLE_PIXELS));
  const sample = new Uint8Array((Math.ceil(front.width * front.height / stride) + Math.ceil(back.width * back.height / stride)) * 4);
  let output = 0;
  for (const face of [front, back]) {
    for (let pixel = 0; pixel < face.width * face.height; pixel += stride) {
      const offset = pixel * 4, alpha = face.pixels[offset + 3] / 255;
      for (let channel = 0; channel < 3; channel++) sample[output++] = Math.round(face.pixels[offset + channel] * alpha + TOKEN_ANIMATION_BACKGROUND[channel] * (1 - alpha));
      sample[output++] = 255;
    }
  }
  const palette = quantize(sample, 124);
  // Stable matte and edge colors are explicit entries, independent of artwork.
  palette.push([...TOKEN_ANIMATION_BACKGROUND], [173, 133, 66], [222, 204, 158], [91, 70, 48]);
  return palette;
}

function indexFace(face: TokenCardPixels, palette: number[][], cache: Int16Array): IndexedFace {
  const indexed = new Uint8Array(face.width * face.height);
  for (let pixel = 0; pixel < indexed.length; pixel++) {
    const offset = pixel * 4, alpha = face.pixels[offset + 3] / 255;
    const r = Math.round(face.pixels[offset] * alpha + TOKEN_ANIMATION_BACKGROUND[0] * (1 - alpha));
    const g = Math.round(face.pixels[offset + 1] * alpha + TOKEN_ANIMATION_BACKGROUND[1] * (1 - alpha));
    const b = Math.round(face.pixels[offset + 2] * alpha + TOKEN_ANIMATION_BACKGROUND[2] * (1 - alpha));
    const key = (r >> 3) << 11 | (g >> 2) << 5 | b >> 3;
    let nearest = cache[key];
    if (nearest < 0) {
      let distance = Infinity;
      for (let index = 0; index < palette.length; index++) {
        const color = palette[index], candidate = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
        if (candidate < distance) { distance = candidate; nearest = index; }
      }
      cache[key] = nearest;
    }
    indexed[pixel] = nearest;
  }
  // Source WebPs may be opaque rectangles. Keep the same rounded card edge on
  // both faces without relying on a particular source file's alpha channel.
  const radius = face.width * .0504, extent = Math.ceil(radius), background = palette.length - 4;
  for (let y = 0; y < extent; y++) for (let x = 0; x < extent; x++) {
    if ((radius - x - .5) ** 2 + (radius - y - .5) ** 2 <= radius ** 2) continue;
    indexed[y * face.width + x] = background;
    indexed[y * face.width + face.width - x - 1] = background;
    indexed[(face.height - y - 1) * face.width + x] = background;
    indexed[(face.height - y - 1) * face.width + face.width - x - 1] = background;
  }
  return {pixels: indexed, width: face.width, height: face.height};
}

/** The projected corners also document and test the complete circular-crop-safe silhouette. */
export function tokenTurntableCorners(angle: number): ReadonlyArray<readonly [number, number]> {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return [-1, 1].flatMap(horizontal => [-1, 1].map(vertical => {
    const x = horizontal * CARD_WIDTH / 2, perspective = DISTANCE / (DISTANCE + x * sine);
    return [HALF + x * cosine * perspective, HALF + vertical * TOKEN_ANIMATION_CARD_HEIGHT / 2 * perspective] as const;
  }));
}

function projectFrame(target: Uint8Array, front: IndexedFace, back: IndexedFace, angle: number, background: number, edge: number, highlight: number) {
  target.fill(background);
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  if (Math.abs(cosine) < .025) {
    // A real, thin card edge at the two quarter turns, rather than a vanishing
    // plane or an accidentally mirrored front.
    const top = Math.ceil(HALF - TOKEN_ANIMATION_CARD_HEIGHT / 2), bottom = Math.floor(HALF + TOKEN_ANIMATION_CARD_HEIGHT / 2);
    for (let y = top; y <= bottom; y++) {
      target[y * TOKEN_ANIMATION_SIZE + HALF - 1] = edge;
      target[y * TOKEN_ANIMATION_SIZE + HALF] = highlight;
      target[y * TOKEN_ANIMATION_SIZE + HALF + 1] = edge;
    }
    return;
  }
  const face = cosine >= 0 ? front : back;
  const corners = tokenTurntableCorners(angle);
  const left = Math.max(0, Math.floor(Math.min(...corners.map(point => point[0]))));
  const right = Math.min(TOKEN_ANIMATION_SIZE - 1, Math.ceil(Math.max(...corners.map(point => point[0]))));
  const top = Math.max(0, Math.floor(Math.min(...corners.map(point => point[1]))));
  const bottom = Math.min(TOKEN_ANIMATION_SIZE - 1, Math.ceil(Math.max(...corners.map(point => point[1]))));
  // Inverse perspective mapping consumes already indexed textures. Only one
  // 1 MB output frame exists at a time; 64 full RGBA frames are never retained.
  for (let x = left; x <= right; x++) {
    const dx = x + .5 - HALF, denominator = DISTANCE * cosine - dx * sine;
    const worldX = dx * DISTANCE / denominator;
    const u = .5 + (cosine >= 0 ? worldX : -worldX) / CARD_WIDTH;
    if (u < 0 || u >= 1) continue;
    const sourceX = Math.min(face.width - 1, Math.floor(u * face.width));
    const inversePerspective = (DISTANCE + worldX * sine) / DISTANCE;
    for (let y = top; y <= bottom; y++) {
      const v = .5 + (y + .5 - HALF) * inversePerspective / TOKEN_ANIMATION_CARD_HEIGHT;
      if (v < 0 || v >= 1) continue;
      const sourceY = Math.min(face.height - 1, Math.floor(v * face.height));
      target[y * TOKEN_ANIMATION_SIZE + x] = face.pixels[sourceY * face.width + sourceX];
    }
  }
}

/** Pure JavaScript encoder: no canvas, filesystem, browser, network, native code or dynamic Wasm. */
export function encodeTokenTurntable(front: TokenCardPixels, back: TokenCardPixels): Uint8Array {
  validateFace(front); validateFace(back);
  const palette = paletteFor(front, back), background = palette.length - 4;
  const cache = new Int16Array(65_536); cache.fill(-1);
  const indexedFront = indexFace(front, palette, cache), indexedBack = indexFace(back, palette, cache);
  const frame = new Uint8Array(TOKEN_ANIMATION_SIZE * TOKEN_ANIMATION_SIZE);
  const gif = GIFEncoder({initialCapacity: 8 * 1024 * 1024});
  for (let index = 0; index < TOKEN_ANIMATION_FRAMES; index++) {
    projectFrame(frame, indexedFront, indexedBack, index / TOKEN_ANIMATION_FRAMES * Math.PI * 2, background, background + 1, background + 2);
    gif.writeFrame(frame, TOKEN_ANIMATION_SIZE, TOKEN_ANIMATION_SIZE, {
      ...(index === 0 ? {palette} : {}),
      repeat: 0,
      colorDepth: 7,
      delay: index === 0 || index === TOKEN_ANIMATION_FRAMES / 2 ? TOKEN_ANIMATION_HOLD_MS : TOKEN_ANIMATION_FRAME_MS,
      dispose: 1,
    });
    if (gif.bytesView().byteLength > TOKEN_ANIMATION_MAX_BYTES) throw new Error("The complete token animation exceeds the public image size limit.");
  }
  gif.finish();
  const bytes = gif.bytesView();
  if (bytes.byteLength > TOKEN_ANIMATION_MAX_BYTES) throw new Error("The complete token animation exceeds the public image size limit.");
  // The encoder is private and is never reused: returning its final bounded
  // view avoids a second multi-megabyte copy before immutable asset storage.
  return bytes;
}
