import { describe, expect, test } from "bun:test";
import { canonicalRedirect, isMirrorHost } from "../../src/lib/canonical-url";

describe("public wallet origin", () => {
  test("preserves design, quote and encoded values in one www/HTTPS/slash redirect", () => {
    expect(canonicalRedirect(new URL("http://www.launchacard.fun/launch/?design=stock-tsla&quote=tslax&name=A%2BB")))
      .toEqual({ location: "https://launchacard.fun/launch?design=stock-tsla&quote=tslax&name=A%2BB", status: 308 });
    expect(canonicalRedirect(new URL("http://launchacard.fun/")))
      .toEqual({ location: "https://launchacard.fun/", status: 308 });
    expect(canonicalRedirect(new URL("https://launchacard.fun/launch?design=doge"))).toBeNull();
  });
  test("does not claim lookalike, preview or unrelated domains", () => {
    for (const host of ["launchacard.fun.example.com", "www.launchacard.fun.example.com", "mintdex.fun", "127.0.0.1:5310", "launch-a-card.gtjvv976mb.workers.dev"]) {
      expect(canonicalRedirect(new URL(`http://${host}/launch?quote=sol`))).toBeNull();
    }
    expect(canonicalRedirect(new URL("http://127.0.0.1:5310/levels/")))
      .toEqual({ location: "http://127.0.0.1:5310/levels", status: 301 });
  });
  test("indexes only launchacard.fun and www; every other host that reaches the Worker is a mirror", () => {
    for (const host of ["launchacard.fun", "www.launchacard.fun"]) expect(isMirrorHost(new URL(`https://${host}/`).hostname)).toBe(false);
    for (const host of ["launch-a-card.gtjvv976mb.workers.dev", "edge.launchacard.com", "launchacard.com", "www.launchacard.com", "launchacard.fun.example.com", "xlaunchacard.fun", "127.0.0.1:5480", "localhost:5480"]) {
      expect(isMirrorHost(new URL(`https://${host}/`).hostname)).toBe(true);
    }
  });
});

describe("mirror page views (P2-9), behind CARDDEX_MIRROR_REDIRECT", async () => {
  const { mirrorRedirect } = await import("../../src/lib/canonical-url");
  const page = (url: string, method = "GET", accept = "text/html,application/xhtml+xml") => [{ method, headers: new Headers({ accept }) }, new URL(url)] as const;
  test("off unless switched on", () => {
    expect(mirrorRedirect(...page("https://edge.launchacard.com/launch?design=doge"), false)).toBeNull();
  });
  test("a page view on any mirror moves to the same path and query on launchacard.fun, temporarily", () => {
    for (const host of ["edge.launchacard.com", "launchacard.com", "www.launchacard.com", "launch-a-card.gtjvv976mb.workers.dev", "launchacard.fun."]) {
      expect(mirrorRedirect(...page(`https://${host}/launch?design=stock-tsla&quote=tslax`), true))
        .toEqual({ location: "https://launchacard.fun/launch?design=stock-tsla&quote=tslax", status: 307 });
    }
    expect(mirrorRedirect(...page("https://edge.launchacard.com/"), true)).toEqual({ location: "https://launchacard.fun/", status: 307 });
  });
  test("launchacard.fun itself (including SaaS traffic arriving through the fallback origin), local dev, APIs, metadata, assets and probes never move", () => {
    for (const url of ["https://launchacard.fun/launch", "https://www.launchacard.fun/launch", "http://localhost:5621/launch", "http://127.0.0.1:5621/launch", "http://app.localhost/launch"]) {
      expect(mirrorRedirect(...page(url), true)).toBeNull();
    }
    for (const path of ["/api/live/health", "/api/live/health?self=1", "/api/live/assets/" + "a".repeat(64) + ".png", "/m/" + "b".repeat(43), "/api/img/art/x.png", "/assets/index-abc.js",
      "/fonts/a.woff2", "/_serverFn/abc", "/robots.txt", "/sitemap.xml", "/.well-known/acme-challenge/token", "/og/card.png", "/favicon.ico"]) {
      expect(mirrorRedirect(...page(`https://edge.launchacard.com${path}`), true)).toBeNull();
    }
    expect(mirrorRedirect(...page("https://edge.launchacard.com/launch", "POST"), true)).toBeNull();
    expect(mirrorRedirect(...page("https://edge.launchacard.com/launch", "GET", "application/json"), true)).toBeNull();
  });
});
