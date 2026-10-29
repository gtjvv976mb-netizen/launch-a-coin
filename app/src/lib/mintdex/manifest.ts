// The web app manifest, one per mode (launch-plan §6 APP, review low "shared manifest says test mode"). The proxy caches
// unhashed static files for 7 days and its rule is "a changed file ships under a new name", so each mode has its own
// file name (site.devnet.webmanifest, site.mainnet.webmanifest, site.sim.webmanifest) instead of the old shared
// /site.webmanifest that said "Live in test mode with test SOL." vite.config.ts emits only the build's own manifest
// into the client output (and serves it in dev); the root route links it. The mainnet text has no test words.
//
// Pure and import free (vite.config.ts loads it before Vite replaces import.meta.env). Owner: app.

export type ManifestMode = "sim" | "devnet" | "mainnet";

/** The same mapping as mode.ts: "sim" and "mainnet" by name, anything else (the platform build) is devnet. */
export function manifestModeOf(raw: string | undefined): ManifestMode {
  return "sim";
}

/** "site.mainnet.webmanifest": the file name, served from the site root. */
export function manifestFileName(mode: ManifestMode): string {
  return `site.${mode}.webmanifest`;
}

const DESCRIPTION: Record<ManifestMode, string> = {
  sim: "Choose a premium card design and launch through pump.fun. Explore the separate demo collection with test funds.",
  devnet: "The vintage card launchpad. Every coin is a one-of-one card. Live on Solana devnet.",
  mainnet: "The vintage card launchpad. Every coin is a one-of-one card.",
};

/** The manifest JSON text for a mode. */
export function webManifestText(mode: ManifestMode): string {
  const manifest = {
    name: "Launch a Card",
    short_name: "Launch a Card",
    description: DESCRIPTION[mode],
    start_url: "/",
    display: "standalone",
    background_color: "#14110d",
    theme_color: "#14110d",
    icons: [
      { src: "/assets/brand/carddex-192.png", sizes: "192x192", type: "image/png" },
      { src: "/assets/brand/carddex-512.png", sizes: "512x512", type: "image/png" },
      {
        // The card inside the 80% safe circle, so a round mask keeps its corners.
        src: "/assets/brand/carddex-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
