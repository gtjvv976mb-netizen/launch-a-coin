import { bindings } from "../../bindings.server";
import { stmt, UserError } from "../../mintdex/server/db.server";

/**
 * Request limits for everything that costs RPC calls, R2 writes or D1 rows (SEC-1). Each rule counts requests per
 * scope and client in D1 (rate_events), atomically: the row is added only while the window still has room, so two
 * concurrent requests cannot both take the last slot. The client is a hash of a connecting address, a wallet or a demo
 * account, never the value itself. Limits sit well above a real creator's launch (a few prepares, a minute of
 * confirmation polls) and leave room for many people behind one carrier address (CGNAT). Optionally, a Workers Rate
 * Limiting binding (LIVE_IP_LIMIT) adds a coarse per-address gate in front of every live action.
 */
export type LimitRule = { scope: string; max: number; windowMs: number };
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const LIMITS = {
  // Ownership: unauthenticated, so per connecting address.
  challengeIp: { scope: "live:challenge:ip", max: 30, windowMs: MINUTE },
  verifyIp: { scope: "live:verify:ip", max: 60, windowMs: MINUTE },
  // Signed-in launch actions, per wallet (and per address where many throwaway wallets could share one client).
  composeWallet: { scope: "live:compose:wallet", max: 10, windowMs: 10 * MINUTE },
  composeWalletDay: { scope: "live:compose:wallet:day", max: 40, windowMs: DAY },
  composeIp: { scope: "live:compose:ip", max: 60, windowMs: HOUR },
  sizeWallet: { scope: "live:size:wallet", max: 30, windowMs: MINUTE },
  prepareWallet: { scope: "live:prepare:wallet", max: 12, windowMs: MINUTE },
  prepareIp: { scope: "live:prepare:ip", max: 60, windowMs: MINUTE },
  prepareCardWallet: { scope: "live:prepare-card:wallet", max: 12, windowMs: MINUTE },
  confirmWallet: { scope: "live:confirm:wallet", max: 60, windowMs: MINUTE },
  readWallet: { scope: "live:read:wallet", max: 60, windowMs: MINUTE },
  submitWallet: { scope: "live:submit:wallet", max: 20, windowMs: MINUTE },
  abandonWallet: { scope: "live:abandon:wallet", max: 20, windowMs: MINUTE },
  reportWallet: { scope: "live:report:wallet", max: 10, windowMs: MINUTE },
  // The demo: free accounts and public art uploads.
  demoEnterIp: { scope: "demo:enter:ip", max: 20, windowMs: HOUR },
  demoUploadUser: { scope: "demo:upload:user", max: 30, windowMs: HOUR },
  demoUploadIp: { scope: "demo:upload:ip", max: 60, windowMs: HOUR },
} as const satisfies Record<string, LimitRule>;

export const LIMIT_REACHED = "Too many requests right now. Wait a minute, then try again.";
/** Rows older than this are purged; the longest window is a day. */
const KEEP_MS = DAY;

async function keyHash(scope: string, key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}|${key}`));
  return Array.from(new Uint8Array(digest).subarray(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts one request against `rule` for `key` or refuses it. A null key is a request with no connecting address
 * (outside Cloudflare, which always sets one): it is not counted, so such requests never share one bucket that would
 * refuse everyone; the per-wallet rules still apply to them.
 */
export async function enforceLimit(rule: LimitRule, key: string | null, message = LIMIT_REACHED, now = Date.now()): Promise<void> {
  if (key === null) return;
  const hash = await keyHash(rule.scope, key);
  const result = await stmt("INSERT INTO rate_events (scope, key_hash, at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM rate_events WHERE scope = ? AND key_hash = ? AND at > ?) < ?",
    rule.scope, hash, now, rule.scope, hash, now - rule.windowMs, rule.max).run();
  if (!result.meta?.changes) throw new UserError(message);
  // About one request in fifty also clears old rows, a bounded batch at a time.
  if (Math.random() < 0.02) await purgeRateEvents(now).catch(() => undefined);
}
export async function purgeRateEvents(now = Date.now()) {
  await stmt("DELETE FROM rate_events WHERE rowid IN (SELECT rowid FROM rate_events WHERE at < ? LIMIT 500)", now - KEEP_MS).run();
}

/**
 * The optional coarse gate: a Workers Rate Limiting binding named LIVE_IP_LIMIT (configured in wrangler, see
 * the deployment notes). Absent, it allows everything and the D1 rules above still apply.
 */
export async function enforceAddressGate(address: string | null): Promise<void> {
  const gate = bindings().LIVE_IP_LIMIT;
  if (!gate || !address) return;
  let allowed = true;
  try { allowed = (await gate.limit({ key: address })).success; } catch { /* A gate outage never blocks a launch. */ }
  if (!allowed) throw new UserError(LIMIT_REACHED);
}
