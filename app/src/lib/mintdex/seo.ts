// Search and share metadata (backlog P0-11, P1-12). Server-safe and client-safe: plain functions, used by route
// `head` options, robots.txt and the sitemap.
//
// The public site is https://mintdex.fun. It is served through a proxy in front of the Higgsfield website, so
// request.url on the server is NOT the public origin: always build absolute URLs from SITE_ORIGIN. Once mintdex.fun
// serves the mainnet build (site-host.ts MAINNET_SITE_LIVE), the devnet build's own links move to devnet.mintdex.fun.

import { MODE_COPY } from "./copy";
import { IS_DEVNET, IS_SIM } from "./mode";
import { DEVNET_SITE_ORIGIN, MAINNET_SITE_LIVE, MAIN_SITE_ORIGIN } from "./site-host";

export const SITE_ORIGIN = IS_DEVNET && MAINNET_SITE_LIVE ? DEVNET_SITE_ORIGIN : MAIN_SITE_ORIGIN;
export const SITE_NAME = "Launch a Card";

/**
 * The site description (root default, Home, og:description). It overrides app-meta.json, which the marketplace
 * meta API writes with claims the test site cannot make; the mode suffix says what is real (P0-5).
 */
export const SITE_DESCRIPTION = sentences(
  "Pick a pair and its card comes with it. Launch a pump.fun token with its own one-of-one NFT trading card",
);

/**
 * The default share image (SEO-1): a 1200x630 capture of Home's hero, used wherever a route has no image of its
 * own. Absolute on launchacard.fun, since link previews need a full URL.
 */
export const SITE_OG_IMAGE = "/og/launch-a-card-1200x630.jpg";
export const SITE_OG_IMAGE_ALT = "Launch a Card: a token's one-of-one trading card under the headline Every coin is a card";

/** Static pages listed in the sitemap. */
export const STATIC_PATHS = ["/", "/discover", "/launch", "/levels", "/how", "/legal"] as const;

/** When the static pages last changed in a way search engines should notice. Bump by hand, never per request. */
export const STATIC_LASTMOD = "2026-10-29";

/**
 * /portfolio (one wallet's own list) stays out of search. Coin pages are finished mainnet launches
 * (routes/coin/$id.tsx), indexed and listed in sitemap.xml; these flags only steer the inherited chain pages.
 */
export const NOINDEX_COINS = IS_SIM;
export const NOINDEX_PORTFOLIO = IS_SIM;

/** "/coin/honk" or an absolute "https://..." in, absolute URL on mintdex.fun out (no query string). */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${SITE_ORIGIN}${path.split(/[?#]/)[0]}`;
}

/**
 * The one canonical path of a coin page. In sim it is the coin id (/coin/honk); typed tickers and ids in other
 * casings redirect here. On devnet it is the mint address (the coin id is the mint there too).
 */
export function canonicalCoinPath(coin: { id: string; mintAddress?: string | null }): string {
  return `/coin/${encodeURIComponent(IS_SIM ? coin.id : coin.mintAddress || coin.id)}`;
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A Solana address (base58, 32 to 44 characters), as opposed to a coin id or ticker. */
export function looksLikeAddress(s: string): boolean {
  return BASE58_ADDRESS.test(s.trim());
}

/** Shorten text to `max` characters at a word boundary, ending with a full stop. */
export function clip(text: string, max = 150): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}...`;
}

/** Joins sentences, adding a full stop where one is missing. */
export function sentences(...parts: Array<string | null | undefined | false>): string {
  return parts
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(" ");
}

export type HeadMeta = { title?: string; name?: string; property?: string; content?: string };
export type HeadLink = { rel: string; href: string };

export type PageHeadInput = {
  /** Path on mintdex.fun, for og:url and the canonical link. Query strings are dropped. */
  path: string;
  title: string;
  description?: string;
  /** Root-relative or absolute image URL. */
  image?: string | null;
  imageAlt?: string;
  imageW?: number;
  imageH?: number;
  /** twitter:card; defaults to summary_large_image when there is an image wider than tall, else summary. */
  card?: "summary" | "summary_large_image";
  /** Adds robots noindex (the page still renders and can be shared). */
  noindex?: boolean;
};

/**
 * Title, description, Open Graph and Twitter tags, plus the canonical link, for one route's `head`. Tags with
 * the same name or property as the root's defaults override them (TanStack keeps the deepest match).
 */
export function pageHead(input: PageHeadInput): { meta: HeadMeta[]; links: HeadLink[] } {
  if (!input.image) {
    input = { ...input, image: SITE_OG_IMAGE, imageW: 1200, imageH: 630, imageAlt: SITE_OG_IMAGE_ALT };
  }
  const url = absoluteUrl(input.path);
  const meta: HeadMeta[] = [
    { title: input.title },
    { property: "og:title", content: input.title },
    { name: "twitter:title", content: input.title },
    { property: "og:url", content: url },
  ];
  if (input.description) {
    meta.push(
      { name: "description", content: input.description },
      { property: "og:description", content: input.description },
      { name: "twitter:description", content: input.description },
    );
  }
  if (input.image) {
    const image = absoluteUrl(input.image);
    const card =
      input.card ??
      (input.imageW && input.imageH && input.imageW > input.imageH
        ? "summary_large_image"
        : "summary");
    meta.push(
      { property: "og:image", content: image },
      { name: "twitter:image", content: image },
      { name: "twitter:card", content: card },
    );
    if (input.imageW) meta.push({ property: "og:image:width", content: String(input.imageW) });
    if (input.imageH) meta.push({ property: "og:image:height", content: String(input.imageH) });
    if (input.imageAlt) {
      meta.push(
        { property: "og:image:alt", content: input.imageAlt },
        { name: "twitter:image:alt", content: input.imageAlt },
      );
    }
  }
  if (input.noindex) meta.push({ name: "robots", content: "noindex" });
  return { meta, links: [{ rel: "canonical", href: url }] };
}

/**
 * The share image for a coin's art: uploaded art at its 800px copy (the same file the big card shows, and a
 * lighter fetch for link previews; the original when an upload has no copies), seed art as is.
 */
export function shareArt(src: string) {
  return /^\/api\/img\/art\/[^?#]+$/.test(src) ? `${src}?w=800` : src;
}
