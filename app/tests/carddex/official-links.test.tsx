import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  OFFICIAL_SAME_AS,
  OFFICIAL_TOKEN_MINT,
  OFFICIAL_TOKEN_NAME,
  OFFICIAL_TOKEN_SYMBOL,
  OFFICIAL_TOKEN_TICKER,
  OFFICIAL_TOKEN_URL,
  OFFICIAL_X_HANDLE,
  OFFICIAL_X_URL,
} from "../../src/lib/carddex/official";
import { OfficialLinksDetails, OfficialPhoneLinks, OfficialRailLinks } from "../../src/components/carddex/OfficialLinks";
import { pumpFunCoinUrl } from "../../src/lib/carddex/live/launches";
import { TWITTER_ACCOUNT_META, pageHead } from "../../src/lib/mintdex/seo";

// The owner's official X account and pump.fun token (31 October 2026): one constants module, linked from the shell
// and How it works, named in the twitter tags and Home's JSON-LD. Plain information: no price or return words.
const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");
const X = "https://x.com/launchacard";
const MINT = "LCNcvaC4ozvrhmBi34rVGXjSrkCQ59XyKfzycQipump";
const TOKEN = `https://pump.fun/coin/${MINT}`;

/** Every <a> in some markup, as its attributes. */
function anchors(html: string) {
  return [...html.matchAll(/<a\s([^>]*)>/g)].map((m) => {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

function expectBothLinks(html: string) {
  const links = anchors(html);
  const x = links.filter((a) => a.href === X);
  const token = links.filter((a) => a.href === TOKEN);
  expect(x.length).toBe(1);
  expect(token.length).toBe(1);
  for (const a of [...x, ...token]) {
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
  }
  expect(html).toContain("(opens X in a new tab)");
  expect(html).toContain("(opens pump.fun in a new tab)");
  // Only these two leave the site.
  expect(links.every((a) => a.href === X || a.href === TOKEN)).toBe(true);
}

describe("official links", () => {
  test("the constants are exactly the owner's account and token", () => {
    expect(OFFICIAL_X_URL).toBe(X);
    expect(OFFICIAL_X_HANDLE).toBe("@launchacard");
    expect(OFFICIAL_TOKEN_MINT).toBe(MINT);
    expect(OFFICIAL_TOKEN_MINT).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(OFFICIAL_TOKEN_NAME).toBe("launchacard.fun");
    expect(OFFICIAL_TOKEN_SYMBOL).toBe("launchcard");
    expect(OFFICIAL_TOKEN_TICKER).toBe("$launchcard");
    expect(OFFICIAL_TOKEN_URL).toBe(TOKEN);
    expect(OFFICIAL_TOKEN_URL).toBe(pumpFunCoinUrl(MINT));
    expect(OFFICIAL_TOKEN_URL).not.toContain("?");
    expect([...OFFICIAL_SAME_AS]).toEqual([X, TOKEN]);
  });

  test("the rail, phone and How it works render both links with safe rel and a new-tab hint", () => {
    expectBothLinks(renderToStaticMarkup(<OfficialRailLinks />));
    const phone = renderToStaticMarkup(<OfficialPhoneLinks />);
    expectBothLinks(phone);
    expect(phone).toContain('aria-label="Official links"');
    expect(phone).toContain("lg:hidden");
    expect(phone).toContain("mdx-hit");
    const how = renderToStaticMarkup(<OfficialLinksDetails />);
    expectBothLinks(how);
    expect(how).toContain(`<span class="cdx-how__mint">${MINT}</span>`);
    expect(how).toContain("not this site&#x27;s");
  });

  test("the shell and How it works use them", () => {
    const shell = read("src/components/mintdex/AppShell.tsx");
    expect(shell).toContain("<OfficialRailLinks />");
    expect(shell).toContain("<OfficialPhoneLinks />");
    expect(shell.indexOf("Terms &amp; risks")).toBeLessThan(shell.indexOf("<OfficialRailLinks />"));
    const how = read("src/routes/how.tsx");
    expect(how).toContain('id: "official"');
    expect(how).toContain("<OfficialLinksDetails />");
    const css = read("src/styles/screens/how.css");
    expect(css).toMatch(/\.cdx-how__mint \{[^}]*overflow-wrap: anywhere/);
  });

  test("How it works: the X and token rows are 44px apart, so their hit areas never overlap", () => {
    const how = renderToStaticMarkup(<OfficialLinksDetails />);
    // Both link rows carry the 44px row class, and nothing else does.
    expect(how.match(/<li class="cdx-how__linkrow">/g)?.length).toBe(2);
    const css = read("src/styles/screens/how.css");
    const rule = css.match(/\.cdx-how__section li\.cdx-how__linkrow \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("margin-top: 0");
    // 15px x 1.5 line plus 11px above and below: a 44.5px pitch, at least the 44px touch hit area.
    const pad = Number(rule.match(/padding-block: (\d+)px/)?.[1]);
    expect(15 * 1.5 + 2 * pad).toBeGreaterThanOrEqual(44);
  });

  test("the rail shows both links in one row, so the rail foot keeps its height", () => {
    const rail = renderToStaticMarkup(<OfficialRailLinks />);
    expect(rail.startsWith('<div class="flex flex-wrap items-center gap-x-4"')).toBe(true);
    expect(anchors(rail).length).toBe(2);
    // Visible text starts each accessible name (WCAG 2.5.3 label in name).
    expect(rail).toContain("@launchacard<span class=\"sr-only\"> on X (opens X in a new tab)</span>");
    expect(rail).toContain("Token<span class=\"sr-only\"> $launchcard, this site&#x27;s official token (opens pump.fun in a new tab)</span>");
  });

  test("twitter:site and twitter:creator name the account on every page", () => {
    expect([...TWITTER_ACCOUNT_META]).toEqual([
      { name: "twitter:site", content: "@launchacard" },
      { name: "twitter:creator", content: "@launchacard" },
    ]);
    const { meta } = pageHead({ path: "/how", title: "How it works | Launch a Card" });
    expect(meta).toContainEqual({ name: "twitter:site", content: "@launchacard" });
    expect(meta).toContainEqual({ name: "twitter:creator", content: "@launchacard" });
    expect(read("src/routes/__root.tsx")).toContain("...TWITTER_ACCOUNT_META,");
  });

  test("Home's JSON-LD names both profiles in sameAs", () => {
    const home = read("src/routes/index.tsx");
    expect(home).toContain("sameAs: [...OFFICIAL_SAME_AS]");
    expect(home).not.toContain("No sameAs");
  });

  test("the copy has no price, return or buy words", () => {
    const text = [
      renderToStaticMarkup(<OfficialRailLinks />),
      renderToStaticMarkup(<OfficialPhoneLinks />),
      renderToStaticMarkup(<OfficialLinksDetails />),
    ]
      .join(" ")
      .replace(/<[^>]+>/g, " ")
      .toLowerCase();
    for (const word of ["price", "return", "profit", "gain", "market cap", "mcap", "holders", "invest", "moon", "buy", "pump it", "100x", "apy", "roi", "guarantee"]) {
      expect([word, text.includes(word)]).toEqual([word, false]);
    }
  });
});
