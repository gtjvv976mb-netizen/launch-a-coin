type EdgeCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };

/**
 * A public, keyless answer kept in this colo's Cloudflare cache for `seconds` under a fixed key (the query string is
 * ignored, so cache-busting parameters cannot force fresh work). The copy given to the client keeps the handler's own
 * Cache-Control. Without a Cache API (local tools, tests), or when it fails, the handler simply runs.
 */
export async function edgeCached(request: Request, path: string, seconds: number, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!cache) return make();
  const key = new Request(new URL(path, request.url).href, { method: "GET" });
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set("cache-control", hit.headers.get("x-client-cache-control") ?? "no-store");
    headers.delete("x-client-cache-control");
    return new Response(hit.body, { status: hit.status, headers });
  }
  const response = await make();
  const stored = new Headers(response.headers);
  stored.set("x-client-cache-control", response.headers.get("cache-control") ?? "no-store");
  stored.set("cache-control", `public, max-age=${seconds}`);
  await cache.put(key, new Response(await response.clone().arrayBuffer(), { status: response.status, headers: stored })).catch(() => undefined);
  return response;
}
