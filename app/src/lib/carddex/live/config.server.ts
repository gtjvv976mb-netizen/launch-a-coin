import { bindings } from "../../bindings.server";
import { UserError } from "../../mintdex/server/db.server";
import type { LiveReadiness } from "./types";

export function publicOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      url.pathname !== "/" || url.search || url.hash || !url.hostname.includes(".") || url.hostname.endsWith(".") ||
      /(^localhost$|\.localhost$|\.local$|\.internal$|^\[|^\d+(?:\.\d+)*$|mintdex)/i.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
function rpcConfigured(value?: string) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password && !/mintdex/i.test(url.hostname); }
  catch { return false; }
}
export function liveReadiness(): LiveReadiness {
  const env = bindings();
  const origin = publicOrigin(env.CARDDEX_PUBLIC_ORIGIN);
  const blockers: string[] = [];
  if (!env.DB) blockers.push("Launch a Card D1 persistence is not configured.");
  if (!env.STORAGE) blockers.push("Launch a Card R2 public-asset storage is not configured.");
  if (!origin) blockers.push("Configure a durable public HTTPS Launch a Card origin.");
  if (!rpcConfigured(env.CARDDEX_MAINNET_RPC_URL)) blockers.push("Configure the server-only mainnet RPC endpoint.");
  if (env.CARDDEX_DEPLOYMENT_ENV !== "production") blockers.push("A separate public Launch a Card production deployment is required; local storage is not durable public hosting.");
  const configured = blockers.length === 0;
  const enabled = env.CARDDEX_LIVE_LAUNCH_ENABLED === "true";
  if (!enabled) blockers.push("Real wallet launches are disabled in this deployment.");
  return { implemented: true, configured, enabled, ready: configured && enabled, network: "solana-mainnet-beta", publicOrigin: origin, blockers };
}
export function requireLiveConfig() {
  const readiness = liveReadiness();
  if (!readiness.ready) throw new UserError(readiness.blockers.join(" "));
  return { origin: readiness.publicOrigin!, rpcUrl: bindings().CARDDEX_MAINNET_RPC_URL! };
}
export function assertLiveOrigin(requestOrigin: string | null) {
  const { origin } = requireLiveConfig();
  if (requestOrigin !== origin) throw new UserError("Open the configured Launch a Card site to authorize this wallet action.");
}
