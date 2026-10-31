// Server-only access to this app's Cloudflare bindings. Each is present ONLY if
// opted into via app.manifest.json (D1 `DB`, R2 `STORAGE`, KV `KV`, and the
// container `CONTAINER`) — so the accessors are optional; guard before use.
// `cloudflare:workers` is the Workers-runtime module that exposes the Worker
// env (bindings) — usable inside any server-side code (server functions,
// server routes). It is NOT bundled; the runtime provides it.
import { env } from "cloudflare:workers";
import * as workers from "cloudflare:workers";
// Import the binding types directly — NOT via the global tsconfig `types` list,
// which would clobber the DOM globals the client/SSR React code relies on.
import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  R2Bucket,
  Fetcher,
} from "@cloudflare/workers-types";

type AppEnv = {
  DB?: D1Database;
  STORAGE?: R2Bucket;
  ASSETS?: Fetcher;
  // This Worker itself, for own-origin reads that a zone route cannot fetch() (Cloudflare for SaaS).
  SELF?: Fetcher;
  KV?: KVNamespace;
  // The container's Durable Object — present only when "container" is set in
  // the manifest. Reach an instance with env.CONTAINER.getByName(id), then
  // .fetch(). See skills/containers.md.
  CONTAINER?: DurableObjectNamespace;
  HF_ENV?: string;
  APP_SLUG?: string;
  CARDDEX_LIVE_LAUNCH_ENABLED?: string;
  CARDDEX_LIVE_RECOVERY_ENABLED?: string;
  CARDDEX_LIVE_WALLET_FIRST?: string;
  CARDDEX_LIVE_WALLET_BATCH?: string;
  /** "true" opens the optional creator fee split after a launch (config.server.ts feeSharingSwitchOn); unset is off. */
  CARDDEX_LIVE_FEE_SHARING?: string;
  /** "true" posts opted-in new coins on @launchacard (x-announce.server.ts); unset is off. Needs the four X secrets. */
  CARDDEX_X_AUTOPOST?: string;
  /** Optional: most announcements per UTC day (default 20) and minutes between two (default 10). */
  CARDDEX_X_DAILY_CAP?: string;
  CARDDEX_X_MIN_GAP_MINUTES?: string;
  // Secrets (wrangler secret put): @launchacard's OAuth 1.0a user-context values from the X developer portal (an app
  // with Read and Write). Any one missing: announcements are off. Never logged, never reported.
  X_API_KEY?: string;
  X_API_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
  /**
   * The private reply helper (/admin/replies, x-replies.server.ts): a comma list of the owner's Solana wallets. Unset
   * or empty, the page and its server functions answer "not found".
   */
  CARDDEX_ADMIN_WALLETS?: string;
  /** Optional: most X searches per hour (default 4) and reply suggestions per hour (default 30). */
  CARDDEX_X_REPLY_READS_PER_HOUR?: string;
  CARDDEX_X_REPLY_SUGGESTIONS_PER_HOUR?: string;
  // Secrets: X's app-only bearer token (recent search; read only, it cannot post), and an Anthropic API key for the
  // optional reply suggestions. Either missing turns its half off. Never logged, never reported.
  X_BEARER_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  CARDDEX_DEPLOYMENT_ENV?: string;
  CARDDEX_PUBLIC_ORIGIN?: string;
  CARDDEX_MAINNET_RPC_URL?: string;
  // Secret (wrangler secret put): base64 of the 32-byte AES-256-GCM key the pre-ground "card" mint keys are stored
  // under (vanity.server.ts). Unset or malformed: the feature is off and launches use a random mint address.
  CARDDEX_VANITY_KEY?: string;
  // Optional Workers Rate Limiting binding: a coarse per-address gate in front of live actions (limits.server.ts).
  LIVE_IP_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

export function bindings(): AppEnv {
  return env as unknown as AppEnv;
}

/**
 * Keeps `promise` running after the response, and after the client disconnects (waitUntil, up to 30 s): a launch's
 * broadcast must not be cancelled between saving its signed bytes and sending them. A no-op outside a request (tests),
 * or on a runtime without waitUntil; the promise is returned either way, for the caller to await.
 */
export function keepAlive<T>(promise: Promise<T>): Promise<T> {
  const waitUntil = (workers as unknown as { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil;
  try { if (typeof waitUntil === "function") waitUntil(promise.catch(() => undefined)); } catch { /* No request context. */ }
  return promise;
}
