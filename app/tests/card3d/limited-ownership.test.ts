import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LimitedEditionOwnership } from "../../src/components/mintdex/LimitedEditionOwnership";

const selection = {
  templateName: "Gilded Legend",
  tokenName: "Honk",
  tokenTicker: "HONK",
  tokenMint: "4WdMXAGBiFaVxU57tV6ohGjZPP5heXzntzScBTnXmint",
  isCustomPreview: false,
};
const render = (props = selection) => renderToStaticMarkup(createElement(LimitedEditionOwnership, props));

describe("limited-edition ownership terms", () => {
  test("separates permanent styling from the transferable token-bound collectible", () => {
    const markup = render();
    expect(markup).toContain("What a purchase will include");
    expect(markup).toContain("Permanent token design");
    expect(markup).toContain("even if you sell the collectible");
    expect(markup).toContain("A separate collectible NFT");
    expect(markup).toContain("sell it to any collector");
    expect(markup).toContain("cannot replace it with another coin");
    expect(markup).toContain("no creator fees, token control or reusable template license");
    expect(markup).toContain("Selling or burning an NFT will not reopen its mint slot");
  });

  test("shows the exact selected public identity without treating a preview as creator verification", () => {
    const markup = render();
    for (const value of [selection.templateName, selection.tokenName, selection.tokenTicker, selection.tokenMint]) expect(markup).toContain(value);
    expect(markup).toContain("Selecting a token does not verify that you are its creator");
    expect(markup).toContain("Nothing is reserved, applied or minted by this preview");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<form");
    expect(markup).not.toMatch(/creator verified|wallet connected|purchase complete/i);
  });

  test("keeps custom artwork drafts distinct from a token or owned NFT", () => {
    const markup = render({ ...selection, tokenName: "<My token>", tokenMint: null, isCustomPreview: true });
    expect(markup).toContain("&lt;My token&gt;");
    expect(markup).toContain("Custom artwork preview. No token has been verified.");
    expect(markup).not.toContain(selection.tokenMint);
    expect(markup).not.toContain("<dt>Mint</dt>");
  });
});
