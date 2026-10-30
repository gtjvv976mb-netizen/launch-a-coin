import {describe,expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";
import logos from "../../src/lib/carddex/pair-logos.json";
import {pairLogo} from "../../src/lib/carddex/pair-logos";
import {PAIR_IDENTITY_DESIGNS} from "../../src/lib/carddex/design-pairings";
import {HELD_PAIR_DESIGNS} from "../../src/lib/carddex/pair-designs";
import {OFFERED_PAIRS,PAIR_ASSET_KEYS,getPairAsset} from "../../src/lib/carddex/pairs";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {PairLogo} from "../../src/components/carddex/PairLogo";
import {pairMonogram} from "../../src/components/carddex/pair-groups";

/**
 * Launch's pair picker shows each pair's own logo (30 October 2026). The files come from
 * tools/carddex/make_pair_logos.py, which needs Codex's local reference folder, so these tests check the recorded
 * hashes and formats instead of regenerating (Chromium's WebP encoder decides the bytes).
 */
type File = {path: string; sha256: string; bytes: number};
type Row = {logo: string | null; reason?: string; w128?: File; w64?: File;
  source?: {folder: string; file: string; sha256: string; record: string; url: string};
  derivation?: {mode: string; crop: number[]; plate: string | null; upscaled: boolean; encoder: string}};
const ROWS = logos as unknown as Record<string, Row>;
const PUBLIC = path.join(import.meta.dir, "../../public");
const DIR = path.join(PUBLIC, "assets/pairs");
const MONOGRAMS = ["gork", "manifest"];

/** The full release's pairs: every identity pair whose design is not held as "not offered" (the same on the release step). */
const RELEASE = Object.entries(PAIR_IDENTITY_DESIGNS)
  .filter(([, design]) => design && (!Object.hasOwn(HELD_PAIR_DESIGNS, design) || HELD_PAIR_DESIGNS[design]))
  .map(([pair]) => pair);
const withLogo = Object.entries(ROWS).filter(([, row]) => row.logo);

/** Width and height from a WebP header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(buf: Buffer): [number, number] {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WEBP");
  expect(buf.readUInt32LE(4) + 8).toBe(buf.length);
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    expect([buf[23], buf[24], buf[25]]).toEqual([0x9d, 0x01, 0x2a]);
    return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === "VP8L") {
    expect(buf[20]).toBe(0x2f);
    const bits = buf.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  expect(chunk).toBe("VP8X");
  return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
}

describe("pair logos", () => {
  test("one entry per full-release pair, and every offered pair has one", () => {
    expect(RELEASE.length).toBe(86);
    expect(Object.keys(ROWS).sort()).toEqual([...RELEASE].sort());
    for (const asset of OFFERED_PAIRS) expect(Object.hasOwn(ROWS, asset.key)).toBe(true);
  });

  test("exactly GORK and MANIFEST keep the monogram, each with its reason", () => {
    const mono = Object.entries(ROWS).filter(([, row]) => row.logo === null);
    expect(mono.map(([key]) => key).sort()).toEqual(MONOGRAMS);
    for (const [, row] of mono) {
      expect(row.reason!.length).toBeGreaterThan(20);
      expect(row.w128 ?? row.w64 ?? row.source ?? row.derivation).toBeUndefined();
    }
    expect(withLogo.length).toBe(84);
  });

  test("each logo is a 128 px and a 64 px WebP matching its recorded sha256", () => {
    for (const [key, row] of withLogo) {
      expect(row.logo).toBe(`/assets/pairs/${key}.webp`);
      for (const [file, size, name] of [[row.w128!, 128, `${key}.webp`], [row.w64!, 64, `${key}-64.webp`]] as const) {
        expect(file.path).toBe(`/assets/pairs/${name}`);
        const buf = readFileSync(path.join(PUBLIC, file.path));
        expect(buf.length).toBe(file.bytes);
        expect(createHash("sha256").update(buf).digest("hex")).toBe(file.sha256);
        expect(webpSize(buf)).toEqual([size, size]);
      }
    }
  });

  test("public/assets/pairs holds exactly those files: none for a pair that is not offered, 600 KB at most", () => {
    const expected = withLogo.flatMap(([key]) => [`${key}.webp`, `${key}-64.webp`]).sort();
    const files = readdirSync(DIR).sort();
    expect(files).toEqual(expected);
    expect(files.length).toBe(168);
    const offered = new Set(OFFERED_PAIRS.map(asset => asset.key as string));
    const notOffered = PAIR_ASSET_KEYS.filter(key => !Object.hasOwn(ROWS, key));
    expect(notOffered.sort()).toEqual(["67", "aave", "agency", "alon", "biketyson", "claudia", "hodl", "jeanphil", "neet", "solangeles", "uni"]);
    for (const key of notOffered) expect(files.some(file => file === `${key}.webp` || file === `${key}-64.webp`)).toBe(false);
    for (const key of offered) expect(Object.hasOwn(ROWS, key)).toBe(true);
    const total = withLogo.reduce((sum, [, row]) => sum + row.w128!.bytes + row.w64!.bytes, 0);
    expect(total).toBeLessThanOrEqual(600 * 1024);
  });

  test("each logo records its source: Codex's file for that pair, its sha256, the record and the URL", () => {
    for (const [key, row] of withLogo) {
      const source = row.source!;
      expect(source.folder).toBe("creative/higgsfield/pair-identities-2026-10-30");
      expect(path.basename(source.file).startsWith(`${key}-`)).toBe(true);
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(source.record).toMatch(/^research\/[a-z0-9-]+\.json#[A-Za-z0-9.]+$/);
      expect(source.url).toMatch(/^https:\/\//);
      expect(["whole", "cover", "alpha-circle"]).toContain(row.derivation!.mode);
      expect(row.derivation!.plate === null).toBe(row.derivation!.mode !== "alpha-circle");
      expect(row.derivation!.encoder).toContain("image/webp");
    }
  });

  test("no logo file can match a held design's .assetsignore line", () => {
    const lines = readFileSync(path.join(PUBLIC, ".assetsignore"), "utf8").split("\n").map(line => line.trim())
      .filter(line => line && !line.startsWith("#"));
    for (const file of readdirSync(DIR)) {
      expect(file.startsWith("pair-")).toBe(false);
      for (const line of lines) expect(file.startsWith(line.slice(0, -"[-.]*".length))).toBe(false);
    }
  });

  test("pairLogo reads only the fields the client keeps (logo)", () => {
    expect(pairLogo("sol")).toEqual({w128: "/assets/pairs/sol.webp", w64: "/assets/pairs/sol-64.webp"});
    for (const [key, row] of withLogo) expect(pairLogo(key)).toEqual({w128: row.w128!.path, w64: row.w64!.path});
    for (const key of [...MONOGRAMS, "67", "aave", "solangeles", "nope", "", null, undefined]) expect(pairLogo(key)).toBeNull();
  });

  test("Launch's tiles draw every offered pair's logo, and the letter only for GORK and MANIFEST", () => {
    const html = (key: string, size?: number) => renderToStaticMarkup(createElement(PairLogo, {asset: getPairAsset(key), size}));
    for (const asset of OFFERED_PAIRS) {
      const out = html(asset.key);
      expect(out.startsWith('<span aria-hidden="true" class="cdx-pair-logo')).toBe(true);
      if (MONOGRAMS.includes(asset.key)) {
        expect(out).toBe(`<span aria-hidden="true" class="cdx-pair-logo cdx-pair-logo--mono">${pairMonogram(asset)}</span>`);
        continue;
      }
      const files = pairLogo(asset.key)!;
      expect(out).toContain(`src="${files.w64}" srcSet="${files.w64} 64w, ${files.w128} 128w" sizes="24px" width="24" height="24" alt="" loading="lazy"`);
      expect(out).toContain('draggable="false"');
    }
    expect(html("gork")).toContain(">G</span>");
    expect(html("manifest")).toContain(">M</span>");
    expect(html("sol", 20)).toContain('sizes="20px" width="20" height="20"');
  });
});
