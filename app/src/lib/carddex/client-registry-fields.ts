/**
 * The browser reads a few fields of three registries the server needs whole (readiness audit PERF-1): the client copy of
 * render-assets.json drops its hashes (CanonicalCardSkin reads the path, preview path and renderer version), the client
 * copy of pair-assets.json drops its provenance (source URLs, evidence, slot, admission) and the client copy of
 * pair-logos.json keeps only `logo` (pair-logos.ts pairLogo reads nothing else). vite.config.ts applies this to the client
 * build only; the server bundle and the tests keep all three files whole. Build-time only: no app code imports it.
 */
export const CLIENT_DROPPED_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "render-assets.json": ["sha256", "previewSha256", "sourceSha256"],
  "pair-assets.json": ["sourceUrls", "sourceEvidenceArtifact", "verificationSlot", "verifiedDate", "admission"],
  "pair-logos.json": ["w128", "w64", "source", "derivation", "reason"],
});

/** The client copy of a registry file in src/lib/carddex (by base name), or undefined when the client keeps it whole. */
export function clientRegistryCopy(name: string, code: string): string | undefined {
  const fields = Object.hasOwn(CLIENT_DROPPED_FIELDS, name) ? CLIENT_DROPPED_FIELDS[name] : undefined;
  if (!fields) return undefined;
  const keep = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
  const data = JSON.parse(code) as Record<string, unknown>[] | Record<string, Record<string, unknown>>;
  const out = Array.isArray(data) ? data.map(keep) : Object.fromEntries(Object.entries(data).map(([key, row]) => [key, keep(row)]));
  return JSON.stringify(out);
}
