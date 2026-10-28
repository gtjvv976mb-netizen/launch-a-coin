// The launch gate and the exposure caps of the first mainnet weeks, as the app reads them (launch-plan §1.6 items 1 and
// 6, §4.5). The Worker enforces both; the app only shows them before anyone signs. Display only, never a trust input.
//
// GET /config fields of the launch-plan Worker (chain-worker/src/api/reads.ts; absent from older Workers, so everything
// here has a fallback):
//   launches:     "open" | "allowlist" | "closed"   the effective gate after the D1 switch flags
//   engineMode:   "on" | "exit" | "off"
//   exposureCaps: { maxBidLamports, maxListPriceLamports }, decimal strings, null for no cap on that side
// Errors: LAUNCHES_NOT_OPEN (503), AMOUNT_ABOVE_LAUNCH_CAP (422, details.capLamports and details.kind), ENGINE_OFF with
// details.engine "exit" in exit-only mode.
//
// Owner: app. Pure: SSR and client safe.

import type { ApiConfig } from "@mintdex/chain-sdk/api";

import { APP_CLUSTER } from "./env";

/** The launch-plan §1.6 and §4.5 fields of GET /config (optional in the SDK's ApiConfig until every Worker serves them). */
export type ApiConfigSwitches = Pick<ApiConfig, "launches" | "engineMode" | "exposureCaps">;

/** 2 SOL: the mainnet caps while a Worker does not say otherwise (launch-plan §4.5 item 1). */
export const LAUNCH_CAP_DEFAULT_LAMPORTS = 2_000_000_000;

export type LaunchCaps = { maxBid: number; maxListPrice: number } | null;

const positive = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The caps to show, or null for none. The Worker's exposureCaps win (a null side = no cap there; both null = lifted).
 * Without them (config not loaded yet, or a Worker older than the caps), mainnet shows the 2 SOL default and devnet
 * shows none.
 */
export function launchCapsOf(cfg: (ApiConfig & ApiConfigSwitches) | null | undefined): LaunchCaps {
  const c = cfg?.exposureCaps;
  if (c && typeof c === "object") {
    const maxBid = positive(c.maxBidLamports);
    const maxListPrice = positive(c.maxListPriceLamports);
    if (maxBid == null && maxListPrice == null) return null;
    return { maxBid: maxBid ?? Number.POSITIVE_INFINITY, maxListPrice: maxListPrice ?? Number.POSITIVE_INFINITY };
  }
  if (c === null && cfg) return null;
  return APP_CLUSTER === "mainnet" ? { maxBid: LAUNCH_CAP_DEFAULT_LAMPORTS, maxListPrice: LAUNCH_CAP_DEFAULT_LAMPORTS } : null;
}

/** The cap an AMOUNT_ABOVE_LAUNCH_CAP error names (details.capLamports; maxLamports accepted too), or null. */
export function capFromDetails(details: Record<string, unknown> | undefined | null): number | null {
  return positive(details?.capLamports) ?? positive(details?.maxLamports);
}

/** The launch gate to show ("open" when the Worker does not say: the prepare call still enforces it). */
export function launchGateOf(cfg: (ApiConfig & ApiConfigSwitches) | null | undefined): "open" | "allowlist" | "closed" {
  const v = cfg?.launches;
  return v === "allowlist" || v === "closed" ? v : "open";
}

/**
 * What the Launch page shows for a gate and the connected wallet's GET /wallets/:address `launchAllowed` (null when
 * unknown: no wallet, not read yet, or an older Worker). "soon" keeps the button for an unknown wallet (prepare still
 * enforces the list) and blocks a wallet the Worker says is not on it; the allowlisted wallet sees the normal page.
 */
export function launchNotice(
  gate: "open" | "allowlist" | "closed",
  allowed: boolean | null,
): { kind: "none" | "soon" | "paused"; blocked: boolean } {
  if (gate === "closed") return { kind: "paused", blocked: true };
  if (gate === "allowlist") return allowed === true ? { kind: "none", blocked: false } : { kind: "soon", blocked: allowed === false };
  return { kind: "none", blocked: false };
}

/** "2", "0.5", "1.25": a cap in SOL without trailing zeros. */
export function capSol(lamports: number): string {
  return String(Number((lamports / 1_000_000_000).toFixed(3)));
}

/** True when an error's details mark exit-only engine mode (ENGINE_OFF with details.engine or details.mode "exit"). */
export function isExitOnly(details: Record<string, unknown> | undefined | null): boolean {
  return !!details && (details.engine === "exit" || details.mode === "exit");
}
