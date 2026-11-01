import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JupiterUnavailable, quoteSolFor, swapInstructions, SWAP_SLIPPAGE_BPS, WSOL_MINT } from "../../src/lib/carddex/live/jupiter";

// Getting a token pair's quote with SOL before an initial buy (owner request 1 November 2026: "is it not automatic").
// Jupiter is read from the creator's browser; the server checks, compiles and simulates (adapter tests: swap.test.ts).
const APP = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(APP, path), "utf8");
const FARTCOIN = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const calls: { url: string; init: RequestInit }[] = [];
const answer = (status: number, body: unknown) => async (url: string, init: RequestInit) => { calls.push({ url, init }); return Response.json(body, { status }); };

describe("asking Jupiter", () => {
  test("an exact-output quote from SOL, small enough for one transaction, with no cookies or referrer", async () => {
    const quote = await quoteSolFor(FARTCOIN, 1_000_000n, answer(200, { inAmount: "1258297", outAmount: "1000000", otherAmountThreshold: "1270880", swapMode: "ExactOut" }));
    expect(quote.otherAmountThreshold).toBe("1270880");
    const url = new URL(calls.at(-1)!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ inputMint: WSOL_MINT, outputMint: FARTCOIN, amount: "1000000", swapMode: "ExactOut", slippageBps: String(SWAP_SLIPPAGE_BPS), maxAccounts: "40" });
    expect([calls.at(-1)!.init.credentials, calls.at(-1)!.init.referrerPolicy]).toEqual(["omit", "no-referrer"]);
  });
  test("busy, no route, or a quote short of the amount: plain words, nothing prepared", async () => {
    await expect(quoteSolFor(FARTCOIN, 1n, answer(429, { code: 429 }))).rejects.toThrow("Jupiter is busy");
    await expect(quoteSolFor(FARTCOIN, 1n, answer(400, { errorCode: "NO_ROUTES_FOUND" }))).rejects.toThrow("no route");
    await expect(quoteSolFor(FARTCOIN, 2n, answer(200, { outAmount: "1", swapMode: "ExactOut" }))).rejects.toBeInstanceOf(JupiterUnavailable);
    await expect(swapInstructions({ inAmount: "1", outAmount: "1", otherAmountThreshold: "1", swapMode: "ExactOut" }, "w", answer(200, {}))).rejects.toThrow("did not return a swap");
  });
});

describe("the launch", () => {
  test("a short wallet gets the token with SOL first, before any upload, only where the site offers it and never for a stock", () => {
    const panel = read("src/components/carddex/live/LiveLaunchPanel.tsx");
    const swap = panel.indexOf("await getQuoteWithSol("), upload = panel.indexOf("requestCardMintSigner(");
    expect(swap).toBeGreaterThan(0);
    expect(swap).toBeLessThan(upload);
    expect(panel).toContain('if (!readiness.data?.quoteSwap || quote.kind === "stock") throw new Error(quoteBuyShortfall(');
    expect(panel).toContain("You declined the swap, so nothing was spent.");
    expect(read("src/routes/launch.tsx")).toContain("your wallet will first ask you to swap SOL");
    expect(read("src/routes/how.tsx")).toContain("Launch can first swap SOL");
  });
  test("the switch, the server functions and their table", () => {
    expect(read("src/lib/carddex/live/config.server.ts")).toContain('quoteSwap: recoveryReady && switchValue(env.CARDDEX_LIVE_QUOTE_SWAP) === "true"');
    const api = read("src/lib/carddex/live/api.ts");
    for (const fn of ["prepareLiveQuoteSwap", "submitLiveQuoteSwap", "confirmLiveQuoteSwap"]) expect(api).toContain(`export const ${fn} = createServerFn({method: "POST"})`);
    expect(read("src/lib/carddex/live/limits.server.ts")).toContain('["0021", "SELECT id, wallet, quote_key');
  });
});

describe("the server's own limits on a swap (security review, 1 November 2026)", () => {
  const service = () => read("src/lib/carddex/live/service.server.ts");
  test("held to Jupiter's independent price, read by the server; no price, no swap", () => {
    const code = service();
    expect(code).toContain("const fair = await fairSwapLamports(asset.mint, asset.decimals, target.need - have);");
    expect(code).toContain("if (fair === null) throw new UserError(");
    expect(code).toContain("https://api.dexscreener.com/tokens/v1/solana/");
    expect(code.indexOf("const fair = await fairSwapLamports(")).toBeLessThan(code.indexOf("plan = await prepareQuoteSwap("));
    expect(code).toContain("if (BigInt(plan.routeMaxIn) > fair + fair * SWAP_FAIR_PRICE_TOLERANCE_BPS / 10_000n + 10_000n)");
  });
  test("one swap at a time per wallet, and none when the wallet already holds enough", () => {
    const code = service();
    expect(code).toContain("for (const row of inFlight) if ((await confirmLiveQuoteSwap(wallet, {swapId: row.id})).status === \"pending\")");
    expect(code).toContain("UPDATE live_quote_swaps SET status = 'expired', updated_at = ? WHERE wallet = ? AND status = 'prepared'");
    expect(code).toContain("AND NOT EXISTS (SELECT 1 FROM live_quote_swaps o WHERE o.wallet = ? AND o.id <> ? AND (o.status = 'pending' OR (o.status = 'confirmed' AND o.updated_at >= ?)))");
    expect(code).toContain("preparedBase64: plan.transactionBase64");
    expect(code).toContain("if (have >= target.need) return {alreadyEnough: true as const};");
    expect(code).toContain("if (saved.meta?.changes !== 1) throw new UserError(");
    expect(read("src/components/carddex/live/LiveLaunchPanel.tsx")).toContain("if (prepared.alreadyEnough) return;");
  });
});

