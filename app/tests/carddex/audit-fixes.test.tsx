import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_DESIGNS, getCardDesign } from "../../src/lib/carddex/designs";
import { designChipText, featuredStepText } from "../../src/lib/carddex/featured-copy";
import { tierForLevel } from "../../src/lib/mintdex/tiers";
import { DESK_GUESS, PHONE_GUESS, guessViewport } from "../../src/lib/mintdex/viewport";
import { MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";

describe("30 October audit fixes", () => {
  test("Home's stepper announces the design its chip shows, never the old tier name (INTEGRITY-1)", () => {
    let differs = 0;
    for (const design of CARD_DESIGNS) {
      const coin = { name: "Glorb", cardTemplate: design.key, level: 9, mcapUsd: 34_400 };
      const said = featuredStepText(coin, 2, 4);
      expect(said).toBe(`Glorb, ${designChipText(coin)}, market cap $34.4K, 2 of 4`);
      expect(said).toContain(`${getCardDesign(design.key).name} design`);
      if (tierForLevel(coin.level).name !== design.name) {
        differs++;
        expect(said).not.toContain(`${tierForLevel(coin.level).name} design`);
      }
    }
    expect(differs).toBeGreaterThan(0);
  });

  test("a first desktop Chromium visit is laid out as a desktop, phones as phones (PERF-1)", () => {
    expect(guessViewport("?0", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36")).toEqual(DESK_GUESS);
    expect(DESK_GUESS.w).toBeGreaterThanOrEqual(1024);
    expect(guessViewport("?1", "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/141.0 Mobile Safari/537.36")).toEqual(PHONE_GUESS);
    expect(guessViewport(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1")).toEqual(PHONE_GUESS);
    expect(guessViewport(undefined, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15")).toBeNull();
  });

  test("the Designs sample card prints no invented holder count (INTEGRITY-8)", () => {
    const sample: CardData = { cardTemplate: CARD_DESIGNS[0].key, name: "Glorb", ticker: "GLORB", image: "/assets/creatures/glorb.webp", level: 1, mcapUsd: 4_200, holders: 842, dexNo: 0, dexLabel: "Sample", lore: "", ownerHandle: "you" };
    const html = renderToStaticMarkup(<MintCardFace card={sample} />);
    expect(html).toContain("Sample token");
    expect(html).not.toContain(">842<");
    expect(html).toMatch(/Holders<\/span><i><\/i><b>—<\/b>/);
  });
});
