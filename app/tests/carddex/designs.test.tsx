import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../../src/lib/carddex/designs";
import { cardBackTheme, cardDesign, cardLight, designedCard, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { BackFace } from "../../src/components/mintdex/card3d/backface";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CARD_GENERATED_ASSETS, generatedCardAssets } from "../../src/lib/carddex/generated-assets";
import { generatedCardStyle } from "../../src/components/carddex/GeneratedCardArt";

const TOKEN: CardData = { name: "Creator's token", ticker: "OWN", image: "/assets/creatures/glorb.webp", dexNo: 25, level: 1, mcapUsd: 10, holders: 17, lore: "The creator's own story.", ownerHandle: "creator" };

describe("permanent creator-selected card designs", () => {
  test("every catalog choice has a distinct identity and a premium finish", () => {
    expect(CARD_DESIGNS).toHaveLength(48);
    expect(new Set(CARD_DESIGNS.map((design) => design.key)).size).toBe(48);
    expect(CARD_DESIGNS.filter((design) => design.category === "limited")).toHaveLength(20);
    for (const design of CARD_DESIGNS) {
      expect(isCardDesignKey(design.key)).toBe(true);
      expect(design.finish === "print" || design.finish === "satin").toBe(false);
    }
    expect(isCardDesignKey("__proto__")).toBe(false);
    expect(getCardDesign("invalid").key).toBe(DEFAULT_CARD_DESIGN);
  });

  test("trading and market-cap changes cannot replace any chosen front, reverse or material", () => {
    for (const design of CARD_DESIGNS) {
      const before = { ...TOKEN, cardTemplate: design.key };
      const after = { ...before, level: 14, mcapUsd: 1_000_000_000, holders: 500_000 };
      expect(cardDesign(after).key).toBe(design.key);
      expect(cardLight(after)).toEqual(cardLight(before));
      expect(cardBackTheme(after)).toEqual(cardBackTheme(before));
      expect(designedCard(after).level).toBe(design.materialLevel);
      expect(designedCard(after).mcapUsd).toBe(after.mcapUsd);
      expect(designedCard(after).holders).toBe(after.holders);
    }
  });

  test("all 48 front renderers retain creator identity and all reverses stay wordless", () => {
    for (const design of CARD_DESIGNS) {
      const card = { ...TOKEN, cardTemplate: design.key };
      const front = renderToStaticMarkup(<MintCardFace card={card} />);
      const reverse = renderToStaticMarkup(<BackFace sizes="225px" theme={cardBackTheme(card)} />);
      expect(front).toContain(`data-card-template="${design.key}"`);
      expect(front).toContain("OWN");
      expect(front).toContain("creator");
      expect(front).not.toContain(">MintDex<");
      expect(reverse).not.toContain("<text");
      expect(reverse).not.toContain(">MintDex<");
      expect(reverse).toContain(`data-theme-back="${design.key}"`);
    }
  });

  test("created demo cards show their real local holder count without inventing a mint", () => {
    const print = renderToStaticMarkup(<MintCardFace card={{ ...TOKEN, cardTemplate: "pokemon-classic", holders: 17 }} />);
    expect(print).toContain("Demo token");
    expect(print).toContain(">17<");
    expect(print).not.toContain("Not launched");
    expect(print).not.toContain(">Preview<");
  });

  test("optional generated prints reference only existing local assets and unknown keys keep native designs", () => {
    expect(generatedCardAssets("__proto__")).toEqual({});
    expect(generatedCardAssets("missing")).toEqual({});
    for (const [key, assets] of Object.entries(CARD_GENERATED_ASSETS)) {
      expect(isCardDesignKey(key)).toBe(true);
      expect(assets.front).toBeTruthy();
      expect(assets.back).toBeTruthy();
      expect(assets.front320).toBeTruthy();
      expect(assets.back320).toBeTruthy();
      const geometry = generatedCardStyle(key) as Record<string,string>;
      expect(geometry["--generated-art-mask"]).toStartWith('url("data:image/svg+xml,');
      expect(geometry["--generated-foil-holes"]).toStartWith('url("data:image/svg+xml,');
      for (const slot of ["art", "name", "type", "text", "footer", "foot-a", "foot-b"]) {
        for (const dimension of ["x", "y", "w", "h"]) expect(geometry[`--generated-${slot}-${dimension}`]).toEndWith("%");
      }
      for (const source of [assets.front, assets.back, assets.front320, assets.back320].filter(Boolean) as string[]) {
        expect(source.startsWith("/assets/carddex/higgsfield/")).toBe(true);
        expect(existsSync(resolve(import.meta.dir, "../../public", source.slice(1)))).toBe(true);
      }
    }
  });
});
