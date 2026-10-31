#!/usr/bin/env bun
/**
 * Refills Launch a Card's pre-ground "card" coin address pool (app migration 0016, live_vanity_mints). Operator
 * tooling, run locally by hand, never in CI. It never prints a secret key or the encryption key, and refuses to write
 * a key file or SQL inside this repository.
 *
 *   bun tools/carddex/vanity-pool.ts --make-key <key-file>
 *     Writes a new random 32-byte AES-256-GCM key, base64, to <key-file> with mode 600 (never overwrites a file).
 *     This is the value of the Worker secret CARDDEX_VANITY_KEY.
 *
 *   bun tools/carddex/vanity-pool.ts <grind-folder> <key-file> <out.sql>
 *     Reads every solana-keygen grind output file (<ADDRESS>.json, a JSON array of 64 bytes) in <grind-folder>,
 *     checks each one derives the address in its file name and that the address ends in "card", encrypts each secret
 *     key with the key in <key-file>, and writes <out.sql>: one INSERT OR IGNORE row per address ('available'), with
 *     mode 600 (never overwrites a file). Any invalid file stops the run before anything is written.
 *
 * Runbook: README.md, "Card mint addresses".
 */
import { chmodSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { CARD_MINT_SUFFIX, cardKeypairMatches, encryptCardMint, importVanityKey, isCardMintAddress, toBase64, vanityKeyBytes } from "../../app/src/lib/carddex/live/vanity-crypto";

/**
 * Addresses whose secret keys are published (the test fixture in app/tests/carddex/card-mint-fixtures.ts): anyone could
 * create a coin at them first, so they are never loaded into a pool.
 */
export const PUBLISHED_TEST_CARD_MINTS: readonly string[] = ["5gpt3LjdMzDvPqT8FgWQMQoimp9HCU7oWEYbszAicard"];

/** This repository's root (the tool lives in tools/carddex). */
export const REPO_ROOT = resolve(import.meta.dir, "../..");

/** The real path of `path`, or of its nearest existing parent joined with the rest (the file may not exist yet). */
function realish(path: string): string {
  const absolute = resolve(path);
  let existing = absolute, rest: string[] = [];
  while (!existsSync(existing)) { rest.unshift(basename(existing)); const parent = dirname(existing); if (parent === existing) break; existing = parent; }
  return join(realpathSync(existing), ...rest);
}
export function insideRepo(path: string, root = REPO_ROOT): boolean {
  const target = realish(path), base = realish(root), rel = relative(base, target);
  return rel === "" || !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}

export type GrindKey = { publicKey: string; secretKey: Uint8Array };
/**
 * One solana-keygen grind output file: `<ADDRESS>.json` holding a JSON array of exactly 64 integers 0-255 (seed, then
 * public key). Returns the pair, or a reason that names only the file (never its contents).
 */
export function readGrindFile(fileName: string, text: string, refused: readonly string[] = PUBLISHED_TEST_CARD_MINTS): GrindKey | { problem: string } {
  const name = basename(fileName);
  if (!name.endsWith(".json")) return { problem: `${name}: not a .json key file` };
  const publicKey = name.slice(0, -".json".length);
  if (!publicKey.endsWith(CARD_MINT_SUFFIX)) return { problem: `${name}: the address in the file name does not end in "${CARD_MINT_SUFFIX}"` };
  if (!isCardMintAddress(publicKey)) return { problem: `${name}: the file name is not a valid Solana address` };
  if (refused.includes(publicKey)) return { problem: `${name}: a published test key, never for a real pool` };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { problem: `${name}: not JSON` }; }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return { problem: `${name}: not a 64-byte secret key array` };
  const secretKey = Uint8Array.from(parsed as number[]);
  if (!cardKeypairMatches(publicKey, secretKey)) { secretKey.fill(0); return { problem: `${name}: the secret key does not derive the address in its file name` }; }
  return { publicKey, secretKey };
}

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;
/** INSERT OR IGNORE rows: loading the same address twice never resets an issued or used row. */
export function poolSql(rows: { publicKey: string; secretCiphertext: string; secretIv: string }[], createdAt: number): string {
  if (!Number.isSafeInteger(createdAt)) throw new Error("Bad timestamp");
  return rows.map(row => `INSERT OR IGNORE INTO live_vanity_mints (public_key, secret_ciphertext, secret_iv, status, created_at) VALUES (${sqlText(row.publicKey)}, ${sqlText(row.secretCiphertext)}, ${sqlText(row.secretIv)}, 'available', ${createdAt});`).join("\n") + "\n";
}

/** A new random 32-byte key, base64, written with mode 600. */
export function makeKey(keyFile: string, root = REPO_ROOT) {
  if (insideRepo(keyFile, root)) throw new Error("Keep the key file outside the repository.");
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try { writeFileSync(keyFile, toBase64(raw) + "\n", { mode: 0o600, flag: "wx" }); } finally { raw.fill(0); }
  chmodSync(keyFile, 0o600);
}

/** Validates every grind file, encrypts each key and writes the SQL. Returns how many rows were written. */
export async function buildPool(folder: string, keyFile: string, outFile: string, { root = REPO_ROOT, now = Date.now(), refused = PUBLISHED_TEST_CARD_MINTS }: { root?: string; now?: number; refused?: readonly string[] } = {}): Promise<number> {
  if (insideRepo(outFile, root)) throw new Error("Write the SQL outside the repository.");
  if (insideRepo(keyFile, root)) throw new Error("Keep the key file outside the repository.");
  if (insideRepo(folder, root)) throw new Error("Keep the grind output outside the repository.");
  if (existsSync(outFile)) throw new Error("The output file already exists; choose a new path.");
  const rawKey = vanityKeyBytes(readFileSync(keyFile, "utf8"));
  if (!rawKey) throw new Error("The key file must hold base64 of exactly 32 bytes (make one with --make-key).");
  const key = await importVanityKey(rawKey); rawKey.fill(0);
  const names = readdirSync(folder).filter(name => name.endsWith(".json")).sort();
  if (!names.length) throw new Error("No .json key files in that folder.");
  const keys: GrindKey[] = [], problems: string[] = [];
  for (const name of names) {
    const read = readGrindFile(name, readFileSync(join(folder, name), "utf8"), refused);
    if ("problem" in read) problems.push(read.problem); else keys.push(read);
  }
  try {
    if (problems.length) throw new Error(`Nothing was written. Invalid key files:\n  ${problems.join("\n  ")}`);
    const rows = [];
    for (const { publicKey, secretKey } of keys) rows.push({ publicKey, ...await encryptCardMint(key, publicKey, secretKey) });
    writeFileSync(outFile, poolSql(rows, now), { mode: 0o600, flag: "wx" });
    chmodSync(outFile, 0o600);
    return rows.length;
  } finally { for (const { secretKey } of keys) secretKey.fill(0); }
}

const USAGE = "Usage:\n  bun tools/carddex/vanity-pool.ts --make-key <key-file>\n  bun tools/carddex/vanity-pool.ts <grind-folder> <key-file> <out.sql>";
export async function main(argv: string[], options: Parameters<typeof buildPool>[3] = {}): Promise<number> {
  try {
    if (argv[0] === "--make-key" && argv.length === 2) { makeKey(argv[1]); console.log(`Wrote a new key to ${argv[1]} (mode 600). Keep it safe; it is never printed.`); return 0; }
    if (argv.length === 3 && !argv.some(arg => arg.startsWith("--"))) {
      const count = await buildPool(argv[0], argv[1], argv[2], options);
      console.log(`Wrote ${count} "card" address row${count === 1 ? "" : "s"} to ${argv[2]} (mode 600). Load it with wrangler d1 execute (README), then delete it.`);
      return 0;
    }
    console.error(USAGE); return 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed.");
    return 1;
  }
}
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
