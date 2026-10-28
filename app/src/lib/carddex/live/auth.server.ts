import { ed25519 } from "@noble/curves/ed25519";
import { db, one, stmt, UserError } from "../../mintdex/server/db.server";
import { requireLiveConfig } from "./config.server";
import type { LiveWallet } from "./types";

export const LIVE_SESSION_COOKIE = "carddex_live_session";
const CHALLENGE_MS = 5 * 60_000, SESSION_MS = 2 * 3_600_000;
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
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""); }
export async function createWalletChallenge(wallet: string) {
  const { origin } = requireLiveConfig(); walletBytes(wallet);
  const now = Date.now(), expiresAt = now + CHALLENGE_MS;
  const recent = await one<{n: number}>("SELECT COUNT(*) AS n FROM live_wallet_challenges WHERE wallet = ? AND created_at > ?", wallet, now - 60_000);
  if ((recent?.n ?? 0) >= 5) throw new UserError("Wait a minute before requesting another wallet challenge.");
  const challengeId = crypto.randomUUID();
  const message = `${new URL(origin).host} wants you to sign in with your Solana account:\n${wallet}\n\nAuthorize Launch a Card launch preparation. This message does not send a transaction or move funds.\n\nURI: ${origin}\nVersion: 1\nChain ID: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d\nNonce: ${randomToken()}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
  await stmt("INSERT INTO live_wallet_challenges (id, wallet, origin, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", challengeId, wallet, origin, message, now, expiresAt).run();
  return { challengeId, message, expiresAt };
}
export async function verifyWalletChallenge(input: {challengeId: string; wallet: string; signatureBase64: string}) {
  const { origin } = requireLiveConfig();
  const challenge = await one<{wallet: string; origin: string; message: string; expires_at: number; consumed_at: number | null}>("SELECT * FROM live_wallet_challenges WHERE id = ?", input.challengeId);
  const now = Date.now();
  if (!challenge || challenge.wallet !== input.wallet || challenge.origin !== origin || challenge.consumed_at !== null || challenge.expires_at <= now) throw new UserError("This wallet challenge expired or was already used. Request a fresh challenge.");
  let signature: Uint8Array;
  try { signature = Uint8Array.from(atob(input.signatureBase64), char => char.charCodeAt(0)); }
  catch { throw new UserError("The wallet signature is invalid."); }
  if (signature.length !== 64 || !ed25519.verify(signature, new TextEncoder().encode(challenge.message), walletBytes(input.wallet), {zip215: false})) throw new UserError("The wallet signature is invalid.");
  const token = randomToken(), expiresAt = now + SESSION_MS;
  // A consumed challenge cannot create another session, including two concurrent verify requests.
  await db().batch([
    stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_wallet_challenges WHERE id = ? AND consumed_at IS NULL AND expires_at > ?) THEN 1 ELSE 0 END", input.challengeId, now),
    stmt("DELETE FROM tx_guard"),
    stmt("UPDATE live_wallet_challenges SET consumed_at = ? WHERE id = ?", now, input.challengeId),
    stmt("INSERT INTO live_wallet_sessions (token_hash, wallet, created_at, expires_at) VALUES (?, ?, ?, ?)", await sha256(token), input.wallet, now, expiresAt),
  ]);
  return { token, wallet: input.wallet, expiresAt };
}
export async function liveWalletFromToken(token?: string | null): Promise<LiveWallet | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await one<{wallet: string; expires_at: number}>("SELECT wallet, expires_at FROM live_wallet_sessions WHERE token_hash = ? AND expires_at > ?", await sha256(token), Date.now());
  return row ? {wallet: row.wallet, expiresAt: row.expires_at} : null;
}
export async function requireLiveWallet(token?: string | null) {
  requireLiveConfig();
  const wallet = await liveWalletFromToken(token);
  if (!wallet) throw new UserError("Sign in with the creator wallet to continue this real launch.");
  return wallet;
}
export async function deleteLiveWalletSession(token?: string | null) {
  if (token && /^[a-f0-9]{64}$/.test(token)) await stmt("DELETE FROM live_wallet_sessions WHERE token_hash = ?", await sha256(token)).run();
}
export function liveTokenFromRequest(request: Request) { return (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)carddex_live_session=([a-f0-9]{64})(?:;|$)/)?.[1] ?? null; }
