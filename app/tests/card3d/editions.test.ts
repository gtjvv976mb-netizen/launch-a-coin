import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cardLabel, faceSlot, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { editionMaterialStyle } from "../../src/components/mintdex/card3d/edition-material";
import { templateStyle, TEMPLATES } from "../../src/components/mintdex/card3d/templates";
import { EDITION_CATALOG, getEdition, type EditionKey } from "../../src/lib/mintdex/editions";
import { MAX_LEVEL, tierForLevel } from "../../src/lib/mintdex/tiers";

const TOKEN: CardData = {
  name: "Actual Token",
  ticker: "ACTUAL",
  image: "/api/chain/images/actual-token-art.png",
  level: 4,
  mcapUsd: 31_000,
  holders: 37,
  dexNo: 19,
  lore: "The token’s actual story.",
  ownerHandle: "actual_creator",
  mintAddress: "5wuLNZrWnE666YpzcQqLgskjiPLdaW6AgjU9qmDdmint",
};

function render(card: CardData) {
  return renderToStaticMarkup(createElement(MintCardFace, { card }));
}
const classText = (markup: string, name: string) => markup.match(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"[^>]*>([^<]*)<`))?.[1];
const printStructure = (markup: string) => [...markup.matchAll(/<(?:div|span|p)\b[^>]*class="[^"]*\bmdx-card__(?:name|title|numeral|type|ticker|text|lore|rows|row|foot|clip|long|short)[^"]*"[^>]*>/g)].map((match) => match[0]);
const artStyle = (markup: string) => markup.match(/<div[^>]*class="[^"]*\bmdx-card__art\b[^"]*"[^>]*style="([^"]*)"/)?.[1];
const statValues = (markup: string) => [...markup.matchAll(/<b>(.*?)<\/b>/g)].map((match) => match[1]);

describe("edition catalog and purchase truth", () => {
  test("six unique edition keys resolve to their catalog entries", () => {
    const keys = EDITION_CATALOG.map((edition) => edition.key);
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
    expect([...keys].sort()).toEqual(["abyssal", "astral", "neon-circuit", "ronin", "sovereign", "wildtype"]);
    for (const edition of EDITION_CATALOG) expect(getEdition(edition.key)).toBe(edition);
  });

  test("unknown keys and non-string values do not silently select an edition", () => {
    for (const value of [undefined, null, "", "unknown", "WILDTYPE", " wildtype", "constructor", 1, {}, ["wildtype"]]) {
      expect(getEdition(value)).toBeNull();
    }
  });

  test("every edition remains a preview without invented price or edition inventory", () => {
    for (const edition of EDITION_CATALOG) {
      expect(edition.availability).toBe("preview");
      expect(edition.priceLamports).toBeNull();
      expect(edition.cap).toBeNull();
    }
  });
});

describe("shared card renderer retains the token identity", () => {
  for (const edition of EDITION_CATALOG) {
    test(`${edition.name} uses the actual token name, ticker and image and identifies itself as a preview`, () => {
      const markup = render({ ...TOKEN, edition: edition.key });
      expect(markup).toContain(`data-edition="${edition.key}"`);
      expect(markup).toContain("data-edition-availability=\"preview\"");
      expect(markup).toContain("Actual Token");
      expect(markup).toContain("$ACTUAL");
      expect(markup).toContain(`src="${TOKEN.image}"`);
      expect(markup).not.toContain("EDITION PREVIEW");
      expect(markup).toContain(`${edition.name} cosmetic template preview. Not available to purchase.`);
      expect(printStructure(markup)).toEqual(printStructure(render(TOKEN)));
      expect(artStyle(markup)).toBe(artStyle(render(TOKEN)));
      expect(statValues(markup)).toEqual(statValues(render(TOKEN))); expect(markup).toContain(">$31K</b>");
      expect(classText(markup, "mdx-card__title")).toBe(TOKEN.name);
      expect(classText(markup, "mdx-card__ticker")).toBe(`$${TOKEN.ticker}`);
      expect(classText(markup, "mdx-card__lore")).toBe(TOKEN.lore);
      for (const content of ["Token address", "Market cap", "Holders", `>${TOKEN.holders}</b>`, `@${TOKEN.ownerHandle}`]) expect(markup).toContain(content);
      expect(markup).not.toContain("Your token art");
      expect(markup).not.toContain("Sold out");
    });
  }

  test("an empty-art preview stays explicit rather than borrowing another token’s artwork", () => {
    const markup = render({ ...TOKEN, image: "", edition: "wildtype" });
    expect(markup).toContain("Your token art");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Actual Token");
    expect(markup).not.toContain("EDITION PREVIEW");
    expect(printStructure(markup)).toEqual(printStructure(render({ ...TOKEN, image: "" })));
  });

  test("a custom unquoted edition preview does not invent earned status or token statistics", () => {
    for (const edition of EDITION_CATALOG) {
      const custom = { ...TOKEN, name: "My Local Token", ticker: "MINE", image: "blob:local-preview", level: 1, mcapUsd: 0, mcapLabel: "Not quoted", mintAddress: null, ownerHandle: undefined, edition: edition.key };
      const markup = render(custom), label = cardLabel(custom);
      expect(classText(markup, "mdx-card__title")).toBe(custom.name);
      expect(classText(markup, "mdx-card__ticker")).toBe(`$${custom.ticker}`);
      expect(classText(markup, "mdx-card__numeral")).toBe("—");
      expect(markup).toContain("Not quoted"); expect(markup).toContain("Preview"); expect(markup).not.toContain(">Spark<");
      expect(label).toContain(custom.name); expect(label).toContain("template preview"); expect(label).toMatch(/not quoted/i); expect(label).not.toMatch(/Spark design|tier 1|owner @|market cap \$0/);
    }
  });
});

describe("earned card designs stay independent from cosmetic previews", () => {
  test("the default unthemed face keeps the standard earned design and remains unchanged after edition rendering", () => {
    const original = render(TOKEN);
    expect(original).toContain(`data-tier="${tierForLevel(TOKEN.level).key}"`);
    expect(original).not.toContain("data-edition=");
    expect(original).not.toContain("EDITION PREVIEW");
    expect(cardLabel(TOKEN)).toContain(`${tierForLevel(TOKEN.level).name} design, tier ${TOKEN.level} of ${MAX_LEVEL}`);
    expect(cardLabel(TOKEN)).not.toContain("edition preview");
    for (const edition of EDITION_CATALOG) render({ ...TOKEN, edition: edition.key });
    expect(render(TOKEN)).toBe(original);
    expect(TOKEN.level).toBe(4);
    expect(TOKEN.mcapUsd).toBe(31_000);
  });

  test("selecting an edition preserves the earned tier in scene metadata and the accessible card description", () => {
    for (const edition of EDITION_CATALOG) {
      const card = { ...TOKEN, edition: edition.key };
      expect(faceSlot(card).tier).toEqual(faceSlot(TOKEN).tier);
      expect(cardLabel(card)).toContain(`${edition.name} edition preview`);
      expect(cardLabel(card)).toContain(`${tierForLevel(TOKEN.level).name} design, tier ${TOKEN.level} of ${MAX_LEVEL}`);
      expect(cardLabel(card)).toContain("market cap $31K");
      expect(card.level).toBe(TOKEN.level);
    }
  });

  test("the same cosmetic face can preview different earned levels without granting a higher tier", () => {
    const first = { ...TOKEN, level: 1, edition: "astral" as EditionKey };
    const last = { ...TOKEN, level: MAX_LEVEL, edition: "astral" as EditionKey };
    expect(render(first)).not.toBe(render(last));
    expect(classText(render(first), "mdx-card__numeral")).toBe(tierForLevel(1).numeral);
    expect(classText(render(last), "mdx-card__numeral")).toBe(tierForLevel(MAX_LEVEL).numeral);
    expect(artStyle(render(first))).toBe(artStyle(render({ ...TOKEN, level: 1 })));
    expect(artStyle(render(last))).toBe(artStyle(render({ ...TOKEN, level: MAX_LEVEL })));
    expect(cardLabel(first)).toContain(`tier 1 of ${MAX_LEVEL}`);
    expect(cardLabel(last)).toContain(`tier ${MAX_LEVEL} of ${MAX_LEVEL}`);
    expect(faceSlot(first).tier.key).toBe(tierForLevel(1).key);
    expect(faceSlot(last).tier.key).toBe(tierForLevel(MAX_LEVEL).key);
  });

  test("every edition preserves the original print and art positions at all fourteen earned levels", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const source = { ...TOKEN, level }, original = render(source);
      for (const edition of EDITION_CATALOG) {
        const markup = render({ ...source, edition: edition.key });
        expect(printStructure(markup)).toEqual(printStructure(original));
        expect(artStyle(markup)).toBe(artStyle(original));
        expect(statValues(markup)).toEqual(statValues(original));
        for (const name of ["mdx-card__title", "mdx-card__ticker", "mdx-card__numeral", "mdx-card__lore"]) expect(classText(markup, name)).toBe(classText(original, name));
      }
    }
  });
});

describe("edition materials preserve standard cards and product state", () => {
  test("absent and unknown editions leave every standard material unchanged", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const standard = templateStyle(tierForLevel(level).key);
      for (const input of [undefined, null, "", "unknown", "WILDTYPE", {}, 1]) {
        const override = editionMaterialStyle(input);
        expect(override).toEqual({});
        expect({ ...standard, ...override }).toEqual(standard);
      }
    }
  });

  test("all six editions supply distinct backs and edges using only cosmetic CSS properties", () => {
    const backs = new Set<string>();
    const edges = new Set<string>();
    const standard = templateStyle(tierForLevel(TOKEN.level).key) as Record<string, unknown>;
    for (const edition of EDITION_CATALOG) {
      const style = editionMaterialStyle(edition.key) as Record<string, unknown>;
      for (const property of ["--bk-field", "--bk-motif", "--bk-foil", "--e1", "--core", "--edge-fill"]) {
        expect(typeof style[property]).toBe("string");
        expect(String(style[property]).length).toBeGreaterThan(0);
      }
      expect(style["--bk-field"]).not.toBe(standard["--bk-field"]);
      expect(style["--edge-fill"]).not.toBe(standard["--edge-fill"]);
      expect(Object.keys(style).every((property) => property.startsWith("--"))).toBe(true);
      expect(Object.keys(style).some((property) => /tier|level|mcap|inventory|supply|price|owner|entitlement/.test(property))).toBe(false);
      backs.add(JSON.stringify([style["--bk-field"], style["--bk-motif"], style["--bk-foil"]]));
      edges.add(JSON.stringify([style["--e1"], style["--core"], style["--edge-fill"]]));
    }
    expect(backs.size).toBe(EDITION_CATALOG.length);
    expect(edges.size).toBe(EDITION_CATALOG.length);
  });

  test("material application does not mutate standard templates or the source token", () => {
    const templateSnapshot = JSON.stringify(TEMPLATES);
    const standard = Object.freeze(templateStyle(tierForLevel(TOKEN.level).key));
    const standardSnapshot = { ...standard };
    for (const edition of EDITION_CATALOG) {
      const card = Object.freeze({ ...TOKEN, edition: edition.key });
      const cardSnapshot = { ...card };
      const material = { ...standard, ...editionMaterialStyle(card.edition) };
      expect(material).not.toEqual(standard);
      render(card);
      cardLabel(card);
      expect(card).toEqual(cardSnapshot);
      expect(standard).toEqual(standardSnapshot);
      expect(templateStyle(tierForLevel(TOKEN.level).key)).toEqual(standardSnapshot);
    }
    expect(JSON.stringify(TEMPLATES)).toBe(templateSnapshot);
  });
});
