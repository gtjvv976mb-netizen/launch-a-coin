#!/usr/bin/env bun
/**
 * Read-only release check (README.md, "Release checklist"): every launch must still resolve to the art it recorded.
 * A launch records its card's exact front and back sha256 (live_launch_intents.payload_json, input.card); this checks
 * that each one is either a design's current reviewed art (integrations/pumpfun/src/design-assets.json) or a pinned
 * archived version of the same design (app/src/lib/carddex/design-archive.json), and that the files that art renders
 * from are on disk with their pinned hashes. Run it before any deploy that changes card art.
 *
 *   bun tools/carddex/check-launched-art.ts <launches.json | ->
 *
 * The input is the JSON `wrangler d1 execute --json` prints (README.md has the one-liner), or a plain array of rows,
 * each with a design key and both hashes (design_key/designKey, front_sha256/frontSha256, back_sha256/backSha256, and
 * optionally id and status). It reads that file and this checkout only: no network, no database, no writes. Exit code
 * 1 when any launch does not resolve, 2 for unreadable input.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import reviewed from "../../integrations/pumpfun/src/design-assets.json";
import { archivedDesignForHashes } from "../../app/src/lib/carddex/design-versions";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
type Row = Record<string, unknown>;
export type LaunchArt = { id: string; status: string; designKey: string; frontSha256: string; backSha256: string };
export type LaunchArtResult = LaunchArt & { resolved: "current" | "archived" | null; version: string | null; problem: string | null };

/** The rows of a `wrangler d1 execute --json` answer ([{results: [...]}]), a {launches: [...]} body or a plain array. */
export function launchRows(input: unknown): LaunchArt[] {
  const rows: Row[] = Array.isArray(input)
    ? input.flatMap((item: Row) => (item && typeof item === "object" && Array.isArray(item.results) ? item.results as Row[] : [item]))
    : input && typeof input === "object" && Array.isArray((input as Row).launches) ? (input as { launches: Row[] }).launches : [];
  if (!rows.length) throw new Error("No launch rows in the input");
  const text = (row: Row, ...keys: string[]) => { for (const key of keys) if (typeof row[key] === "string") return row[key] as string; return ""; };
  return rows.map((row, index) => ({
    id: text(row, "id", "intent_id", "token_mint", "tokenMint") || `row ${index + 1}`,
    status: text(row, "status"),
    designKey: text(row, "design_key", "designKey"),
    frontSha256: text(row, "front_sha256", "frontSha256"),
    backSha256: text(row, "back_sha256", "backSha256"),
  }));
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Each launch's art: the current reviewed art, an archived version, or a problem (null resolved). */
export function checkLaunchedArt(launches: LaunchArt[], root = REPO_ROOT): LaunchArtResult[] {
  const onDisk = new Map<string, string | null>();
  const fileProblem = (path: string, pinned: string) => {
    if (!onDisk.has(path)) { const file = join(root, "app/public", path); onDisk.set(path, existsSync(file) ? sha(readFileSync(file)) : null); }
    const digest = onDisk.get(path);
    return digest === null ? `${path} is missing` : digest !== pinned ? `${path} differs from its pinned sha256` : null;
  };
  return launches.map((launch) => {
    const result = { ...launch, resolved: null, version: null, problem: null } as LaunchArtResult;
    if (!launch.designKey || !/^[a-f0-9]{64}$/.test(launch.frontSha256) || !/^[a-f0-9]{64}$/.test(launch.backSha256)) {
      return { ...result, problem: "no recorded design key and front/back sha256" };
    }
    const current = Object.hasOwn(reviewed, launch.designKey) ? reviewed[launch.designKey as keyof typeof reviewed] : undefined;
    if (current && current.front.sha256 === launch.frontSha256 && current.back.sha256 === launch.backSha256) {
      const problem = fileProblem(current.front.path, current.front.sha256) ?? fileProblem(current.back.path, current.back.sha256);
      return { ...result, resolved: problem ? null : "current", problem };
    }
    const archived = archivedDesignForHashes(launch.designKey, launch.frontSha256, launch.backSha256);
    if (!archived) {
      return { ...result, problem: current ? "its art is neither the current reviewed art nor an archived version: archive it (tools/carddex/archive-design-version.ts) before deploying" : "unknown design key" };
    }
    const problem = Object.entries(archived.files).map(([path, pinned]) => fileProblem(path, pinned)).find(Boolean) ?? null;
    return { ...result, resolved: problem ? null : "archived", version: archived.version, problem };
  });
}

if (import.meta.main) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: bun tools/carddex/check-launched-art.ts <launches.json | ->");
    process.exit(2);
  }
  let launches: LaunchArt[];
  try {
    launches = launchRows(JSON.parse(file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8")));
  } catch (error) {
    console.error(`Unreadable launch export: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  const results = checkLaunchedArt(launches);
  for (const r of results) {
    console.log(`${r.resolved ? "ok  " : "FAIL"} ${r.id}${r.status ? ` (${r.status})` : ""} ${r.designKey}: ${r.resolved === "archived" ? `archived ${r.version}` : r.resolved ?? r.problem}`);
  }
  const failed = results.filter((r) => !r.resolved).length;
  console.log(failed ? `${failed} of ${results.length} launches do not resolve to the art they recorded.` : `All ${results.length} launches resolve to the art they recorded.`);
  process.exit(failed ? 1 : 0);
}
