// The app's mintdex-chain client (refs/chain/m3-contract.md §7): typed reads, Sign-In With Solana, media upload,
// and every transaction flow as build → verify (SDK verifier, before the wallet opens) → sign → submit → confirm.
//
// Owner app:wallet. The exported names, parameters and return types are FROZEN by the contract (app:pages codes
// against them). How it works:
//   - SSR safe: no window or wallet access at module top level; reads work on the server (absolute chainApiUrl,
//     1.5 s timeout during SSR, never fresh=1, /wallets/:address or the status routes) and in the browser;
//   - JSON amounts are decimal strings on the wire and bigint in this module's inputs;
//   - this module is small (main chunk): the transaction flows (flows.ts), the verifier (verify.ts), the trust reads
//     (trust.ts), the SDK builders and noble load lazily on the first transaction (C10);
//   - verifyTransaction runs on the exact bytes the wallet will sign, with lookup tables from the SDK's fixed
//     38-entry list (indexes ≥ 38 rejected) and trust anchors read from the public devnet RPC (§7.3); a failed
//     check throws ChainClientError VERIFY_FAILED and the wallet is never asked to sign (C8).

import type {
  ApiActivityResponse,
  ApiCardResponse,
  ApiChartRange,
  ApiChartResponse,
  ApiCoinDetailResponse,
  ApiCoinListQuery,
  ApiCoinListResponse,
  ApiConfig,
  ApiEffectsSummary,
  ApiError,
  ApiErrorCode,
  ApiEvolveQueueResponse,
  ApiHealthResponse,
  ApiHomeResponse,
  ApiLaunchStatusResponse,
  ApiMarketResponse,
  ApiMediaResponse,
  ApiOk,
  ApiRevResponse,
  ApiRpcResponse,
  ApiSession,
  ApiSigningMode,
  ApiTradesQuery,
  ApiTradesResponse,
  ApiTxBuildResponse,
  ApiTxKind,
  ApiTxRequestMap,
  ApiTxStatusResponse,
  ApiTxSubmitResponse,
  ApiWalletResponse,
} from "@mintdex/chain-sdk/api";
import { API_ROUTES } from "@mintdex/chain-sdk/api";

import { APP_CLUSTER, chainApiUrl } from "./env";
import { FIXPACK_COPY } from "../mintdex/copy";
import { ChainClientError, isChainError } from "./errors";
import { getWalletSnapshot, subscribeWallet } from "./wallet";

// ---------------------------------------------------------------- errors

// The class lives in errors.ts (shared with the lazy chunks without an import cycle); this is its public home.
export { ChainClientError, type ChainClientErrorCode } from "./errors";

// ---------------------------------------------------------------- transport

type RouteId = keyof typeof API_ROUTES;

const onServer = () => typeof window === "undefined";
/** SSR reads give up quickly and leave the data to the browser: a slow chain API never blocks a page (§7.1). */
const SSR_TIMEOUT_MS = 1_500;
const BROWSER_TIMEOUT_MS = 20_000;
/** A path segment: base58 (mints, addresses), base62 intent ids, tx kinds ("complete-curve"). */
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

export interface ApiCallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** JSON body, or FormData (media upload). */
  body?: unknown;
  /** Bearer session token (SIWS). */
  token?: string;
  timeoutMs?: number;
}

/**
 * One /api/chain request. The route table builds the URL; the envelope becomes the value or a ChainClientError with
 * the API's code. Internal: flows.ts uses it for the session routes (launch prepare and finalize).
 */
export async function apiCall<T extends object>(id: RouteId, o: ApiCallOptions = {}): Promise<ApiOk<T>> {
  const def = API_ROUTES[id];
  const path = def.path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
    const v = o.params?.[key];
    if (!v || !SEGMENT.test(v)) throw new ChainClientError("BAD_REQUEST", `Missing or malformed ${key}.`);
    return v;
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(o.query ?? {})) {
    if (v !== undefined && v !== null && v !== "" && v !== false) qs.set(k, String(v));
  }
  const q = qs.toString();
  const url = chainApiUrl(path) + (q ? `?${q}` : "");
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (def.method === "POST") {
    if (typeof FormData !== "undefined" && o.body instanceof FormData) body = o.body;
    else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.body ?? {});
    }
  }
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? (onServer() ? SSR_TIMEOUT_MS : BROWSER_TIMEOUT_MS));
  let status = 0;
  let json: unknown = null;
  try {
    const res = await fetch(url, { method: def.method, headers, body, signal: ctl.signal });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch {
    throw new ChainClientError(
      "NETWORK",
      ctl.signal.aborted ? "The chain API did not answer in time." : "Could not reach the chain API.",
    );
  } finally {
    clearTimeout(timer);
  }
  const env = json as { ok?: unknown; error?: ApiError } | null;
  if (env && env.ok === true) return env as ApiOk<T>;
  if (env && env.ok === false && env.error && typeof env.error.code === "string") {
    throw new ChainClientError(env.error.code, env.error.message || "The chain API refused the request.", {
      status,
      apiError: env.error,
    });
  }
  throw new ChainClientError("NETWORK", `Unexpected answer from the chain API (${status}).`, { status });
}

/** A read that found nothing: 404, a malformed mint, or a segment this client refused to send. */
function isNotFound(e: unknown): boolean {
  return isChainError(e) && (e.status === 404 || e.code === "INVALID_MINT" || (e.code === "BAD_REQUEST" && e.status === 0));
}

/** Standard base64 of bytes (wallet signatures, signed transactions). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * Signing, verifying and sign-in run in the browser only, so the server bundle never contains them: Vite replaces
 * import.meta.env.SSR with true there and these imports drop out. This also keeps the trust constants (env.ts
 * TRUST_ANCHORS, PUBLIC_RPC_URL) out of the server's chunks: a non-function export of the server entry chunk makes
 * workerd refuse to start the Worker ("Incorrect type for map entry").
 */
function browserOnly(): Promise<never> {
  return Promise.reject(new ChainClientError("BAD_REQUEST", "This runs in the browser only."));
}

// ---------------------------------------------------------------- reads (SSR and browser)

export async function getHealth(): Promise<ApiHealthResponse> {
  return apiCall<ApiHealthResponse>("health");
}
export async function getConfig(): Promise<ApiConfig> {
  return apiCall<ApiConfig>("config");
}
/** GET /rev: has anything changed since `rev` (the devnet twin of the sim's checkRev). */
export async function checkRev(rev?: string): Promise<ApiRevResponse> {
  return apiCall<ApiRevResponse>("rev", { query: { rev } });
}
export async function getHome(): Promise<ApiHomeResponse> {
  return apiCall<ApiHomeResponse>("home");
}
export async function listCoins(query: ApiCoinListQuery = {}): Promise<ApiCoinListResponse> {
  const { sort, q, tier, limit, cursor } = query;
  return apiCall<ApiCoinListResponse>("coins", { query: { sort, q, tier: tier || undefined, limit, cursor } });
}
/** null when the mint has no MintDex card (404 COIN_NOT_FOUND). `fresh` asks the Worker to re-read chain first. */
export async function getCoin(mint: string, opts: { fresh?: boolean } = {}): Promise<ApiCoinDetailResponse | null> {
  try {
    // SSR never asks for fresh=1 (it is rate limited per IP, and SSR shares a few egress IPs, §3.3).
    return await apiCall<ApiCoinDetailResponse>("coin", { params: { mint }, query: { fresh: opts.fresh && !onServer() ? 1 : undefined } });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
export async function getCoinTrades(mint: string, query: ApiTradesQuery = {}): Promise<ApiTradesResponse> {
  return apiCall<ApiTradesResponse>("coinTrades", { params: { mint }, query: { before: query.before, limit: query.limit } });
}
export async function getCoinChart(mint: string, range: ApiChartRange = "24h"): Promise<ApiChartResponse> {
  return apiCall<ApiChartResponse>("coinChart", { params: { mint }, query: { range } });
}
export async function getCard(mint: string): Promise<ApiCardResponse | null> {
  try {
    return await apiCall<ApiCardResponse>("card", { params: { mint } });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
export async function getMarket(): Promise<ApiMarketResponse> {
  return apiCall<ApiMarketResponse>("market");
}
export async function getActivity(limit = 20): Promise<ApiActivityResponse> {
  return apiCall<ApiActivityResponse>("activity", { query: { limit } });
}
/** Browser only (§3.3: SSR never calls /wallets/:address; it is limited per IP and SSR shares a few IPs). */
export async function getWallet(address: string): Promise<ApiWalletResponse> {
  if (onServer()) throw new ChainClientError("BAD_REQUEST", "Wallet reads run in the browser only.");
  return apiCall<ApiWalletResponse>("wallet", { params: { address } });
}
/** Lamports of `address` through POST /api/chain/rpc getBalance. */
export async function getBalance(address: string): Promise<bigint> {
  const r = await apiCall<ApiRpcResponse>("rpc", {
    body: { method: "getBalance", params: [address, { commitment: "confirmed" }] },
  });
  const v = (r.result as { value?: unknown } | null)?.value;
  if ((typeof v !== "number" && typeof v !== "string") || !/^\d+$/.test(String(v))) {
    throw new ChainClientError("RPC_UNAVAILABLE", "The balance read returned no value.");
  }
  return BigInt(v);
}

// ---------------------------------------------------------------- Sign-In With Solana (browser only)

// The flows (nonce, signMessage, verify, handle, upload) live in the lazy auth.ts; only the session store is here,
// because getSession() is synchronous. Sessions: in memory and in sessionStorage per wallet address (per tab, never
// localStorage, §3.2), dropped when the wallet account changes or disconnects.
const auth = () => (import.meta.env.SSR ? browserOnly() : import("./auth"));

/**
 * POST /auth/nonce → wallet solana:signMessage over the exact returned text → POST /auth/verify. The session is kept
 * in memory and sessionStorage (per tab, never localStorage), keyed by wallet address; switching accounts drops it.
 */
export async function signIn(): Promise<ApiSession> {
  watchWalletForSessions();
  return (await auth()).signIn();
}
/** The current wallet's unexpired session, or null. */
export function getSession(): ApiSession | null {
  if (onServer()) return null;
  const address = getWalletSnapshot().address;
  if (!address) return null;
  watchWalletForSessions();
  const s = sessionFor(address);
  if (!s) return null;
  // A session about to expire is as good as gone: sign in again rather than fail halfway through a launch.
  if (!(Date.parse(s.expiresAt) > Date.now() + 60_000)) {
    dropSession(address);
    return null;
  }
  return s;
}
export async function signOut(): Promise<void> {
  return (await auth()).signOut();
}
/** POST /wallets/handle (signs in first when needed). */
export async function setHandle(handle: string): Promise<{ address: string; handle: string }> {
  watchWalletForSessions();
  return (await auth()).setHandle(handle);
}
/** POST /media (signs in first when needed). */
export async function uploadMedia(file: Blob): Promise<ApiMediaResponse> {
  watchWalletForSessions();
  return (await auth()).uploadMedia(file);
}
/** Runs `fn` with a session token, signing in first when needed and once more if the server says it expired. */
export async function withSession<T>(fn: (token: string) => Promise<T>): Promise<T> {
  watchWalletForSessions();
  return (await auth()).withSession(fn);
}

const sessions = new Map<string, ApiSession>();
const sessionKey = (address: string) => `mintdex.chain.session.v1:${address}`;
let watching = false;

function watchWalletForSessions() {
  if (watching || onServer()) return;
  watching = true;
  let last = getWalletSnapshot().address;
  subscribeWallet(() => {
    const now = getWalletSnapshot().address;
    if (now === last) return;
    if (last) dropSession(last);
    last = now;
  });
}

/** For auth.ts: remember a session (memory and sessionStorage). */
export function keepSession(s: ApiSession): void {
  watchWalletForSessions();
  sessions.set(s.address, s);
  try {
    sessionStorage.setItem(sessionKey(s.address), JSON.stringify(s));
  } catch {
    // Storage blocked (private window): the session lives in memory for this page.
  }
}

/** For auth.ts: forget a wallet's session. */
export function dropSession(address: string): void {
  sessions.delete(address);
  try {
    sessionStorage.removeItem(sessionKey(address));
  } catch {
    // ignore
  }
}

/** The stored session of `address` (expired or not), from memory or sessionStorage. */
export function sessionFor(address: string): ApiSession | null {
  const mem = sessions.get(address);
  if (mem) return mem;
  try {
    const raw = sessionStorage.getItem(sessionKey(address));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<ApiSession>;
    if (typeof s.token !== "string" || s.address !== address || typeof s.expiresAt !== "string") return null;
    const out: ApiSession = { token: s.token, address, handle: typeof s.handle === "string" ? s.handle : null, expiresAt: s.expiresAt };
    sessions.set(address, out);
    return out;
  } catch {
    return null;
  }
}

/** A wallet call failed: keep our own errors, and treat anything else as a decline (wallets reject in many shapes). */
export function walletFailure(e: unknown): ChainClientError {
  if (e instanceof ChainClientError) return e;
  const msg = e instanceof Error && e.message ? e.message : "The wallet did not sign.";
  return new ChainClientError("WALLET_REJECTED", msg);
}

// ---------------------------------------------------------------- crank queue

/** "Unlock design": queues the watchdog for this card (no wallet signature, card-program-v2 §7.3). */
export async function queueEvolve(mint: string): Promise<ApiEvolveQueueResponse> {
  return apiCall<ApiEvolveQueueResponse>("cardEvolve", { params: { mint }, body: {} });
}

// ---------------------------------------------------------------- transaction flows (browser only)

export type TxStep = "signing-in" | "uploading" | "building" | "verifying" | "signing" | "submitting" | "confirming" | "confirmed";

export interface TxProgress {
  step: TxStep;
  intentId?: string;
  signature?: string;
  /** Present from "verifying" on: what the confirm UI shows. */
  summary?: ApiEffectsSummary;
}
export type OnTxStep = (progress: TxProgress) => void;

export interface TxResult {
  intentId: string;
  signature: string;
  summary: ApiEffectsSummary;
  /** Slot of the confirmation (null when only "processed" was seen before returning). */
  slot: number | null;
}

export interface LaunchInput {
  name: string;
  symbol: string;
  description: string;
  image: Blob;
  twitter?: string;
  website?: string;
  telegram?: string;
  devBuyLamports: bigint;
  slippageBps: number;
}
export interface LaunchResult extends TxResult {
  mint: string;
  mode: ApiSigningMode;
  /** The dev buy went as a second transaction (ApiLaunchPrepareResponse.devBuySplit): how it went. */
  devBuy?: { split: true; ok: boolean; signature?: string; error?: string };
}

/**
 * Sign in → upload art → POST /launch/prepare (server_first, or wallet_first when the wallet is configured so or a
 * previous attempt got WALLET_REWROTE_TX) → verify (intent "launch", requirePresignedBy [mint] when server_first) →
 * signTransaction → POST /launch/finalize → poll GET /launch/:intentId until confirmed and coinIndexed.
 */
export async function launchCoin(input: LaunchInput, onStep?: OnTxStep): Promise<LaunchResult> {
  return (await flows()).launchCoin(input, onStep);
}

export interface BuyInput {
  mint: string;
  solLamports: bigint;
  slippageBps: number;
}
export interface SellInput {
  mint: string;
  tokenAmount: bigint;
  slippageBps: number;
}

/** Curve or PumpSwap buy (the Worker picks the venue from the coin's state; verified as pump_buy or pamm_buy). */
export async function buy(input: BuyInput, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).buy(input, onStep);
}
export async function sell(input: SellInput, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).sell(input, onStep);
}
/** "Complete the curve": buys exactly the remaining real tokens when fewer than API_LIMITS.dustTokenThreshold are left. */
export async function completeCurve(input: { mint: string; slippageBps: number }, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).completeCurve(input, onStep);
}
export async function withdrawFees(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).withdrawFees(input, onStep);
}
export async function collectFees(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).collectFees(input, onStep);
}
/** Place, raise or lower: `amountLamports` is the new total bid. */
export async function placeBid(input: { mint: string; amountLamports: bigint }, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).placeBid(input, onStep);
}
export async function cancelBid(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).cancelBid(input, onStep);
}
/** Seller accepts `bidder`'s bid of `minAmountLamports` (the amount the seller saw). FEES_BELOW_FLOOR: rebuild once, then ask again. */
export async function acceptBid(
  input: { mint: string; bidder: string; minAmountLamports: bigint },
  onStep?: OnTxStep,
): Promise<TxResult> {
  return (await flows()).acceptBid(input, onStep);
}
/** New listing or re-price. `expiresAt` unix seconds, 0 = never; `voidOnEvolve` defaults on in the UI. */
export async function listCard(
  input: { mint: string; priceLamports: bigint; expiresAt: number; voidOnEvolve: boolean },
  onStep?: OnTxStep,
): Promise<TxResult> {
  return (await flows()).listCard(input, onStep);
}
export async function delistCard(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return (await flows()).delistCard(input, onStep);
}
/** `expectedPriceLamports` is the listing price the buyer saw; `cancelOwnBid` when the buyer has a bid on this card. */
export async function buyNow(
  input: { mint: string; expectedPriceLamports: bigint; cancelOwnBid: boolean },
  onStep?: OnTxStep,
): Promise<TxResult> {
  return (await flows()).buyNow(input, onStep);
}

/** The transaction machinery (verifier, SDK builders, noble) is a lazy chunk, loaded on the first transaction. */
/**
 * Every transaction flow loads through here: first the server-cluster check (compat §6.4: a devnet build against a
 * mainnet API, or the reverse, refuses with WRONG_NETWORK before anything is built; ApiConfig.cluster is display data
 * and only ever stops a flow, never feeds the verifier), then the lazy flows chunk.
 */
const flows = async () => {
  if (import.meta.env.SSR) return browserOnly();
  await assertServerCluster();
  return import("./flows");
};

let serverCluster: Promise<string | null> | null = null;
export async function assertServerCluster(): Promise<void> {
  if (!serverCluster) {
    serverCluster = getConfig()
      .then((c) => (typeof c.cluster === "string" ? c.cluster : "devnet"))
      .catch(() => {
        serverCluster = null;
        return null;
      });
  }
  const c = await serverCluster;
  if (c !== null && c !== APP_CLUSTER) throw new ChainClientError("WRONG_NETWORK", FIXPACK_COPY.wrongServer(APP_CLUSTER));
}

/** Test helper: forgets the cached server cluster. */
export function resetServerCluster(): void {
  serverCluster = null;
}

// ---------------------------------------------------------------- lower level (tests, the flows above)

export async function buildTx<K extends ApiTxKind>(kind: K, request: ApiTxRequestMap[K]): Promise<ApiTxBuildResponse<K>> {
  return apiCall<ApiTxBuildResponse<K>>("txBuild", { params: { kind }, body: request });
}

export interface VerifyOutcome {
  ok: boolean;
  /** The verifier's reasons when !ok. */
  errors: string[];
  /** SDK TxSummary.maxPayerSpendLamports of the exact bytes. */
  maxPayerSpendLamports: bigint;
  /** The checks of §7.3 that compare the build's params and summary with what the user typed. */
  mismatches: string[];
}

/** Runs the SDK verifier and the §7.3 consistency checks on a build, for `request` as the user typed it (C8). */
export async function verifyTxBuild<K extends ApiTxKind>(
  kind: K,
  request: ApiTxRequestMap[K],
  build: ApiTxBuildResponse<K>,
): Promise<VerifyOutcome> {
  return (await (import.meta.env.SSR ? browserOnly() : import("./verify"))).verifyTxBuild(kind, request, build);
}

export async function submitTx(intentId: string, signedTxBase64: string): Promise<{ signature: string }> {
  const r = await apiCall<ApiTxSubmitResponse>("txSubmit", { body: { intentId, tx: signedTxBase64 } });
  return { signature: r.signature };
}
export async function getTxStatus(intentId: string): Promise<ApiTxStatusResponse> {
  return apiCall<ApiTxStatusResponse>("txStatus", { params: { intentId } });
}
export async function getLaunchStatus(intentId: string): Promise<ApiLaunchStatusResponse> {
  return apiCall<ApiLaunchStatusResponse>("launchStatus", { params: { intentId } });
}
