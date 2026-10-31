/**
 * The browser reads a few fields of three registries the server needs whole (readiness audit PERF-1): the client copy of
 * render-assets.json drops its hashes (CanonicalCardSkin reads the path, preview path and renderer version), the client
 * copy of pair-assets.json drops its provenance (source URLs, evidence, slot, admission) and the client copy of
 * pair-logos.json keeps only `logo` (pair-logos.ts pairLogo reads nothing else). The client copy of design-archive.json
 * keeps, per archived version, only what the card renderers read (CLIENT_ARCHIVE_FIELDS): no pins, file map, source
 * faces, variants or token back, which only the Worker's launch review and compositor read. vite.config.ts applies this
 * to the client build only; the server bundle and the tests keep every file whole. Build-time only: no app code imports it.
 */
export const CLIENT_DROPPED_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "render-assets.json": ["sha256", "previewSha256", "sourceSha256"],
  "pair-assets.json": ["sourceUrls", "sourceEvidenceArtifact", "verificationSlot", "verifiedDate", "admission"],
  "pair-logos.json": ["w128", "w64", "source", "derivation", "reason"],
});

/**
 * What the browser reads of an archived design version (design-versions.ts archivedDesignVersion, by generatedCardAssets,
 * GeneratedCardArt and canonicalSkinAsset): the generated faces, the layout and each atlas without its hashes.
 */
export const CLIENT_ARCHIVE_FIELDS = Object.freeze(["designKey", "version", "generated", "layout", "atlases"] as const);

function clientArchiveCopy(code: string) {
  const data = JSON.parse(code) as Record<string, Record<string, Record<string, unknown>>>;
  const dropped = CLIENT_DROPPED_FIELDS["render-assets.json"]!;
  const atlases = (value: unknown) => Object.fromEntries(Object.entries(value as Record<string, Record<string, unknown>>).map(([key, atlas]) => [key, Object.fromEntries(Object.entries(atlas).filter(([field]) => !dropped.includes(field)))]));
  const keep = (entry: Record<string, unknown>) => Object.fromEntries(CLIENT_ARCHIVE_FIELDS.filter((field) => Object.hasOwn(entry, field)).map((field) => [field, field === "atlases" ? atlases(entry[field]) : entry[field]]));
  return JSON.stringify(Object.fromEntries(Object.entries(data).map(([key, versions]) => [key, Object.fromEntries(Object.entries(versions).map(([version, entry]) => [version, keep(entry)]))])));
}

/** The client copy of a registry file in src/lib/carddex (by base name), or undefined when the client keeps it whole. */
export function clientRegistryCopy(name: string, code: string): string | undefined {
  if (name === "design-archive.json") return clientArchiveCopy(code);
  const fields = Object.hasOwn(CLIENT_DROPPED_FIELDS, name) ? CLIENT_DROPPED_FIELDS[name] : undefined;
  if (!fields) return undefined;
  const keep = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
  const data = JSON.parse(code) as Record<string, unknown>[] | Record<string, Record<string, unknown>>;
  const out = Array.isArray(data) ? data.map(keep) : Object.fromEntries(Object.entries(data).map(([key, row]) => [key, keep(row)]));
  return JSON.stringify(out);
}
