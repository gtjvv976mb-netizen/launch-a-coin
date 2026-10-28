// The mainnet website build (refs/mainnet/app-mainnet.md, launch-plan §1.4, §3.3, §5, §6 APP): the one generated
// anchors file and its generator, the build guard (browser RPC rules included), the bundle sweep, the mode manifest,
// the devnet site host, the launch caps, the tiers against the chain config, and the mainnet copy evaluated in a
// mainnet-mode process (Bun's import.meta.env is process.env, so VITE_MINTDEX_MODE=mainnet selects the mainnet words).

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEVNET_OPERATIONAL_KEYS, MAINNET_PROFILE } from "@mintdex/chain-sdk";

import { DEVNET_ANCHORS, DEVNET_HOST_LIVE } from "../../src/lib/chain/anchors.devnet";
import { MAINNET_ANCHORS } from "../../src/lib/chain/anchors.mainnet";
import {
  DEVNET_VALUES,
  MAINNET_PROGRAM_ID,
  anchorProblems,
  isBase58Pubkey,
  mainnetBuildProblems,
  publicRpcProblem,
} from "../../src/lib/chain/build-guard";
import { CHAIN_API_ORIGIN } from "../../src/lib/chain/env";
import { LAUNCH_CAP_DEFAULT_LAMPORTS, capFromDetails, capSol, isExitOnly, launchCapsOf, launchGateOf, launchNotice } from "../../src/lib/chain/launch-caps";
import { tierUsdOf, usdPerLamportOf, holdTimeOf, MAINNET_DEFAULT_HOLD_SLOTS } from "../../src/lib/chain/adapt";
import { manifestFileName, manifestModeOf, webManifestText } from "../../src/lib/mintdex/manifest";
import { DEVNET_SITE_NOTE, MAINNET_SITE_LIVE, isDevnetSiteHost, isDevnetTestSite } from "../../src/lib/mintdex/site-host";
import { TIERS } from "../../src/lib/mintdex/tiers";
// @ts-expect-error plain ESM scripts without type declarations
import { PLACEHOLDER_ANCHORS, anchorsFromState, main as anchorsMain, renderAnchorsFile, renderEnvProduction } from "../../scripts/mainnet-anchors.mjs";
// @ts-expect-error plain ESM scripts without type declarations
import { ALLOWED, sweep, sweepText } from "../../scripts/mainnet-sweep.mjs";

const APP = path.resolve(import.meta.dir, "../..");
const REPO = path.resolve(APP, "..");
const BUN = process.execPath;

const A = "2DFeAjuLyv7TA24M29MRpWG9am4V5r8DUjaUJwu7aKtB";
const B = "5T5qPZ3tAp2u7obNg86zrYtMVC2UdFrCQVmzJevfhk7T";
const C = "AeDaVcjfSCPG1WAMsMJogHKFySBqruoAdqE4L2Jhj3ju";
const T = "4PFakdhGSYqMhPgYFeQC5cER3gru7w9dYpo4zGuN5Zzy";
const HELIUS_SECURE = "https://mintdex-example.helius-rpc.com";
const PATH_TOKEN = "https://example-name.solana-mainnet.quiknode.pro/0123456789abcdef0123456789abcdef/";

const STATE = {
  cluster: "mainnet-beta",
  program: { id: MAINNET_PROGRAM_ID, placeholderSha: "119c036e", deploySha: "cecf8c4a" },
  alts: { A, B, C },
  treasury: T,
  config: { address: "FXD57eXLpeXFbPju1N7JkWUSg7QfVfHN8mJq89RcxWYV" },
};
const FILLED = { ...PLACEHOLDER_ANCHORS, altA: A, altB: B, altC: C, altTreasury: T, publicRpc: HELIUS_SECURE };
const ACK = { VITE_MINTDEX_MODE: "mainnet", VITE_MINTDEX_MAINNET_ACK: MAINNET_PROGRAM_ID };

describe("browser RPC rules (launch-plan §1.4)", () => {
  test("a keyless Helius secure URL and a path-token URL pass; a key in the query, devnet and the public endpoint fail", () => {
    expect(publicRpcProblem(HELIUS_SECURE)).toBeNull();
    expect(publicRpcProblem(PATH_TOKEN)).toBeNull();
    expect(publicRpcProblem("https://mainnet.helius-rpc.com/?api-key=abc")).toContain("key in its query");
    expect(publicRpcProblem("https://rpc.example/x?token=abc")).toContain("key in its query");
    expect(publicRpcProblem("https://api.devnet.solana.com")).toContain("devnet");
    expect(publicRpcProblem("https://api.mainnet-beta.solana.com")).toContain("public");
    expect(publicRpcProblem("http://rpc.example")).toContain("https");
    expect(publicRpcProblem("REPLACE_WITH_BROWSER_RPC_URL")).toContain("not filled");
  });
  test("the guard accepts the path-token URL and refuses a ?api-key= URL in a full build check", () => {
    expect(mainnetBuildProblems(ACK, { ...FILLED, publicRpc: PATH_TOKEN })).toEqual([]);
    expect(mainnetBuildProblems(ACK, { ...FILLED, publicRpc: "https://mainnet.helius-rpc.com/?api-key=abc" }).join()).toContain("browser RPC");
  });
});

describe("build guard (one generated file)", () => {
  test("filled anchors pass; every placeholder, devnet value, duplicate table or wrong constant is refused", () => {
    expect(anchorProblems(FILLED)).toEqual([]);
    expect(anchorProblems(PLACEHOLDER_ANCHORS).join()).toContain("altA, altB, altC, altTreasury, publicRpc");
    expect(anchorProblems({ ...FILLED, altA: "ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW" }).join()).toContain("devnet address");
    expect(anchorProblems({ ...FILLED, altTreasury: "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj" }).join()).toContain("devnet address");
    expect(anchorProblems({ ...FILLED, altB: A }).join()).toContain("three different tables");
    expect(anchorProblems({ ...FILLED, altC: "notbase58!" }).join()).toContain("32-byte");
    expect(anchorProblems({ ...FILLED, genesisHash: DEVNET_ANCHORS.genesisHash }).join()).toContain("genesis");
    expect(anchorProblems({ ...FILLED, explorerQuery: "?cluster=devnet" }).join()).toContain("explorerQuery");
  });
  test("a VITE_ origin or RPC in the build env must equal the file (two sources never disagree)", () => {
    expect(mainnetBuildProblems({ ...ACK, VITE_CHAIN_API_ORIGIN: "https://mintdex.fun/", VITE_SOLANA_PUBLIC_RPC: HELIUS_SECURE }, FILLED)).toEqual([]);
    expect(mainnetBuildProblems({ ...ACK, VITE_CHAIN_API_ORIGIN: "https://api.mintdex.fun" }, FILLED).join()).toContain("VITE_CHAIN_API_ORIGIN");
    expect(mainnetBuildProblems({ ...ACK, VITE_SOLANA_PUBLIC_RPC: PATH_TOKEN }, FILLED).join()).toContain("VITE_SOLANA_PUBLIC_RPC");
  });
  test("the guard's devnet list is the SDK's operational keys plus the devnet genesis", () => {
    expect([...DEVNET_VALUES].sort()).toEqual([DEVNET_ANCHORS.genesisHash, ...DEVNET_OPERATIONAL_KEYS].sort());
    expect(MAINNET_PROFILE.foreignOperationalKeys).toEqual(DEVNET_OPERATIONAL_KEYS);
  });
  test("base58 check: 32-byte keys only", () => {
    expect(isBase58Pubkey(A)).toBe(true);
    expect(isBase58Pubkey("11111111111111111111111111111111")).toBe(true);
    expect(isBase58Pubkey("1111111111111111111111111111111")).toBe(false);
    expect(isBase58Pubkey("2DFeAjuLyv7TA24M29MRpWG9am4V5r8DUjaUJwu7aKtBB")).toBe(false);
  });
});

describe("generator (app/scripts/mainnet-anchors.mjs)", () => {
  test("a complete mainnet state renders a file the guard accepts", () => {
    const anchors = anchorsFromState(STATE, { publicRpc: HELIUS_SECURE });
    expect(anchors).toEqual(FILLED);
    expect(mainnetBuildProblems(ACK, anchors)).toEqual([]);
    const text = renderAnchorsFile(anchors, { sourceSha256: "ab".repeat(32) });
    expect(text).toContain(`altA: "${A}",`);
    expect(text).toContain(`publicRpc: "${HELIUS_SECURE}",`);
    expect(text).toContain("export const MAINNET_ANCHORS = {");
    expect(text.slice(text.indexOf("export const"))).not.toContain("REPLACE_");
  });
  test("the older alts.X.address shape and a site block are read; a disagreeing flag is refused", () => {
    const older = { ...STATE, alts: { A: { address: A }, B: { address: B }, C: { address: C } }, site: { publicRpc: PATH_TOKEN } };
    expect(anchorsFromState(older).publicRpc).toBe(PATH_TOKEN);
    expect(() => anchorsFromState(older, { publicRpc: HELIUS_SECURE })).toThrow("differs");
  });
  test("refuses a rehearsal state, another program id, missing or malformed addresses, and a bad browser RPC", () => {
    const bad = (s: object, o: object = { publicRpc: HELIUS_SECURE }) => () => anchorsFromState(s, o);
    expect(bad({ ...STATE, cluster: "localnet-rehearsal" })).toThrow("mainnet-beta");
    expect(bad({ ...STATE, program: { id: "11111111111111111111111111111111" } })).toThrow("program.id");
    expect(bad({ ...STATE, alts: { A, B } })).toThrow("alts.C is missing");
    expect(bad({ ...STATE, treasury: "xyz" })).toThrow("treasury is not");
    expect(bad(STATE, {})).toThrow("--public-rpc");
    expect(bad(STATE, { publicRpc: "https://api.mainnet-beta.solana.com" })).toThrow("public");
    expect(bad(STATE, { publicRpc: "https://mainnet.helius-rpc.com/?api-key=k" })).toThrow("query");
    expect(bad(STATE, { publicRpc: HELIUS_SECURE, chainApiOrigin: "https://devnet.mintdex.fun" })).toThrow("devnet");
    expect(bad({ ...STATE, alts: { A, B, C: A } })).toThrow("three different tables");
  });
  test("the committed anchors.mainnet.ts is generator output: placeholders, or a filled file that passes the guard", () => {
    const file = path.join(APP, "src/lib/chain/anchors.mainnet.ts");
    const text = fs.readFileSync(file, "utf8");
    const sha = text.match(/^\/\/ source: deployed\.mainnet\.json sha256 ([0-9a-f]{64})$/m)?.[1];
    expect(renderAnchorsFile(MAINNET_ANCHORS, sha ? { sourceSha256: sha } : {})).toBe(text);
    const placeholder = Object.values(MAINNET_ANCHORS).some((v) => v.includes("REPLACE_"));
    if (placeholder) expect(text).toBe(renderAnchorsFile(PLACEHOLDER_ANCHORS));
    else expect(anchorProblems(MAINNET_ANCHORS)).toEqual([]);
  });
  test("CLI: writes from a state file, --check compares, .env.production carries only the mode and the ACK", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdx-anchors-"));
    try {
      const state = path.join(dir, "deployed.mainnet.json");
      fs.writeFileSync(state, JSON.stringify(STATE));
      const out = path.join(dir, "anchors.mainnet.ts");
      const env = path.join(dir, ".env.production");
      const log = console.log;
      console.log = () => {};
      const err = console.error;
      console.error = () => {};
      try {
        expect(anchorsMain(["--from", state, "--public-rpc", HELIUS_SECURE, "--out", out, "--write-env", env])).toBe(0);
        expect(anchorsMain(["--from", state, "--public-rpc", HELIUS_SECURE, "--out", out, "--check"])).toBe(0);
        fs.appendFileSync(out, "// edited by hand\n");
        expect(anchorsMain(["--from", state, "--public-rpc", HELIUS_SECURE, "--out", out, "--check"])).toBe(1);
        expect(anchorsMain(["--placeholders", "--out", out])).toBe(0);
      } finally {
        console.log = log;
        console.error = err;
      }
      expect(fs.readFileSync(out, "utf8")).toBe(renderAnchorsFile(PLACEHOLDER_ANCHORS));
      const envText = fs.readFileSync(env, "utf8");
      expect(envText).toBe(renderEnvProduction());
      const vars = envText.split("\n").filter((l) => l && !l.startsWith("#"));
      expect(vars).toEqual(["VITE_MINTDEX_MODE=mainnet", `VITE_MINTDEX_MAINNET_ACK=${MAINNET_PROGRAM_ID}`]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test("main carries no app/.env.production (the platform build of main stays devnet); the template matches the generator", () => {
    expect(fs.existsSync(path.join(APP, ".env.production"))).toBe(false);
    expect(fs.existsSync(path.join(APP, ".env"))).toBe(false);
    expect(fs.readFileSync(path.join(APP, ".env.production.example"), "utf8")).toBe(`# TEMPLATE only (Vite never reads this name). The real file is app/.env.production on branch site/mainnet, refs/mainnet/app-mainnet.md.\n${renderEnvProduction()}`);
  });
});

describe("bundle sweep (app/scripts/mainnet-sweep.mjs)", () => {
  test("flags devnet prose, test labels, faucet hosts and devnet anchors; passes code tokens, the SDK denylist and the listed SDK strings", () => {
    const words = (t: string) => sweepText("x.js", t).map((f: { match: string }) => f.match);
    expect(words(`a("Switch your wallet to Solana devnet.")`)).toEqual(["devnet"]);
    expect(words(`x={label:"Get free devnet SOL from a faucet"}`)).toEqual(["devnet", "faucet"]);
    expect(words(`"Live in test mode with test SOL."`)).toEqual(["test mode", "test SOL"]);
    expect(words(`href:"https://faucet.solana.com"`)).toContain("faucet.solana.com");
    expect(words(`const t="ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW"`)).toEqual(["ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW"]);
    expect(words(`c.cluster=="string"?c.cluster:"devnet";const m={devnet:f,mainnet:g};w.clusterOk;x.canFaucet`)).toEqual([]);
    const deny = `[${DEVNET_OPERATIONAL_KEYS.map((k) => `"${k}"`).join(",")}]`;
    expect(words(`foreignOperationalKeys:${deny}`)).toEqual([]);
    for (const a of ALLOWED) expect(words(`D={devnet:"${a.text}"}`)).toEqual([]);
  });
  test("a build folder: the manifest must be the mainnet one, and the filled anchors must be in the client bundle", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdx-sweep-"));
    try {
      fs.mkdirSync(path.join(dir, "client/assets"), { recursive: true });
      fs.mkdirSync(path.join(dir, "server"), { recursive: true });
      fs.writeFileSync(path.join(dir, "client/assets/index-abc.js"), `const a="${A}";`);
      fs.writeFileSync(path.join(dir, "client/site.devnet.webmanifest"), webManifestText("devnet"));
      fs.writeFileSync(path.join(dir, "server/server.js"), "// a devnet comment is fine on the server\n");
      const kinds = sweep(dir, { anchors: { altA: A, altB: B } }).map((f: { kind: string; match: string }) => `${f.kind}:${f.match}`);
      expect(kinds).toContain("word:devnet");
      expect(kinds).toContain("manifest:site.devnet.webmanifest");
      expect(kinds).toContain("anchor:altB");
      expect(kinds).not.toContain("anchor:altA");
      expect(kinds.filter((k: string) => k.startsWith("word")).length).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mode manifest", () => {
  test("one file per mode; the mainnet text has no test words; the shared public/site.webmanifest is gone", () => {
    expect(manifestModeOf(undefined)).toBe("devnet");
    expect(manifestModeOf("mainnet")).toBe("mainnet");
    expect(manifestModeOf("sim")).toBe("sim");
    expect(manifestModeOf("anything")).toBe("devnet");
    expect(manifestFileName("mainnet")).toBe("site.mainnet.webmanifest");
    const main = JSON.parse(webManifestText("mainnet"));
    expect(main.description).not.toMatch(/test|devnet/i);
    expect(JSON.parse(webManifestText("devnet")).description).toContain("Solana devnet");
    expect(fs.existsSync(path.join(APP, "public/site.webmanifest"))).toBe(false);
    const root = fs.readFileSync(path.join(APP, "src/routes/__root.tsx"), "utf8");
    expect(root).toContain("manifestFileName(MODE)");
    expect(root).toContain('name: "mintdex-mode"');
  });
});

describe("devnet site (devnet.mintdex.fun) and the default API origin", () => {
  test("the devnet build talks to https://devnet.mintdex.fun once that host is live (mintdex.fun before); mainnet takes the anchors file's origin", () => {
    const devnetDefault = DEVNET_HOST_LIVE ? "https://devnet.mintdex.fun" : "https://mintdex.fun";
    expect(DEVNET_ANCHORS.chainApiOrigin).toBe(devnetDefault);
    expect(CHAIN_API_ORIGIN).toBe(process.env.VITE_CHAIN_API_ORIGIN?.replace(/\/+$/, "") || devnetDefault);
    expect(MAINNET_ANCHORS.chainApiOrigin).toBe("https://mintdex.fun");
  });
  test("host check; before the cutover the note does not claim mainnet is live", () => {
    expect(isDevnetSiteHost("devnet.mintdex.fun")).toBe(true);
    expect(isDevnetSiteHost("DEVNET.mintdex.fun")).toBe(true);
    expect(isDevnetSiteHost("mintdex.fun")).toBe(false);
    expect(isDevnetSiteHost("mintdex.higgsfield.app")).toBe(false);
    // Outside a request (tests) the host is unknown: not the devnet site until MAINNET_SITE_LIVE.
    expect(isDevnetTestSite()).toBe(MAINNET_SITE_LIVE);
    if (!MAINNET_SITE_LIVE) expect(DEVNET_SITE_NOTE.lead).not.toContain("mainnet");
    expect(JSON.stringify(DEVNET_SITE_NOTE)).not.toMatch(/[—–]/);
  });
});

describe("launch gate and exposure caps (launch-plan §1.6, §4.5)", () => {
  test("the Worker's caps win; null lifts them; no value means 2 SOL on mainnet and none on devnet", () => {
    const cfg = (x: object) => x as never;
    expect(launchCapsOf(cfg({ exposureCaps: { maxBidLamports: "1000000000", maxListPriceLamports: "3000000000" } }))).toEqual({
      maxBid: 1_000_000_000,
      maxListPrice: 3_000_000_000,
    });
    expect(launchCapsOf(cfg({ exposureCaps: { maxBidLamports: "2000000000", maxListPriceLamports: null } }))).toEqual({
      maxBid: 2_000_000_000,
      maxListPrice: Number.POSITIVE_INFINITY,
    });
    expect(launchCapsOf(cfg({ exposureCaps: { maxBidLamports: null, maxListPriceLamports: null } }))).toBeNull();
    expect(launchCapsOf(cfg({ cluster: "devnet" }))).toBeNull(); // devnet Worker without caps
    expect(capFromDetails({ capLamports: "2000000000", kind: "bid" })).toBe(2_000_000_000);
    expect(capFromDetails({ maxLamports: 1_500_000_000 })).toBe(1_500_000_000);
    expect(capFromDetails(undefined)).toBeNull();
    expect(launchCapsOf(null)).toBeNull(); // this test process is a devnet build
    expect(LAUNCH_CAP_DEFAULT_LAMPORTS).toBe(2_000_000_000);
    expect(capSol(2_000_000_000)).toBe("2");
    expect(capSol(500_000_000)).toBe("0.5");
    expect(launchGateOf(cfg({ launches: "allowlist" }))).toBe("allowlist");
    expect(launchGateOf(cfg({ launches: "closed" }))).toBe("closed");
    expect(launchGateOf(cfg({ launches: "weird" }))).toBe("open");
    expect(launchGateOf(null)).toBe("open");
    expect(launchNotice("open", null)).toEqual({ kind: "none", blocked: false });
    expect(launchNotice("allowlist", true)).toEqual({ kind: "none", blocked: false });
    expect(launchNotice("allowlist", false)).toEqual({ kind: "soon", blocked: true });
    expect(launchNotice("allowlist", null)).toEqual({ kind: "soon", blocked: false });
    expect(launchNotice("closed", true)).toEqual({ kind: "paused", blocked: true });
    expect(isExitOnly({ engine: "exit" })).toBe(true);
    expect(isExitOnly({ mode: "exit" })).toBe(true);
    expect(isExitOnly({ engine: "off" })).toBe(false);
    expect(isExitOnly(undefined)).toBe(false);
  });
});

describe("tiers in real USD from the chain config", () => {
  test("hold durations use the 200 ms target and the current Config rather than the old 400 ms assumption", () => {
    expect(holdTimeOf(9_000, "mainnet")).toBe("about 30 minutes");
    expect(holdTimeOf(18_000, "mainnet")).toBe("about an hour");
    expect(holdTimeOf(undefined, "mainnet")).toBe("about an hour");
    expect(holdTimeOf(150, "devnet")).toBe("about 30 seconds");
    expect(holdTimeOf(undefined, "devnet")).toBe("about 30 seconds");
    const planned = JSON.parse(fs.readFileSync(path.join(REPO, "chain/scripts/mainnet/mainnet-config.example.json"), "utf8"));
    expect(planned.evolve_hold_slots).toBe(MAINNET_DEFAULT_HOLD_SLOTS);
  });
  test("TIERS equal the mainnet Config thresholds ($15K to $1M), and the Config's own values win when served", () => {
    const example = JSON.parse(fs.readFileSync(path.join(REPO, "chain/scripts/mainnet/mainnet-config.example.json"), "utf8"));
    const thresholds = (example.tier_thresholds_usd as string[]).map(Number);
    expect(TIERS.slice(1).map((t) => t.minUsd)).toEqual(thresholds);
    expect(tierUsdOf(null)).toEqual([0, ...thresholds]);
    const moved = thresholds.map((v) => v * 2);
    expect(tierUsdOf({ thresholdsUsd: moved })).toEqual([0, ...moved]);
    expect(tierUsdOf({ thresholdsUsd: [1, 2, 3] })).toEqual([0, ...thresholds]);
    expect(usdPerLamportOf({ solUsdE6: "120000000", mcapMultiplier: 1 })).toBeCloseTo(120 / 1e9, 15);
  });
});

describe("mainnet copy, evaluated as a mainnet build", () => {
  const evalMainnet = () => {
    const script = `
      const c = await import("./src/lib/mintdex/copy.ts");
      const w = await import("./src/lib/chain/wallet-copy.ts");
      const e = await import("./src/lib/chain/env.ts");
      const t = await import("./src/lib/chain/tx-copy.ts");
      console.log(JSON.stringify({
        mode: c.MODE, cluster: e.APP_CLUSTER, origin: e.CHAIN_API_ORIGIN, net: [e.NET_NAME, e.NET_SHORT, e.SOL_WORD, e.ON_NET],
        modeCopy: c.MODE_COPY, chain: c.CHAIN_COPY, errors: c.CHAIN_ERRORS, wallet: { ...w.WALLET_COPY, connected: "", handleSaved: "" },
        faucets: c.DEVNET_FAUCETS, faucetUrl: w.FAUCET_URL, flow: { ...c.FLOW, welcome: "", maxSlippage: "", highImpact: "" },
        share: c.shareCoinText({ name: "Glorb", ticker: "GLORB" }), audit: c.AUDIT_LINE,
        sw: { ...c.SWITCH_COPY, capError: c.SWITCH_COPY.capError("2"), bidCapNote: c.SWITCH_COPY.bidCapNote("2"), listCapNote: c.SWITCH_COPY.listCapNote("2") },
        tx: [t.PHASE_LABEL, t.STEP_LABEL],
      }));`;
    const r = Bun.spawnSync([BUN, "-e", script], { cwd: APP, env: { ...process.env, VITE_MINTDEX_MODE: "mainnet" } });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return JSON.parse(r.stdout.toString().trim().split("\n").pop() as string);
  };
  test("no devnet, faucet, test-mode or test-SOL words; real-money notice, mainnet API, the audit line", () => {
    const m = evalMainnet();
    expect(m.mode).toBe("mainnet");
    expect(m.cluster).toBe("mainnet");
    expect(m.origin).toBe(MAINNET_ANCHORS.chainApiOrigin);
    expect(m.net).toEqual(["Solana mainnet", "Solana", "SOL", "on Solana"]);
    expect(m.faucets).toEqual([]);
    expect(m.faucetUrl).toBe("");
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(m);
    const all = strings.join("\n");
    expect(strings.length).toBeGreaterThan(150);
    expect(all).not.toMatch(/\b(devnet|faucets?|testnet)\b|test mode|test sol|×\s?100/i);
    expect(all).not.toMatch(/[—–]/);
    expect(m.chain.noValue).toContain("Real SOL");
    expect(m.errors.WRONG_NETWORK).toBe("Switch your wallet to Solana mainnet, then try again.");
    expect(m.errors.LAUNCHES_NOT_OPEN).toContain("Launches open soon");
    expect(m.errors.AMOUNT_ABOVE_LAUNCH_CAP).toBe("Early days: bids and listings are capped at 2 SOL for now.");
    expect(m.sw.engineExitOnly).toContain("Withdrawing card fees, cancelling bids and delisting cards still work");
    expect(m.audit).toBe("The MintDex card program has not had an external security audit yet. This line will be removed after one.");
    expect(m.share).toBe("Glorb ($GLORB) has a one-of-one card on MintDex. Whoever holds the card collects the coin's card fees.");
  });
  test("the mainnet Risks tab lists the audit line and the Terms carry their own date", () => {
    const legal = fs.readFileSync(path.join(APP, "src/routes/legal.tsx"), "utf8");
    expect(legal).toContain("...(IS_MAINNET ? [AUDIT_LINE] : [])");
    expect(legal).toMatch(/const UPDATED = IS_MAINNET \? "7 October 2026"/);
    expect(legal).not.toMatch(/[—–]/);
  });
});
