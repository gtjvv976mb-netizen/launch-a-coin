import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders } from "./lib/security-headers.server";
import { canonicalRedirect } from "./lib/canonical-url";

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
      return applySecurityHeaders(await normalizeCatastrophicSsrResponse(response), url);
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
