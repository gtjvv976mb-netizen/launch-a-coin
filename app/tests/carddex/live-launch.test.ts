import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "../../../chain/sdk/src/bytes";
import { getPairAsset } from "../../src/lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import { CARD_RENDERER_VERSION } from "../../src/lib/carddex/card-template";
import { CREATOR_CARD_RENDERER_VERSION } from "../../src/lib/carddex/live/creator-print";

// Only synthetic in-memory sign-in keys and mocked RPC are used. This test cannot submit a transaction.
const creatorSeed = new Uint8Array(32).fill(7), creator = base58Encode(ed25519.getPublicKey(creatorSeed));
const mint = base58Encode(ed25519.getPublicKey(new Uint8Array(32).fill(8)));
const nftMint = base58Encode(ed25519.getPublicKey(new Uint8Array(32).fill(9)));
const otherWallet = base58Encode(ed25519.getPublicKey(new Uint8Array(32).fill(10)));
const replacementNft = base58Encode(ed25519.getPublicKey(new Uint8Array(32).fill(11)));
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
const objects = new Map<string, {bytes: Uint8Array; mime: string}>();
const storage = {
  async put(key: string, bytes: Uint8Array, options: {httpMetadata: {contentType: string}}) { objects.set(key, {bytes: new Uint8Array(bytes), mime: options.httpMetadata.contentType}); },
  async get(key: string) { const value = objects.get(key); return value ? {arrayBuffer: async () => value.bytes.slice().buffer, body: value.bytes, httpMetadata: {contentType: value.mime}, httpEtag: '"fixture"'} : null; },
};
let env: Record<string, unknown>;
mock.module("../../src/lib/bindings.server", () => ({bindings: () => env}));
let tokenVerified = false, nftVerified = false, replaceable = false, uncertain = false, prepareCalls = 0, nftPrepareCalls = 0, sendCalls = 0, receiptCreator: string | null = null;
let tokenInputs: any[] = [], nftInputs: any[] = [];
let sizes = {createBytes: 950, buyBytes: 1200}, measured: any[] = [];
let preSend: "ready" | "landed" | "expired" | "simulation" | "error" = "ready", savedAtCheck: (string | null)[] = [];
class SignedTransactionNotSent extends Error { constructor(readonly reason: string, message: string) { super(message); } }
let tokenVerifyHook: (() => Promise<void>) | undefined, nftVerifyHook: (() => Promise<void>) | undefined, nftPrepareHook: (() => Promise<void>) | undefined, nftReplaceHook: (() => Promise<void>) | undefined;
const binding = "b".repeat(64);
function identity(input: any) { return {creatorWallet: receiptCreator ?? input.creator, tokenMint: input.mint, quoteMint: getPairAsset(input.quoteKey).mint, nftMint: input.nftMint}; }
function plan(input: any, kind: "token" | "nft") {
  const counter = kind === "token" ? ++prepareCalls : ++nftPrepareCalls;
  return {kind, transactionBase64: `${kind}-unsigned-${counter}`, messageSha256: (kind === "token" ? "a" : "c").repeat(62) + String(counter).padStart(2, "0"),
    blockhash: "fixture", lastValidBlockHeight: 100, requiredSigners: [input.creator, kind === "token" ? input.mint : input.nftMint], feePayer: input.creator,
    bindingSha256: binding, verifiedSlot: 50, review: {quoteKey: input.quoteKey, initialBuyQuoteBaseUnits: input.initialBuyQuoteBaseUnits}};
}
function signedSignature(prepared: {kind: string; messageSha256: string}) { return prepared.kind === "token" ? "s".repeat(88) : String.fromCharCode(115 + Number(prepared.messageSha256.slice(-2))).repeat(88); }
mock.module("../../../integrations/pumpfun/src/live", () => ({
  createMainnetConnection: () => ({}),
  measureTokenTransaction: async (input: any) => { measured.push(input); return {limit: 1232, ...sizes}; },
  prepareTokenTransaction: async (input: any) => { tokenInputs.push(input); return plan(input, "token"); },
  verifyTokenLaunch: async (input: any, options: any) => { const result = {status: tokenVerified ? "verified" : "pending", ...identity(input), signature: options.signature, slot: 101, messageSha256: options.expectedMessageSha256}; const hook = tokenVerifyHook; tokenVerifyHook = undefined; await hook?.(); return result; },
  verifyCreatorNft: async (input: any, options: any) => { const result = {status: nftVerified ? "verified" : "pending", ...identity(input), signature: options.signature, slot: 102, messageSha256: options.expectedMessageSha256}; const hook = nftVerifyHook; nftVerifyHook = undefined; await hook?.(); return result; },
  prepareCreatorNftTransaction: async (input: any) => { if (!tokenVerified) throw new Error("Token is not finalized"); nftInputs.push(input); const hook = nftPrepareHook; nftPrepareHook = undefined; await hook?.(); return nftVerified ? {status: "already-created", receipt: {status: "verified", ...identity(input)}} : plan(input, "nft"); },
  assertNftMintReplaceable: async () => { if (!replaceable || nftVerified) throw new Error("Prior NFT blockhash has not expired or its account exists"); const hook = nftReplaceHook; nftReplaceHook = undefined; await hook?.(); return {replaceable: true}; },
  assertTokenMintReplaceable: async () => { if (!replaceable || tokenVerified) throw new Error("Prior token blockhash has not expired or its account exists"); return {replaceable: true}; },
  validateSignedWalletTransaction: (prepared: any, bytes: string) => {
    if (bytes !== `${prepared.transactionBase64}-signed`) throw new Error("Prepared message or required signatures changed");
    return {signature: signedSignature(prepared), transactionBase64: bytes, messageSha256: prepared.messageSha256};
  },
  SignedTransactionNotSent,
  describeWalletChange: (prepared: any, bytes: string) => ({bytesBefore: 900, bytesAfter: 944, limit: 1232, parsed: true, blockhashChanged: false, programsAdded: ["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"], planned: prepared.messageSha256, returnedLength: bytes.length}),
  checkSignedWalletTransaction: async ({plan: prepared}: any) => {
    savedAtCheck.push((sqlite.query("SELECT signature FROM live_launch_transactions WHERE message_sha256 = ?").get(prepared.messageSha256) as {signature: string | null}).signature);
    if (preSend === "expired") throw new SignedTransactionNotSent("expired", "The signed transaction blockhash expired before it was sent; prepare a fresh transaction");
    if (preSend === "simulation") throw new SignedTransactionNotSent("simulation", 'Signed transaction simulation failed: {"InstructionError":[2,"InsufficientFunds"]}');
    if (preSend === "error") throw new Error("429 Too Many Requests from https://rpc.example.test");
    return preSend === "landed" ? {status: "landed", signature: signedSignature(prepared), err: null} : {status: "ready", signature: signedSignature(prepared), blocksLeft: 50};
  },
  broadcastSignedWalletTransaction: async ({plan: prepared, transactionBase64}: any) => {
    sendCalls++;
    const persisted = sqlite.query("SELECT signature, signed_transaction_base64 FROM live_launch_transactions WHERE message_sha256 = ?").get(prepared.messageSha256) as {signature: string; signed_transaction_base64: string};
    expect(persisted.signature).toBe(signedSignature(prepared));
    expect(persisted.signed_transaction_base64).toBe(transactionBase64);
    return {status: uncertain ? "submission-uncertain" : "submitted", signature: persisted.signature};
  },
}));
const {publicOrigin, liveReadiness} = await import("../../src/lib/carddex/live/config.server");
const {LIVE_SIGN_IN_CHAIN_ID, liveSignInProblem} = await import("../../src/lib/carddex/live/sign-in");
const auth = await import("../../src/lib/carddex/live/auth.server");
const assets = await import("../../src/lib/carddex/live/assets.server");
const service = await import("../../src/lib/carddex/live/service.server");
const {compositionBinding} = await import("../../src/lib/carddex/live/validation.server");
const {COMPOSITION_VERSION, loadRendererAsset} = await import("../../src/lib/carddex/live/composition.server");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (request: Request | string | URL) => {
  const url = new URL(typeof request === "string" ? request : request instanceof URL ? request : request.url);
  if (url.origin !== "https://launchacard.fun") throw new Error("A test attempted external network access");
  if (url.pathname.startsWith("/assets/")) return new Response(readFileSync(resolve(import.meta.dir, "../../public", `.${url.pathname}`)));
  const metadata = url.pathname.startsWith("/m/") ? await assets.serveLiveMetadata(url.pathname.slice(3)) : await assets.serveLiveAsset(url.pathname.split("/").pop()!);
  return metadata;
}) as typeof fetch;
const migrations = resolve(import.meta.dir, "../../migrations");
beforeEach(() => {
  sqlite.close(); sqlite = new Database(":memory:"); objects.clear();
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) { const sql = readFileSync(resolve(migrations, name), "utf8"); if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql); }
  env = {DB: localD1, STORAGE: storage, CARDDEX_DEPLOYMENT_ENV: "production", CARDDEX_PUBLIC_ORIGIN: "https://launchacard.fun", CARDDEX_MAINNET_RPC_URL: "https://rpc.example.test", CARDDEX_LIVE_LAUNCH_ENABLED: "true"};
  tokenVerified = nftVerified = replaceable = uncertain = false; prepareCalls = nftPrepareCalls = sendCalls = 0; receiptCreator = null;
  tokenInputs = []; nftInputs = [];
  tokenVerifyHook = nftVerifyHook = nftPrepareHook = nftReplaceHook = undefined;
  sizes = {createBytes: 950, buyBytes: 1200}; measured = []; preSend = "ready"; savedAtCheck = [];
});
afterAll(() => { globalThis.fetch = nativeFetch; sqlite.close(); });
function image(width: number, height: number) { const bytes = new Uint8Array(40); bytes.set([0x89, 0x50, 0x4e, 0x47]); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; }
async function input(overrides: Partial<{cardTemplate: string; quoteAssetKey: string; quoteMint: string; tokenMint: string}> = {}) {
  const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "Creator token with a separate card.", website: "https://creator.example/", xUrl: "https://x.com/creator", cardTemplate: "spark", quoteAssetKey: "sol", quoteMint: "So11111111111111111111111111111111111111112", ...overrides};
  const refs = {artwork: await assets.putPublicAsset(creator, image(128,128), "image/png"), cardImage: await assets.putPublicAsset(creator, image(1260,1760), "image/png"), caseImage: await assets.putPublicAsset(creator, image(1440,2240), "image/png")};
  await new Prepared("INSERT OR IGNORE INTO live_compositions (wallet, binding_sha256, artwork_sha256, card_sha256, case_sha256, renderer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [creator, await compositionBinding(creator, fields), refs.artwork.sha256, refs.cardImage.sha256, refs.caseImage.sha256, COMPOSITION_VERSION, Date.now()]).run();
  return {...fields, idempotencyKey: "fixture-request", nftMint, initialBuyQuoteBaseUnits: "0", slippageBps: 100, termsAcknowledged: true as const, assets: refs};
}
describe("isolated real-launch server lifecycle", () => {
  const stockPairs = {"stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax", "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx", gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx"};
  const designPairs = [...Object.entries(stockPairs), ...MEME_PAIR_PRESETS.map(({design, quote}) => [design, quote] as const)];
  for (const [cardTemplate, quoteKey] of designPairs) test(`${cardTemplate}/${quoteKey} preserves its exact quote through metadata, NFT preparation and saved reads`, async () => {
    const quote = getPairAsset(quoteKey);
    const original = await input({cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint});
    await expect(service.prepareLiveLaunch(creator, {...original, quoteMint: getPairAsset("usdc").mint})).rejects.toThrow("quote mint does not match");
    expect(prepareCalls).toBe(0);
    const prepared = await service.prepareLiveLaunch(creator, original);
    expect(tokenInputs).toHaveLength(1);
    expect(tokenInputs[0]).toMatchObject({quoteKey: quote.key, card: {designKey: cardTemplate}});
    expect(prepared.intent).toMatchObject({quoteAssetKey: quote.key, quoteMint: quote.mint, cardTemplate});
    for (const uri of [prepared.intent.tokenMetadataUri, prepared.intent.nftMetadataUri]) {
      const metadata = await (await fetch(uri)).json() as any;
      expect(metadata.properties.launchACard).toMatchObject({quoteAssetKey: quote.key, quoteMint: quote.mint, cardTemplate, tokenMint: mint, creatorWallet: creator, cardImageSha256: prepared.intent.assets.cardImage.sha256});
    }
    const metadata = await (await fetch(prepared.intent.nftMetadataUri)).json() as any;
    expect(metadata.attributes).toContainEqual({trait_type: "Card design", value: cardTemplate});
    expect(metadata.attributes).toContainEqual({trait_type: "Quote asset", value: quote.symbol});
    expect(metadata.attributes).toContainEqual({trait_type: "Quote mint", value: quote.mint});
    const stored = sqlite.query("SELECT quote_key, quote_mint, design_key FROM live_launch_intents WHERE id = ?").get(prepared.intent.id);
    expect(stored).toEqual({quote_key: quote.key, quote_mint: quote.mint, design_key: cardTemplate});
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: prepared.intent.id, signature: "s".repeat(88), messageSha256: prepared.transaction!.messageSha256});
    const nft = await service.prepareLiveCreatorNft(creator, {intentId: prepared.intent.id});
    expect(nftInputs).toHaveLength(1);
    expect(nftInputs[0]).toMatchObject({quoteKey: quote.key, nftMetadataSha256: prepared.intent.nftMetadataSha256, card: {designKey: cardTemplate, nftMetadataUri: prepared.intent.nftMetadataUri}});
    expect(nft.transaction!.bindingSha256).toBe(prepared.intent.bindingSha256);
    nftVerified = true;
    await service.confirmLiveCreatorNft(creator, {intentId: prepared.intent.id, signature: "t".repeat(88), messageSha256: nft.transaction!.messageSha256});
    const recovered = await service.getLiveLaunchIntent(creator, prepared.intent.id);
    expect(recovered).toMatchObject({status: "complete", quoteAssetKey: quote.key, quoteMint: quote.mint, cardTemplate, nftMetadataUri: prepared.intent.nftMetadataUri, assets: prepared.intent.assets});
    expect((await service.listLiveLaunchIntents(creator))[0]).toEqual(recovered);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({n: 0});
    expect(sendCalls).toBe(0);
  });
  for (const [cardTemplate, quoteKey] of [["pokemon-classic", "sol"], ["pokemon-full-art", "tslax"], ["pepe", "sol"], ["pepe", "gmex"], ...["ember", "relic", "tide", "neon-circuit", "frost", "mythic", "celestial", "regal", "wildtype", "aurora"].map(design => [design, "sol"])]) test(`saved ${cardTemplate}/${quoteKey} intent retains its existing quote and committed print`, async () => {
    const quote = getPairAsset(quoteKey), original = await input({cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint});
    const prepared = await service.prepareLiveLaunch(creator, original);
    // Existing intents must recover without being reinterpreted by the new chooser presets.
    sqlite.query("UPDATE live_compositions SET renderer_version = 'launchacard-canonical-v1'").run();
    const recovered = await service.prepareLiveLaunch(creator, original);
    expect(recovered.intent).toEqual(prepared.intent);
    expect(recovered.intent).toMatchObject({cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint, assets: prepared.intent.assets});
    expect(prepareCalls).toBe(2);
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: prepared.intent.id, signature: "s".repeat(88), messageSha256: recovered.transaction!.messageSha256});
    await service.prepareLiveCreatorNft(creator, {intentId: prepared.intent.id});
    expect(nftInputs[0]).toMatchObject({quoteKey: quote.key, card: {designKey: cardTemplate, nftMetadataUri: prepared.intent.nftMetadataUri}});
    expect(sendCalls).toBe(0);
  });
  test("trusted renderer rejects stale atlas metadata and changed bytes", async () => {
    expect(COMPOSITION_VERSION).toBe(CARD_RENDERER_VERSION);
    expect(CREATOR_CARD_RENDERER_VERSION).toBe(CARD_RENDERER_VERSION);
    const atlas = renderAssets["pokemon-classic"], original = {...atlas};
    try {
      atlas.rendererVersion = "launchacard-canonical-v1";
      await expect(loadRendererAsset(atlas.path)).rejects.toThrow("current trusted renderer");
      Object.assign(atlas, original, {rendererVersion: CARD_RENDERER_VERSION, sourceSha256: "0".repeat(64)});
      await expect(loadRendererAsset(atlas.path)).rejects.toThrow("approved design");
      Object.assign(atlas, original, {rendererVersion: CARD_RENDERER_VERSION});
      env.ASSETS = {fetch: async () => new Response(new Uint8Array([1, 2, 3]))};
      await expect(loadRendererAsset(atlas.path)).rejects.toThrow("trusted conversion manifest");
      env.ASSETS = {fetch: async () => new Response(readFileSync(resolve(import.meta.dir, "../../public", `.${atlas.path}`)))};
      expect(await loadRendererAsset(atlas.path)).toEqual(new Uint8Array(readFileSync(resolve(import.meta.dir, "../../public", `.${atlas.path}`))));
    } finally { Object.assign(atlas, original); }
  });
  test("new launches require the current print while saved intents retain their committed images", async () => {
    const original = await input();
    sqlite.query("UPDATE live_compositions SET renderer_version = 'launchacard-canonical-v1'").run();
    await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("Compose the canonical");
    expect(prepareCalls).toBe(0);
    sqlite.query("UPDATE live_compositions SET renderer_version = ?").run(COMPOSITION_VERSION);
    const prepared = await service.prepareLiveLaunch(creator, original);
    sqlite.query("UPDATE live_compositions SET renderer_version = 'launchacard-canonical-v1'").run();
    const recovered = await service.prepareLiveLaunch(creator, original);
    expect(recovered.intent.id).toBe(prepared.intent.id);
    expect(recovered.intent.assets).toEqual(prepared.intent.assets);
    expect(recovered.intent.nftMetadataUri).toBe(prepared.intent.nftMetadataUri);
  });
  test("public asset checks reject redirects before a second origin can be fetched", async () => {
    const transport = globalThis.fetch;
    const calls: Array<{url: string; redirect?: RequestRedirect}> = [];
    try {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({url: String(url), redirect: init?.redirect});
        return new Response(null, {status: 302, headers: {location: "https://untrusted.example/image.png"}});
      }) as typeof fetch;
      await expect(assets.fetchPublicBytes("https://launchacard.fun/api/live/assets/fixture.png")).rejects.toThrow("not reachable");
      expect(calls).toEqual([{url: "https://launchacard.fun/api/live/assets/fixture.png", redirect: "manual"}]);
    } finally { globalThis.fetch = transport; }
  });
  test("readiness distinguishes missing configuration and keeps local defaults closed", () => {
    expect(liveReadiness()).toMatchObject({ready: true, enabled: true, recoveryEnabled: true, recoveryReady: true});
    env.CARDDEX_LIVE_LAUNCH_ENABLED = "false";
    expect(liveReadiness()).toMatchObject({ready: false, enabled: false, recoveryEnabled: true, recoveryReady: true});
    for (const value of ["false", "true", "", "0"]) {
      env.CARDDEX_LIVE_LAUNCH_ENABLED = "true"; env.CARDDEX_LIVE_RECOVERY_ENABLED = value;
      expect(liveReadiness()).toMatchObject({ready: value !== "false", recoveryReady: value !== "false"});
    }
    env.CARDDEX_DEPLOYMENT_ENV = "local"; env.CARDDEX_LIVE_LAUNCH_ENABLED = "false"; delete env.CARDDEX_LIVE_RECOVERY_ENABLED;
    expect(liveReadiness().implemented).toBe(true); expect(liveReadiness().ready).toBe(false); expect(liveReadiness().configured).toBe(false); expect(liveReadiness().recoveryReady).toBe(false);
    for (const origin of ["http://launchacard.fun", "https://localhost", "https://localhost.", "https://127.0.0.1", "https://mintdex.fun", "https://user:pass@launchacard.fun", "https://launchacard.fun/path"]) expect(publicOrigin(origin)).toBeNull();
  });
  test("wallet proof is creator-bound, expires, is single-use and independent from demo sessions", async () => {
    const challenge = await auth.createWalletChallenge(creator);
    expect(challenge.message).toContain("launchacard.fun");
    const signature = ed25519.sign(new TextEncoder().encode(challenge.message), creatorSeed);
    const signatureBase64 = btoa(String.fromCharCode(...signature));
    await expect(auth.verifyWalletChallenge({challengeId: challenge.challengeId, wallet: otherWallet, signatureBase64})).rejects.toThrow("expired");
    const result = await auth.verifyWalletChallenge({challengeId: challenge.challengeId, wallet: creator, signatureBase64});
    expect((await auth.liveWalletFromToken(result.token))?.wallet).toBe(creator);
    await expect(auth.verifyWalletChallenge({challengeId: challenge.challengeId, wallet: creator, signatureBase64})).rejects.toThrow("already used");
    expect(sqlite.query("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({n: 0});
    await auth.deleteLiveWalletSession(result.token); expect(await auth.liveWalletFromToken(result.token)).toBeNull();
    const expired = await auth.createWalletChallenge(creator);
    sqlite.query("UPDATE live_wallet_challenges SET expires_at = 0 WHERE id = ?").run(expired.challengeId);
    await expect(auth.verifyWalletChallenge({challengeId: expired.challengeId, wallet: creator, signatureBase64})).rejects.toThrow("expired");
  });
  test("trusted public metadata binds canonical images, quote and wallet without royalties", async () => {
    const prepared = await service.prepareLiveLaunch(creator, await input());
    expect(prepared.intent.status).toBe("prepared"); expect(prepared.intent.bindingSha256).toBe(binding);
    expect(prepared.intent.tokenMetadataUri.length).toBeLessThan(75);
    const tokenJson = await (await fetch(prepared.intent.tokenMetadataUri)).json() as any;
    const nftJson = await (await fetch(prepared.intent.nftMetadataUri)).json() as any;
    expect(tokenJson.image).toBe(prepared.intent.assets.artwork.url);
    expect(tokenJson.website).toBe("https://creator.example/"); expect(tokenJson.twitter).toBe("https://x.com/creator");
    expect(nftJson.image).toBe(prepared.intent.assets.caseImage.url);
    expect(nftJson.seller_fee_basis_points).toBe(0);
    expect(nftJson.properties.launchACard.creatorWallet).toBe(creator);
    expect(nftJson.properties.launchACard.tokenMint).toBe(mint);
    expect(nftJson.properties.launchACard.cardImageSha256).toBe(prepared.intent.assets.cardImage.sha256);
    expect(nftJson.properties.launchACard.rendererVersion).toBe(CARD_RENDERER_VERSION);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({n: 0});
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({n: 0});
    await expect(service.getLiveLaunchIntent(otherWallet, prepared.intent.id)).rejects.toThrow("does not belong");
  });
  test("changed details, opaque image claims and substituted quotes fail before token preparation", async () => {
    const original = await input();
    await expect(service.prepareLiveLaunch(creator, {...original, description: "Changed after composition"})).rejects.toThrow("Compose the canonical");
    await expect(service.prepareLiveLaunch(creator, {...original, cardTemplate: "stock-tsla"})).rejects.toThrow();
    const modified = {...original, assets: {...original.assets, caseImage: {...original.assets.caseImage, url: "https://elsewhere.example/fake.png"}}};
    await expect(service.prepareLiveLaunch(creator, modified)).rejects.toThrow("unchanged images");
    expect(prepareCalls).toBe(0); expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
  });
  test("a stock design preserves its actual quote in prepared input, metadata and finalized receipts", async () => {
    const quote = getPairAsset("tslax");
    const prepared = await service.prepareLiveLaunch(creator, await input({cardTemplate: "stock-tsla", quoteAssetKey: quote.key, quoteMint: quote.mint}));
    expect(prepared.intent.quoteAssetKey).toBe("tslax"); expect(prepared.intent.quoteMint).toBe(quote.mint);
    const metadata = await (await fetch(prepared.intent.nftMetadataUri)).json() as any;
    expect(metadata.properties.launchACard.quoteMint).toBe(quote.mint);
    expect(prepared.transaction!.review.quoteKey).toBe("tslax");
    tokenVerified = true;
    receiptCreator = otherWallet;
    await expect(service.confirmLiveToken(creator, {intentId: prepared.intent.id, signature: "s".repeat(88), messageSha256: prepared.transaction!.messageSha256})).rejects.toThrow("receipt does not match");
    expect((sqlite.query("SELECT status FROM live_launch_intents WHERE id = ?").get(prepared.intent.id) as {status: string}).status).toBe("prepared");
    receiptCreator = null;
    const result = await service.confirmLiveToken(creator, {intentId: prepared.intent.id, signature: "s".repeat(88), messageSha256: prepared.transaction!.messageSha256});
    expect(result.intent.status).toBe("nft_pending"); expect(result.receipt.quoteMint).toBe(quote.mint);
  });
  test("immutable mint/request bindings prevent duplicate or substituted launches", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, original);
    const repeated = await service.prepareLiveLaunch(creator, original);
    expect(repeated.intent.id).toBe(first.intent.id);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 1});
    await expect(service.prepareLiveLaunch(creator, {...original, description: "Other"})).rejects.toThrow("already bound");
    expect(() => sqlite.query("UPDATE live_launch_intents SET quote_mint = 'spoof' WHERE id = ?").run(first.intent.id)).toThrow("immutable");
    expect(() => sqlite.query("UPDATE live_launch_intents SET creator_wallet = ? WHERE id = ?").run(otherWallet, first.intent.id)).toThrow("immutable");
  });
  test("relay stores exact signed bytes before an uncertain send and resumes finalized token/NFT delivery", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), transaction = first.transaction!;
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: transaction.messageSha256, transactionBase64: "modified"})).rejects.toThrow("signatures changed");
    expect(sendCalls).toBe(0);
    uncertain = true;
    const submitted = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: transaction.messageSha256, transactionBase64: `${transaction.transactionBase64}-signed`});
    expect(submitted.submission).toBe("unknown"); expect(submitted.intent.status).toBe("token_pending");
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id})).rejects.toThrow("finalized token");
    const pending = await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: submitted.signature, messageSha256: transaction.messageSha256});
    expect(pending.intent.status).toBe("token_pending");
    tokenVerified = true;
    const recovered = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(recovered.status).toBe("nft_pending");
    const nft = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id});
    expect(nft.transaction?.kind).toBe("nft");
    const sentNft = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: nft.transaction!.messageSha256, transactionBase64: `${nft.transaction!.transactionBase64}-signed`});
    nftVerified = true;
    const complete = await service.confirmLiveCreatorNft(creator, {intentId: first.intent.id, signature: sentNft.signature, messageSha256: nft.transaction!.messageSha256});
    expect(complete.intent.status).toBe("complete");
    expect((await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft})).transaction).toBeNull();
    expect(nftPrepareCalls).toBe(1); expect((await service.listLiveLaunchIntents(creator))).toHaveLength(1);
  });
  test("an expired approval is refused before anything is saved and the same coin can be prepared again", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, original), tx = first.transaction!;
    preSend = "expired";
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`})).rejects.toBeInstanceOf(service.UnsendableTransaction);
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`})).rejects.toThrow("Your wallet approval expired before it could be sent. Nothing was sent or charged. Prepare again");
    expect(sqlite.query("SELECT status, token_signature FROM live_launch_intents WHERE id = ?").get(first.intent.id)).toEqual({status: "prepared", token_signature: null});
    expect(sqlite.query("SELECT signature, signed_transaction_base64, status FROM live_launch_transactions WHERE message_sha256 = ?").get(tx.messageSha256)).toEqual({signature: null, signed_transaction_base64: null, status: "prepared"});
    expect(sendCalls).toBe(0);
    preSend = "ready";
    const again = await service.prepareLiveLaunch(creator, original), fresh = again.transaction!;
    expect(again.intent.id).toBe(first.intent.id); expect(again.intent.tokenMint).toBe(mint); expect(fresh.messageSha256).not.toBe(tx.messageSha256);
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: fresh.messageSha256, transactionBase64: `${fresh.transactionBase64}-signed`});
    expect(sent.submission).toBe("submitted"); expect(sent.intent.status).toBe("token_pending");
    expect(savedAtCheck).toEqual([null, null, null]); expect(sendCalls).toBe(1);
  });
  test("a final check that cannot finish keeps the same signed bytes for another send", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const submit = () => service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`});
    preSend = "error";
    const refused = await submit().then(() => null, (error: Error) => error);
    expect(refused?.message).toBe("The final mainnet check could not finish, so this transaction was not sent yet. Send again to retry with the same wallet approval.");
    expect(service.liveFailure(refused)).toEqual({ok: false, error: refused!.message});
    expect(sqlite.query("SELECT status, token_signature FROM live_launch_intents WHERE id = ?").get(first.intent.id)).toEqual({status: "prepared", token_signature: null});
    expect(sendCalls).toBe(0);
    preSend = "expired";
    const expired = await submit().then(() => null, (error: Error) => error);
    // An expired approval is also marked expired, so the page prepares again and asks once more.
    expect(service.liveFailure(expired)).toEqual({ok: false, error: expired!.message, unsendable: true, expired: true});
    expect(service.liveFailure(new Error("provider detail"))).toEqual({ok: false, error: "The real launch could not proceed. Your demo balances were not used."});
    preSend = "ready";
    const sent = await submit();
    expect(sent.submission).toBe("submitted"); expect(sent.intent.status).toBe("token_pending"); expect(sendCalls).toBe(1);
  });
  test("a re-send of saved bytes says only that the retry was not sent", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const submit = () => service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`});
    uncertain = true;
    expect((await submit()).intent.status).toBe("token_pending");
    for (const [mode, cause] of [["expired", "its wallet approval expired"], ["simulation", "Solana's final check rejected it ({\"InstructionError\":[2,\"InsufficientFunds\"]})"], ["error", "the final mainnet check could not finish"]] as const) {
      preSend = mode;
      const refused = await submit().then(() => null, (error: Error) => error);
      expect(refused?.message).toBe(`This retry was not sent because ${cause}. Check this launch's saved transaction before preparing another.`);
      expect(refused).not.toBeInstanceOf(service.UnsendableTransaction);
    }
    expect(sendCalls).toBe(1);
    expect(sqlite.query("SELECT status, token_signature FROM live_launch_intents WHERE id = ?").get(first.intent.id)).toEqual({status: "token_pending", token_signature: "s".repeat(88)});
  });
  test("a failed signed simulation is refused before anything is saved, for the coin and for the card", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    preSend = "simulation";
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`})).rejects.toThrow("final check rejected this transaction, so it was not sent");
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: "modified"})).rejects.toBeInstanceOf(service.UnsendableTransaction);
    expect(sqlite.query("SELECT status, token_signature FROM live_launch_intents WHERE id = ?").get(first.intent.id)).toEqual({status: "prepared", token_signature: null});
    preSend = "ready"; tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: tx.messageSha256});
    const card = (await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint})).transaction!;
    preSend = "simulation";
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`})).rejects.toThrow("InsufficientFunds");
    expect(sqlite.query("SELECT status, nft_signature FROM live_launch_intents WHERE id = ?").get(first.intent.id)).toEqual({status: "nft_pending", nft_signature: null});
    expect(sendCalls).toBe(0);
    preSend = "ready";
    const again = (await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint})).transaction!;
    expect(again.messageSha256).not.toBe(card.messageSha256);
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: again.messageSha256, transactionBase64: `${again.transactionBase64}-signed`});
    expect(sent.submission).toBe("submitted"); expect(sent.intent.nftSignature).toBe(sent.signature); expect(sendCalls).toBe(1);
  });
  test("a signature the chain already has is saved and recovered without another broadcast", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    preSend = "landed";
    const landed = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`});
    expect(landed.submission).toBe("submitted"); expect(landed.intent.status).toBe("token_pending"); expect(landed.intent.tokenSignature).toBe(landed.signature);
    expect(sqlite.query("SELECT signed_transaction_base64 FROM live_launch_transactions WHERE message_sha256 = ?").get(tx.messageSha256)).toEqual({signed_transaction_base64: `${tx.transactionBase64}-signed`});
    expect(sendCalls).toBe(0);
    tokenVerified = true;
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).status).toBe("nft_pending");
  });
  test("NFT key rotation waits for finalized expiry/absence and cannot duplicate an issued asset", async () => {
    const first = await service.prepareLiveLaunch(creator, await input());
    const signature = "s".repeat(88); tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature, messageSha256: first.transaction!.messageSha256});
    await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id});
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft})).rejects.toThrow("not expired");
    replaceable = true;
    const replaced = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft});
    expect(replaced.intent.nftMint).toBe(replacementNft);
    nftVerified = true;
    const recovered = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(recovered.status).toBe("complete"); expect(recovered.nftMint).toBe(replacementNft);
    expect(() => sqlite.query("UPDATE live_launch_intents SET nft_mint = ? WHERE id = ?").run(nftMint, first.intent.id)).toThrow("immutable");
  });
  test("an expired unissued NFT transaction can retry with the same key and a new signature", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()); tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: first.transaction!.messageSha256});
    const old = (await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id})).transaction!;
    const oldSent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: old.messageSha256, transactionBase64: `${old.transactionBase64}-signed`});
    await service.confirmLiveCreatorNft(creator, {intentId: first.intent.id, signature: oldSent.signature, messageSha256: old.messageSha256});
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint})).rejects.toThrow("not expired");
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).nftSignature).toBe(oldSent.signature);
    expect(nftPrepareCalls).toBe(1);
    replaceable = true;
    const fresh = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint});
    expect(fresh.intent.nftMint).toBe(nftMint); expect(fresh.intent.nftSignature).toBeNull();
    expect((sqlite.query("SELECT nft_receipt_json FROM live_launch_intents WHERE id = ?").get(first.intent.id) as {nft_receipt_json: string | null}).nft_receipt_json).toBeNull();
    expect(fresh.transaction!.messageSha256).not.toBe(old.messageSha256);
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: fresh.transaction!.messageSha256, transactionBase64: `${fresh.transaction!.transactionBase64}-signed`});
    expect(sent.signature).not.toBe(oldSent.signature);
    nftVerified = true;
    expect((await service.confirmLiveCreatorNft(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: fresh.transaction!.messageSha256})).intent.status).toBe("complete");
    expect(sqlite.query("SELECT signature, signed_transaction_base64 FROM live_launch_transactions WHERE message_sha256 = ?").get(old.messageSha256)).toEqual({signature: oldSent.signature, signed_transaction_base64: `${old.transactionBase64}-signed`});
  });
  test("the size check measures the final URI length and reports the buy and the coin alone", async () => {
    const prepared = await service.prepareLiveLaunch(creator, await input());
    const check = (initialBuyQuoteBaseUnits: string) => service.checkLiveLaunchSize(creator, {name: "  Launch   Fixture ", symbol: "fix", quoteAssetKey: "sol", initialBuyQuoteBaseUnits});
    expect(await check("1000")).toEqual({limit: 1232, bytes: 1200, fits: true, buyBytes: 1200, buyFits: true, createBytes: 950, createFits: true});
    expect(measured[0]).toMatchObject({creator, name: "Launch Fixture", symbol: "FIX", quoteKey: "sol"});
    expect(measured[0].tokenMetadataUri).toMatch(/^https:\/\/launchacard\.fun\/m\/[A-Za-z0-9_-]{43}$/);
    expect(measured[0].tokenMetadataUri.length).toBe(prepared.intent.tokenMetadataUri.length);
    sizes = {createBytes: 929, buyBytes: 1240};
    expect(await check("1000")).toMatchObject({bytes: 1240, fits: false, buyFits: false, createFits: true});
    expect(await check("0")).toMatchObject({bytes: 929, fits: true, buyFits: false});
    await expect(service.checkLiveLaunchSize(creator, {name: "Fixture", symbol: "FIX", quoteAssetKey: "not-a-quote", initialBuyQuoteBaseUnits: "1"})).rejects.toThrow("supported pump.fun quote");
    env.CARDDEX_LIVE_LAUNCH_ENABLED = "false";
    await expect(check("1000")).rejects.toThrow("not open");
  });
  test("a buy that cannot fit is refused before any token or card metadata is written", async () => {
    const original = await input(), stored = objects.size;
    sizes = {createBytes: 1032, buyBytes: 1289};
    await expect(service.prepareLiveLaunch(creator, {...original, initialBuyQuoteBaseUnits: "1000"})).rejects.toThrow("doesn't fit in one transaction");
    expect(objects.size).toBe(stored); expect(prepareCalls).toBe(0);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    measured = [];
    expect((await service.prepareLiveLaunch(creator, original)).intent.status).toBe("prepared");
    expect(measured).toHaveLength(0);
  });
  test("prepare checks the composition before it spends an RPC read on the size", async () => {
    const original = await input();
    sqlite.exec("DELETE FROM live_compositions");
    await expect(service.prepareLiveLaunch(creator, {...original, initialBuyQuoteBaseUnits: "1000"})).rejects.toThrow("Compose the canonical");
    expect(measured).toHaveLength(0);
  });
  test("turning off new launches keeps sign-in, saved launches and the card stage working", async () => {
    const coin = await service.prepareLiveLaunch(creator, await input());
    const draft = await service.prepareLiveLaunch(creator, {...await input({tokenMint: otherWallet}), idempotencyKey: "second-request", nftMint: replacementNft});
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: coin.intent.id, signature: "s".repeat(88), messageSha256: coin.transaction!.messageSha256});
    tokenVerified = false;
    const fresh = await input();
    env.CARDDEX_LIVE_LAUNCH_ENABLED = "false";
    await expect(service.prepareLiveLaunch(creator, {...fresh, idempotencyKey: "third-request"})).rejects.toThrow("not open");
    const {composeLiveAssets} = await import("../../src/lib/carddex/live/composition.server");
    await expect(composeLiveAssets(creator, fresh, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow("not open");
    const challenge = await auth.createWalletChallenge(creator);
    expect(challenge.message).not.toContain("not open");
    const session = await auth.verifyWalletChallenge({challengeId: challenge.challengeId, wallet: creator, signatureBase64: btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(challenge.message), creatorSeed)))});
    expect((await auth.requireLiveWallet(session.token)).wallet).toBe(creator);
    expect((await service.listLiveLaunchIntents(creator)).map(intent => intent.id)).toContain(coin.intent.id);
    tokenVerified = true;
    expect((await service.getLiveLaunchIntent(creator, coin.intent.id)).status).toBe("nft_pending");
    const nft = (await service.prepareLiveCreatorNft(creator, {intentId: coin.intent.id})).transaction!;
    const sent = await service.submitLiveTransaction(creator, {intentId: coin.intent.id, kind: "nft", messageSha256: nft.messageSha256, transactionBase64: `${nft.transactionBase64}-signed`});
    nftVerified = true;
    expect((await service.confirmLiveCreatorNft(creator, {intentId: coin.intent.id, signature: sent.signature, messageSha256: nft.messageSha256})).intent.status).toBe("complete");
    const tx = draft.transaction!;
    savedAtCheck = [];
    await expect(service.submitLiveTransaction(creator, {intentId: draft.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`})).rejects.toThrow("not open");
    expect(savedAtCheck).toEqual([null]);
    expect((sqlite.query("SELECT status, token_signature FROM live_launch_intents WHERE id = ?").get(draft.intent.id) as {status: string}).status).toBe("prepared");
    replaceable = true; tokenVerified = false;
    expect((await service.abandonLiveLaunchIntent(creator, {intentId: draft.intent.id})).intent.status).toBe("abandoned");
    env.CARDDEX_LIVE_RECOVERY_ENABLED = "false";
    await expect(auth.createWalletChallenge(creator)).rejects.toThrow("recovery is paused");
    await expect(service.listLiveLaunchIntents(creator)).rejects.toThrow("recovery is paused");
    await expect(service.getLiveLaunchIntent(creator, coin.intent.id)).rejects.toThrow("recovery is paused");
  });
  test("with new launches off, a coin the chain already has is still recorded and its card can follow", async () => {
    const draft = await service.prepareLiveLaunch(creator, await input()), tx = draft.transaction!;
    env.CARDDEX_LIVE_LAUNCH_ENABLED = "false"; preSend = "landed";
    const landed = await service.submitLiveTransaction(creator, {intentId: draft.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`});
    expect(landed.intent.status).toBe("token_pending"); expect(landed.intent.tokenSignature).toBe(landed.signature);
    expect(sqlite.query("SELECT signed_transaction_base64 FROM live_launch_transactions WHERE message_sha256 = ?").get(tx.messageSha256)).toEqual({signed_transaction_base64: `${tx.transactionBase64}-signed`});
    expect(sendCalls).toBe(0);
    tokenVerified = true;
    expect((await service.getLiveLaunchIntent(creator, draft.intent.id)).status).toBe("nft_pending");
    expect((await service.prepareLiveCreatorNft(creator, {intentId: draft.intent.id})).transaction?.kind).toBe("nft");
  });
  test("unused drafts can restart only after finalized token absence and all plan expiries", async () => {
    const prepared = await service.prepareLiveLaunch(creator, await input());
    await expect(service.abandonLiveLaunchIntent(creator, {intentId: prepared.intent.id})).rejects.toThrow("not expired");
    replaceable = true;
    expect((await service.abandonLiveLaunchIntent(creator, {intentId: prepared.intent.id})).intent.status).toBe("abandoned");
    await expect(service.prepareLiveLaunch(creator, await input())).rejects.toThrow("safely abandoned");
    expect(sendCalls).toBe(0);
  });
  test("NFT rotation rejects an old-asset plan added while its chain absence check is in flight", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()); tokenVerified = true; replaceable = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: first.transaction!.messageSha256});
    await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id});
    nftReplaceHook = async () => { await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id}); };
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft})).rejects.toThrow("changed in another request");
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).nftMint).toBe(nftMint);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_transactions WHERE kind = 'nft'").get()).toEqual({n: 2});
  });
  test("a stale NFT preparer cannot insert or return an old mint plan after safe rotation", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()); tokenVerified = true; replaceable = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: first.transaction!.messageSha256});
    nftPrepareHook = async () => { await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft}); };
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id})).rejects.toThrow("changed in another request");
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).nftMint).toBe(replacementNft);
    const plans = sqlite.query("SELECT plan_json FROM live_launch_transactions WHERE kind = 'nft'").all() as {plan_json: string}[];
    expect(plans).toHaveLength(1); expect(JSON.parse(plans[0].plan_json).requiredSigners).toContain(replacementNft);
  });
  test("NFT rotation rejects a concurrent relay submission for the previous asset", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()); tokenVerified = true; replaceable = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: first.transaction!.messageSha256});
    const nft = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id});
    nftReplaceHook = async () => { await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: nft.transaction!.messageSha256, transactionBase64: `${nft.transaction!.transactionBase64}-signed`}); };
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft})).rejects.toThrow("changed in another request");
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).nftMint).toBe(nftMint); expect(sendCalls).toBe(1);
  });
  test("stale pending token and NFT confirmations cannot downgrade finalized receipts", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const token = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`});
    tokenVerifyHook = async () => { tokenVerified = true; await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: token.signature, messageSha256: tx.messageSha256}); };
    await expect(service.confirmLiveToken(creator, {intentId: first.intent.id, signature: token.signature, messageSha256: tx.messageSha256})).rejects.toThrow("changed in another request");
    const stored = sqlite.query("SELECT status, token_signature, token_receipt_json FROM live_launch_intents WHERE id = ?").get(first.intent.id) as any;
    expect(stored.status).toBe("nft_pending"); expect(stored.token_signature).toBe(token.signature); expect(JSON.parse(stored.token_receipt_json).status).toBe("verified");
    const nft = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id}), nftTx = nft.transaction!;
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: nftTx.messageSha256, transactionBase64: `${nftTx.transactionBase64}-signed`});
    nftVerifyHook = async () => { nftVerified = true; await service.confirmLiveCreatorNft(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: nftTx.messageSha256}); };
    await expect(service.confirmLiveCreatorNft(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: nftTx.messageSha256})).rejects.toThrow("changed in another request");
    const complete = sqlite.query("SELECT status, nft_signature, nft_receipt_json FROM live_launch_intents WHERE id = ?").get(first.intent.id) as any;
    expect(complete.status).toBe("complete"); expect(complete.nft_signature).toBe(sent.signature); expect(JSON.parse(complete.nft_receipt_json).status).toBe("verified");
  });
});

// Captures console lines for one call, so log assertions stay independent of other tests.
async function captured<T>(level: "info" | "warn", run: () => Promise<T>) {
  const original = console[level], lines: unknown[][] = [];
  console[level] = (...args: unknown[]) => { lines.push(args); };
  try { return {result: await run(), lines}; } finally { console[level] = original; }
}
describe("wallet warning fixes on the server", () => {
  test("the ownership message names mainnet in the Sign In With Solana grammar, and both sides check it", async () => {
    const challenge = await auth.createWalletChallenge(creator);
    expect(LIVE_SIGN_IN_CHAIN_ID).toBe("mainnet");
    expect(challenge.message).toContain("\nChain ID: mainnet\n");
    expect(challenge.message).not.toContain("solana:5eykt");
    expect(challenge.message.split("\n")[0]).toBe("launchacard.fun wants you to sign in with your Solana account:");
    expect(liveSignInProblem(challenge.message, {origin: "https://launchacard.fun", wallet: creator})).toBeNull();
    expect(liveSignInProblem(challenge.message, {origin: "https://launchacard.fun", wallet: otherWallet})).toContain("another wallet");
    expect(liveSignInProblem(challenge.message, {origin: "https://elsewhere.example", wallet: creator})).toContain("another site");
    const oldChain = challenge.message.replace("Chain ID: mainnet", "Chain ID: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    expect(liveSignInProblem(oldChain, {origin: "https://launchacard.fun", wallet: creator})).toContain("not for Solana mainnet");
    // A stored challenge in any other wording is refused even with a valid signature over it.
    sqlite.query("UPDATE live_wallet_challenges SET message = ? WHERE id = ?").run(oldChain, challenge.challengeId);
    const signed = btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(oldChain), creatorSeed)));
    await expect(auth.verifyWalletChallenge({challengeId: challenge.challengeId, wallet: creator, signatureBase64: signed})).rejects.toThrow("Request a fresh challenge");
    const current = await auth.createWalletChallenge(creator);
    const session = await auth.verifyWalletChallenge({challengeId: current.challengeId, wallet: creator, signatureBase64: btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(current.message), creatorSeed)))});
    expect(session.wallet).toBe(creator);
  });
  test("a stale plan is prepared again with the same coin and card keys, adding plan rows and keeping the saved launch", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, original);
    const again = await service.prepareLiveLaunch(creator, original);
    expect(again.intent).toMatchObject({id: first.intent.id, tokenMint: mint, nftMint, status: "prepared"});
    expect(again.transaction!.messageSha256).not.toBe(first.transaction!.messageSha256);
    expect(sqlite.query("SELECT message_sha256 FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token' ORDER BY created_at, message_sha256").all(first.intent.id)).toEqual([{message_sha256: first.transaction!.messageSha256}, {message_sha256: again.transaction!.messageSha256}]);
    expect(tokenInputs.map(entry => entry.mint)).toEqual([mint, mint]);
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: again.transaction!.messageSha256, transactionBase64: `${again.transaction!.transactionBase64}-signed`});
    expect(sent.intent.status).toBe("token_pending");
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: again.transaction!.messageSha256});
    const card = (await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint})).transaction!;
    const cardAgain = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint});
    expect(cardAgain.intent).toMatchObject({nftMint, nftSignature: null, status: "nft_pending"});
    expect(cardAgain.transaction!.messageSha256).not.toBe(card.messageSha256);
    expect(nftInputs.map(entry => entry.nftMint)).toEqual([nftMint, nftMint]);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM live_launch_transactions WHERE intent_id = ? AND kind = 'nft'").get(first.intent.id) as {n: number}).n).toBe(2);
    const cardSent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: cardAgain.transaction!.messageSha256, transactionBase64: `${cardAgain.transaction!.transactionBase64}-signed`});
    expect(cardSent.submission).toBe("submitted"); expect(sendCalls).toBe(2);
  });
  test("every launch transaction logs its size and headroom, with no wallet address or key", async () => {
    const {result: first, lines} = await captured("info", async () => service.prepareLiveLaunch(creator, await input()));
    const prepared = lines.filter(line => line[0] === "Live launch transaction prepared");
    expect(prepared).toHaveLength(1);
    const entry = JSON.parse(String(prepared[0][1]));
    expect(entry).toMatchObject({intentId: first.intent.id, kind: "token", messageSha256: first.transaction!.messageSha256, limit: 1232});
    expect(entry.headroom).toBe(1232 - entry.bytes);
    expect(String(prepared[0][1])).not.toContain(creator);
    const {lines: signed} = await captured("info", () => service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: first.transaction!.messageSha256, transactionBase64: `${first.transaction!.transactionBase64}-signed`, walletName: "Phantom", signingOrder: "wallet-first"}));
    const sent = signed.filter(line => line[0] === "Live launch transaction signed");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0][1]))).toMatchObject({intentId: first.intent.id, kind: "token", wallet: "Phantom", order: "wallet-first", limit: 1232});
    expect(String(sent[0][1])).not.toContain(creator);
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: first.transaction!.messageSha256});
    const {lines: card} = await captured("info", () => service.prepareLiveCreatorNft(creator, {intentId: first.intent.id}));
    expect(card.filter(line => line[0] === "Live launch transaction prepared").map(line => JSON.parse(String(line[1])).kind)).toEqual(["nft"]);
  });
  test("an approval that ran out of time says so, so the page can prepare and ask once more", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const submit = () => service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-signed`});
    preSend = "expired";
    const expired = await submit().then(() => null, (error: Error) => error);
    expect(service.liveFailure(expired)).toEqual({ok: false, error: expired!.message, unsendable: true, expired: true});
    preSend = "simulation";
    const failed = await submit().then(() => null, (error: Error) => error);
    expect(service.liveFailure(failed)).toEqual({ok: false, error: failed!.message, unsendable: true});
    expect(sendCalls).toBe(0);
  });
  test("a wallet's changed transaction is logged for the mainnet test and nothing is saved or sent", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const {result, lines} = await captured("warn", () => service.reportLiveWalletChange(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, walletName: "Phantom", transactionBase64: "Y2hhbmdlZA=="}));
    expect(result).toEqual({});
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toBe("Live wallet changed the prepared transaction");
    expect(JSON.parse(String(lines[0][1]))).toMatchObject({intentId: first.intent.id, kind: "token", wallet: "Phantom", parsed: true, programsAdded: ["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"], planned: tx.messageSha256});
    expect(sqlite.query("SELECT signature, signed_transaction_base64, status FROM live_launch_transactions WHERE message_sha256 = ?").get(tx.messageSha256)).toEqual({signature: null, signed_transaction_base64: null, status: "prepared"});
    expect(sendCalls).toBe(0);
    await expect(service.reportLiveWalletChange(creator, {intentId: first.intent.id, kind: "token", messageSha256: "e".repeat(64), walletName: "Phantom", transactionBase64: "Y2hhbmdlZA=="})).rejects.toThrow("not prepared for this launch");
    await expect(service.reportLiveWalletChange(otherWallet, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, walletName: "Phantom", transactionBase64: "Y2hhbmdlZA=="})).rejects.toThrow("does not belong");
  });
  test("readiness lists the wallets that sign first: Phantom unless configured", () => {
    expect(liveReadiness().walletFirst).toEqual(["Phantom"]);
    env.CARDDEX_LIVE_WALLET_FIRST = "Phantom, Solflare";
    expect(liveReadiness().walletFirst).toEqual(["Phantom", "Solflare"]);
    env.CARDDEX_LIVE_WALLET_FIRST = "*";
    expect(liveReadiness().walletFirst).toEqual(["*"]);
    env.CARDDEX_LIVE_WALLET_FIRST = "none";
    expect(liveReadiness().walletFirst).toEqual([]);
    env.CARDDEX_LIVE_WALLET_FIRST = "";
    expect(liveReadiness().walletFirst).toEqual([]);
  });
});
