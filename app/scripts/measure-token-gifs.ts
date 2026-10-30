/**
 * Dev measurement (no network, no paid calls): the coin-image GIF of every offered design, one design per process, so
 * each figure is that export's own. Each export composes with a fixed PNG as the creator's art, reading the atlas,
 * token back and fonts from app/public. Writes bytes, wall and CPU milliseconds, and the process's peak RSS (with a
 * baseline: the same process before any export) per design.
 * Run from app/: bun scripts/measure-token-gifs.ts --art <800px.png> --out <file.json> [--jobs 2] [--design <key> [--any]]
 */
import { readFile, writeFile } from "node:fs/promises";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const artPath = arg("art"), out = arg("out"), one = arg("design");
if (!artPath || !out) throw new Error("Usage: bun scripts/measure-token-gifs.ts --art <png> --out <json> [--jobs 2] [--design <key>]");

if (one) {
  const wasm = await readFile("node_modules/@resvg/resvg-wasm/index_bg.wasm");
  Bun.plugin({ name: "resvg-wasm", setup(build) { build.module("virtual:launchacard-resvg-wasm", () => ({ exports: { default: wasm }, loader: "object" })); } });
  const { composeCreatorTokenMedia } = await import("../src/lib/carddex/live/compose.server");
  const { defaultQuoteForDesign, designForPair, pairForDesign } = await import("../src/lib/carddex/pairs");
  const { getCardDesign } = await import("../src/lib/carddex/designs");
  const { TOKEN_ANIMATION_MAX_BYTES } = await import("../src/lib/carddex/live/token-turntable");
  // --any: an earlier design too (for comparison), on the quote its stored coins read as.
  const pair = pairForDesign(one) ?? (process.argv.includes("--any") ? defaultQuoteForDesign(one) : null), design = getCardDesign(one);
  if (!pair || (!process.argv.includes("--any") && designForPair(pair.key) !== one)) throw new Error(`${one} is not an offered pair's design`);
  const artwork = new Uint8Array(await readFile(artPath));
  const baselineRss = process.resourceUsage().maxRSS;
  const card = { cardTemplate: one, name: "Measure Token", ticker: "MEASURE", image: "", level: design.materialLevel, quoteAssetKey: pair.key, quoteMint: pair.mint, mcapUsd: null, mcapQuote: 0, holders: 0, dexNo: 1, dexLabel: "No. 001", lore: "A fixed fixture for measuring the coin image.", ownerHandle: "creator" } as never;
  const cpu = process.cpuUsage(), start = performance.now();
  const media = await composeCreatorTokenMedia({ card, tokenMint: "Mint1111111111111111111111111111111111111111", creator: "Creator111111111111111111111111111111111111", artwork, mimeType: "image/png" }, { loadAsset: async (path) => new Uint8Array(await readFile(`public${path}`)) });
  const ms = performance.now() - start, used = process.cpuUsage(cpu);
  const row = { design: one, pair: pair.key, bytes: media.tokenImage.length, mib: +(media.tokenImage.length / 2 ** 20).toFixed(2), mb: +(media.tokenImage.length / 1e6).toFixed(2), underLimit: media.tokenImage.length <= TOKEN_ANIMATION_MAX_BYTES, wallMs: Math.round(ms), cpuMs: Math.round((used.user + used.system) / 1000), baselineRssMb: +(baselineRss / 1024).toFixed(1), peakRssMb: +(process.resourceUsage().maxRSS / 1024).toFixed(1) };
  await writeFile(out, JSON.stringify(row) + "\n");
  process.exit(0);
}

const { OFFERED_PAIRS, designForPair } = await import("../src/lib/carddex/pairs");
const designs = OFFERED_PAIRS.map((pair) => designForPair(pair.key)!);
const jobs = Number(arg("jobs") ?? 2), rows: unknown[] = [];
let next = 0;
async function worker() {
  while (next < designs.length) {
    const design = designs[next++]!, tmp = `${out}.${design}.json`;
    const child = Bun.spawn(["bun", "scripts/measure-token-gifs.ts", "--art", artPath!, "--out", tmp, "--design", design], { stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) { rows.push({ design, error: `exit ${child.exitCode}` }); continue; }
    rows.push(JSON.parse(await readFile(tmp, "utf8")));
    await writeFile(out, JSON.stringify(rows, null, 1) + "\n");
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(JSON.stringify({ designs: rows.length }));
