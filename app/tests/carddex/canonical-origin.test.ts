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
