// C8: a doctored transaction is stopped before the wallet opens (refs/chain/m3-contract.md §7.3, §9.1).
// Each case gives the client a Worker build: the honest one passes the SDK verifier and the §7.3 checks; an extra
// transfer, a foreign program, a changed amount, a lowered seller floor, a raised fee cap or a lookup-table index ≥ 38
// fails, and through the real flows the mock wallet's sign count stays at zero and nothing is submitted.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  acceptBidIx,
  bondingCurvePda,
  cardStatePda,
  cardVaultPda,
  decodePumpGlobal,
  effectiveFeeBps,
  fromBase64,
  listCardIx,
  placeBidIx,
  pumpBuy,
  systemTransfer,
  type Instruction,
} from "@mintdex/chain-sdk";
import { slippageCeil } from "@mintdex/chain-sdk/quote";
import type { ApiTxBuildResponse, ApiTxKind, ApiTxParamsMap, ApiTxRequestMap } from "@mintdex/chain-sdk/api";

import * as client from "../../src/lib/chain/client";
import { mintdexAltList } from "../../src/lib/chain/verify";
import { ChainClientError } from "../../src/lib/chain/errors";
import { readCurveContext } from "../../src/lib/chain/trust";
import { quoteCurveBuyExactSol } from "@mintdex/chain-sdk/quote";
import {
  addr,
  ALT_LIST,
  b64,
  buildTx,
  FIXTURES,
  installNet,
  installWallet,
  keypair,
  ok,
  resetWallet,
  summary,
  type FakeNet,
  type Kp,
} from "./helpers";

const TREASURY = "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj";
const ONE_SOL = 1_000_000_000n;

function build<K extends ApiTxKind>(kind: K, wallet: string, ixs: Instruction[], params: ApiTxParamsMap[K], o: Parameters<typeof buildTx>[2] = {}): ApiTxBuildResponse<K> {
  return {
    intentId: "intent1234567890abcdef",
    kind,
    tx: b64(buildTx(wallet, ixs, o)),
    alt: "A",
    lastValidBlockHeight: 1_000,
    expiresAt: Math.floor(Date.now() / 1000) + 90,
    cuLimit: 300_000,
    cuPriceMicroLamports: 10_000,
    simulation: { unitsConsumed: 100_000, logsTail: [] },
    params,
    summary: summary(kind, wallet, ONE_SOL),
  };
}

let user: Kp;
let mint: string;
let attacker: string;
let net: FakeNet;

beforeEach(() => {
  user = keypair();
  mint = addr();
  attacker = addr();
  net = installNet({});
});
afterEach(resetWallet);

// ---------------------------------------------------------------- bids (exact intent)

describe("bid", () => {
  const amount = 50_000_000n;
  const req = (): ApiTxRequestMap["bid"] => ({ wallet: user.address, mint, amountLamports: amount.toString() });
  const params = (a = amount): ApiTxParamsMap["bid"] => ({ previousLamports: "0", amountLamports: a.toString() });

  test("the honest build passes", async () => {
    const out = await client.verifyTxBuild("bid", req(), build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount })], params()));
    expect(out.errors).toEqual([]);
    expect(out.mismatches).toEqual([]);
    expect(out.ok).toBe(true);
  });

  test("an extra SystemProgram transfer fails", async () => {
    const ixs = [placeBidIx({ bidder: user.address, mint, amount }), systemTransfer(user.address, attacker, 1n)];
    const out = await client.verifyTxBuild("bid", req(), build("bid", user.address, ixs, params()));
    expect(out.ok).toBe(false);
  });

  test("a foreign program fails", async () => {
    const foreign: Instruction = { programId: addr(), accounts: [], data: Uint8Array.of(1, 2, 3) };
    const out = await client.verifyTxBuild("bid", req(), build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount }), foreign], params()));
    expect(out.ok).toBe(false);
    expect(out.errors.join(" ")).toContain("not allowed");
  });

  test("a changed amount fails (even when the params claim it)", async () => {
    const out1 = await client.verifyTxBuild("bid", req(), build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount: amount * 2n })], params()));
    expect(out1.ok).toBe(false);
    const out2 = await client.verifyTxBuild("bid", req(), build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount: amount * 2n })], params(amount * 2n)));
    expect(out2.ok).toBe(false);
  });

  test("a lookup-table index past the 43-entry layout fails, and a foreign entry at 38 never verifies", async () => {
    // The client resolves the fixed cluster layout (the 38, then the 4 collection PDAs and the Metaplex program the fix
    // pack appends). A table that holds the card account at index 38 instead of the collection authority resolves to the
    // collection authority in the verifier, so the rebuilt instruction differs and the build is refused.
    const foreign = [...ALT_LIST.slice(0, 38), cardStatePda(mint)];
    const out = await client.verifyTxBuild(
      "bid",
      req(),
      build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount })], params(), { altEntries: foreign }),
    );
    expect(out.ok).toBe(false);
    // and an entry past the layout cannot be resolved at all
    const longer = [...mintdexAltList(), cardStatePda(mint)];
    const out2 = await client.verifyTxBuild(
      "bid",
      req(),
      build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount })], params(), { altEntries: longer }),
    );
    expect(out2.ok).toBe(false);
    expect(out2.errors.join(" ")).toContain("lookup index 43 out of range");
  });

  test("the fee payer must be the wallet", async () => {
    const other = keypair();
    const out = await client.verifyTxBuild("bid", req(), build("bid", other.address, [placeBidIx({ bidder: other.address, mint, amount })], params()));
    expect(out.ok).toBe(false);
  });
});

// ---------------------------------------------------------------- list (seller floor) and accept (fee cap)

describe("list", () => {
  const price = 40_000_000n;
  const floor = 1_000n;
  const req = (): ApiTxRequestMap["list"] => ({
    wallet: user.address,
    mint,
    priceLamports: price.toString(),
    expiresAt: 0,
    voidOnEvolve: true,
    minFeesToSellerLamports: floor.toString(),
    extraWsolAccounts: [],
  });
  const ix = (f: bigint, flags = 1) => listCardIx({ seller: user.address, mint, price, expiresAt: 0n, flags, minFeesToSeller: f });

  test("the honest build passes, and the Worker may raise the floor", async () => {
    expect((await client.verifyTxBuild("list", req(), build("list", user.address, [ix(floor)], { minFeesToSeller: floor.toString(), flags: 1, reprice: false }))).ok).toBe(true);
    expect((await client.verifyTxBuild("list", req(), build("list", user.address, [ix(floor * 2n)], { minFeesToSeller: (floor * 2n).toString(), flags: 1, reprice: false }))).ok).toBe(true);
  });

  test("a lowered seller floor fails", async () => {
    const out = await client.verifyTxBuild("list", req(), build("list", user.address, [ix(floor / 2n)], { minFeesToSeller: (floor / 2n).toString(), flags: 1, reprice: false }));
    expect(out.ok).toBe(false);
    expect(out.mismatches.join(" ")).toContain("fee floor");
  });

  test("a dropped void-on-evolve flag fails", async () => {
    const out = await client.verifyTxBuild("list", req(), build("list", user.address, [ix(floor, 0)], { minFeesToSeller: floor.toString(), flags: 0, reprice: false }));
    expect(out.ok).toBe(false);
  });
});

describe("accept", () => {
  const bid = 60_000_000n;
  const bidder = () => addr();
  test("the honest build passes; a raised fee cap fails", async () => {
    const b = bidder();
    const launcher = addr();
    const req: ApiTxRequestMap["accept"] = {
      wallet: user.address,
      mint,
      bidder: b,
      minAmountLamports: bid.toString(),
      minFeesToSellerLamports: "0",
      extraWsolAccounts: [],
    };
    const cap = effectiveFeeBps(250, 500, false);
    const params = (bps: number): ApiTxParamsMap["accept"] => ({
      launcher,
      treasury: TREASURY,
      minAmountLamports: bid.toString(),
      maxTotalFeeBps: bps,
      minFeesToSeller: "0",
      extraWsolAccounts: [],
      escrowPath: false,
    });
    const ix = (bps: number) =>
      acceptBidIx({ seller: user.address, bidder: b, mint, launcher, treasury: TREASURY, minAmount: bid, maxTotalFeeBps: bps, minFeesToSeller: 0n, extraWsolAccounts: [] });
    expect((await client.verifyTxBuild("accept", req, build("accept", user.address, [ix(cap)], params(cap)))).ok).toBe(true);
    const raised = await client.verifyTxBuild("accept", req, build("accept", user.address, [ix(cap + 500)], params(cap + 500)));
    expect(raised.ok).toBe(false);
    const cheaper = await client.verifyTxBuild("accept", req, build("accept", user.address, [ix(cap)], { ...params(cap), minAmountLamports: (bid / 2n).toString() }));
    expect(cheaper.ok).toBe(false);
  });
});

// ---------------------------------------------------------------- curve buy (slippage bounds from the user)

describe("buy on the curve", () => {
  const coin = FIXTURES.coin2Mint.pubkey;
  const sol = 100_000_000n;
  const bps = 500;
  test("the curve fixture is the coin's bonding curve", () => {
    expect(bondingCurvePda(coin)).toBe(FIXTURES.coin2Curve.pubkey);
  });

  async function honest() {
    const live = await readCurveContext(coin);
    if (!live?.fees) throw new Error("curve fixture unreadable");
    return quoteCurveBuyExactSol(live.reserves, live.fees, sol).tokens;
  }
  const g = decodePumpGlobal(fromBase64(FIXTURES.pumpGlobal.account.data));
  const ix = (amount: bigint, maxSolCost: bigint) =>
    pumpBuy({
      mint: coin,
      user: user.address,
      creator: cardVaultPda(coin),
      feeRecipient: g.allFeeRecipients[0],
      buybackFeeRecipient: g.buybackFeeRecipients[0],
      amount,
      maxSolCost,
    });
  const req = (): ApiTxRequestMap["buy"] => ({ wallet: user.address, mint: coin, solLamports: sol.toString(), slippageBps: bps });
  const params = (amount: bigint, max: bigint): ApiTxParamsMap["buy"] => ({
    quote: {
      venue: "curve",
      args: { ix: "pump_buy", amount: amount.toString(), maxSolCost: max.toString() },
      expectedTokens: amount.toString(),
      expectedSol: sol.toString(),
      feeLamports: "0",
      creatorFeeLamports: "0",
      priceImpactBps: 0,
      mcapAfterLamports: "0",
    },
  });

  test("the honest build passes", async () => {
    const tokens = await honest();
    const max = slippageCeil(sol, bps);
    const out = await client.verifyTxBuild("buy", req(), build("buy", user.address, [ix(tokens, max)], params(tokens, max)));
    expect(out.errors).toEqual([]);
    expect(out.ok).toBe(true);
  });

  test("a raised SOL ceiling fails", async () => {
    const tokens = await honest();
    const max = slippageCeil(sol, bps) * 3n;
    expect((await client.verifyTxBuild("buy", req(), build("buy", user.address, [ix(tokens, max)], params(tokens, max)))).ok).toBe(false);
  });

  test("far fewer tokens than the client's own quote fails", async () => {
    const tokens = (await honest()) / 2n;
    const max = slippageCeil(sol, bps);
    expect((await client.verifyTxBuild("buy", req(), build("buy", user.address, [ix(tokens, max)], params(tokens, max)))).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- through the flows: the wallet never opens

describe("flows stop doctored builds before the wallet opens (C8)", () => {
  const amount = 50_000_000n;
  const doctored: Record<string, () => Instruction[]> = {
    "extra transfer": () => [placeBidIx({ bidder: user.address, mint, amount }), systemTransfer(user.address, attacker, 1_000n)],
    "foreign program": () => [placeBidIx({ bidder: user.address, mint, amount }), { programId: attacker, accounts: [], data: Uint8Array.of(9) }],
    "changed amount": () => [placeBidIx({ bidder: user.address, mint, amount: amount + 1n })],
  };
  for (const [name, ixs] of Object.entries(doctored)) {
    test(name, async () => {
      net = installNet({
        api: (method, path) =>
          method === "POST" && path === "/tx/bid"
            ? ok(build("bid", user.address, ixs(), { previousLamports: "0", amountLamports: amount.toString() }))
            : undefined,
      });
      const w = installWallet(user);
      const steps: string[] = [];
      const err = await client.placeBid({ mint, amountLamports: amount }, (p) => steps.push(p.step)).catch((e) => e);
      expect(err).toBeInstanceOf(ChainClientError);
      expect((err as ChainClientError).code).toBe("VERIFY_FAILED");
      expect(w.signs).toBe(0);
      expect(steps).toEqual(["building", "verifying"]);
      expect(net.apiCalls("/tx/submit")).toHaveLength(0);
      expect(net.rpcCalls("sendTransaction")).toHaveLength(0);
    });
  }

  test("the honest build is signed once, submitted and confirmed", async () => {
    net = installNet({
      api: (method, path) => {
        if (method === "POST" && path === "/tx/bid")
          return ok(build("bid", user.address, [placeBidIx({ bidder: user.address, mint, amount })], { previousLamports: "0", amountLamports: amount.toString() }));
        if (method === "POST" && path === "/tx/submit") return ok({ intentId: "intent1234567890abcdef", signature: "sig1", status: "submitted" });
        if (method === "GET" && path.startsWith("/tx/status/"))
          return ok({ intentId: "intent1234567890abcdef", signature: "sig1", status: "confirmed", err: null, slot: 9 });
        return undefined;
      },
    });
    const w = installWallet(user);
    const steps: string[] = [];
    const r = await client.placeBid({ mint, amountLamports: amount }, (p) => steps.push(p.step));
    expect(r.signature).toBe("sig1");
    expect(r.slot).toBe(9);
    expect(w.signs).toBe(1);
    expect(steps).toEqual(["building", "verifying", "signing", "submitting", "confirming", "confirmed"]);
    expect(net.apiCalls("/tx/submit")).toHaveLength(1);
  });

  test("a wallet account off devnet is refused before anything is built", async () => {
    installWallet(user, { devnet: false });
    const err = await client.placeBid({ mint, amountLamports: amount }).catch((e) => e);
    expect((err as ChainClientError).code).toBe("WRONG_NETWORK");
    expect(net.apiCalls(/\/tx\//)).toHaveLength(0);
  });
});
