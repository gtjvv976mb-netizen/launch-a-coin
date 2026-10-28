// Sized copies of uploaded coin art (backlog P1-4, server half).
//
// The upload stores the original under art/{uuid}.{ext}. The browser may also send ready-made smaller copies
// (form fields w96, w320, w800: it already decodes the image for the preview, so resizing there costs nothing
// and needs no image library in the Worker). They are stored next to the original as art/{uuid}-w{width}.
// GET /api/img/art/{uuid}.{ext}?w=N then serves the smallest copy at least N px wide, else the original.

export const ART_WIDTHS = [96, 320, 800] as const;
export type ArtWidth = (typeof ART_WIDTHS)[number];

/** Byte caps per copy: generous for WebP at these sizes, small enough that a copy is always a real saving. */
export const ART_VARIANT_MAX_BYTES: Record<ArtWidth, number> = { 96: 64 * 1024, 320: 320 * 1024, 800: 1024 * 1024 };

/** The stored width to serve for a requested ?w=, or null for the original (no or bad value, or wider than 800). */
export function pickArtWidth(w: string | null): ArtWidth | null {
  if (!w) return null;
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const a of ART_WIDTHS) if (n <= a) return a;
  return null;
}

/** "art/{uuid}.png" -> "art/{uuid}-w96". Not reachable as a path of its own: only through ?w=. */
export function artVariantKey(originalKey: string, width: ArtWidth): string {
  return `${originalKey.replace(/\.[a-z]+$/, "")}-w${width}`;
}

/** Pixel size from an image header (PNG, JPEG, WebP, GIF), or null when it cannot be read. No decoding. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length < 30) return null;
  // PNG: IHDR is the first chunk, width and height big-endian at 16 and 20.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { w: (u16be(16) << 16) | u16be(18), h: (u16be(20) << 16) | u16be(22) };
  }
  // GIF: logical screen size, little-endian at 6 and 8.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16le(6), h: u16le(8) };
  // WebP: RIFF....WEBP then a VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk.
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === "VP8 ") return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (fourcc === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === "VP8X") return { w: u24le(24) + 1, h: u24le(27) + 1 };
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame (SOF0 to SOF15, not DHT, JPG or DAC).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
        i += 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { w: u16be(i + 7), h: u16be(i + 5) };
      }
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

/**
 * A sized copy is kept only when it really is the original at that width: `width` px wide (or the original's
 * width, when the original is narrower) and the original's shape. The Worker has no image decoder, so the
 * pixels themselves cannot be compared; every surface that shows a copy (cards, thumbs, the share preview at
 * ?w=800) reads the copies, so the art a coin shows stays one upload either way.
 */
export function variantFits(original: { w: number; h: number }, copy: { w: number; h: number }, width: ArtWidth) {
  const want = Math.min(width, original.w);
  return Math.abs(copy.w - want) <= 1 && Math.abs(copy.h / copy.w - original.h / original.w) <= 0.02;
}
