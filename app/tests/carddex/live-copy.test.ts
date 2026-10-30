import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The live mainnet flow states the actual platform fee: none. The audit found no Launch a Card transfer in the coin
// or card transaction (no System instruction; the program allowlists exclude it).
const APP = resolve(import.meta.dir, "../..");
const LIVE = resolve(APP, "src/components/carddex/live");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");

describe("live launch fee disclosure", () => {
  test("no fill-in placeholder remains in the live launch flow", () => {
    for (const file of [...readdirSync(LIVE).map(name => `src/components/carddex/live/${name}`), "src/routes/launch.tsx"]) expect(read(file)).not.toContain("[TO FILL");
  });
  test("the transaction terms say there is no platform fee and name what the creator pays", () => {
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    expect(panel).toContain("Launch a Card charges no platform fee.");
    // The same costs the legal card-issuance row names, including the buyback account rent on token quotes.
    expect(panel).toContain("Solana network and priority fees, account rent for the new accounts, the Metaplex NFT fee for the card, and pump.fun's protocol and creator fees inside any initial buy");
    expect(read("src/routes/legal.tsx")).toContain("the Metaplex NFT fee");
  });
  test("the legal fee table says what /how and Launch say, and the terms carry no fill-in slot or demo item", () => {
    const legal = read("src/routes/legal.tsx");
    // No transfer in the pump.fun launch goes to a Launch a Card wallet, so both platform rows say None, unhedged.
    expect(legal).toContain("None. Launch a Card adds no fee to launch or card transactions.");
    expect(legal).not.toContain("currently adds");
    // The owner asked (31 October 2026) for every slot needing their details removed and the rest filled: the policy
    // items are written out, and nothing marked or demo remains.
    for (const filled of ["at least 18", "Syria", "“as is”", "12 months before the claim", "means you accept"]) expect(legal).toContain(filled);
    for (const gone of ["[TO FILL", "<Fill>", "operator legal name", "Governing law", "privacy contact", "Test data", "Demo values", "test SOL", "demo"]) expect(legal).not.toContain(gone);
  });
  test("the initial-buy notes are plain and name when the size is checked", async () => {
    const copy = await import("../../src/lib/carddex/live/copy");
    expect(copy.BUY_FIT_AFTER_SIGN_IN).toContain("after wallet sign-in, before anything is uploaded");
    for (const text of Object.values(copy)) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("the Launch ticket says what the wallet will ask", () => {
  const panel = () => read("src/components/carddex/live/LiveLaunchPanel.tsx");
  test("one approval for the coin and its card when the connected wallet signs both, else the card after the coin (ML-2)", async () => {
    const notice = await import("../../src/components/carddex/live/wallet-notice");
    expect(notice.ONE_APPROVAL_NEXT).toBe("Your wallet opens for a sign-in message that spends nothing, then your coin and its card in one approval.");
    expect(notice.SEPARATE_APPROVALS_NEXT).toBe("Your wallet opens for a sign-in message that spends nothing, then your coin, then its card.");
    // The preview mirrors the review's list (walletNoticeItems): its approvals line first, the card's signer and lock
    // only in one approval, and no tokenized-stock note (that quote never carries a first buy).
    expect(notice.walletNoticePreview({ hasBuy: false }).map(item => item.key)).toEqual(["approvalsCoin", "networkFeeLater", "coinSigner", "newSite"]);
    expect(notice.walletNoticePreview({ hasBuy: true, siteHost: "launchacard.fun" }).map(item => item.key)).toEqual(["approvalsCoin", "networkFeeLater", "tokenAccount", "unverified", "coinSigner", "newSite"]);
    expect(notice.walletNoticePreview({ hasBuy: false, oneApproval: true }).map(item => item.key)).toEqual(["approvalsPair", "networkFeeLater", "coinSigner", "cardSigner", "cardLock", "newSite"]);
    expect(notice.walletNoticePreview({ hasBuy: true }).some(item => item.key === "stockQuote")).toBe(false);
    // The terms line promises no separate approval for the card.
    expect(panel()).toContain("Coin creation and card issuance are two paid mainnet transactions. Exact costs appear before your wallet asks for approval.");
    expect(panel()).not.toContain("before each wallet approval");
  });
  test("a saved launch this browser cannot sign names the one control that goes on (MW-5)", async () => {
    const flow = await import("../../src/components/carddex/live/launch-flow");
    expect(flow.PREPARED_WITHOUT_KEY).toBe("This browser no longer holds this launch's new coin key, so it can't be signed here. Discard the unused draft about a minute after it was prepared, then launch again.");
    expect(panel()).toContain('label: "Discard unused draft"');
    expect(panel()).toContain('"No unfinished launches for this wallet."');
  });
  test("the preview card's market-cap row reads as the minted card prints it (ML-4)", async () => {
    const { CREATION_MCAP_LABEL } = await import("../../src/lib/carddex/card-template");
    expect(CREATION_MCAP_LABEL).toBe("At creation");
    expect(read("src/lib/carddex/live/creator-print.tsx")).toContain('["Market cap","At creation"]');
    expect(read("src/lib/carddex/live/composition.server.ts")).toContain('mcapLabel: "At creation"');
    // Launch's live card is the only creation preview left (the design library dialog went with the pair HUD).
    for (const file of ["src/routes/launch.tsx"]) {
      expect(read(file)).toContain("CREATION_MCAP_LABEL");
      expect(read(file)).not.toContain('"At launch"');
    }
  });
});
