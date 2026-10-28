// ATTACK TESTS, acceptance C8 (doctored transactions blocked before the wallet opens), C2 (launch tamper) and the
// client half of C14 (only ALT A / ALT B are trusted). refs/chain/devnet-plan.md M3, refs/chain/m3-contract.md §7.1,
// §7.3. Run: cd app && ~/.bun/bin/bun test tests/chain
//
// The chain API is treated as hostile. Each case answers a real client flow (launchCoin, buy, sell, withdrawFees,
// buyNow, placeBid) with a build that differs from what the user asked for in one detail: an extra system transfer,
// a foreign program, a changed amount, a swapped account, an extra Token instruction that hands the attacker the
// user's tokens. The mock wallet counts signTransaction calls: it must stay at 0, and nothing may reach
// /launch/finalize, /tx/submit or the public RPC's sendTransaction. A second group plays a wallet that rewrites the
// transaction after the client verified it: only compute-budget changes inside the limits may go on.
// Positive controls run first in each group so a broken harness cannot pass the negatives by refusing everything.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  acceptBidIx,
  associatedTokenAddress,
  buyNowIx,
  cancelBidIx,
  cardTokenAccount,
  cardVaultPda,
  closeTokenAccount,
  coinUri,
  compileV0Message,
  createAtaIdempotent,
  decodeFeeConfig,
  decodePumpGlobal,
  decodeTransaction,
  effectiveFeeBps,
  fromBase64,
  listCardIx,
  mintdexAltAddresses,
  placeBidIx,
  pumpBuy,
  pumpBuyExactSolIn,
  pumpCreateV2,
  pumpSell,
  registerCardIx,
  resolveTransaction,
  serializeTransaction,
  setComputeUnitLimit,
  setComputeUnitPrice,
  systemTransfer,
  TOKEN_2022_PROGRAM_ID,
  withdrawFeesIx,
  type Instruction,
} from "@mintdex/chain-sdk";
import { curveFeeMarketCap, feesForMarketCap, quoteCurveBuyExactSol, quoteCurveSell, slippageCeil, slippageFloor } from "@mintdex/chain-sdk/quote";
import { buildSiwsMessage, type ApiLaunchPrepareResponse, type ApiTxBuildResponse, type ApiTxKind, type ApiTxParamsMap } from "@mintdex/chain-sdk/api";

import * as client from "../../src/lib/chain/client";
import { TRUST_ANCHORS } from "../../src/lib/chain/env";
import { ChainClientError } from "../../src/lib/chain/errors";
import { readCurveContext } from "../../src/lib/chain/trust";
import { forgetWalletModes } from "../../src/lib/chain/wallet-modes";
import {
  addr,
  b64,
  baseAccounts,
  BLOCKHASH,
  clearStorage,
  FIXTURES,
  installNet,
  installWallet,
  keypair,
  ok,
  resetWallet,
  signAs,
  summary,
  usedVanityMint,
  type ApiReply,
  type FakeNet,
  type Kp,
} from "./helpers";

const TREASURY = TRUST_ANCHORS.altTreasury;
const ALT_LIST = mintdexAltAddresses({ treasury: TRUST_ANCHORS.altTreasury });
const ONE_SOL = 1_000_000_000n;
const PUMP_GLOBAL = decodePumpGlobal(fromBase64(FIXTURES.pumpGlobal.account.data));
const FEE = PUMP_GLOBAL.allFeeRecipients[0];
const BUYBACK = PUMP_GLOBAL.buybackFeeRecipients[0];

let user: Kp;
let attacker: string;
let net: FakeNet;

beforeEach(() => {
  clearStorage();
  user = keypair();
  attacker = addr();
});
afterEach(() => {
  resetWallet();
  forgetWalletModes();
});

/** v0 bytes for `ixs` (two compute budget ixs first) through `alt` (default ALT A), no signatures. */
function compile(payer: string, ixs: Instruction[], o: { alt?: string | null; cuPrice?: bigint; cuLimit?: number; blockhash?: string; noCu?: boolean } = {}): Uint8Array {
  const all = o.noCu ? ixs : [setComputeUnitLimit(o.cuLimit ?? 400_000), setComputeUnitPrice(o.cuPrice ?? 10_000n), ...ixs];
  const alt = o.alt === undefined ? TRUST_ANCHORS.altA : o.alt;
  const m = compileV0Message({
    payer,
    instructions: all,
    recentBlockhash: o.blockhash ?? BLOCKHASH,
    lookupTables: alt ? [{ address: alt, addresses: ALT_LIST }] : [],
  });
  return serializeTransaction(m.bytes, m.signers.map(() => null));
}

/** The instructions of `tx` (resolved through the MintDex ALT list) and its blockhash. */
function partsOf(tx: Uint8Array) {
  const d = decodeTransaction(tx);
  const rt = resolveTransaction(d, { [TRUST_ANCHORS.altA]: ALT_LIST, [TRUST_ANCHORS.altB]: ALT_LIST });
  return { d, ixs: rt.instructions, blockhash: d.message.recentBlockhash };
}

function expectBlocked(err: unknown, w: { signs: number }) {
  expect(err).toBeInstanceOf(ChainClientError);
  expect((err as ChainClientError).code).toBe("VERIFY_FAILED");
  expect(w.signs).toBe(0);
  expect(net.apiCalls("/tx/submit")).toHaveLength(0);
  expect(net.apiCalls("/launch/finalize")).toHaveLength(0);
  expect(net.rpcCalls("sendTransaction")).toHaveLength(0);
}

// ====================================================================================== launch (C2, C8)

const mintKp = usedVanityMint();
const NAME = "Attack Coin";
const SYMBOL = "ATK";
const DEV_BUY = 50_000_000n;
const BPS = 500;

/** What the client itself quotes for the dev buy on a fresh curve (pump Global + FeeConfig fixtures). */
function freshQuote(devBuy: bigint): bigint {
  const fresh = {
    virtualTokenReserves: PUMP_GLOBAL.initialVirtualTokenReserves,
    virtualSolReserves: PUMP_GLOBAL.initialVirtualSolReserves,
    realTokenReserves: PUMP_GLOBAL.initialRealTokenReserves,
    realSolReserves: 0n,
    tokenTotalSupply: PUMP_GLOBAL.tokenTotalSupply,
    complete: false,
  };
  const fees = feesForMarketCap(decodeFeeConfig(fromBase64(FIXTURES.pumpFeeConfig.account.data)), curveFeeMarketCap(fresh));
  return quoteCurveBuyExactSol(fresh, fees, devBuy).tokens;
}

interface LaunchKnobs {
  creator?: string;
  launcher?: string;
  treasury?: string;
  name?: string;
  uri?: string;
  maxSolCost?: bigint;
  amount?: bigint;
  feeRecipient?: string;
  associatedUser?: string;
  exactSolIn?: boolean;
  extra?: (mint: string) => Instruction[];
  before?: (mint: string) => Instruction[];
  devBuy?: boolean;
}

/** The launch instructions the Worker would build, with one knob turned. */
function launchIxs(mint: string, k: LaunchKnobs = {}): Instruction[] {
  const vault = cardVaultPda(mint);
  const ixs: Instruction[] = [
    ...(k.before?.(mint) ?? []),
    pumpCreateV2({ mint, user: user.address, name: k.name ?? NAME, symbol: SYMBOL, uri: k.uri ?? coinUri(mint), creator: k.creator ?? vault }),
    registerCardIx({ launcher: k.launcher ?? user.address, mint, treasury: k.treasury ?? TREASURY }),
  ];
  if (k.devBuy !== false) {
    const ata = associatedTokenAddress(user.address, mint, TOKEN_2022_PROGRAM_ID);
    ixs.push(createAtaIdempotent(user.address, ata, user.address, mint, TOKEN_2022_PROGRAM_ID));
    const maxSolCost = k.maxSolCost ?? slippageCeil(DEV_BUY, BPS);
    ixs.push(
      k.exactSolIn
        ? pumpBuyExactSolIn({ mint, user: user.address, creator: vault, feeRecipient: FEE, buybackFeeRecipient: BUYBACK, spendableSolIn: maxSolCost, minTokensOut: 0n })
        : pumpBuy({
            mint,
            user: user.address,
            creator: vault,
            feeRecipient: k.feeRecipient ?? FEE,
            buybackFeeRecipient: BUYBACK,
            amount: k.amount ?? freshQuote(DEV_BUY),
            maxSolCost,
            associatedUser: k.associatedUser,
          }),
    );
  }
  ixs.push(...(k.extra?.(mint) ?? []));
  return ixs;
}

interface PrepKnobs {
  ixs?: (mint: string) => Instruction[];
  presign?: "mint" | "none" | "wrong-key";
  coinUri?: (mint: string) => string;
  devBuyField?: boolean;
  mint?: Kp;
}

function prepareResponse(k: PrepKnobs = {}): ApiLaunchPrepareResponse {
  const mint = k.mint ?? mintKp!;
  const unsigned = compile(user.address, (k.ixs ?? ((m) => launchIxs(m)))(mint.address));
  const presign = k.presign ?? "mint";
  const tx = presign === "mint" ? signAs(unsigned, mint) : presign === "wrong-key" ? withMintSlot(unsigned, keypair().sign(decodeTransaction(unsigned).message.bytes)) : unsigned;
  return {
    intentId: "launchattack0123456789",
    mint: mint.address,
    mode: "server_first",
    tx: b64(tx),
    alt: "A",
    lastValidBlockHeight: 1_000,
    expiresAt: Math.floor(Date.now() / 1000) + 90,
    coinUri: k.coinUri ? k.coinUri(mint.address) : coinUri(mint.address),
    treasury: TREASURY,
    devBuy: k.devBuyField === false ? null : { tokens: freshQuote(DEV_BUY).toString(), maxSolCost: slippageCeil(DEV_BUY, BPS).toString() },
    summary: summary("launch", user.address, ONE_SOL),
  };
}

/** Puts `sig` in signature slot 1 (the mint's slot in a launch). */
function withMintSlot(tx: Uint8Array, sig: Uint8Array): Uint8Array {
  const out = Uint8Array.from(tx);
  out.set(sig, 1 + 64);
  return out;
}

/** The Worker: SIWS, media, the given prepare answer, finalize (recorded), status confirmed and indexed. */
function serveLaunch(prep: () => ApiLaunchPrepareResponse) {
  net = installNet({
    accounts: baseAccounts({ vanity_modulus: 1n, vanity_residue: 0n }),
    api: (method, p): ApiReply | undefined => {
      const now = Date.now();
      if (p === "/auth/nonce")
        return ok({
          nonce: "n".repeat(32),
          message: buildSiwsMessage({
            domain: "mintdex.fun",
            address: user.address,
            uri: "https://mintdex.fun",
            nonce: "n".repeat(32),
            issuedAt: new Date(now).toISOString(),
            expirationTime: new Date(now + 600_000).toISOString(),
          }),
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 600_000).toISOString(),
        });
      if (p === "/auth/verify") return ok({ session: { token: "t".repeat(43), address: user.address, handle: null, expiresAt: new Date(now + 3_600_000).toISOString() } });
      if (p === "/media") return ok({ image: { key: "up-0123456789abcdef.png", url: "https://mintdex.fun/img/up-0123456789abcdef.png" }, bytes: 4, contentType: "image/png", sha256: "0".repeat(64) });
      if (p === "/launch/prepare") return ok(prep());
      if (p === "/launch/finalize") return ok({ intentId: "launchattack0123456789", mint: mintKp!.address, signature: "launchSig", status: "submitted" });
      if (method === "GET" && p.startsWith("/launch/"))
        return ok({ intentId: p.slice(8), mint: mintKp!.address, status: "confirmed", signature: "launchSig", error: null, coinIndexed: true });
      return undefined;
    },
  });
}

const launchInput = (devBuy = DEV_BUY) => ({
  name: NAME,
  symbol: SYMBOL,
  description: "",
  image: new Blob([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], { type: "image/png" }),
  devBuyLamports: devBuy,
  slippageBps: BPS,
});

const LAUNCH_CASES: Record<string, PrepKnobs | (() => PrepKnobs)> = {
  "extra SystemProgram transfer from the wallet to the attacker": { ixs: (m) => launchIxs(m, { extra: () => [systemTransfer(user.address, attacker, 1_000_000n)] }) },
  "extra transfer hidden before create_v2": { ixs: (m) => launchIxs(m, { before: () => [systemTransfer(user.address, attacker, 1n)] }) },
  "foreign program instruction": () => ({ ixs: (m) => launchIxs(m, { extra: () => [{ programId: addr(), accounts: [], data: Uint8Array.of(1) }] }) }),
  "dev buy max_sol_cost above the typed amount plus slippage": { ixs: (m) => launchIxs(m, { maxSolCost: slippageCeil(DEV_BUY, BPS) * 4n }) },
  "dev buy for far fewer tokens than the client's own quote": { ixs: (m) => launchIxs(m, { amount: freshQuote(DEV_BUY) / 3n }) },
  "dev buy replaced by buy_exact_sol_in with no token minimum": { ixs: (m) => launchIxs(m, { exactSolIn: true }) },
  "swapped account: register_card launcher is the attacker (card NFT to the attacker)": () => ({ ixs: (m) => launchIxs(m, { launcher: attacker }) }),
  "swapped account: create_v2 creator is the attacker (creator fees to the attacker)": () => ({ ixs: (m) => launchIxs(m, { creator: attacker }) }),
  "swapped account: register_card treasury is the attacker": () => ({ ixs: (m) => launchIxs(m, { treasury: attacker }) }),
  "swapped account: dev-buy tokens to the attacker's token account": () => ({
    ixs: (m) => launchIxs(m, { associatedUser: associatedTokenAddress(attacker, m, TOKEN_2022_PROGRAM_ID) }),
  }),
  "swapped account: pump fee recipient is the attacker": () => ({ ixs: (m) => launchIxs(m, { feeRecipient: attacker }) }),
  "coin name changed from what the user typed": { ixs: (m) => launchIxs(m, { name: "Rug Pull" }) },
  "metadata URI on another host (bytes and coinUri field both)": {
    ixs: (m) => launchIxs(m, { uri: `https://evil.example/m/${m}.json` }),
    coinUri: (m) => `https://evil.example/m/${m}.json`,
  },
  "coinUri field differs from the one MintDex binds (bytes honest)": { coinUri: (m) => `https://mintdex.fun/m/${m}.json?x=1` },
  "server_first without the mint's presignature": { presign: "none" },
  "server_first with a mint signature from another key": { presign: "wrong-key" },
  "a dev buy the user did not ask for (devBuy 0 typed)": { ixs: (m) => launchIxs(m) },
  "a coin address that does not end in mint": () => ({ mint: keypair() }),
};

describe("launch: doctored prepare answers never reach the wallet (C2, C8)", () => {
  test.skipIf(!mintKp)("positive control: the honest server_first launch with a dev buy is signed once and finalized", async () => {
    serveLaunch(() => prepareResponse());
    const w = installWallet(user);
    const r = await client.launchCoin(launchInput());
    expect(r.mint).toBe(mintKp!.address);
    expect(w.signs).toBe(1);
    expect(net.apiCalls("/launch/finalize")).toHaveLength(1);
  });

  for (const [name, knobs] of Object.entries(LAUNCH_CASES)) {
    test.skipIf(!mintKp)(name, async () => {
      const k = typeof knobs === "function" ? knobs() : knobs;
      serveLaunch(() => prepareResponse(k));
      const w = installWallet(user);
      const devBuy = name.startsWith("a dev buy the user did not ask for") ? 0n : DEV_BUY;
      const err = await client.launchCoin(launchInput(devBuy)).catch((e) => e);
      expectBlocked(err, w);
    });
  }
});

// ---------------------------------------------------------------- wallets that rewrite the launch after verification

/** A wallet rewrite: re-compiles the verified launch with `edit` applied to its instructions. */
const rewriteLaunch =
  (edit: (ixs: Instruction[], mint: string) => Instruction[], o: { blockhash?: string; alt?: string } = {}) =>
  (tx: Uint8Array): Uint8Array => {
    const { ixs, blockhash } = partsOf(tx);
    const mint = mintKp!.address;
    return compile(user.address, edit(ixs, mint), { noCu: true, blockhash: o.blockhash ?? blockhash, alt: o.alt });
  };

describe("launch: a wallet that rewrites the verified transaction (C2 post-sign check)", () => {
  test.skipIf(!mintKp)("positive control: a priority-fee-only rewrite inside the limits goes on to finalize (rewritten bytes)", async () => {
    serveLaunch(() => prepareResponse());
    const w = installWallet(user, { rewrite: rewriteLaunch((ixs) => [ixs[0], setComputeUnitPrice(50_000n), ...ixs.slice(2)]) });
    await client.launchCoin(launchInput());
    expect(w.signs).toBe(1);
    const sent = net.apiCalls("/launch/finalize");
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { tx: string }).tx).not.toBe(prepareResponse().tx);
  });

  const BAD: Record<string, () => (tx: Uint8Array) => Uint8Array> = {
    "wallet appends a transfer to the attacker": () => rewriteLaunch((ixs) => [...ixs, systemTransfer(user.address, attacker, 5_000n)]),
    "wallet raises the dev buy ceiling": () =>
      rewriteLaunch((ixs, m) => [
        ...ixs.slice(0, 5),
        pumpBuy({ mint: m, user: user.address, creator: cardVaultPda(m), feeRecipient: FEE, buybackFeeRecipient: BUYBACK, amount: freshQuote(DEV_BUY), maxSolCost: ONE_SOL }),
      ]),
    "wallet swaps the card's launcher to the attacker": () =>
      rewriteLaunch((ixs, m) => [ixs[0], ixs[1], ixs[2], registerCardIx({ launcher: attacker, mint: m, treasury: TREASURY }), ...ixs.slice(4)]),
    "wallet changes the blockhash": () => rewriteLaunch((ixs) => ixs, { blockhash: "11111111111111111111111111111111" }),
    "wallet appends an unrecorded guard program instruction": () => rewriteLaunch((ixs) => [...ixs, { programId: addr(), accounts: [], data: Uint8Array.of(7) }]),
    "wallet sets a priority fee above the limit": () => rewriteLaunch((ixs) => [setComputeUnitLimit(1_400_000), setComputeUnitPrice(5_000_000n), ...ixs.slice(2)]),
    "wallet compiles through a lookup table that is not ALT A or B": () => rewriteLaunch((ixs) => ixs, { alt: addr() }),
  };
  for (const [name, make] of Object.entries(BAD)) {
    test.skipIf(!mintKp)(`${name}: stopped after signing, never finalized`, async () => {
      serveLaunch(() => prepareResponse());
      const w = installWallet(user, { rewrite: make() });
      const err = await client.launchCoin(launchInput()).catch((e) => e);
      expect(err).toBeInstanceOf(ChainClientError);
      expect((err as ChainClientError).code).toBe("VERIFY_FAILED");
      expect(w.signs).toBe(1);
      expect(net.apiCalls("/launch/finalize")).toHaveLength(0);
      expect(net.rpcCalls("sendTransaction")).toHaveLength(0);
    });
  }
});

// ====================================================================================== trades and market (C8)

const INTENT = "attackintent0123456789";

function txBuild<K extends ApiTxKind>(kind: K, ixsOrTx: Instruction[] | Uint8Array, params: ApiTxParamsMap[K], payer = user.address): ApiTxBuildResponse<K> {
  return {
    intentId: INTENT,
    kind,
    tx: b64(ixsOrTx instanceof Uint8Array ? ixsOrTx : compile(payer, ixsOrTx)),
    alt: "A",
    lastValidBlockHeight: 1_000,
    expiresAt: Math.floor(Date.now() / 1000) + 90,
    cuLimit: 400_000,
    cuPriceMicroLamports: 10_000,
    simulation: { unitsConsumed: 100_000, logsTail: [] },
    params,
    summary: summary(kind, user.address, 5n * ONE_SOL),
  };
}

/** The Worker answers POST /tx/:kind with `build`, accepts submit and confirms (so a positive control can finish). */
function serveTx(kind: ApiTxKind, build: () => ApiTxBuildResponse<ApiTxKind>) {
  net = installNet({
    api: (method, p) => {
      if (method === "POST" && p === `/tx/${kind}`) return ok(build());
      if (method === "POST" && p === "/tx/submit") return ok({ intentId: INTENT, signature: "sig1", status: "submitted" });
      if (method === "GET" && p.startsWith("/tx/status/")) return ok({ intentId: INTENT, signature: "sig1", status: "confirmed", err: null, slot: 3 });
      return undefined;
    },
  });
}

// ---------------------------------------------------------------- curve buy / sell on the recorded devnet coin

const COIN = FIXTURES.coin2Mint.pubkey;
const SOL_IN = 100_000_000n;

async function honestBuyTokens(): Promise<bigint> {
  installNet({});
  const live = await readCurveContext(COIN);
  if (!live?.fees) throw new Error("curve fixture unreadable");
  return quoteCurveBuyExactSol(live.reserves, live.fees, SOL_IN).tokens;
}

function buyIx(tokens: bigint, k: { maxSolCost?: bigint; feeRecipient?: string; creator?: string; associatedUser?: string; user?: string } = {}): Instruction {
  return pumpBuy({
    mint: COIN,
    user: k.user ?? user.address,
    creator: k.creator ?? cardVaultPda(COIN),
    feeRecipient: k.feeRecipient ?? FEE,
    buybackFeeRecipient: BUYBACK,
    amount: tokens,
    maxSolCost: k.maxSolCost ?? slippageCeil(SOL_IN, BPS),
    associatedUser: k.associatedUser,
  });
}

const buyParams = (tokens: bigint): ApiTxParamsMap["buy"] => ({
  quote: {
    venue: "curve",
    args: { ix: "pump_buy", amount: tokens.toString(), maxSolCost: slippageCeil(SOL_IN, BPS).toString() },
    expectedTokens: tokens.toString(),
    expectedSol: SOL_IN.toString(),
    feeLamports: "0",
    creatorFeeLamports: "0",
    priceImpactBps: 0,
    mcapAfterLamports: "0",
  },
});

describe("curve buy: doctored builds never reach the wallet (C8)", () => {
  test("positive control: the honest buy is signed once and submitted", async () => {
    const tokens = await honestBuyTokens();
    serveTx("buy", () => txBuild("buy", [buyIx(tokens)], buyParams(tokens)));
    const w = installWallet(user);
    const r = await client.buy({ mint: COIN, solLamports: SOL_IN, slippageBps: BPS });
    expect(r.signature).toBe("sig1");
    expect(w.signs).toBe(1);
  });

  const userAta = () => associatedTokenAddress(user.address, COIN, TOKEN_2022_PROGRAM_ID);
  const CASES: Record<string, (tokens: bigint) => Instruction[]> = {
    "extra transfer to the attacker": (t) => [buyIx(t), systemTransfer(user.address, attacker, 1_000n)],
    "foreign program": (t) => [buyIx(t), { programId: addr(), accounts: [], data: Uint8Array.of(1) }],
    "SOL ceiling raised above what the user typed": (t) => [buyIx(t, { maxSolCost: SOL_IN * 3n })],
    "far fewer tokens than the client's quote": (t) => [buyIx(t / 2n)],
    "swapped account: tokens delivered to the attacker's token account": (t) => [buyIx(t, { associatedUser: associatedTokenAddress(attacker, COIN, TOKEN_2022_PROGRAM_ID) })],
    "swapped account: fee recipient is the attacker": (t) => [buyIx(t, { feeRecipient: attacker })],
    "swapped account: creator vault of the attacker": (t) => [buyIx(t, { creator: attacker })],
    "buy replaced by buy_exact_sol_in with no token minimum": () => [
      pumpBuyExactSolIn({ mint: COIN, user: user.address, creator: cardVaultPda(COIN), feeRecipient: FEE, buybackFeeRecipient: BUYBACK, spendableSolIn: SOL_IN, minTokensOut: 0n }),
    ],
    "an ATA for the attacker paid by the user before the buy": (t) => [
      createAtaIdempotent(user.address, associatedTokenAddress(attacker, COIN, TOKEN_2022_PROGRAM_ID), attacker, COIN, TOKEN_2022_PROGRAM_ID),
      buyIx(t),
    ],
    "Token-2022 Approve of the user's coin account to the attacker appended": (t) => [
      buyIx(t),
      // SPL Token Approve (tag 4, amount u64): delegate = the attacker, owner = the user
      {
        programId: TOKEN_2022_PROGRAM_ID,
        accounts: [
          { address: userAta(), isSigner: false, isWritable: true },
          { address: attacker, isSigner: false, isWritable: false },
          { address: user.address, isSigner: true, isWritable: false },
        ],
        data: Uint8Array.of(4, 255, 255, 255, 255, 255, 255, 255, 255),
      },
    ],
    "close of the user's coin account to the attacker appended": (t) => [buyIx(t), closeTokenAccount(userAta(), attacker, user.address, TOKEN_2022_PROGRAM_ID)],
  };
  for (const [name, make] of Object.entries(CASES)) {
    test(name, async () => {
      const tokens = await honestBuyTokens();
      serveTx("buy", () => txBuild("buy", make(tokens), buyParams(tokens)));
      const w = installWallet(user);
      const err = await client.buy({ mint: COIN, solLamports: SOL_IN, slippageBps: BPS }).catch((e) => e);
      expectBlocked(err, w);
    });
  }

  test("the fee payer is someone else (the user only co-signs)", async () => {
    const tokens = await honestBuyTokens();
    const other = addr();
    serveTx("buy", () => txBuild("buy", [buyIx(tokens)], buyParams(tokens), other));
    const w = installWallet(user);
    const err = await client.buy({ mint: COIN, solLamports: SOL_IN, slippageBps: BPS }).catch((e) => e);
    expectBlocked(err, w);
  });
});

describe("curve sell: doctored builds never reach the wallet (C8)", () => {
  const AMOUNT = 1_000_000_000_000n;
  async function honestSol(): Promise<bigint> {
    installNet({});
    const live = await readCurveContext(COIN);
    if (!live?.fees) throw new Error("curve fixture unreadable");
    return quoteCurveSell(live.reserves, live.fees, AMOUNT).sol;
  }
  const sellIx = (amount: bigint, minSol: bigint, feeRecipient = FEE) =>
    pumpSell({ mint: COIN, user: user.address, creator: cardVaultPda(COIN), feeRecipient, buybackFeeRecipient: BUYBACK, amount, minSolOutput: minSol });
  const params = (sol: bigint): ApiTxParamsMap["sell"] => ({
    quote: {
      venue: "curve",
      args: { ix: "pump_sell", amount: AMOUNT.toString(), minSolOutput: slippageFloor(sol, BPS).toString() },
      expectedTokens: AMOUNT.toString(),
      expectedSol: sol.toString(),
      feeLamports: "0",
      creatorFeeLamports: "0",
      priceImpactBps: 0,
      mcapAfterLamports: "0",
    },
  });

  test("positive control: the honest sell is signed once", async () => {
    const sol = await honestSol();
    serveTx("sell", () => txBuild("sell", [sellIx(AMOUNT, slippageFloor(sol, BPS))], params(sol)));
    const w = installWallet(user);
    await client.sell({ mint: COIN, tokenAmount: AMOUNT, slippageBps: BPS });
    expect(w.signs).toBe(1);
  });

  const CASES: Record<string, (sol: bigint) => Instruction[]> = {
    "min SOL out lowered to 0": () => [sellIx(AMOUNT, 0n)],
    "sells more tokens than the user typed": (s) => [sellIx(AMOUNT * 10n, slippageFloor(s, BPS))],
    "swapped account: fee recipient is the attacker": (s) => [sellIx(AMOUNT, slippageFloor(s, BPS), attacker)],
    "proceeds then moved to the attacker": (s) => [sellIx(AMOUNT, slippageFloor(s, BPS)), systemTransfer(user.address, attacker, s)],
  };
  for (const [name, make] of Object.entries(CASES)) {
    test(name, async () => {
      const sol = await honestSol();
      serveTx("sell", () => txBuild("sell", make(sol), params(sol)));
      const w = installWallet(user);
      const err = await client.sell({ mint: COIN, tokenAmount: AMOUNT, slippageBps: BPS }).catch((e) => e);
      expectBlocked(err, w);
    });
  }
});

// ---------------------------------------------------------------- MintDex market flows (exact intents)

describe("market: doctored exact-intent builds never reach the wallet (C8)", () => {
  const mint = FIXTURES.coin2Mint.pubkey;

  test("withdraw: the fees paid to the attacker instead of the holder", async () => {
    const own = cardTokenAccount(user.address, mint);
    serveTx("withdraw", () =>
      txBuild("withdraw", [withdrawFeesIx({ holder: attacker, mint, holderCardAccount: own, extraWsolAccounts: [] })], {
        holderCardAccount: own,
        holderMode: "wallet",
        extraWsolAccounts: [],
        fees: { total: "1000", netToHolder: "1000" },
      } as unknown as ApiTxParamsMap["withdraw"]),
    );
    const w = installWallet(user);
    expectBlocked(await client.withdrawFees({ mint }).catch((e) => e), w);
  });

  test("withdraw: the attacker's card account named as the holder account", async () => {
    const theirs = cardTokenAccount(attacker, mint);
    serveTx("withdraw", () =>
      txBuild("withdraw", [withdrawFeesIx({ holder: user.address, mint, holderCardAccount: theirs, extraWsolAccounts: [] })], {
        holderCardAccount: theirs,
        holderMode: "wallet",
        extraWsolAccounts: [],
        fees: { total: "1000", netToHolder: "1000" },
      } as unknown as ApiTxParamsMap["withdraw"]),
    );
    const w = installWallet(user);
    expectBlocked(await client.withdrawFees({ mint }).catch((e) => e), w);
  });

  const PRICE = 40_000_000n;
  const seller = addr();
  const launcher = addr();
  const buyNowParams = (treasury: string): ApiTxParamsMap["buy-now"] => ({
    seller,
    launcher,
    treasury,
    maxTotalFeeBps: effectiveFeeBps(250, 500, false),
    extraWsolAccounts: [],
    cancelOwnBid: false,
  });
  const buyNow = (o: { treasury?: string; price?: bigint; launcherAcc?: string; bps?: number } = {}) =>
    buyNowIx({
      buyer: user.address,
      seller,
      mint,
      launcher: o.launcherAcc ?? launcher,
      treasury: o.treasury ?? TREASURY,
      expectedPrice: o.price ?? PRICE,
      maxTotalFeeBps: o.bps ?? effectiveFeeBps(250, 500, false),
      extraWsolAccounts: [],
    });

  test("positive control: the honest buy-now is signed once", async () => {
    serveTx("buy-now", () => txBuild("buy-now", [buyNow()], buyNowParams(TREASURY)));
    const w = installWallet(user);
    await client.buyNow({ mint, expectedPriceLamports: PRICE, cancelOwnBid: false });
    expect(w.signs).toBe(1);
  });

  const BUY_NOW: Record<string, () => ApiTxBuildResponse<"buy-now">> = {
    "buy-now: treasury swapped to the attacker (params claim it too)": () => txBuild("buy-now", [buyNow({ treasury: attacker })], buyNowParams(attacker)),
    "buy-now: price raised above the one shown": () => txBuild("buy-now", [buyNow({ price: PRICE * 2n })], buyNowParams(TREASURY)),
    "buy-now: an extra transfer to the seller on top": () => txBuild("buy-now", [buyNow(), systemTransfer(user.address, seller, PRICE)], buyNowParams(TREASURY)),
    "buy-now: the user's own bid cancelled although the user said no": () =>
      txBuild("buy-now", [cancelBidIx({ bidder: user.address, mint }), buyNow()], buyNowParams(TREASURY)),
  };
  for (const [name, make] of Object.entries(BUY_NOW)) {
    test(name, async () => {
      serveTx("buy-now", make);
      const w = installWallet(user);
      expectBlocked(await client.buyNow({ mint, expectedPriceLamports: PRICE, cancelOwnBid: false }).catch((e) => e), w);
    });
  }

  test("bid: placed on another coin than the one the user chose", async () => {
    const other = addr();
    serveTx("bid", () => txBuild("bid", [placeBidIx({ bidder: user.address, mint: other, amount: 50_000_000n })], { previousLamports: "0", amountLamports: "50000000" }));
    const w = installWallet(user);
    expectBlocked(await client.placeBid({ mint, amountLamports: 50_000_000n }).catch((e) => e), w);
  });

  test("accept: another bidder swapped in, or a lower minimum (checked before the wallet)", async () => {
    net = installNet({});
    const bidder = addr();
    const req = { wallet: user.address, mint, bidder, minAmountLamports: "60000000", minFeesToSellerLamports: "0", extraWsolAccounts: [] };
    const params: ApiTxParamsMap["accept"] = {
      launcher,
      treasury: TREASURY,
      minAmountLamports: "60000000",
      maxTotalFeeBps: effectiveFeeBps(250, 500, false),
      minFeesToSeller: "0",
      extraWsolAccounts: [],
      escrowPath: false,
    };
    const ix = (b: string, min: bigint) =>
      acceptBidIx({ seller: user.address, bidder: b, mint, launcher, treasury: TREASURY, minAmount: min, maxTotalFeeBps: params.maxTotalFeeBps, minFeesToSeller: 0n, extraWsolAccounts: [] });
    expect((await client.verifyTxBuild("accept", req, txBuild("accept", [ix(bidder, 60_000_000n)], params))).ok).toBe(true);
    expect((await client.verifyTxBuild("accept", req, txBuild("accept", [ix(attacker, 60_000_000n)], params))).ok).toBe(false);
    expect((await client.verifyTxBuild("accept", req, txBuild("accept", [ix(bidder, 1n)], params))).ok).toBe(false);
  });

  test("list: a lower price or a longer expiry than the user chose (checked before the wallet)", async () => {
    net = installNet({});
    const req = { wallet: user.address, mint, priceLamports: "40000000", expiresAt: 0, voidOnEvolve: false, minFeesToSellerLamports: "0", extraWsolAccounts: [] };
    const params: ApiTxParamsMap["list"] = { minFeesToSeller: "0", flags: 0, reprice: false };
    const ix = (price: bigint, expiresAt: bigint) => listCardIx({ seller: user.address, mint, price, expiresAt, flags: 0, minFeesToSeller: 0n });
    expect((await client.verifyTxBuild("list", req, txBuild("list", [ix(40_000_000n, 0n)], params))).ok).toBe(true);
    expect((await client.verifyTxBuild("list", req, txBuild("list", [ix(30_000_000n, 0n)], params))).ok).toBe(false);
    expect((await client.verifyTxBuild("list", req, txBuild("list", [ix(40_000_000n, 99_999_999_999n)], params))).ok).toBe(false);
  });
});

// ====================================================================================== C14, client half

describe("C14 (client): only ALT A and ALT B are trusted", () => {
  const amount = 50_000_000n;
  const mint = FIXTURES.coin2Mint.pubkey;
  const params = { previousLamports: "0", amountLamports: amount.toString() };
  const run = async (alt: string | null) => {
    serveTx("bid", () => txBuild("bid", compile(user.address, [placeBidIx({ bidder: user.address, mint, amount })], { alt }), params));
    const w = installWallet(user);
    const out = await client.placeBid({ mint, amountLamports: amount }).catch((e) => e);
    return { out, w };
  };

  test("a build compiled through ALT B (the Worker's fallback) passes", async () => {
    const { out, w } = await run(TRUST_ANCHORS.altB);
    expect(out.signature).toBe("sig1");
    expect(w.signs).toBe(1);
  });

  test("a build compiled with no lookup table passes", async () => {
    const { out, w } = await run(null);
    expect(out.signature).toBe("sig1");
    expect(w.signs).toBe(1);
  });

  test("a build compiled through another table with the same 38 entries is refused before the wallet", async () => {
    const { out, w } = await run(addr());
    expectBlocked(out, w);
  });
});
