import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemeIconCard, MemeThemePortrait } from "../../src/components/mintdex/MemeIconCard";
import { cardLabel, faceSlot, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { memeIconMaterialStyle } from "../../src/components/mintdex/card3d/meme-icon-material";
import { templateStyle, TEMPLATES } from "../../src/components/mintdex/card3d/templates";
import { MEME_ICON_CATALOG, getMemeIcon } from "../../src/lib/mintdex/meme-icons";
import { MAX_LEVEL, tierForLevel } from "../../src/lib/mintdex/tiers";

const CATEGORIES = { memecoins: ["doge", "pepe", "shib", "bonk", "wif", "popcat"], "meme-stocks": ["gamestop", "amc", "blackberry", "nokia"], "crypto-companies": ["coinbase", "binance", "kraken", "strategy"] };
const TOKENS: readonly CardData[] = [
  Object.freeze({ name: "Actual Creator Token", ticker: "ACTUAL", image: "/actual-creator-token.png", lore: "The actual creator's own story.", level: 4, mcapUsd: 31_000, holders: 37, dexNo: 19, ownerHandle: "actual_creator", mintAddress: "5wuLNZrWnE666YpzcQqLgskjiPLdaW6AgjU9qmDdmint" }),
  Object.freeze({ name: "Second Independent Token", ticker: "SECOND", image: "/second-independent-token.png", lore: "A second independent story.", level: 12, mcapUsd: 4_000_000, holders: 42, dexNo: 31, ownerHandle: "second_creator", mintAddress: "2pZhX5QUMA8HhniLerwrWRU8vWBszCnC1CN7vRhzmint" }),
];
const render = (card: CardData) => renderToStaticMarkup(createElement(MintCardFace, { card }));
const classText = (markup: string, name: string) => markup.match(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"[^>]*>([^<]*)<`))?.[1];
const printStructure = (markup: string) => [...markup.matchAll(/<(?:div|span|p)\b[^>]*class="[^"]*\bmdx-card__(?:name|title|numeral|type|ticker|text|lore|rows|row|foot|clip|long|short)[^"]*"[^>]*>/g)].map((match) => match[0]);
const artStyle = (markup: string) => markup.match(/<div[^>]*class="[^"]*\bmdx-card__art\b[^"]*"[^>]*style="([^"]*)"/)?.[1];
const statValues = (markup: string) => [...markup.matchAll(/<b>(.*?)<\/b>/g)].map((match) => match[1]);

describe("creator template catalog", () => {
  test("fourteen legacy keys retain three categories without fixed token identities or inventory", () => {
    expect(MEME_ICON_CATALOG).toHaveLength(14); expect(new Set(MEME_ICON_CATALOG.map((entry) => entry.key)).size).toBe(14);
    for (const [category, keys] of Object.entries(CATEGORIES)) expect(MEME_ICON_CATALOG.filter((entry) => entry.category === category).map((entry) => entry.key)).toEqual(keys);
    for (const entry of MEME_ICON_CATALOG) {
      expect(getMemeIcon(entry.key)).toBe(entry); expect(entry.availability).toBe("preview"); expect(entry.priceLamports).toBeNull(); expect(entry.cap).toBeNull();
      expect(entry.name.length).toBeGreaterThan(3); expect("mintAddress" in entry || "owner" in entry || "tokenName" in entry || "ticker" in entry).toBe(false);
    }
  });
  test("unknown input cannot resolve to a template or a prototype property", () => {
    for (const input of [undefined, null, "", "unknown", "DOGE", " doge", "constructor", "__proto__", 1, {}, ["doge"]]) { expect(getMemeIcon(input)).toBeNull(); expect(memeIconMaterialStyle(input)).toEqual({}); }
  });
  test("all fourteen templates retain their fallback styles and every available print is a real WebP asset", () => {
    expect(MEME_ICON_CATALOG.filter((entry) => entry.frameKind === "higgsfield")).toHaveLength(6);
    expect(MEME_ICON_CATALOG.filter((entry) => entry.frameKind === "crafted")).toHaveLength(8);
    for (const entry of MEME_ICON_CATALOG) {
      if (entry.frameKind === "crafted") expect(entry.artSrc).toBeNull();
      else expect(typeof entry.artSrc).toBe("string");
      const prints = [entry.artSrc, entry.frameArtSrc, entry.backArtSrc].filter((path): path is string => !!path);
      for (const path of prints.flatMap((print) => [print, print.replace(/\.webp$/, "-320.webp")])) {
        const bytes = readFileSync(new URL(`../../public${path}`, import.meta.url));
        expect(bytes.subarray(0, 4).toString()).toBe("RIFF"); expect(bytes.subarray(8, 12).toString()).toBe("WEBP"); expect(bytes.byteLength).toBeGreaterThan(1000);
      }
    }
  });
});

describe("each template wears the creator's own token", () => {
  for (const entry of MEME_ICON_CATALOG) for (const source of TOKENS) {
    test(`${entry.key} preserves ${source.ticker} name, ticker and artwork`, () => {
      const card = Object.freeze({ ...source, memeIcon: entry.key }), markup = render(card);
      expect(markup).toContain(`data-meme-icon="${entry.key}"`); expect(classText(markup, "mdx-card__title")).toBe(source.name); expect(classText(markup, "mdx-card__ticker")).toBe(`$${source.ticker}`);
      expect(markup).toContain(`src="${source.image}"`); expect(markup).not.toContain(TOKENS.find((token) => token.ticker !== source.ticker)!.image);
      expect(markup).not.toContain("TEMPLATE PREVIEW"); expect(markup).not.toContain("Artwork pending"); expect(markup).not.toContain("Awaiting generation"); expect(markup).not.toContain("TRIBUTE CONCEPT");
      const original = render(source);
      expect(printStructure(markup)).toEqual(printStructure(original));
      expect(artStyle(markup)).toBe(artStyle(original));
      expect(statValues(markup)).toEqual(statValues(original));
      expect(markup).toContain(source === TOKENS[0] ? ">$31K</b>" : ">$4M</b>");
      expect(classText(markup, "mdx-card__lore")).toBe(classText(original, "mdx-card__lore"));
      expect(classText(markup, "mdx-card__numeral")).toBe(classText(original, "mdx-card__numeral"));
      for (const content of ["Token address", "Market cap", "Holders", `>${source.holders}</b>`, `@${source.ownerHandle}`]) expect(markup).toContain(content);
      expect(markup).not.toContain(`class="mdx-meme-icon__name">${entry.name}`);
      const label = cardLabel(card); expect(label).toContain(source.name); expect(label).toContain(`${entry.name} template preview`); expect(label).toContain(`${tierForLevel(source.level).name} design, tier ${source.level} of ${MAX_LEVEL}`); expect(label).toContain(`owner @${source.ownerHandle}`);
      expect(faceSlot(card).tier).toEqual(faceSlot(source).tier); expect(card).toEqual({ ...source, memeIcon: entry.key });
    });
  }
  test("empty creator artwork stays empty while deliberate mascot decoration remains separate", () => {
    for (const entry of MEME_ICON_CATALOG) {
      const card = { ...TOKENS[0], image: "", memeIcon: entry.key }, markup = renderToStaticMarkup(createElement(MemeIconCard, { icon: entry, card }));
      expect(classText(markup, "mdx-card__title")).toBe(card.name); expect(classText(markup, "mdx-card__ticker")).toBe(`$${card.ticker}`);
      expect(markup).toContain("mdx-meme-icon__art-empty"); expect(markup).not.toContain('src=""'); expect(markup).not.toContain("Artwork pending"); expect(markup).not.toContain("TRIBUTE CONCEPT");
      const artWell = markup.match(/class="[^"]*mdx-meme-icon__art[^\"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      expect(artWell).toBeDefined(); expect(artWell).not.toContain("<img");
      if (entry.category === "memecoins" && !entry.frameArtSrc) expect(markup).toContain(`data-meme-mascot="${entry.key}" aria-hidden="true"`);
      if (entry.frameArtSrc) expect(markup).not.toContain("data-meme-mascot=");
    }
  });
  test("long and non-Latin names remain intact in server markup instead of reverting to a famous token", () => {
    const name = "非常に長い名前 🦊 " + "Independent Creator Token ".repeat(12), ticker = "MYOWN".repeat(10);
    for (const entry of MEME_ICON_CATALOG) {
      const markup = render({ ...TOKENS[0], name, ticker, memeIcon: entry.key });
      expect(classText(markup, "mdx-card__title")).toBe(name); expect(classText(markup, "mdx-card__ticker")).toBe(`$${ticker}`); expect(markup).toContain(`src="${TOKENS[0].image}"`);
    }
  });
  test("custom local preview labels do not invent an earned Spark tier, quote or owner", () => {
    for (const entry of MEME_ICON_CATALOG) {
      const custom = { ...TOKENS[0], name: "My Custom Token", ticker: "MINE", image: "blob:local-only-preview", level: 1, mcapUsd: 0, mcapLabel: "Not quoted", mintAddress: null, ownerHandle: undefined, memeIcon: entry.key };
      const markup = render(custom), label = cardLabel(custom);
      expect(markup).toContain(custom.image); expect(classText(markup, "mdx-card__title")).toBe(custom.name); expect(label).toContain(custom.name); expect(label).toContain("template preview"); expect(label).toMatch(/not quoted/i); expect(label).not.toMatch(/Spark design|tier 1|owner @|market cap \$0/);
      expect(classText(markup, "mdx-card__numeral")).toBe("—"); expect(markup).toContain("Preview");
    }
  });
});

describe("visible meme illustrations are decoration rather than token identity", () => {
  test("exactly the six meme-coin templates have valid retained-image portrait crops", () => {
    expect(MEME_ICON_CATALOG.filter((entry) => entry.mascotCrop).map((entry) => entry.key)).toEqual(CATEGORIES.memecoins);
    for (const entry of MEME_ICON_CATALOG.filter((entry) => entry.mascotCrop)) {
      const [x, y, size] = entry.mascotCrop!;
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(size).toBeGreaterThan(0);
      expect(x + size).toBeLessThanOrEqual(956); expect(y + size).toBeLessThanOrEqual(1440);
      const portrait = renderToStaticMarkup(createElement(MemeThemePortrait, { icon: entry }));
      expect(portrait).toContain(`data-meme-theme-portrait="${entry.key}"`); expect(portrait).toContain(`${entry.inspiration} theme illustration`);
      expect(portrait).toContain(`src="${entry.artSrc!.replace(/\.webp$/, "-320.webp")}"`);
    }
  });
  test("mascots have their own hidden decorative layer and never replace either creator token's art window", () => {
    for (const entry of MEME_ICON_CATALOG.filter((entry) => entry.mascotCrop && !entry.frameArtSrc)) for (const source of TOKENS) {
      const markup = render({ ...source, memeIcon: entry.key });
      const well = markup.match(/<div[^>]*class="[^"]*\bmdx-meme-icon__art\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      expect(well).toContain(`src="${source.image}"`); expect(well).not.toContain("data-meme-mascot"); expect(well).not.toContain("data-meme-theme-portrait");
      expect(markup).toContain(`class="mdx-meme-icon__mascot" data-meme-mascot="${entry.key}" aria-hidden="true"`);
      expect(classText(markup, "mdx-card__title")).toBe(source.name); expect(classText(markup, "mdx-card__ticker")).toBe(`$${source.ticker}`);
      expect(printStructure(markup)).toEqual(printStructure(render(source))); expect(artStyle(markup)).toBe(artStyle(render(source)));
    }
  });
  test("crafted non-meme templates and malformed input do not acquire a substitute mascot", () => {
    for (const entry of MEME_ICON_CATALOG.filter((entry) => !entry.mascotCrop)) {
      expect(render({ ...TOKENS[0], memeIcon: entry.key })).not.toContain("data-meme-mascot=");
      expect(renderToStaticMarkup(createElement(MemeThemePortrait, { icon: entry }))).toBe("");
    }
    expect(renderToStaticMarkup(createElement(MemeThemePortrait, { icon: "unknown" as never }))).toBe("");
  });
});

describe("cosmetic templates preserve real earned state", () => {
  test("all fourteen frames retain original printed content and geometry at every earned level", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const source = { ...TOKENS[0], level }, original = render(source);
      for (const entry of MEME_ICON_CATALOG) {
        const markup = render({ ...source, memeIcon: entry.key });
        expect(printStructure(markup)).toEqual(printStructure(original)); expect(artStyle(markup)).toBe(artStyle(original)); expect(statValues(markup)).toEqual(statValues(original));
        for (const name of ["mdx-card__title", "mdx-card__ticker", "mdx-card__numeral", "mdx-card__lore"]) expect(classText(markup, name)).toBe(classText(original, name));
      }
    }
  });
  test("standard renders and source data survive all template previews unchanged", () => {
    const snapshots = TOKENS.map((token) => ({ markup: render(token), data: JSON.stringify(token) })), templates = JSON.stringify(TEMPLATES);
    for (const entry of MEME_ICON_CATALOG) for (const token of TOKENS) render({ ...token, memeIcon: entry.key });
    for (const [index, token] of TOKENS.entries()) { expect(render(token)).toBe(snapshots[index].markup); expect(JSON.stringify(token)).toBe(snapshots[index].data); expect(render(token)).toContain(`data-tier="${tierForLevel(token.level).key}"`); expect(render(token)).not.toContain("data-meme-icon="); }
    expect(JSON.stringify(TEMPLATES)).toBe(templates);
  });
  test("material overrides cannot grant rarity, ownership or purchase rights", () => {
    const templates = JSON.stringify(TEMPLATES);
    for (const entry of MEME_ICON_CATALOG) {
      const material = memeIconMaterialStyle(entry.key) as Record<string, unknown>;
      expect(Object.keys(material).every((property) => property.startsWith("--"))).toBe(true); expect(Object.keys(material).some((property) => /tier|level|price|owner|inventory|supply|entitlement/.test(property))).toBe(false);
      for (const property of ["--bk-field", "--bk-motif", "--edge-fill"]) expect(String(material[property]).length).toBeGreaterThan(0);
      for (const token of TOKENS) { const standard = templateStyle(tierForLevel(token.level).key), before = JSON.stringify(standard); render({ ...token, memeIcon: entry.key }); expect(JSON.stringify(standard)).toBe(before); expect(faceSlot({ ...token, memeIcon: entry.key }).tier.key).toBe(tierForLevel(token.level).key); }
    }
    expect(JSON.stringify(TEMPLATES)).toBe(templates);
  });
});
