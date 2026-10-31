import { ed25519 } from "@noble/curves/ed25519";

/**
 * The pre-ground "card" coin mint addresses (migration 0016): their secret keys at rest. Shared by the Worker
 * (vanity.server.ts, which decrypts one key per issue) and the operator's local refill tool
 * (tools/carddex/vanity-pool.ts, which encrypts solana-keygen grind output). No server-only imports, no logging: nothing
 * here may ever print a key, a secret or the encryption key.
 *
 * Format: AES-256-GCM, a fresh random 12-byte IV per row, the 64-byte Solana secret key (seed then public key) as the
 * plaintext, and the row's public key in the additional data, so a ciphertext copied onto another row never decrypts.
 * secret_ciphertext and secret_iv are base64.
 */
export const CARD_MINT_SUFFIX = "card";
const AAD_PREFIX = "launch-a-card:vanity-mint:v1:";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = "";
  while (n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = "1" + out; }
  return out;
}
/** The 32 bytes a canonical base58 Solana address stands for, or null. */
export function addressBytes(address: string): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  let n = 0n;
  for (const char of address) n = n * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { bytes[i] = Number(n & 255n); n >>= 8n; }
  if (n || base58Encode(bytes) !== address) return null;
  return bytes;
}
/** A canonical 32-byte base58 address ending in "card". */
export function isCardMintAddress(address: string): boolean {
  return typeof address === "string" && address.endsWith(CARD_MINT_SUFFIX) && addressBytes(address) !== null;
}
/**
 * Whether a 64-byte Solana secret key (seed, then public key) really belongs to `publicKey` and that address ends in
 * "card": the seed derives the public key, the second half is that same key, and its base58 is `publicKey`.
 */
export function cardKeypairMatches(publicKey: string, secretKey: Uint8Array): boolean {
  if (!isCardMintAddress(publicKey) || secretKey.length !== 64) return false;
  try {
    const derived = ed25519.getPublicKey(secretKey.subarray(0, 32)), stored = secretKey.subarray(32);
    return derived.every((byte, i) => byte === stored[i]) && base58Encode(derived) === publicKey;
  } catch { return false; }
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
/**
 * The 32 raw bytes of a CARDDEX_VANITY_KEY value (standard base64 of exactly 32 bytes, surrounding whitespace
 * ignored), or null for anything else: an unset or malformed key turns the feature off.
 */
export function vanityKeyBytes(value: string | undefined | null): Uint8Array | null {
  const text = (value ?? "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) return null;
  try { const bytes = fromBase64(text); return bytes.length === 32 ? bytes : null; } catch { return null; }
}
export function importVanityKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
}
const aad = (publicKey: string) => new TextEncoder().encode(AAD_PREFIX + publicKey);

/** Encrypts one pool key for its row. Refuses a secret that does not belong to `publicKey` or does not end in "card". */
export async function encryptCardMint(key: CryptoKey, publicKey: string, secretKey: Uint8Array): Promise<{secretCiphertext: string; secretIv: string}> {
  if (!cardKeypairMatches(publicKey, secretKey)) throw new Error("The keypair does not derive its card address.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: aad(publicKey)}, key, secretKey as BufferSource));
  return {secretCiphertext: toBase64(sealed), secretIv: toBase64(iv)};
}
/**
 * Decrypts one row's secret key and checks it really is that row's "card" keypair. Throws a fixed message that names
 * nothing (never the key, the address or the ciphertext) when the row was tampered with, the encryption key is wrong
 * or the pair does not match.
 */
export async function decryptCardMint(key: CryptoKey, row: {public_key: string; secret_ciphertext: string; secret_iv: string}): Promise<Uint8Array> {
  let secret: Uint8Array;
  try {
    const iv = fromBase64(row.secret_iv) as Uint8Array<ArrayBuffer>;
    if (iv.length !== 12) throw new Error();
    secret = new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv, additionalData: aad(row.public_key)}, key, fromBase64(row.secret_ciphertext) as BufferSource));
  } catch { throw new VanityKeyError("decrypt"); }
  if (!cardKeypairMatches(row.public_key, secret)) { secret.fill(0); throw new VanityKeyError("mismatch"); }
  return secret;
}
/** A pool row that could not be turned back into its keypair. Its message is a fixed reason only. */
export class VanityKeyError extends Error {
  constructor(readonly reason: "decrypt" | "mismatch") { super(`card mint ${reason}`); this.name = "VanityKeyError"; }
}
