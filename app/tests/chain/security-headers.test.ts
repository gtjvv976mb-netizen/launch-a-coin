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
