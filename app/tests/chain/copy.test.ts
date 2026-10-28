// Copy rules for the devnet wallet code (refs/chain/m3-contract.md §0 rule 5, C9): no em dashes, en dashes or middle
// dots anywhere in app:wallet's files, and none of the simulation's words (test SOL, faucet, demo bots, test mode)
// in what devnet shows.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { CONNECT_COPY } from "../../src/lib/chain/connect-copy";
import { PHASE_LABEL, STEP_LABEL } from "../../src/lib/chain/tx-copy";
import { WALLET_COPY } from "../../src/lib/chain/wallet-copy";

const APP = path.resolve(import.meta.dir, "../..");
const FILES = [
  "src/lib/chain/client.ts",
  "src/lib/chain/wallet.ts",
  "src/lib/chain/verify.ts",
  "src/lib/chain/trust.ts",
  "src/lib/chain/flows.ts",
  "src/lib/chain/auth.ts",
  "src/lib/chain/errors.ts",
  "src/lib/chain/identity.ts",
  "src/lib/chain/wallet-host.client.tsx",
  "src/lib/chain/wallet-std.ts",
  "src/lib/chain/wallet-modes.ts",
  "src/lib/chain/wallet-copy.ts",
  "src/lib/chain/tx-copy.ts",
  "src/lib/chain/connect-copy.ts",
  "src/components/chain/WalletMount.tsx",
  "src/components/chain/ConnectWallet.tsx",
  "src/components/chain/WalletMenus.tsx",
  "src/components/chain/WalletModal.tsx",
  "src/components/chain/NetworkNotice.tsx",
  "src/components/chain/TxSteps.tsx",
];

describe("no em dashes, en dashes or middle dots", () => {
  for (const f of FILES) {
    test(f, () => {
      const src = fs.readFileSync(path.join(APP, f), "utf8");
      expect(src).not.toMatch(/[—–·]/);
    });
  }
});

describe("no simulation words on devnet surfaces (C9)", () => {
  const SIM = [/test SOL/i, /faucet sent/i, /demo bot/i, /bot traders/i, /test mode/i, /claim .* test sol/i];
  const strings = (o: Record<string, unknown>) =>
    Object.values(o).map((v) => (typeof v === "function" ? String((v as (x: string) => string)("x")) : String(v)));
  const all = [...strings(WALLET_COPY), ...strings(CONNECT_COPY), ...Object.values(PHASE_LABEL), ...Object.values(STEP_LABEL)];
  test("wallet words", () => {
    for (const s of all) for (const re of SIM) expect(s).not.toMatch(re);
  });
  // Code and strings only (comments may name what devnet leaves out).
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const f of FILES) {
    test(`${f} source`, () => {
      const src = code(fs.readFileSync(path.join(APP, f), "utf8"));
      for (const re of [/test SOL/i, /faucet sent/i, /demo bot/i, /bot traders/i]) expect(src).not.toMatch(re);
    });
  }
});
