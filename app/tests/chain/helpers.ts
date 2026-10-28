// Test helpers for the app chain client (refs/chain/m3-contract.md §9.1, app row). No network: fetch is replaced by
// a router that plays the public devnet RPC (genesis, Config, pump Global, pAMM GlobalConfig, curves, fee legs from
// the SDK's recorded devnet fixtures) and the chain API (tx builds, submit, status, SIWS, media, launch). The wallet is
// a mock behind the real store (lib/chain/wallet.ts setWalletActions) that counts every signTransaction call, so a
// test can prove the wallet never opened (C8). Keys are generated in memory; server_first launch tests need an
// explicit MINTDEX_TEST_VANITY_MINT pointing to a fresh ignored chain/.localnet fixture. No operational keys are read.
// Owner: app:wallet. Run: cd app && ~/.bun/bin/bun test tests/chain

import fs from "node:fs";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
  base58Encode,
  clusterAltAddresses,
  clusterProfile,
  compileV0Message,
  toAddressBytes,
  decodeTransaction,
  mintdexAltAddresses,
  mintdexProgram,
  serializeTransaction,
  setComputeUnitLimit,
  setComputeUnitPrice,
  toBase64,
  withSignature,
  type Instruction,
} from "@mintdex/chain-sdk";
import type { ApiEffectsSummary, ApiTxKind } from "@mintdex/chain-sdk/api";

import { CHAIN_API_ORIGIN, PUBLIC_RPC_URL, TRUST_ANCHORS } from "../../src/lib/chain/env";
import { FLOW_TIMING } from "../../src/lib/chain/flows";
import { resetTrust } from "../../src/lib/chain/trust";
import { setWalletActions, setWalletSnapshot, EMPTY_WALLET } from "../../src/lib/chain/wallet";

export const DEVNET_GENESIS = TRUST_ANCHORS.genesisHash;
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const BLOCKHASH = "9zrUHnA1nCByPksy3aL8tQ47vqdaG2vnFs4HrxgcZj4F";
export const PUBLIC_RPC = PUBLIC_RPC_URL;
/** The build's chain API (https://devnet.mintdex.fun on devnet since launch-plan §1.4). */
export const API = `${CHAIN_API_ORIGIN}/api/chain`;
export const ALT_LIST = mintdexAltAddresses({ treasury: TRUST_ANCHORS.altTreasury });

const REPO = path.resolve(import.meta.dir, "../../..");
const SDK_FIXTURES = path.join(REPO, "chain/sdk/test/fixtures/devnet");

// ---------------------------------------------------------------- storage (bun has no DOM storage)

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const g = globalThis as unknown as { localStorage: MemStorage; sessionStorage: MemStorage; window?: unknown };
g.localStorage = new MemStorage();
g.sessionStorage = new MemStorage();
// The client keeps sessions and runs flows in the browser only (typeof window checks): play a browser.
g.window ??= globalThis;
export function clearStorage() {
  g.localStorage.clear();
  g.sessionStorage.clear();
}

// Polls run every few ms in tests.
FLOW_TIMING.pollMs = 2;
FLOW_TIMING.slowPollMs = 2;

// ---------------------------------------------------------------- keys

export interface Kp {
  address: string;
  sign(message: Uint8Array): Uint8Array;
}

export function keypair(seed?: Uint8Array): Kp {
  const priv = seed ?? ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  return { address: base58Encode(pub), sign: (m) => ed25519.sign(m, priv) };
}

/** A random address (no key needed: PDAs, recipients). */
export const addr = () => keypair().address;

/**
 * Opt in with a fresh localnet-only vanity fixture, never an operational mint key. Paths are relative to REPO (or
 * absolute), must resolve unchanged inside the ignored chain/.localnet directory, and cannot use symlinks.
 * No override means these launch tests skip. All transactions use the fixed test BLOCKHASH and the mocked network.
 */
export function usedVanityMint(): Kp | null {
  const override = process.env.MINTDEX_TEST_VANITY_MINT;
  if (!override) return null;
  const root = path.join(REPO, "chain/.localnet");
  const file = path.resolve(REPO, override);
  const invalid = () => new Error("MINTDEX_TEST_VANITY_MINT must be a valid localnet-only vanity fixture inside chain/.localnet");
  if (!file.startsWith(`${root}${path.sep}`) || path.extname(file) !== ".json") throw invalid();
  try {
    if (fs.realpathSync(root) !== root || fs.realpathSync(file) !== file || !fs.statSync(file).isFile()) throw invalid();
    const values: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(values) || values.length !== 64 || !values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) throw invalid();
    const bytes = Uint8Array.from(values);
    const pub = ed25519.getPublicKey(bytes.slice(0, 32));
    if (!pub.every((v, i) => v === bytes[i + 32])) throw invalid();
    const kp = keypair(bytes.slice(0, 32));
    if (!kp.address.endsWith("mint")) throw invalid();
    return kp;
  } catch {
    throw invalid();
  }
}

// ---------------------------------------------------------------- transactions

export function buildTx(
  payer: string,
  ixs: Instruction[],
  o: { cuPrice?: bigint; cuLimit?: number; blockhash?: string; altEntries?: string[] } = {},
): Uint8Array {
  const all = [setComputeUnitLimit(o.cuLimit ?? 300_000), setComputeUnitPrice(o.cuPrice ?? 10_000n), ...ixs];
  const m = compileV0Message({
    payer,
    instructions: all,
    recentBlockhash: o.blockhash ?? BLOCKHASH,
    lookupTables: [{ address: TRUST_ANCHORS.altA, addresses: o.altEntries ?? ALT_LIST }],
  });
  return serializeTransaction(m.bytes, m.signers.map(() => null));
}

/** Signs `tx` as `kp` (its slot must be a required signer). */
export function signAs(tx: Uint8Array, kp: Kp): Uint8Array {
  const d = decodeTransaction(tx);
  return withSignature(tx, kp.address, kp.sign(d.message.bytes));
}

export const b64 = toBase64;

export function summary(kind: ApiTxKind | "launch", feePayer: string, maxSolOut: bigint): ApiEffectsSummary {
  return {
    kind,
    title: kind,
    feePayer,
    lines: [],
    maxSolOutLamports: maxSolOut.toString(),
    expectedSolInLamports: "0",
    tokensOut: null,
    tokensIn: null,
    rentLamports: "0",
    accountsCreated: [],
    networkFeeLamports: "5000",
    programs: [],
    warnings: [],
  };
}

// ---------------------------------------------------------------- chain state (public RPC)

export interface FakeAccount {
  owner: string;
  lamports: number;
  /** base64 */
  data: string;
}

function fixture(name: string): { pubkey: string; account: FakeAccount } {
  const j = JSON.parse(fs.readFileSync(path.join(SDK_FIXTURES, `${name}.json`), "utf8")) as {
    pubkey: string;
    account: { owner: string; lamports: number; data: [string, string] };
  };
  return { pubkey: j.pubkey, account: { owner: j.account.owner, lamports: j.account.lamports, data: j.account.data[0] } };
}

/** The MintDex Config account (devnet values; `over` changes fields, e.g. the vanity check for launch tests). */
export function configAccount(over: Record<string, unknown> = {}): FakeAccount {
  const pad = (s: string) => {
    const out = new Uint8Array(64);
    out.set(new TextEncoder().encode(s));
    return out;
  };
  const cfg = {
    version: 1,
    bump: 255,
    paused: 0,
    price_source: 0,
    admin: TRUST_ANCHORS.altTreasury,
    pending_admin: "11111111111111111111111111111111",
    price_authority: "11111111111111111111111111111111",
    treasury: TRUST_ANCHORS.altTreasury,
    pyth_price_account: "11111111111111111111111111111111",
    launch_fee: 0n,
    min_bid: 30_000_000n,
    protocol_fee_bps: 250,
    creator_royalty_bps: 500,
    max_conf_bps: 200,
    max_price_step_bps: 2000,
    mcap_multiplier: 100,
    sweep_flags: 7,
    card_uri_base_len: 22,
    sol_usd_e6: 118_000_000n,
    sol_usd_updated_at: 1_790_000_000n,
    max_price_age_secs: 0,
    evolve_hold_slots: 150,
    vanity_modulus: 11_316_496n,
    vanity_residue: 8_725_513n,
    tier_thresholds_usd: Array.from({ length: 13 }, (_, i) => BigInt(15_000 * (i + 1))),
    card_uri_base: pad("https://mintdex.fun/c/"),
    coin_uri_base: pad("https://mintdex.fun/m/"),
    coin_uri_base_len: 22,
    evolve_min_obs: 3,
    evolve_max_step: 2,
    _pad: 0,
    min_price_interval_secs: 300,
    last_pyth_sol_usd_e6: 118_000_000n,
    // mainnet fix pack (refs/mainnet/fix-plan.md §2.2): the fields carved out of reserved[64], all off on devnet
    evolve_min_observers: 0,
    register_flags: 0,
    tier_guard: 0,
    outside_royalty_bps: 0,
    ticket_authority: "11111111111111111111111111111111",
    ticket_allowance: 0,
    // review round 2: the last EVOLVE unpause slot @527
    evolve_resumed_slot: 0n,
    reserved: new Uint8Array(17),
    ...over,
  };
  return { owner: TRUST_ANCHORS.programId, lamports: 5_000_000, data: toBase64(mintdexProgram().encodeAccount("Config", cfg)) };
}

export const FIXTURES = {
  pumpGlobal: fixture("pump_global"),
  ammGlobal: fixture("amm_global_config"),
  pumpFeeConfig: fixture("pump_fee_config"),
  ammFeeConfig: fixture("amm_fee_config"),
  /** coin2: a devnet coin still on its bonding curve (coin1 graduated). */
  coin2Curve: fixture("coin2_curve"),
  coin2Mint: fixture("coin2_mint"),
};

/** An active address lookup table account holding `addresses` (review round 2: the client reads A, B and C). */
export function altAccount(addresses: readonly string[]): FakeAccount {
  const d = new Uint8Array(56 + 32 * addresses.length);
  d[0] = 1;
  d.fill(0xff, 4, 12);
  addresses.forEach((a, i) => d.set(toAddressBytes(a), 56 + 32 * i));
  return { owner: ADDRESS_LOOKUP_TABLE_PROGRAM_ID, lamports: 2_000_000, data: toBase64(d) };
}

/** The cluster's 43-entry ALT layout with the anchors' ALT treasury. */
export const altLayout = (): string[] => clusterAltAddresses(clusterProfile("devnet"), TRUST_ANCHORS.altTreasury);

/**
 * The public RPC's accounts: Config, pump Global, pAMM GlobalConfig, both fee configs, coin2 (curve + mint), and ALT A
 * and B holding the full 43-entry layout.
 */
export function baseAccounts(over: Record<string, unknown> = {}): Map<string, FakeAccount> {
  const m = new Map<string, FakeAccount>();
  m.set(TRUST_ANCHORS.configAddress, configAccount(over));
  for (const f of Object.values(FIXTURES)) m.set(f.pubkey, f.account);
  m.set(TRUST_ANCHORS.altA, altAccount(altLayout()));
  m.set(TRUST_ANCHORS.altB, altAccount(altLayout()));
  return m;
}

// ---------------------------------------------------------------- fetch router

export interface Call {
  url: string;
  method: string;
  path: string;
  body: unknown;
}

export interface ApiReply {
  status?: number;
  json: unknown;
}

export interface FakeNet {
  calls: Call[];
  rpcCalls(method: string): unknown[][];
  apiCalls(path: string | RegExp): Call[];
}

/**
 * Replaces fetch. `rpc` may override any JSON-RPC method (return undefined to fall back to the defaults);
 * `api(method, path, body)` answers /api/chain routes (path after /api/chain).
 */
export function installNet(opts: {
  genesis?: string;
  accounts?: Map<string, FakeAccount>;
  rpc?: (method: string, params: unknown[]) => unknown;
  api?: (method: string, path: string, body: unknown) => ApiReply | undefined;
}): FakeNet {
  const calls: Call[] = [];
  const accounts = opts.accounts ?? baseAccounts();
  resetTrust();
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body) body = init.body;
    if (url === PUBLIC_RPC) {
      const req = body as { method: string; params: unknown[]; id: number };
      calls.push({ url, method, path: req.method, body: req.params });
      const custom = opts.rpc?.(req.method, req.params);
      const result = custom !== undefined ? custom : defaultRpc(req.method, req.params, accounts, opts.genesis ?? DEVNET_GENESIS);
      return Response.json({ jsonrpc: "2.0", id: req.id, result });
    }
    if (url.startsWith(API)) {
      const u = new URL(url);
      const p = u.pathname.slice("/api/chain".length) + u.search;
      calls.push({ url, method, path: p, body });
      const r = opts.api?.(method, u.pathname.slice("/api/chain".length), body);
      if (!r) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }, { status: 404 });
      return Response.json(r.json, { status: r.status ?? 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  globalThis.fetch = fetchImpl as typeof fetch;
  return {
    calls,
    rpcCalls: (m) => calls.filter((c) => c.url === PUBLIC_RPC && c.path === m).map((c) => c.body as unknown[]),
    apiCalls: (p) => calls.filter((c) => c.url.startsWith(API) && (typeof p === "string" ? c.path === p : p.test(c.path))),
  };
}

function defaultRpc(method: string, params: unknown[], accounts: Map<string, FakeAccount>, genesis: string): unknown {
  switch (method) {
    case "getGenesisHash":
      return genesis;
    case "getMultipleAccounts": {
      const list = params[0] as string[];
      return {
        context: { slot: 1 },
        value: list.map((a) => {
          const acc = accounts.get(a);
          return acc ? { owner: acc.owner, lamports: acc.lamports, data: [acc.data, "base64"], executable: false } : null;
        }),
      };
    }
    case "getMinimumBalanceForRentExemption":
      return 890_880;
    case "getTokenAccountsByOwner":
      return { context: { slot: 1 }, value: [] };
    case "getBlockHeight":
      return 100;
    case "getSignatureStatuses":
      return { context: { slot: 1 }, value: (params[0] as string[]).map(() => ({ err: null, confirmationStatus: "confirmed", slot: 7 })) };
    case "sendTransaction":
      return "5publicBroadcastSig1111111111111111111111111111111111111111111";
    default:
      throw new Error(`unexpected rpc ${method}`);
  }
}

export const ok = (json: object): ApiReply => ({ json: { ok: true, ...json } });
export const fail = (status: number, code: string, message = code): ApiReply => ({
  status,
  json: { ok: false, error: { code, message } },
});

// ---------------------------------------------------------------- the mock wallet

export interface MockWallet {
  readonly signs: number;
  readonly messages: number;
  /** The bytes the wallet was asked to sign, in order. */
  readonly seen: Uint8Array[];
}

/**
 * Connects a mock wallet to the real store. `rewrite` lets a test play a wallet that changes the transaction before
 * signing (priority fees, guard instructions, or worse).
 */
export function installWallet(
  kp: Kp,
  o: { devnet?: boolean; name?: string; rewrite?: (tx: Uint8Array) => Uint8Array; canSignMessage?: boolean } = {},
): MockWallet {
  let signs = 0;
  let messages = 0;
  const seen: Uint8Array[] = [];
  setWalletSnapshot({
    ready: true,
    wallets: [{ name: o.name ?? "Test Wallet", icon: "" }],
    connected: true,
    connecting: false,
    address: kp.address,
    walletName: o.name ?? "Test Wallet",
    walletIcon: null,
    clusterOk: o.devnet ?? true,
    canSignMessage: o.canSignMessage ?? true,
  });
  setWalletActions({
    openModal() {},
    connect: async () => kp.address,
    disconnect: async () => {},
    signTransaction: async (tx) => {
      signs++;
      seen.push(tx);
      const bytes = o.rewrite ? o.rewrite(tx) : tx;
      return signAs(bytes, kp);
    },
    signMessage: async (m) => {
      messages++;
      return kp.sign(m);
    },
  });
  return {
    get signs() {
      return signs;
    },
    get messages() {
      return messages;
    },
    seen,
  };
}

export function resetWallet() {
  setWalletActions(null);
  setWalletSnapshot(EMPTY_WALLET);
}
