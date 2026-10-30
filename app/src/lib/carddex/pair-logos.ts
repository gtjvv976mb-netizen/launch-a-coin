import logos from "./pair-logos.json";

/**
 * Pair logos (30 October 2026): each offered pair's own token image as a small square WebP, made by
 * tools/carddex/make_pair_logos.py from Codex's verified identity references (no redrawing). pair-logos.json keeps each
 * file's sha256 and bytes and its source's file, sha256, record and URL for the tests and the server; the client copy
 * keeps only `logo` (client-registry-fields.ts CLIENT_DROPPED_FIELDS), so read it through pairLogo, never
 * directly.
 * A pair whose token image holds no logo (GORK, MANIFEST, FARTCOIN) has `logo: null` and a `reason` (server and tests
 * only), and keeps its monogram.
 */
type LogoRow = { logo: string | null };
const ROWS = logos as unknown as Readonly<Record<string, LogoRow>>;

export type PairLogoFiles = { w128: string; w64: string };

/** The pair's logo files (128 px and 64 px), or null when the pair shows its monogram or has no entry. */
export function pairLogo(key?: string | null): PairLogoFiles | null {
  const logo = key && Object.hasOwn(ROWS, key) ? ROWS[key]!.logo : null;
  return logo ? { w128: logo, w64: logo.replace(/\.webp$/, "-64.webp") } : null;
}
