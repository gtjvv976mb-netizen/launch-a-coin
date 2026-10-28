// Quotes (src/quote.ts) against @pump-fun/pump-sdk 2.0.0 and @pump-fun/pump-swap-sdk 1.20.0 on the read-only devnet
// fixtures: the live pump Global + FeeConfig, a real curve, a fresh curve (dev buy), the coin 1 pool with the pAMM
// GlobalConfig + FeeConfig. Equal to the lamport (m3-contract §6.1, §9.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import * as pump from "@pump-fun/pump-sdk";
import * as amm from "@pump-fun/pump-swap-sdk";
import {
  curveFeeMarketCap,
  curveProgressBps,
  decodeFeeConfig,
  feesForMarketCap,
  poolFeeMarketCap,
  quoteCurveBuyExactSol,
  quoteCurveBuyTokens,
  quoteCurveSell,
  quotePoolBuyExactQuote,
  quotePoolSell,
  slippageCeil,
  slippageFloor,
} from "../src/quote.ts";
import type { CurveReserves, FeeConfigAccount, PoolReserves } from "../src/quote.ts";
import { decodeBondingCurve, decodePumpGlobal } from "../src/accounts/pump.ts";
import { decodePool } from "../src/accounts/pamm.ts";
import { readU64 } from "../src/bytes.ts";
import { big, bn, fixtureAccount, fixtureAccountInfo, rng } from "./helpers.ts";

const global = pump.PUMP_SDK.decodeGlobal(fixtureAccountInfo("pump_global"));
const pumpFeeConfigSdk = pump.PUMP_SDK.decodeFeeConfig(fixtureAccountInfo("pump_fee_config"));
const pumpFees: FeeConfigAccount = decodeFeeConfig(fixtureAccount("pump_fee_config").data);
const curveSdk = pump.PUMP_SDK.decodeBondingCurve(fixtureAccountInfo("coin2_curve"));
const curveMine = decodeBondingCurve(fixtureAccount("coin2_curve").data);

const reserves = (c: ReturnType<typeof decodeBondingCurve>): CurveReserves => ({
  virtualTokenReserves: c.virtualTokenReserves,
  virtualSolReserves: c.virtualQuoteReserves,
  realTokenReserves: c.realTokenReserves,
  realSolReserves: c.realQuoteReserves,
  tokenTotalSupply: c.tokenTotalSupply,
  complete: c.complete,
});
const curve = reserves(curveMine);
const g = decodePumpGlobal(fixtureAccount("pump_global").data);
const fresh: CurveReserves = {
  virtualTokenReserves: g.initialVirtualTokenReserves,
  virtualSolReserves: g.initialVirtualSolReserves,
  realTokenReserves: g.initialRealTokenReserves,
  realSolReserves: 0n,
  tokenTotalSupply: g.tokenTotalSupply,
  complete: false,
};

test("decodeFeeConfig: devnet pump FeeConfig is one tier lp 0 / protocol 95 / creator 30 (equal to pump-sdk)", () => {
  assert.equal(pumpFees.feeTiers.length, pumpFeeConfigSdk.feeTiers.length);
  pumpFees.feeTiers.forEach((t, i) => {
    const s = pumpFeeConfigSdk.feeTiers[i];
    assert.equal(t.marketCapLamportsThreshold, big(s.marketCapLamportsThreshold));
    assert.equal(t.lpFeeBps, big(s.fees.lpFeeBps));
    assert.equal(t.protocolFeeBps, big(s.fees.protocolFeeBps));
    assert.equal(t.creatorFeeBps, big(s.fees.creatorFeeBps));
  });
  assert.deepEqual(feesForMarketCap(pumpFees, curveFeeMarketCap(curve)), { lpFeeBps: 0n, protocolFeeBps: 95n, creatorFeeBps: 30n });
  assert.throws(() => decodeFeeConfig(new Uint8Array(40)), /FeeConfig/);
});

test("curve buys and sells equal pump-sdk 2.0.0 to the lamport (existing curve, many sizes)", () => {
  const fees = feesForMarketCap(pumpFees, curveFeeMarketCap(curve));
  const r = rng(7);
  const sizes = [1n, 2n, 1000n, 1_000_000n, 50_000_000n, 123_456_789n, 2_000_000_000n];
  for (let i = 0; i < 20; i++) sizes.push(r.bigint(2_500_000_000n) + 1n);
  for (const sol of sizes) {
    const want = big(
      pump.getBuyTokenAmountFromSolAmount({ global, feeConfig: pumpFeeConfigSdk, mintSupply: curveSdk.tokenTotalSupply, bondingCurve: curveSdk, amount: bn(sol), quoteMint: NATIVE_MINT })
    );
    const q = quoteCurveBuyExactSol(curve, fees, sol);
    assert.equal(q.tokens, want, `buy tokens for ${sol}`);
    if (want > 0n) {
      const cost = big(
        pump.getBuySolAmountFromTokenAmount({ global, feeConfig: pumpFeeConfigSdk, mintSupply: curveSdk.tokenTotalSupply, bondingCurve: curveSdk, amount: bn(want), quoteMint: NATIVE_MINT })
      );
      assert.equal(q.sol, cost, `cost of ${want} tokens`);
      assert.ok(q.sol <= slippageCeil(sol, 1), "cost stays within a 1 bps ceiling of the SOL spent");
      assert.equal(q.protocolFee + q.creatorFee + (q.sol - q.protocolFee - q.creatorFee), q.sol);
    }
  }
  for (const tokens of [1n, 10_000n, 5_000_000_000n, 30_000_000_000_000n, curve.realTokenReserves]) {
    const cost = big(
      pump.getBuySolAmountFromTokenAmount({ global, feeConfig: pumpFeeConfigSdk, mintSupply: curveSdk.tokenTotalSupply, bondingCurve: curveSdk, amount: bn(tokens), quoteMint: NATIVE_MINT })
    );
    assert.equal(quoteCurveBuyTokens(curve, fees, tokens).sol, cost, `buy ${tokens} tokens`);
    const out = big(
      pump.getSellSolAmountFromTokenAmount({ global, feeConfig: pumpFeeConfigSdk, mintSupply: curveSdk.tokenTotalSupply, bondingCurve: curveSdk, amount: bn(tokens) })
    );
    assert.equal(quoteCurveSell(curve, fees, tokens).sol, out, `sell ${tokens} tokens`);
  }
  // more tokens than the curve holds are capped like pump-sdk (min(amount, realTokenReserves))
  assert.equal(quoteCurveBuyTokens(curve, fees, curve.realTokenReserves * 2n).tokens, curve.realTokenReserves);
});

test("dev buy on a fresh curve equals pump-sdk with bondingCurve = null (the launch quote)", () => {
  const fees = feesForMarketCap(pumpFees, curveFeeMarketCap(fresh));
  for (const sol of [10_000_000n, 50_000_000n, 1_000_000_000n]) {
    const want = big(
      pump.getBuyTokenAmountFromSolAmount({ global, feeConfig: pumpFeeConfigSdk, mintSupply: null, bondingCurve: null, amount: bn(sol), quoteMint: NATIVE_MINT })
    );
    assert.equal(quoteCurveBuyExactSol(fresh, fees, sol).tokens, want, `dev buy ${sol}`);
  }
  // Honk's seed launch: 0.05 SOL bought 50,494,116,624,552 tokens on devnet (deployed.json seeds)
  assert.equal(quoteCurveBuyExactSol(fresh, fees, 50_000_000n).tokens, 50_494_116_624_552n);
  // market cap and progress move the right way
  const q = quoteCurveBuyExactSol(fresh, fees, 100_000_000n);
  assert.ok(q.mcapAfterLamports > curveFeeMarketCap(fresh));
  assert.ok(q.priceImpactBps > 0);
  assert.equal(curveProgressBps(fresh), 0);
  assert.equal(curveProgressBps({ ...fresh, complete: true }), 10_000);
});

// ---------------------------------------------------------------- PumpSwap

const ammSdk = amm.PUMP_AMM_SDK;
const globalConfig = ammSdk.decodeGlobalConfig(fixtureAccountInfo("amm_global_config"));
const ammFeeConfigSdk = ammSdk.decodeFeeConfig(fixtureAccountInfo("amm_fee_config"));
const ammFees = decodeFeeConfig(fixtureAccount("amm_fee_config").data);
const poolInfo = fixtureAccountInfo("coin1_pool");
const poolSdk = ammSdk.decodePool(poolInfo);
const poolMine = decodePool(fixtureAccount("coin1_pool").data);
const baseReserve = readU64(fixtureAccount("coin1_pool_base_ta").data, 64);
const quoteReserve = readU64(fixtureAccount("coin1_pool_quote_ta").data, 64);
const supply = readU64(fixtureAccount("coin1_mint").data, 36);
const pool: PoolReserves = { baseAmount: baseReserve, quoteAmount: quoteReserve, virtualQuoteReserves: poolMine.virtualQuoteReserves, mintSupply: supply };
const baseMintAccount = { supply } as never;

test("decodeFeeConfig: pAMM tiers equal pump-swap-sdk; tier selection by market cap", () => {
  assert.equal(ammFees.feeTiers.length, ammFeeConfigSdk.feeTiers.length);
  ammFees.feeTiers.forEach((t, i) => {
    const s = ammFeeConfigSdk.feeTiers[i];
    assert.equal(t.marketCapLamportsThreshold, big(s.marketCapLamportsThreshold));
    assert.deepEqual([t.lpFeeBps, t.protocolFeeBps, t.creatorFeeBps], [big(s.fees.lpFeeBps), big(s.fees.protocolFeeBps), big(s.fees.creatorFeeBps)]);
  });
  // devnet tiers (facts §10): below 420 SOL lp 2 / protocol 93 / creator 30, from 420 SOL lp 20 / protocol 5 / creator 95
  assert.deepEqual(feesForMarketCap(ammFees, 100_000_000_000n), { lpFeeBps: 2n, protocolFeeBps: 93n, creatorFeeBps: 30n });
  assert.deepEqual(feesForMarketCap(ammFees, 420_000_000_000n), { lpFeeBps: 20n, protocolFeeBps: 5n, creatorFeeBps: 95n });
  const bigTier = feesForMarketCap(ammFees, 2_000_000_000_000n);
  assert.equal(bigTier.creatorFeeBps, 90n);
});

test("pool buys (quote in) and sells (base in) equal pump-swap-sdk 1.20.0 to the lamport", () => {
  const fees = feesForMarketCap(ammFees, poolFeeMarketCap(pool));
  const common = {
    slippage: 1,
    baseReserve: bn(baseReserve),
    quoteReserve: bn(quoteReserve),
    virtualQuoteReserves: bn(poolMine.virtualQuoteReserves),
    globalConfig,
    baseMintAccount,
    baseMint: poolSdk.baseMint,
    coinCreator: poolSdk.coinCreator,
    creator: poolSdk.creator,
    feeConfig: ammFeeConfigSdk,
  };
  const r = rng(11);
  const buys = [1_000n, 10_000_000n, 100_000_000n, 1_000_000_000n];
  for (let i = 0; i < 12; i++) buys.push(r.bigint(1_500_000_000n) + 10n);
  for (const quote of buys) {
    const s = amm.buyQuoteInput({ ...common, quote: bn(quote) });
    const q = quotePoolBuyExactQuote(pool, fees, quote);
    assert.equal(q.tokens, big(s.base), `pool buy tokens for ${quote}`);
    if (q.tokens > 0n) {
      const cost = amm.buyBaseInput({ ...common, base: s.base });
      assert.equal(q.sol, big(cost.uiQuote), `pool cost of ${q.tokens}`);
      assert.ok(q.sol <= quote, "never above the quote in");
    }
  }
  const sells = [1_000_000n, 1_000_000_000n, 10_000_000_000_000n];
  for (let i = 0; i < 10; i++) sells.push(r.bigint(20_000_000_000_000n) + 1n);
  for (const base of sells) {
    let want: bigint | null = null;
    try {
      want = big(amm.sellBaseInput({ ...common, base: bn(base) }).uiQuote);
    } catch {
      want = null;
    }
    if (want === null) assert.throws(() => quotePoolSell(pool, fees, base), /real quote|negative/);
    else assert.equal(quotePoolSell(pool, fees, base).sol, want, `pool sell ${base}`);
  }
  // a sell bigger than the pool's real quote cannot fill (POOL_TOO_THIN in the Worker)
  assert.throws(() => quotePoolSell(pool, fees, baseReserve * 10n), /Insufficient real quote/);
});

test("slippage helpers: floor and ceil in basis points", () => {
  assert.equal(slippageFloor(10_000n, 500), 9_500n);
  assert.equal(slippageCeil(10_000n, 500), 10_500n);
  assert.equal(slippageCeil(10_001n, 1), 10_003n);
  assert.equal(slippageFloor(1n, 2000), 0n);
  void Keypair;
});
