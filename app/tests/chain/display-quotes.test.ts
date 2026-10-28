import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  PUMP_FEES_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  pumpFeeConfigPda,
  pumpGlobalPda,
} from "@mintdex/chain-sdk";
import {
  FEE_CONFIG_DISCRIMINATOR,
  quoteCurveBuyExactSol,
  quoteCurveSell,
  quotePoolBuyExactQuote,
  quotePoolSell,
  type FeeBps,
} from "@mintdex/chain-sdk/quote";

import { readDisplayQuoteSource } from "../../src/lib/chain/display-quotes";
import { TRUST_ANCHORS } from "../../src/lib/chain/env";
import {
  devBuyPlan,
  estimateCurveBuy,
  estimateCurveSell,
  estimateLaunchPreview,
  estimatePoolBuy,
  estimatePoolSell,
} from "../../src/lib/chain/estimate";
import { currentQuoteSource, displayQuoteEnabled, QUOTE_MAX_AGE_MS } from "../../src/lib/chain/quote-data";
import { resetTrust } from "../../src/lib/chain/trust";

const APP = path.resolve(import.meta.dir, "../..");
const FIXTURES = path.resolve(APP, "../chain/sdk/test/fixtures/devnet");
// An explicit offline quote input, never a production launch fallback.
const MAINNET_INITIAL_CURVE = {
  virtualSolReserves: 30_000_000_000n,
  virtualTokenReserves: 1_073_000_000_000_000n,
  realSolReserves: 0n,
  realTokenReserves: 793_100_000_000_000n,
  tokenTotalSupply: 1_000_000_000_000_000n,
  complete: false,
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetTrust();
});

type Account = { owner: string; lamports: number; data: [string, string] };
const fixture = (name: string): { pubkey: string; account: Account } =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));

/** A schedule with deliberately different creator fees on either side of a market-cap boundary. */
function schedule(): Account {
  const data = new Uint8Array(69 + 2 * 40);
  data.set(FEE_CONFIG_DISCRIMINATOR);
  const view = new DataView(data.buffer);
  view.setUint32(65, 2, true);
  for (const [i, threshold, protocol, creator] of [
    [0, 0n, 25n, 95n],
    [1, 100_000_000_000n, 10n, 140n],
  ] as const) {
    const o = 69 + i * 40;
    view.setBigUint64(o, threshold, true);
    view.setBigUint64(o + 16, 0n, true);
    view.setBigUint64(o + 24, protocol, true);
    view.setBigUint64(o + 32, creator, true);
  }
  return {
    owner: PUMP_FEES_PROGRAM_ID,
    lamports: 1_000_000,
    data: [Buffer.from(data).toString("base64"), "base64"],
  };
}

function installRpc(accounts: Map<string, Account>, genesis = TRUST_ANCHORS.genesisHash) {
  resetTrust();
  const calls: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const req = JSON.parse(String(init?.body));
    calls.push(req.method);
    if (req.method === "getGenesisHash") return Response.json({ result: genesis });
    if (req.method === "getMultipleAccounts") {
      return Response.json({
        result: { value: req.params[0].map((key: string) => accounts.get(key) ?? null) },
      });
    }
    throw new Error("Unexpected request");
  }) as typeof fetch;
  return calls;
}

describe("current chain fees for display quotes", () => {
  test("live quotes cover devnet launch and every mainnet venue, while simulation and devnet trades keep their behavior", () => {
    for (const venue of ["launch", "curve", "pool"] as const) {
      expect(displayQuoteEnabled(venue, "mainnet")).toBe(true);
      expect(displayQuoteEnabled(venue, "sim")).toBe(false);
    }
    expect(displayQuoteEnabled("launch", "devnet")).toBe(true);
    expect(displayQuoteEnabled("curve", "devnet")).toBe(false);
    expect(displayQuoteEnabled("pool", "devnet")).toBe(false);
  });

  test("devnet launch preview follows the current 0.3 SOL Global, then a later reserve change", async () => {
    const global = fixture("pump_global").account;
    const data = Buffer.from(global.data[0], "base64");
    data.writeBigUInt64LE(300_000_000n, 81);
    const accounts = new Map([
      [pumpGlobalPda(), { ...global, data: [data.toString("base64"), "base64"] as [string, string] }],
      [pumpFeeConfigPda(), fixture("pump_fee_config").account],
    ]);
    installRpc(accounts);
    const source = await readDisplayQuoteSource("launch");
    if (!source || source.venue !== "launch") throw new Error("missing devnet launch source");
    const initial = estimateLaunchPreview(source, 0);
    expect(Math.floor(initial.mcapLamports!)).toBe(279_589_934);
    const buy = estimateLaunchPreview(source, 50_000_000);
    expect(buy.devBuy?.tokens).toBe(151_660_774_617_885);
    expect(buy.mcapLamports).toBe(379_211_809);
    // The old 1 SOL display produced only about 50.49M tokens and a 1.026 SOL market cap for this same buy.
    expect(buy.devBuy?.tokens).toBeGreaterThan(150_000_000_000_000);
    data.writeBigUInt64LE(600_000_000n, 81);
    accounts.set(pumpGlobalPda(), { ...global, data: [data.toString("base64"), "base64"] });
    const changed = await readDisplayQuoteSource("launch");
    if (!changed || changed.venue !== "launch") throw new Error("missing refreshed launch source");
    expect(estimateLaunchPreview(changed, 50_000_000).devBuy?.tokens).toBeLessThan(buy.devBuy!.tokens);
  });

  test("launch uses the live Global reserves and the matching fee tier, rather than a development-network rate", async () => {
    const global = fixture("pump_global").account;
    const data = Buffer.from(global.data[0], "base64");
    data.writeBigUInt64LE(30_000_000_000n, 81);
    const accounts = new Map([
      [
        pumpGlobalPda(),
        { ...global, data: [data.toString("base64"), "base64"] as [string, string] },
      ],
      [pumpFeeConfigPda(), schedule()],
    ]);
    installRpc(accounts);
    const first = await readDisplayQuoteSource("launch");
    expect(first?.venue).toBe("launch");
    if (!first || first.venue === "pool") throw new Error("missing launch source");
    expect(first.reserves.virtualSolReserves).toBe(30_000_000_000n);
    expect(first.fees.creatorFeeBps).toBe(95n);
    data.writeBigUInt64LE(300_000_000_000n, 81);
    accounts.set(pumpGlobalPda(), { ...global, data: [data.toString("base64"), "base64"] });
    const next = await readDisplayQuoteSource("launch");
    expect(next?.fees.creatorFeeBps).toBe(140n);
  });

  test("curve and PumpSwap reads use their own live fee schedules", async () => {
    const names = [
      "coin2_curve",
      "coin2_mint",
      "coin1_pool",
      "coin1_mint",
      "coin1_pool_base_ta",
      "coin1_pool_quote_ta",
      "amm_fee_config",
    ];
    const accounts = new Map(
      names.map((n) => {
        const f = fixture(n);
        return [f.pubkey, f.account];
      }),
    );
    accounts.set(pumpFeeConfigPda(), schedule());
    installRpc(accounts);
    const curve = await readDisplayQuoteSource("curve", fixture("coin2_mint").pubkey);
    expect(curve?.fees.creatorFeeBps).toBe(95n);
    const pool = await readDisplayQuoteSource("pool", fixture("coin1_mint").pubkey);
    expect(pool?.venue).toBe("pool");
    expect(pool?.fees.creatorFeeBps).toBeGreaterThan(0n);
  });

  test("missing, malformed or foreign-owned fees provide no numeric fallback", async () => {
    const accounts = new Map([[pumpGlobalPda(), fixture("pump_global").account]]);
    installRpc(accounts);
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    accounts.set(pumpFeeConfigPda(), { ...schedule(), data: ["AAAA", "base64"] });
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    accounts.set(pumpFeeConfigPda(), { ...schedule(), owner: PUMP_PROGRAM_ID });
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    const curve = fixture("coin2_curve");
    const mint = fixture("coin2_mint");
    accounts.set(curve.pubkey, curve.account);
    accounts.set(mint.pubkey, mint.account);
    expect(await readDisplayQuoteSource("curve", mint.pubkey)).toBeNull();
  });

  test("missing, malformed or foreign-owned Global never supplies a launch preview", async () => {
    const accounts = new Map([[pumpFeeConfigPda(), fixture("pump_fee_config").account]]);
    installRpc(accounts);
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    accounts.set(pumpGlobalPda(), { ...fixture("pump_global").account, owner: PUMP_FEES_PROGRAM_ID });
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    accounts.set(pumpGlobalPda(), { ...fixture("pump_global").account, data: ["AAAA", "base64"] });
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    expect(estimateLaunchPreview(null, 0)).toEqual({ devBuy: null, mcapLamports: null });
  });

  test("wrong-cluster and failed RPC responses never become an estimate", async () => {
    const calls = installRpc(new Map(), "wrong-genesis");
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    expect(calls).toEqual(["getGenesisHash"]);
    resetTrust();
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await readDisplayQuoteSource("launch")).toBeNull();
  });

  test("a missing preview never removes a requested dev buy or its slippage allowance", async () => {
    installRpc(new Map());
    expect(await readDisplayQuoteSource("launch")).toBeNull();
    expect(estimateCurveBuy(MAINNET_INITIAL_CURVE, 100_000_000, null)).toBeNull();
    expect(estimateLaunchPreview(null, 100_000_000)).toEqual({ devBuy: null, mcapLamports: null });
    expect(devBuyPlan(100_000_000, 1_000_000_000, 200)).toEqual({
      amountLamports: 100_000_000n,
      maxSolLamports: 102_000_000,
    });
    expect(devBuyPlan(0, 1_000_000_000, 200)).toEqual({ amountLamports: 0n, maxSolLamports: 0 });
    expect(devBuyPlan(Number.NaN, 1_000_000_000, 200).amountLamports).toBe(0n);
    expect(devBuyPlan(1_000_000_001, 1_000_000_000, 200).amountLamports).toBe(0n);
  });

  test("snapshots expire; future or absent snapshots are unavailable", () => {
    const source = {
      venue: "launch" as const,
      reserves: MAINNET_INITIAL_CURVE,
      fees: { lpFeeBps: 0n, protocolFeeBps: 25n, creatorFeeBps: 95n },
      readAt: 1_000,
    };
    expect(currentQuoteSource(source, 1_000 + QUOTE_MAX_AGE_MS - 1)).toBe(source);
    expect(currentQuoteSource(source, 1_000 + QUOTE_MAX_AGE_MS)).toBeNull();
    expect(currentQuoteSource(source, 999)).toBeNull();
    expect(currentQuoteSource(null)).toBeNull();
    const expired = currentQuoteSource(source, 1_000 + QUOTE_MAX_AGE_MS);
    expect(estimateLaunchPreview(expired?.venue === "launch" ? expired : null, 0).mcapLamports).toBeNull();
  });
});

test("curve and pool estimates preserve current creator/protocol/LP fee amounts for buys and sells", () => {
  const fees: FeeBps = { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 140n };
  const curveFees = { ...fees, lpFeeBps: 0n };
  const pool = {
    baseAmount: 300_000_000_000_000n,
    quoteAmount: 120_000_000_000n,
    virtualQuoteReserves: 18_000_000_000n,
    mintSupply: 1_000_000_000_000_000n,
  };
  const pairs = [
    [
      estimateCurveBuy(MAINNET_INITIAL_CURVE, 1_000_000_000, curveFees),
      quoteCurveBuyExactSol(MAINNET_INITIAL_CURVE, curveFees, 1_000_000_000n),
    ],
    [
      estimateCurveSell(MAINNET_INITIAL_CURVE, 1_000_000_000, curveFees),
      quoteCurveSell(MAINNET_INITIAL_CURVE, curveFees, 1_000_000_000n),
    ],
    [
      estimatePoolBuy(pool, 1_000_000_000, fees),
      quotePoolBuyExactQuote(pool, fees, 1_000_000_000n),
    ],
    [estimatePoolSell(pool, 1_000_000_000, fees), quotePoolSell(pool, fees, 1_000_000_000n)],
  ] as const;
  for (const [estimate, quote] of pairs) {
    expect(estimate?.fee).toBe(Number(quote.creatorFee + quote.protocolFee + quote.lpFee));
    expect(estimate?.cardFee).toBe(Number(quote.creatorFee));
    expect(estimate?.tokens).toBe(Number(quote.tokens));
    expect(estimate?.sol).toBe(Number(quote.sol));
  }
});

test("CardDex forces isolated simulation despite inherited environment requests", () => {
  const script = `const m = await import("./src/lib/mintdex/mode.ts"); const c = await import("./src/lib/mintdex/constants.ts"); console.log(JSON.stringify({mode:m.MODE, chain:m.IS_CHAIN, owner:c.OWNER_FEE_BPS, royalty:c.CREATOR_ROYALTY_BPS, sales:c.DEED_PROTOCOL_BPS}));`;
  for (const requested of ["mainnet", "devnet", "sim"]) {
    const result = Bun.spawnSync([process.execPath, "-e", script], { cwd: APP, env: { ...process.env, VITE_MINTDEX_MODE: requested, VITE_CARDDEX_MODE: requested } });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ mode: "sim", chain: false, owner: 0, royalty: 0, sales: 0 });
  }
});
