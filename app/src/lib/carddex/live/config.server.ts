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
const LAUNCHES_OFF = "New real wallet launches are not open in this deployment.";
const RECOVERY_OFF = "Saved launch recovery is paused in this deployment.";
/**
 * Wallets that sign the unsigned transaction before this page adds the new coin or card signature, the order Phantom
 * asks for. CARDDEX_LIVE_WALLET_FIRST is a comma list of Wallet Standard names, "*" for every wallet or "none"; unset
 * means Phantom only. Every other wallet keeps the earlier order (the page signs first) until it is tested: Backpack's
 * public source rewrites the compute budget of unsigned dApp transactions (so wallet-first would always fall back),
 * MetaMask's snap keeps dApp bytes in both orders, and Solflare, OKX, Jupiter and Coinbase are undocumented. Do not
 * ship "*". A wallet-first wallet whose returned message breaks the shared wallet rule is asked once more, still wallet
 * first; it never falls back to page-first, which hands the wallet a transaction this page already signed (the case
 * Phantom flags as "This dApp could be malicious").
 */
export const DEFAULT_WALLET_FIRST = ["Phantom"];
function walletList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  const names = value.split(",").map(name => name.trim()).filter(name => name && name.length <= 64);
  return names.some(name => name.toLowerCase() === "none") ? [] : names.includes("*") ? ["*"] : names;
}
export function walletFirstWallets(value: string | undefined): string[] { return walletList(value, DEFAULT_WALLET_FIRST); }
/**
 * Wallets that approve the coin and its card in one prompt: a multi-input solana:signTransaction, then the page relays
 * the card only once the coin is verified. CARDDEX_LIVE_WALLET_BATCH takes the same comma list, "*" or "none"; unset
 * means no wallet (WW-5): one approval is opt-in, wallet by wallet, after a prompt-and-reject test on the live site
 * shows a single approval screen, both transactions back byte for byte and no extra warning. Backpack is the
 * candidate ("Backpack"): its 2024 public source shows one approval screen for a multi-transaction request and signs
 * the page-first order without rewriting it, but its current build is closed and untested here. Phantom is never
 * batched, whatever the list says: Phantom blocks requests of two or more transactions from a site it has not reviewed
 * with its red "Request blocked" screen (github.com/orgs/phantom/discussions/520), and Jupiter's "Connect as Phantom"
 * reports the same name. MetaMask signs a multi-input request one confirmation at a time (no saving); Solflare, OKX and
 * Coinbase are undocumented. Every wallet not listed approves the card in its own prompt once the coin is confirmed.
 */
export const DEFAULT_WALLET_BATCH: string[] = [];
export const NEVER_BATCH_WALLETS = ["phantom"];
export function walletBatchWallets(value: string | undefined): string[] {
  return walletList(value, DEFAULT_WALLET_BATCH).filter(name => !NEVER_BATCH_WALLETS.includes(name.toLowerCase()));
}
/**
 * The two switches, read the same forgiving way (trimmed, any case), so an operator typing "False" or "0" during an
 * incident gets what they meant. New launches open only on "true"; recovery is paused by "false", "0", "off" or "no".
 * Any other recovery value keeps recovery on and is logged, since it is probably a typo.
 */
const switchValue = (value: string | undefined) => (value ?? "").trim().toLowerCase();
export function launchSwitchOn(value: string | undefined) { return switchValue(value) === "true"; }
/**
 * The creator fee split's own kill switch, CARDDEX_LIVE_FEE_SHARING: on only for "true", so unset (the default, and
 * every local preview) is off. Off hides the "Share creator fees" group and the server refuses every fee split action;
 * coins and cards are unaffected, and a coin without a split keeps pump.fun's default (the creator keeps 100%).
 */
export function feeSharingSwitchOn(value: string | undefined) { return switchValue(value) === "true"; }
/**
 * Announcements on @launchacard (x-announce.server.ts): CARDDEX_X_AUTOPOST is on only for "true", and only with all
 * four X secrets set (OAuth 1.0a user context for the account). Unset, the default and every local preview, is off;
 * missing secrets are off too, never an error. Only these two booleans are ever reported, never a value.
 */
export function xAutopostSwitchOn(value: string | undefined) { return switchValue(value) === "true"; }
export function xCredentialsConfigured(env: {X_API_KEY?: string; X_API_SECRET?: string; X_ACCESS_TOKEN?: string; X_ACCESS_TOKEN_SECRET?: string}) {
  return [env.X_API_KEY, env.X_API_SECRET, env.X_ACCESS_TOKEN, env.X_ACCESS_TOKEN_SECRET].every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 200);
}
/**
 * CARDDEX_X_AUTO_APPROVE ("true" only; unset is off): an opted-in coin whose name and ticker pass the post filters is
 * queued for the cron without waiting for an owner on /admin/replies (recorded as reviewed by "auto"). Coins the
 * filters block still wait for review. It only matters while announcements are on.
 */
export function xAutoApproveSwitchOn(value: string | undefined) { return switchValue(value) === "true"; }
export function xAutopostStatus() {
  const env = bindings();
  const enabled = xAutopostSwitchOn(env.CARDDEX_X_AUTOPOST), configured = xCredentialsConfigured(env);
  // autoApprove is true only when it takes effect (announcements on and configured), never for the bare switch.
  return {enabled, configured, autoApprove: enabled && configured && xAutoApproveSwitchOn(env.CARDDEX_X_AUTO_APPROVE)};
}
const RECOVERY_OFF_VALUES = new Set(["false", "0", "off", "no"]);
let warnedRecoveryValue: string | undefined;
export function recoverySwitchOn(value: string | undefined) {
  const normalized = switchValue(value);
  if (RECOVERY_OFF_VALUES.has(normalized)) return false;
  if (normalized && !["true", "1", "on", "yes"].includes(normalized) && warnedRecoveryValue !== normalized) {
    warnedRecoveryValue = normalized;
    console.warn("CARDDEX_LIVE_RECOVERY_ENABLED has an unrecognized value; recovery stays on", JSON.stringify({length: normalized.length}));
  }
  return true;
}
/**
 * Two switches. CARDDEX_LIVE_LAUNCH_ENABLED="true" opens new launches (compose, a new intent, the coin transaction
 * before it is sent). CARDDEX_LIVE_RECOVERY_ENABLED stays on unless it says off ("false", "0", "off" or "no"):
 * sign-in, saved launches, confirmations, the card stage and discards. Turning off new launches never strands a
 * creator mid-launch.
 */
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
  const enabled = launchSwitchOn(env.CARDDEX_LIVE_LAUNCH_ENABLED), recoveryEnabled = recoverySwitchOn(env.CARDDEX_LIVE_RECOVERY_ENABLED);
  if (!recoveryEnabled) blockers.push(RECOVERY_OFF);
  if (!enabled) blockers.push(LAUNCHES_OFF);
  const recoveryReady = configured && recoveryEnabled;
  const xAnnounce = recoveryReady && xAutopostSwitchOn(env.CARDDEX_X_AUTOPOST) && xCredentialsConfigured(env);
  // A new launch must also be able to finish, so it needs recovery (sign-in, confirmation, the card) too.
  return { implemented: true, configured, enabled, ready: recoveryReady && enabled, recoveryEnabled, recoveryReady,
    network: "solana-mainnet-beta", publicOrigin: origin, blockers, walletFirst: walletFirstWallets(env.CARDDEX_LIVE_WALLET_FIRST),
    walletBatch: walletBatchWallets(env.CARDDEX_LIVE_WALLET_BATCH), feeSharing: recoveryReady && feeSharingSwitchOn(env.CARDDEX_LIVE_FEE_SHARING),
    xAnnounce, xAutoApprove: xAnnounce && xAutoApproveSwitchOn(env.CARDDEX_X_AUTO_APPROVE) };
}
/** "launch" starts something new; "recovery" serves a creator's existing launch. */
export function requireLiveConfig(scope: "launch" | "recovery") {
  const readiness = liveReadiness();
  if (!(scope === "launch" ? readiness.ready : readiness.recoveryReady)) throw new UserError((scope === "launch" ? readiness.blockers : readiness.blockers.filter(blocker => blocker !== LAUNCHES_OFF)).join(" "));
  return { origin: readiness.publicOrigin!, rpcUrl: bindings().CARDDEX_MAINNET_RPC_URL! };
}
export const FEE_SHARING_OFF = "Creator fee sharing is not open in this deployment. Your coin keeps pump.fun's default: you receive 100% of its creator fees.";
/** The creator fee split: recovery ready (it follows a finished launch) and its own switch on. */
export function requireFeeSharing() {
  const config = requireLiveConfig("recovery");
  if (!liveReadiness().feeSharing) throw new UserError(FEE_SHARING_OFF);
  return config;
}
/**
 * The Origin check alone, without the readiness switches: sign-out must work while recovery is paused (SEC-7), so a
 * creator can always end their session during an incident.
 */
export function assertSiteOrigin(requestOrigin: string | null) {
  const origin = publicOrigin(bindings().CARDDEX_PUBLIC_ORIGIN);
  if (!origin || requestOrigin !== origin) throw new UserError("Open the configured Launch a Card site to authorize this wallet action.");
}
export function assertLiveOrigin(requestOrigin: string | null) {
  const { origin } = requireLiveConfig("recovery");
  if (requestOrigin !== origin) throw new UserError("Open the configured Launch a Card site to authorize this wallet action.");
}
