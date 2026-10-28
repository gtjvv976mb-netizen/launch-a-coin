// Account decoders and market-cap readers (mirrors of U1, U2, U6 and U11) against the SDKs and devnet fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint } from "@solana/spl-token";
import * as pump from "@pump-fun/pump-sdk";
import * as amm from "@pump-fun/pump-swap-sdk";
import { decodeBondingCurve } from "../src/accounts/pump.ts";
import { decodeTokenAccount, decodeMint, mintMetadataPointer, mintTokenMetadata } from "../src/accounts/token.ts";
import { decodePriceUpdateV2, pythSolUsdE6, pythToUsdE6 } from "../src/accounts/pyth.ts";
import { decodeAddressLookupTable } from "../src/accounts/alt.ts";
import {
  curveMarketCapLamports,
  poolMarketCapLamports,
  readCurveAccount,
  readMarketCap,
  readPool,
  registerCurveProblems,
} from "../src/market-cap.ts";
import { ChainCheckError } from "../src/accounts/types.ts";
import { PYTH_SOL_USD_PRICE_ACCOUNT, TOKEN_PROGRAM_ID } from "../src/constants.ts";
import { coinAddresses } from "../src/pda.ts";
import { readU64 } from "../src/bytes.ts";
import { big, bn, fixtureAccount, fixtureAccountInfo } from "./helpers.ts";

const COIN1 = "GUZ7sQ4yZ9HQHAD4GJkkGei74DUeZGun6GPykNcRmint";
const COIN2 = "DDmAzZMPumnX4Hkq5ukZcV357X38SpW16c49BcBbmint";
const code = (c: string) => (e: unknown) => e instanceof ChainCheckError && e.code === c;

test("bonding curve decoder agrees with PUMP_SDK.decodeBondingCurve (174-byte create_v2 curves)", () => {
  for (const name of ["coin1_curve", "coin2_curve"]) {
    const mine = decodeBondingCurve(fixtureAccount(name).data);
    const sdk = pump.PUMP_SDK.decodeBondingCurve(fixtureAccountInfo(name));
    assert.equal(mine.dataLength, 174);
    assert.equal(mine.virtualTokenReserves, big(sdk.virtualTokenReserves));
    assert.equal(mine.virtualQuoteReserves, big(sdk.virtualQuoteReserves));
    assert.equal(mine.realTokenReserves, big(sdk.realTokenReserves));
    assert.equal(mine.realQuoteReserves, big(sdk.realQuoteReserves));
    assert.equal(mine.tokenTotalSupply, big(sdk.tokenTotalSupply));
    assert.equal(mine.complete, sdk.complete);
    assert.equal(mine.creator, sdk.creator.toBase58());
    assert.equal(mine.isMayhemMode, sdk.isMayhemMode);
    assert.equal(mine.creatorFeeBps, big(sdk.creatorFeeBps ?? 0));
  }
});

test("U1 mirror: curve market cap equals bondingCurveMarketCap to the lamport", () => {
  const launch = {
    tokenTotalSupply: 10n ** 15n,
    virtualQuoteReserves: 10n ** 9n,
    virtualTokenReserves: 1_073_000_000_000_000n,
  };
  assert.equal(curveMarketCapLamports(launch), 931_966_449n);
  const done = {
    tokenTotalSupply: 10n ** 15n,
    virtualQuoteReserves: 3_833_511_973n,
    virtualTokenReserves: 279_900_000_000_000n,
  };
  assert.equal(curveMarketCapLamports(done), 13_696_005_619n);
  for (const c of [launch, done]) {
    const sdk = pump.bondingCurveMarketCap({
      mintSupply: bn(c.tokenTotalSupply),
      virtualQuoteReserves: bn(c.virtualQuoteReserves),
      virtualTokenReserves: bn(c.virtualTokenReserves),
    });
    assert.equal(curveMarketCapLamports(c), big(sdk));
  }
  const coin2 = decodeBondingCurve(fixtureAccount("coin2_curve").data);
  const sdk2 = pump.bondingCurveMarketCap({
    mintSupply: bn(coin2.tokenTotalSupply),
    virtualQuoteReserves: bn(coin2.virtualQuoteReserves),
    virtualTokenReserves: bn(coin2.virtualTokenReserves),
  });
  assert.equal(curveMarketCapLamports(coin2), big(sdk2));
  assert.throws(() => curveMarketCapLamports({ ...launch, virtualTokenReserves: 0n }), code("PoolRequired"));
});

test("U2 mirror: pool market cap equals poolMarketCap(effective quote) and enforces the bounds", () => {
  const justMigrated = {
    quoteAmount: 2_235_361_845n,
    virtualQuoteReserves: 583_150_127n,
    baseAmount: 206_900_000_000_000n,
    mintSupply: 10n ** 15n,
  };
  const m = poolMarketCapLamports(justMigrated);
  assert.equal(m, ((2_235_361_845n + 583_150_127n) * 10n ** 15n) / 206_900_000_000_000n);
  assert.ok(m > 13_620_000_000n && m < 13_630_000_000n);
  const sdk = amm.poolMarketCap({
    baseMintSupply: bn(justMigrated.mintSupply),
    baseReserve: bn(justMigrated.baseAmount),
    quoteReserve: bn(justMigrated.quoteAmount + justMigrated.virtualQuoteReserves),
  });
  assert.equal(m, big(sdk));
  // the live coin 1 pool fixture
  const a = coinAddresses(COIN1);
  const reading = readPool(COIN1, {
    pool: fixtureAccount("coin1_pool"),
    poolBaseTokenAccount: fixtureAccount("coin1_pool_base_ta"),
    poolQuoteTokenAccount: fixtureAccount("coin1_pool_quote_ta"),
    mint: fixtureAccount("coin1_mint"),
  });
  assert.equal(reading.pool.poolBaseTokenAccount, a.poolBaseTokenAccount);
  const sdkLive = amm.poolMarketCap({
    baseMintSupply: bn(readU64(fixtureAccount("coin1_mint").data, 36)),
    baseReserve: bn(readU64(fixtureAccount("coin1_pool_base_ta").data, 64)),
    quoteReserve: bn(readU64(fixtureAccount("coin1_pool_quote_ta").data, 64) + reading.pool.virtualQuoteReserves),
  });
  assert.equal(reading.mcapLamports, big(sdkLive));
  assert.equal(reading.creatorLost, false);
  assert.throws(() => poolMarketCapLamports({ ...justMigrated, baseAmount: 999_999_999n }), code("PoolTooThin"));
  assert.doesNotThrow(() => poolMarketCapLamports({ ...justMigrated, baseAmount: 1_000_000_000n }));
  assert.throws(() => poolMarketCapLamports({ ...justMigrated, virtualQuoteReserves: -1n }), code("PoolMismatch"));
  assert.throws(
    () => poolMarketCapLamports({ ...justMigrated, virtualQuoteReserves: 1n << 64n }),
    code("PoolMismatch")
  );
});

test("readMarketCap: coin 2 reads the curve, graduated coin 1 reads the pool (reserves 0)", () => {
  const c2 = readMarketCap({ mint: COIN2, bondingCurve: fixtureAccount("coin2_curve") });
  assert.equal(c2.source, "curve");
  assert.equal(c2.creatorLost, false);
  assert.equal(c2.feesChanged, false);
  const curve1 = fixtureAccount("coin1_curve");
  assert.equal(decodeBondingCurve(curve1.data).virtualTokenReserves, 0n);
  const poolAccounts = {
    pool: fixtureAccount("coin1_pool"),
    poolBaseTokenAccount: fixtureAccount("coin1_pool_base_ta"),
    poolQuoteTokenAccount: fixtureAccount("coin1_pool_quote_ta"),
    mint: fixtureAccount("coin1_mint"),
  };
  const c1 = readMarketCap({ mint: COIN1, bondingCurve: curve1, pool: poolAccounts });
  assert.equal(c1.source, "pool");
  assert.equal(c1.graduated, true);
  assert.throws(() => readMarketCap({ mint: COIN1, bondingCurve: curve1 }), code("PoolRequired"));
  // curve gone (or not pump-owned) with a cached pool: read the pool directly
  const c1b = readMarketCap({
    mint: COIN1,
    bondingCurve: null,
    pool: poolAccounts,
    cachedPool: coinAddresses(COIN1).pool,
  });
  assert.equal(c1b.mcapLamports, c1.mcapLamports);
  // F5: with nothing cached, only a gone curve (missing, or System-owned with no data) derives the canonical pool,
  // and that read is the one the program caches
  const gone = readMarketCap({ mint: COIN1, bondingCurve: null, pool: poolAccounts });
  assert.equal(gone.mcapLamports, c1.mcapLamports);
  assert.equal(gone.cachePool, coinAddresses(COIN1).pool);
  assert.equal(c1b.cachePool, null, "already cached: nothing to cache");
  const sysEmpty = { ...curve1, owner: "11111111111111111111111111111111", data: new Uint8Array(0) };
  assert.equal(readMarketCap({ mint: COIN1, bondingCurve: sysEmpty, pool: poolAccounts }).source, "pool");
  // ...anything else without a cache fails closed (a System account with data, another owner, a short pump account)
  for (const odd of [
    { ...sysEmpty, data: new Uint8Array(8) },
    { ...curve1, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { ...curve1, data: curve1.data.subarray(0, 100) },
  ]) {
    assert.throws(() => readMarketCap({ mint: COIN1, bondingCurve: odd, pool: poolAccounts }), code("CurveMismatch"));
  }
  // tier B11: with a cached pool, a pump-owned short or zeroed curve reads the pool
  const zeroed = { ...curve1, data: new Uint8Array(curve1.data.length) };
  const cachedPool = coinAddresses(COIN1).pool;
  assert.equal(readMarketCap({ mint: COIN1, bondingCurve: zeroed, pool: poolAccounts, cachedPool }).source, "pool");
  assert.equal(readMarketCap({ mint: COIN1, bondingCurve: { ...curve1, data: curve1.data.subarray(0, 60) }, pool: poolAccounts, cachedPool }).source, "pool");
  // the pool must be the cached one
  assert.throws(
    () => readMarketCap({ mint: COIN1, bondingCurve: null, pool: poolAccounts, cachedPool: coinAddresses(COIN2).pool }),
    code("PoolMismatch")
  );
  // substituted accounts fail like the program's constraints
  assert.throws(
    () => readMarketCap({ mint: COIN1, bondingCurve: { ...curve1, address: fixtureAccount("coin2_curve").address } }),
    code("CurveMismatch")
  );
  assert.throws(
    () =>
      readCurveAccount(COIN2, {
        ...fixtureAccount("coin2_curve"),
        data: fixtureAccount("coin2_curve").data.subarray(0, 124),
      }),
    code("CurveMismatch")
  );
  assert.throws(
    () =>
      readPool(COIN1, {
        ...poolAccounts,
        poolQuoteTokenAccount: { ...poolAccounts.poolQuoteTokenAccount, owner: TOKEN_2022_PROGRAM_ID.toBase58() },
      }),
    code("PoolMismatch")
  );
  assert.throws(
    () => readPool(COIN1, { ...poolAccounts, mint: { ...poolAccounts.mint, address: COIN2 } }),
    code("PoolMismatch")
  );
});

test("register_card coin checks: both devnet coins pass; mayhem / cashback / quote / fee / holder flags fail", () => {
  for (const [mint, name] of [
    [COIN1, "coin1_curve"],
    [COIN2, "coin2_curve"],
  ]) {
    assert.deepEqual(registerCurveProblems(mint, decodeBondingCurve(fixtureAccount(name).data)), []);
  }
  const base = decodeBondingCurve(fixtureAccount("coin2_curve").data);
  const bad = [
    { ...base, isMayhemMode: true },
    { ...base, isCashbackCoin: true },
    { ...base, quoteMint: TOKEN_PROGRAM_ID },
    { ...base, creatorFeeBps: 30n },
    { ...base, isHolderReward: true },
  ];
  for (const c of bad)
    assert.deepEqual(
      registerCurveProblems(COIN2, c).map((p) => p.code),
      ["UnsupportedCoin"]
    );
  assert.equal(registerCurveProblems(COIN1, base)[0].code, "CreatorMismatch");
});

test("token account and mint decoders agree with spl-token; TokenMetadata of both coins parses (U11 mirror)", () => {
  for (const name of ["coin1_pool_base_ta", "coin1_pool_quote_ta"]) {
    const f = fixtureAccount(name);
    const mine = decodeTokenAccount(f.data);
    const spl = unpackAccount(new PublicKey(f.address), fixtureAccountInfo(name), new PublicKey(f.owner));
    assert.equal(mine.mint, spl.mint.toBase58());
    assert.equal(mine.owner, spl.owner.toBase58());
    assert.equal(mine.amount, spl.amount);
    assert.equal(mine.isNative !== null, spl.isNative);
    assert.equal(mine.closeAuthority, spl.closeAuthority?.toBase58() ?? null);
  }
  for (const name of ["coin1_mint", "coin2_mint"]) {
    const f = fixtureAccount(name);
    const mine = decodeMint(f.data);
    const spl = unpackMint(new PublicKey(f.address), fixtureAccountInfo(name), TOKEN_2022_PROGRAM_ID);
    assert.equal(mine.supply, spl.supply);
    assert.equal(mine.decimals, 6);
    assert.equal(mine.mintAuthority, null);
    assert.equal(mine.freezeAuthority, null);
    const md = mintTokenMetadata(f.data)!;
    assert.equal(md.mint, f.address);
    assert.equal(md.updateAuthority, null, "create_v2 metadata is immutable");
    assert.equal(mintMetadataPointer(f.data)!.metadataAddress, f.address);
  }
  const m1 = mintTokenMetadata(fixtureAccount("coin1_mint").data)!;
  assert.equal(m1.name, "MintDex Test");
  assert.equal(m1.symbol, "MDXT");
  assert.equal(m1.uri.length, 36);
  assert.equal(mintTokenMetadata(fixtureAccount("coin2_mint").data)!.uri.length, 200);
});

test("U6 mirror: Pyth PriceUpdateV2 decode, min(price, ema), staleness and confidence gates", () => {
  const acc = fixtureAccount("pyth_sol_usd");
  const u = decodePriceUpdateV2(acc.data);
  assert.equal(u.expo, -8);
  assert.equal(u.verificationLevel, 1);
  assert.ok(u.price > 50n * 10n ** 8n && u.price < 500n * 10n ** 8n, "SOL between $50 and $500");
  assert.ok(u.emaPrice > 0n);
  const fresh = u.publishTime + 10n;
  const usd = pythSolUsdE6(
    { ...acc, address: acc.address },
    { expectedAccount: PYTH_SOL_USD_PRICE_ACCOUNT, nowUnix: fresh, maxPriceAgeSecs: 60, maxConfBps: 200 }
  );
  const p0 = u.price < u.emaPrice ? u.price : u.emaPrice;
  assert.equal(usd, p0 / 100n);
  assert.throws(
    () =>
      pythSolUsdE6(acc, {
        expectedAccount: PYTH_SOL_USD_PRICE_ACCOUNT,
        nowUnix: u.publishTime + 61n,
        maxPriceAgeSecs: 60,
        maxConfBps: 200,
      }),
    code("StalePrice")
  );
  assert.throws(
    () =>
      pythSolUsdE6(acc, {
        expectedAccount: PYTH_SOL_USD_PRICE_ACCOUNT,
        nowUnix: fresh,
        maxPriceAgeSecs: 60,
        maxConfBps: 0,
      }),
    code("PriceTooUncertain")
  );
  assert.throws(
    () =>
      pythSolUsdE6(
        { ...acc, owner: TOKEN_PROGRAM_ID },
        { expectedAccount: PYTH_SOL_USD_PRICE_ACCOUNT, nowUnix: fresh, maxPriceAgeSecs: 60, maxConfBps: 200 }
      ),
    code("PriceFeedMismatch")
  );
  assert.throws(
    () =>
      pythSolUsdE6(acc, {
        expectedAccount: PYTH_SOL_USD_PRICE_ACCOUNT,
        nowUnix: fresh,
        maxPriceAgeSecs: 0,
        maxConfBps: 200,
      }),
    code("InvalidConfig")
  );
  assert.equal(pythToUsdE6(11_801_000_000n, -8), 118_010_000n);
  assert.equal(pythToUsdE6(118n, 0), 118_000_000n);
  assert.equal(pythToUsdE6(118_000_000_000_000n, -12), 118_000_000n);
});

test("address lookup table decoder agrees with web3.js", () => {
  const f = fixtureAccount("shared_alt");
  const mine = decodeAddressLookupTable(f.data);
  const web3 = AddressLookupTableAccount.deserialize(f.data);
  assert.deepEqual(
    mine.addresses,
    web3.addresses.map((k) => k.toBase58())
  );
  assert.equal(mine.authority, web3.authority?.toBase58() ?? null);
  assert.equal(mine.isActive, true);
  assert.equal(mine.addresses.length, 27);
});
