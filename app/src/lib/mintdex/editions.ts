/**
 * Cosmetic edition concepts. These are previews, not purchasable inventory or token entitlements.
 * Market-cap progression remains in tiers.ts and is deliberately independent of this catalog.
 */
export type EditionKey = "wildtype" | "ronin" | "astral" | "neon-circuit" | "sovereign" | "abyssal";

export type Edition = {
  key: EditionKey;
  name: string;
  tagline: string;
  description: string;
  finish: string;
  palette: readonly [string, string, string];
  motifs: readonly string[];
  /** Matching text-free premium prints; the original geometric style remains an image-error fallback. */
  frameArtSrc?: string;
  backArtSrc?: string;
  availability: "preview";
  priceLamports: null;
  cap: null;
};

export const EDITION_CATALOG: readonly Edition[] = [
  {
    key: "wildtype",
    name: "Wildtype",
    tagline: "A creature collector's field card.",
    description: "A vivid creature-battler treatment with an enamel crest and emerald foil around the original card layout. Your token's own artwork takes the spotlight.",
    finish: "Emerald foil · enamel details",
    palette: ["#163b25", "#c8e58c", "#f3e9ba"],
    motifs: ["field-card panels", "enamel crest", "emerald foil"],
    availability: "preview",
    priceLamports: null,
    cap: null,
  },
  {
    key: "ronin",
    name: "Ronin",
    tagline: "Ink, vermilion and a quiet blade.",
    description: "Woodblock-inspired linework, ivory paper, a vertical lacquer rail and a vermilion print seal around the original card layout.",
    finish: "Ivory paper · vermilion lacquer",
    palette: ["#231f1c", "#b63829", "#eadfc5"],
    motifs: ["vertical lacquer rail", "print seal", "lacquer corner folds"],
    availability: "preview",
    priceLamports: null,
    cap: null,
  },
  {
    key: "astral",
    name: "Astral",
    tagline: "An artifact from another sky.",
    description: "An arched celestial reliquary with a precise star chart, lavender silverwork and a deep midnight field around the token art.",
    finish: "Lunar silver · opal foil",
    palette: ["#18152f", "#d2c8ff", "#b3c9e4"],
    motifs: ["reliquary arch", "star chart", "silver cornerwork"],
    availability: "preview",
    priceLamports: null,
    cap: null,
  },
  {
    key: "neon-circuit",
    name: "Neon Circuit",
    tagline: "Made for the city after dark.",
    description: "Industrial cut-corner engraving, asymmetric signal rails and electric cyan foil with a coral accent. The original card shape and layout stay intact.",
    finish: "Brushed graphite · signal foil",
    palette: ["#102b35", "#9ef5e4", "#ff926f"],
    motifs: ["cut corners", "circuit traces", "signal rails"],
    availability: "preview",
    priceLamports: null,
    cap: null,
  },
  {
    key: "sovereign",
    name: "Sovereign",
    tagline: "A place in the private collection.",
    description: "A black-and-gold archival treatment with engraved corner geometry, antique gold inlay and a sculpted nameplate in the original card layout.",
    finish: "Obsidian lacquer · antique gold",
    palette: ["#171812", "#dfc68c", "#ede2c3"],
    motifs: ["archival plaque", "engraved corners", "gold inlay"],
    availability: "preview",
    priceLamports: null,
    cap: null,
  },
  {
    key: "abyssal",
    name: "Abyssal",
    tagline: "A specimen from the deep.",
    description: "Blue-green specimen glass, polished silver fittings and layered waterline engravings around the original artwork window and information panels.",
    finish: "Sea glass · pearlescent silver",
    palette: ["#103f4a", "#b4ebe0", "#d5e9da"],
    motifs: ["glass specimen case", "waterline engravings", "silver fittings"],
    availability: "preview",
    priceLamports: null,
    cap: null,
  },
];

/** Unknown values must never silently select or imply an owned edition. */
export function getEdition(input: unknown): Edition | null {
  if (typeof input !== "string") return null;
  return EDITION_CATALOG.find((edition) => edition.key === input) ?? null;
}
