import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders } from "./lib/security-headers.server";
import { canonicalRedirect, isMirrorHost, mirrorRedirect } from "./lib/canonical-url";
import { limitRequestBody } from "./lib/request-limits";

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
  const cacheControl = response.headers.get("cache-control");
  // Pages embed the viewer's own session data (the demo account, Portfolio): never kept by a shared cache, including a
  // page whose server function asked only for revalidation (/launch's readiness sets "no-cache").
  const privatize = html && !/\b(?:public|private)\b/i.test(cacheControl ?? "");
  // The owner's private tools (/admin/*): never indexed on any host, never kept by any cache.
  const admin = url.pathname.startsWith("/admin/");
  if (!privatize && !mirror && !admin) return response;
  const headers = new Headers(response.headers);
  if (privatize) headers.set("Cache-Control", cacheControl ? `private, ${cacheControl}` : "private, no-cache");
  if (admin) headers.set("Cache-Control", "private, no-store");
  if (mirror || admin) headers.set("X-Robots-Tag", "noindex");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The part of workerd's HTMLRewriter this entry uses (the Worker types are not in tsconfig). */
type Rewriter = {
  on(selector: string, handlers: { element(element: { setAttribute(name: string, value: string): void }): void }): Rewriter;
  transform(response: Response): Response;
};
declare const HTMLRewriter: (new () => Rewriter) | undefined;

/**
 * The client bundle hydrates a page the server already painted, so the browser fetches it after the stylesheets, the
 * fonts and the card images it can see (PERF: the largest paint on a phone is a card skin, and the 250KB bundle at
 * TanStack's default High priority shared the first round trips with them). Clicks before hydration still follow the
 * page's real links. Pages only; workerd always provides HTMLRewriter.
 */
function lowerScriptPriority(response: Response): Response {
  if (typeof HTMLRewriter === "undefined" || !(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const low = { element(element: { setAttribute(name: string, value: string): void }) { element.setAttribute("fetchpriority", "low"); } };
  return new HTMLRewriter().on('link[rel="modulepreload"]', low).on('script[type="module"][src]', low).transform(response);
}

/** The parts of workerd's scheduled() arguments this entry uses (the Worker types are not in tsconfig). */
type ScheduledController = { cron: string; scheduledTime: number };
type ScheduledContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  /**
   * The cron trigger (wrangler `triggers.crons`, added in the Cloudflare dashboard for production: README "Announcements
   * on @launchacard"): posts at most one approved new-coin announcement per run, on the cron's scheduled time. Off
   * unless CARDDEX_X_AUTOPOST is "true" with its secrets; loaded lazily so page requests never load it.
   */
  async scheduled(controller: ScheduledController, _env: unknown, ctx: ScheduledContext) {
    ctx.waitUntil(import("./lib/carddex/live/x-announce.server").then(m => m.runXAutoPost({scheduledAt: controller.scheduledTime})).catch(error => console.error("x_announce_cron_failed", error instanceof Error ? error.name : "error")));
  },
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // One canonical hop also keeps www wallet pages on the configured origin.
    const url = new URL(request.url);
    const redirect = canonicalRedirect(url) ?? mirrorRedirect(request, url, (env as { CARDDEX_MIRROR_REDIRECT?: string } | null)?.CARDDEX_MIRROR_REDIRECT?.trim().toLowerCase() === "true");
    if (redirect) {
      return applySecurityHeaders(Response.redirect(redirect.location, redirect.status), url);
    }
    const limited = await limitRequestBody(request, url);
    if (limited instanceof Response) return applySecurityHeaders(limited, url);
    request = limited;
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
      return applySiteHeaders(applySecurityHeaders(lowerScriptPriority(await normalizeCatastrophicSsrResponse(response)), url), url);
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
