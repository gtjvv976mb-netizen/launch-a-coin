// Trust anchors (refs/chain/m3-contract.md §7.3, hard rule 1): the browser proves the public RPC is Solana devnet
// (genesis hash) before it verifies or signs anything, and the verifier's constants come from env.ts TRUST_ANCHORS
// and the client's own public RPC reads, never from the Worker's ApiConfig.

import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { configPda, MINTDEX_PROGRAM_ID, placeBidIx } from "@mintdex/chain-sdk";

import * as client from "../../src/lib/chain/client";
import { TRUST_ANCHORS } from "../../src/lib/chain/env";
import { ChainClientError } from "../../src/lib/chain/errors";
import { assertCluster, loadAnchors } from "../../src/lib/chain/trust";
import { mintdexAltList } from "../../src/lib/chain/verify";
import { addr, b64, buildTx, installNet, installWallet, keypair, MAINNET_GENESIS, ok, resetWallet, summary } from "./helpers";

const SRC = path.resolve(import.meta.dir, "../../src/lib/chain");

afterEach(resetWallet);

describe("the genesis check", () => {
  test("devnet passes", async () => {
    installNet({});
    await expect(assertCluster()).resolves.toBeUndefined();
  });

  test("a mainnet genesis is refused with WRONG_NETWORK", async () => {
    installNet({ genesis: MAINNET_GENESIS });
    const err = await assertCluster().catch((e) => e);
    expect(err).toBeInstanceOf(ChainClientError);
    expect((err as ChainClientError).code).toBe("WRONG_NETWORK");
    await expect(loadAnchors()).rejects.toThrow();
  });

  test("on a non-devnet RPC nothing is verified or signed", async () => {
    const user = keypair();
    const mint = addr();
    const net = installNet({
      genesis: MAINNET_GENESIS,
      api: (method, p) =>
        method === "POST" && p === "/tx/bid"
          ? ok({
              intentId: "intent1234567890abcdef",
              kind: "bid",
              tx: b64(buildTx(user.address, [placeBidIx({ bidder: user.address, mint, amount: 50_000_000n })])),
              alt: "A",
              lastValidBlockHeight: 1,
              expiresAt: Math.floor(Date.now() / 1000) + 90,
              cuLimit: 1,
              cuPriceMicroLamports: 1,
              simulation: { unitsConsumed: 1, logsTail: [] },
              params: { previousLamports: "0", amountLamports: "50000000" },
              summary: summary("bid", user.address, 10n ** 9n),
            })
          : undefined,
    });
    const w = installWallet(user);
    const err = await client.placeBid({ mint, amountLamports: 50_000_000n }).catch((e) => e);
    expect((err as ChainClientError).code).toBe("WRONG_NETWORK");
    expect(w.signs).toBe(0);
    expect(net.apiCalls("/tx/submit")).toHaveLength(0);
  });

  test("an unreachable RPC is a network error, retried next time (never a pass)", async () => {
    let calls = 0;
    installNet({
      rpc: (m) => {
        if (m !== "getGenesisHash") return undefined;
        calls++;
        if (calls === 1) throw new Error("down");
        return undefined;
      },
    });
    const first = await assertCluster().catch((e) => e);
    expect(first).toBeInstanceOf(Error);
    await expect(assertCluster()).resolves.toBeUndefined();
  });
});

describe("constants come from TRUST_ANCHORS, never from ApiConfig", () => {
  test("the anchors are devnet and the SDK agrees with them", () => {
    expect(TRUST_ANCHORS.genesisHash).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    expect(MINTDEX_PROGRAM_ID).toBe(TRUST_ANCHORS.programId);
    expect(configPda()).toBe(TRUST_ANCHORS.configAddress);
    // fix pack (admin B6): the 38 entries plus the 4 collection PDAs and the Metaplex program
    expect(mintdexAltList()).toHaveLength(43);
  });

  for (const file of ["verify.ts", "trust.ts", "flows.ts"]) {
    test(`${file} never reads the Worker's config`, () => {
      const src = fs.readFileSync(path.join(SRC, file), "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(src).not.toMatch(/\bgetConfig\b/);
      expect(src).not.toMatch(/\bApiConfig\b/);
      expect(src).not.toMatch(/publicRpcUrl/);
      // Every program, Config, ALT and treasury constant is TRUST_ANCHORS.<name>.
      for (const m of src.matchAll(/\b(altA|altB|altTreasury|configAddress|programId|genesisHash)\b/g)) {
        const before = src.slice(Math.max(0, m.index! - 14), m.index!);
        expect(before.endsWith("TRUST_ANCHORS.")).toBe(true);
      }
    });
  }

  test("the public RPC is a build constant, never a keyed URL", () => {
    const env = fs.readFileSync(path.join(SRC, "env.ts"), "utf8");
    const devnet = fs.readFileSync(path.join(SRC, "anchors.devnet.ts"), "utf8");
    expect(devnet).toContain('publicRpc: "https://api.devnet.solana.com"');
    expect(env).toContain("DEFAULT_PUBLIC_RPC: string = ANCHORS.publicRpc");
    expect(env).toMatch(/api\[-_\]\?key\|key\|token/);
  });
});
