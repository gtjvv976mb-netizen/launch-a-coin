import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Announcements on @launchacard. Synthetic credentials and a fake X: no test reaches the network, and nothing is posted.
let sqlite = new Database(":memory:");
class Prepared {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Prepared(this.sql, values); }
  rows() { return sqlite.query(this.sql).all(...this.values as never[]); }
  async first<T>() { return (this.rows()[0] ?? null) as T | null; }
  async all<T>() { return {results: this.rows() as T[]}; }
  async run() { const results = this.rows(); return {results, success: true, meta: {changes: (sqlite.query("SELECT changes() AS n").get() as {n: number}).n}}; }
}
const localD1 = {prepare: (sql: string) => new Prepared(sql), async batch(statements: Prepared[]) {
  sqlite.exec("BEGIN IMMEDIATE");
  try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
  catch (error) { sqlite.exec("ROLLBACK"); throw error; }
}};
const objects = new Map<string, Uint8Array>();
const storage = {async get(key: string) { const bytes = objects.get(key); return bytes ? {arrayBuffer: async () => bytes.slice().buffer} : null; }};
const SECRETS = {X_API_KEY: "test-consumer-key-0001", X_API_SECRET: "test-consumer-secret-0002", X_ACCESS_TOKEN: "test-access-token-0003", X_ACCESS_TOKEN_SECRET: "test-access-secret-0004"};
let env: Record<string, unknown>;
mock.module("../../src/lib/bindings.server", () => ({bindings: () => env, keepAlive: <T,>(promise: Promise<T>) => promise}));

const {xAnnouncementText, safeName, safeTicker, blockedText, xTextLength, X_ANNOUNCE_LABEL, xAnnounceStatusText} = await import("../../src/lib/carddex/live/x-announce");
const xClient = await import("../../src/lib/carddex/live/x-client.server");
const job = await import("../../src/lib/carddex/live/x-announce.server");
const {liveReadiness, xAutopostStatus} = await import("../../src/lib/carddex/live/config.server");
const {createLiveHealthHandler} = await import("../../src/lib/carddex/live/health.server");
const {XAnnounceField} = await import("../../src/components/carddex/live/XAnnounceField");

const APP = resolve(import.meta.dir, "../..");
const migrations = resolve(APP, "migrations");
const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const sha = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
function png(size = 64) { const bytes = new Uint8Array(size); bytes.set([0x89, 0x50, 0x4e, 0x47]); return bytes; }
let logs: string[] = [];
const nativeLog = console.log, nativeFetch = globalThis.fetch;
beforeEach(() => {
  sqlite.close(); sqlite = new Database(":memory:"); objects.clear(); logs = [];
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) { const sql = readFileSync(resolve(migrations, name), "utf8"); if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql); }
  env = {DB: localD1, STORAGE: storage, CARDDEX_DEPLOYMENT_ENV: "production", CARDDEX_PUBLIC_ORIGIN: "https://launchacard.fun", CARDDEX_MAINNET_RPC_URL: "https://rpc.example.test",
    CARDDEX_LIVE_LAUNCH_ENABLED: "true", CARDDEX_X_AUTOPOST: "true", ...SECRETS};
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  globalThis.fetch = (async () => { throw new Error("A test attempted external network access"); }) as unknown as typeof fetch;
});
afterAll(() => { console.log = nativeLog; globalThis.fetch = nativeFetch; sqlite.close(); });

/** A complete launch as service.server.ts stores it, its card image in R2, optionally opted in. */
async function launch(id: string, options: {name?: string; symbol?: string; quote?: string; optIn?: boolean; status?: string; completedAt?: number; card?: Uint8Array} = {}) {
  const card = options.card ?? png(), cardSha = await sha(card), at = options.completedAt ?? Date.now();
  objects.set(`live/${cardSha}.png`, card);
  sqlite.query("INSERT OR IGNORE INTO live_assets (sha256, storage_key, mime_type, byte_length, width, height, created_at, published_at) VALUES (?, ?, 'image/png', ?, 1260, 1760, ?, ?)").run(cardSha, `live/${cardSha}.png`, card.length, at, at);
  const payload = {fields: {name: options.name ?? "Swamp King", symbol: options.symbol ?? "SWAMP"}, assets: {cardImage: {sha256: cardSha, url: `https://launchacard.fun/api/live/assets/${cardSha}.png`, mimeType: "image/png", bytes: card.length}}, input: {}};
  sqlite.query("INSERT INTO live_launch_intents (id, idempotency_key, creator_wallet, token_mint, nft_mint, quote_key, quote_mint, design_key, payload_sha256, payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri, status, created_at, updated_at) VALUES (?, ?, 'creator', ?, ?, ?, 'q', 'pair-sol', ?, ?, ?, 'u', 'v', ?, ?, ?)")
    .run(id, `key-${id}`, id === "a" ? MINT : `${MINT.slice(0, -2)}${id.padEnd(2, "x").slice(0, 2)}`, `nft-${id}`, options.quote ?? "sol", "0".repeat(64), JSON.stringify(payload), "1".repeat(64), options.status ?? "complete", at, at);
  if (options.optIn !== false) sqlite.query("INSERT INTO live_x_optins (intent_id, created_at) VALUES (?, ?)").run(id, at);
}
const post = (id: string) => sqlite.query("SELECT status, attempts, tweet_id, error, next_attempt_at, posted_at FROM live_x_posts WHERE intent_id = ?").get(id) as {status: string; attempts: number; tweet_id: string | null; error: string | null; next_attempt_at: number; posted_at: number | null} | null;
/** Queued for review, then approved by an owner at `at`, as /admin/replies does. */
async function approved(id: string, at: number) {
  await job.queueXAnnouncement(id, at);
  await job.reviewXAnnouncement({intentId: id, decision: "approve"}, "owner-wallet", at);
}
/** A fake X: records every call; answers come from `answers` in order (default: success). */
function fakeX(answers: (() => Response | Promise<Response>)[] = []) {
  const calls: {url: string; init: RequestInit}[] = [];
  let posts = 0;
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({url, init});
    const next = answers.shift();
    if (next) return next();
    if (url.endsWith("/2/media/upload")) return Response.json({data: {id: "1880000000000000001", media_key: "3_1880000000000000001"}});
    posts++;
    return Response.json({data: {id: String(1990000000000000000n + BigInt(posts)), text: "x"}}, {status: 201});
  };
  return {calls, fetch};
}

describe("the post text", () => {
  test("built from the name, ticker, pair and page link only, without a cashtag, and inside X's length", () => {
    const built = xAnnouncementText({name: "Swamp King", symbol: "swamp", pairSymbol: "SOL", origin: "https://launchacard.fun", tokenMint: MINT});
    expect(built).toEqual({ok: true, text: `New on Launch a Card: Swamp King (SWAMP), a SOL pair coin with its own one-of-one card.\nhttps://launchacard.fun/coin/${MINT}`});
    if (!built.ok) throw new Error("unreachable");
    expect(built.text).not.toMatch(/[@#$]/);
    expect(xTextLength(built.text)).toBeLessThanOrEqual(280);
    // The link counts 23 (t.co), whatever its length.
    expect(xTextLength(`a https://launchacard.fun/coin/${MINT}`)).toBe(25);
    expect(xTextLength("日本")).toBe(4);
  });
  test("names lose mentions, hashtags, cashtags, links, domains, control and invisible characters, and extra space", () => {
    expect(safeName("@elonmusk  Doge #1 $SOL")).toBe("elonmusk Doge 1 SOL");
    expect(safeName("Moon https://evil.example/x coin")).toBe("Moon coin");
    expect(safeName("Get rich at pump.fun now")).toBe("Get rich at now");
    expect(safeName("www.scam.io Cat")).toBe("Cat");
    expect(safeName("Ze​ro‮Width\u0007Cat\n\nTwo")).toBe("Ze ro Width Cat Two");
    expect(safeName("＠fullwidth ＃tag")).toBe("fullwidth tag");
    expect(safeName("x".repeat(80))).toHaveLength(32);
    expect(safeTicker("$swamp!")).toBe("SWAMP");
    expect(safeTicker("@#$")).toBe("");
  });
  test("an empty or blocked name or ticker is never posted", () => {
    const text = (name: string, symbol = "OK") => xAnnouncementText({name, symbol, pairSymbol: "SOL", origin: "https://launchacard.fun", tokenMint: MINT});
    expect(text("@#$ https://x.com")).toMatchObject({ok: false, reason: expect.stringContaining("name")});
    expect(text("Fine", "$$")).toMatchObject({ok: false, reason: expect.stringContaining("ticker")});
    for (const name of ["FREE SOL AIRDROP", "Free-S0L", "Official Launch a Card", "launchacard token", "g1veaway"]) expect(text(name).ok).toBe(false);
    expect(blockedText("Swamp King")).toBe(false);
    expect(text("Swamp", "AIRDROP").ok).toBe(false);
    expect(xAnnouncementText({name: "Fine", symbol: "OK", pairSymbol: "SOL", origin: "https://launchacard.fun", tokenMint: "not a mint"}).ok).toBe(false);
  });
});

describe("the X client", () => {
  const creds = {apiKey: "xvz1evFS4wEEPTGEFPHBog", apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"};
  test("OAuth 1.0a signatures match X's documented example (docs.x.com, Creating a signature)", async () => {
    const params = {status: "Hello Ladies + Gentlemen, a signed OAuth request!", include_entities: "true",
      oauth_consumer_key: creds.apiKey, oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1318622958", oauth_token: creds.accessToken, oauth_version: "1.0"};
    const base = xClient.signatureBaseString("post", "https://api.twitter.com/1.1/statuses/update.json", params);
    expect(base).toBe("POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521");
    expect(await xClient.oauthSignature(base, creds.apiSecret, creds.accessTokenSecret)).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
    // The same request as a header, with the body parameters signed and the query read from the URL.
    const header = await xClient.oauthHeader(creds, "POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      {nonce: params.oauth_nonce, timestamp: 1318622958, params: {status: params.status}});
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(header).not.toContain(creds.apiSecret); expect(header).not.toContain(creds.accessTokenSecret);
    expect(xClient.percentEncode("Ladies + Gentlemen!*'()~")).toBe("Ladies%20%2B%20Gentlemen%21%2A%27%28%29~");
  });
  test("uploads the image as tweet_image, then posts exactly text and that media id: never a reply, quote, tag or mention", async () => {
    const x = fakeX(), client = xClient.createXClient(creds, {fetch: x.fetch, now: () => 1_700_000_000_000, nonce: () => "n0nce"});
    const mediaId = await client.uploadImage(png(), "image/png");
    const postId = await client.createPost({text: "hello", mediaId});
    expect(mediaId).toBe("1880000000000000001"); expect(postId).toBe("1990000000000000001");
    expect(x.calls.map(call => call.url)).toEqual(["https://api.x.com/2/media/upload", "https://api.x.com/2/tweets"]);
    const upload = x.calls[0].init.body as FormData;
    expect([...upload.keys()].sort()).toEqual(["media", "media_category"]);
    expect(upload.get("media_category")).toBe("tweet_image");
    expect(JSON.parse(x.calls[1].init.body as string)).toEqual({text: "hello", media: {media_ids: ["1880000000000000001"]}});
    for (const call of x.calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers.authorization).toStartWith("OAuth ");
      expect(headers.authorization).toContain(`oauth_consumer_key="${creds.apiKey}"`);
      expect(call.init.redirect).toBe("manual");
    }
    expect(JSON.parse(await (async () => { await client.createPost({text: "plain"}); return x.calls[2].init.body as string; })())).toEqual({text: "plain"});
    await expect(client.uploadImage(new Uint8Array(xClient.X_IMAGE_MAX_BYTES + 1), "image/png")).rejects.toThrow("larger than X accepts");
    await expect(client.uploadImage(png(), "image/gif")).rejects.toThrow("unsupported");
  });
  test("errors say only X's status and title: retryable, final or unknown outcome, never a credential", async () => {
    const answer = (status: number, body: object) => () => Response.json(body, {status});
    const errorOf = async (answers: (() => Response | Promise<Response>)[], step: "upload" | "post") => {
      const client = xClient.createXClient(creds, {fetch: fakeX(answers).fetch, timeoutMs: 50});
      try { if (step === "upload") await client.uploadImage(png(), "image/png"); else await client.createPost({text: "t"}); }
      catch (error) { return error as InstanceType<typeof xClient.XApiError>; }
      throw new Error("expected a refusal");
    };
    const limited = await errorOf([answer(429, {title: "Too Many Requests"})], "post");
    expect(limited).toMatchObject({status: 429, retryable: true, ambiguous: false, message: "X post refused (429: Too Many Requests)"});
    expect(await errorOf([answer(403, {detail: "You are not permitted to perform this action."})], "post")).toMatchObject({status: 403, retryable: false});
    expect(await errorOf([answer(503, {})], "upload")).toMatchObject({retryable: true, ambiguous: false});
    // X can answer 5xx after it made the post: unknown, never retried. A 429 is refused before anything is made.
    expect(await errorOf([answer(503, {title: "Service Unavailable"})], "post")).toMatchObject({status: 503, retryable: false, ambiguous: true});
    expect(await errorOf([answer(500, {})], "post")).toMatchObject({retryable: false, ambiguous: true});
    expect(limited.retryAt).toBeNull();
    const reset = 1_700_003_600;
    const withReset = await errorOf([() => Response.json({title: "Too Many Requests"}, {status: 429, headers: {"x-rate-limit-reset": String(reset)}})], "post");
    expect(withReset).toMatchObject({status: 429, retryable: true, ambiguous: false, retryAt: reset * 1000});
    expect(xClient.rateLimitResetAt(new Headers({"retry-after": "120"}), 1_000)).toBe(121_000);
    expect(xClient.rateLimitResetAt(new Headers({"retry-after": "Wed, 21 Oct 2015 07:28:00 GMT"}), 0)).toBe(Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"));
    expect(xClient.rateLimitResetAt(new Headers({"retry-after": "soon"}), 0)).toBeNull();
    // A post that never answered may exist on X: unknown, never retried. An upload that failed made nothing.
    const hang = () => new Promise<Response>((_resolve, reject) => setTimeout(() => reject(new Error("aborted")), 200));
    expect(await errorOf([hang], "post")).toMatchObject({ambiguous: true, retryable: false, message: "X post timed out"});
    expect(await errorOf([hang], "upload")).toMatchObject({ambiguous: false, retryable: true});
    expect(await errorOf([() => Response.json({data: {}}, {status: 201})], "post")).toMatchObject({ambiguous: true});
    for (const error of [limited]) for (const secret of Object.values(creds).slice(1)) expect(error.message).not.toContain(secret);
  });
});

describe("the switch, the secrets and the opt-in", () => {
  test("off unless CARDDEX_X_AUTOPOST is \"true\" and all four secrets are set; health reports two booleans only", async () => {
    expect(liveReadiness().xAnnounce).toBe(true);
    for (const [value, on] of [["true", true], [" TRUE ", true], ["1", false], ["yes", false], ["", false], [undefined, false]] as const) { env.CARDDEX_X_AUTOPOST = value; expect(liveReadiness().xAnnounce).toBe(on); }
    env.CARDDEX_X_AUTOPOST = "true";
    for (const key of Object.keys(SECRETS)) {
      env = {...env, [key]: undefined};
      expect(liveReadiness().xAnnounce).toBe(false); expect(xAutopostStatus()).toEqual({enabled: true, configured: false});
      env = {...env, [key]: "  "}; expect(liveReadiness().xAnnounce).toBe(false);
      env = {...env, ...SECRETS};
    }
    // It follows a finished launch, so it also needs recovery.
    env.CARDDEX_LIVE_RECOVERY_ENABLED = "false"; expect(liveReadiness().xAnnounce).toBe(false); delete env.CARDDEX_LIVE_RECOVERY_ENABLED;
    const health = createLiveHealthHandler({readiness: liveReadiness, rpcUrl: () => undefined, x: xAutopostStatus});
    const body = await (await health()).text();
    expect(JSON.parse(body).x).toEqual({enabled: true, configured: true});
    for (const secret of Object.values(SECRETS)) expect(body).not.toContain(secret);
  });
  test("off, the job does nothing: no claim, no X call, and a completed launch is never queued", async () => {
    await launch("a");
    const x = fakeX();
    for (const off of [{CARDDEX_X_AUTOPOST: undefined}, {X_ACCESS_TOKEN_SECRET: undefined}, {CARDDEX_X_AUTOPOST: "false"}]) {
      env = {...env, ...off};
      expect(await job.queueXAnnouncement("a")).toBe(false);
      expect(await job.runXAutoPost({fetch: x.fetch})).toEqual({state: "off"});
      env = {...env, CARDDEX_X_AUTOPOST: "true", ...SECRETS};
    }
    expect(x.calls).toHaveLength(0); expect(post("a")).toBeNull();
  });
  test("only an opted-in, complete launch is added for review, once", async () => {
    await launch("a"); await launch("b", {optIn: false}); await launch("c", {status: "nft_pending"});
    expect(await job.queueXAnnouncement("a")).toBe(true);
    expect(await job.queueXAnnouncement("a")).toBe(false);
    expect(await job.queueXAnnouncement("b")).toBe(false);
    expect(await job.queueXAnnouncement("c")).toBe(false);
    expect(post("a")).toMatchObject({status: "review", attempts: 0});
    expect(post("b")).toBeNull(); expect(post("c")).toBeNull();
    expect((await job.xAnnounceFor(["a", "b", "c"]))).toEqual(new Map([["a", {status: "review", postId: null}], ["c", {status: "requested", postId: null}]]));
    expect(xAnnounceStatusText({status: "review", postId: null})).toBe("Waiting for review");
    // The choice is written once.
    expect(() => sqlite.query("UPDATE live_x_optins SET created_at = 1 WHERE intent_id = 'a'").run()).toThrow("immutable");
  });
  test("a database without migration 0018 never stops a launch: nothing is queued and nothing reads as requested", async () => {
    await launch("a");
    sqlite.exec("DROP TABLE live_x_posts"); sqlite.exec("DROP TABLE live_x_optins");
    expect(await job.queueXAnnouncement("a")).toBe(false);
    expect(await job.xAnnounceFor(["a"])).toEqual(new Map());
    await job.keepXOptin("a");
    expect(await job.runXAutoPost({fetch: fakeX().fetch})).toEqual({state: "idle"});
  });
  test("the form's box: off by default, labelled, the announcement described", () => {
    const off = renderToStaticMarkup(createElement(XAnnounceField, {checked: false, onChange: () => undefined, disabled: false}));
    expect(off).toContain('id="x-announce" type="checkbox"'); expect(off).not.toContain("checked=");
    expect(off).toContain(X_ANNOUNCE_LABEL);
    expect(X_ANNOUNCE_LABEL).toBe("Announce my coin on @launchacard");
    expect(xAnnounceStatusText({status: "requested", postId: null})).toContain("after your card");
    const launchRoute = readFileSync(resolve(APP, "src/routes/launch.tsx"), "utf8");
    expect(launchRoute).toContain("setAnnounce(d.announceOnX === true)");
    expect(launchRoute).toContain("announceOnX: xOpen && announce");
    expect(launchRoute).toContain("...(announce ? { announceOnX: true } : {})");
  });
});

describe("the cron job", () => {
  const MIN = 60_000, DAY = 86_400_000;
  // A fixed clock on a UTC day boundary plus nine hours.
  let clock = Date.UTC(2026, 10, 1, 9, 0, 0);
  const now = () => clock;
  beforeEach(() => { clock = Date.UTC(2026, 10, 1, 9, 0, 0); });
  test("posts the queued coin: its card image from R2, then one original post with the safe text", async () => {
    const card = png(200);
    await launch("a", {card, completedAt: clock}); await approved("a", clock);
    const x = fakeX();
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "posted", intentId: "a", postId: "1990000000000000001"});
    const uploaded = (x.calls[0].init.body as FormData).get("media") as Blob;
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(card);
    expect(JSON.parse(x.calls[1].init.body as string)).toEqual({text: `New on Launch a Card: Swamp King (SWAMP), a SOL pair coin with its own one-of-one card.\nhttps://launchacard.fun/coin/${MINT}`, media: {media_ids: ["1880000000000000001"]}});
    expect(post("a")).toMatchObject({status: "posted", attempts: 1, tweet_id: "1990000000000000001", posted_at: clock, error: null});
    expect(await job.xAnnounceFor(["a"])).toEqual(new Map([["a", {status: "posted", postId: "1990000000000000001"}]]));
    // Posted is final: the job never posts it again, and the database refuses to change it.
    clock += DAY / 2;
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    expect(x.calls).toHaveLength(2);
    expect(() => sqlite.query("UPDATE live_x_posts SET status = 'queued' WHERE intent_id = 'a'").run()).toThrow("final");
    // Nothing secret reached a log line.
    for (const line of logs) for (const secret of Object.values(SECRETS)) expect(line).not.toContain(secret);
    expect(logs.some(line => line.includes("x_announce_posted"))).toBe(true);
  });
  test("a card image that does not match its hash, or is missing, is not uploaded: the post goes out as text", async () => {
    await launch("a", {completedAt: clock}); await approved("a", clock);
    for (const key of objects.keys()) objects.set(key, png(65));
    const x = fakeX();
    expect((await job.runXAutoPost({fetch: x.fetch, now})).state).toBe("posted");
    expect(x.calls.map(call => call.url)).toEqual(["https://api.x.com/2/tweets"]);
    expect(JSON.parse(x.calls[0].init.body as string).media).toBeUndefined();
  });
  test("an unsafe name is skipped, never posted", async () => {
    await launch("a", {name: "FREE SOL giveaway", completedAt: clock}); await approved("a", clock);
    const x = fakeX();
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "skipped", intentId: "a"});
    expect(x.calls).toHaveLength(0);
    expect(post("a")).toMatchObject({status: "skipped", error: expect.stringContaining("blocked")});
  });
  test("one post per run, a gap between posts, and a daily cap in UTC days", async () => {
    env.CARDDEX_X_DAILY_CAP = "2"; env.CARDDEX_X_MIN_GAP_MINUTES = "10";
    for (const id of ["a", "b", "c"]) { await launch(id, {completedAt: clock}); await approved(id, clock); clock += 1; }
    const x = fakeX();
    expect((await job.runXAutoPost({fetch: x.fetch, now})).intentId).toBe("a");
    // Inside the gap: nothing.
    clock += 9 * MIN; expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    clock += MIN; expect((await job.runXAutoPost({fetch: x.fetch, now})).intentId).toBe("b");
    // The day's cap of two is reached: c waits for 00:00 UTC.
    clock += 60 * MIN; expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    expect(post("c")?.status).toBe("queued");
    clock = Date.UTC(2026, 10, 2, 0, 0, 1);
    expect((await job.runXAutoPost({fetch: x.fetch, now})).intentId).toBe("c");
    expect(x.calls.filter(call => call.url.endsWith("/2/tweets"))).toHaveLength(3);
    expect(job.xAutopostLimits()).toEqual({dailyCap: 2, gapMs: 10 * MIN});
    env.CARDDEX_X_DAILY_CAP = "lots"; env.CARDDEX_X_MIN_GAP_MINUTES = "0";
    expect(job.xAutopostLimits()).toEqual({dailyCap: 20, gapMs: MIN});
  });
  test("two runs at once claim one row: only one of them posts", async () => {
    await launch("a", {completedAt: clock}); await launch("b", {completedAt: clock});
    await approved("a", clock); await approved("b", clock);
    const limits = job.xAutopostLimits();
    const [first, second] = await Promise.all([job.claimNextXPost(clock, limits), job.claimNextXPost(clock, limits)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_x_posts WHERE status = 'posting'").get()).toEqual({n: 1});
    // While it is posting, nothing else is claimed, even past the gap.
    expect(await job.claimNextXPost(clock + DAY / 4, limits)).toBeNull();
  });
  test("refusals are tried again with backoff, up to three attempts; then it fails for good", async () => {
    env.CARDDEX_X_MIN_GAP_MINUTES = "1";
    await launch("a", {completedAt: clock}); await approved("a", clock);
    const busy = () => Response.json({title: "Service Unavailable"}, {status: 503});
    const x = fakeX([busy, busy, busy]);
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "retry", intentId: "a"});
    expect(post("a")).toMatchObject({status: "queued", attempts: 1, next_attempt_at: clock + job.BACKOFF_MS[0], error: "X upload refused (503: Service Unavailable)"});
    clock += job.BACKOFF_MS[0] - 1; expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    clock += 1; expect((await job.runXAutoPost({fetch: x.fetch, now})).state).toBe("retry");
    expect(post("a")).toMatchObject({attempts: 2, next_attempt_at: clock + job.BACKOFF_MS[1]});
    clock += job.BACKOFF_MS[1]; expect((await job.runXAutoPost({fetch: x.fetch, now})).state).toBe("failed");
    expect(post("a")).toMatchObject({status: "failed", attempts: 3});
    clock += DAY / 4; expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    expect(x.calls).toHaveLength(3);
  });
  test("a final refusal fails at once, and a post whose outcome is unknown is never retried", async () => {
    await launch("a", {completedAt: clock}); await launch("b", {completedAt: clock});
    await approved("a", clock); await approved("b", clock + 1);
    const x = fakeX([() => Response.json({data: {id: "1880000000000000001"}}), () => Response.json({title: "Forbidden"}, {status: 403})]);
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "failed", intentId: "a"});
    expect(post("a")).toMatchObject({status: "failed", attempts: 1});
    clock += 10 * 60_000;
    const lost = fakeX([() => Response.json({data: {id: "1880000000000000001"}}), () => { throw new Error("connection reset"); }]);
    expect(await job.runXAutoPost({fetch: lost.fetch, now})).toEqual({state: "failed", intentId: "b"});
    expect(post("b")).toMatchObject({status: "failed", error: expect.stringContaining("may or may not be on X")});
    // A 5xx to the post call is unknown too: failed, never posted again.
    await launch("c", {completedAt: clock}); await approved("c", clock);
    clock += 10 * 60_000;
    const busy = fakeX([() => Response.json({data: {id: "1880000000000000001"}}), () => Response.json({title: "Service Unavailable"}, {status: 503})]);
    expect(await job.runXAutoPost({fetch: busy.fetch, now})).toEqual({state: "failed", intentId: "c"});
    expect(post("c")).toMatchObject({status: "failed", attempts: 1, error: expect.stringContaining("may or may not be on X")});
    clock += job.BACKOFF_MS[1];
    expect(await job.runXAutoPost({fetch: busy.fetch, now})).toEqual({state: "idle"});
    expect(busy.calls).toHaveLength(2);
  });
  test("a post X made is never made again, even when recording it fails", async () => {
    await launch("a", {completedAt: clock}); await approved("a", clock);
    let creates = 0;
    const client = {
      uploadImage: async () => "1880000000000000001",
      async createPost() {
        creates++;
        // The database refuses to record the post (a transient D1 error), after X made it.
        sqlite.exec("CREATE TRIGGER d1_down BEFORE UPDATE ON live_x_posts WHEN NEW.status = 'posted' BEGIN SELECT RAISE(ABORT, 'D1 is unavailable'); END");
        return "1990000000000000042";
      },
    };
    expect(await job.runXAutoPost({client, now})).toEqual({state: "posted", intentId: "a", postId: "1990000000000000042"});
    expect(post("a")).toMatchObject({status: "failed", error: expect.stringContaining("1990000000000000042")});
    expect(logs.some(line => line.includes("x_announce_posted_unrecorded") && line.includes("1990000000000000042"))).toBe(true);
    sqlite.exec("DROP TRIGGER d1_down");
    for (const step of [job.BACKOFF_MS[0], job.BACKOFF_MS[1], job.STALE_CLAIM_MS]) { clock += step; expect(await job.runXAutoPost({client, now})).toEqual({state: "idle"}); }
    expect(creates).toBe(1);
  });
  test("an image X refuses for good is dropped and the coin is posted as text; a busy upload is tried again", async () => {
    await launch("a", {completedAt: clock}); await approved("a", clock);
    const x = fakeX([() => Response.json({title: "Invalid Request"}, {status: 400})]);
    expect((await job.runXAutoPost({fetch: x.fetch, now})).state).toBe("posted");
    expect(x.calls.map(call => call.url)).toEqual(["https://api.x.com/2/media/upload", "https://api.x.com/2/tweets"]);
    expect(JSON.parse(x.calls[1].init.body as string).media).toBeUndefined();
    expect(logs.some(line => line.includes("x_announce_image_dropped"))).toBe(true);
  });
  test("a 429 with X's reset time waits for it, for every queued coin, without using an attempt", async () => {
    env.CARDDEX_X_MIN_GAP_MINUTES = "1";
    await launch("a", {completedAt: clock}); await launch("b", {completedAt: clock});
    await approved("a", clock); await approved("b", clock + 1);
    const reset = clock + 3 * 3_600_000;
    // X refuses the upload with its reset time three hours away.
    const limited = fakeX([() => Response.json({title: "Too Many Requests"}, {status: 429, headers: {"x-rate-limit-reset": String(reset / 1000)}})]);
    expect(await job.runXAutoPost({fetch: limited.fetch, now})).toEqual({state: "retry", intentId: "a"});
    expect(post("a")).toMatchObject({status: "queued", attempts: 0, next_attempt_at: reset});
    expect(post("b")).toMatchObject({status: "queued", attempts: 0, next_attempt_at: reset});
    for (const step of [10, 60, 60]) { clock += step * 60_000; expect(await job.runXAutoPost({fetch: limited.fetch, now})).toEqual({state: "idle"}); }
    clock = reset;
    expect(await job.runXAutoPost({fetch: limited.fetch, now})).toMatchObject({state: "posted", intentId: "a"});
    expect(post("a")).toMatchObject({status: "posted", attempts: 1});
    expect(limited.calls).toHaveLength(3);
  });
  test("the claim uses the cron's scheduled time, so a late start is not inside the gap", async () => {
    env.CARDDEX_X_MIN_GAP_MINUTES = "10";
    await launch("a", {completedAt: clock}); await launch("b", {completedAt: clock});
    await approved("a", clock - 1); await approved("b", clock - 1);
    const scheduled = clock;
    clock = scheduled + 1_200;
    expect((await job.runXAutoPost({fetch: fakeX().fetch, now, scheduledAt: scheduled})).intentId).toBe("a");
    // The next run starts 0.9 s after its scheduled time, 599.7 s after the last run's clock: still its turn.
    clock = scheduled + 10 * 60_000 + 900;
    expect((await job.runXAutoPost({fetch: fakeX().fetch, now, scheduledAt: scheduled + 10 * 60_000})).intentId).toBe("b");
    // A scheduled time from the future or far in the past is ignored for the wall clock.
    expect(await job.runXAutoPost({fetch: fakeX().fetch, now, scheduledAt: clock + 10 * 60_000})).toEqual({state: "idle"});
  });
  test("an owner reviews each coin: the exact text and image, then approve or skip, once", async () => {
    await launch("a", {completedAt: clock}); await launch("b", {name: "FREE SOL giveaway", completedAt: clock + 1}); await launch("c", {completedAt: clock + 2});
    for (const id of ["a", "b", "c"]) await job.queueXAnnouncement(id, clock + ["a", "b", "c"].indexOf(id));
    // Waiting for review, nothing is posted.
    const x = fakeX();
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    expect(x.calls).toHaveLength(0);
    const queue = await job.xReviewQueue(clock);
    expect(queue.map(item => item.intentId)).toEqual(["a", "b", "c"]);
    const cardSha = (JSON.parse((sqlite.query("SELECT payload_json FROM live_launch_intents WHERE id = 'a'").get() as {payload_json: string}).payload_json) as {assets: {cardImage: {sha256: string}}}).assets.cardImage.sha256;
    expect(queue[0]).toMatchObject({name: "Swamp King", symbol: "SWAMP", reason: null, imagePath: `/api/live/assets/${cardSha}.png`,
      text: `New on Launch a Card: Swamp King (SWAMP), a SOL pair coin with its own one-of-one card.\nhttps://launchacard.fun/coin/${MINT}`});
    expect(queue[1]).toMatchObject({text: null, reason: expect.stringContaining("blocked")});
    await job.reviewXAnnouncement({intentId: "a", decision: "approve"}, "owner-wallet", clock);
    await job.reviewXAnnouncement({intentId: "b", decision: "skip"}, "owner-wallet", clock);
    await expect(job.reviewXAnnouncement({intentId: "a", decision: "skip"}, "owner-wallet", clock)).rejects.toThrow("no longer waiting");
    expect(sqlite.query("SELECT status, reviewed_by, reviewed_at FROM live_x_posts WHERE intent_id IN ('a','b') ORDER BY intent_id").all())
      .toEqual([{status: "queued", reviewed_by: "owner-wallet", reviewed_at: clock}, {status: "skipped", reviewed_by: "owner-wallet", reviewed_at: clock}]);
    expect((await job.xReviewQueue(clock)).map(item => item.intentId)).toEqual(["c"]);
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toMatchObject({state: "posted", intentId: "a"});
    // Not reviewed within a day: skipped, never posted.
    clock += job.MAX_AGE_MS + 10 * 60_000;
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    expect(post("c")).toMatchObject({status: "skipped"});
    expect(await job.xReviewQueue(clock)).toEqual([]);
  });
  test("a run that died mid-post leaves its claim failed, not retried; coins older than a day are skipped; a missed queue write is picked up", async () => {
    await launch("a", {completedAt: clock}); await approved("a", clock);
    expect(await job.claimNextXPost(clock, job.xAutopostLimits())).not.toBeNull();
    clock += 10 * 60_000;
    // Launch b completed while its queue write failed; launch c is a day old.
    await launch("b", {completedAt: clock});
    await launch("c", {completedAt: clock - job.MAX_AGE_MS - 1});
    sqlite.query("INSERT INTO live_x_posts (intent_id, status, attempts, next_attempt_at, created_at, updated_at) VALUES ('c', 'queued', 0, ?1, ?1, ?1)").run(clock - job.MAX_AGE_MS - 1);
    const x = fakeX();
    // b is picked up for review; once approved it is posted.
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "idle"});
    expect(post("a")).toMatchObject({status: "failed", error: job.INTERRUPTED});
    expect(post("b")).toMatchObject({status: "review"});
    expect(post("c")).toMatchObject({status: "skipped"});
    await job.reviewXAnnouncement({intentId: "b", decision: "approve"}, "owner-wallet", clock);
    expect(await job.runXAutoPost({fetch: x.fetch, now})).toEqual({state: "posted", intentId: "b", postId: "1990000000000000001"});
  });
});
