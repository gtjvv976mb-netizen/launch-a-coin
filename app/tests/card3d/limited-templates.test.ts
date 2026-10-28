import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cardLabel, faceSlot, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { ThemeEmblem } from "../../src/components/mintdex/theme-emblem";
import { BackFace } from "../../src/components/mintdex/card3d/backface";
import type { CardBackTheme } from "../../src/components/mintdex/card3d/types";
import { EDITION_CATALOG } from "../../src/lib/mintdex/editions";
import { MEME_ICON_CATALOG } from "../../src/lib/mintdex/meme-icons";
import {
  LIMITED_TEMPLATE_CATALOG,
  LIMITED_TEMPLATE_CATEGORIES,
  getLimitedTemplate,
  limitedTemplateFromSearch,
  limitedTemplateLinkedTokenId,
  limitedTemplateSearch,
  limitedTemplateTheme,
  type LimitedTemplateKey,
} from "../../src/lib/mintdex/limited-templates";
import { MAX_LEVEL, frameLayout, tierForLevel } from "../../src/lib/mintdex/tiers";

const TOKEN: Readonly<CardData> = Object.freeze({
  name: "Independent Creator Token", ticker: "OWN", image: "/actual-creator-token.webp",
  level: 8, mcapUsd: 845_000, holders: 372, dexNo: 19,
  lore: "The creator’s original story.", ownerHandle: "actual_creator",
  mintAddress: "4WdMXAGBiFaVxU57tV6ohGjZPP5heXzntzScBTnXmint",
});
const render = (card: CardData) => renderToStaticMarkup(createElement(MintCardFace, { card }));
const classText = (markup: string, name: string) => markup.match(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"[^>]*>([^<]*)<`))?.[1];
const artStyle = (markup: string) => markup.match(/<div[^>]*class="[^"]*\bmdx-card__art\b[^"]*"[^>]*style="([^"]*)"/)?.[1];
const printStructure = (markup: string) => [...markup.matchAll(/<(?:div|span|p)\b[^>]*class="[^"]*\bmdx-card__(?:name|title|numeral|type|ticker|text|lore|rows|row|foot|clip|long|short)[^"]*"[^>]*>/g)].map((match) => match[0]);
const statValues = (markup: string) => [...markup.matchAll(/<b>(.*?)<\/b>/g)].map((match) => match[1]);

describe("one complete limited-edition catalog", () => {
  test("all twenty existing styles remain independently selectable in four categories", () => {
    const expected = [...MEME_ICON_CATALOG, ...EDITION_CATALOG].map((entry) => entry.key);
    const keys = LIMITED_TEMPLATE_CATALOG.map((entry) => entry.key);
    expect(keys).toEqual(expected);
    expect(new Set(keys).size).toBe(20);
    expect(LIMITED_TEMPLATE_CATEGORIES.map((category) => category.key)).toEqual(["memecoins", "meme-stocks", "crypto-companies", "original-themes"]);
    expect(LIMITED_TEMPLATE_CATEGORIES.map((category) => LIMITED_TEMPLATE_CATALOG.filter((entry) => entry.category === category.key).length)).toEqual([6, 4, 4, 6]);
    for (const entry of LIMITED_TEMPLATE_CATALOG) {
      expect(getLimitedTemplate(entry.key)).toBe(entry);
      expect(entry.availability).toBe("preview");
      expect(entry.priceLamports).toBeNull();
      expect(entry.cap).toBeNull();
    }
  });

  test("canonical selections round-trip every old icon and edition key without mixed fields", () => {
    for (const entry of LIMITED_TEMPLATE_CATALOG) {
      const search = limitedTemplateSearch(entry.key);
      expect(search.collection).toBe("limited");
      expect(Object.keys(search).sort()).toEqual(entry.kind === "icon" ? ["collection", "icon"] : ["collection", "edition"]);
      expect(limitedTemplateFromSearch(search)).toBe(entry);
      const theme = limitedTemplateTheme(entry);
      expect(theme).toEqual(entry.kind === "icon" ? { memeIcon: entry.key } : { edition: entry.key });
      expect(Object.keys(theme)).toHaveLength(1);
    }
  });

  test("malformed, unknown and cross-kind selections have an explicit safe default", () => {
    for (const value of [null, undefined, "", "constructor", "__proto__", "DOGE", {}, ["doge"], 14]) expect(getLimitedTemplate(value)).toBeNull();
    for (const search of [undefined, null, {}, { icon: "unknown" }, { edition: "doge" }, { icon: "wildtype" }, { icon: ["doge"], edition: 1 }]) expect(limitedTemplateFromSearch(search).key).toBe("doge");
    expect(limitedTemplateFromSearch({ icon: "pepe", edition: "ronin" }).key).toBe("pepe");
    expect(limitedTemplateFromSearch({ icon: "unknown", edition: "ronin" }).key).toBe("ronin");
    expect(limitedTemplateSearch("unknown" as LimitedTemplateKey)).toEqual({ collection: "limited", icon: "doge" });
  });

  test("legacy viewer links restore only an exactly listed public token and catalog-valid style", () => {
    const ids = [TOKEN.mintAddress!, "5bgZ1Ge4knq26U9dbtxSvm2tk68hkw2dhZ9v2QEmint"], tokens = ids.map((id) => ({ id }));
    for (const entry of LIMITED_TEMPLATE_CATALOG) {
      for (const id of ids) {
        const prefix = entry.kind === "icon" ? "creator-template" : "edition";
        expect(limitedTemplateLinkedTokenId(`${prefix}-${id}-${entry.key}`, tokens)).toBe(id);
        expect(limitedTemplateLinkedTokenId(`${prefix}-${id}-${entry.key}`, [])).toBeNull();
        const wrongPrefix = entry.kind === "icon" ? "edition" : "creator-template";
        expect(limitedTemplateLinkedTokenId(`${wrongPrefix}-${id}-${entry.key}`, tokens)).toBeNull();
        expect(limitedTemplateLinkedTokenId(`${prefix}-${id}-${entry.key}-extra`, tokens)).toBeNull();
      }
    }
    for (const input of [undefined, null, {}, ["doge"], 1, "", "constructor", `creator-template-${ids[0]}-unknown`, "creator-template-preview-doge", `edition-${ids[0].slice(1)}-wildtype`]) expect(limitedTemplateLinkedTokenId(input, tokens)).toBeNull();
  });
});

describe("exact original print and actual earned state", () => {
  test("all 280 theme/tier combinations preserve canonical art, panels, identity and statistics", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const source = Object.freeze({ ...TOKEN, level }), original = render(source);
      for (const entry of LIMITED_TEMPLATE_CATALOG) {
        const theme = limitedTemplateTheme(entry), card = Object.freeze({ ...source, ...theme });
        const markup = render(card), slot = faceSlot(card), ordinary = faceSlot(source);
        expect(printStructure(markup)).toEqual(printStructure(original));
        expect(artStyle(markup)).toBe(artStyle(original));
        expect(statValues(markup)).toEqual(statValues(original));
        for (const name of ["mdx-card__title", "mdx-card__ticker", "mdx-card__numeral", "mdx-card__lore"]) expect(classText(markup, name)).toBe(classText(original, name));
        expect(markup).toContain(`src="${source.image}"`);
        expect(slot.tier).toEqual(ordinary.tier);
        expect(slot.tier.key).toBe(tierForLevel(level).key);
        expect(slot.backTheme).toEqual(theme);
        expect(cardLabel(card)).toContain(`tier ${level} of ${MAX_LEVEL}`);
        expect(source.level).toBe(level);
      }
    }
    expect(TOKEN.level).toBe(8);
  });

  test("empty artwork and long local identity stay honest across all twenty styles", () => {
    const custom = Object.freeze({ ...TOKEN, name: "非常に長い名前 🦊 " + "My independent token ".repeat(10), ticker: "MYOWN".repeat(8), image: "", level: 1, mintAddress: null, ownerHandle: undefined, mcapLabel: "Not quoted", mcapUsd: 0, holders: 0, dexLabel: "Preview" });
    for (const entry of LIMITED_TEMPLATE_CATALOG) {
      const card = { ...custom, ...limitedTemplateTheme(entry) }, markup = render(card), label = cardLabel(card);
      expect(classText(markup, "mdx-card__title")).toBe(custom.name);
      expect(classText(markup, "mdx-card__ticker")).toBe(`$${custom.ticker}`);
      expect(classText(markup, "mdx-card__numeral")).toBe("—");
      expect(markup).not.toContain('src=""');
      expect(markup).toContain("Your token art");
      expect(label).toContain("template preview");
      expect(label).not.toMatch(/Spark design|tier 1|market cap \$0|owner @/);
    }
  });
});

describe("recognizable cosmetic subjects on both sides", () => {
  test("premium backs use the same responsive card size as their front and original reverse", () => {
    const sizes = "(max-width: 767px) 72vw, 380px";
    for (const entry of LIMITED_TEMPLATE_CATALOG.filter((entry) => entry.backArtSrc)) {
      const markup = renderToStaticMarkup(createElement(BackFace, { sizes, eager: true, theme: limitedTemplateTheme(entry) }));
      const print = markup.match(/<img\b[^>]*data-theme-back-print="[^"]+"[^>]*>/)?.[0];
      expect(print).toBeDefined();
      expect(print).toContain(`sizes="${sizes}"`);
      expect(print).toContain("320w");
      expect(markup).not.toContain("360px, 720px");
    }
  });

  test("Doge lives in the front frame while its portrait remains on the reverse", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const source = { ...TOKEN, level }, markup = render({ ...source, memeIcon: "doge" });
      expect(markup).not.toContain("data-meme-mascot=");
      expect(markup).not.toContain("data-meme-theme-portrait=");
      expect(markup).not.toContain('data-theme-wordmark=');
      expect(markup).toContain('data-theme-frame-art="doge"');
      expect(markup).toContain('src="/assets/editions/meme-icons/doge-premium-front-320.webp"');
      expect(markup).not.toContain('data-theme-seal="doge"');
      expect(markup).toContain(`src="${source.image}"`);
      expect(artStyle(markup)).toBe(artStyle(render(source)));
    }
    const back = renderToStaticMarkup(createElement(BackFace, { sizes: "300px", theme: { memeIcon: "doge" } }));
    expect(back).toContain('data-meme-theme-portrait="doge"');
    expect(back).toContain('data-theme-back-print="doge"');
    expect(back).toContain('src="/assets/editions/meme-icons/doge-premium-back.webp"');
  });

  test("the agreed footer seal, including its five-degree variant, clears every original printed panel", () => {
    const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const height = .15 * 63 / 88;
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const layout = frameLayout(tierForLevel(level).key);
      for (const angle of [0, 5]) {
        const scale = Math.cos(angle * Math.PI / 180) + Math.sin(angle * Math.PI / 180);
        const seal = { x: .5 - .15 * scale / 2, y: .857 + (height - height * scale) / 2, w: .15 * scale, h: height * scale };
        for (const panel of [layout.name, layout.type, layout.text, ...layout.footer]) expect(intersects(seal, panel)).toBe(false);
      }
    }
  });

  test("new front subjects remain separate from the creator artwork and canonical printed labels", () => {
    for (const entry of LIMITED_TEMPLATE_CATALOG.filter((entry) => entry.kind === "icon")) {
      const markup = render({ ...TOKEN, ...limitedTemplateTheme(entry) });
      for (const layer of ["seal", "perimeter"]) {
        if (!entry.frameArtSrc) expect(markup).toContain(`data-theme-${layer}="${entry.key}"`);
        else expect(markup).not.toContain(`data-theme-${layer}="${entry.key}"`);
      }
      expect(markup).not.toContain("data-theme-wordmark=");
      if (!entry.frameArtSrc) expect(markup).toContain(`data-theme-emblem="${entry.key}"`);
      else {
        expect(markup).toContain(`data-theme-frame-art="${entry.key}"`);
        expect(markup).toContain(entry.frameArtSrc.replace(/\.webp$/, "-320.webp"));
        expect(markup).not.toContain("data-meme-mascot=");
      }
      expect(classText(markup, "mdx-card__title")).toBe(TOKEN.name);
      expect(classText(markup, "mdx-card__ticker")).toBe(`$${TOKEN.ticker}`);
      expect(markup).toContain(`src="${TOKEN.image}"`);
    }
  });

  test("all twenty emblems have distinct subject geometry rather than color-only variants", () => {
    const subjects = new Set<string>();
    for (const entry of LIMITED_TEMPLATE_CATALOG) {
      const markup = renderToStaticMarkup(createElement(ThemeEmblem, { icon: entry.key }));
      expect(markup).toContain(`data-theme-emblem="${entry.key}"`);
      expect(markup).toContain('aria-hidden="true"');
      const geometry = [...markup.matchAll(/<(?:path|circle|rect|ellipse|polygon|polyline)\b[^>]*>/g)].map((match) => match[0].replace(/\sclass="[^"]*"/g, "")).join("");
      expect(geometry.length).toBeGreaterThan(30);
      subjects.add(geometry);
    }
    expect(subjects.size).toBe(20);
  });

  test("each reverse carries its selected theme and a prominent matching subject", () => {
    for (const entry of LIMITED_TEMPLATE_CATALOG) {
      const markup = renderToStaticMarkup(createElement(BackFace, { sizes: "300px", theme: limitedTemplateTheme(entry) }));
      expect(markup).toContain(`data-theme-back="${entry.key}"`);
      expect(markup).toContain("mdx-theme-back__hero");
      if (entry.category === "memecoins") expect(markup).toContain(`data-meme-theme-portrait="${entry.key}"`);
      else expect(markup).toContain(`data-theme-emblem="${entry.key}"`);
      expect(markup).not.toContain(TOKEN.name);
      expect(markup).not.toContain(TOKEN.mintAddress!);
      expect(markup).not.toMatch(/data-tier=|data-level=|mdx-card3d__back-emblem/);
      expect(markup.replace(/<[^>]+>/g, "").trim()).toBe("");
    }
  });

  test("ordinary backs remain byte-identical to the pre-theme lazy, eager and standalone-face render", () => {
    // Captured from the unchanged renderer before this addition; this protects the public earned-card reverse.
    const baseline = {
      lazy: "914baa3d66ef4289f02dd97a8df0ab79490cbad8f0aa5c245bbe47b154da2816",
      eager: "5b5fed0e6441fefa135726d800ae2a5b68da22cc4b5745c932a9f616fe4e73f9",
      face: "54e3afdaa346a3355b5e33b60d0e13f5687fba24dbd36268d90836e67fdffdab",
    };
    for (const [key, props] of Object.entries({ lazy: {}, eager: { eager: true }, face: { eager: true, face: true } })) {
      for (const theme of [undefined, {}, { memeIcon: "unknown" } as unknown as CardBackTheme]) {
        const markup = renderToStaticMarkup(createElement(BackFace, { sizes: "300px", ...props, theme }));
        expect(createHash("sha256").update(markup).digest("hex")).toBe(baseline[key as keyof typeof baseline]);
        expect(markup).not.toContain("data-theme-back");
      }
    }
    expect(faceSlot(TOKEN).backTheme).toBeUndefined();
  });
});
