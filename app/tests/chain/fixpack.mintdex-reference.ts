// Mainnet fix pack, app side (refs/mainnet/fix-plan.md §4.4): the default build stays devnet, the mainnet build guard,
// the server-cluster check before any flow, collection launches and the dev-buy split in the verifier, the listing
// pause and concentration helpers, and the copy rules (no em dashes; no devnet, faucet or test words in mainnet copy).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { ApiLaunchPrepareResponse, ApiListing } from "@mintdex/chain-sdk/api";

import * as client from "../../src/lib/chain/client";
import { APP_CLUSTER, ON_NET, SOL_WORD, SOLANA_CHAIN, TRUST_ANCHORS, explorerUrl } from "../../src/lib/chain/env";
import { MAINNET_PROGRAM_ID, anchorProblems, mainnetBuildProblems } from "../../src/lib/chain/build-guard";
import { MAINNET_ANCHORS } from "../../src/lib/chain/anchors.mainnet";
import { concentratedNote, listingPauseReason, resumeText } from "../../src/lib/chain/listing-state";
import { baseOptions, prepareLaunchVerification, verifiedTables } from "../../src/lib/chain/verify";
import { altStatusOf, loadAnchors } from "../../src/lib/chain/trust";
import { isUnknownCardStandard, prepareLaunch } from "../../src/lib/chain/flows";
import { CHAIN_COPY, FIXPACK_COPY, MODE } from "../../src/lib/mintdex/copy";
import { CLUSTER, IS_CHAIN } from "../../src/lib/mintdex/mode";
import { altAccount, altLayout, baseAccounts, clearStorage, installNet, keypair, ok, resetWallet, summary } from "./helpers";

const SRC = path.resolve(import.meta.dir, "../../src");

beforeEach(() => {
  clearStorage();
  client.resetServerCluster();
});
afterEach(() => {
  resetWallet();
  client.resetServerCluster();
});

describe("the default build is devnet", () => {
  test("mode, anchors, wallet chain, explorer and wording", () => {
    expect(MODE).toBe("devnet");
    expect(CLUSTER).toBe("devnet");
    expect(IS_CHAIN).toBe(true);
    expect(APP_CLUSTER).toBe("devnet");
    expect(SOLANA_CHAIN).toBe("solana:devnet");
    expect(TRUST_ANCHORS.genesisHash).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    expect(TRUST_ANCHORS.altC).toBe("");
    expect(explorerUrl("tx", "x")).toBe("https://explorer.solana.com/tx/x?cluster=devnet");
    expect([SOL_WORD, ON_NET]).toEqual(["devnet SOL", "on devnet"]);
    expect(CHAIN_COPY.switchNetwork).toBe("Switch your wallet to Solana devnet to sign.");
  });

  test("the mainnet anchors carry the mainnet genesis, and placeholders until the fill step writes them", () => {
    // Placeholders until 95-fill.js runs app/scripts/mainnet-anchors.mjs; after that a filled file that passes the guard
    // (tests/chain/mainnet-build.test.ts checks both shapes).
    expect(MAINNET_ANCHORS.genesisHash).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    expect(MAINNET_ANCHORS.walletChain).toBe("solana:mainnet");
    const placeholders = Object.values(MAINNET_ANCHORS).some((v) => v.includes("REPLACE_"));
    expect(placeholders || anchorProblems(MAINNET_ANCHORS).length === 0).toBe(true);
  });
});

describe("mainnet build guard (vite.config.ts)", () => {
  const filled = {
    ...MAINNET_ANCHORS,
    altA: "2DFeAjuLyv7TA24M29MRpWG9am4V5r8DUjaUJwu7aKtB",
    altB: "5T5qPZ3tAp2u7obNg86zrYtMVC2UdFrCQVmzJevfhk7T",
    altC: "AeDaVcjfSCPG1WAMsMJogHKFySBqruoAdqE4L2Jhj3ju",
    altTreasury: "4PFakdhGSYqMhPgYFeQC5cER3gru7w9dYpo4zGuN5Zzy",
    chainApiOrigin: "https://mintdex.fun",
    publicRpc: "https://mintdex-example.helius-rpc.com",
  };
  const good = { VITE_MINTDEX_MODE: "mainnet", VITE_MINTDEX_MAINNET_ACK: MAINNET_PROGRAM_ID };
  test("refuses without the ACK, with a devnet API or RPC, a keyed or public RPC, or placeholder anchors", () => {
    expect(mainnetBuildProblems(good, filled)).toEqual([]);
    expect(mainnetBuildProblems({ ...good, VITE_MINTDEX_MAINNET_ACK: undefined }, filled).join()).toContain("ACK");
    expect(mainnetBuildProblems(good, { ...filled, chainApiOrigin: "https://devnet.mintdex.fun" }).join()).toContain("chain API origin");
    expect(mainnetBuildProblems(good, { ...filled, publicRpc: "https://api.devnet.solana.com" }).join()).toContain("browser RPC");
    expect(mainnetBuildProblems(good, { ...filled, publicRpc: "https://rpc.example/?api-key=x" }).join()).toContain("browser RPC");
    expect(mainnetBuildProblems(good, { ...filled, publicRpc: "https://api.mainnet-beta.solana.com" }).join()).toContain("public");
    expect(mainnetBuildProblems(good, { ...filled, altA: "REPLACE_FROM_DEPLOYED_MAINNET_JSON" }).join()).toContain("REPLACE_");
  });
});

describe("server cluster check (compat §6.4)", () => {
  test("a devnet build against a server that answers mainnet refuses every flow with WRONG_NETWORK", async () => {
    installNet({ api: (_m, p) => (p === "/config" ? ok({ cluster: "mainnet" }) : undefined) });
    const err = await client.assertServerCluster().catch((e) => e);
    expect(err?.code).toBe("WRONG_NETWORK");
    expect(String(err?.message)).toContain("Solana devnet");
  });
  test("the matching cluster, or a server that does not answer, does not block", async () => {
    installNet({ api: (_m, p) => (p === "/config" ? ok({ cluster: "devnet" }) : undefined) });
    await client.assertServerCluster();
    client.resetServerCluster();
    installNet({ api: () => undefined });
    await client.assertServerCluster();
  });
});

describe("collection launches and the dev-buy split (F8, admin B6)", () => {
  const prep = (o: Partial<ApiLaunchPrepareResponse>, wallet: string, mint: string): ApiLaunchPrepareResponse => ({
    intentId: "launch0123456789abcdefg",
    mint,
    mode: "server_first",
    tx: "",
    alt: "A",
    lastValidBlockHeight: 1,
    expiresAt: 0,
    coinUri: `https://mintdex.fun/m/${mint}.json`,
    treasury: "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj",
    devBuy: null,
    cardStandard: "metaplex-collection",
    summary: summary("launch", wallet, 50_000_000n),
    ...o,
  });
  test("a collection launch verifies as metaplex-collection; a split dev buy leaves the launch without it", async () => {
    installNet({ accounts: baseAccounts({ vanity_modulus: 1n, vanity_residue: 0n, register_flags: 3 }) });
    const wallet = keypair().address;
    const mint = "AQqDNgQk6tKbp5YRSwGcuHknkvQ8XPcTEYJ3zYCPmint";
    const input = { name: "Coin", symbol: "COIN", devBuyLamports: 100_000_000n, slippageBps: 500 };
    const split = await prepareLaunchVerification(input, prep({ devBuySplit: { lamports: "100000000", slippageBps: 500 } }, wallet, mint), wallet);
    expect(split.intent.kind).toBe("launch");
    if (split.intent.kind !== "launch") throw new Error("unreachable");
    expect(split.intent.cardStandard).toBe("metaplex-collection");
    expect(split.intent.devBuy).toBeNull();
    expect(split.mismatches.filter((m) => m.includes("dev buy"))).toEqual([]);
    expect(split.options.registerFlags).toBe(3);
    const wrong = await prepareLaunchVerification(input, prep({ devBuySplit: { lamports: "5", slippageBps: 500 } }, wallet, mint), wallet);
    expect(wrong.mismatches.join()).toContain("split");
    const unknown = await prepareLaunchVerification(input, prep({ cardStandard: "nft" as never, devBuySplit: { lamports: "100000000", slippageBps: 500 } }, wallet, mint), wallet);
    expect(unknown.mismatches.join()).toContain("unknown card NFT type");
  });

  test("review round 2: the verifier resolves only through tables whose on-chain prefix the client read", async () => {
    // full A, base B, a C extended out of order: A 43, B 38, C never
    expect(Object.keys(verifiedTables({ [TRUST_ANCHORS.altA]: "full", [TRUST_ANCHORS.altB]: "base" }))).toEqual([TRUST_ANCHORS.altA, TRUST_ANCHORS.altB]);
    const t = verifiedTables({ [TRUST_ANCHORS.altA]: "full", [TRUST_ANCHORS.altB]: "base" });
    expect([t[TRUST_ANCHORS.altA].length, t[TRUST_ANCHORS.altB].length]).toEqual([43, 38]);
    expect(Object.keys(verifiedTables({ [TRUST_ANCHORS.altA]: null, [TRUST_ANCHORS.altB]: "full" }))).toEqual([TRUST_ANCHORS.altB]);
    const o = baseOptions({ pumpGlobal: null, ammGlobal: null, altStatus: { [TRUST_ANCHORS.altA]: "base", [TRUST_ANCHORS.altB]: null } });
    expect(o.allowedLookupTables).toEqual([TRUST_ANCHORS.altA]);
    expect(o.lookupTables?.[TRUST_ANCHORS.altA]).toHaveLength(38);
    // the status read from accounts
    const layout = altLayout();
    const dec = (acc: ReturnType<typeof altAccount>) => ({ owner: acc.owner, lamports: acc.lamports, data: Uint8Array.from(Buffer.from(acc.data, "base64")), executable: false });
    expect(altStatusOf(dec(altAccount(layout)) as never)).toBe("full");
    expect(altStatusOf(dec(altAccount(layout.slice(0, 38))) as never)).toBe("base");
    const swapped = [...layout];
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    expect(altStatusOf(dec(altAccount(swapped)) as never)).toBe(null);
    expect(altStatusOf(dec(altAccount([...layout.slice(0, 38), ...swapped.slice(0, 5)])) as never)).toBe("base");
    expect(altStatusOf(null)).toBe(null);
    expect(altStatusOf({ ...dec(altAccount(layout)), owner: "11111111111111111111111111111111" } as never)).toBe(null);
    // the session anchors carry the statuses read from the public RPC
    installNet({ accounts: baseAccounts() });
    const a = await loadAnchors();
    expect(a.altStatus).toEqual({ [TRUST_ANCHORS.altA]: "full", [TRUST_ANCHORS.altB]: "full" });
  });

  test("review round 2: a Worker older than the fix pack gets the plain Metaplex card asked for once", async () => {
    const asked: string[] = [];
    const reply = { intentId: "x" } as unknown as ApiLaunchPrepareResponse;
    const old = async (body: { cardStandard?: string }) => {
      asked.push(String(body.cardStandard));
      if (body.cardStandard === "metaplex-collection") throw new client.ChainClientError("BAD_REQUEST", "cardStandard is metaplex or token2022");
      return reply;
    };
    const req = { cardStandard: "metaplex-collection" } as never;
    expect(await prepareLaunch(req, old as never)).toBe(reply);
    expect(asked).toEqual(["metaplex-collection", "metaplex"]);
    // a new Worker answers the first time; any other error is not retried
    asked.length = 0;
    expect(await prepareLaunch(req, (async (b: { cardStandard?: string }) => (asked.push(String(b.cardStandard)), reply)) as never)).toBe(reply);
    expect(asked).toEqual(["metaplex-collection"]);
    await expect(prepareLaunch(req, (async () => {
      throw new client.ChainClientError("BAD_REQUEST", "name is too long");
    }) as never)).rejects.toThrow("name is too long");
    expect(isUnknownCardStandard(new client.ChainClientError("BAD_REQUEST", "cardStandard is metaplex or token2022"))).toBe(true);
    expect(isUnknownCardStandard(new client.ChainClientError("RPC_UNAVAILABLE", "cardStandard"))).toBe(false);
  });

  test("verifier options: 43-entry tables for A and B, recipients from the cluster profile when the Global read failed", () => {
    const o = baseOptions({ pumpGlobal: null, ammGlobal: null });
    expect(o.allowedLookupTables).toEqual([TRUST_ANCHORS.altA, TRUST_ANCHORS.altB]);
    expect(o.lookupTables?.[TRUST_ANCHORS.altA]).toHaveLength(43);
    expect(o.pumpFeeRecipients?.length).toBe(8);
  });
});

describe("listing pause and concentration (F2, tier B1)", () => {
  const listing = (o: Partial<ApiListing>): ApiListing => ({
    mint: "m",
    seller: "s",
    sellerHandle: null,
    price: "50000000",
    expiresAt: 0,
    levelAtList: 2,
    minFeesToSeller: "0",
    createdAt: 0,
    voidOnEvolve: true,
    buyable: false,
    voided: true,
    expired: false,
    ...o,
  });
  test("pause with a resume time, a real unlock, the EVOLVE pause, and listings that sell", () => {
    const now = 1_000_000_000_000;
    const paused = listing({ pausedUntilSlot: 123, resumesAt: now / 1000 + 600 });
    expect(listingPauseReason(paused, { level: 2 }, false)).toBe("pause");
    expect(resumeText(paused, now)).toMatch(/\d/);
    expect(resumeText(listing({ pausedUntilSlot: 1, resumesAt: now / 1000 + 30 }), now)).toBe("in a minute");
    expect(FIXPACK_COPY.pausedRow("3:42 PM")).toBe("Paused: the card is unlocking. Resumes about 3:42 PM if the unlock stops.");
    expect(listingPauseReason(listing({ pausedUntilSlot: null }), { level: 3 }, false)).toBe("unlocked");
    expect(listingPauseReason(listing({ pausedUntilSlot: null }), { level: 2 }, true)).toBe("evolve-paused");
    expect(listingPauseReason(listing({ voided: false, buyable: true }), { level: 2 }, false)).toBeNull();
    expect(listingPauseReason(listing({ voidOnEvolve: false }), { level: 2 }, false)).toBeNull();
  });
  test("concentrated at 50% or more", () => {
    expect(concentratedNote({ top10Bps: 6_200 })).toBe("When this design unlocked, the 10 largest wallets held 62% of the coin.");
    expect(concentratedNote({ top10Bps: 4_999 })).toBeNull();
    expect(concentratedNote({ top10Bps: null })).toBeNull();
    expect(concentratedNote({})).toBeNull();
  });
});

describe("copy rules", () => {
  test("no em dashes in the fix-pack words", () => {
    const words = JSON.stringify(FIXPACK_COPY) + FIXPACK_COPY.pausedRow("x") + FIXPACK_COPY.wrongServer("devnet") + FIXPACK_COPY.concentratedHelp("1");
    expect(words).not.toContain("—");
    expect(words).not.toContain("–");
  });
  test("mainnet copy blocks carry no devnet, faucet or test-SOL words", () => {
    const block = (file: string, start: string) => {
      const src = fs.readFileSync(path.join(SRC, file), "utf8");
      const i = src.indexOf(start);
      expect(i).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("};", i));
    };
    for (const b of [
      block("lib/mintdex/copy.ts", "const MAINNET_CHAIN_COPY"),
      block("lib/mintdex/copy.ts", "const MAINNET_ONLY_CHAIN_ERRORS"),
      block("lib/chain/wallet-copy.ts", "const MAINNET_WALLET_COPY"),
    ]) {
      const strings = [...b.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ");
      expect(strings).not.toMatch(/devnet|faucet|test SOL/i);
      expect(strings).not.toContain("—");
    }
  });
});
