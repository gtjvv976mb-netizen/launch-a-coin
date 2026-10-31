import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CREATOR_KEEPS_HINT, createOptionsChanged, creatorFeesOffer, creatorFeesView, EMPTY_CREATOR_FEES, FEE_RATE_PERMANENT, FEE_RATE_UNCHECKED,
  HOLDERS_LINE, HOLDERS_NOT_OFFERED, HOLDERS_PERMANENT, HOLDERS_WHO_PAYS, HOLDERS_WHO_PAYS_SHORT, parseFeeRate, readCreatorFeesDraft,
} from "../../src/components/carddex/live/creator-fees";
import { CreatorFeesFields } from "../../src/components/carddex/live/CreatorFeesFields";
import {
  CREATOR_FEE_RATE_OFF, createOptionsProblem, createV2FlagTail, readCreateOptions, sameCreateOptions,
} from "../../../integrations/pumpfun/src/create-options";
import { OFFERED_PAIRS } from "../../src/lib/carddex/pairs";

// "Creator fees" in Launch's More options: holder rewards and a custom creator fee rate. Rendering and rules only;
// nothing is signed or sent.
const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");
const render = (props: Partial<Parameters<typeof CreatorFeesFields>[0]> = {}) => renderToStaticMarkup(createElement(CreatorFeesFields, {
  value: EMPTY_CREATOR_FEES, onChange: () => undefined, holders: true, rateMax: null, rateError: null, disabled: false,
  split: createElement("div", { id: "split-marker" }), ...props,
}));

describe("the shared rule (create-options.ts)", () => {
  test("only chosen options are kept, so a regular coin saves and hashes nothing new", () => {
    expect(readCreateOptions(undefined)).toEqual({});
    expect(readCreateOptions({ holderReward: false, creatorFeeBps: 0 })).toEqual({});
    expect(Object.keys(readCreateOptions({ creatorFeeBps: 5, holderReward: true }))).toEqual(["holderReward", "creatorFeeBps"]);
    expect(() => readCreateOptions({ holderReward: "true" })).toThrow();
    expect(() => readCreateOptions({ creatorFeeBps: 1.5 })).toThrow();
    expect(sameCreateOptions({}, { holderReward: undefined })).toBe(true);
    expect(sameCreateOptions({ holderReward: true }, {})).toBe(false);
  });
  test("the 11 create_v2 flag bytes: mayhem and cashback always 0, the rate as u64 LE, then holder rewards", () => {
    expect(Buffer.from(createV2FlagTail({})).toString("hex")).toBe("0000000000000000000000");
    expect(Buffer.from(createV2FlagTail({ holderReward: true })).toString("hex")).toBe("0000000000000000000001");
    expect(Buffer.from(createV2FlagTail({ creatorFeeBps: 300, holderReward: true })).toString("hex")).toBe("00002c0100000000000001");
  });
  test("a custom rate only where pump.fun stores it, within Global's range; holder rewards only while Global allows them", () => {
    const global = { holderRewards: true, creatorFeeConfigurable: true, maxCreatorFeeBps: 300 };
    expect(createOptionsProblem({ creatorFeeBps: 100 }, { admission: "native", global })).toMatch("custom pairs");
    expect(createOptionsProblem({ creatorFeeBps: 100 }, { admission: "global", global })).toMatch("custom pairs");
    expect(createOptionsProblem({ creatorFeeBps: 300 }, { admission: "quoteControl", global })).toBeNull();
    expect(createOptionsProblem({ creatorFeeBps: 301 }, { admission: "quoteControl" })).toMatch("3.00%");
    expect(createOptionsProblem({ creatorFeeBps: 50 }, { admission: "quoteControl", global: { ...global, creatorFeeConfigurable: false } })).toMatch("doesn't accept");
    expect(createOptionsProblem({ holderReward: true }, { admission: "native", global: { ...global, holderRewards: false } })).toMatch("switched off");
    expect(createOptionsProblem({ holderReward: true }, { admission: "native", global })).toBeNull();
  });
});

describe("the Launch form's Creator fees group", () => {
  test("offered only while pump.fun allows each option, the rate on custom pairs only", () => {
    const on = { holderRewards: true, creatorFeeRate: { maxBps: 300 } };
    expect(creatorFeesOffer(null, "quoteControl")).toEqual({ holders: false, rateMax: null });
    expect(creatorFeesOffer({ holderRewards: false, creatorFeeRate: null }, "quoteControl")).toEqual({ holders: false, rateMax: null });
    expect(creatorFeesOffer(on, "native")).toEqual({ holders: true, rateMax: null });
    expect(creatorFeesOffer(on, "global")).toEqual({ holders: true, rateMax: null });
    expect(creatorFeesOffer(on, "quoteControl")).toEqual({ holders: true, rateMax: 300 });
    expect(creatorFeesOffer({ holderRewards: true, creatorFeeRate: { maxBps: 900 } }, "quoteControl").rateMax).toBe(300);
    // Every offered pair but SOL and USDC is a custom pair.
    expect(OFFERED_PAIRS.filter(asset => asset.admission !== "quoteControl").map(asset => asset.key).sort()).toEqual(["sol", "usdc"]);
  });
  test("the two models are exclusive: holders hides the split and says what is permanent and who pays", () => {
    const keeps = render();
    expect(keeps).toContain("Creator keeps fees"); expect(keeps).toContain("Holders get the fees");
    expect(keeps).toMatch(/type="radio"[^>]*checked=""[^>]*\/?>/);
    expect(keeps).toContain("split-marker");
    const holders = render({ value: { holders: true, rate: "" } });
    expect(holders).not.toContain("split-marker");
    expect(holders).toContain(HOLDERS_PERMANENT.replace(/'/g, "&#x27;"));
    expect(holders).toContain(HOLDERS_WHO_PAYS_SHORT);
    expect(HOLDERS_WHO_PAYS_SHORT).toMatch(/not guaranteed/);
    expect(holders).toContain('href="/how#fees"');
    // The review, where the coin is approved, keeps who pays in full.
    expect(read("src/components/carddex/live/LiveLaunchPanel.tsx")).toContain("<p><strong>{HOLDERS_PERMANENT}</strong> {HOLDERS_WHO_PAYS}</p>");
    // Both radios share one group name, so one choice excludes the other.
    const names = [...keeps.matchAll(/type="radio"[^>]*name="([^"]+)"/g)].map(match => match[1]);
    expect(names).toHaveLength(2); expect(new Set(names).size).toBe(1);
  });
  test("hidden when pump.fun has holder rewards off: no radios, the split shows as before", () => {
    const off = render({ holders: false, rateMax: 300 });
    expect(off).not.toContain('type="radio"'); expect(off).toContain("split-marker");
    expect(off).toContain('id="creator-fee-rate"');
    expect(render({ rateMax: null })).not.toContain('id="creator-fee-rate"');
  });
  test("the custom rate: two decimals, 0.01% to the maximum, its permanence said once a rate is typed; a saved launch shows locked", () => {
    expect(parseFeeRate("", 300)).toEqual({ bps: null, error: null });
    expect(parseFeeRate("1.25", 300)).toEqual({ bps: 125, error: null });
    expect(parseFeeRate("0.01", 300)).toEqual({ bps: 1, error: null });
    expect(parseFeeRate("3", 300)).toEqual({ bps: 300, error: null });
    for (const bad of ["3.01", "0", "0.001", ".", "1.2.3", "abc", "100"]) expect(parseFeeRate(bad, 300).error).toMatch("0.01% to 3.00%");
    expect(render({ rateMax: 300, value: { holders: false, rate: "1" } })).toContain(FEE_RATE_PERMANENT.replace(/'/g, "&#x27;"));
    expect(render({ rateMax: 300 })).not.toContain(FEE_RATE_PERMANENT.replace(/'/g, "&#x27;"));
    expect(render({ disabled: true })).toMatch(/<fieldset [^>]*disabled=""/);
  });
  test("drafts keep the choice; anything unreadable is the default", () => {
    expect(readCreatorFeesDraft({ holders: true, rate: "1.5" })).toEqual({ holders: true, rate: "1.5" });
    expect(readCreatorFeesDraft({ holders: "yes", rate: 3 })).toEqual(EMPTY_CREATOR_FEES);
    expect(readCreatorFeesDraft(null)).toEqual(EMPTY_CREATOR_FEES);
  });
  test("the form wires it: holders drop the split, every surface names the model, copy promises no earnings", () => {
    const launch = read("src/routes/launch.tsx");
    expect(launch).toContain("const feesActive = feesOpen && feeSplit.on && !holdersActive;");
    expect(launch).toContain("holderReward: holdersActive, creatorFeeBps: rateCheck.bps");
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    expect(panel).toContain("Creator fees go to holders");
    expect(panel).toContain("<dt>Creator fees</dt>");
    expect(read("src/routes/coin/$id.tsx")).toContain("HOLDERS_LINE");
    for (const copy of [HOLDERS_WHO_PAYS, HOLDERS_WHO_PAYS_SHORT, read("src/routes/how.tsx"), read("src/routes/legal.tsx")]) expect(copy).toMatch(/not guarantee/);
    expect([HOLDERS_PERMANENT, HOLDERS_WHO_PAYS, HOLDERS_WHO_PAYS_SHORT, FEE_RATE_PERMANENT].join(" ")).not.toMatch(/earn passive|guaranteed (income|returns|payouts)|profit|yield/i);
  });
});

describe("audit fixes: the creator's own choice is never flipped or dropped", () => {
  const mint = "Card1111111111111111111111111111111111111111";
  test("a server intent naming other create options than this tab prepared is refused", () => {
    const keeps = { tokenMint: mint, holderReward: false, creatorFeeBps: undefined };
    expect(createOptionsChanged(keeps, { tokenMint: mint })).toBe(false);
    expect(createOptionsChanged(keeps, { tokenMint: mint, holderReward: true })).toBe(true);
    expect(createOptionsChanged(keeps, { tokenMint: mint, creatorFeeBps: 300 })).toBe(true);
    expect(createOptionsChanged({ tokenMint: mint, creatorFeeBps: 250 }, { tokenMint: mint, creatorFeeBps: 300 })).toBe(true);
    expect(createOptionsChanged({ tokenMint: mint, holderReward: true }, { tokenMint: mint, holderReward: true })).toBe(false);
    // No input for this coin here (a resumed launch): nothing to compare, the review shows the intent's options.
    expect(createOptionsChanged(null, { tokenMint: mint, holderReward: true })).toBe(false);
    expect(createOptionsChanged({ tokenMint: "Other", holderReward: false }, { tokenMint: mint, holderReward: true })).toBe(false);
  });
  test("every coin expectation checks the options, and refreshes check before the intent is adopted", () => {
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    // expectedFor builds every coin plan's expectation, including the second Approve's (approveInWallet) and the
    // unsent/expired recovery's: a flipped intent can never become what the wallet's bytes are checked against.
    expect(panel).toMatch(/function expectedFor\(current: LiveLaunchIntent, kind: "token" \| "nft"\): ExpectedPlan \{\n\s+if \(kind === "token"\) assertOwnOptions\(current\);/);
    expect(panel).toContain("if (createOptionsChanged(preparedInput.current, current)) throw new Error(OPTIONS_CHANGED);");
    // refreshPlan and refreshPair refuse before retain, so neither the tab's intent nor its plan holds the flip.
    expect(panel).toContain('assertCurrent(version, address); if (kind === "token") assertOwnSplit(response.intent); retain(response.intent);');
    expect(panel).toContain("assertCurrent(version, address); assertOwnSplit(response.intent); retain(response.intent);\n    return acceptPrepared(response);");
  });
  const view = (over: Partial<Parameters<typeof creatorFeesView>[0]> = {}) => creatorFeesView({
    options: { holderRewards: true, creatorFeeRate: { maxBps: 300 } }, admission: "quoteControl", draft: EMPTY_CREATOR_FEES, locked: false,
    seen: { holders: false, rate: false }, ...over,
  });
  test("a typed rate is kept and sent while pump.fun's answer is unknown, blocks Launch when it is known off", () => {
    const typed = { holders: false, rate: "2.5" };
    expect(view({ draft: typed }).rateCheck).toEqual({ bps: 250, error: null });
    const unknown = view({ options: null, draft: typed });
    expect(unknown.rateMax).toBe(300); expect(unknown.rateCheck.bps).toBe(250); expect(unknown.rateNote).toBe(FEE_RATE_UNCHECKED);
    const off = view({ options: { holderRewards: true, creatorFeeRate: null }, draft: typed });
    expect(off.rateMax).toBe(300); expect(off.rateCheck).toEqual({ bps: null, error: CREATOR_FEE_RATE_OFF });
    // Cleared after being shown: the field stays mounted (focus stays), nothing is sent.
    const cleared = view({ options: null, seen: { holders: false, rate: true } });
    expect(cleared.rateMax).toBe(300); expect(cleared.rateCheck).toEqual({ bps: null, error: null });
    // SOL/USDC: not sent, and the form says so.
    const sol = view({ admission: "native", draft: typed });
    expect(sol.rateMax).toBeNull(); expect(sol.rateCheck.bps).toBeNull(); expect(sol.rateNote).toMatch("not sent");
    expect(view({ admission: "native" }).rateNote).toBeNull();
    expect(render({ rateMax: null, rateNote: "kept note" })).toContain("kept note");
  });
  test("a holders choice pump.fun no longer offers stays mounted, can't be picked again, and says why", () => {
    const off = { holderRewards: false, creatorFeeRate: null };
    const restored = view({ options: off, draft: { holders: true, rate: "" } });
    expect(restored.holdersShown).toBe(true); expect(restored.holdersActive).toBe(true); expect(restored.holdersNote).toBe(HOLDERS_NOT_OFFERED);
    // Switched to "Creator keeps fees": still shown once seen, holders not offered.
    const left = view({ options: off, seen: { holders: true, rate: false } });
    expect(left.holdersShown).toBe(true); expect(left.holdersActive).toBe(false); expect(left.holdersOffered).toBe(false);
    const html = render({ holders: true, holdersOffered: false, holdersNote: HOLDERS_NOT_OFFERED });
    expect(html).toMatch(/id="creator-fees-holders"[^>]*disabled=""/);
    expect(html).toContain("isn&#x27;t offering holder rewards");
    // Unknown (loading): nothing claimed about pump.fun, the choice stays selectable.
    expect(view({ options: null, draft: { holders: true, rate: "" } }).holdersNote).toBeNull();
    expect(view({ options: null }).holdersOffered).toBe(true);
    expect(view({ locked: true, draft: { holders: true, rate: "1" } })).toMatchObject({ holdersShown: true, holdersActive: true, rateMax: 300 });
  });
  test("honest copy: who pays and the minimum on the coin page, trader cost in the fee table, claiming for creators", () => {
    const coin = read("src/routes/coin/$id.tsx");
    expect(coin).toContain("Holder rewards: {HOLDERS_WHO_PAYS}");
    expect(coin).toContain('search={{ tab: "fees" }}');
    expect(HOLDERS_LINE).toMatch(/not guaranteed/);
    expect(HOLDERS_WHO_PAYS).toMatch(/US\$20/);
    const legal = read("src/routes/legal.tsx").replace(/\s+/g, " ");
    expect(legal).toContain("Every buyer and seller pays this rate instead of the standard one, so a higher rate costs traders more.");
    expect(legal).toContain("only to wallets holding at least pump.fun's minimum (about US$20 worth today)");
    expect(CREATOR_KEEPS_HINT).not.toMatch(/to your wallet/);
    expect(CREATOR_KEEPS_HINT).toMatch(/claim/);
    const portfolio = read("src/routes/portfolio.tsx");
    expect(portfolio).not.toContain(" · Holder rewards");
    expect(portfolio).toContain('l.holderReward ? ", Holder rewards" : ""');
  });
});

// 1 November: the browser's copy of pair-assets.json dropped `admission`, so Launch never offered the rate on any pair
// while every test (reading the whole file) passed. Read it through the client copy the build actually ships.
describe("the browser's pair data", () => {
  test("keeps each pair's admission, so the custom rate is offered on custom pairs and only there", async () => {
    const { clientRegistryCopy } = await import("../../src/lib/carddex/client-registry-fields");
    const raw = readFileSync(resolve(import.meta.dir, "../../src/lib/carddex/pair-assets.json"), "utf8");
    const copy = clientRegistryCopy("pair-assets.json", raw);
    const rows = JSON.parse(copy!.replace(/^export default /, "").replace(/;\s*$/, "")) as { key: string; admission?: string }[];
    const on = { holderRewards: true, creatorFeeRate: { maxBps: 300 } };
    const byKey = new Map(rows.map(row => [row.key, row]));
    expect(byKey.get("bonk")?.admission).toBe("quoteControl");
    expect(creatorFeesOffer(on, byKey.get("bonk")!.admission!).rateMax).toBe(300);
    expect(creatorFeesOffer(on, byKey.get("sol")!.admission!).rateMax).toBeNull();
    expect(creatorFeesOffer(on, byKey.get("usdc")!.admission!).rateMax).toBeNull();
    for (const pair of OFFERED_PAIRS) expect([pair.key, typeof byKey.get(pair.key)?.admission]).toEqual([pair.key, "string"]);
  });
});
