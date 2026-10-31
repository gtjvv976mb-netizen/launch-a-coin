import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { bindings } from "../../bindings.server";
import { clearGuard, guard, one, stmt, UserError } from "../../mintdex/server/db.server";
import { requireLiveWallet } from "./auth.server";
import { requireLiveConfig } from "./config.server";
import { enforceLimit, LIMITS, SITE } from "./limits.server";
import { CARD_MINT_SUFFIX, decryptCardMint, importVanityKey, toBase64, vanityKeyBytes } from "./vanity-crypto";

/**
 * Pre-ground coin mint addresses ending in "card" (migration 0016, live_vanity_mints). The operator fills the pool
 * from local solana-keygen grind output (tools/carddex/vanity-pool.ts, README runbook); each secret key is stored only
 * as AES-256-GCM ciphertext under the Worker secret CARDDEX_VANITY_KEY.
 *
 * One key is handed to one signed-in creator wallet for one new launch (issueCardMint), never again; the browser
 * checks it and then uses it exactly like the random key it makes today. Prepare accepts a pool address only from the
 * wallet it was issued to and marks it used in the batch that saves the launch (cardMintClaim). Whenever anything is
 * off (no key, an empty pool, a limit, any error) the browser silently uses a random address: this never blocks a
 * launch. A plaintext secret key leaves this module only in the issue response; it is never logged, stored or put in
 * an error.
 */
let cachedKey: {raw: string; key: Promise<CryptoKey | null>} | undefined;
/** The pool's encryption key, imported once per isolate and value; null when CARDDEX_VANITY_KEY is unset or malformed. */
function vanityKey(): Promise<CryptoKey | null> {
  const raw = bindings().CARDDEX_VANITY_KEY ?? "";
  if (cachedKey?.raw !== raw) {
    const bytes = vanityKeyBytes(raw);
    cachedKey = {raw, key: bytes ? importVanityKey(bytes).catch(() => null).finally(() => bytes.fill(0)) : Promise.resolve(null)};
  }
  return cachedKey.key;
}
export function vanityConfigured() { return vanityKeyBytes(bindings().CARDDEX_VANITY_KEY) !== null; }

/** A database this build's migrations have not reached yet (0016 creates the pool). */
const missingPool = (error: unknown) => /no such table/i.test(error instanceof Error ? error.message : String(error));
/** One line per issue, with an outcome and a fixed reason only: never an address, a key, a wallet or an error text. */
function logCardMint(event: "issued" | "empty" | "skipped" | "failed", reason?: string) {
  console.info("live_card_mint", JSON.stringify(reason ? {event, reason} : {event}));
}

export type IssuedCardMint = {publicKey: string; secretKey: string};
/**
 * Hands one never-issued pool key to `wallet` (already signed in: the caller checked the live session), or null.
 * One UPDATE moves exactly one 'available' row to 'issued' and returns it, so two concurrent requests can never get the
 * same key, and a key once issued is never issued again (even if its launch never happens). secretKey is base64 of
 * the 64-byte Solana secret key (seed, then public key), checked here against its address before it is returned.
 */
export async function issueCardMint(wallet: string, client: string | null, now = Date.now()): Promise<IssuedCardMint | null> {
  try {
    const key = await vanityKey();
    if (!key) return null;
    requireLiveConfig("launch");
    await enforceLimit(LIMITS.cardMintWallet, wallet);
    await enforceLimit(LIMITS.cardMintWalletDay, wallet);
    await enforceLimit(LIMITS.cardMintIp, client);
    await enforceLimit(LIMITS.cardMintSite, SITE);
    const row = await one<{public_key: string; secret_ciphertext: string; secret_iv: string}>(
      "UPDATE live_vanity_mints SET status = 'issued', issued_to = ?, issued_at = ? WHERE status = 'available' AND public_key = (SELECT public_key FROM live_vanity_mints WHERE status = 'available' LIMIT 1) RETURNING public_key, secret_ciphertext, secret_iv",
      wallet, now);
    if (!row) { logCardMint("empty"); return null; }
    const secret = await decryptCardMint(key, row);
    try { logCardMint("issued"); return {publicKey: row.public_key, secretKey: toBase64(secret)}; }
    finally { secret.fill(0); }
  } catch (error) {
    if (error instanceof UserError) logCardMint("skipped", "refused");
    else logCardMint("failed", missingPool(error) ? "schema" : error instanceof Error && error.name === "VanityKeyError" ? (error as Error & {reason: string}).reason : "error");
    return null;
  }
}

/**
 * The issue route's whole job after its Origin check: the creator's live wallet session (the same one prepare
 * requires), then issueCardMint. No session, an expired one or any other failure is null, never an error.
 */
export async function issueCardMintForSession(sessionToken: string | null | undefined, client: string | null): Promise<IssuedCardMint | null> {
  let wallet: string;
  try { wallet = (await requireLiveWallet(sessionToken)).wallet; }
  catch { logCardMint("skipped", "session"); return null; }
  return issueCardMint(wallet, client);
}

export const CARD_MINT_NOT_YOURS = "This card address was handed to another launch. Start the launch again for a fresh address.";
/**
 * Prepare's check for a new launch's coin mint. A random address (not ending in "card", or not in the pool) needs
 * nothing: an empty list. A pool address must be issued to this same wallet and not used yet, or the launch is
 * refused before anything is uploaded. The statements returned go in the batch that saves the launch intent: a guard
 * that the row is still issued to this wallet, then marking it used, so it is used exactly when the launch is saved.
 */
export async function cardMintClaim(wallet: string, tokenMint: string, now = Date.now()): Promise<D1PreparedStatement[]> {
  if (!tokenMint.endsWith(CARD_MINT_SUFFIX)) return [];
  let row: {status: string; issued_to: string | null} | null;
  try { row = await one("SELECT status, issued_to FROM live_vanity_mints WHERE public_key = ?", tokenMint); }
  catch (error) { if (missingPool(error)) return []; throw error; }
  if (!row) return [];
  if (row.status !== "issued" || row.issued_to !== wallet) throw new UserError(CARD_MINT_NOT_YOURS);
  return [
    guard("EXISTS (SELECT 1 FROM live_vanity_mints WHERE public_key = ? AND status = 'issued' AND issued_to = ?)", tokenMint, wallet), clearGuard(),
    stmt("UPDATE live_vanity_mints SET status = 'used', used_at = ? WHERE public_key = ? AND status = 'issued' AND issued_to = ?", now, tokenMint, wallet),
  ];
}

/** /api/live/health's vanity block (health.server.ts adds low): whether the key is set and how many addresses are left. */
export async function vanityHealth(): Promise<{configured: boolean; available: number}> {
  const configured = vanityConfigured();
  let available = 0;
  try { available = (await one<{n: number}>("SELECT COUNT(*) AS n FROM live_vanity_mints WHERE status = 'available'"))?.n ?? 0; }
  catch { available = 0; }
  return {configured, available};
}
