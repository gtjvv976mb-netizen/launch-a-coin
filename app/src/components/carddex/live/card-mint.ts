import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, fromBase64, sameBytes, type EphemeralSigner } from "./transaction";

/** Every pre-ground coin address ends in this (the server's pool, migration 0016). */
export const CARD_MINT_SUFFIX = "card";
/** How long the page waits for a pool address before it uses a random one: the request never holds up a launch. */
export const CARD_MINT_WAIT_MS = 8_000;

/**
 * The new coin's signer from the server's issue response ({publicKey, secretKey}: base64 of the 64-byte Solana secret
 * key, seed then public key), or null for anything that is not exactly that: the seed must derive the public key, the
 * second half must be that same key, its base58 must be the address and the address must end in "card". From here
 * the key is kept and used exactly like a random one (memory only, the same recovery and signing).
 */
export function cardMintSigner(issued: unknown): EphemeralSigner | null {
  if (!issued || typeof issued !== "object") return null;
  const { publicKey, secretKey } = issued as { publicKey?: unknown; secretKey?: unknown };
  if (typeof publicKey !== "string" || typeof secretKey !== "string" || !publicKey.endsWith(CARD_MINT_SUFFIX) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey) || secretKey.length > 200) return null;
  let bytes: Uint8Array;
  try { bytes = fromBase64(secretKey); } catch { return null; }
  try {
    if (bytes.length !== 64) return null;
    const seed = bytes.slice(0, 32);
    let derived: Uint8Array;
    try { derived = ed25519.getPublicKey(seed); } catch { seed.fill(0); return null; }
    if (!sameBytes(derived, bytes.subarray(32)) || base58(derived) !== publicKey) { seed.fill(0); return null; }
    return { address: publicKey, seed };
  } finally { bytes.fill(0); }
}

/**
 * Asks the server for a pre-ground "card" address for this launch and checks it (cardMintSigner). Null on anything
 * else (not configured, an empty pool, a limit, an error, a reply that fails the check, or no reply in time): the
 * caller then makes a random key exactly as before.
 */
export async function requestCardMintSigner(issue: () => Promise<unknown>, waitMs = CARD_MINT_WAIT_MS): Promise<EphemeralSigner | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([issue().catch(() => null), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), waitMs); })]);
    return cardMintSigner(reply);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
