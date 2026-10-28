import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "../../lib/bindings.server";
import {
  ART_VARIANT_MAX_BYTES,
  ART_WIDTHS,
  artVariantKey,
  imageSize,
  variantFits,
  type ArtWidth,
} from "../../lib/mintdex/server/art.server";
import { userFromRequest } from "../../lib/mintdex/server/auth.server";

const TYPES: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};
const MAX_BYTES = 4 * 1024 * 1024;
const IMMUTABLE = "public, max-age=31536000, immutable";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Sniff the real image type from magic bytes; never trust the client's label. */
function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    return "image/webp";
  }
  return null;
}

/**
 * POST multipart: `file` (the art, required) plus optional ready-made smaller copies `w96`, `w320`, `w800`
 * (WebP, PNG or JPEG) for thumbnails and grid cards (backlog P1-4), made by the launch page from the same
 * canvas. A copy that is missing, too big, not an image or not the original's shape at its width is skipped;
 * the original still uploads and /api/img falls back to it. Answers { ok, url, widths }.
 */
export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await userFromRequest(request);
        if (!user) return json({ ok: false, error: "Enter CardDex first to upload art." }, 401);
        const { STORAGE } = bindings();
        if (!STORAGE) return json({ ok: false, error: "Uploads are not available right now." }, 503);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return json({ ok: false, error: "That upload did not come through. Try again." }, 400);
        }
        const file = form.get("file");
        if (!(file instanceof File)) return json({ ok: false, error: "Choose an image to upload." }, 400);
        if (file.size > MAX_BYTES) return json({ ok: false, error: "Images must be under 4 MB." }, 413);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const type = sniff(bytes);
        if (!type || !TYPES[type]) {
          return json({ ok: false, error: "Use a PNG, JPG, WEBP or GIF image." }, 415);
        }
        const key = `art/${crypto.randomUUID()}.${TYPES[type]}`;
        // An animated GIF keeps its motion: no still copies for it. Anything else needs a readable size.
        const size = type === "image/gif" ? null : imageSize(bytes);

        // Sized copies first, so the original (the URL the client keeps) only exists once its copies do. A copy
        // is kept only when it is the original's shape at its width (variantFits).
        const variants = await Promise.all(
          ART_WIDTHS.map(async (w: ArtWidth) => {
            if (!size) return null;
            const part = form.get(`w${w}`);
            if (!(part instanceof File) || part.size === 0 || part.size > ART_VARIANT_MAX_BYTES[w]) return null;
            const vb = new Uint8Array(await part.arrayBuffer());
            const vt = sniff(vb);
            if (!vt || vt === "image/gif") return null;
            const vs = imageSize(vb);
            if (!vs || !variantFits(size, vs, w)) return null;
            await STORAGE.put(artVariantKey(key, w), vb, {
              httpMetadata: { contentType: vt, cacheControl: IMMUTABLE },
              customMetadata: { uploader: user.id, width: String(w) },
            });
            return w;
          }),
        );

        await STORAGE.put(key, bytes, {
          httpMetadata: { contentType: type, cacheControl: IMMUTABLE },
          customMetadata: { uploader: user.id },
        });
        return json({ ok: true, url: `/api/img/${key}`, widths: variants.filter((w): w is ArtWidth => w != null) });
      },
    },
  },
});
