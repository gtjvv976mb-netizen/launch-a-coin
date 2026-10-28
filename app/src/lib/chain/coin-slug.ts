// Old coin links on devnet: /coin/honk, /coin/HONK, /coin/$honk and /coin/comet-corgi (the test-mode slugs, tickers
// and names people and earlier posts used) find the coin they name, so the coin route can answer 301 to /coin/{mint}.
//
// Owner: app:pages. Rules:
//   - one cheap GET read: the chain API's coins search (GET /coins?q=, a substring match on name and symbol that
//     already leaves hidden coins out, m3-contract §3.4), then an exact match here: the ticker (case-insensitive,
//     with or without a leading $) or the name slug ("Comet Corgi" and "comet-corgi" are the same slug);
//   - exactly one visible coin is a match; none or several is not (the route keeps its 404 and lists several);
//   - a failing chain API throws (ChainClientError): the caller decides, nothing here guesses.

import type { ApiCoinSummary } from "@mintdex/chain-sdk/api";

import { listCoins } from "./client";

export type CoinSlugMatch = { mint: string; name: string; symbol: string };

export type CoinSlugResult =
  | { status: "one"; match: CoinSlugMatch }
  | { status: "none" }
  | { status: "several"; matches: CoinSlugMatch[] };

/** Longest param that can name a coin (a name is at most 32 bytes; the Worker reads at most 64 characters of q). */
const MAX_TERM = 64;
/** Search pages read at most (100 coins each); the first one nearly always holds the coin. */
const MAX_PAGES = 5;

/** "Comet Corgi" → "comet-corgi": lowercase ASCII letters and digits, every other run becomes one hyphen. */
export function nameSlug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The term a coin param names, without a leading $ ("$HONK" → "HONK"); null when it cannot name a coin. */
export function coinTerm(param: string): string | null {
  const t = param.trim().replace(/^\$/, "").trim();
  if (!t || t.length > MAX_TERM) return null;
  return t;
}

/** True when `coin` goes by `term`: same ticker, same name slug, or the same name (case-insensitive). */
export function coinMatches(coin: Pick<ApiCoinSummary, "name" | "symbol">, term: string): boolean {
  const lower = term.toLowerCase();
  if (coin.symbol && coin.symbol.toLowerCase() === lower) return true;
  if (coin.name && coin.name.trim().toLowerCase() === lower) return true;
  const slug = nameSlug(term);
  return slug !== "" && nameSlug(coin.name) === slug;
}

/**
 * What to send as the search's q: the term itself when it has no separators (a ticker, a one-word name, or a name
 * the slug rules cannot spell), else the longest word of its slug ("comet-corgi" → "comet"), which the coin's name
 * contains. The exact match runs here afterwards.
 */
export function searchQuery(term: string): string | null {
  if (!/[\s\-_.+]/.test(term)) return term;
  const words = nameSlug(term).split("-").filter(Boolean);
  if (!words.length) return null;
  return words.reduce((a, b) => (b.length > a.length ? b : a));
}

/** The visible devnet coin(s) a ticker or name slug names, through the chain API's coins search. */
export async function resolveCoinSlug(param: string): Promise<CoinSlugResult> {
  const term = coinTerm(param);
  const q = term ? searchQuery(term) : null;
  if (!term || !q) return { status: "none" };
  const found = new Map<string, CoinSlugMatch>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await listCoins({ sort: "trending", q, limit: 100, cursor });
    for (const c of r.coins) {
      if (c.hidden === true || found.has(c.mint) || !coinMatches(c, term)) continue;
      found.set(c.mint, { mint: c.mint, name: c.name, symbol: c.symbol });
    }
    if (!r.nextCursor || r.coins.length === 0) break;
    cursor = r.nextCursor;
  }
  const matches = [...found.values()];
  if (matches.length === 1) return { status: "one", match: matches[0] };
  if (matches.length === 0) return { status: "none" };
  return { status: "several", matches };
}
