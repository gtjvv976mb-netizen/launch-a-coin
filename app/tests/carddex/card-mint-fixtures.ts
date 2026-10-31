import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "../../src/lib/carddex/live/vanity-crypto";

/**
 * PUBLIC TEST KEY. A throwaway keypair whose address ends in "card", ground once (random seeds, same file format as
 * solana-keygen grind) for these tests only. Its secret key is published in this repository, so it must never be loaded into a real pool: the refill tool
 * refuses it (tools/carddex/vanity-pool.ts PUBLISHED_TEST_CARD_MINTS). It holds nothing and signs nothing on chain.
 */
export const TEST_CARD_MINT = {
  publicKey: "5gpt3LjdMzDvPqT8FgWQMQoimp9HCU7oWEYbszAicard",
  secretKey: Uint8Array.from([53,203,50,146,239,57,88,24,180,174,13,255,247,94,2,222,214,41,44,53,28,229,35,245,227,46,214,93,186,82,140,228,69,162,137,144,20,139,73,223,37,57,103,212,150,213,67,208,156,16,9,245,9,220,105,136,200,36,65,1,234,208,63,202]),
};

/**
 * A valid on-curve Solana address ending in "card" whose secret key nobody knows (built from a number, not ground):
 * for pool rows that are only looked up, never decrypted. Deterministic for a given index.
 */
export function cardAddress(index: number): string {
  const space = 58n ** 4n, card = [35n, 33n, 49n, 36n].reduce((value, digit) => value * 58n + digit, 0n);
  for (let attempt = 0; ; attempt++) {
    let n = 0n;
    for (const byte of new TextEncoder().encode(`card-address-${index}-${attempt}`.padEnd(32, "."))) n = n * 256n + BigInt(byte);
    n = n % (2n ** 255n);
    n = n - n % space + card;
    const bytes = new Uint8Array(32);
    for (let i = 31, v = n; i >= 0; i--) { bytes[i] = Number(v & 255n); v >>= 8n; }
    try { ed25519.Point.fromHex(bytes); } catch { continue; }
    const address = base58Encode(bytes);
    if (address.endsWith("card")) return address;
  }
}
