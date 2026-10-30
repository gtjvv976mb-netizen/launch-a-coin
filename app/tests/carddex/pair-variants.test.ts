import { beforeAll, describe, expect, test } from "bun:test";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { CARD_GENERATED_ASSETS } from "../../src/lib/carddex/generated-assets";
import { CANONICAL_CARD_LAYOUT } from "../../src/lib/carddex/card-template";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import { CARD_DESIGNS } from "../../src/lib/carddex/designs";
import { OFFERED_PAIRS, designForPair } from "../../src/lib/carddex/pairs";

/** A WebP's pixel size from its header (VP8X, VP8 or VP8L). */
function webpSize(bytes: Uint8Array): { width: number; height: number } {
  const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") throw new Error("not a WebP");
  const chunk = text(12, 4), u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  if (chunk === "VP8X") return { width: 1 + u24(24), height: 1 + u24(27) };
  if (chunk === "VP8 ") return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
  if (chunk === "VP8L") {
    const b = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff) };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}
const file = (path: string) => `public${path}`;

describe("phone and tablet copies of every card face (the srcsets ask for them)", () => {
  test("every face with a 320 px copy has 480 and 640 px copies beside it, at those widths", () => {
    let designs = 0, copies = 0;
    for (const [key, assets] of Object.entries(CARD_GENERATED_ASSETS)) {
      if (!assets?.front320 && !assets?.back320) continue;
      designs++;
      for (const small of [assets.front320, assets.back320]) {
        if (!small) continue;
        for (const width of [480, 640]) {
          const path = file(small.replace(/-320\.webp$/, `-${width}.webp`));
          expect(existsSync(path), `${key} ${path}`).toBe(true);
          expect(webpSize(readFileSync(path)).width).toBe(width);
          copies++;
        }
      }
    }
    expect(designs).toBe(CARD_DESIGNS.length);
    // 95 installed identity designs (74 offered or SOL's and USDC's, 21 held) with both faces, plus the earlier designs' faces (a few of them have no back).
    expect(copies).toBeGreaterThanOrEqual(95 * 4);
  });
  test("every card skin has its 480 and 640 px copies", () => {
    for (const atlas of Object.values(renderAssets)) {
      const base = atlas.previewPath.replace(/\.png$/, "");
      for (const width of [480, 640]) expect(webpSize(readFileSync(file(`${base}-${width}.webp`))).width).toBe(width);
    }
  });
});

describe("the creator's print reads on every offered identity design", () => {
  // One wasm instance per test process: another suite (creator-print) may have started it already.
  beforeAll(async () => { try { await initWasm(await readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm")); } catch (error) { if (!String(error).includes("Already initialized")) throw error; } });
  const ink = [0x30, 0x25, 0x1a] as const;
  const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  test("dark ink on the name, type and text plates of each offered pair-* preview is at least 4.5:1", () => {
    const inkL = lum(...ink);
    let lowest = Infinity;
    const offered = OFFERED_PAIRS.map(pair => designForPair(pair.key)!).filter(key => key.startsWith("pair-"));
    expect(offered).toHaveLength(72);
    for (const key of offered) {
      const atlas = (renderAssets as Record<string, { previewPath: string }>)[key + (CARD_DESIGNS.find(d => d.key === key)!.category === "stocks" ? "--stock" : "")]!;
      const png = readFileSync(file(atlas.previewPath));
      const page = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="320" height="447"><image width="320" height="447" preserveAspectRatio="none" xlink:href="data:image/png;base64,${png.toString("base64")}"/></svg>`);
      const image = page.render(), px = image.pixels, W = image.width, H = image.height;
      // The atlas carries each plate at the one print grid's place (the live name, type and text sit on it).
      for (const plate of ["name", "type", "text"] as const) {
        const b = CANONICAL_CARD_LAYOUT[plate], values: number[] = [];
        for (let y = Math.floor((b.y + 0.008) * H); y < Math.ceil((b.y + b.h - 0.008) * H); y++) {
          for (let x = Math.floor((b.x + 0.02) * W); x < Math.ceil((b.x + b.w - 0.02) * W); x++) {
            const i = (y * W + x) * 4;
            values.push(lum(px[i]!, px[i + 1]!, px[i + 2]!));
          }
        }
        values.sort((a, c) => a - c);
        // Against the plate's darker tenth (its worst common background pixel), as measured in the plan.
        const ratio = (values[Math.floor(values.length / 10)]! + 0.05) / (inkL + 0.05);
        lowest = Math.min(lowest, ratio);
        expect(ratio, `${key} ${plate}`).toBeGreaterThanOrEqual(4.5);
      }
      image.free(); page.free();
    }
    console.log(`lowest plate contrast ${lowest.toFixed(2)}:1`);
  });
});
