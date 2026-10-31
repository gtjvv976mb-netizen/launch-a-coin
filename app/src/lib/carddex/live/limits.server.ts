import { bindings } from "../../bindings.server";
import { one, stmt, UserError } from "../../mintdex/server/db.server";

/**
 * Request limits for everything that costs RPC calls, R2 writes or D1 rows (SEC-1). Each rule counts requests per
 * scope and client in D1 (rate_events), atomically: the row is added only while the window still has room, so two
 * concurrent requests cannot both take the last slot. The client is a keyed hash of a connecting address (an IPv6
 * address counts as its /64, clientKey), a wallet or a demo account, never the value itself. Limits sit well above a
 * real creator's launch (a few prepares, a minute of confirmation polls) and leave room for many people behind one
 * carrier address (CGNAT). Optionally, a Workers Rate Limiting binding (LIVE_IP_LIMIT) adds a coarse per-address gate
 * in front of every live action.
 */
export type LimitRule = { scope: string; max: number; windowMs: number };
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const LIMITS = {
  // Ownership: unauthenticated, so per connecting address.
  challengeIp: { scope: "live:challenge:ip", max: 30, windowMs: MINUTE },
  signInIp: { scope: "live:sign-in:ip", max: 30, windowMs: MINUTE },
  verifyIp: { scope: "live:verify:ip", max: 60, windowMs: MINUTE },
  // Sessions an address may start: a fresh keypair signs in for free, so this bounds what many throwaway wallets on one
  // client can do with the per-wallet rules below (SEC-R2).
  sessionIp: { scope: "live:session:ip", max: 120, windowMs: HOUR },
  // Signed-in launch actions, per wallet (and per address where many throwaway wallets could share one client).
  composeWallet: { scope: "live:compose:wallet", max: 10, windowMs: 10 * MINUTE },
  composeWalletDay: { scope: "live:compose:wallet:day", max: 40, windowMs: DAY },
  composeIp: { scope: "live:compose:ip", max: 60, windowMs: HOUR },
  sizeWallet: { scope: "live:size:wallet", max: 30, windowMs: MINUTE },
  sizeIp: { scope: "live:size:ip", max: 60, windowMs: MINUTE },
  prepareWallet: { scope: "live:prepare:wallet", max: 12, windowMs: MINUTE },
  prepareIp: { scope: "live:prepare:ip", max: 60, windowMs: MINUTE },
  prepareCardWallet: { scope: "live:prepare-card:wallet", max: 12, windowMs: MINUTE },
  confirmWallet: { scope: "live:confirm:wallet", max: 60, windowMs: MINUTE },
  readWallet: { scope: "live:read:wallet", max: 60, windowMs: MINUTE },
  submitWallet: { scope: "live:submit:wallet", max: 20, windowMs: MINUTE },
  abandonWallet: { scope: "live:abandon:wallet", max: 20, windowMs: MINUTE },
  reportWallet: { scope: "live:report:wallet", max: 10, windowMs: MINUTE },
  // Pre-ground "card" coin addresses (vanity.server.ts): each one handed out is gone for good, so they are limited per
  // wallet, per address (fresh wallets are free) and site-wide per day, so nobody can drain the pool. Past any of them
  // the launch simply uses a random address.
  cardMintWallet: { scope: "live:card-mint:wallet", max: 6, windowMs: MINUTE },
  cardMintWalletDay: { scope: "live:card-mint:wallet:day", max: 30, windowMs: DAY },
  cardMintIp: { scope: "live:card-mint:ip", max: 30, windowMs: HOUR },
  cardMintSite: { scope: "live:card-mint:site", max: 300, windowMs: DAY },
} as const satisfies Record<string, LimitRule>;
/** The key for a site-wide rule: one bucket for every client. */
export const SITE = "site";

export const LIMIT_REACHED = "Too many requests right now. Wait a minute, then try again.";
/** Rows older than this are purged; the longest window is a day. */
const KEEP_MS = DAY;

/**
 * The client a connecting address stands for. IPv4 is the address itself. IPv6 is its /64: one home, phone or VPS is
 * given a whole /64 and can use a new address in it for every request, so the full address would give each request a
 * fresh bucket (SEC-R1). An IPv4-mapped IPv6 address is its IPv4. Null when there is no address.
 */
export function clientKey(address: string | null | undefined): string | null {
  const value = address?.trim().toLowerCase().replace(/%.*$/, "");
  if (!value) return null;
  if (!value.includes(":")) return value;
  const halves = value.split("::");
  if (halves.length > 2) return value;
  const split = (text: string) => text ? text.split(":") : [];
  const head = split(halves[0]), tail = halves.length === 2 ? split(halves[1]) : [];
  // A dotted IPv4 tail stands for the last two hextets.
  const end = tail.length ? tail : head, ipv4 = end.at(-1)?.includes(".") ? end.pop()! : null;
  const count = head.length + tail.length + (ipv4 ? 2 : 0), fill = halves.length === 2 ? 8 - count : 0;
  if (halves.length === 2 ? fill < 1 : count !== 8) return value;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (!groups.every(group => /^[0-9a-f]{1,4}$/.test(group))) return value;
  if (ipv4 && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipv4) && groups.slice(0, 5).every(group => parseInt(group, 16) === 0) && parseInt(groups[5], 16) === 0xffff) return ipv4;
  return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(":")}::/64`;
}

let hashKey: Promise<CryptoKey> | undefined;
/**
 * The HMAC key the client hashes are made with (SEC-R4): random, created once per deployment in D1 (live_settings)
 * and cached per isolate, so a copy of the D1 tables cannot be matched back to connecting addresses by hashing every
 * IPv4 address. Never sent anywhere.
 */
function clientHashKey(): Promise<CryptoKey> {
  hashKey ??= (async () => {
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    await stmt("INSERT OR IGNORE INTO live_settings (key, value) VALUES ('client_hash_key', ?)", fresh).run();
    const row = await one<{value: string}>("SELECT value FROM live_settings WHERE key = 'client_hash_key'");
    if (!row?.value || !/^[a-f0-9]{64}$/.test(row.value)) throw new Error("The client hash key is missing");
    const raw = Uint8Array.from(row.value.match(/../g)!, byte => parseInt(byte, 16));
    return crypto.subtle.importKey("raw", raw, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  })().catch(error => { hashKey = undefined; throw error; });
  return hashKey;
}
/** A keyed hash of one client in one scope: never the client value itself. */
export async function clientHash(scope: string, key: string) {
  const mac = await crypto.subtle.sign("HMAC", await clientHashKey(), new TextEncoder().encode(`${scope}|${key}`));
  return Array.from(new Uint8Array(mac).subarray(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A D1 database this build's migrations have not reached yet (0014 creates the limit tables). */
const missingSchema = (error: unknown) => /no such (table|column)/i.test(error instanceof Error ? error.message : String(error));
let warnedSchema = false;
/**
 * Counts one request against `rule` for `key` or refuses it. A null key is a request with no connecting address
 * (outside Cloudflare, which always sets one): it is not counted, so such requests never share one bucket that would
 * refuse everyone; the per-wallet rules still apply to them. A database without the limit tables (migration 0014 not
 * applied before this build was deployed) lets the request through with one loud log line, rather than taking every
 * launch, recovery and the demo down with it (REG-2); /api/live/health reports the missing migration.
 */
export async function enforceLimit(rule: LimitRule, key: string | null, message = LIMIT_REACHED, now = Date.now()): Promise<void> {
  if (key === null) return;
  // An IPv6 address that reached here without clientKey still counts as its /64 (no wallet, account or site key has a
  // colon, so only addresses are touched).
  const bucket = key.includes(":") ? clientKey(key) ?? key : key;
  let changes: number | undefined;
  try {
    const hash = await clientHash(rule.scope, bucket);
    const result = await stmt("INSERT INTO rate_events (scope, key_hash, at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM rate_events WHERE scope = ? AND key_hash = ? AND at > ?) < ?",
      rule.scope, hash, now, rule.scope, hash, now - rule.windowMs, rule.max).run();
    changes = result.meta?.changes;
  } catch (error) {
    if (!missingSchema(error)) throw error;
    if (!warnedSchema) { warnedSchema = true; console.error("Request limits are off: apply the D1 migrations (0014) for this build", JSON.stringify({scope: rule.scope})); }
    return;
  }
  if (!changes) throw new UserError(message);
  // About one request in fifty also clears old rows, a bounded batch at a time.
  if (Math.random() < 0.02) await purgeRateEvents(now).catch(() => undefined);
}
export async function purgeRateEvents(now = Date.now()) {
  await stmt("DELETE FROM rate_events WHERE rowid IN (SELECT rowid FROM rate_events WHERE at < ? LIMIT 500)", now - KEEP_MS).run();
}

/**
 * The optional coarse gate: a Workers Rate Limiting binding named LIVE_IP_LIMIT (configured in wrangler, see
 * the deployment notes), keyed by clientKey. Absent, it allows everything and the D1 rules above still apply.
 */
export async function enforceAddressGate(address: string | null): Promise<void> {
  const gate = bindings().LIVE_IP_LIMIT;
  if (!gate || !address) return;
  let allowed = true;
  try { allowed = (await gate.limit({ key: address })).success; } catch { /* A gate outage never blocks a launch. */ }
  if (!allowed) throw new UserError(LIMIT_REACHED);
}

/**
 * Which of this build's D1 migrations the database is missing, by the tables and columns each one adds (REG-2). Empty
 * when the schema is complete. /api/live/health reports it, so a deploy that skipped `migrations apply` shows before
 * traffic arrives.
 */
export const SCHEMA_PROBES: readonly [migration: string, sql: string][] = [
  ["0012", "SELECT signed_message_sha256, effective_last_valid_block_height FROM live_launch_transactions LIMIT 0"],
  ["0013", "SELECT id, client_hash, input_json FROM live_sign_in_challenges LIMIT 0"],
  ["0014", "SELECT scope, key_hash, at FROM rate_events LIMIT 0"],
  ["0014", "SELECT key, value FROM live_settings LIMIT 0"],
  ["0014", "SELECT published_at FROM live_assets LIMIT 0"],
  ["0015", "SELECT public_until FROM live_assets LIMIT 0"],
  ["0016", "SELECT public_key, secret_ciphertext, secret_iv, status, issued_to, issued_at, used_at FROM live_vanity_mints LIMIT 0"],
];
export async function missingMigrations(): Promise<string[]> {
  const missing = new Set<string>();
  for (const [migration, sql] of SCHEMA_PROBES) {
    try { await stmt(sql).all(); }
    catch (error) { if (missingSchema(error)) missing.add(migration); else throw error; }
  }
  return [...missing];
}
