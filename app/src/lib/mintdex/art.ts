// Sized copies of coin art (backlog P1-4), so a 28px thumbnail or a 165px card never downloads the 800px original.
//
// - Uploaded art (/api/img/art/{uuid}.{ext}) is stored at 96, 320 and 800 px; ?w=N serves the smallest copy at
//   least N px wide (art.server.ts).
// - Seeded creature art (/assets/creatures/{id}.webp, 800 px) has 96 and 320 px copies written by
//   tools/process_assets.py (step creature-sizes) under versioned names, /assets/creatures/w96/{id}.v1.webp: the
//   mintdex.fun proxy caches /assets/creatures for 7 days, so regenerated copies must ship under a new version
//   (bump CREATURE_ART_VERSION here and in tools/process_assets.py together).
// Plain data, no imports: safe in the server bundle, the client bundle and SSR alike.

/** Keep in step with CREATURE_ART_VERSION in tools/process_assets.py. */
export const CREATURE_ART_VERSION = 1;

const UPLOAD = /^\/api\/img\/art\/[^?#]+$/;
const CREATURE = /^\/assets\/creatures\/([a-z0-9_-]+)\.webp$/;

export type ArtCopies = { w96: string; w320: string; w800: string };

/** The 96, 320 and 800 px copies of a coin's art, or null for art without copies (anything else loads as is). */
export function artCopies(src: string): ArtCopies | null {
  if (UPLOAD.test(src)) return { w96: `${src}?w=96`, w320: `${src}?w=320`, w800: `${src}?w=800` };
  const m = CREATURE.exec(src);
  if (!m) return null;
  const v = CREATURE_ART_VERSION;
  return {
    w96: `/assets/creatures/w96/${m[1]}.v${v}.webp`,
    w320: `/assets/creatures/w320/${m[1]}.v${v}.webp`,
    w800: src,
  };
}

/** A thumbnail's sources (28 to 40 px): the 96 px copy, and the 320 px one for sharp screens. */
export function thumbSources(src: string, size: number) {
  const c = artCopies(src);
  return c ? { src: c.w96, srcSet: `${c.w96} 96w, ${c.w320} 320w`, sizes: `${size}px` } : { src };
}

/** A card's art window: the 320 px copy, and the 800 px one for large cards and sharp screens (null: as is). */
export function cardArtSources(src: string): { card: string; srcSet: string } | null {
  const c = artCopies(src);
  return c ? { card: c.w320, srcSet: `${c.w320} 320w, ${c.w800} 800w` } : null;
}
