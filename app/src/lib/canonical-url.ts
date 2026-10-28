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
