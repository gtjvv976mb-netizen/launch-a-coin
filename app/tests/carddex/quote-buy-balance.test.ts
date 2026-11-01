import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { quoteBuyShortfall } from "../../src/lib/carddex/live/quote-buy";

// A token pair's initial buy is paid in that token (owner report 1 November 2026: "Your wallet needs Fartcoin before its
// initial buy"). The wallet's balance is read before anything is uploaded and shown beside the buy with the way forward.
const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");

describe("a token pair's initial buy", () => {
  test("the message says why and what to do: get the token, lower the buy, or launch with none", () => {
    expect(quoteBuyShortfall("Fartcoin", "0", "100")).toBe("Your initial buy is paid in Fartcoin, and this wallet has none. Get Fartcoin first, or set the initial buy to 0 and buy after launch.");
    expect(quoteBuyShortfall("Fartcoin", "12.5", "100")).toBe("Your initial buy is 100 Fartcoin, but this wallet has 12.5 Fartcoin. Lower the buy, get more Fartcoin, or set it to 0 and buy after launch.");
  });
  test("the form shows the balance and the way forward; the panel checks before any upload", () => {
    const form = read("src/routes/launch.tsx");
    expect(form).toContain("useLiveQuoteBalance(");
    expect(form).toContain("getQuoteUrl(quoteAsset.mint)");
    expect(form).toContain("Set the buy to 0");
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    const check = panel.indexOf("readLiveQuoteBalance(address"), upload = panel.indexOf("requestCardMintSigner(");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(upload);
  });
});
