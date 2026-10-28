// Post-sign re-verification (refs/chain/m3-contract.md §7.1, §9.1): after signTransaction the client compares the
// message the wallet returned with the one it verified. A wallet that only raised the priority fee (or appended a
// read-only guard instruction from GUARD_PROGRAMS) passes the guard-tolerant re-check; one that added a transfer,
// changed the blockhash or the payload fails before anything is broadcast. Bytes the Worker refuses to relay
// (WALLET_REWROTE_TX) go to the public RPC only after that re-check.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { decodeTransaction, placeBidIx, ro, systemTransfer, type Instruction } from "@mintdex/chain-sdk";
import type { ApiTxBuildResponse } from "@mintdex/chain-sdk/api";

import * as client from "../../src/lib/chain/client";
import { ChainClientError } from "../../src/lib/chain/errors";
import { checkPrepared, GUARD_PROGRAMS, prepareVerification } from "../../src/lib/chain/verify";
import { addr, b64, buildTx, fail, installNet, installWallet, keypair, ok, resetWallet, summary, type FakeNet, type Kp } from "./helpers";

const AMOUNT = 50_000_000n;
const INTENT = "intent1234567890abcdef";

let user: Kp;
let mint: string;
let net: FakeNet;

function bidBuild(): ApiTxBuildResponse<"bid"> {
  return {
    intentId: INTENT,
    kind: "bid",
    tx: b64(buildTx(user.address, [placeBidIx({ bidder: user.address, mint, amount: AMOUNT })])),
    alt: "A",
    lastValidBlockHeight: 1_000,
    expiresAt: Math.floor(Date.now() / 1000) + 90,
    cuLimit: 300_000,
    cuPriceMicroLamports: 10_000,
    simulation: { unitsConsumed: 1, logsTail: [] },
    params: { previousLamports: "0", amountLamports: AMOUNT.toString() },
    summary: summary("bid", user.address, 1_000_000_000n),
  };
}

/** The Worker side: builds the honest bid; `submit` decides how /tx/submit answers. */
function serve(submit: () => ReturnType<typeof ok>) {
  net = installNet({
    api: (method, path) => {
      if (method === "POST" && path === "/tx/bid") return ok(bidBuild());
      if (method === "POST" && path === "/tx/submit") return submit();
      if (method === "GET" && path.startsWith("/tx/status/")) return ok({ intentId: INTENT, signature: "sig1", status: "confirmed", err: null, slot: 5 });
      return undefined;
    },
  });
}

/** A wallet that re-compiles the same payload with other compute budget values or extra instructions. */
const rewrite =
  (o: { cuPrice?: bigint; extra?: Instruction[]; blockhash?: string; amount?: bigint }) =>
  (tx: Uint8Array): Uint8Array => {
    const blockhash = o.blockhash ?? decodeTransaction(tx).message.recentBlockhash;
    return buildTx(user.address, [placeBidIx({ bidder: user.address, mint, amount: o.amount ?? AMOUNT }), ...(o.extra ?? [])], {
      cuPrice: o.cuPrice ?? 10_000n,
      blockhash,
    });
  };

beforeEach(() => {
  user = keypair();
  mint = addr();
});
afterEach(resetWallet);

describe("wallet-modified bytes", () => {
  test("a priority-fee-only rewrite passes and is submitted as rewritten", async () => {
    serve(() => ok({ intentId: INTENT, signature: "sig1", status: "submitted" }));
    const w = installWallet(user, { rewrite: rewrite({ cuPrice: 50_000n }) });
    const r = await client.placeBid({ mint, amountLamports: AMOUNT });
    expect(r.signature).toBe("sig1");
    expect(w.signs).toBe(1);
    const sent = net.apiCalls("/tx/submit")[0].body as { tx: string };
    expect(sent.tx).not.toBe(bidBuild().tx); // the wallet's bytes, not the Worker's
  });

  test("WALLET_REWROTE_TX: re-verified bytes go to the public devnet RPC, nothing else", async () => {
    serve(() => fail(409, "WALLET_REWROTE_TX"));
    installWallet(user, { rewrite: rewrite({ cuPrice: 60_000n }) });
    const r = await client.placeBid({ mint, amountLamports: AMOUNT });
    expect(r.signature).toMatch(/^5public/);
    const sends = net.rpcCalls("sendTransaction");
    expect(sends).toHaveLength(1);
    expect(sends[0][0]).toBe((net.apiCalls("/tx/submit")[0].body as { tx: string }).tx);
    expect(net.rpcCalls("getGenesisHash").length).toBeGreaterThan(0);
  });

  test("WALLET_REWROTE_TX for unchanged bytes is an error, never a public broadcast", async () => {
    serve(() => fail(409, "WALLET_REWROTE_TX"));
    installWallet(user);
    const err = await client.placeBid({ mint, amountLamports: AMOUNT }).catch((e) => e);
    expect((err as ChainClientError).code).toBe("WALLET_REWROTE_TX");
    expect(net.rpcCalls("sendTransaction")).toHaveLength(0);
  });

  const bad: Record<string, Parameters<typeof rewrite>[0]> = {
    "an added transfer": { extra: [systemTransfer(addr(), addr(), 1n)] },
    "a transfer from the wallet": { cuPrice: 20_000n },
    "a changed blockhash": { blockhash: "11111111111111111111111111111111" },
    "a changed amount": { amount: AMOUNT * 10n },
    "a priority fee above the limit": { cuPrice: 10_000_000n },
  };
  // The second case adds the wallet's own transfer at call time (the user is only known inside the test).
  for (const [name, o] of Object.entries(bad)) {
    test(`${name} fails before any broadcast`, async () => {
      serve(() => ok({ intentId: INTENT, signature: "sig1", status: "submitted" }));
      const opts = name === "a transfer from the wallet" ? { ...o, extra: [systemTransfer(user.address, addr(), 5_000n)] } : o;
      const w = installWallet(user, { rewrite: rewrite(opts) });
      const err = await client.placeBid({ mint, amountLamports: AMOUNT }).catch((e) => e);
      expect(err).toBeInstanceOf(ChainClientError);
      expect((err as ChainClientError).code).toBe("VERIFY_FAILED");
      expect(w.signs).toBe(1);
      expect(net.apiCalls("/tx/submit")).toHaveLength(0);
      expect(net.rpcCalls("sendTransaction")).toHaveLength(0);
    });
  }
});

describe("guard instructions (GUARD_PROGRAMS, recorded from the C1 wallet matrix)", () => {
  test("a read-only guard instruction passes only when its program is listed", async () => {
    installNet({});
    const build = bidBuild();
    const prepared = await prepareVerification("bid", { wallet: user.address, mint, amountLamports: AMOUNT.toString() }, build);
    const before = decodeTransaction(Uint8Array.from(atob(build.tx), (c) => c.charCodeAt(0)));
    const guardProgram = addr();
    const guard: Instruction = { programId: guardProgram, accounts: [ro(addr()), ro(addr())], data: Uint8Array.of(7) };
    const after = rewrite({ extra: [guard] })(Uint8Array.from(atob(build.tx), (c) => c.charCodeAt(0)));
    expect(GUARD_PROGRAMS).toEqual([]); // empty until C1 records the wallets' guard programs
    expect(checkPrepared(after, prepared, before).ok).toBe(false);
    expect(checkPrepared(after, prepared, before, [guardProgram]).ok).toBe(true);
    // A guard instruction that writes or signs is never acceptable.
    const writer: Instruction = { programId: guardProgram, accounts: [{ address: addr(), isSigner: false, isWritable: true }], data: Uint8Array.of(7) };
    const after2 = rewrite({ extra: [writer] })(Uint8Array.from(atob(build.tx), (c) => c.charCodeAt(0)));
    expect(checkPrepared(after2, prepared, before, [guardProgram]).ok).toBe(false);
  });
});
