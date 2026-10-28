import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "../../../chain/sdk/src/bytes";
import { getPairAsset } from "../../src/lib/carddex/pairs";

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
  prepareTokenTransaction: async (input: any) => plan(input, "token"),
  verifyTokenLaunch: async (input: any, options: any) => { const result = {status: tokenVerified ? "verified" : "pending", ...identity(input), signature: options.signature, slot: 101, messageSha256: options.expectedMessageSha256}; const hook = tokenVerifyHook; tokenVerifyHook = undefined; await hook?.(); return result; },
  verifyCreatorNft: async (input: any, options: any) => { const result = {status: nftVerified ? "verified" : "pending", ...identity(input), signature: options.signature, slot: 102, messageSha256: options.expectedMessageSha256}; const hook = nftVerifyHook; nftVerifyHook = undefined; await hook?.(); return result; },
  prepareCreatorNftTransaction: async (input: any) => { if (!tokenVerified) throw new Error("Token is not finalized"); const hook = nftPrepareHook; nftPrepareHook = undefined; await hook?.(); return nftVerified ? {status: "already-created", receipt: {status: "verified", ...identity(input)}} : plan(input, "nft"); },
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
const {compositionBinding} = await import("../../src/lib/carddex/live/validation.server");
const {COMPOSITION_VERSION} = await import("../../src/lib/carddex/live/composition.server");
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
