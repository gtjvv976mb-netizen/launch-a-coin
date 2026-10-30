import { ACTIVE_PAIR_DESIGNS } from "../../src/lib/carddex/pair-designs";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "../../../chain/sdk/src/bytes";
import { boundQuoteForDesign, getPairAsset } from "../../src/lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import tokenBackAssets from "../../src/lib/carddex/token-back-assets.json";
import { CARD_RENDERER_VERSION } from "../../src/lib/carddex/card-template";
import { CREATOR_CARD_RENDERER_VERSION, TOKEN_IMAGE_FORMAT } from "../../src/lib/carddex/live/creator-print";
import { TOKEN_ANIMATION_FORMAT } from "../../src/lib/carddex/live/token-turntable";

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
let tokenMediaCalls = 0;
function tokenGif() {
  // Valid single-frame GIF on a square logical canvas. Real frame encoding is
  // exercised by creator-print tests; lifecycle tests never invoke a renderer.
  const bytes = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), value => value.charCodeAt(0));
  new DataView(bytes.buffer).setUint16(6, 1024, true);
  new DataView(bytes.buffer).setUint16(8, 1024, true);
  return bytes;
}
mock.module("../../src/lib/carddex/live/compose.server", () => ({
  composeCreatorTokenMedia: async () => {
    tokenMediaCalls++;
    return {tokenImage: tokenGif(), tokenPoster: image(1024, 1024), mimeType: "image/gif", format: TOKEN_ANIMATION_FORMAT, posterFormat: TOKEN_IMAGE_FORMAT};
  },
}));
let tokenVerified = false, nftVerified = false, replaceable = false, uncertain = false, prepareCalls = 0, nftPrepareCalls = 0, sendCalls = 0, receiptCreator: string | null = null;
let tokenInputs: any[] = [], nftInputs: any[] = [];
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
  sendSignedWalletTransaction: async ({plan: prepared, transactionBase64}: any) => {
    sendCalls++;
    const persisted = sqlite.query("SELECT signature, signed_transaction_base64 FROM live_launch_transactions WHERE message_sha256 = ?").get(prepared.messageSha256) as {signature: string; signed_transaction_base64: string};
    expect(persisted.signature).toBe(signedSignature(prepared));
    expect(persisted.signed_transaction_base64).toBe(transactionBase64);
    return {status: uncertain ? "submission-uncertain" : "submitted", signature: persisted.signature};
  },
}));
const {publicOrigin, liveReadiness} = await import("../../src/lib/carddex/live/config.server");
const auth = await import("../../src/lib/carddex/live/auth.server");
const assets = await import("../../src/lib/carddex/live/assets.server");
const service = await import("../../src/lib/carddex/live/service.server");
const {compositionBinding, normalizeLiveFields} = await import("../../src/lib/carddex/live/validation.server");
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
  tokenMediaCalls = 0;
  tokenInputs = []; nftInputs = [];
  tokenVerifyHook = nftVerifyHook = nftPrepareHook = nftReplaceHook = undefined;
});
afterAll(() => { globalThis.fetch = nativeFetch; sqlite.close(); });
function image(width: number, height: number) { const bytes = new Uint8Array(40); bytes.set([0x89, 0x50, 0x4e, 0x47]); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; }
async function input(overrides: Partial<{cardTemplate: string; quoteAssetKey: string; quoteMint: string}> = {}) {
  const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "Creator token with a separate card.", website: "https://creator.example/", xUrl: "https://x.com/creator", cardTemplate: "spark", quoteAssetKey: "sol", quoteMint: "So11111111111111111111111111111111111111112", ...overrides};
  const refs = {artwork: await assets.putPublicAsset(creator, image(128,128), "image/png"), cardImage: await assets.putPublicAsset(creator, image(1260,1760), "image/png"), caseImage: await assets.putPublicAsset(creator, image(1440,2240), "image/png")};
  await new Prepared("INSERT OR IGNORE INTO live_compositions (wallet, binding_sha256, artwork_sha256, card_sha256, case_sha256, renderer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [creator, await compositionBinding(creator, fields), refs.artwork.sha256, refs.cardImage.sha256, refs.caseImage.sha256, COMPOSITION_VERSION, Date.now()]).run();
  return {...fields, idempotencyKey: "fixture-request", nftMint, initialBuyQuoteBaseUnits: "0", slippageBps: 100, termsAcknowledged: true as const, assets: refs};
}
describe("isolated real-launch server lifecycle", () => {
  const stockPairs = {"stock-gme": "gmex", "stock-tsla": "tslax", "stock-nvda": "nvdax", "stock-aapl": "aaplx", "stock-mstr": "mstrx", "stock-coin": "coinx", gamestop: "gmex", amc: "amc", coinbase: "coinx", strategy: "mstrx"};
  const designPairs = [...Object.entries(stockPairs), ...MEME_PAIR_PRESETS.map(({design, quote}) => [design, quote] as const), ...ACTIVE_PAIR_DESIGNS.filter(design=>design.category!=="memes").map(design=>[design.key,design.quoteKey] as const)];
  for (const [cardTemplate, quoteKey] of designPairs) test(`${cardTemplate}/${quoteKey} preserves its exact quote through metadata, NFT preparation and saved reads`, async () => {
    const quote = getPairAsset(quoteKey);
    const original = await input({cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint});
    const differentMint = getPairAsset(quote.key === "usdc" ? "sol" : "usdc").mint;
    expect(differentMint).not.toBe(quote.mint);
    await expect(service.prepareLiveLaunch(creator, {...original, quoteMint: differentMint})).rejects.toThrow("quote mint does not match");
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
  const neutralPresetDesigns = [...new Set(MEME_PAIR_PRESETS.map(preset => preset.design))].filter(design => !boundQuoteForDesign(design));
  const legacyPairs = [["pokemon-full-art", "tslax"], ["pepe", "gmex"], ...neutralPresetDesigns.map(design => [design, "sol"] as const)];
  for (const [cardTemplate, quoteKey] of legacyPairs) test(`saved ${cardTemplate}/${quoteKey} intent retains its existing quote and committed print`, async () => {
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
  test("token animation backs require approved Higgsfield source and exact converted bytes", async () => {
    const back = tokenBackAssets["pokemon-classic"], original = {...back};
    try {
      back.sourceSha256 = "0".repeat(64);
      await expect(loadRendererAsset(back.path)).rejects.toThrow("approved Higgsfield");
      Object.assign(back, original, {conversionVersion: "untrusted-conversion"});
      await expect(loadRendererAsset(back.path)).rejects.toThrow("approved Higgsfield");
      Object.assign(back, original, {width: 631});
      await expect(loadRendererAsset(back.path)).rejects.toThrow("approved Higgsfield");
      Object.assign(back, original);
      env.ASSETS = {fetch: async () => new Response(new Uint8Array([1, 2, 3]))};
      await expect(loadRendererAsset(back.path)).rejects.toThrow("trusted conversion manifest");
      const bytes = new Uint8Array(readFileSync(resolve(import.meta.dir, "../../public", `.${back.path}`)));
      env.ASSETS = {fetch: async () => new Response(bytes)};
      expect(await loadRendererAsset(back.path)).toEqual(bytes);
      await expect(loadRendererAsset("/assets/carddex/token-backs/unapproved.png")).rejects.toThrow("approved Higgsfield");
      expect(tokenMediaCalls).toBe(0);
      expect(prepareCalls).toBe(0);
    } finally { Object.assign(back, original); }
  });
  for (const previousVersion of ["launchacard-canonical-v1", "launchacard-canonical-v2"]) test("new launches require the current print while saved intents retain their committed images: " + previousVersion, async () => {
    const original = await input();
    sqlite.query("UPDATE live_compositions SET renderer_version = ?").run(previousVersion);
    await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("Compose the canonical");
    expect(prepareCalls).toBe(0);
    sqlite.query("UPDATE live_compositions SET renderer_version = ?").run(COMPOSITION_VERSION);
    const prepared = await service.prepareLiveLaunch(creator, original);
    sqlite.query("UPDATE live_compositions SET renderer_version = ?").run(previousVersion);
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
    expect(liveReadiness().ready).toBe(true);
    env.CARDDEX_DEPLOYMENT_ENV = "local"; env.CARDDEX_LIVE_LAUNCH_ENABLED = "false";
    expect(liveReadiness().implemented).toBe(true); expect(liveReadiness().ready).toBe(false); expect(liveReadiness().configured).toBe(false);
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
    const original = await input(), prepared = await service.prepareLiveLaunch(creator, original);
    expect(prepared.intent.status).toBe("prepared"); expect(prepared.intent.bindingSha256).toBe(binding);
    expect(prepared.intent.tokenMetadataUri.length).toBeLessThan(75);
    const tokenJson = await (await fetch(prepared.intent.tokenMetadataUri)).json() as any;
    const nftJson = await (await fetch(prepared.intent.nftMetadataUri)).json() as any;
    const tokenImage = prepared.intent.assets.tokenImage!, tokenPoster = prepared.intent.assets.tokenPoster!;
    expect(tokenMediaCalls).toBe(1);
    expect(prepared.intent.assets.artwork).toEqual(original.assets.artwork);
    expect(prepared.intent.assets.cardImage).toEqual(original.assets.cardImage);
    expect(prepared.intent.assets.caseImage).toEqual(original.assets.caseImage);
    expect(tokenImage.mimeType).toBe("image/gif");
    expect(tokenImage.url).toMatch(/\/api\/live\/assets\/[a-f0-9]{64}\.gif$/);
    expect(tokenPoster.mimeType).toBe("image/png");
    expect(tokenJson.image).toBe(tokenImage.url);
    expect(tokenJson.animation_url).toBe(tokenImage.url);
    expect(tokenJson.properties.files).toEqual([{uri: tokenImage.url, type: "image/gif"}, {uri: tokenPoster.url, type: "image/png"}]);
    expect(tokenJson.properties.launchACard).toMatchObject({tokenImageSha256: tokenImage.sha256, tokenPosterSha256: tokenPoster.sha256,
      tokenImageFormat: TOKEN_ANIMATION_FORMAT, tokenPosterFormat: TOKEN_IMAGE_FORMAT, artworkSha256: original.assets.artwork.sha256});
    expect(tokenImage.sha256).toBe(await auth.sha256(tokenGif()));
    expect(tokenPoster.sha256).toBe(await auth.sha256(image(1024, 1024)));
    const response = await fetch(tokenImage.url);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(tokenGif());
    expect(sqlite.query("SELECT width, height FROM live_assets WHERE sha256 = ?").get(tokenImage.sha256)).toEqual({width: 1024, height: 1024});
    expect(tokenJson.website).toBe("https://creator.example/"); expect(tokenJson.twitter).toBe("https://x.com/creator");
    expect(nftJson.image).toBe(prepared.intent.assets.caseImage.url);
    expect(nftJson.properties.files).toEqual([{uri: original.assets.caseImage.url, type: "image/png"}, {uri: original.assets.cardImage.url, type: "image/png"}]);
    expect(nftJson.seller_fee_basis_points).toBe(0);
    expect(nftJson.properties.launchACard.creatorWallet).toBe(creator);
    expect(nftJson.properties.launchACard.tokenMint).toBe(mint);
    expect(nftJson.properties.launchACard.cardImageSha256).toBe(prepared.intent.assets.cardImage.sha256);
    expect(nftJson.properties.launchACard.rendererVersion).toBe(CARD_RENDERER_VERSION);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({n: 0});
    expect(sqlite.query("SELECT COUNT(*) AS n FROM coins").get()).toEqual({n: 0});
    await expect(service.getLiveLaunchIntent(otherWallet, prepared.intent.id)).rejects.toThrow("does not belong");
    const repeated = await service.prepareLiveLaunch(creator, original);
    expect(repeated.intent.assets).toEqual(prepared.intent.assets);
    expect(repeated.intent.tokenMetadataUri).toBe(prepared.intent.tokenMetadataUri);
    expect(tokenMediaCalls).toBe(1);
  });
  test("changed details, opaque image claims and substituted quotes fail before token preparation", async () => {
    const original = await input();
    await expect(service.prepareLiveLaunch(creator, {...original, description: "Changed after composition"})).rejects.toThrow("Compose the canonical");
    await expect(service.prepareLiveLaunch(creator, {...original, cardTemplate: "stock-tsla"})).rejects.toThrow();
    const modified = {...original, assets: {...original.assets, caseImage: {...original.assets.caseImage, url: "https://elsewhere.example/fake.png"}}};
    await expect(service.prepareLiveLaunch(creator, modified)).rejects.toThrow("unchanged images");
    expect(prepareCalls).toBe(0); expect(tokenMediaCalls).toBe(0); expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
  });
  for (const role of ["tokenImage", "tokenPoster"] as const) test(`client-supplied ${role} cannot replace server-derived token media`, async () => {
    const original = await input();
    // Even an image genuinely owned by this wallet cannot be selected as the
    // token GIF/poster: these two roles are derived from the trusted card print.
    const forged = {...original, assets: {...original.assets, [role]: original.assets.artwork}};
    await expect(service.prepareLiveLaunch(creator, forged)).rejects.toThrow();
    expect(tokenMediaCalls).toBe(0);
    expect(prepareCalls).toBe(0);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
  });
  test("historical three-asset intents recover their original artwork metadata without composing token media", async () => {
    const original = await input(), fields = normalizeLiveFields(original);
    const tokenMetadata = await assets.putPublicJson(creator, {name: fields.name, symbol: fields.symbol, description: fields.description,
      image: original.assets.artwork.url, properties: {files: [{uri: original.assets.artwork.url, type: original.assets.artwork.mimeType}], category: "image"}});
    const nftMetadata = await assets.putPublicJson(creator, {name: fields.name, image: original.assets.caseImage.url, seller_fee_basis_points: 0});
    const payload = {fields, assets: original.assets, input: {creator, mint, name: fields.name, symbol: fields.symbol, tokenMetadataUri: tokenMetadata.url,
      quoteKey: fields.quoteAssetKey, nftName: fields.name, initialBuyQuoteBaseUnits: original.initialBuyQuoteBaseUnits, slippageBps: original.slippageBps,
      renderedCardSha256: original.assets.cardImage.sha256, nftMetadataSha256: nftMetadata.sha256,
      card: {designKey: fields.cardTemplate, frontUri: original.assets.cardImage.url, backUri: original.assets.caseImage.url,
        frontSha256: original.assets.cardImage.sha256, backSha256: original.assets.caseImage.sha256, nftMetadataUri: nftMetadata.url}}};
    const requestedHash = await auth.sha256(JSON.stringify({creator, fields, assets: original.assets,
      initialBuyQuoteBaseUnits: original.initialBuyQuoteBaseUnits, slippageBps: original.slippageBps}));
    const now = Date.now();
    sqlite.query("INSERT INTO live_launch_intents (id, idempotency_key, creator_wallet, token_mint, nft_mint, quote_key, quote_mint, design_key, payload_sha256, payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)")
      .run("historical-intent", original.idempotencyKey, creator, mint, nftMint, fields.quoteAssetKey, fields.quoteMint, fields.cardTemplate,
        requestedHash, JSON.stringify(payload), binding, tokenMetadata.url, nftMetadata.url, now, now);
    sqlite.query("DELETE FROM live_compositions").run();
    const oldBytes = await assets.fetchPublicBytes(tokenMetadata.url);
    const recovered = await service.prepareLiveLaunch(creator, original);
    expect(recovered.intent.assets).toEqual(original.assets);
    expect(recovered.intent.assets.tokenImage).toBeUndefined();
    expect(recovered.intent.assets.tokenPoster).toBeUndefined();
    expect(recovered.intent.tokenMetadataUri).toBe(tokenMetadata.url);
    expect(recovered.intent.nftMetadataUri).toBe(nftMetadata.url);
    expect(tokenInputs[0].tokenMetadataUri).toBe(tokenMetadata.url);
    expect(tokenInputs[0].nftMetadataSha256).toBe(nftMetadata.sha256);
    expect(await assets.fetchPublicBytes(tokenMetadata.url)).toEqual(oldBytes);
    expect((await (await fetch(tokenMetadata.url)).json() as any).image).toBe(original.assets.artwork.url);
    expect(tokenMediaCalls).toBe(0);
    expect(prepareCalls).toBe(1);
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
