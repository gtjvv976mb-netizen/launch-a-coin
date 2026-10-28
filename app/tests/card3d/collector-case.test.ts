import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CardData } from "../../src/components/mintdex/MintCard";
import { CaseScene } from "../../src/components/mintdex/card3d/CardCase";
import { CasePlate, caseBox } from "../../src/components/mintdex/card3d/case-chrome";
import { MAX_LEVEL, tierForLevel } from "../../src/lib/mintdex/tiers";

const TOKEN: Readonly<CardData> = Object.freeze({
  name: "Independent Creator Token",
  ticker: "OWN",
  image: "/actual-creator-art.webp",
  level: 8,
  mcapUsd: 845_000,
  holders: 372,
  dexNo: 19,
  lore: "The creator's original story.",
  ownerHandle: "actual_creator",
  mintAddress: "4WdMXAGBiFaVxU57tV6ohGjZPP5heXzntzScBTnXmint",
});

const plate = (card: CardData, side: "front" | "back") =>
  renderToStaticMarkup(createElement(CasePlate, { card, side }));
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("protective collector enclosure", () => {
  test("both outlines enclose the complete original card with clearance on every edge", () => {
    const cardHeight = (100 * 88) / 63;
    for (const labeled of [false, true]) {
      const box = caseBox(labeled);
      expect(box.x).toBeLessThan(0);
      expect(box.y).toBeLessThan(0);
      expect(box.x + box.w).toBeGreaterThan(100);
      expect(box.y + box.h).toBeGreaterThan(cardHeight);
      expect(-box.x).toBeCloseTo(box.x + box.w - 100);
      expect(box.r).toBeGreaterThan(0);
      expect(box.r * 2).toBeLessThan(Math.min(box.w, box.h));
    }
    // The label adds headroom without squeezing or translating the original card.
    const full = caseBox(), holder = caseBox(false);
    expect(full.x).toBe(holder.x);
    expect(full.w).toBe(holder.w);
    expect(full.y).toBeLessThan(holder.y);
    expect(full.y + full.h).toBeCloseTo(holder.y + holder.h);
  });

  test("front and reverse labels identify the actual token without inventing a grade", () => {
    const expected = "MintDex 4WdMX...mint 1/1 One of one";
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const card = { ...TOKEN, level };
      for (const side of ["front", "back"] as const) {
        const markup = plate(card, side);
        expect(text(markup)).toBe(expected);
        expect(markup).toContain(`data-case-side="${side}"`);
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).not.toContain(TOKEN.image);
        expect(text(markup)).not.toContain(tierForLevel(level).name);
        expect(text(markup)).not.toMatch(/graded|certified|PSA|BGS|GEM MINT/i);
      }
    }
  });

  test("case identity follows the mint and keeps local-preview identifiers honest", () => {
    expect(text(plate({ ...TOKEN, mintAddress: "ASRZJEGsNavfKhXbb3E8wXcy7RUYJQAus9tWC9Xpmint" }, "front"))).toContain("ASRZJ...mint");
    expect(text(plate({ ...TOKEN, mintAddress: null }, "front"))).toContain("No. 019");
    expect(text(plate({ ...TOKEN, mintAddress: null, dexLabel: "Preview" }, "back"))).toBe("MintDex Preview 1/1 One of one");
    const hostile = plate({ ...TOKEN, mintAddress: null, dexLabel: '<script>alert("x")</script>' }, "front");
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain("&lt;script&gt;");
  });

  test("case rendering retains the actual card identity, artwork and earned tier at every level", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const card = { ...TOKEN, level };
      const markup = renderToStaticMarkup(createElement(CaseScene, {
        card, kind: "case", variant: "labeled", controls: "none", gyroChip: false, unbox: false,
      }));
      const tier = tierForLevel(level);
      expect(markup).toContain(`data-metal="${tier.key}"`);
      expect(markup).toContain(`data-tier="${tier.key}"`);
      expect(markup).toContain(`src="${TOKEN.image}"`);
      expect(markup).toContain(`>${TOKEN.name}</span>`);
      expect(markup).toContain(`>$${TOKEN.ticker}</span>`);
      expect(markup).toContain(`>${tier.numeral}</span>`);
      expect(markup).toContain(`>${TOKEN.holders}</b>`);
      expect(markup).toContain(`@${TOKEN.ownerHandle}`);
      expect(markup.match(/data-case-side="front"/g)).toHaveLength(1);
      expect(markup.match(/data-case-side="back"/g)).toHaveLength(1);
      expect(markup).toContain('aria-label="Independent Creator Token card in its case, ' + tier.name + ' design"');
      expect(card.level).toBe(level);
    }
    expect(TOKEN.level).toBe(8);
  });
});
