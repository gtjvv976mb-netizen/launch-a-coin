import { ed25519 } from "@noble/curves/ed25519";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { db, one, stmt, UserError } from "../../mintdex/server/db.server";
import { requireLiveConfig } from "./config.server";
import { enforceLimit, LIMITS } from "./limits.server";
import { liveSignInInput, liveSignInMessage, liveSignInOutputProblem, liveSignInProblem, type LiveSignInInput } from "./sign-in";
import type { LiveWallet } from "./types";

export const LIVE_SESSION_COOKIE = "carddex_live_session";
const CHALLENGE_MS = 5 * 60_000, SESSION_MS = 2 * 3_600_000;
/**
 * Wallet-independent sign-in challenges one client may request per minute. A client is a connecting address, and many
 * phones can share one carrier address (CGNAT), so this stays well above one person's sign-ins.
 */
export const SIGN_IN_CHALLENGES_PER_MINUTE = 30;
/** Ownership-message challenges per wallet per minute; past it, the newest open challenge is handed back instead. */
export const WALLET_CHALLENGES_PER_MINUTE = 5;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function walletBytes(wallet: string): Uint8Array {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new UserError("Use a valid Solana signer address.");
  let n = 0n;
  for (const char of wallet) n = n * 58n + BigInt(alphabet.indexOf(char));
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { bytes[i] = Number(n & 255n); n >>= 8n; }
  if (n || bytes.every(byte => byte === 0)) throw new UserError("Use a valid Solana signer address.");
  let numeric = bytes.reduce((value, byte) => value * 256n + BigInt(byte), 0n), encoded = "", zeros = 0;
  while (numeric) { encoded = alphabet[Number(numeric % 58n)] + encoded; numeric /= 58n; }
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  if ("1".repeat(zeros) + encoded !== wallet) throw new UserError("Use a canonical Solana signer address.");
  try { if (ed25519.Point.fromHex(bytes).isSmallOrder()) throw new Error(); }
  catch { throw new UserError("Use an on-curve Solana signer address."); }
  return bytes;
}
export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes as BufferSource);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
/**
 * Expired challenges and sessions are deleted in small batches (SEC-4), so a flood of unanswered challenges cannot grow
 * D1 without bound. Challenges are kept an hour past expiry, for the logs of a failed sign-in. Runs on about one
 * challenge request in ten.
 */
export async function purgeExpiredLiveRows(now = Date.now()) {
  await db().batch([
    // created_at too, so a row still counted by a per-minute limit is never removed (expiry is creation + 5 minutes).
    stmt("DELETE FROM live_wallet_challenges WHERE rowid IN (SELECT rowid FROM live_wallet_challenges WHERE expires_at < ? AND created_at < ? LIMIT 200)", now - 3_600_000, now - 3_600_000),
    stmt("DELETE FROM live_sign_in_challenges WHERE rowid IN (SELECT rowid FROM live_sign_in_challenges WHERE expires_at < ? AND created_at < ? LIMIT 200)", now - 3_600_000, now - 3_600_000),
    stmt("DELETE FROM live_wallet_sessions WHERE rowid IN (SELECT rowid FROM live_wallet_sessions WHERE expires_at < ? LIMIT 200)", now),
  ]);
}
async function maybePurge(now: number) { if (Math.random() < 0.1) await purgeExpiredLiveRows(now).catch(() => undefined); }
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""); }
/**
 * The ownership-message challenge for one wallet. Requests are limited per connecting address. Anyone can ask for a
 * challenge naming any public address, so the per-wallet limit never refuses its owner (SEC-2): past it, the newest
 * open challenge for that wallet is handed back. Its text is not secret: only the wallet's own signature redeems it,
 * once, and the page checks the text before the wallet opens.
 */
export async function createWalletChallenge(wallet: string, client: string | null = null) {
  const { origin } = requireLiveConfig("recovery"); walletBytes(wallet);
  await enforceLimit(LIMITS.challengeIp, client);
  const now = Date.now(), expiresAt = now + CHALLENGE_MS;
  await maybePurge(now);
  const recent = await one<{n: number}>("SELECT COUNT(*) AS n FROM live_wallet_challenges WHERE wallet = ? AND created_at > ?", wallet, now - 60_000);
  if ((recent?.n ?? 0) >= WALLET_CHALLENGES_PER_MINUTE) {
    // At least 30 seconds left, so the wallet prompt can still finish before it expires.
    const open = await one<{id: string; message: string; expires_at: number}>("SELECT id, message, expires_at FROM live_wallet_challenges WHERE wallet = ? AND origin = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1", wallet, origin, now + 30_000);
    if (open && !liveSignInProblem(open.message, { origin, wallet })) return { challengeId: open.id, message: open.message, expiresAt: open.expires_at };
    throw new UserError("Wait a minute before requesting another wallet challenge.");
  }
  const challengeId = crypto.randomUUID();
  const message = liveSignInMessage({ origin, wallet, nonce: randomToken(), issuedAt: new Date(now), expiresAt: new Date(expiresAt) });
  await stmt("INSERT INTO live_wallet_challenges (id, wallet, origin, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", challengeId, wallet, origin, message, now, expiresAt).run();
  return { challengeId, message, expiresAt };
}
export async function verifyWalletChallenge(input: {challengeId: string; wallet: string; signatureBase64: string}) {
  const { origin } = requireLiveConfig("recovery");
  const challenge = await one<{wallet: string; origin: string; message: string; expires_at: number; consumed_at: number | null}>("SELECT * FROM live_wallet_challenges WHERE id = ?", input.challengeId);
  const now = Date.now();
  // The stored message must still be this site's current mainnet wording, the same check the page ran before signing.
  if (!challenge || challenge.wallet !== input.wallet || challenge.origin !== origin || challenge.consumed_at !== null || challenge.expires_at <= now || liveSignInProblem(challenge.message, { origin, wallet: input.wallet })) throw new UserError("This wallet challenge expired or was already used. Request a fresh challenge.");
  let signature: Uint8Array;
  try { signature = Uint8Array.from(atob(input.signatureBase64), char => char.charCodeAt(0)); }
  catch { throw new UserError("The wallet signature is invalid."); }
  if (signature.length !== 64 || !ed25519.verify(signature, new TextEncoder().encode(challenge.message), walletBytes(input.wallet), {zip215: false})) throw new UserError("The wallet signature is invalid.");
  // A consumed challenge cannot create another session, including two concurrent verify requests.
  return startSession(input.wallet, now, [
    stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_wallet_challenges WHERE id = ? AND consumed_at IS NULL AND expires_at > ?) THEN 1 ELSE 0 END", input.challengeId, now),
    stmt("DELETE FROM tx_guard"),
    stmt("UPDATE live_wallet_challenges SET consumed_at = ? WHERE id = ?", now, input.challengeId),
  ]);
}
/** The one session result both ownership routes end in, written in the same batch that consumes the challenge. */
async function startSession(wallet: string, now: number, consume: D1PreparedStatement[]) {
  const token = randomToken(), expiresAt = now + SESSION_MS;
  await db().batch([...consume, stmt("INSERT INTO live_wallet_sessions (token_hash, wallet, created_at, expires_at) VALUES (?, ?, ?, ?)", await sha256(token), wallet, now, expiresAt)]);
  return { token, wallet, expiresAt };
}
const base64Bytes = (value: string, label: string) => {
  try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
  catch { throw new UserError(`The wallet ${label} is invalid.`); }
};
/**
 * A solana:signIn challenge (connect and ownership in one wallet prompt). It names no wallet, so it is rate-limited per
 * client: `client` is the connecting address, stored only as a hash. Every request field is set here, bound to this
 * site's public origin and Solana mainnet, single-use and short-lived.
 */
export async function createSignInChallenge(client: string | null) {
  const { origin } = requireLiveConfig("recovery");
  const now = Date.now(), expiresAt = now + CHALLENGE_MS, clientHash = await sha256(`${origin}|${client ?? "unknown"}`);
  await maybePurge(now);
  const recent = await one<{n: number}>("SELECT COUNT(*) AS n FROM live_sign_in_challenges WHERE client_hash = ? AND created_at > ?", clientHash, now - 60_000);
  if ((recent?.n ?? 0) >= SIGN_IN_CHALLENGES_PER_MINUTE) throw new UserError("Wait a minute before signing in again.");
  const challengeId = crypto.randomUUID();
  const input = liveSignInInput({ origin, nonce: randomToken(), issuedAt: new Date(now), expiresAt: new Date(expiresAt) });
  await stmt("INSERT INTO live_sign_in_challenges (id, client_hash, origin, input_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", challengeId, clientHash, origin, JSON.stringify(input), now, expiresAt).run();
  return { challengeId, input, expiresAt };
}
/**
 * Verifies a solana:signIn result the way @solana/wallet-standard-util verifySignIn does (liveSignInOutputProblem:
 * parse, every field equal, the canonical text exactly the signed bytes), then the ed25519 signature over those bytes.
 * Ends in the same session as the ownership message.
 */
export async function verifySignInChallenge(input: {challengeId: string; wallet: string; signedMessageBase64: string; signatureBase64: string}) {
  const { origin } = requireLiveConfig("recovery");
  const challenge = await one<{origin: string; input_json: string; expires_at: number; consumed_at: number | null}>("SELECT * FROM live_sign_in_challenges WHERE id = ?", input.challengeId);
  const now = Date.now();
  if (!challenge || challenge.origin !== origin || challenge.consumed_at !== null || challenge.expires_at <= now) throw new UserError("This sign-in expired or was already used. Sign in again.");
  const request = JSON.parse(challenge.input_json) as LiveSignInInput, key = walletBytes(input.wallet);
  const signedMessage = base64Bytes(input.signedMessageBase64, "sign-in message"), signature = base64Bytes(input.signatureBase64, "signature");
  const problem = liveSignInOutputProblem(request, input.wallet, signedMessage) ?? liveSignInProblem(new TextDecoder().decode(signedMessage), { origin, wallet: input.wallet });
  if (problem) throw new UserError(problem);
  if (signature.length !== 64 || !ed25519.verify(signature, signedMessage, key, {zip215: false})) throw new UserError("The wallet signature is invalid.");
  return startSession(input.wallet, now, [
    stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_sign_in_challenges WHERE id = ? AND consumed_at IS NULL AND expires_at > ?) THEN 1 ELSE 0 END", input.challengeId, now),
    stmt("DELETE FROM tx_guard"),
    stmt("UPDATE live_sign_in_challenges SET consumed_at = ?, wallet = ? WHERE id = ?", now, input.wallet, input.challengeId),
  ]);
}
export async function liveWalletFromToken(token?: string | null): Promise<LiveWallet | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await one<{wallet: string; expires_at: number}>("SELECT wallet, expires_at FROM live_wallet_sessions WHERE token_hash = ? AND expires_at > ?", await sha256(token), Date.now());
  return row ? {wallet: row.wallet, expiresAt: row.expires_at} : null;
}
export async function requireLiveWallet(token?: string | null) {
  requireLiveConfig("recovery");
  const wallet = await liveWalletFromToken(token);
  if (!wallet) throw new UserError("Sign in with the creator wallet to continue this real launch.");
  return wallet;
}
export async function deleteLiveWalletSession(token?: string | null) {
  if (token && /^[a-f0-9]{64}$/.test(token)) await stmt("DELETE FROM live_wallet_sessions WHERE token_hash = ?", await sha256(token)).run();
}
export function liveTokenFromRequest(request: Request) { return (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)carddex_live_session=([a-f0-9]{64})(?:;|$)/)?.[1] ?? null; }
