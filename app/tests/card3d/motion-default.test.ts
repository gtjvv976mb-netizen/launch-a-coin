// Full motion is the default, except that a device asking for reduced motion starts calm until the visitor chooses
// (A11Y-1, MOT-1): the Calm motion switch (html[data-motion="calm"], localStorage["mdx-motion-v2"] "calm" or "full")
// overrides it either way. No device boot heuristic drops a page to lite; the frame-rate watchdog still can.

import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { motionLevel } from "../../src/components/mintdex/card3d/motion3d";

const SRC = path.resolve(import.meta.dir, "../../src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(css|ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.document;
  delete g.window;
});
/** A page whose device asks for reduced motion, with html[data-motion] as given. */
function page(motion?: string) {
  const dataset: Record<string, string> = motion ? { motion } : {};
  g.document = { documentElement: { dataset } };
  g.window = { matchMedia: (q: string) => ({ matches: /reduce/.test(q), media: q }) };
}

describe("full motion by default", () => {
  test("a device that asks for reduced motion still runs full motion while Calm is off", () => {
    page();
    expect(motionLevel()).toBe("full");
  });

  test("the Calm switch stops it; the watchdog's lite still applies", () => {
    page("calm");
    expect(motionLevel()).toBe("calm");
    page("lite");
    expect(motionLevel()).toBe("lite");
  });

  test("the head script: a stored choice wins either way, otherwise the device's reduced motion setting starts calm", () => {
    const root = read("routes/__root.tsx");
    const script = root.match(/const MOTION_SCRIPT =\s*'([^']*)'/)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(0);
    for (const [stored, reduce, expected] of [
      [{}, false, undefined],
      [{}, true, "calm"],
      [{ "mdx-motion": "calm", "mdx-motion-lite": "1" }, false, undefined],
      [{ "mdx-motion-v2": "calm" }, false, "calm"],
      [{ "mdx-motion-v2": "full" }, true, undefined],
    ] as const) {
      const document = { documentElement: { dataset: {} as Record<string, string> } };
      runInNewContext(script, {
        document,
        matchMedia: () => ({ matches: reduce }),
        localStorage: { getItem: (key: string) => (stored as Record<string, string>)[key] ?? null },
      });
      expect(document.documentElement.dataset.motion).toBe(expected);
    }
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(script, { document, matchMedia: () => ({ matches: true }), localStorage: { getItem: () => { throw new Error("Storage blocked"); } } });
    expect(document.documentElement.dataset.motion).toBe("calm");
  });

  test("no boot heuristic: cores, memory and data saver never start a page in lite", () => {
    const engine = read("components/mintdex/card3d/motion3d.ts");
    for (const k of ["hardwareConcurrency", "deviceMemory", "saveData", "bootHeuristic"]) expect(engine).not.toContain(k);
    // The frame-rate watchdog stays.
    expect(engine).toContain("classifyFrames(this.dts)");
    expect(engine).toMatch(/setLite\(\);/);
  });

  test("the Calm switch is open to every visitor and its label just says what it does", () => {
    const ui = read("components/mintdex/ui.tsx");
    const sw = ui.slice(ui.indexOf("export function CalmSwitch"), ui.indexOf("// ---------------------------------------------------------------- page template"));
    expect(sw).toContain("Calm motion");
    expect(sw).not.toContain("Set by your device");
    expect(sw).not.toContain("matchMedia");
    expect(sw).toContain("const locked = !state.ready;");
  });

  test("every ambient loop in alive.css and card3d.css is scoped away from calm", () => {
    for (const file of ["alive.css", "card3d.css"]) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/^([^{}\n@][^{}]*)\{[^{}]*\banimation:[^;]*infinite/gm)) {
        const sel = m[1].trim();
        for (const part of sel.split(/,\s*\n?/)) {
          expect({ file, part: part.trim(), scoped: /:root:not\(\[data-motion(="calm")?\]\)/.test(part) }).toEqual({
            file,
            part: part.trim(),
            scoped: true,
          });
        }
      }
    }
  });
});
