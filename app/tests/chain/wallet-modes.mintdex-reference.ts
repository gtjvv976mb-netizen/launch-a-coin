// Per-wallet launch signing mode (refs/chain/m3-contract.md §7.2): server_first by default; a WALLET_REWROTE_TX
// retries ONCE in wallet_first, and wallet_first is remembered for that wallet only after a wallet_first launch
// succeeded. A WALLET_REWROTE_TX in wallet_first ends the attempt: no loop, no stored mode.
// Runs the real launchCoin (SIWS sign-in, upload, prepare, verify, sign, finalize, status) against the fake API.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildSiwsMessage, type ApiLaunchPrepareResponse } from "@mintdex/chain-sdk/api";
import { cardVaultPda, coinUri, pumpCreateV2, registerCardIx, registerCardMetaplexIx } from "@mintdex/chain-sdk";

import * as client from "../../src/lib/chain/client";
import { ChainClientError } from "../../src/lib/chain/errors";
import { forgetWalletModes, getWalletMode, rememberWalletFirst } from "../../src/lib/chain/wallet-modes";
import {
  b64,
  baseAccounts,
  buildTx,
  clearStorage,
  fail,
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

const TREASURY = "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj";
const NAME = "Mode Test";
const SYMBOL = "MODE";
const mintKp = usedVanityMint();

let user: Kp;
let net: FakeNet;
let prepares: string[];
let prepareBodies: Record<string, unknown>[];
/** What the fake Worker builds (§18.17): the register instruction in the tx, and the cardStandard it reports. */
let worker: { builds: "token2022" | "metaplex"; reports: "token2022" | "metaplex" | undefined } = { builds: "token2022", reports: undefined };

function prepare(mode: "server_first" | "wallet_first", mint: Kp): ApiLaunchPrepareResponse {
  const reg = { launcher: user.address, mint: mint.address, treasury: TREASURY };
  const ixs = [
    pumpCreateV2({ mint: mint.address, user: user.address, name: NAME, symbol: SYMBOL, uri: coinUri(mint.address), creator: cardVaultPda(mint.address) }),
    worker.builds === "metaplex" ? registerCardMetaplexIx(reg) : registerCardIx(reg),
  ];
  const unsigned = buildTx(user.address, ixs);
  return {
    intentId: `launch${mode}0123456789ab`.slice(0, 22),
    mint: mint.address,
    mode,
    tx: b64(mode === "server_first" ? signAs(unsigned, mint) : unsigned),
    alt: "A",
    lastValidBlockHeight: 1_000,
    expiresAt: Math.floor(Date.now() / 1000) + 90,
    coinUri: coinUri(mint.address),
    treasury: TREASURY,
    devBuy: null,
    ...(worker.reports ? { cardStandard: worker.reports } : {}),
    summary: summary("launch", user.address, 50_000_000n),
  };
}

/** The Worker: SIWS, media, prepare (records the mode), finalize per mode, status confirmed and indexed. */
function serve(finalize: (mode: string) => ApiReply, mint: Kp) {
  prepares = [];
  prepareBodies = [];
  let lastMode = "server_first";
  net = installNet({
    // Every address passes the ticket check here (the vanity rule itself is the SDK's, tested there).
    accounts: baseAccounts({ vanity_modulus: 1n, vanity_residue: 0n }),
    api: (method, p, body) => {
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
      if (p === "/auth/verify")
        return ok({ session: { token: "t".repeat(43), address: user.address, handle: null, expiresAt: new Date(now + 3_600_000).toISOString() } });
      if (p === "/media") return ok({ image: { key: "up-0123456789abcdef.png", url: "https://mintdex.fun/img/up-0123456789abcdef.png" }, bytes: 4, contentType: "image/png", sha256: "0".repeat(64) });
      if (p === "/launch/prepare") {
        lastMode = (body as { mode: string }).mode;
        prepares.push(lastMode);
        prepareBodies.push(body as Record<string, unknown>);
        return ok(prepare(lastMode as "server_first" | "wallet_first", mint));
      }
      if (p === "/launch/finalize") return finalize(lastMode);
      if (method === "GET" && p.startsWith("/launch/"))
        return ok({ intentId: p.slice(8), mint: mint.address, status: "confirmed", signature: "launchSig", error: null, coinIndexed: true });
      return undefined;
    },
  });
}

const input = () => ({
  name: NAME,
  symbol: SYMBOL,
  description: "",
  image: new Blob([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], { type: "image/png" }),
  devBuyLamports: 0n,
  slippageBps: 500,
});

beforeEach(() => {
  clearStorage();
  user = keypair();
  worker = { builds: "token2022", reports: undefined };
});
afterEach(() => {
  resetWallet();
  forgetWalletModes();
});

describe("wallet-modes", () => {
  test("defaults to server_first; remembers only what it is told", () => {
    expect(getWalletMode("Test Wallet")).toBe("server_first");
    expect(getWalletMode(null)).toBe("server_first");
    rememberWalletFirst("Test Wallet");
    expect(getWalletMode("Test Wallet")).toBe("wallet_first");
    expect(getWalletMode("Other Wallet")).toBe("server_first");
  });

  const vanity = mintKp ? test : test.skip;

  vanity("a server_first launch that succeeds stores nothing", async () => {
    serve(() => ok({ intentId: "x", mint: mintKp!.address, signature: "launchSig", status: "submitted" }), mintKp!);
    const w = installWallet(user);
    const r = await client.launchCoin(input());
    expect(r.mint).toBe(mintKp!.address);
    expect(r.mode).toBe("server_first");
    expect(prepares).toEqual(["server_first"]);
    expect(w.messages).toBe(1); // one SIWS signature
    expect(w.signs).toBe(1);
    expect(localStorage.getItem("mintdex.walletModes.v1")).toBeNull();
  });

  vanity("WALLET_REWROTE_TX in server_first retries once in wallet_first, then remembers it", async () => {
    serve((mode) => (mode === "server_first" ? fail(409, "WALLET_REWROTE_TX") : ok({ intentId: "x", mint: mintKp!.address, signature: "launchSig", status: "submitted" })), mintKp!);
    installWallet(user);
    const r = await client.launchCoin(input());
    expect(r.mode).toBe("wallet_first");
    expect(prepares).toEqual(["server_first", "wallet_first"]);
    expect(getWalletMode("Test Wallet")).toBe("wallet_first");
  });

  vanity("WALLET_REWROTE_TX in both modes ends the attempt and stores nothing", async () => {
    serve(() => fail(409, "WALLET_REWROTE_TX"), mintKp!);
    installWallet(user);
    const err = await client.launchCoin(input()).catch((e) => e);
    expect((err as ChainClientError).code).toBe("WALLET_REWROTE_TX");
    expect(prepares).toEqual(["server_first", "wallet_first"]);
    expect(getWalletMode("Test Wallet")).toBe("server_first");
    expect(localStorage.getItem("mintdex.walletModes.v1")).toBeNull();
  });

  test("a wallet already on wallet_first starts there, and a rewrite there never loops", async () => {
    // wallet_first needs no mint presignature: any address ending in mint will do (a public fixture mint here).
    const anyMint: Kp = { address: FIXTURES.coin2Mint.pubkey, sign: () => { throw new Error("not used"); } };
    rememberWalletFirst("Test Wallet");
    serve(() => fail(409, "WALLET_REWROTE_TX"), anyMint);
    installWallet(user);
    const err = await client.launchCoin(input()).catch((e) => e);
    expect((err as ChainClientError).code).toBe("WALLET_REWROTE_TX");
    expect(prepares).toEqual(["wallet_first"]);
    expect(net.apiCalls("/launch/finalize")).toHaveLength(1);
  });

  // card-program-v2 §18.17: the client asks for the Metaplex card and verifies whichever register the Worker built
  vanity("asks for cardStandard metaplex and verifies a register_card_metaplex launch the Worker reports", async () => {
    worker = { builds: "metaplex", reports: "metaplex" };
    serve(() => ok({ intentId: "x", mint: mintKp!.address, signature: "launchSig", status: "submitted" }), mintKp!);
    const w = installWallet(user);
    const r = await client.launchCoin(input());
    expect(r.mint).toBe(mintKp!.address);
    expect(prepareBodies[0].cardStandard).toBe("metaplex-collection");
    expect(w.signs).toBe(1);
  });

  vanity("a Worker from before §18.17 (no cardStandard, register_card) still verifies", async () => {
    worker = { builds: "token2022", reports: undefined };
    serve(() => ok({ intentId: "x", mint: mintKp!.address, signature: "launchSig", status: "submitted" }), mintKp!);
    installWallet(user);
    const r = await client.launchCoin(input());
    expect(r.mint).toBe(mintKp!.address);
  });

  vanity("a Metaplex register under a token2022 report (or the reverse) is refused before the wallet opens", async () => {
    for (const w of [{ builds: "metaplex", reports: "token2022" }, { builds: "metaplex", reports: undefined }, { builds: "token2022", reports: "metaplex" }] as const) {
      worker = { ...w };
      serve(() => ok({ intentId: "x", mint: mintKp!.address, signature: "launchSig", status: "submitted" }), mintKp!);
      const wallet = installWallet(user);
      const err = await client.launchCoin(input()).catch((e) => e);
      expect(err).toBeInstanceOf(ChainClientError);
      expect(wallet.signs).toBe(0);
      expect(net.apiCalls("/launch/finalize")).toHaveLength(0);
      resetWallet();
    }
  });
});
