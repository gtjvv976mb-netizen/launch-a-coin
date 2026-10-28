// Server-only access to this app's Cloudflare bindings. Each is present ONLY if
// opted into via app.manifest.json (D1 `DB`, R2 `STORAGE`, KV `KV`, and the
// container `CONTAINER`) — so the accessors are optional; guard before use.
// `cloudflare:workers` is the Workers-runtime module that exposes the Worker
// env (bindings) — usable inside any server-side code (server functions,
// server routes). It is NOT bundled; the runtime provides it.
import { env } from "cloudflare:workers";
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
  KV?: KVNamespace;
  // The container's Durable Object — present only when "container" is set in
  // the manifest. Reach an instance with env.CONTAINER.getByName(id), then
  // .fetch(). See skills/containers.md.
  CONTAINER?: DurableObjectNamespace;
  HF_ENV?: string;
  APP_SLUG?: string;
  CARDDEX_LIVE_LAUNCH_ENABLED?: string;
  CARDDEX_LIVE_RECOVERY_ENABLED?: string;
  CARDDEX_DEPLOYMENT_ENV?: string;
  CARDDEX_PUBLIC_ORIGIN?: string;
  CARDDEX_MAINNET_RPC_URL?: string;
};

export function bindings(): AppEnv {
  return env as unknown as AppEnv;
}
