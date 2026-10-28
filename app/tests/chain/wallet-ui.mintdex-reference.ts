// The wallet host's pure rules (which wallets are listed, which account is used, when an account counts as devnet),
// the signing state machine (P1-8 on devnet: idle, building, verifying, awaiting wallet, sending, confirming, done,
// error; a VERIFY_FAILED ends in error before the wallet is asked, C8), and the devnet identity helpers.

import { afterEach, describe, expect, test } from "bun:test";

import { actionStateOf, nextPhase, type TxEvent } from "../../src/components/chain/TxSteps";
import { readBalance, requestWallet, shortAddress } from "../../src/lib/chain/identity";
import { getWalletSnapshot, setWalletActions, setWalletSnapshot, EMPTY_WALLET } from "../../src/lib/chain/wallet";
import { isSolanaWallet, onCluster, pickAccount, pickAccountAfterChange, snapshotOf, type StdAccount, type StdWallet } from "../../src/lib/chain/wallet-std";
import { phaseOfStep, type TxPhase } from "../../src/lib/chain/tx-copy";
import { addr, fail, installNet, ok, resetWallet } from "./helpers";

// ---------------------------------------------------------------- Wallet Standard rules

const account = (chains: string[], features: string[] = ["solana:signTransaction", "solana:signMessage"]): StdAccount =>
  ({ address: addr(), publicKey: new Uint8Array(32), chains, features }) as unknown as StdAccount;

function fakeWallet(o: { name?: string; chains?: string[]; features?: string[]; accounts?: StdAccount[] } = {}): StdWallet {
  const features = Object.fromEntries(
    (o.features ?? ["standard:connect", "standard:events", "solana:signTransaction", "solana:signMessage"]).map((f) => [f, {}]),
  );
  return { version: "1.0.0", name: o.name ?? "Fake", icon: "data:image/svg+xml;base64,", chains: o.chains ?? ["solana:devnet"], accounts: o.accounts ?? [], features } as unknown as StdWallet;
}

describe("wallet-std", () => {
  test("lists only Solana wallets that can connect and sign transactions", () => {
    expect(isSolanaWallet(fakeWallet())).toBe(true);
    expect(isSolanaWallet(fakeWallet({ chains: ["ethereum:1"] }))).toBe(false);
    expect(isSolanaWallet(fakeWallet({ features: ["standard:connect", "solana:signMessage"] }))).toBe(false);
    expect(isSolanaWallet(fakeWallet({ features: ["solana:signTransaction"] }))).toBe(false);
  });

  test("devnet: the account's chains decide; an account without chains falls back to the wallet's", () => {
    const w = fakeWallet({ chains: ["solana:mainnet", "solana:devnet"] });
    expect(onCluster({ wallet: w, account: account(["solana:devnet"]) })).toBe(true);
    expect(onCluster({ wallet: w, account: account(["solana:mainnet"]) })).toBe(false);
    expect(onCluster({ wallet: w, account: account([]) })).toBe(true);
    expect(onCluster({ wallet: fakeWallet({ chains: ["solana:mainnet"] }), account: account([]) })).toBe(false);
  });

  test("picks the first devnet account, else the first; an account switch takes the wallet's first", () => {
    const main = account(["solana:mainnet"]);
    const dev = account(["solana:devnet"]);
    expect(pickAccount([main, dev])).toBe(dev);
    expect(pickAccount([main])).toBe(main);
    expect(pickAccount([])).toBeNull();
    expect(pickAccountAfterChange([dev, main])).toBe(dev);
    expect(pickAccountAfterChange([])).toBeNull();
  });

  test("snapshot: connected, clusterOk and canSignMessage", () => {
    const w = fakeWallet();
    const a = account(["solana:devnet"]);
    const s = snapshotOf([w], { wallet: w, account: a }, false);
    expect(s).toMatchObject({ ready: true, connected: true, address: a.address, walletName: "Fake", clusterOk: true, canSignMessage: true });
    const noMsg = snapshotOf([w], { wallet: w, account: account(["solana:devnet"], ["solana:signTransaction"]) }, false);
    expect(noMsg.canSignMessage).toBe(false);
    const wrong = snapshotOf([w], { wallet: w, account: account(["solana:mainnet"]) }, false);
    expect(wrong.clusterOk).toBe(false);
    expect(snapshotOf([w], null, true)).toMatchObject({ connected: false, connecting: true, address: null, clusterOk: false });
  });
});

// ---------------------------------------------------------------- the signing state machine

function walk(events: TxEvent[], from: TxPhase = "idle"): TxPhase[] {
  const out: TxPhase[] = [];
  let p = from;
  for (const e of events) {
    p = nextPhase(p, e);
    out.push(p);
  }
  return out;
}

describe("TxSteps state machine", () => {
  const step = (s: Parameters<typeof phaseOfStep>[0]): TxEvent => ({ type: "step", step: s });

  test("a full run", () => {
    expect(
      walk([{ type: "start" }, step("building"), step("verifying"), step("signing"), step("submitting"), step("confirming"), step("confirmed")]),
    ).toEqual(["building", "building", "verifying", "awaiting-wallet", "sending", "confirming", "done"]);
  });

  test("VERIFY_FAILED ends in error before the wallet is asked (C8)", () => {
    const phases = walk([{ type: "start" }, step("verifying"), { type: "error" }]);
    expect(phases).toEqual(["building", "verifying", "error"]);
    expect(phases).not.toContain("awaiting-wallet");
    // Nothing moves a stopped machine but start or reset.
    expect(nextPhase("error", step("signing"))).toBe("error");
    expect(nextPhase("error", { type: "reset" })).toBe("idle");
  });

  test("steps never go backwards, except the FEES_BELOW_FLOOR rebuild after the wallet was asked", () => {
    expect(nextPhase("sending", step("verifying"))).toBe("verifying");
    expect(nextPhase("verifying", step("building"))).toBe("verifying");
    expect(nextPhase("awaiting-wallet", step("building"))).toBe("building");
    expect(nextPhase("idle", step("signing"))).toBe("idle");
  });

  test("maps onto the ui.tsx feedback states", () => {
    expect(actionStateOf("idle")).toBe("idle");
    expect(actionStateOf("building")).toBe("pending");
    expect(actionStateOf("verifying")).toBe("pending");
    expect(actionStateOf("awaiting-wallet")).toBe("signing");
    expect(actionStateOf("sending")).toBe("pending");
    expect(actionStateOf("confirming")).toBe("confirming");
    expect(actionStateOf("done")).toBe("success");
    expect(actionStateOf("error")).toBe("error");
  });

  test("launch steps fold into the phases", () => {
    expect(phaseOfStep("signing-in")).toBe("building");
    expect(phaseOfStep("uploading")).toBe("building");
  });
});

// ---------------------------------------------------------------- identity

describe("identity", () => {
  afterEach(resetWallet);

  test("short address", () => {
    expect(shortAddress("BiHs2Ds6u3tHrmD5CzoHAyR79uC5VhdPH51ii4Y7dFtQ")).toBe("BiHs...dFtQ");
  });

  test("requestWallet runs at once when connected, else opens the picker and runs after connect", async () => {
    let opened = 0;
    setWalletActions({
      openModal: () => void opened++,
      connect: async () => "",
      disconnect: async () => {},
      signTransaction: async (t) => t,
      signMessage: async () => new Uint8Array(64),
    });
    let ran = 0;
    requestWallet(() => void ran++);
    expect(opened).toBe(1);
    expect(ran).toBe(0);
    setWalletSnapshot({ ...EMPTY_WALLET, ready: true, connected: true, address: addr(), clusterOk: true });
    await new Promise((r) => setTimeout(r, 5));
    expect(ran).toBe(1);
    requestWallet(() => void ran++);
    expect(ran).toBe(2);
    expect(opened).toBe(1);
    expect(getWalletSnapshot().connected).toBe(true);
  });

  test("balance: the chain API relay, else the public devnet RPC (display only)", async () => {
    const a = addr();
    installNet({ api: (_m, p) => (p === "/rpc" ? ok({ result: { context: { slot: 1 }, value: 123_000 } }) : undefined) });
    expect(await readBalance(a)).toBe(123_000);
    installNet({
      api: (_m, p) => (p === "/rpc" ? fail(503, "ENGINE_OFF") : undefined),
      rpc: (m) => (m === "getBalance" ? { context: { slot: 1 }, value: 456_000 } : undefined),
    });
    expect(await readBalance(a)).toBe(456_000);
  });
});
