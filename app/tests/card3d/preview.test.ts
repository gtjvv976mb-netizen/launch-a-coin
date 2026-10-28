import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { cardLabel, MintCardFace, type CardData } from "../../src/components/mintdex/MintCard";

test("a launch preview without a market-cap quote labels both the visible card and its accessible description", () => {
  const card: CardData = {
    name: "New coin",
    ticker: "NEW",
    image: "",
    level: 1,
    mcapUsd: 0,
    mcapLabel: "Pending quote",
    holders: 0,
    dexNo: 0,
  };
  expect(cardLabel(card)).toContain("market cap Pending quote");
  const markup = renderToStaticMarkup(createElement(MintCardFace, { card }));
  expect(markup).toContain("<b>Pending quote</b>");
  expect(markup).not.toContain("<b>$0</b>");
  const numeric = { ...card, mcapLabel: undefined, mcapUsd: 15_000 };
  expect(cardLabel(numeric)).toContain("market cap $15K");
});
