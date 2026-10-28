import { createFileRoute } from "@tanstack/react-router";

import { bindings } from "../../../lib/bindings.server";
import { artVariantKey, pickArtWidth } from "../../../lib/mintdex/server/art.server";

const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    // Short, so an upload that lands a moment later is not hidden for long.
    headers: { "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" },
  });

/**
 * Uploaded coin art (backlog P1-4, server half). `?w=` asks for a width that fits where the image appears:
 * the server answers with the smallest stored variant at least that wide (96, 320 or 800 px WebP, written at
 * upload) and falls back to the original when the upload has no variants. Every URL is immutable, because an
 * upload never changes after it is stored (new art is a new uuid), so browsers and the edge keep it a year.
 */
export const Route = createFileRoute("/api/img/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const key = params._splat ?? "";
        if (!/^art\/[a-f0-9-]{36}\.(webp|png|jpg|gif)$/.test(key)) return NOT_FOUND();
        const { STORAGE } = bindings();
        if (!STORAGE) return NOT_FOUND();

        const width = pickArtWidth(new URL(request.url).searchParams.get("w"));
        // onlyIf with the request headers: R2 itself answers If-None-Match (no body when the copy is current).
        // (Cast: workers-types declares its own Headers type; at runtime it is the same object.)
        const onlyIf = request.headers as never;
        let obj = width ? await STORAGE.get(artVariantKey(key, width), { onlyIf }) : null;
        if (!obj) obj = await STORAGE.get(key, { onlyIf });
        if (!obj) return NOT_FOUND();

        const headers: Record<string, string> = {
          "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          etag: obj.httpEtag,
        };
        // onlyIf matched the client's copy: R2 returns the object's metadata without a body.
        if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
        return new Response(obj.body as unknown as ReadableStream, { headers });
      },
    },
  },
});
