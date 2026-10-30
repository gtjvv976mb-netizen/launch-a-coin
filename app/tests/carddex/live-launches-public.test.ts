import { describe, expect, mock, test } from "bun:test";

// The Worker runtime module is not available under bun test; the mapping under test never touches a binding.
mock.module("cloudflare:workers", () => ({ env: {} }));
const { publicLaunchFromRow } = await import("../../src/lib/carddex/live/launches.server");

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const SHA = "a".repeat(64);
const row = (payload: unknown, over: Partial<Parameters<typeof publicLaunchFromRow>[0]> = {}) => ({
  token_mint: MINT,
  creator_wallet: WALLET,
  design_key: "ronin",
  payload_json: JSON.stringify(payload),
  created_at: 1_760_000_000_000,
  ...over,
});
const payload = {
  input: { creator: WALLET, initialBuyQuoteBaseUnits: "5000000" },
  fields: { name: "Honk", symbol: "HONK", description: "A goose" },
  assets: {
    artwork: { sha256: SHA, url: `https://launchacard.fun/api/live/assets/${SHA}.png` },
    cardImage: { sha256: SHA, url: `https://launchacard.fun/api/live/assets/${SHA}.webp` },
  },
};

describe("public live launch rows", () => {
  test("carry the named fields only, with the creator shortened and the description the card prints", () => {
    const out = publicLaunchFromRow(row(payload));
    expect(out).toMatchObject({
      name: "Honk",
      ticker: "HONK",
      tokenMint: MINT,
      designKey: "ronin",
      creator: "7xKX…gAsU",
    });
    expect(out?.image).toBe(`/api/live/assets/${SHA}.png`);
    expect(out?.cardImage).toBe(`/api/live/assets/${SHA}.webp`);
    const text = JSON.stringify(out);
    expect(text).not.toContain(WALLET);
    expect(text).not.toContain("initialBuy");
    // The description is printed on the public card and in the public token metadata.
    expect(out?.lore).toBe("A goose");
  });
  test("drop asset URLs that are not this Worker's own content paths", () => {
    const out = publicLaunchFromRow(
      row({
        ...payload,
        assets: {
          artwork: { url: "https://evil.example/x.png" },
          cardImage: { url: "javascript:alert(1)" },
        },
      }),
    );
    expect(out?.image).toBeNull();
    expect(out?.cardImage).toBeNull();
  });
  test("skip rows without a name, a ticker or a valid mint, and unreadable payloads", () => {
    expect(publicLaunchFromRow(row({ ...payload, fields: { symbol: "HONK" } }))).toBeNull();
    expect(publicLaunchFromRow(row(payload, { token_mint: "not-a-mint" }))).toBeNull();
    expect(publicLaunchFromRow({ ...row(payload), payload_json: "{" })).toBeNull();
  });
});
