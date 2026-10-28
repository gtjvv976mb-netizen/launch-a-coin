// The mainnet build guard (refs/mainnet/fix-plan.md §4.4, design-compat §6.4, launch-plan §1.4 and §3.3). vite.config.ts
// runs it whenever VITE_MINTDEX_MODE=mainnet: the build fails unless every rule below holds, so the platform build
// (which sets none of these) is always devnet and a mainnet bundle can never ship with a placeholder, a devnet anchor, a
// devnet API or a keyed or public browser RPC. The same rules check the generator's output
// (app/scripts/mainnet-anchors.mjs), so the fill step can never write a file the build would refuse.
//
// Pure and import free (no Vite, no DOM, no SDK): vite.config.ts, the generator (plain node) and the tests run it
// directly. Owner: app.

export const MAINNET_PROGRAM_ID = "4HTSBYfgm5os2kBwFVBv5cd4mPetNmS32Cb4r3YViDon";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
/** The Config PDA of the program id (the same address on every cluster). */
export const MAINNET_CONFIG_ADDRESS = "FXD57eXLpeXFbPju1N7JkWUSg7QfVfHN8mJq89RcxWYV";
/** The value every unfilled field of anchors.mainnet.ts carries. */
export const PLACEHOLDER_PREFIX = "REPLACE_";

/**
 * Public mainnet endpoints that must never be the browser RPC: per-IP rate limits and "not for production apps", so a
 * user on a shared, mobile or CGNAT address would get RPC_UNAVAILABLE and the client would refuse to sign
 * (launch-plan §1.4 "Browser RPC").
 */
export const PUBLIC_MAINNET_RPC_HOSTS: readonly string[] = ["api.mainnet-beta.solana.com", "api.mainnet.solana.com"];

/**
 * Devnet values a mainnet anchor may never equal: the devnet genesis, ALT A and B, the devnet treasury, and the rest of
 * the devnet operational keys (the SDK's DEVNET_OPERATIONAL_KEYS, chain/sdk/src/cluster.ts; a test keeps the two lists
 * equal).
 */
export const DEVNET_VALUES: readonly string[] = [
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "GSsMkMj7BKMvbPsbcJggveYZEt38o9ERDs8zYHrvURfj",
  "ELqqNK1m7nFPvV6s3maE5BYxfxgEJR5VMWqjaCgzHLD",
  "ECzWJtsMkk1pasojfWbtDm48YHcBNKXqZ7Kaef4bAepW",
  "5ZirDYYECSxPV2nxn5icHiPJqxZKQJZpt4TBVzAhqEgg",
  "BiHs2Ds6u3tHrmD5CzoHAyR79uC5VhdPH51ii4Y7dFtQ",
  "HGXEqHkPAcK7vfGZxCKG1UbXdQsZrhuBKuMUKiga83ER",
  "83secuJhm1zhSXkMuZ4HJa7BSChT9m7dUC4ywH95pBua",
  "3B2ZV8zcJX6QEPWGEbDssnMtw7wRruVxZtnxj9tkCf1R",
];

/** Everything a mainnet build takes from outside the code (the generated src/lib/chain/anchors.mainnet.ts). */
export interface MainnetAnchors {
  readonly cluster: string;
  readonly genesisHash: string;
  readonly programId: string;
  readonly configAddress: string;
  readonly altA: string;
  readonly altB: string;
  readonly altC: string;
  readonly altTreasury: string;
  readonly chainApiOrigin: string;
  readonly publicRpc: string;
  readonly walletChain: string;
  readonly explorerQuery: string;
}

export interface BuildEnv {
  VITE_MINTDEX_MODE?: string;
  VITE_MINTDEX_MAINNET_ACK?: string;
  VITE_CHAIN_API_ORIGIN?: string;
  VITE_SOLANA_PUBLIC_RPC?: string;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** True when `s` is base58 that decodes to exactly 32 bytes (a Solana public key or PDA). */
export function isBase58Pubkey(s: unknown): boolean {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  let bytes = 0;
  while (n > 0n) {
    n >>= 8n;
    bytes++;
  }
  let zeros = 0;
  for (const ch of s) {
    if (ch !== "1") break;
    zeros++;
  }
  return bytes + zeros === 32;
}

/** The same shape env.ts accepts at runtime for a browser RPC: https, a host, an optional path, no query or fragment. */
const RPC_URL = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]*)*$/;
const API_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;

/**
 * Why `url` cannot be the mainnet browser RPC, or null. It ships in the bundle, so it must be keyless: a Helius secure
 * RPC URL (keyless, per-IP limited) or a provider endpoint locked to mintdex.fun with a token in the path. Never a key in
 * the query, never devnet or testnet, never the public api.mainnet-beta.solana.com.
 */
export function publicRpcProblem(url: unknown): string | null {
  const v = typeof url === "string" ? url.trim() : "";
  if (!v || v.includes(PLACEHOLDER_PREFIX)) return "the browser RPC is not filled in (the user's keyless endpoint from launch-plan U3)";
  if (/[?&](api[-_]?key|key|token)=/i.test(v)) return "the browser RPC carries a key in its query string; use a keyless URL (a path token is fine)";
  if (!RPC_URL.test(v)) return "the browser RPC must be an https URL with a lowercase host, an optional path and no query string or fragment";
  if (/devnet|testnet/i.test(v)) return "the browser RPC points at devnet or testnet";
  const host = new URL(v).hostname;
  if (PUBLIC_MAINNET_RPC_HOSTS.includes(host)) {
    return `the browser RPC is the public ${host} (rate limited per IP and not for production); use the keyless endpoint from launch-plan U3`;
  }
  return null;
}

/** Why `origin` cannot be the mainnet chain API origin, or null. */
export function chainApiOriginProblem(origin: unknown): string | null {
  const v = typeof origin === "string" ? origin.trim() : "";
  if (!v || v.includes(PLACEHOLDER_PREFIX)) return "the chain API origin is not filled in";
  if (!API_ORIGIN.test(v)) return "the chain API origin must be an https origin (no path, no trailing slash)";
  if (/devnet|testnet|localhost|127\.0\.0\.1/i.test(v)) return "the chain API origin points at devnet or a local server";
  return null;
}

/** Problems with a set of mainnet anchors (empty = a mainnet build may use them). */
export function anchorProblems(a: MainnetAnchors): string[] {
  const out: string[] = [];
  const placeholders = Object.entries(a)
    .filter(([, v]) => typeof v === "string" && v.includes(PLACEHOLDER_PREFIX))
    .map(([k]) => k);
  if (placeholders.length) {
    out.push(
      `anchors.mainnet.ts still has REPLACE_ placeholders (${placeholders.join(", ")}): run app/scripts/mainnet-anchors.mjs --from deployed.mainnet.json (the fill step)`,
    );
  }
  if (a.cluster !== "mainnet") out.push(`anchors.mainnet.ts cluster must be "mainnet"`);
  if (a.genesisHash !== MAINNET_GENESIS_HASH) out.push("anchors.mainnet.ts must pin the mainnet genesis hash");
  if (a.programId !== MAINNET_PROGRAM_ID) out.push("anchors.mainnet.ts programId must be the MintDex program id");
  if (a.configAddress !== MAINNET_CONFIG_ADDRESS) out.push("anchors.mainnet.ts configAddress must be the Config PDA FXD57e...");
  if (a.walletChain !== "solana:mainnet") out.push(`anchors.mainnet.ts walletChain must be "solana:mainnet"`);
  if (a.explorerQuery !== "") out.push("anchors.mainnet.ts explorerQuery must be empty (no cluster query on mainnet)");
  const keys: Array<[string, string]> = [
    ["altA", a.altA],
    ["altB", a.altB],
    ["altC", a.altC],
    ["altTreasury", a.altTreasury],
  ];
  for (const [k, v] of keys) {
    if (v.includes(PLACEHOLDER_PREFIX)) continue;
    if (!isBase58Pubkey(v)) out.push(`anchors.mainnet.ts ${k} is not a 32-byte base58 address`);
    else if (DEVNET_VALUES.includes(v)) out.push(`anchors.mainnet.ts ${k} is a devnet address`);
    else if ([MAINNET_PROGRAM_ID, MAINNET_CONFIG_ADDRESS].includes(v)) out.push(`anchors.mainnet.ts ${k} equals the program id or the Config`);
  }
  const alts = [a.altA, a.altB, a.altC].filter((v) => !v.includes(PLACEHOLDER_PREFIX));
  if (new Set(alts).size !== alts.length) out.push("anchors.mainnet.ts altA, altB and altC must be three different tables");
  if (alts.includes(a.altTreasury)) out.push("anchors.mainnet.ts altTreasury cannot be one of the lookup tables");
  const origin = chainApiOriginProblem(a.chainApiOrigin);
  if (origin && !a.chainApiOrigin.includes(PLACEHOLDER_PREFIX)) out.push(`anchors.mainnet.ts: ${origin}`);
  const rpc = publicRpcProblem(a.publicRpc);
  if (rpc && !a.publicRpc.includes(PLACEHOLDER_PREFIX)) out.push(`anchors.mainnet.ts: ${rpc}`);
  return out;
}

/**
 * Problems with a mainnet build (empty = allowed). The build takes its API origin, browser RPC, trust anchors and
 * addresses from `anchors` (the generated file) only; a VITE_CHAIN_API_ORIGIN or VITE_SOLANA_PUBLIC_RPC in the build
 * environment is allowed only when it equals the file, so two sources can never disagree.
 */
export function mainnetBuildProblems(env: BuildEnv, anchors: MainnetAnchors): string[] {
  const out: string[] = [];
  if (env.VITE_MINTDEX_MAINNET_ACK !== MAINNET_PROGRAM_ID) {
    out.push("VITE_MINTDEX_MAINNET_ACK must equal the MintDex program id (an explicit acknowledgement of a real-money build)");
  }
  out.push(...anchorProblems(anchors));
  const origin = (env.VITE_CHAIN_API_ORIGIN ?? "").trim();
  if (origin && origin.replace(/\/+$/, "") !== anchors.chainApiOrigin) {
    out.push(
      `VITE_CHAIN_API_ORIGIN (${origin}) differs from anchors.mainnet.ts chainApiOrigin (${anchors.chainApiOrigin}); the mainnet build reads it from the generated file, so remove it or make them equal`,
    );
  }
  const rpc = (env.VITE_SOLANA_PUBLIC_RPC ?? "").trim();
  if (rpc && rpc !== anchors.publicRpc) {
    out.push(
      "VITE_SOLANA_PUBLIC_RPC differs from anchors.mainnet.ts publicRpc; the mainnet build reads it from the generated file, so remove it or make them equal",
    );
  }
  return out;
}
