#!/usr/bin/env bun
/**
 * Pins a design version that coins already use, before a redesign replaces it (README.md, "Redesigning a design that
 * coins already use"). Every launch records the exact card front and back sha256 it was prepared with; once a redesign
 * replaces a design key's art, only this archive lets that launch keep rendering, re-preparing and minting the art its
 * creator reviewed. Operator tooling, run locally by hand; it reads git and writes files, nothing else.
 *
 *   bun tools/carddex/archive-design-version.ts [--ref <git-ref>] <design-key> [<design-key> ...]
 *
 * For each design key it reads, at <git-ref> (default HEAD, i.e. the art before the redesign is installed):
 *   integrations/pumpfun/src/design-assets.json   the reviewed front/back {path, sha256}
 *   app/src/lib/carddex/generated-assets.ts        the front/back paths and their 320 px copies (and the 480/640 copies)
 *   app/src/lib/carddex/generated-layouts.json     the measured layout
 *   app/src/lib/carddex/render-assets.json         every flattened atlas of the key (plain and --stock), its preview
 *   app/src/lib/carddex/render-variants.json       the atlases' 480/640 px WebP copies
 *   app/src/lib/carddex/token-back-assets.json     the token-image reverse
 * copies every file it names, byte for byte from git, to
 *   app/public/assets/carddex/archive/<design-key>/<version>/<the path below /assets/carddex/>
 * where <version> is designVersionId(front sha256, back sha256) (app/src/lib/carddex/design-versions.ts), checks each
 * file against every hash the registries pin for it, and records the version, with its paths rewritten to the archive,
 * in app/src/lib/carddex/design-archive.json. Archiving a version already archived re-checks it and changes nothing.
 * Any mismatch, in any key's registries or with a file already in the archive, stops the run before anything is written.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { designVersionId, DESIGN_ARCHIVE_ROOT, type ArchivedDesignVersion } from "../../app/src/lib/carddex/design-versions";

/** This repository's root (the tool lives in tools/carddex). */
export const REPO_ROOT = resolve(import.meta.dir, "../..");
const ARCHIVE_JSON = "app/src/lib/carddex/design-archive.json";
const PUBLIC = "app/public";
const CARDDEX_ASSETS = "/assets/carddex/";

type Pin = { path: string; sha256: string };
type Atlas = ArchivedDesignVersion["atlases"][string];
type Variant = ArchivedDesignVersion["variants"][string];
type TokenBack = ArchivedDesignVersion["tokenBack"];
export type GitReader = { resolve(ref: string): string; read(ref: string, file: string): Buffer | null };

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function gitReader(root = REPO_ROOT): GitReader {
  return {
    resolve: (ref) => execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: root }).toString().trim(),
    read: (ref, file) => {
      try { return execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); }
      catch { return null; }
    },
  };
}

/** One design key's entry in generated-assets.ts at a ref (each entry is a single JSON object line). */
export function generatedEntry(source: string, key: string) {
  const line = source.split("\n").find((row) => row.trimStart().startsWith(`${JSON.stringify(key)}:`));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim().replace(/,$/, "");
  return JSON.parse(value) as { front?: string; back?: string; front320?: string; back320?: string };
}

/** Where a public /assets/carddex/ file of this version lives in the archive. */
export function archivePath(designKey: string, version: string, path: string) {
  if (!path.startsWith(CARDDEX_ASSETS) || path.startsWith(DESIGN_ARCHIVE_ROOT) || path.includes("..")) throw new Error(`${designKey}: cannot archive ${path}`);
  return `${DESIGN_ARCHIVE_ROOT}${designKey}/${version}/${path.slice(CARDDEX_ASSETS.length)}`;
}

/**
 * The archived version of one design key as it is at `commit`, and the bytes of each file it needs (keyed by archive
 * path). Throws on anything missing or any hash that differs from the registries; writes nothing.
 */
export function collectDesignVersion(git: GitReader, commit: string, designKey: string, label = commit) {
  const json = <T,>(file: string) => {
    const bytes = git.read(commit, file);
    if (!bytes) throw new Error(`${file} is missing at ${label}`);
    return JSON.parse(bytes.toString("utf8")) as T;
  };
  const reviewed = json<Record<string, { front: Pin; back: Pin }>>("integrations/pumpfun/src/design-assets.json")[designKey];
  if (!reviewed) throw new Error(`${designKey}: no reviewed design-assets entry at ${label}`);
  const version = designVersionId(reviewed.front.sha256, reviewed.back.sha256);
  const generatedSource = git.read(commit, "app/src/lib/carddex/generated-assets.ts")?.toString("utf8") ?? "";
  const generated = generatedEntry(generatedSource, designKey);
  if (!generated?.front || !generated.back || !generated.front320 || !generated.back320) throw new Error(`${designKey}: generated-assets.ts has no complete entry at ${label}`);
  if (generated.front !== reviewed.front.path || generated.back !== reviewed.back.path) throw new Error(`${designKey}: generated-assets.ts and design-assets.json name different faces at ${label}`);
  const layout = json<Record<string, ArchivedDesignVersion["layout"]>>("app/src/lib/carddex/generated-layouts.json")[designKey];
  if (!layout) throw new Error(`${designKey}: no generated-layouts entry at ${label}`);
  const atlases = Object.entries(json<Record<string, Atlas>>("app/src/lib/carddex/render-assets.json")).filter(([, atlas]) => atlas.designKey === designKey);
  if (!atlases.length) throw new Error(`${designKey}: no render atlas at ${label}`);
  const variants = json<Record<string, Variant>>("app/src/lib/carddex/render-variants.json");
  const tokenBack = json<Record<string, TokenBack>>("app/src/lib/carddex/token-back-assets.json")[designKey];
  if (!tokenBack) throw new Error(`${designKey}: no token-back entry at ${label}`);
  if (tokenBack.sourceSha256 !== reviewed.back.sha256) throw new Error(`${designKey}: the token back was made from another back at ${label}`);

  const files = new Map<string, { bytes: Buffer; sha256: string }>();
  const take = (path: string, pinned?: string, optional = false) => {
    const bytes = git.read(commit, `${PUBLIC}${path}`);
    if (!bytes) { if (optional) return null; throw new Error(`${designKey}: ${path} is missing at ${label}`); }
    const digest = sha(bytes);
    if (pinned !== undefined && digest !== pinned) throw new Error(`${designKey}: ${path} is ${digest} at ${label}, its registry pins ${pinned}`);
    const target = archivePath(designKey, version, path);
    files.set(target, { bytes, sha256: digest });
    return target;
  };
  const move = (path: string) => archivePath(designKey, version, path);
  const source = { front: { path: take(reviewed.front.path, reviewed.front.sha256)!, sha256: reviewed.front.sha256 }, back: { path: take(reviewed.back.path, reviewed.back.sha256)!, sha256: reviewed.back.sha256 } };
  // The 320 px copies, and the 480/640 px copies generatedSrcSet names beside them.
  for (const small of [generated.front320, generated.back320]) {
    take(small);
    for (const width of [480, 640]) take(small.replace(/-320\.webp$/, `-${width}.webp`), undefined, true);
  }
  const archivedAtlases: Record<string, Atlas> = {}, archivedVariants: Record<string, Variant> = {};
  for (const [atlasKey, atlas] of atlases) {
    if (atlas.sourceSha256 !== reviewed.front.sha256) throw new Error(`${atlasKey}: the atlas was flattened from another front at ${label}`);
    take(atlas.path, atlas.sha256);
    take(atlas.previewPath, atlas.previewSha256);
    archivedAtlases[atlasKey] = { ...atlas, path: move(atlas.path), previewPath: move(atlas.previewPath) };
    const variant = variants[atlasKey];
    if (!variant || variant.atlasSha256 !== atlas.sha256) throw new Error(`${atlasKey}: no 480/640 copies of this atlas at ${label}`);
    take(variant.w480.path, variant.w480.sha256);
    take(variant.w640.path, variant.w640.sha256);
    archivedVariants[atlasKey] = { ...variant, w480: { ...variant.w480, path: move(variant.w480.path) }, w640: { ...variant.w640, path: move(variant.w640.path) } };
  }
  take(tokenBack.path, tokenBack.sha256);
  const entry: ArchivedDesignVersion = {
    designKey, version, ref: commit, source,
    generated: { front: move(generated.front), back: move(generated.back), front320: move(generated.front320), back320: move(generated.back320) },
    layout, atlases: archivedAtlases, variants: archivedVariants,
    tokenBack: { ...tokenBack, path: move(tokenBack.path) },
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => [path, file.sha256])),
  };
  return { entry, files };
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

export function archiveDesignVersions(keys: string[], ref = "HEAD", root = REPO_ROOT, git = gitReader(root)) {
  if (!keys.length) throw new Error("Name at least one design key to archive");
  const commit = git.resolve(ref);
  const registryPath = join(root, ARCHIVE_JSON);
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) as Record<string, Record<string, ArchivedDesignVersion>> : {};
  // Everything is collected and checked first: one bad key writes nothing.
  const collected = keys.map((key) => collectDesignVersion(git, commit, key, ref));
  // Then every conflict with the registry or with files already on disk, for every key, before the first write.
  const pending = new Map<string, Buffer>();
  for (const { entry, files } of collected) {
    const known = registry[entry.designKey]?.[entry.version];
    if (known && JSON.stringify(known.files) !== JSON.stringify(entry.files)) throw new Error(`${entry.designKey} ${entry.version} is already archived with other files`);
    for (const [path, file] of files) {
      const target = join(root, PUBLIC, path);
      if (existsSync(target)) {
        if (sha(readFileSync(target)) !== file.sha256) throw new Error(`${path} already exists with other bytes`);
        continue;
      }
      pending.set(target, file.bytes);
    }
  }
  for (const [target, bytes] of pending) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  const written: string[] = [];
  for (const { entry, files } of collected) {
    const known = registry[entry.designKey]?.[entry.version];
    // Keep the commit an existing entry was first archived from.
    registry[entry.designKey] = sorted({ ...registry[entry.designKey], [entry.version]: known ? { ...entry, ref: known.ref } : entry });
    written.push(`${entry.designKey} ${entry.version} (${files.size} files${known ? ", already archived" : ""})`);
  }
  writeFileSync(registryPath, `${JSON.stringify(sorted(registry), null, 2)}\n`);
  return written;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let ref = "HEAD";
  const at = args.indexOf("--ref");
  if (at >= 0) { ref = args[at + 1] ?? ""; args.splice(at, 2); }
  if (!ref || !args.length || args.some((arg) => arg.startsWith("-"))) {
    console.error("Usage: bun tools/carddex/archive-design-version.ts [--ref <git-ref>] <design-key> [<design-key> ...]");
    process.exit(2);
  }
  try {
    for (const line of archiveDesignVersions(args, ref)) console.log(`Archived ${line}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
