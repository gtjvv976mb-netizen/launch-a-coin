import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_DESIGNS, DEFAULT_CARD_DESIGN, getCardDesign, isCardDesignKey } from "../../src/lib/carddex/designs";
import { cardBackTheme, cardDesign, cardLight, designedCard, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { BackFace } from "../../src/components/mintdex/card3d/backface";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CARD_GENERATED_ASSETS, generatedCardAssets } from "../../src/lib/carddex/generated-assets";
import { generatedCardStyle } from "../../src/components/carddex/GeneratedCardArt";
import { CANONICAL_CARD_LAYOUT, CANONICAL_CARD_TEMPLATE } from "../../src/lib/carddex/card-template";

const TOKEN: CardData = { name: "Creator's token", ticker: "OWN", image: "/assets/creatures/glorb.webp", dexNo: 25, level: 1, mcapUsd: 10, holders: 17, lore: "The creator's own story.", ownerHandle: "creator" };

describe("permanent creator-selected card designs", () => {
  test("one immutable physical template aligns all content and reclaims the removed footer", () => {
    expect(CANONICAL_CARD_LAYOUT.aspect).toBe(63 / 88);
    expect(CANONICAL_CARD_LAYOUT.radius).toBe(.0504);
    expect(CANONICAL_CARD_LAYOUT.footer).toEqual([]);
    const boxes = [CANONICAL_CARD_LAYOUT.name,CANONICAL_CARD_LAYOUT.window,CANONICAL_CARD_LAYOUT.type,CANONICAL_CARD_LAYOUT.text];
    for (const [i,box] of boxes.entries()) {
      expect(box.x).toBe(.1); expect(box.w).toBe(.8);
      expect(box.y+box.h).toBeLessThan(.95);
      if(i) expect(box.y).toBeGreaterThan(boxes[i-1].y+boxes[i-1].h);
    }
    expect(CANONICAL_CARD_LAYOUT.text.y+CANONICAL_CARD_LAYOUT.text.h).toBeGreaterThan(.92);
    expect(Object.isFrozen(CANONICAL_CARD_LAYOUT)).toBe(true);
    expect(Object.isFrozen(CANONICAL_CARD_LAYOUT.window)).toBe(true);
    expect(Object.isFrozen(CANONICAL_CARD_LAYOUT.footer)).toBe(true);
  });

  test("all48 actual full, compact and lite fronts put the same live roles in the same boxes before decode", () => {
    const roles = ["name", "art", "ticker", "details"];
    const boxes = (html:string) => roles.map(role => {
      const tag = html.match(new RegExp(`<[^>]+data-card-slot="${role}"[^>]*>`))?.[0];
      expect(tag).toBeTruthy();
      const style = tag!.match(/style="([^"]*)"/)?.[1] ?? "";
      return Object.fromEntries(style.split(";").map(field=>field.split(":")).filter(([key])=>["left","top","width","height"].includes(key)));
    });
    const defaultFront = renderToStaticMarkup(<MintCardFace card={{...TOKEN,cardTemplate:DEFAULT_CARD_DESIGN}} />);
    const baseline = boxes(defaultFront);
    const geometry = (key:string) => Object.fromEntries(Object.entries(generatedCardStyle(key)).filter(([key])=>key!=="--generated-ink"));
    for (const design of CARD_DESIGNS) {
      expect(geometry(design.key)).toEqual(geometry(DEFAULT_CARD_DESIGN));
      for (const mode of [{}, {compact:true}, {lite:true}]) {
        const html = renderToStaticMarkup(<MintCardFace {...mode} card={{...TOKEN,cardTemplate:design.key}} />);
        expect(html).toContain(`data-card-layout="${CANONICAL_CARD_TEMPLATE}"`);
        expect(boxes(html)).toEqual(baseline);
        for (const retired of ['data-card-slot="creator"','data-card-slot="serial"','mdx-card__foot','data-card-decoration="seal"','data-card-decoration="market-engraving"',">Launch a Card<",">Owner ","@creator"]) expect(html).not.toContain(retired);
        expect(html).toContain(">1/1<");
        expect(html).not.toContain("data-classic-layout=");
        expect(html).not.toContain("cdx-trading-card__effect");
        expect(html).not.toContain("mdx-meme-icon__frame");
        expect(html).not.toContain("data-card-skin-ready");
        expect(html.indexOf('data-card-slot="address"')).toBeLessThan(html.indexOf('data-card-slot="market-cap"'));
        expect(html.indexOf('data-card-slot="market-cap"')).toBeLessThan(html.indexOf('data-card-slot="holders"'));
      }
    }
  });

  test("missing art and long creator identity retain the common fallback print", () => {
    for (const key of [DEFAULT_CARD_DESIGN, "one-piece", "neon-circuit", "stock-tsla"]) {
      const html = renderToStaticMarkup(<MintCardFace card={{...TOKEN,cardTemplate:key,image:"",name:"A creator token with a long identity",ticker:"CREATOR123"}} />);
      expect(html).toContain(`data-card-layout="${CANONICAL_CARD_TEMPLATE}"`);
      expect(html).toContain("Your coin art");
      expect(html).toContain("A creator token with a long identity");
      expect(html).toContain("CREATOR123");
      expect(html).not.toContain("data-card-skin-ready");
    }
  });
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

  test("all 48 fronts retain token identity without owner/number plates and reverses stay wordless", () => {
    for (const design of CARD_DESIGNS) {
      const card = { ...TOKEN, cardTemplate: design.key };
      const front = renderToStaticMarkup(<MintCardFace card={card} />);
      const reverse = renderToStaticMarkup(<BackFace sizes="225px" theme={cardBackTheme(card)} />);
      expect(front).toContain(`data-card-template="${design.key}"`);
      expect(front).toContain("OWN");
      expect(front).toContain("The creator&#x27;s own story.");
      expect(front).not.toContain('data-card-slot="creator"');
      expect(front).not.toContain('data-card-slot="serial"');
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
      for (const slot of ["art", "name", "type", "text"]) {
        for (const dimension of ["x", "y", "w", "h"]) expect(geometry[`--generated-${slot}-${dimension}`]).toEndWith("%");
      }
      for (const slot of ["footer", "foot-a", "foot-b"]) expect(geometry[`--generated-${slot}-x`]).toBeUndefined();
      for (const source of [assets.front, assets.back, assets.front320, assets.back320].filter(Boolean) as string[]) {
        expect(source.startsWith("/assets/carddex/higgsfield/")).toBe(true);
        expect(existsSync(resolve(import.meta.dir, "../../public", source.slice(1)))).toBe(true);
      }
    }
  });
});
