/**
 * Pinned design versions (README.md, "Redesigning a design that coins already use"). A launch records the exact card
 * front and back sha256 it was prepared with (its payload's input.card), and keeps that art forever: when a redesign
 * replaces a design key's art, the version a launch recorded stays in design-archive.json, its files copied byte for
 * byte under /assets/carddex/archive/<designKey>/<version>/ (tools/carddex/archive-design-version.ts).
 *
 * The current art of every design is not in the archive (a test holds this): a launch whose hashes are the current
 * ones has no version (null) and renders exactly as before, from the usual registries. Only a launch whose hashes are
 * an archived version carries that version, and the renderer, the compositor and the launch review read that version's
 * files instead. Shared by the browser, the Worker and the pump.fun integration, so this file holds no server code. The
 * browser's copy of design-archive.json keeps only designKey, version, generated, layout and the atlases without their
 * hashes (client-registry-fields.ts), so archivedDesignForHashes, recordedDesignVersion and archivedDesignFile are
 * server-side reads.
 */
import archive from "./design-archive.json";

type Box = { x: number; y: number; w: number; h: number };
type Pin = { path: string; sha256: string };
export type ArchivedDesignVersion = {
  designKey: string;
  /** designVersionId(front sha256, back sha256). */
  version: string;
  /** The commit the files were archived from. */
  ref: string;
  /** The reviewed front and back a launch of this version recorded (design-assets.json at `ref`), archive paths. */
  source: { front: Pin; back: Pin };
  /** generated-assets.ts at `ref` (the 480/640 copies sit beside the 320 px ones). */
  generated: { front: string; back: string; front320: string; back320: string };
  /** generated-layouts.json at `ref`. */
  layout: { art: Box; mask: { width: number; height: number; path: string }; prints?: Record<string, Box>; sourceMaterialGaps?: boolean; canonicalSource?: boolean };
  /** render-assets.json at `ref`: the key's flattened atlases (plain and --stock). */
  atlases: Record<string, { designKey: string; kind: string; path: string; sha256: string; previewPath: string; previewSha256: string; sourceSha256: string; width: number; height: number; rendererVersion: string }>;
  /** render-variants.json at `ref`: the atlases' 480/640 px copies. */
  variants: Record<string, { atlasSha256: string; w480: { path: string; width: number; height: number; sha256: string }; w640: { path: string; width: number; height: number; sha256: string } }>;
  /** token-back-assets.json at `ref`. */
  tokenBack: { designKey: string; path: string; sha256: string; sourceSha256: string; width: number; height: number; conversionVersion: string };
  /** Every archived file of this version and its sha256. */
  files: Record<string, string>;
};

export const DESIGN_ARCHIVE_ROOT = "/assets/carddex/archive/";
const ARCHIVE = archive as unknown as Record<string, Record<string, ArchivedDesignVersion>>;
/** designVersionId's shape: 12 hex of the front's sha256, a dash, 12 hex of the back's. */
export const DESIGN_VERSION = /^[a-f0-9]{12}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** A design version's id: its front and back, as a launch records them. */
export function designVersionId(frontSha256: string, backSha256: string) {
  return `${frontSha256.slice(0, 12)}-${backSha256.slice(0, 12)}`;
}

/** The archived version `version` of `designKey`, or null (no version, another key's version, or not archived). */
export function archivedDesignVersion(designKey?: string | null, version?: string | null): ArchivedDesignVersion | null {
  if (!designKey || !version || !DESIGN_VERSION.test(version)) return null;
  const versions = Object.hasOwn(ARCHIVE, designKey) ? ARCHIVE[designKey] : undefined;
  return versions && Object.hasOwn(versions, version) ? versions[version]! : null;
}

/** The archived version of `designKey` whose front and back are exactly these hashes, or null. */
export function archivedDesignForHashes(designKey: unknown, frontSha256: unknown, backSha256: unknown): ArchivedDesignVersion | null {
  if (typeof designKey !== "string" || typeof frontSha256 !== "string" || typeof backSha256 !== "string" || !SHA256.test(frontSha256) || !SHA256.test(backSha256)) return null;
  const entry = archivedDesignVersion(designKey, designVersionId(frontSha256, backSha256));
  return entry && entry.source.front.sha256 === frontSha256 && entry.source.back.sha256 === backSha256 ? entry : null;
}

/**
 * The version a launch's recorded hashes pin: the archived version's id, or null when they are not archived (the
 * current art, which renders from the usual registries).
 */
export function recordedDesignVersion(designKey: unknown, frontSha256: unknown, backSha256: unknown): string | null {
  return archivedDesignForHashes(designKey, frontSha256, backSha256)?.version ?? null;
}

/** Every archived version (tests and tooling). */
export function archivedDesignVersions(): ArchivedDesignVersion[] {
  return Object.values(ARCHIVE).flatMap((versions) => Object.values(versions));
}

/** The archived version that holds this public file and the file's pinned sha256, or null. */
export function archivedDesignFile(path: string): { entry: ArchivedDesignVersion; sha256: string } | null {
  if (!path.startsWith(DESIGN_ARCHIVE_ROOT)) return null;
  const [designKey, version] = path.slice(DESIGN_ARCHIVE_ROOT.length).split("/");
  const entry = archivedDesignVersion(designKey, version);
  return entry && Object.hasOwn(entry.files, path) ? { entry, sha256: entry.files[path]! } : null;
}
