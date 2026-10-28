import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders } from "./lib/security-headers.server";
import { canonicalRedirect, isMirrorHost } from "./lib/canonical-url";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Caching and indexing for what the Worker answers (static files take theirs from public/_headers): pages are
 * revalidated on every visit unless a route set its own Cache-Control, and mirrors (workers.dev, the launchacard.com
 * zone's own hosts, local dev) are never indexed, so search keeps launchacard.fun.
 */
function applySiteHeaders(response: Response, url: URL): Response {
  const html = (response.headers.get("content-type") ?? "").includes("text/html");
  const mirror = isMirrorHost(url.hostname);
  if (!(html && !response.headers.has("cache-control")) && !mirror) return response;
  const headers = new Headers(response.headers);
  if (html && !headers.has("cache-control")) headers.set("Cache-Control", "no-cache");
  if (mirror) headers.set("X-Robots-Tag", "noindex");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // One canonical hop also keeps www wallet pages on the configured origin.
    const url = new URL(request.url);
    const redirect = canonicalRedirect(url);
    if (redirect) {
      return applySecurityHeaders(Response.redirect(redirect.location, redirect.status), url);
    }
    // Devnet: a ticker typed with its "$" (/coin/$HONK) reaches the router without it, so the coin loader's single
    // 301 goes straight to /coin/{mint} (the router's own "$" rewrite in router.tsx would answer a 307 first).
    // (The mode test is inlined, as in lib/mintdex/mode.ts, so the entry chunk exports nothing but this object.)
    let req = request;
    if (false && /^\/coin\/(?:\$|%24)/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/^\/coin\/(?:\$|%24)+/i, "/coin/");
      req = new Request(url.toString(), request);
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(req, env, ctx);
      return applySiteHeaders(applySecurityHeaders(await normalizeCatastrophicSsrResponse(response), url), url);
    } catch (error) {
      console.error(error);
      return applySecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        url,
      );
    }
  },
};
