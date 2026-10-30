import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The 31 October mainnet-only release: the owner asked for every demo surface gone and nothing shown until real coins
// launch. These read the source, so a demo word or path cannot quietly come back.
const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(resolve(APP, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );

describe("mainnet-only site", () => {
  test("no page, the shell or the live components show demo words", () => {
    const visible = [...files("src/routes"), "src/components/mintdex/AppShell.tsx", "src/components/mintdex/feeds.tsx", ...files("src/components/carddex")];
    for (const file of visible) {
      // Comments may name the old demo; strings and markup may not.
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      for (const word of ["Try the demo", "test SOL", "Create demo coin", "Test SOL only", "Simulated", "[TO FILL"]) {
        expect([file, code.includes(word)]).toEqual([file, false]);
      }
    }
  });
  test("the demo's server door, upload and image routes are gone", () => {
    for (const path of ["src/lib/mintdex/api.ts", "src/routes/api/upload.ts", "src/routes/api/img/$.ts", "src/components/mintdex/Ticker.tsx", "src/components/mintdex/trust.tsx"]) {
      expect([path, existsSync(resolve(APP, path))]).toEqual([path, false]);
    }
  });
  test("link previews of coin pages may load the card art, and the default share image is the mainnet capture", async () => {
    expect(read("src/routes/robots[.]txt.ts")).toContain("'Allow: /api/live/assets/'");
    const { SITE_OG_IMAGE } = await import("../../src/lib/mintdex/seo");
    expect(SITE_OG_IMAGE).toBe("/og/launch-a-card-mainnet-1200x630.jpg");
    expect(existsSync(resolve(APP, "public", SITE_OG_IMAGE.slice(1)))).toBe(true);
    expect(existsSync(resolve(APP, "public/og/launch-a-card-1200x630.jpg"))).toBe(false);
  });
  test("a pasted coin address fits both search fields, and a failed list never reads as no coins", () => {
    expect(read("src/components/mintdex/AppShell.tsx")).toContain("maxLength={64}");
    const discover = read("src/routes/discover.tsx");
    expect(discover).toContain("maxLength={64}");
    expect(discover).toContain("Couldn't load coins");
    expect(discover.indexOf("Couldn't load coins")).toBeLessThan(discover.indexOf('title="No coins yet"'));
  });
  test("a launch is found by its full mint, name or ticker", async () => {
    const { matchesLaunch } = await import("../../src/lib/carddex/live/launches");
    const mint = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
    const l = { name: "Honk", ticker: "HONK", tokenMint: mint } as Parameters<typeof matchesLaunch>[0];
    for (const q of [mint, "honk", "$HON", ""]) expect(matchesLaunch(l, q)).toBe(true);
    expect(matchesLaunch(l, "glorb")).toBe(false);
  });
});
