import { MAINNET_GENESIS_HASH } from "../../chain/build-guard";
import type { LiveReadiness } from "./types";

const CACHE_MS = 15_000, TIMEOUT_MS = 4_000, MAX_RESPONSE_BYTES = 16_384;
type RpcStatus = "unconfigured" | "wrong_network" | "unavailable" | "healthy";
type RpcReason = "http_error" | "timeout" | "network_error" | "invalid_response";
type RpcCheck = { status: RpcStatus; checkedAt: string; finalizedSlot?: number; finalizedBlockHeight?: number; reason?: RpcReason; upstreamStatus?: number };
type RpcFetch = (url: string, init: RequestInit) => Promise<Response>;
type Dependencies = {
  readiness(): LiveReadiness;
  rpcUrl(): string | undefined;
  fetch?: RpcFetch;
  now?: () => number;
  timeoutMs?: number;
  /** The D1 migrations this build needs that the database lacks (limits.server.ts missingMigrations). */
  schema?: () => Promise<string[]>;
  /** The pre-ground "card" address pool (vanity.server.ts vanityHealth): whether its key is set and how many are left. */
  vanity?: () => Promise<{ configured: boolean; available: number }>;
  /** Announcements on @launchacard (config.server.ts xAutopostStatus): the switch and whether its secrets are set. */
  x?: () => { enabled: boolean; configured: boolean; autoApprove?: boolean };
};
/** Fewer available "card" addresses than this reads as low: time to grind and load more (README runbook). */
export const VANITY_LOW = 10;

class RpcProbeFailure extends Error {
  constructor(readonly reason: RpcReason, readonly upstreamStatus?: number) { super(reason); }
}

function configuredRpc(value: string | undefined): value is string {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !/mintdex/i.test(url.hostname);
  } catch { return false; }
}

/** Reachability/mainnet observations only; launch preparation independently refreshes all transaction state. */
export function createLiveHealthHandler(dependencies: Dependencies) {
  const now = dependencies.now ?? Date.now;
  let cached: { endpoint: string; expiresAt: number; result: Promise<RpcCheck> } | undefined;

  async function probe(endpoint: string): Promise<RpcCheck> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async (): Promise<RpcCheck> => {
      const call = async (id: number, method: "getGenesisHash" | "getEpochInfo", params: unknown[]) => {
        let response: Response;
        try {
          const init: RequestInit = {
            // Workers does not implement redirect:"error". Manual + !ok rejects
            // every redirect without sending this credential to another origin.
            method: "POST", redirect: "manual", signal: controller.signal,
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          };
          response = dependencies.fetch ? await dependencies.fetch(endpoint, init) : await globalThis.fetch(endpoint, init);
        } catch { throw new RpcProbeFailure(controller.signal.aborted ? "timeout" : "network_error"); }
        if (!response.ok) throw new RpcProbeFailure("http_error", response.status);
        if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) throw new RpcProbeFailure("invalid_response");
        let text: string;
        try { text = await response.text(); }
        catch { throw new RpcProbeFailure(controller.signal.aborted ? "timeout" : "network_error"); }
        if (text.length > MAX_RESPONSE_BYTES) throw new RpcProbeFailure("invalid_response");
        const json = JSON.parse(text) as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
        if (json?.jsonrpc !== "2.0" || json.id !== id || json.error !== undefined || !("result" in json)) throw new RpcProbeFailure("invalid_response");
        return json.result;
      };
      const [genesis, epoch] = await Promise.all([
        call(1, "getGenesisHash", []), call(2, "getEpochInfo", [{ commitment: "finalized" }]),
      ]);
      if (typeof genesis !== "string") throw new RpcProbeFailure("invalid_response");
      if (genesis !== MAINNET_GENESIS_HASH) return { status: "wrong_network", checkedAt: new Date(now()).toISOString() };
      const bank = epoch as { absoluteSlot?: unknown; blockHeight?: unknown } | null;
      if (!bank || typeof bank.absoluteSlot !== "number" || !Number.isSafeInteger(bank.absoluteSlot) || bank.absoluteSlot <= 0 ||
        typeof bank.blockHeight !== "number" || !Number.isSafeInteger(bank.blockHeight) || bank.blockHeight <= 0 || bank.blockHeight > bank.absoluteSlot) throw new RpcProbeFailure("invalid_response");
      return { status: "healthy", checkedAt: new Date(now()).toISOString(), finalizedSlot: bank.absoluteSlot, finalizedBlockHeight: bank.blockHeight };
    };
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new RpcProbeFailure("timeout")); }, dependencies.timeoutMs ?? TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // No raw error, URL, response body or provider headers may leave this boundary.
      const failure = error instanceof RpcProbeFailure ? error : new RpcProbeFailure("invalid_response");
      return { status: "unavailable", checkedAt: new Date(now()).toISOString(), reason: failure.reason,
        ...(failure.reason === "http_error" ? { upstreamStatus: failure.upstreamStatus } : {}) };
    } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
  }

  return async (): Promise<Response> => {
    const readiness = dependencies.readiness(), endpoint = dependencies.rpcUrl();
    let rpc: RpcCheck;
    if (!configuredRpc(endpoint)) rpc = { status: "unconfigured", checkedAt: new Date(now()).toISOString() };
    else {
      if (!cached || cached.endpoint !== endpoint || cached.expiresAt <= now()) cached = { endpoint, expiresAt: now() + CACHE_MS, result: probe(endpoint) };
      rpc = await cached.result;
    }
    const configured = readiness.configured && configuredRpc(endpoint);
    // A deploy that skipped `wrangler d1 migrations apply` shows here (REG-2): migration numbers only, never an error.
    let schema: { ok: boolean; missing: string[] } | { ok: false; status: "unavailable" } | undefined;
    if (dependencies.schema) {
      try { const missing = await dependencies.schema(); schema = { ok: missing.length === 0, missing }; }
      catch { schema = { ok: false, status: "unavailable" }; }
    }
    // The "card" address pool is optional (an empty or unconfigured pool means random addresses): it never changes ok.
    // Only these three non-secret values, never the key or an address.
    let vanity: { configured: boolean; available: number; low: boolean } | undefined;
    if (dependencies.vanity) {
      try {
        const pool = await dependencies.vanity(), available = Number.isSafeInteger(pool.available) && pool.available > 0 ? pool.available : 0;
        vanity = { configured: pool.configured === true, available, low: available < VANITY_LOW };
      } catch { vanity = { configured: false, available: 0, low: true }; }
    }
    // Optional too, and never changes ok: three booleans, never a credential.
    let x: { enabled: boolean; configured: boolean; autoApprove: boolean } | undefined;
    if (dependencies.x) {
      try { const status = dependencies.x(); x = { enabled: status.enabled === true, configured: status.configured === true, autoApprove: status.autoApprove === true }; }
      catch { x = { enabled: false, configured: false, autoApprove: false }; }
    }
    const ok = configured && rpc.status === "healthy" && (schema?.ok ?? true);
    return Response.json({
      ok,
      readiness: { configured, enabled: readiness.enabled, ready: readiness.ready && ok,
        recoveryEnabled: readiness.recoveryEnabled, recoveryReady: readiness.recoveryReady && ok,
        network: readiness.network, publicOrigin: readiness.publicOrigin },
      rpc,
      ...(schema ? { schema } : {}),
      ...(vanity ? { vanity } : {}),
      ...(x ? { x } : {}),
    }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  };
}

let productionHandler: Promise<ReturnType<typeof createLiveHealthHandler>> | undefined;
export async function serveLiveHealth(): Promise<Response> {
  productionHandler ??= Promise.all([import("../../bindings.server"), import("./config.server"), import("./limits.server"), import("./vanity.server")]).then(([{ bindings }, { liveReadiness, xAutopostStatus }, { missingMigrations }, { vanityHealth }]) =>
    createLiveHealthHandler({ readiness: liveReadiness, rpcUrl: () => bindings().CARDDEX_MAINNET_RPC_URL, schema: missingMigrations, vanity: vanityHealth, x: xAutopostStatus }));
  return (await productionHandler)();
}
