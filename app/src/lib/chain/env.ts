// Where the chain app finds the mintdex-chain API and its public RPC (refs/chain/m3-contract.md §1.2), and the trust
// anchors of its cluster (refs/mainnet/fix-plan.md §4.4). Build-time constants only (no window access), so SSR, the
// client and the security headers agree. The cluster comes from mode.ts (VITE_MINTDEX_MODE): the platform build is
// devnet, and only a guarded mainnet build (vite.config.ts) selects the mainnet anchors.
//
// Mainnet: the API origin, the browser RPC and every address come from the generated anchors.mainnet.ts only
// (app/scripts/mainnet-anchors.mjs, refs/mainnet/app-mainnet.md); the build guard has already refused placeholders and
// any VITE_ value that disagrees with that file. Devnet: anchors.devnet.ts, with VITE_CHAIN_API_ORIGIN and
// VITE_SOLANA_PUBLIC_RPC as overrides for local work.

import { CLUSTER, IS_CHAIN } from "../mintdex/mode";
import { DEVNET_ANCHORS } from "./anchors.devnet";
import { MAINNET_ANCHORS } from "./anchors.mainnet";

/** The anchor set of this build (the other set is dropped from the bundle: CLUSTER is a literal). */
const ANCHORS = CLUSTER === "mainnet" ? MAINNET_ANCHORS : DEVNET_ANCHORS;

/** The build's default chain API origin: https://devnet.mintdex.fun on devnet, the anchors file's on mainnet. */
export const DEFAULT_CHAIN_API_ORIGIN: string = ANCHORS.chainApiOrigin;
export const DEFAULT_PUBLIC_RPC: string = ANCHORS.publicRpc;

const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
/** Local wrangler dev only (the chain Worker on 127.0.0.1:8788). */
const LOCAL_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;

function pickOrigin(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  return HTTPS_ORIGIN.test(v) || LOCAL_ORIGIN.test(v) ? v : fallback;
}

/** Origin of the chain API for both SSR fetches and the browser. Mainnet: the anchors file, never an env override. */
export const CHAIN_API_ORIGIN: string =
  CLUSTER === "mainnet" ? MAINNET_ANCHORS.chainApiOrigin : pickOrigin(import.meta.env.VITE_CHAIN_API_ORIGIN, DEFAULT_CHAIN_API_ORIGIN);

/**
 * The public RPC for the browser's trust reads (Config, GlobalConfig, curve, fee legs). Never a keyed URL. Mainnet: the
 * keyless, origin-locked endpoint of the anchors file (launch-plan §1.4), never the public api.mainnet-beta endpoint.
 */
export const PUBLIC_RPC_URL: string =
  CLUSTER === "mainnet"
    ? MAINNET_ANCHORS.publicRpc
    : (() => {
        const v = (import.meta.env.VITE_SOLANA_PUBLIC_RPC ?? "").trim();
        return /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]*)*$/.test(v) && !/[?&](api[-_]?key|key|token)=/i.test(v)
          ? v
          : DEFAULT_PUBLIC_RPC;
      })();

/**
 * Extra CSP origins for local devnet builds (security-headers.server.ts adds them to connect-src, img-src and
 * media-src): the local chain API and the art it serves under /img/. Nothing in production (those directives already
 * allow 'self' and https:). Empty unless the app is in devnet mode with a local chain API origin.
 */
export const DEV_CONNECT_SRC: readonly string[] =
  IS_CHAIN && CLUSTER === "devnet" && LOCAL_ORIGIN.test(CHAIN_API_ORIGIN) ? [CHAIN_API_ORIGIN] : [];

/** Absolute URL of an /api/chain path (`path` starts with "/api/chain/"). */
export function chainApiUrl(path: string): string {
  return `${CHAIN_API_ORIGIN}${path}`;
}

/** The Wallet Standard chain every signing request names (the build's cluster). */
export const SOLANA_CHAIN: "solana:devnet" | "solana:mainnet" = ANCHORS.walletChain;

/** The build's cluster (the app compares it with ApiConfig.cluster and refuses to sign on a mismatch: WRONG_NETWORK). */
export const APP_CLUSTER: "devnet" | "mainnet" = ANCHORS.cluster;

/** "Solana devnet" / "Solana mainnet" in sentences. */
export const NET_NAME = `Solana ${ANCHORS.cluster}`;
/** "devnet SOL" on devnet, "SOL" on mainnet (no faucet or test words on mainnet, compat §6.4). */
export const SOL_WORD = ANCHORS.cluster === "mainnet" ? "SOL" : "devnet SOL";
/** "on devnet" / "on Solana" for short status lines. */
export const ON_NET = ANCHORS.cluster === "mainnet" ? "on Solana" : "on devnet";
/** "Devnet" / "Solana" at the start of a status line ("Solana did not answer"). */
export const NET_SHORT = ANCHORS.cluster === "mainnet" ? "Solana" : "Devnet";

/**
 * Trust anchors for the client's verifier (refs/chain/m3-contract.md §7.3, R21). The verifier takes these constants
 * and its own public RPC reads, NEVER the Worker's ApiConfig values (programId, configAddress, altA, altB, treasury,
 * publicRpcUrl there are display only). trust.ts calls getGenesisHash() on PUBLIC_RPC_URL once per session and
 * refuses to verify or sign unless it equals `genesisHash`.
 */
export const TRUST_ANCHORS = {
  genesisHash: ANCHORS.genesisHash,
  programId: ANCHORS.programId,
  configAddress: ANCHORS.configAddress,
  altA: ANCHORS.altA,
  altB: ANCHORS.altB,
  /** The spare table C (admin B6): accepted when its prefix matches; "" = none. */
  altC: ANCHORS.altC,
  altTreasury: ANCHORS.altTreasury,
} as const;

/** Solana Explorer link on the build's cluster (no cluster query on mainnet). */
export function explorerUrl(kind: "address" | "tx", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}${ANCHORS.explorerQuery}`;
}
