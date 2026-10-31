/**
 * The site's official accounts (owner, 31 October 2026): its X account and its own pump.fun token. One source for
 * the rail and phone links (components/carddex/OfficialLinks.tsx), How it works (#official), the twitter:site and
 * twitter:creator tags (routes/__root.tsx, lib/mintdex/seo.ts) and Home's JSON-LD sameAs (routes/index.tsx).
 *
 * The token was created directly on pump.fun by the owner's wallet, not through Launch a Card, and trades there
 * against the CARDS quote. Plain information only: no price, market cap or holder figures are shown for it.
 */

/** The X account. */
export const OFFICIAL_X_HANDLE = "@launchacard";
export const OFFICIAL_X_URL = "https://x.com/launchacard";

/** The official token: its on-chain name and symbol exactly as its metadata holds them (Token-2022). */
export const OFFICIAL_TOKEN_MINT = "4fdJZFkHBLZAydpnRAfRscZfRdZiuWqTHZNXjjRnpump";
export const OFFICIAL_TOKEN_NAME = "launchacard.fun";
export const OFFICIAL_TOKEN_SYMBOL = "launchcard";
/** As the site prints any ticker: a dollar sign before the symbol as stored. */
export const OFFICIAL_TOKEN_TICKER = `$${OFFICIAL_TOKEN_SYMBOL}`;
/** Its pump.fun page (the canonical link, no query string; the same form as live/launches.ts pumpFunCoinUrl). Kept
 * free of imports so the head tags can read it without loading the pair registry. */
export const OFFICIAL_TOKEN_URL = `https://pump.fun/coin/${OFFICIAL_TOKEN_MINT}`;

/** Every official profile, for JSON-LD sameAs. */
export const OFFICIAL_SAME_AS = [OFFICIAL_X_URL, OFFICIAL_TOKEN_URL] as const;
