import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { cardMintSigner, requestCardMintSigner } from "../../src/components/carddex/live/card-mint";
import { base58Encode, cardKeypairMatches, decryptCardMint, encryptCardMint, fromBase64, importVanityKey, isCardMintAddress, toBase64, vanityKeyBytes, VanityKeyError } from "../../src/lib/carddex/live/vanity-crypto";
import { buildPool, insideRepo, main, makeKey, poolSql, PUBLISHED_TEST_CARD_MINTS, readGrindFile, REPO_ROOT } from "../../../tools/carddex/vanity-pool";
import { cardAddress, TEST_CARD_MINT } from "./card-mint-fixtures";

// Synthetic keys only: the one "card" keypair is the published test fixture, and every other key is random or has no
// known secret. Nothing here reads the owner's pool keys or any secret file.
const randomPair = () => { const seed = crypto.getRandomValues(new Uint8Array(32)), pub = ed25519.getPublicKey(seed); return {publicKey: base58Encode(pub), secretKey: Uint8Array.from([...seed, ...pub])}; };
const issued = (pair: {publicKey: string; secretKey: Uint8Array}) => ({publicKey: pair.publicKey, secretKey: toBase64(pair.secretKey)});
const testKey = () => importVanityKey(crypto.getRandomValues(new Uint8Array(32)));
const scratch = mkdtempSync(join(tmpdir(), "card-mint-test-"));
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

describe("pre-ground card mint addresses: keys at rest", () => {
  test("the fixture is a real card keypair and random keys are not card keys", () => {
    expect(TEST_CARD_MINT.publicKey.endsWith("card")).toBe(true);
    expect(cardKeypairMatches(TEST_CARD_MINT.publicKey, TEST_CARD_MINT.secretKey)).toBe(true);
    const other = randomPair();
    expect(cardKeypairMatches(other.publicKey, other.secretKey)).toBe(false);
    // The fixture's address with another key's secret, or a flipped byte, never matches.
    expect(cardKeypairMatches(TEST_CARD_MINT.publicKey, other.secretKey)).toBe(false);
    const flipped = TEST_CARD_MINT.secretKey.slice(); flipped[3] ^= 1;
    expect(cardKeypairMatches(TEST_CARD_MINT.publicKey, flipped)).toBe(false);
    expect(isCardMintAddress(cardAddress(1))).toBe(true);
    expect(isCardMintAddress("1".repeat(40) + "card")).toBe(false);
  });
  test("AES-256-GCM round trip, bound to the row's address", async () => {
    const key = await testKey();
    const sealed = await encryptCardMint(key, TEST_CARD_MINT.publicKey, TEST_CARD_MINT.secretKey);
    expect(fromBase64(sealed.secretIv).length).toBe(12);
    // The ciphertext is not the secret in any encoding.
    expect(sealed.secretCiphertext).not.toContain(toBase64(TEST_CARD_MINT.secretKey).slice(0, 20));
    const row = {public_key: TEST_CARD_MINT.publicKey, secret_ciphertext: sealed.secretCiphertext, secret_iv: sealed.secretIv};
    expect(await decryptCardMint(key, row)).toEqual(TEST_CARD_MINT.secretKey);
    // Another encryption key, a ciphertext moved to another row, or a changed byte: refused with a fixed reason only.
    for (const [wrongKey, wrongRow] of [[await testKey(), row], [key, {...row, public_key: cardAddress(2)}],
      [key, {...row, secret_ciphertext: toBase64(fromBase64(row.secret_ciphertext).map((b, i) => i === 5 ? b ^ 1 : b))}]] as const) {
      const error = await decryptCardMint(wrongKey, wrongRow).catch(e => e);
      expect(error).toBeInstanceOf(VanityKeyError);
      expect(error.message).toBe("card mint decrypt");
    }
    // A key that is not a card keypair is never encrypted.
    const other = randomPair();
    await expect(encryptCardMint(key, other.publicKey, other.secretKey)).rejects.toThrow("does not derive");
  });
  test("CARDDEX_VANITY_KEY must be base64 of exactly 32 bytes", () => {
    const good = toBase64(new Uint8Array(32).fill(1));
    expect(vanityKeyBytes(good)).toEqual(new Uint8Array(32).fill(1));
    expect(vanityKeyBytes(` ${good}\n`)).toEqual(new Uint8Array(32).fill(1));
    for (const bad of [undefined, "", "short", toBase64(new Uint8Array(31)), toBase64(new Uint8Array(33)), good.replace("=", "")]) expect(vanityKeyBytes(bad)).toBeNull();
  });
  test("migration 0016: one row per address, card addresses only, and a status that matches its fields", () => {
    const db = new Database(":memory:");
    db.exec(readFileSync(resolve(import.meta.dir, "../../migrations/0016_live_vanity_mints.sql"), "utf8"));
    const insert = (key: string, status = "available", extra: {issued_to?: string; issued_at?: number; used_at?: number} = {}) =>
      db.query("INSERT INTO live_vanity_mints (public_key, secret_ciphertext, secret_iv, status, issued_to, issued_at, used_at, created_at) VALUES (?, 'c', 'i', ?, ?, ?, ?, 1)").run(key, status, extra.issued_to ?? null, extra.issued_at ?? null, extra.used_at ?? null);
    insert(cardAddress(1));
    expect(() => insert(cardAddress(1))).toThrow();
    expect(() => insert(randomPair().publicKey + "x")).toThrow();
    expect(() => insert("0OIl" + "1".repeat(36) + "card")).toThrow();
    expect(() => insert("abccard")).toThrow();
    expect(() => insert(cardAddress(2), "lost")).toThrow();
    expect(() => insert(cardAddress(3), "issued")).toThrow();
    expect(() => insert(cardAddress(4), "available", {issued_to: "w", issued_at: 1})).toThrow();
    expect(() => insert(cardAddress(5), "used", {issued_to: "w", issued_at: 1})).toThrow();
    insert(cardAddress(6), "issued", {issued_to: "w", issued_at: 1});
    insert(cardAddress(7), "used", {issued_to: "w", issued_at: 1, used_at: 2});
    expect(() => db.query("INSERT INTO live_vanity_mints (public_key, secret_ciphertext, secret_iv, status, created_at) VALUES (?, '', 'i', 'available', 1)").run(cardAddress(8))).toThrow();
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'live_vanity_mints' AND name = 'live_vanity_mint_status'").get()).toBeTruthy();
    // D1 caps LIKE/GLOB patterns at 50 bytes ("pattern too complex" on every insert past it, which bun:sqlite does not enforce).
    const patterns = [...readFileSync(resolve(import.meta.dir, "../../migrations/0016_live_vanity_mints.sql"), "utf8").matchAll(/GLOB '([^']*)'/g)].map(match => match[1]);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) expect(pattern.length).toBeLessThanOrEqual(50);
    db.close();
  });
});

describe("pre-ground card mint addresses: the page's check", () => {
  test("accepts exactly a card keypair and keeps only its seed", () => {
    const signer = cardMintSigner(issued(TEST_CARD_MINT));
    expect(signer?.address).toBe(TEST_CARD_MINT.publicKey);
    expect(signer?.seed).toEqual(TEST_CARD_MINT.secretKey.slice(0, 32));
  });
  test("rejects a mismatched, non-card or malformed key, and anything that is not a reply", () => {
    const other = randomPair(), mixed = Uint8Array.from([...other.secretKey.slice(0, 32), ...TEST_CARD_MINT.secretKey.slice(32)]);
    for (const reply of [
      null, undefined, "x", 1, {}, {publicKey: TEST_CARD_MINT.publicKey},
      issued(other), // a real keypair, not a card address
      {publicKey: TEST_CARD_MINT.publicKey, secretKey: toBase64(other.secretKey)}, // another key's secret
      {publicKey: TEST_CARD_MINT.publicKey, secretKey: toBase64(mixed)}, // seed of one key, public half of the card key
      {publicKey: other.publicKey, secretKey: toBase64(TEST_CARD_MINT.secretKey)}, // the card secret under another address
      {publicKey: TEST_CARD_MINT.publicKey, secretKey: toBase64(TEST_CARD_MINT.secretKey.slice(0, 32))},
      {publicKey: TEST_CARD_MINT.publicKey, secretKey: "%%%not base64"},
      {publicKey: cardAddress(3), secretKey: toBase64(TEST_CARD_MINT.secretKey)},
    ]) expect(cardMintSigner(reply)).toBeNull();
  });
  test("falls back (null) on a failed, empty, wrong or slow reply, so the page makes a random key", async () => {
    expect(await requestCardMintSigner(async () => issued(TEST_CARD_MINT))).toMatchObject({address: TEST_CARD_MINT.publicKey});
    expect(await requestCardMintSigner(async () => null)).toBeNull();
    expect(await requestCardMintSigner(async () => { throw new Error("offline"); })).toBeNull();
    expect(await requestCardMintSigner(async () => issued(randomPair()))).toBeNull();
    expect(await requestCardMintSigner(() => new Promise(() => {}), 10)).toBeNull();
  });
  test("the launch panel asks for a card address after sign-in, before compose and prepare, and keeps it like a random key", () => {
    const panel = readFileSync(resolve(import.meta.dir, "../../src/components/carddex/live/LiveLaunchPanel.tsx"), "utf8");
    const at = (text: string) => { const index = panel.indexOf(text); expect(index).toBeGreaterThan(-1); return index; };
    const draft = panel.slice(at("async function prepareDraft"));
    const pos = (text: string) => { const index = draft.indexOf(text); expect(index).toBeGreaterThan(-1); return index; };
    expect(pos("await authenticate(address, version);\n      if (draft.initialBuyQuoteBaseUnits")).toBeLessThan(pos("requestCardMintSigner(() => issueLiveCardMint())"));
    expect(pos("requestCardMintSigner(() => issueLiveCardMint())")).toBeLessThan(pos("tokenKey.current = issued ?? createEphemeralSigner();"));
    // The request can take seconds: the button shows it is busy before it starts, with or without a first buy (C2).
    const keyStep = draft.slice(pos("if (!tokenKey.current) {"), pos("requestCardMintSigner(() => issueLiveCardMint())"));
    expect(keyStep).toContain('setBusy("preparing");');
    expect(pos("tokenKey.current = issued ?? createEphemeralSigner();")).toBeLessThan(pos("composeCreatorCard("));
    // Only a launch with no coin key yet asks: a saved launch keeps its key.
    expect(draft.slice(pos("if (!tokenKey.current) {"), pos("tokenKey.current = issued ?? createEphemeralSigner();"))).toContain("requestCardMintSigner");
  });
});

describe("pre-ground card mint addresses: the refill tool", () => {
  const grindFolder = () => { const folder = mkdtempSync(join(scratch, "grind-")); return folder; };
  const writeGrind = (folder: string, name: string, bytes: Uint8Array | number[]) => writeFileSync(join(folder, name), JSON.stringify(Array.from(bytes)));
  test("reads solana-keygen grind files and names only the file in a problem", () => {
    const text = JSON.stringify(Array.from(TEST_CARD_MINT.secretKey));
    // The fixture's secret is public, so the tool refuses it unless a test lifts that.
    expect(PUBLISHED_TEST_CARD_MINTS).toContain(TEST_CARD_MINT.publicKey);
    expect(readGrindFile(`${TEST_CARD_MINT.publicKey}.json`, text)).toEqual({problem: `${TEST_CARD_MINT.publicKey}.json: a published test key, never for a real pool`});
    const ok = readGrindFile(`${TEST_CARD_MINT.publicKey}.json`, text, []);
    expect("problem" in ok ? ok.problem : ok.publicKey).toBe(TEST_CARD_MINT.publicKey);
    const other = randomPair();
    const problems = [
      readGrindFile(`${other.publicKey}.json`, JSON.stringify(Array.from(other.secretKey))),
      readGrindFile(`${cardAddress(4)}.json`, text),
      readGrindFile(`${TEST_CARD_MINT.publicKey}.json`, "not json"),
      readGrindFile(`${TEST_CARD_MINT.publicKey}.json`, JSON.stringify(Array.from(TEST_CARD_MINT.secretKey.slice(0, 63)))),
      readGrindFile(`${TEST_CARD_MINT.publicKey}.json`, JSON.stringify([...Array.from(TEST_CARD_MINT.secretKey.slice(0, 63)), 256])),
      readGrindFile("notanaddresscard.json", text),
    ].map(result => "problem" in result ? result.problem : "accepted");
    expect(problems.every(problem => problem !== "accepted")).toBe(true);
    for (const problem of problems) expect(problem).not.toContain(String(TEST_CARD_MINT.secretKey[0]) + "," + String(TEST_CARD_MINT.secretKey[1]));
  });
  test("--make-key writes a 32-byte base64 key with mode 600, never over a file and never inside the repo", () => {
    const keyFile = join(scratch, "make.key");
    makeKey(keyFile);
    expect(vanityKeyBytes(readFileSync(keyFile, "utf8"))?.length).toBe(32);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(() => makeKey(keyFile)).toThrow();
    expect(() => makeKey(join(REPO_ROOT, "app", "vanity.key"))).toThrow("outside the repository");
    expect(existsSync(join(REPO_ROOT, "app", "vanity.key"))).toBe(false);
    expect(insideRepo(join(REPO_ROOT, "tools")) && !insideRepo(scratch)).toBe(true);
  });
  test("builds INSERT OR IGNORE rows the Worker can decrypt, and writes nothing when any file is invalid", async () => {
    const keyFile = join(scratch, "build.key"); makeKey(keyFile);
    const folder = grindFolder(); writeGrind(folder, `${TEST_CARD_MINT.publicKey}.json`, TEST_CARD_MINT.secretKey);
    const out = join(scratch, "pool.sql");
    await expect(buildPool(folder, keyFile, join(scratch, "refused.sql"))).rejects.toThrow("published test key");
    expect(await buildPool(folder, keyFile, out, {refused: []})).toBe(1);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const sql = readFileSync(out, "utf8");
    expect(sql.startsWith("INSERT OR IGNORE INTO live_vanity_mints")).toBe(true);
    expect(sql).not.toContain(JSON.stringify(Array.from(TEST_CARD_MINT.secretKey)).slice(1, 30));
    expect(sql).not.toContain(toBase64(TEST_CARD_MINT.secretKey).slice(0, 20));
    expect(sql).not.toContain(readFileSync(keyFile, "utf8").trim());
    // Loaded twice, the row stays as it was; it decrypts back to the keypair with the same key file.
    const db = new Database(":memory:");
    db.exec(readFileSync(resolve(import.meta.dir, "../../migrations/0016_live_vanity_mints.sql"), "utf8"));
    db.exec(sql); db.query("UPDATE live_vanity_mints SET status = 'issued', issued_to = 'w', issued_at = 1").run(); db.exec(sql);
    const row = db.query("SELECT * FROM live_vanity_mints").get() as {public_key: string; secret_ciphertext: string; secret_iv: string; status: string};
    expect(row.status).toBe("issued");
    const key = await importVanityKey(vanityKeyBytes(readFileSync(keyFile, "utf8"))!);
    expect(await decryptCardMint(key, row)).toEqual(TEST_CARD_MINT.secretKey);
    db.close();
    // One invalid file (a non-card key, or a file whose name is another address) stops the run before writing.
    const other = randomPair();
    writeGrind(folder, `${other.publicKey}.json`, other.secretKey);
    const out2 = join(scratch, "pool2.sql");
    await expect(buildPool(folder, keyFile, out2, {refused: []})).rejects.toThrow("Nothing was written");
    expect(existsSync(out2)).toBe(false);
    // Never an output, key file or grind folder inside the repo; never over an existing file.
    await expect(buildPool(folder, keyFile, join(REPO_ROOT, "pool.sql"), {refused: []})).rejects.toThrow("outside the repository");
    await expect(buildPool(folder, keyFile, out, {refused: []})).rejects.toThrow("already exists");
    expect(poolSql([{publicKey: "a'b", secretCiphertext: "c", secretIv: "d"}], 5)).toContain("'a''b'");
  });
  test("the command line never prints a secret or the key", async () => {
    const logs: string[] = [], log = console.log, error = console.error;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); }; console.error = console.log;
    try {
      const keyFile = join(scratch, "cli.key"), folder = grindFolder(), out = join(scratch, "cli.sql");
      expect(await main(["--make-key", keyFile])).toBe(0);
      writeGrind(folder, `${TEST_CARD_MINT.publicKey}.json`, TEST_CARD_MINT.secretKey);
      expect(await main([folder, keyFile, out], {refused: []})).toBe(0);
      expect(await main([])).toBe(2);
      const keyText = readFileSync(keyFile, "utf8").trim(), printed = logs.join("\n");
      expect(printed).not.toContain(keyText);
      expect(printed).not.toContain(toBase64(TEST_CARD_MINT.secretKey).slice(0, 20));
      expect(printed).toContain("Wrote 1 \"card\" address row");
    } finally { console.log = log; console.error = error; }
  });
  // Needs a git checkout: an archive or tarball of the repo has no .git to ask (C1), so the check is skipped there.
  const inGit = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {cwd: REPO_ROOT}).stdout.toString().trim() === "true";
  test.skipIf(!inGit)("the repo ignores grind output, key files and generated SQL, but keeps migrations", async () => {
    const proc = Bun.spawnSync(["git", "check-ignore", "--no-index", "x/9abcdcard.json", "x/vanity-key", "x/pool.sql", "app/migrations/0016_live_vanity_mints.sql"], {cwd: REPO_ROOT});
    expect(proc.stdout.toString().trim().split("\n")).toEqual(["x/9abcdcard.json", "x/vanity-key", "x/pool.sql"]);
  });
});
describe("pre-ground card mint addresses: the issue route", () => {
  test("checks this site's Origin and the live session, is never cached, and answers null on any failure", () => {
    const api = readFileSync(resolve(import.meta.dir, "../../src/lib/carddex/live/api.ts"), "utf8");
    const start = api.indexOf("export const issueLiveCardMint ="), handler = api.slice(start, api.indexOf("\nexport const", start + 1));
    expect(handler).toContain('createServerFn({method: "POST"})');
    expect(handler).toContain("noStore();");
    expect(handler).toContain("await sameOrigin(); return await issueCardMintForSession(getCookie(LIVE_SESSION_COOKIE), clientAddress());");
    expect(handler).toContain("catch { return null; }");
    // Nothing in the route or the pool module logs a key or an error's text.
    const server = readFileSync(resolve(import.meta.dir, "../../src/lib/carddex/live/vanity.server.ts"), "utf8");
    expect(server.match(/console\.\w+\(/g)).toEqual(["console.info("]);
    expect(handler).not.toContain("console.");
  });
});
