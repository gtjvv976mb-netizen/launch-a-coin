import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_DESIGNS, getCardDesign } from "../../src/lib/carddex/designs";
import { designChipText, featuredStepText } from "../../src/lib/carddex/featured-copy";
import { tierForLevel } from "../../src/lib/mintdex/tiers";
import { DESK_GUESS, PHONE_GUESS, guessViewport } from "../../src/lib/mintdex/viewport";
import { MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";
import { TradingCardFace } from "../../src/components/mintdex/TradingCardFace";
import { Change, changeWords } from "../../src/components/mintdex/ui";

describe("30 October audit fixes", () => {
  test("Home's stepper announces the design its chip shows, never the old tier name (INTEGRITY-1)", () => {
    let differs = 0;
    for (const design of CARD_DESIGNS) {
      const coin = { name: "Glorb", cardTemplate: design.key, level: 9, mcapUsd: 34_400 };
      const said = featuredStepText(coin, 2, 4);
      // The site reads no market data, so no figure is said (31 October mainnet-only release).
      expect(said).toBe(`Glorb, ${designChipText(coin)}, 2 of 4`);
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

  test("Android's 'not mobile' (tablets, desktop-site mode) gets no desktop guess; Windows and Mac do (REV-1)", () => {
    const tablet = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
    expect(guessViewport("?0", tablet, '"Android"')).toBeNull();
    expect(guessViewport("?0", tablet)).toBeNull();
    expect(guessViewport("?0", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", '"Android"')).toBeNull();
    expect(guessViewport("?0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", '"Windows"')).toEqual(DESK_GUESS);
    expect(guessViewport("?0", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0 Safari/537.36", '"macOS"')).toEqual(DESK_GUESS);
  });

  test("Discover's link name says the change exactly as Change prints it (REV-4)", () => {
    for (const v of [0.0412, -0.0234, 1.5, -1.234, 0.0004, -0.0004, 0, Number.NaN]) {
      const said = changeWords(v);
      const shown = renderToStaticMarkup(<Change v={v} />).replace(/<[^>]+>/g, "");
      if (said === "no change in 24 hours") expect(shown).toBe("No change in 24 hours: 0.0%");
      else expect(shown).toBe(said);
    }
  });

  test("the unused trading-card face prints no holder count for a sample either (REV-5)", () => {
    const sample: CardData = { cardTemplate: CARD_DESIGNS[0].key, name: "Glorb", ticker: "GLORB", image: "/assets/creatures/glorb.webp", level: 1, mcapUsd: 4_200, holders: 842, dexNo: 3, dexLabel: "Sample", lore: "", ownerHandle: "you" };
    const html = renderToStaticMarkup(<TradingCardFace card={sample} design={getCardDesign(sample.cardTemplate)} />);
    expect(html).not.toContain(">842<");
    expect(html).toContain("Holders <b>—</b>");
  });

  test("the Designs sample card prints no invented holder count (INTEGRITY-8)", () => {
    const sample: CardData = { cardTemplate: CARD_DESIGNS[0].key, name: "Glorb", ticker: "GLORB", image: "/assets/creatures/glorb.webp", level: 1, mcapUsd: 4_200, holders: 842, dexNo: 0, dexLabel: "Sample", lore: "", ownerHandle: "you" };
    const html = renderToStaticMarkup(<MintCardFace card={sample} />);
    expect(html).toContain("Sample token");
    expect(html).not.toContain(">842<");
    expect(html).toMatch(/Holders<\/span><i><\/i><b>—<\/b>/);
  });
});
