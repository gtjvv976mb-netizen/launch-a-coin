import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  checkFeeSplit, EMPTY_FEE_SPLIT, FEE_SPLIT_DEFAULT, FEE_SPLIT_FREE, FEE_SPLIT_PERMANENT, FEE_SPLIT_STEP, FEE_SPLIT_WALLETS, feeSplitTotal, firstFeeSplitRows,
  formatShare, isAddress, MAX_FEE_RECIPIENTS, percentToBps, readFeeSplitDraft,
} from "../../src/components/carddex/live/fee-split";
import { decimalText, FeeSplitFields, firstFeeSplitField } from "../../src/components/carddex/live/FeeSplitFields";
import { base58, fromBase64, isWalletAddress, LIVE_PROGRAMS, toBase64, validateFeeSharePlan, validateLivePlan, type TransactionPlan } from "../../src/components/carddex/live/transaction";
import {
  ONE_APPROVAL_NEXT, ONE_APPROVAL_NEXT_FEES, SEPARATE_APPROVALS_NEXT, SEPARATE_APPROVALS_NEXT_FEES, WALLET_NOTICE_COPY, walletNoticeItems, walletNoticePreview,
} from "../../src/components/carddex/live/wallet-notice";
import { feeSplitFixture } from "../../../integrations/pumpfun/tests/fee-fixture";
import { creator, fixture, mint, nft, nftFixture } from "./live-plan-fixtures";

// The Launch form's "Share creator fees" group, its copy and the browser's checks of the split transaction. Synthetic
// keys only; nothing is signed or sent.
const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");
/** Text as React renders it into HTML. */
const html = (text: string) => text.replaceAll("'", "&#x27;");
const wallet = (n: number) => base58(ed25519.getPublicKey(new Uint8Array(32).fill(60 + n)));

describe("the form's fee split rows", () => {
  test("shares are percents with up to 2 decimals, stored as whole basis points", () => {
    expect(["100", "12.5", "33.33", "0.01", ".5", "5.", "50%"].map(percentToBps)).toEqual([10_000, 1250, 3333, 1, 50, 500, 5000]);
    for (const bad of ["", "0", "0.00", "100.01", "101", "1.234", "-5", "1e2", "abc", "."]) expect(percentToBps(bad)).toBeNull();
    expect([10_000, 1250, 3333, 1, 5000].map(formatShare)).toEqual(["100%", "12.5%", "33.33%", "0.01%", "50%"]);
    expect(feeSplitTotal([{ wallet: "", percent: "33.33" }, { wallet: "", percent: "33.33" }, { wallet: "", percent: "x" }])).toBe(6666);
  });
  test("every row needs a Solana address and a share; the total must be exactly 100%", () => {
    expect(isAddress(creator)).toBe(true);
    expect(isAddress("So11111111111111111111111111111111111111112")).toBe(true);
    expect(isAddress("not-an-address")).toBe(false);
    const ok = checkFeeSplit([{ wallet: creator, percent: "60" }, { wallet: wallet(1), percent: "40" }]);
    expect(ok).toEqual({ rows: [{ wallet: null, percent: null }, { wallet: null, percent: null }], total: null, shares: [{ address: creator, bps: 6000 }, { address: wallet(1), bps: 4000 }] });
    const bad = checkFeeSplit([{ wallet: creator, percent: "60" }, { wallet: creator, percent: "" }, { wallet: "abc", percent: "30" }]);
    expect(bad.rows).toEqual([{ wallet: null, percent: null }, { wallet: "This wallet is already in the split.", percent: "Enter a share." }, { wallet: "This is not a Solana wallet address.", percent: null }]);
    expect(bad.total).toBe("The shares add up to 90%. They must add up to exactly 100%.");
    expect(bad.shares).toBeNull();
    expect(checkFeeSplit([]).total).toBe("Add at least one wallet, or turn fee sharing off.");
    expect(checkFeeSplit(Array.from({ length: MAX_FEE_RECIPIENTS + 1 }, (_, i) => ({ wallet: wallet(i), percent: "12.5" }))).total).toBe(`A split can have at most ${MAX_FEE_RECIPIENTS} wallets.`);
    expect(MAX_FEE_RECIPIENTS).toBe(7);
    // Focus goes to the first field that needs something, then to the total's first share, then to the switch.
    expect(firstFeeSplitField(bad)).toBe("fee-wallet-1");
    expect(firstFeeSplitField(checkFeeSplit([{ wallet: creator, percent: "90" }]))).toBe("fee-share-0");
    expect(firstFeeSplitField(checkFeeSplit([]))).toBe("fee-split-on");
    expect(firstFeeSplitField(ok)).toBeNull();
  });
  test("the draft keeps the split across a reload, and anything unreadable is dropped", () => {
    const draft = { on: true, rows: [{ wallet: creator, percent: "70" }, { wallet: wallet(2), percent: "30" }] };
    expect(readFeeSplitDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(readFeeSplitDraft(undefined)).toEqual(EMPTY_FEE_SPLIT);
    expect(readFeeSplitDraft({ on: "yes", rows: [{ wallet: 5 }, null, { wallet: "x".repeat(80), percent: "1234567" }] })).toEqual({ on: false, rows: [{ wallet: "x".repeat(44), percent: "123456" }] });
    expect(readFeeSplitDraft({ on: true, rows: Array.from({ length: 12 }, () => ({ wallet: "", percent: "" })) }).rows).toHaveLength(MAX_FEE_RECIPIENTS);
    // Turned on, the first row is the connected wallet with 100% (or empty without one).
    expect(firstFeeSplitRows(creator)).toEqual([{ wallet: creator, percent: "100" }]);
    expect(firstFeeSplitRows(null)).toEqual([{ wallet: "", percent: "100" }]);
    const launch = read("src/routes/launch.tsx");
    expect(launch).toContain("setFeeSplit(readFeeSplitDraft(d.feeSplit))");
    expect(launch).toContain("{ feeSplit }");
    expect(launch).toContain('{ key: "fees", ok: feesOk }');
    expect(launch).toContain("feeShares: feesActive ? feeCheck.shares : null");
  });
  test("the group: off by default with pump.fun's default named; on, labelled rows, a remove per row, a live total and errors tied to their fields", () => {
    const off = renderToStaticMarkup(createElement(FeeSplitFields, { value: EMPTY_FEE_SPLIT, onChange: () => undefined, connected: creator, disabled: false, showErrors: false }));
    expect(off).toContain("Share creator fees");
    expect(off).toContain(html(FEE_SPLIT_DEFAULT));
    expect(off).not.toContain("fee-wallet-0");
    const on = renderToStaticMarkup(createElement(FeeSplitFields, { value: { on: true, rows: [{ wallet: creator, percent: "60" }, { wallet: "abc", percent: "" }] }, onChange: () => undefined, connected: creator, disabled: false, showErrors: true }));
    for (const text of ['for="fee-wallet-0"', 'for="fee-share-1"', 'aria-label="Remove wallet 2"', "Add recipient", ">60%<", FEE_SPLIT_PERMANENT, FEE_SPLIT_FREE, FEE_SPLIT_STEP])
      expect(on).toContain(html(text));
    // Each error is under its own field and named by it; the total's error is announced.
    expect(on).toMatch(/id="fee-wallet-1"[^>]*aria-invalid="true" aria-describedby="fee-wallet-1-help"/);
    expect(on).toContain('id="fee-wallet-1-help" role="alert"');
    expect(on).toContain('id="fee-share-1-help" role="alert"');
    // The total's error is tied to the shares but not an alert: it changes on every keystroke, and the Total line is polite.
    expect(on).toContain('id="fee-split-total" class="cdx-launch-note__error"');
    expect(on).not.toContain('id="fee-split-total" role="alert"');
    // Every row's fields are named by its number, and an empty wallet never shows an address as its placeholder.
    for (const text of [">Wallet 1<", ">Wallet 2<", ">Share 1<", ">Share 2<"]) expect(on).toContain(text);
    const empty = renderToStaticMarkup(createElement(FeeSplitFields, { value: { on: true, rows: [{ wallet: "", percent: "100" }] }, onChange: () => undefined, connected: creator, disabled: false, showErrors: false }));
    expect(empty).not.toContain(`placeholder="${creator}"`);
    expect(empty).toContain('placeholder="Solana wallet address"');
    // A comma-locale keypad's separator reads as a point.
    expect(decimalText("33,33")).toBe("33.33");
    expect(decimalText("1 2a.5%")).toBe("12.5");
    // A saved launch's split shows locked.
    expect(renderToStaticMarkup(createElement(FeeSplitFields, { value: { on: true, rows: [{ wallet: creator, percent: "100" }] }, onChange: () => undefined, connected: null, disabled: true, showErrors: false }))).toMatch(/<fieldset [^>]*disabled=""/);
    // Touch targets: the switch is a 44px row, each Remove and Add a hit area, inputs the form's own.
    const css = read("src/styles/screens/launch.css");
    expect(css).toContain(".cdx-launch-fees__remove { justify-self: start; min-height: var(--hit);");
  });
});

describe("the copy is plain and honest", () => {
  test("permanent and set once, wallets only, pump.fun pays and Launch a Card takes none", () => {
    expect(FEE_SPLIT_PERMANENT).toBe("Permanent: pump.fun lets it be set once, never changed.");
    expect(FEE_SPLIT_WALLETS).toBe("Recipients must be Solana wallets.");
    expect(FEE_SPLIT_FREE).toBe("pump.fun pays creator fees; Launch a Card takes none.");
    for (const text of [FEE_SPLIT_PERMANENT, FEE_SPLIT_WALLETS, FEE_SPLIT_FREE, FEE_SPLIT_STEP, FEE_SPLIT_DEFAULT, SEPARATE_APPROVALS_NEXT_FEES, ONE_APPROVAL_NEXT_FEES, ...Object.values(WALLET_NOTICE_COPY).filter(v => typeof v === "string")])
      expect(text).not.toMatch(/[–—]/);
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    // The split the server returns is checked against the creator's own before the coin review and before the split's
    // own review, every review lists each recipient in full, and skipping asks first.
    expect(panel).toContain("assertOwnSplit(response.intent);");
    expect(panel).toMatch(/function expectedFee\(current: LiveLaunchIntent\): ExpectedFeePlan \{\n\s+assertOwnSplit\(current\);/);
    expect(panel).toContain('<span className="cdx-live-address">{entry.address}{entry.address === creator');
    expect(panel).toContain('onClick={() => setSkipAsk(true)}>Skip, keep 100%</button>');
    // Unchanged: no platform fee, and the site is never in a split.
    expect(panel).toContain("Launch a Card charges no platform fee.");
    expect(panel).toContain("{FEE_SPLIT_PERMANENT}");
    // The form leaves "wallets only" to its field and error; the split's own review still says it.
    expect(panel).toContain("<p><strong>{FEE_SPLIT_PERMANENT}</strong> {FEE_SPLIT_WALLETS} {FEE_SPLIT_FREE}");
    expect(panel).toContain('title="Share creator fees"');
    expect(panel).toContain("Skip, keep 100%");
  });
  test("the ticket and the wallet notices count the split's own approval", () => {
    expect(SEPARATE_APPROVALS_NEXT_FEES).toBe("Your wallet asks 4 times: a free sign-in, then 3 paid approvals: your coin, its card, then your fee split.");
    expect(ONE_APPROVAL_NEXT_FEES).toBe("Your wallet asks 3 times: a free sign-in, then 2 paid approvals: your coin and card together, then your fee split.");
    // Without a split.
    expect(SEPARATE_APPROVALS_NEXT).toBe("Your wallet asks 3 times: a free sign-in, your coin (paid), then its card (paid).");
    expect(ONE_APPROVAL_NEXT).toBe("Your wallet asks twice: a free sign-in, then your coin and card together (paid).");
    expect(walletNoticePreview({ hasBuy: false, feesNext: true }).map(item => item.key)).toEqual(["approvalsCoinThenFees", "networkFeeLater", "coinSigner", "newSite"]);
    expect(walletNoticePreview({ hasBuy: false, oneApproval: true, feesNext: true })[0].key).toBe("approvalsPairThenFees");
    const quote = { symbol: "SOL", decimals: 9, kind: "native" };
    expect(walletNoticeItems(nftFixture().plan, quote, undefined, null, true)[0].key).toBe("approvalsCardThenFees");
    expect(walletNoticeItems(nftFixture().plan, quote)[0].key).toBe("approvalsCard");
  });
  test("the split's own wallet notice: its approval, the fee, pump.fun's rent and program, never a second signer", async () => {
    const fees = await feeSplitFixture({ creator, mint, quoteKey: "sol", recipients: [{ address: nft, bps: 10_000 }] });
    const items = walletNoticeItems(fees, { symbol: "SOL", decimals: 9, kind: "native" }, "launchacard.fun");
    expect(items.map(item => item.key)).toEqual(["approvalsFees", "networkFee", "feeRent", "feeProgram", "newSite"]);
    expect(items[0].text).toContain("can't be changed afterward");
    expect(items.find(item => item.key === "feeProgram")!.text).toContain("Launch a Card takes none");
  });
});

describe("the browser's check of the split transaction (built offline from the pinned SDK)", () => {
  const recipients = [{ address: creator, bps: 2000 }, { address: nft, bps: 8000 }];
  test("SOL and USDC splits pass; the creator is the only signer and the shareholders are exactly the chosen split", async () => {
    for (const quoteKey of ["sol", "usdc"] as const) {
      const fees = await feeSplitFixture({ creator, mint, quoteKey, recipients });
      const wire = validateFeeSharePlan(fees, fees.expected);
      expect(wire.signers).toEqual([creator]);
      expect(wire.programs.filter(program => program === LIVE_PROGRAMS.pumpFees)).toHaveLength(2);
      expect(wire.programs.includes(LIVE_PROGRAMS.associatedToken)).toBe(quoteKey === "usdc");
      expect(isWalletAddress(creator)).toBe(true);
    }
  });
  test("refused: another split, a reordered one, another coin or quote, a changed fee, a pre-signed slot, and the kinds mixed", async () => {
    const fees = await feeSplitFixture({ creator, mint, quoteKey: "sol", recipients });
    const refuse = (plan: TransactionPlan, expected = fees.expected) => expect(() => validateFeeSharePlan(plan, expected)).toThrow();
    refuse(fees, { ...fees.expected, recipients: [recipients[1], recipients[0]] });
    refuse(fees, { ...fees.expected, recipients: [{ address: creator, bps: 2001 }, { address: nft, bps: 7999 }] });
    refuse(fees, { ...fees.expected, recipients: [{ address: wallet(3), bps: 2000 }, { address: nft, bps: 8000 }] });
    refuse(fees, { ...fees.expected, tokenMint: nft });
    refuse(fees, { ...fees.expected, quoteKey: "usdc", quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
    refuse(fees, { ...fees.expected, creator: nft });
    refuse({ ...fees, review: { ...fees.review, priorityFeeLamports: "1" } });
    refuse({ ...fees, review: { ...fees.review, feeRecipients: [recipients[0]] } });
    const signed = fromBase64(fees.transactionBase64); signed.set(new Uint8Array(64).fill(1), 1);
    refuse({ ...fees, transactionBase64: toBase64(signed) });
    // A fees plan with two signers, and a coin plan carrying pump-fees, are each refused by the other's check.
    const coin = fixture();
    expect(() => validateFeeSharePlan({ ...coin.plan, kind: "fees" }, fees.expected)).toThrow("only your wallet's signature");
    expect(() => validateLivePlan({ ...fees, kind: "token" } as TransactionPlan, coin.expected)).toThrow();
    expect(() => validateLivePlan(fees as TransactionPlan, coin.expected)).toThrow();
  });
});
