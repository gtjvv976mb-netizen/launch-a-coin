import { describe, expect, test } from "bun:test";
import { applySecurityHeaders } from "../../src/lib/security-headers.server";

describe("public-site framing protection", () => {
  test("protects the public sites and direct Cloudflare origins without dropping existing response headers", async () => {
    for (const origin of [
      "https://launchacard.fun",
      "https://www.launchacard.fun",
      "https://launch-a-card.gtjvv976mb.workers.dev",
    ]) {
      const result = applySecurityHeaders(
        new Response("Launch a Card", { headers: { "cache-control": "private, no-store", "content-type": "text/html" } }),
        new URL(`${origin}/levels`),
      );
      expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
      expect(result.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      expect(result.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await result.text()).toBe("Launch a Card");
    }
  });

  test("preserves the platform-managed design preview and does not match lookalike hosts", () => {
    for (const origin of [
      "https://carddex.higgsfield.app",
      "https://carddex.higgsfield-dev.app",
      "http://127.0.0.1:5296",
      "https://launchacard.fun.example.com",
      "https://notlaunchacard.fun",
    ]) {
      const result = applySecurityHeaders(new Response("preview"), new URL(origin));
      expect(result.headers.get("content-security-policy")).not.toContain("frame-ancestors");
      expect(result.headers.get("x-frame-options")).toBeNull();
    }
    expect(applySecurityHeaders(new Response("unknown host")).headers.get("x-frame-options")).toBeNull();
  });

  test("protects error responses and redirects while preserving their semantics", async () => {
    const origin = new URL("https://launchacard.fun/levels");
    const error = applySecurityHeaders(new Response("Try again", { status: 500 }), origin);
    expect(error.status).toBe(500);
    expect(error.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(await error.text()).toBe("Try again");
    const redirect = applySecurityHeaders(Response.redirect(origin, 301), origin);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe(origin.href);
    expect(redirect.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});

describe("per-response policies and every Launch a Card host", () => {
  test("a response that set its own CSP keeps it (public launch images and metadata), with framing protection added", () => {
    for (const path of ["/api/live/assets/" + "a".repeat(64) + ".png", "/m/" + "b".repeat(43)]) {
      const served = applySecurityHeaders(new Response("{}", { headers: { "content-security-policy": "default-src 'none'; sandbox", "content-type": "application/json" } }), new URL(`https://launchacard.fun${path}`));
      expect(served.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox; frame-ancestors 'self'");
      expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    }
    const page = applySecurityHeaders(new Response("page", { headers: { "content-type": "text/html" } }), new URL("https://launchacard.fun/launch"));
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
    expect(page.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(page.headers.get("permissions-policy")).toContain("payment=()");
  });
  test("the launchacard.com zone's hosts and the SaaS fallback origin cannot be framed either", () => {
    for (const host of ["launchacard.com", "edge.launchacard.com", "www.launchacard.com", "anything.launchacard.com", "shop.launchacard.fun", "launchacard.fun."]) {
      const result = applySecurityHeaders(new Response("mirror"), new URL(`https://${host}/launch`));
      expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
      expect(result.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    }
  });
});

describe("request body limits at the Worker entry", async () => {
  const { limitRequestBody } = await import("../../src/lib/request-limits");
  const chunked = (bytes: number) => new ReadableStream<Uint8Array>({ start(controller) { for (let sent = 0; sent < bytes; sent += 16_384) controller.enqueue(new Uint8Array(Math.min(16_384, bytes - sent))); controller.close(); } });
  const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) => new Request(`https://launchacard.fun${path}`, { method: "POST", body, headers, duplex: "half" } as RequestInit);
  test("a declared length over the path's limit is refused before anything reads it", async () => {
    const refused = await limitRequestBody(post("/_serverFn/abc", "x", { "content-length": String(64 * 1024 + 1) }), new URL("https://launchacard.fun/_serverFn/abc"));
    expect(refused).toBeInstanceOf(Response); expect((refused as Response).status).toBe(413);
    const fits = post("/_serverFn/abc", JSON.stringify({ a: 1 }), { "content-length": "7" });
    expect(await limitRequestBody(fits, new URL(fits.url))).toBe(fits);
  });
  test("a body without a Content-Length is read only up to the limit, and a body within it reaches the handler intact", async () => {
    const big = post("/_serverFn/abc", chunked(70_000));
    expect(big.headers.get("content-length")).toBeNull();
    expect(((await limitRequestBody(big, new URL(big.url))) as Response).status).toBe(413);
    const small = post("/api/live/compose", chunked(100_000));
    const passed = await limitRequestBody(small, new URL(small.url));
    expect(passed).toBeInstanceOf(Request); expect((await (passed as Request).arrayBuffer()).byteLength).toBe(100_000);
    const compose = post("/api/live/compose", chunked(5 * 1024 * 1024 + 1));
    expect(((await limitRequestBody(compose, new URL(compose.url))) as Response).status).toBe(413);
  });
  test("reads are never touched", async () => {
    const get = new Request("https://launchacard.fun/launch");
    expect(await limitRequestBody(get, new URL(get.url))).toBe(get);
  });
});

describe("edge-cached public answers", async () => {
  const { edgeCached } = await import("../../src/lib/edge-cache");
  test("one handler run per window and key, whatever the query string; the client copy keeps no-store", async () => {
    const store = new Map<string, Response>();
    (globalThis as any).caches = { default: { match: async (request: Request) => store.get(request.url)?.clone(), put: async (request: Request, response: Response) => { store.set(request.url, response); } } };
    try {
      let runs = 0;
      const make = async () => { runs++; return Response.json({ ok: true, runs }, { headers: { "cache-control": "no-store" } }); };
      const first = await edgeCached(new Request("https://launchacard.fun/api/live/health?bust=1"), "/api/live/health", 15, make);
      const second = await edgeCached(new Request("https://launchacard.fun/api/live/health?bust=2"), "/api/live/health", 15, make);
      expect(runs).toBe(1);
      expect(await second.json()).toEqual({ ok: true, runs: 1 });
      for (const answer of [first, second]) expect(answer.headers.get("cache-control")).toBe("no-store");
      expect(second.headers.get("x-client-cache-control")).toBeNull();
      expect(store.get("https://launchacard.fun/api/live/health")!.headers.get("cache-control")).toBe("public, max-age=15");
    } finally { delete (globalThis as any).caches; }
  });
});
