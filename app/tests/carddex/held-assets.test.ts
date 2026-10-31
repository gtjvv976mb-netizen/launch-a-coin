import {describe,expect,test} from "bun:test";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";
import {CARD_DESIGNS} from "../../src/lib/carddex/designs";
import {HELD_PAIR_DESIGNS} from "../../src/lib/carddex/pair-designs";
import {PAIR_ALTERNATE_DESIGNS,PAIR_DESIGNS,PAIR_DESIGNS_2026_10_30} from "../../src/lib/carddex/design-pairings";

/**
 * A held identity design's art stays in the repo but is never deployed (readiness audit, 30 October 2026): vite copies
 * public/.assetsignore into dist/client, and wrangler leaves every file it names out of the upload and the local preview.
 * No release has offered a held design, so no stored coin carries one.
 */
const PUBLIC = path.join(import.meta.dir, "../../public");
const lines = readFileSync(path.join(PUBLIC, ".assetsignore"), "utf8").split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
const files = (readdirSync(PUBLIC, {recursive: true}) as string[]).map(file => path.basename(file));
const held = Object.keys(HELD_PAIR_DESIGNS);
const ignored = (file: string) => held.some(design => file.startsWith(`${design}-`) || file.startsWith(`${design}.`));

describe("held designs are not deployed", () => {
  test("public/.assetsignore names exactly the held designs, one line each", () => {
    for (const line of lines) expect(line).toMatch(/^pair-[a-z0-9-]+\[-\.\]\*$/);
    expect(lines.map(line => line.slice(0, -"[-.]*".length)).sort()).toEqual([...held].sort());
  });
  test("no design a release offers is held (coins keep their art for good)", () => {
    const offered = new Set<string>([...Object.values(PAIR_DESIGNS), ...Object.values(PAIR_DESIGNS_2026_10_30), ...Object.values(PAIR_ALTERNATE_DESIGNS).flat()] as string[]);
    for (const design of held) expect(offered.has(design)).toBe(false);
  });
  test("each line covers only its own design's files: 13 each, and no file of another design", () => {
    for (const design of held) {
      const own = files.filter(file => file.startsWith(`${design}-`) || file.startsWith(`${design}.`));
      expect(own.length).toBe(13);
      for (const file of own) expect(file).toMatch(new RegExp(`^${design}(--stock)?(-(front|back))?(-(320|480|640))?\\.(png|webp)$`));
    }
    // No other design's key starts with a held key and a dash or dot, so the patterns can't reach its files.
    for (const design of CARD_DESIGNS.map(d => d.key).filter(key => !held.includes(key))) expect(ignored(design)).toBe(false);
    expect(files.filter(ignored)).toHaveLength(13 * held.length);
  });
});
