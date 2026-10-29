/** Keep wallet pages on their configured origin, preserving design and quote links. */
export function canonicalRedirect(requestUrl: URL): { location: string; status: 301 | 308 } | null {
  const url = new URL(requestUrl);
  const owned = url.hostname === "launchacard.fun" || url.hostname === "www.launchacard.fun";
  const originChanged = owned && (url.hostname !== "launchacard.fun" || url.protocol !== "https:" || url.port !== "");
  if (originChanged) {
    url.protocol = "https:";
    url.hostname = "launchacard.fun";
    url.port = "";
  }
  const trailingSlash = url.pathname.length > 1 && url.pathname.endsWith("/");
  if (trailingSlash) url.pathname = url.pathname.replace(/\/+$/, "");
  return originChanged || trailingSlash ? { location: url.href, status: originChanged ? 308 : 301 } : null;
}

/**
 * Every host but launchacard.fun and www.launchacard.fun is a mirror: the workers.dev URL, the launchacard.com SaaS
 * zone that hosts the site (its catch-all route also answers launchacard.com and the fallback origin edge.launchacard.com)
 * and local dev. Mirrors are never indexed (SEO-4), so search keeps launchacard.fun.
 */
export function isMirrorHost(hostname: string): boolean {
  return !/^(?:www\.)?launchacard\.fun$/i.test(hostname);
}

/** The one public origin wallet pages run on; sign-in messages and every live action are bound to it. */
export const PUBLIC_SITE_ORIGIN = "https://launchacard.fun";
/** Paths a mirror keeps answering itself: APIs, metadata, assets, server functions, crawler files and probes. */
const MIRROR_KEEPS = /^\/(?:api|m|assets|fonts|og|_serverFn|\.well-known)(?:\/|$)|^\/(?:robots\.txt|sitemap\.xml|favicon\.ico)$/;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/i;
/**
 * A page view on a mirror host (workers.dev, launchacard.com, edge.launchacard.com, or any host but launchacard.fun),
 * sent to the same path on launchacard.fun (P2-9): a wallet prompt there would show the mirror's own new-domain notice,
 * and Phantom refuses a sign-in whose domain is not the page's. Only browser page navigations move (GET or HEAD with
 * an HTML Accept, a path with no file extension); APIs, /m/ metadata, launch assets, static files, server functions,
 * robots.txt, /api/live/health and certificate checks keep answering on every host. Temporary (307), so turning it
 * off takes effect at once. Off unless CARDDEX_MIRROR_REDIRECT is "true": the owner turns it on once launchacard.fun is
 * reachable for everyone (after the Cloudflare for SaaS apex cutover), since it would otherwise send visitors on
 * networks that cannot reach the apex away from the mirror they can use.
 */
export function mirrorRedirect(request: Pick<Request, "method" | "headers">, requestUrl: URL, enabled: boolean): { location: string; status: 307 } | null {
  if (!enabled || !isMirrorHost(requestUrl.hostname) || LOCAL_HOST.test(requestUrl.hostname)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (MIRROR_KEEPS.test(requestUrl.pathname) || /\.[a-z0-9]{1,8}$/i.test(requestUrl.pathname)) return null;
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return null;
  return { location: `${PUBLIC_SITE_ORIGIN}${requestUrl.pathname}${requestUrl.search}`, status: 307 };
}
