import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import { base58Encode } from "../../../chain/sdk/src/bytes";
import { DIRECT_PAIR_HELD, NOT_OFFERED_PAIR, OFFERED_PAIRS, TRANSFER_FEE_PAIR, UNPAIRED_DESIGN, boundQuoteForDesign, designForPair, designsForPair, getPairAsset, mainnetPairHold } from "../../src/lib/carddex/pairs";
import { MEME_PAIR_PRESETS } from "../../src/lib/carddex/design-pairings";
import renderAssets from "../../src/lib/carddex/render-assets.json";
import tokenBackAssets from "../../src/lib/carddex/token-back-assets.json";
import { CARD_RENDERER_VERSION } from "../../src/lib/carddex/card-template";
import { CREATOR_CARD_RENDERER_VERSION, TOKEN_IMAGE_FORMAT } from "../../src/lib/carddex/live/creator-print";
import { TokenAnimationTooLarge, TOKEN_ANIMATION_FORMAT } from "../../src/lib/carddex/live/token-turntable";

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
  async get(key: string) { const value = objects.get(key); return value ? {arrayBuffer: async () => value.bytes.slice().buffer, body: value.bytes, size: value.bytes.byteLength, httpMetadata: {contentType: value.mime}, httpEtag: '"fixture"'} : null; },
  async head(key: string) { return objects.has(key) ? {key} : null; },
};
let storagePuts = 0;
const countingPut = storage.put.bind(storage);
storage.put = async (...args: Parameters<typeof storage.put>) => { storagePuts++; return countingPut(...args); };
let env: Record<string, unknown>;
// keepAlive stands for waitUntil: it records each promise the Worker would keep running after a closed tab.
let keptAlive = 0;
mock.module("../../src/lib/bindings.server", () => ({bindings: () => env, keepAlive: <T,>(promise: Promise<T>) => { keptAlive++; return promise; }}));
let tokenMediaCalls = 0, tokenMediaTooLarge = false, tokenMediaArtwork: Uint8Array | null = null;
function tokenGif() {
  // Valid single-frame GIF on a square logical canvas. Real frame encoding is
  // exercised by creator-print tests; lifecycle tests never invoke a renderer.
  const bytes = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="), value => value.charCodeAt(0));
  new DataView(bytes.buffer).setUint16(6, 1024, true);
  new DataView(bytes.buffer).setUint16(8, 1024, true);
  return bytes;
}
mock.module("../../src/lib/carddex/live/compose.server", () => ({
  composeCreatorTokenMedia: async (input: {artwork: Uint8Array}) => {
    tokenMediaCalls++; tokenMediaArtwork = input.artwork;
    if (tokenMediaTooLarge) throw new TokenAnimationTooLarge();
    return {tokenImage: tokenGif(), tokenPoster: image(1024, 1024), mimeType: "image/gif", format: TOKEN_ANIMATION_FORMAT, posterFormat: TOKEN_IMAGE_FORMAT};
  },
}));
let tokenVerified = false, nftVerified = false, replaceable = false, uncertain = false, prepareCalls = 0, nftPrepareCalls = 0, sendCalls = 0, receiptCreator: string | null = null;
let tokenInputs: any[] = [], nftInputs: any[] = [];
// The card prepared with its coin (withCard): what it was prepared from, whether that fails, and the wallet's balance.
let aheadInputs: any[] = [], aheadFails = false, walletLamports = "10000000000";
let sizes: {createBytes: number; buyBytes: number; buyBlocked?: string | null} = {createBytes: 950, buyBytes: 1200}, measured: any[] = [];
// What the mocked chain saw: the expected message hash each verification used, and each expiry gate's height.
let verifyHashes: (string | undefined)[] = [], nftTokenHashes: (string | undefined)[] = [], expiryGates: (number | undefined)[] = [], checkedHeight: number | null = null;
let preSend: "ready" | "landed" | "expired" | "simulation" | "error" = "ready", savedAtCheck: (string | null)[] = [];
// The coin landed and failed on chain; a verification that throws for another reason; how a re-send of saved bytes
// answers, and what it was asked to send; whether the RPC refused the first broadcast.
let tokenFailed = false, verifyThrows: string | null = null, resendAnswer: "resent" | "expired" | "landed" = "resent", resends: any[] = [], refusedSend = false;
class SignedTransactionNotSent extends Error { constructor(readonly reason: string, message: string) { super(message); } }
let tokenVerifyHook: (() => Promise<void>) | undefined, nftVerifyHook: (() => Promise<void>) | undefined, nftPrepareHook: (() => Promise<void>) | undefined, nftReplaceHook: (() => Promise<void>) | undefined;
const binding = "b".repeat(64);
function identity(input: any) { return {creatorWallet: receiptCreator ?? input.creator, tokenMint: input.mint, quoteMint: getPairAsset(input.quoteKey).mint, nftMint: input.nftMint}; }
function plan(input: any, kind: "token" | "nft") {
  const counter = kind === "token" ? ++prepareCalls : ++nftPrepareCalls;
  return {kind, transactionBase64: `${kind}-unsigned-${counter}`, messageSha256: (kind === "token" ? "a" : "c").repeat(62) + String(counter).padStart(2, "0"),
    blockhash: "fixture", lastValidBlockHeight: 100, requiredSigners: [input.creator, kind === "token" ? input.mint : input.nftMint], feePayer: input.creator,
    bindingSha256: binding, verifiedSlot: 50, review: {quoteKey: input.quoteKey, initialBuyQuoteBaseUnits: input.initialBuyQuoteBaseUnits,
      walletBalanceLamports: walletLamports, totalDebitLamports: kind === "token" ? "30000000" : "6000000", reserveBufferLamports: "50000"}};
}
function signedSignature(prepared: {kind: string; messageSha256: string}) { return prepared.kind === "token" ? "s".repeat(88) : String.fromCharCode(115 + Number(prepared.messageSha256.slice(-2))).repeat(88); }
// "-guarded" bytes stand for what a wallet returns with appended Lighthouse assertions: another message, so another
// signature and signed hash, within the shared wallet rule.
const guarded = (bytes: string) => bytes.endsWith("-guarded");
// "-refreshed" bytes stand for a wallet-refreshed blockhash within the shared wallet rule.
const refreshed = (bytes: string) => bytes.endsWith("-refreshed");
function signatureFor(prepared: {kind: string; messageSha256: string}, bytes: string) { const signature = signedSignature(prepared); return guarded(bytes) ? signature.slice(0, 87) + "G" : signature; }
const signedHash = (prepared: {messageSha256: string}, bytes: string) => guarded(bytes) ? "e".repeat(62) + prepared.messageSha256.slice(-2) : prepared.messageSha256;
mock.module("../../../integrations/pumpfun/src/live", () => ({
  createMainnetConnection: () => ({}),
  measureTokenTransaction: async (input: any) => { measured.push(input); return {limit: 1232, ...sizes}; },
  prepareTokenTransaction: async (input: any) => { tokenInputs.push(input); return plan(input, "token"); },
  verifyTokenLaunch: async (input: any, options: any) => { verifyHashes.push(options.expectedMessageSha256);
    if (tokenFailed && options.signature) throw Object.assign(new Error('Transaction failed: {"InstructionError":[2,{"Custom":6001}]}'), {name: "TransactionFailedOnChain"});
    if (verifyThrows) throw new Error(verifyThrows);
    const result = {status: tokenVerified ? "verified" : "pending", ...identity(input), signature: options.signature, slot: 101, messageSha256: options.expectedMessageSha256}; const hook = tokenVerifyHook; tokenVerifyHook = undefined; await hook?.(); return result; },
  verifyCreatorNft: async (input: any, options: any) => { if (options.signature) verifyHashes.push(options.expectedMessageSha256); const result = {status: nftVerified ? "verified" : "pending", ...identity(input), signature: options.signature, slot: 102, messageSha256: options.expectedMessageSha256}; const hook = nftVerifyHook; nftVerifyHook = undefined; await hook?.(); return result; },
  prepareCreatorNftAheadOfCoin: async (input: any) => { aheadInputs.push(input); if (aheadFails) throw new Error("429 Too Many Requests from https://rpc.example.test"); return plan(input, "nft"); },
  prepareCreatorNftTransaction: async (input: any, options: any) => { if (!tokenVerified) throw new Error("Token is not finalized"); nftInputs.push(input); nftTokenHashes.push(options.tokenMessageSha256); const hook = nftPrepareHook; nftPrepareHook = undefined; await hook?.(); return nftVerified ? {status: "already-created", receipt: {status: "verified", ...identity(input)}} : plan(input, "nft"); },
  assertNftMintReplaceable: async (_input: any, options: any) => { expiryGates.push(options.lastValidBlockHeight); if (!replaceable || nftVerified) throw new Error("Prior NFT blockhash has not expired or its account exists"); const hook = nftReplaceHook; nftReplaceHook = undefined; await hook?.(); return {replaceable: true}; },
  assertTokenMintReplaceable: async (_input: any, options: any) => { expiryGates.push(options.lastValidBlockHeight); if (!replaceable || tokenVerified) throw new Error("Prior token blockhash has not expired or its account exists"); return {replaceable: true}; },
  validateSignedWalletTransaction: (prepared: any, bytes: string) => {
    if (![`${prepared.transactionBase64}-signed`, `${prepared.transactionBase64}-guarded`, `${prepared.transactionBase64}-refreshed`].includes(bytes)) throw new Error("Prepared message or required signatures changed");
    return {signature: signatureFor(prepared, bytes), transactionBase64: bytes, messageSha256: prepared.messageSha256, signedMessageSha256: signedHash(prepared, bytes),
      blockhash: "fixture", blockhashChanged: refreshed(bytes), walletGuards: guarded(bytes) ? 2 : 0};
  },
  SignedTransactionNotSent,
  describeWalletChange: (prepared: any, bytes: string) => ({bytesBefore: 900, bytesAfter: 944, limit: 1232, parsed: true, blockhashChanged: false, programsAdded: ["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"], planned: prepared.messageSha256, returnedLength: bytes.length}),
  checkSignedWalletTransaction: async ({plan: prepared, transactionBase64: bytes}: any) => {
    savedAtCheck.push((sqlite.query("SELECT signature FROM live_launch_transactions WHERE message_sha256 = ?").get(prepared.messageSha256) as {signature: string | null}).signature);
    if (preSend === "expired") throw new SignedTransactionNotSent("expired", "The signed transaction blockhash expired before it was sent; prepare a fresh transaction");
    if (preSend === "simulation") throw new SignedTransactionNotSent("simulation", 'Signed transaction simulation failed: {"InstructionError":[2,"InsufficientFunds"]}');
    if (preSend === "error") throw new Error("429 Too Many Requests from https://rpc.example.test");
    const checked = {signature: signatureFor(prepared, bytes), signedMessageSha256: signedHash(prepared, bytes), walletGuards: guarded(bytes) ? 2 : 0, blockhashChanged: false, lastValidBlockHeight: checkedHeight ?? prepared.lastValidBlockHeight};
    return preSend === "landed" ? {status: "landed", ...checked, err: null} : {status: "ready", ...checked, blocksLeft: 50};
  },
  broadcastSignedWalletTransaction: async ({plan: prepared, transactionBase64}: any) => {
    sendCalls++;
    const persisted = sqlite.query("SELECT signature, signed_transaction_base64 FROM live_launch_transactions WHERE message_sha256 = ?").get(prepared.messageSha256) as {signature: string; signed_transaction_base64: string};
    expect(persisted.signature).toBe(signatureFor(prepared, transactionBase64));
    expect(persisted.signed_transaction_base64).toBe(transactionBase64);
    if (refusedSend) return {status: "refused", signature: persisted.signature, reason: "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1 (https://rpc.example.test)"};
    return {status: uncertain ? "submission-uncertain" : "submitted", signature: persisted.signature};
  },
  resendSignedWalletTransaction: async (request: any) => {
    resends.push(request);
    return resendAnswer === "resent" ? {status: "resent", signature: "r", blocksLeft: 10} : {status: resendAnswer, signature: "r", ...(resendAnswer === "landed" ? {err: null} : {})};
  },
}));
const {publicOrigin, liveReadiness} = await import("../../src/lib/carddex/live/config.server");
const {LIVE_SIGN_IN_CHAIN_ID, LIVE_SIGN_IN_STATEMENT: LIVE_SIGN_IN_STATEMENT_TEXT, liveSignInProblem} = await import("../../src/lib/carddex/live/sign-in");
const auth = await import("../../src/lib/carddex/live/auth.server");
const assets = await import("../../src/lib/carddex/live/assets.server");
const service = await import("../../src/lib/carddex/live/service.server");
const {compositionBinding, normalizeLiveFields} = await import("../../src/lib/carddex/live/validation.server");
const {COMPOSITION_VERSION, loadRendererAsset} = await import("../../src/lib/carddex/live/composition.server");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (request: Request | string | URL, init?: RequestInit) => {
  const url = new URL(typeof request === "string" ? request : request instanceof URL ? request : request.url);
  if (url.origin !== "https://launchacard.fun") throw new Error("A test attempted external network access");
  if (url.pathname.startsWith("/assets/")) return new Response(readFileSync(resolve(import.meta.dir, "../../public", `.${url.pathname}`)));
  // The routes as the Worker serves them: the request (its headers decide what an unpublished asset answers).
  const routed = new Request(url, init);
  const metadata = url.pathname.startsWith("/m/") ? await assets.serveLiveMetadata(url.pathname.slice(3), routed) : await assets.serveLiveAsset(url.pathname.split("/").pop()!, routed);
  return metadata;
}) as typeof fetch;
const migrations = resolve(import.meta.dir, "../../migrations");
beforeEach(() => {
  sqlite.close(); sqlite = new Database(":memory:"); objects.clear();
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) { const sql = readFileSync(resolve(migrations, name), "utf8"); if (sql.replace(/--[^\n]*/g, "").trim()) sqlite.exec(sql); }
  env = {DB: localD1, STORAGE: storage, CARDDEX_DEPLOYMENT_ENV: "production", CARDDEX_PUBLIC_ORIGIN: "https://launchacard.fun", CARDDEX_MAINNET_RPC_URL: "https://rpc.example.test", CARDDEX_LIVE_LAUNCH_ENABLED: "true"};
  tokenVerified = nftVerified = replaceable = uncertain = false; prepareCalls = nftPrepareCalls = sendCalls = 0; receiptCreator = null;
  tokenMediaCalls = 0; tokenMediaTooLarge = false; tokenMediaArtwork = null;
  tokenInputs = []; nftInputs = [];
  tokenVerifyHook = nftVerifyHook = nftPrepareHook = nftReplaceHook = undefined;
  sizes = {createBytes: 950, buyBytes: 1200}; measured = []; preSend = "ready"; savedAtCheck = [];
  verifyHashes = []; nftTokenHashes = []; expiryGates = []; checkedHeight = null;
  aheadInputs = []; aheadFails = false; walletLamports = "10000000000"; storagePuts = 0; keptAlive = 0;
  tokenFailed = false; verifyThrows = null; resendAnswer = "resent"; resends = []; refusedSend = false;
});
afterAll(() => { globalThis.fetch = nativeFetch; sqlite.close(); });
function image(width: number, height: number) { const bytes = new Uint8Array(40); bytes.set([0x89, 0x50, 0x4e, 0x47]); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; }
async function input(overrides: Partial<{cardTemplate: string; quoteAssetKey: string; quoteMint: string; tokenMint: string}> = {}) {
  // One of SOL's designs (One Piece; the pair picks the card). Overrides may name another pair with its design, or an old combination.
  const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "Creator token with a separate card.", website: "https://creator.example/", xUrl: "https://x.com/creator", cardTemplate: "one-piece", quoteAssetKey: "sol", quoteMint: "So11111111111111111111111111111111111111112", ...overrides};
  const refs = {artwork: await assets.putPublicAsset(creator, image(128,128), "image/png"), cardImage: await assets.putPublicAsset(creator, image(1260,1760), "image/png"), caseImage: await assets.putPublicAsset(creator, image(1440,2240), "image/png")};
  await new Prepared("INSERT OR IGNORE INTO live_compositions (wallet, binding_sha256, artwork_sha256, card_sha256, case_sha256, renderer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [creator, await compositionBinding(creator, fields), refs.artwork.sha256, refs.cardImage.sha256, refs.caseImage.sha256, COMPOSITION_VERSION, Date.now()]).run();
  return {...fields, idempotencyKey: "fixture-request", nftMint, initialBuyQuoteBaseUnits: "0", slippageBps: 100, termsAcknowledged: true as const, assets: refs};
}
/**
 * A launch saved before the pair picked the card, in any combination it allowed then, exactly as its rows were stored
 * (with the coin image GIF and still the token-gif release added). Recovery must take it as it is.
 */
async function savedBeforePairRule(cardTemplate: string, quoteKey: string) {
  const quote = getPairAsset(quoteKey), original = await input({cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint}), fields = normalizeLiveFields(original);
  const tokenImage = await assets.putPublicAsset(creator, new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(40).fill(1)]), "image/gif");
  const tokenPoster = await assets.putPublicAsset(creator, image(1024, 1024), "image/png");
  const tokenMetadata = await assets.putPublicJson(creator, {name: fields.name, symbol: fields.symbol, description: fields.description, image: tokenImage.url, animation_url: tokenImage.url,
    properties: {files: [{uri: tokenImage.url, type: "image/gif"}, {uri: tokenPoster.url, type: "image/png"}], category: "image", launchACard: {cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint}}});
  const nftMetadata = await assets.putPublicJson(creator, {name: fields.name, image: original.assets.caseImage.url, seller_fee_basis_points: 0,
    attributes: [{trait_type: "Card design", value: cardTemplate}, {trait_type: "Quote asset", value: quote.symbol}, {trait_type: "Quote mint", value: quote.mint}]});
  const savedAssets = {...original.assets, tokenImage, tokenPoster};
  const payload = {fields, assets: savedAssets, input: {creator, mint, name: fields.name, symbol: fields.symbol, tokenMetadataUri: tokenMetadata.url,
    quoteKey: fields.quoteAssetKey, nftName: fields.name, initialBuyQuoteBaseUnits: original.initialBuyQuoteBaseUnits, slippageBps: original.slippageBps,
    renderedCardSha256: original.assets.cardImage.sha256, nftMetadataSha256: nftMetadata.sha256,
    card: {designKey: cardTemplate, frontUri: original.assets.cardImage.url, backUri: original.assets.caseImage.url,
      frontSha256: original.assets.cardImage.sha256, backSha256: original.assets.caseImage.sha256, nftMetadataUri: nftMetadata.url}}};
  // The request hash covers the three images the creator composed; the server-made coin images are not part of it.
  const requestedHash = await auth.sha256(JSON.stringify({creator, fields, assets: original.assets, initialBuyQuoteBaseUnits: original.initialBuyQuoteBaseUnits, slippageBps: original.slippageBps}));
  const now = Date.now();
  sqlite.query("INSERT INTO live_launch_intents (id, idempotency_key, creator_wallet, token_mint, nft_mint, quote_key, quote_mint, design_key, payload_sha256, payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)")
    .run("saved-before-pair-rule", original.idempotencyKey, creator, mint, nftMint, fields.quoteAssetKey, fields.quoteMint, cardTemplate,
      requestedHash, JSON.stringify(payload), binding, tokenMetadata.url, nftMetadata.url, now, now);
  return {original, quote, savedAssets, tokenMetadata, nftMetadata, payloadJson: JSON.stringify(payload)};
}
describe("isolated real-launch server lifecycle", () => {
  // The pair picks the card: every offered pair launches with its own design, sent as the pair alone (the Launch form's
  // shape is the full three; older clients too), and keeps it through metadata, the NFT and saved reads. A transfer-fee
  // pair (ZCAT) and the direct pairs the owner has not confirmed are refused for mainnet before anything is made (their
  // own tests below).
  const designPairs = OFFERED_PAIRS.filter(asset => !mainnetPairHold(asset.key)).map(asset => [designForPair(asset.key)!, asset.key] as const);
  for (const [cardTemplate, quoteKey] of designPairs) test(`${quoteKey} launches its own ${cardTemplate} card through metadata, NFT preparation and saved reads`, async () => {
    const quote = getPairAsset(quoteKey);
    const original = await input({cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint});
    const {cardTemplate: _design, ...pairOnly} = original;
    await expect(service.prepareLiveLaunch(creator, {...pairOnly, quoteMint: getPairAsset(quote.key === "usdc" ? "sol" : "usdc").mint})).rejects.toThrow("quote mint does not match");
    expect(prepareCalls).toBe(0);
    const prepared = await service.prepareLiveLaunch(creator, pairOnly);
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
  // A new launch in an old combination is refused in plain words, before any artwork, metadata, plan or row.
  // Designs that pairs offered until the identity designs (spark, doge...) are unpaired now, and so are the held
  // identities (content holds: pair-sv151, pair-tslax...); another pair's design is refused by name; AAVE, UNI and the
  // held-out pairs (67, AGENCY...) are not offered at all.
  const SOL_ONLY = "That card design is for the SOL pair only.";
  const refusedNew: [string, string, string][] = [["pair-doge", "sol", "That card belongs to the DOGE pair. Pick DOGE for it"], ["pokemon-classic", "cards", "The CARDS pair comes with its own card"], ["stock-tsla", "gmex", "The GMEX pair comes with its own card"],
    ["pokemon-classic", "sol", "That card belongs to the SV151 pair."],
    ["doge", "doge", UNPAIRED_DESIGN], ["doge", "sol", UNPAIRED_DESIGN], ["pair-sv151", "sv151", UNPAIRED_DESIGN], ["pair-tslax", "tslax", UNPAIRED_DESIGN], ["pair-ansem", "ansem", UNPAIRED_DESIGN],
    ["pair-usdc", "usdc", UNPAIRED_DESIGN], ["pair-usdc", "sol", UNPAIRED_DESIGN], ["duel-masters", "sol", "That card belongs to the USDC pair."],
    ["gamestop", "gmex", UNPAIRED_DESIGN], ["coinbase", "coinx", UNPAIRED_DESIGN], ["strategy", "mstrx", UNPAIRED_DESIGN], ["gamestop", "sol", UNPAIRED_DESIGN],
    // SOL's design options go with SOL only.
    ["spark", "doge", SOL_ONLY], ["pair-sol", "usdc", SOL_ONLY], ["one-piece", "usdc", SOL_ONLY], ["pokemon-full-art", "sv151", SOL_ONLY], ["shib", "usdc", SOL_ONLY], ["ronin", "cate", SOL_ONLY], ["pepe", "toad", SOL_ONLY],
    ["one-piece", "aave", NOT_OFFERED_PAIR], ["one-piece", "uni", NOT_OFFERED_PAIR], ["pair-67", "67", NOT_OFFERED_PAIR], ["pair-agency", "agency", NOT_OFFERED_PAIR]];
  for (const [cardTemplate, quoteKey, message] of refusedNew) test(`a new ${cardTemplate}/${quoteKey} launch is refused: ${message}`, async () => {
    // The request names the old combination; the fixture's own composition is SOL's, so nothing else could pass.
    const quote = getPairAsset(quoteKey), original = {...await input(), cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint}, puts = storagePuts;
    await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow(message);
    expect(prepareCalls).toBe(0); expect(tokenMediaCalls).toBe(0); expect(storagePuts).toBe(puts);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
  });
  test("a design-only request (an older client) launches with that design's own pair; an unpaired design alone is refused", async () => {
    const doge = getPairAsset("doge"), original = await input({cardTemplate: "pair-doge", quoteAssetKey: doge.key, quoteMint: doge.mint});
    const {quoteAssetKey: _key, quoteMint: _mint, ...designOnly} = original;
    const prepared = await service.prepareLiveLaunch(creator, designOnly);
    expect(prepared.intent).toMatchObject({cardTemplate: "pair-doge", quoteAssetKey: "doge", quoteMint: doge.mint});
    expect(tokenInputs[0]).toMatchObject({quoteKey: "doge", card: {designKey: "pair-doge"}});
    // The same launch sent as all three fields is the same request, not a second one.
    expect((await service.prepareLiveLaunch(creator, original)).intent.id).toBe(prepared.intent.id);
    await expect(service.prepareLiveLaunch(creator, {...designOnly, cardTemplate: "gamestop", idempotencyKey: "another-request", tokenMint: otherWallet})).rejects.toThrow(UNPAIRED_DESIGN);
    await expect(service.prepareLiveLaunch(creator, {...designOnly, cardTemplate: "doge", idempotencyKey: "another-request", tokenMint: otherWallet})).rejects.toThrow(UNPAIRED_DESIGN);
  });
  test("a pair that is not offered (AAVE, UNI; the held-out 67, AGENCY, ALON, HODL...) is refused before any artwork, metadata, plan or row", async () => {
    for (const key of ["aave", "uni", "67", "agency", "alon", "hodl", "jeanphil", "claudia", "biketyson", "neet"]) {
      const quote = getPairAsset(key), original = {...await input(), quoteAssetKey: quote.key, quoteMint: quote.mint}, puts = storagePuts;
      const {cardTemplate: _design, ...pairOnly} = original;
      await expect(service.prepareLiveLaunch(creator, pairOnly)).rejects.toThrow(NOT_OFFERED_PAIR);
      expect(prepareCalls).toBe(0); expect(tokenMediaCalls).toBe(0); expect(storagePuts).toBe(puts);
      expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    }
    const {composeLiveAssets} = await import("../../src/lib/carddex/live/composition.server");
    const aave = getPairAsset("aave"), puts = storagePuts;
    const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "", quoteAssetKey: aave.key, quoteMint: aave.mint};
    await expect(composeLiveAssets(creator, fields, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow(NOT_OFFERED_PAIR);
    await expect(composeLiveAssets(creator, {...fields, cardTemplate: "one-piece"}, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow(NOT_OFFERED_PAIR);
    expect(storagePuts).toBe(puts);
  });
  test("a transfer-fee pair (ZCAT) is refused for mainnet before any upload, coin image, size check, plan or row", async () => {
    const zcat = getPairAsset("zcat"), original = {...await input(), cardTemplate: "pair-zcat", quoteAssetKey: zcat.key, quoteMint: zcat.mint}, puts = storagePuts;
    const {cardTemplate: _design, ...pairOnly} = original;
    for (const request of [original, pairOnly]) await expect(service.prepareLiveLaunch(creator, request)).rejects.toThrow(TRANSFER_FEE_PAIR);
    expect(prepareCalls).toBe(0); expect(tokenMediaCalls).toBe(0); expect(storagePuts).toBe(puts);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    const {composeLiveAssets} = await import("../../src/lib/carddex/live/composition.server");
    const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "", quoteAssetKey: zcat.key, quoteMint: zcat.mint};
    await expect(composeLiveAssets(creator, fields, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow(TRANSFER_FEE_PAIR);
    await expect(service.checkLiveLaunchSize(creator, {name: "Launch Fixture", symbol: "FIX", quoteAssetKey: "zcat", initialBuyQuoteBaseUnits: "1"})).rejects.toThrow(TRANSFER_FEE_PAIR);
    for (const key of ["aave", "67", "agency"]) await expect(service.checkLiveLaunchSize(creator, {name: "Launch Fixture", symbol: "FIX", quoteAssetKey: key, initialBuyQuoteBaseUnits: "1"})).rejects.toThrow(NOT_OFFERED_PAIR);
    expect(storagePuts).toBe(puts);
  });
  test("a direct pair the owner has not confirmed is refused for mainnet before any upload, coin image, size check, plan or row", async () => {
    const {composeLiveAssets} = await import("../../src/lib/carddex/live/composition.server");
    const direct = OFFERED_PAIRS.filter(asset => mainnetPairHold(asset.key) && asset.key !== "zcat");
    expect(direct.map(asset => asset.key)).toEqual(["gork", "stonk", "paid", "pepe", "pill", "npc", "wojak", "eacc", "shib", "swordcat", "plague", "ape", "link"]);
    for (const quote of direct) {
      const original = {...await input(), cardTemplate: designForPair(quote.key)!, quoteAssetKey: quote.key, quoteMint: quote.mint}, puts = storagePuts;
      const {cardTemplate: _design, ...pairOnly} = original;
      for (const request of [original, pairOnly]) await expect(service.prepareLiveLaunch(creator, request)).rejects.toThrow(DIRECT_PAIR_HELD);
      const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "", quoteAssetKey: quote.key, quoteMint: quote.mint};
      await expect(composeLiveAssets(creator, fields, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow(DIRECT_PAIR_HELD);
      await expect(service.checkLiveLaunchSize(creator, {name: "Launch Fixture", symbol: "FIX", quoteAssetKey: quote.key, initialBuyQuoteBaseUnits: "0"})).rejects.toThrow(DIRECT_PAIR_HELD);
      expect(prepareCalls).toBe(0); expect(tokenMediaCalls).toBe(0); expect(storagePuts).toBe(puts);
      expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    }
  });
  test("a card composition is refused for a design that is not its pair's own, before anything is uploaded", async () => {
    const {composeLiveAssets} = await import("../../src/lib/carddex/live/composition.server");
    const fields = {tokenMint: mint, name: "Launch Fixture", symbol: "FIX", description: "", cardTemplate: "pair-doge", quoteAssetKey: "sol", quoteMint: getPairAsset("sol").mint};
    const puts = storagePuts;
    await expect(composeLiveAssets(creator, fields, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow("That card belongs to the DOGE pair.");
    await expect(composeLiveAssets(creator, {...fields, cardTemplate: "gamestop"}, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow(UNPAIRED_DESIGN);
    await expect(composeLiveAssets(creator, {...fields, cardTemplate: "doge"}, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow(UNPAIRED_DESIGN);
    // A SOL design option with another pair is refused; with SOL it is that pair's own (the next test).
    const usdc = getPairAsset("usdc");
    await expect(composeLiveAssets(creator, {...fields, cardTemplate: "kraken", quoteAssetKey: usdc.key, quoteMint: usdc.mint}, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow("for the SOL pair only");
    await expect(composeLiveAssets(creator, {...fields, cardTemplate: "pair-sol", quoteAssetKey: usdc.key, quoteMint: usdc.mint}, new File([image(128, 128)], "art.png", {type: "image/png"}))).rejects.toThrow("for the SOL pair only");
    expect(storagePuts).toBe(puts);
  });
  // SOL's design options (owner, 31 October 2026): each launches with SOL through the live path (composition checks,
  // prepare, metadata, the stored intent) and keeps its design; an option alone (an older ?design= client) brings SOL.
  for (const option of designsForPair("sol")) test(`SOL launches with its ${option} design option through prepare and saved reads`, async () => {
    const sol = getPairAsset("sol");
    const original = await input({cardTemplate: option, quoteAssetKey: sol.key, quoteMint: sol.mint});
    const {quoteAssetKey: _key, quoteMint: _mint, ...designOnly} = original;
    const prepared = await service.prepareLiveLaunch(creator, option === "ronin" ? designOnly : original);
    expect(tokenInputs[0]).toMatchObject({quoteKey: "sol", card: {designKey: option}});
    expect(prepared.intent).toMatchObject({quoteAssetKey: "sol", quoteMint: sol.mint, cardTemplate: option});
    const metadata = await (await fetch(prepared.intent.nftMetadataUri)).json() as any;
    expect(metadata.attributes).toContainEqual({trait_type: "Card design", value: option});
    expect(sqlite.query("SELECT quote_key, design_key FROM live_launch_intents WHERE id = ?").get(prepared.intent.id)).toEqual({quote_key: "sol", design_key: option});
    expect((await service.getLiveLaunchIntent(creator, prepared.intent.id))).toMatchObject({cardTemplate: option, quoteAssetKey: "sol"});
  });
  // Saved before the pair picked the card: every earlier chooser preset (six are their pair's design again under the
  // content holds), neutral designs on SOL or a stock, and designs no pair has. Each recovers byte for byte and
  // finishes its card.
  const neutralPresetDesigns = [...new Set(MEME_PAIR_PRESETS.map(preset => preset.design))].filter(design => !boundQuoteForDesign(design));
  // Also launches saved on this release's pairs that a hold or the release step leaves behind: a direct pair held from
  // mainnet (pair-pepe), a pair new in this release (pair-eth; the release step does not offer it) and two held identities.
  const legacyPairs = [["pokemon-full-art", "tslax"], ["pepe", "gmex"], ["spark", "tslax"], ["gamestop", "gmex"], ["kraken", "sol"],
    ["pair-pepe", "pepe"], ["pair-eth", "eth"], ["pair-solangeles", "solangeles"], ["pair-fartcoin", "fartcoin"],
    ...MEME_PAIR_PRESETS.map(preset => [preset.design, preset.quote] as const),
    ...neutralPresetDesigns.map(design => [design, "sol"] as const)];
  for (const [cardTemplate, quoteKey] of legacyPairs) test(`a launch saved as ${cardTemplate}/${quoteKey} before the pair picked the card recovers unchanged`, async () => {
    const {original, quote, savedAssets, tokenMetadata, nftMetadata, payloadJson} = await savedBeforePairRule(cardTemplate, quoteKey);
    const tokenBytes = await assets.fetchPublicBytes(tokenMetadata.url), nftBytes = await assets.fetchPublicBytes(nftMetadata.url);
    // Its composition is gone (an older print), as for any launch saved a while ago.
    sqlite.query("DELETE FROM live_compositions").run();
    const recovered = await service.prepareLiveLaunch(creator, original);
    expect(recovered.intent).toMatchObject({id: "saved-before-pair-rule", cardTemplate, quoteAssetKey: quote.key, quoteMint: quote.mint, assets: savedAssets, tokenMetadataUri: tokenMetadata.url, nftMetadataUri: nftMetadata.url});
    expect(tokenInputs[0]).toMatchObject({quoteKey: quote.key, tokenMetadataUri: tokenMetadata.url, card: {designKey: cardTemplate}});
    expect(prepareCalls).toBe(1); expect(tokenMediaCalls).toBe(0);
    // Nothing it stored changed: the row, its metadata and its coin images.
    expect((sqlite.query("SELECT payload_json FROM live_launch_intents WHERE id = 'saved-before-pair-rule'").get() as {payload_json: string}).payload_json).toBe(payloadJson);
    expect(await assets.fetchPublicBytes(tokenMetadata.url)).toEqual(tokenBytes);
    expect(await assets.fetchPublicBytes(nftMetadata.url)).toEqual(nftBytes);
    expect((await service.getLiveLaunchIntent(creator, "saved-before-pair-rule")).assets).toEqual(savedAssets);
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: "saved-before-pair-rule", signature: "s".repeat(88), messageSha256: recovered.transaction!.messageSha256});
    await service.prepareLiveCreatorNft(creator, {intentId: "saved-before-pair-rule"});
    expect(nftInputs[0]).toMatchObject({quoteKey: quote.key, card: {designKey: cardTemplate, nftMetadataUri: nftMetadata.url}});
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
    expect(liveReadiness()).toMatchObject({ready: true, enabled: true, recoveryEnabled: true, recoveryReady: true});
    env.CARDDEX_LIVE_LAUNCH_ENABLED = "false";
    expect(liveReadiness()).toMatchObject({ready: false, enabled: false, recoveryEnabled: true, recoveryReady: true});
    // Both switches read trimmed and in any case: an operator's "False" or "0" pauses recovery (it used to stay on).
    for (const [value, on] of [["false", false], ["False", false], [" FALSE ", false], ["0", false], ["off", false], ["no", false], ["true", true], ["", true], ["1", true], ["typo", true]] as const) {
      env.CARDDEX_LIVE_LAUNCH_ENABLED = "true"; env.CARDDEX_LIVE_RECOVERY_ENABLED = value;
      expect(liveReadiness()).toMatchObject({ready: on, recoveryReady: on});
    }
    delete env.CARDDEX_LIVE_RECOVERY_ENABLED;
    for (const [value, on] of [["true", true], [" TRUE ", true], ["True", true], ["yes", false], ["1", false], ["", false]] as const) {
      env.CARDDEX_LIVE_LAUNCH_ENABLED = value;
      expect(liveReadiness()).toMatchObject({enabled: on, ready: on, recoveryReady: true});
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
    const original = await input(), prepared = await service.prepareLiveLaunch(creator, original);
    expect(prepared.intent.status).toBe("prepared"); expect(prepared.intent.bindingSha256).toBe(binding);
    expect(prepared.intent.tokenMetadataUri.length).toBeLessThan(75);
    const tokenJson = await (await fetch(prepared.intent.tokenMetadataUri)).json() as any;
    const nftJson = await (await fetch(prepared.intent.nftMetadataUri)).json() as any;
    const tokenImage = prepared.intent.assets.tokenImage!, tokenPoster = prepared.intent.assets.tokenPoster!;
    expect(tokenMediaCalls).toBe(1);
    // The coin image is made from the committed artwork bytes, nothing else.
    expect(tokenMediaArtwork).toEqual(image(128, 128));
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
    // Prepared, not signed: public for the wallet approval with a short cache (immutable once the coin is signed).
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    // Its size too, so a HEAD (served by GET without the body) says it.
    expect(response.headers.get("content-length")).toBe(String(tokenGif().byteLength));
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
  test("artwork bytes that change between the ownership check and the coin image are refused before rendering", async () => {
    const original = await input(), routed = globalThis.fetch;
    let artworkReads = 0;
    // The first read (the ownership check) is the committed artwork; the second (the coin image's own read) is not.
    globalThis.fetch = (async (request: Request | string | URL, init?: RequestInit) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      if (url === original.assets.artwork.url && ++artworkReads > 1) return new Response(image(256, 256), {headers: {"content-type": "image/png"}});
      return routed(request, init);
    }) as typeof fetch;
    try { await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("does not match its committed content"); }
    finally { globalThis.fetch = routed; }
    expect(artworkReads).toBe(2);
    expect(tokenMediaCalls).toBe(0); expect(prepareCalls).toBe(0);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_assets WHERE mime_type IN ('image/gif', 'application/json')").get()).toEqual({n: 0});
  });
  test("a coin image over the size limit refuses the launch in plain words, before metadata or any RPC", async () => {
    tokenMediaTooLarge = true;
    await expect(service.prepareLiveLaunch(creator, await input())).rejects.toThrow("too much fine detail for your coin's turning image");
    expect(tokenMediaCalls).toBe(1); expect(prepareCalls).toBe(0);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_assets WHERE mime_type = 'application/json'").get()).toEqual({n: 0});
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
    expect(JSON.parse(new TextDecoder().decode(await assets.fetchPublicBytes(tokenMetadata.url))).image).toBe(original.assets.artwork.url);
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
    expect(service.liveFailure(new Error("provider detail"))).toEqual({ok: false, error: "The launch paused. Nothing was sent unless your saved launch says so."});
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
    expect(await check("1000")).toEqual({limit: 1232, bytes: 1200, fits: true, buyBytes: 1200, buyFits: true, createBytes: 950, createFits: true, buyBlocked: null});
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
  test("a tokenized-stock first buy is refused with its own reason before anything is written", async () => {
    const original = await input(), stored = objects.size;
    sizes = {createBytes: 950, buyBytes: 1000, buyBlocked: "issuer-controls"};
    const check = (initialBuyQuoteBaseUnits: string) => service.checkLiveLaunchSize(creator, {name: "Fixture", symbol: "FIX", quoteAssetKey: original.quoteAssetKey, initialBuyQuoteBaseUnits});
    expect(await check("1")).toMatchObject({fits: false, buyFits: false, createFits: true, buyBlocked: "issuer-controls"});
    expect(await check("0")).toMatchObject({fits: true, buyFits: false, buyBlocked: "issuer-controls"});
    await expect(service.prepareLiveLaunch(creator, {...original, initialBuyQuoteBaseUnits: "1000"})).rejects.toThrow("Wallets warn when a first buy spends a tokenized-stock quote");
    expect(objects.size).toBe(stored); expect(prepareCalls).toBe(0);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
  });
  test("a wallet's assertions: the signed message hash and expiry bound are saved with the bytes, never change, and every later check uses them", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const coinHash = "e".repeat(62) + tx.messageSha256.slice(-2);
    // The page sends the plan's hash (the plan id) with the bytes the wallet returned; the bound is a refreshed one.
    checkedHeight = 400;
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-guarded`, walletName: "Phantom", signingOrder: "wallet-first"});
    expect(sqlite.query("SELECT signature, signed_message_sha256, effective_last_valid_block_height FROM live_launch_transactions WHERE message_sha256 = ?").get(tx.messageSha256))
      .toEqual({signature: sent.signature, signed_message_sha256: coinHash, effective_last_valid_block_height: 400});
    for (const change of [`signed_message_sha256 = '${"f".repeat(64)}'`, "effective_last_valid_block_height = 401", "signed_message_sha256 = NULL"]) {
      expect(() => sqlite.exec(`UPDATE live_launch_transactions SET ${change} WHERE message_sha256 = '${tx.messageSha256}'`)).toThrow("immutable");
    }
    // Confirmation by the plan's hash verifies the landed transaction against the signed hash.
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: tx.messageSha256});
    await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(verifyHashes).toEqual([coinHash, coinHash]);
    // Abandon waits past the signed bytes' bound (400), not the plan's (100).
    replaceable = true;
    expect((await service.abandonLiveLaunchIntent(creator, {intentId: first.intent.id})).intent.status).toBe("abandoned");
    expect(expiryGates).toEqual([400]);
  });
  test("the card is prepared under the coin's signed hash, and a card key rotation waits past the signed card's bound", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: `${tx.transactionBase64}-guarded`});
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: tx.messageSha256});
    const card = (await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id})).transaction!;
    expect(nftTokenHashes).toEqual(["e".repeat(62) + tx.messageSha256.slice(-2)]);
    checkedHeight = 500;
    const cardSent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-guarded`});
    expect(sqlite.query("SELECT signed_message_sha256, effective_last_valid_block_height FROM live_launch_transactions WHERE signature = ?").get(cardSent.signature)).toEqual({signed_message_sha256: "e".repeat(62) + card.messageSha256.slice(-2), effective_last_valid_block_height: 500});
    replaceable = true;
    await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft});
    expect(expiryGates).toEqual([500]);
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

describe("one wallet approval for the coin and its card, on the server", () => {
  const rows = (id: string) => sqlite.query("SELECT kind, signature, signed_transaction_base64 AS bytes, signed_message_sha256 AS hash, effective_last_valid_block_height AS bound FROM live_launch_transactions WHERE intent_id = ? ORDER BY kind, created_at").all(id) as {kind: string; signature: string | null; bytes: string | null; hash: string | null; bound: number | null}[];
  test("withCard prepares the card plan with the coin's, saved together, before the coin exists", async () => {
    const first = await service.prepareLiveLaunch(creator, {...await input(), withCard: true});
    expect(first.intent.status).toBe("prepared");
    expect(first.card).toMatchObject({kind: "nft", requiredSigners: [creator, nftMint], bindingSha256: binding});
    expect(aheadInputs).toHaveLength(1); expect(aheadInputs[0]).toMatchObject({creator, mint, nftMint, card: {nftMetadataUri: first.intent.nftMetadataUri}});
    expect(rows(first.intent.id).map(row => row.kind)).toEqual(["nft", "token"]);
    // Without it, nothing extra is prepared; a stale re-prepare with it adds a fresh pair for the same launch and keys.
    const plain = await service.prepareLiveLaunch(creator, await input());
    expect(plain.card).toBeNull(); expect(aheadInputs).toHaveLength(1);
    const again = await service.prepareLiveLaunch(creator, {...await input(), withCard: true});
    expect(again.intent.id).toBe(first.intent.id); expect(again.card!.messageSha256).not.toBe(first.card!.messageSha256);
    expect(rows(first.intent.id).map(row => row.kind)).toEqual(["nft", "nft", "token", "token", "token"]);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 1});
    expect(sendCalls).toBe(0);
  });
  test("the card stays out of the coin's prompt when the wallet cannot cover both, or it cannot be prepared now", async () => {
    walletLamports = "36000000"; // the coin's 30,000,000 and its 50,000 reserve fit; the card's 6,000,000 more does not
    const short = await service.prepareLiveLaunch(creator, {...await input(), withCard: true});
    expect(short.card).toBeNull(); expect(short.transaction!.kind).toBe("token");
    expect(rows(short.intent.id).map(row => row.kind)).toEqual(["token"]);
    walletLamports = "10000000000"; aheadFails = true;
    const {result, lines} = await captured("info", async () => service.prepareLiveLaunch(creator, {...await input(), withCard: true}));
    expect(result.card).toBeNull(); expect(result.transaction!.kind).toBe("token");
    const skipped = lines.filter(line => line[0] === "Live launch card not prepared with its coin").map(line => String(line[1]));
    expect(skipped).toHaveLength(1); expect(skipped[0]).toContain("[provider]"); expect(skipped[0]).not.toContain("rpc.example.test");
  });
  test("the approved card is saved before the coin is sent, never relayed before the coin is verified, and a closed tab can send it", async () => {
    const first = await service.prepareLiveLaunch(creator, {...await input(), withCard: true}), coin = first.transaction!, card = first.card!;
    const cardBytes = `${card.transactionBase64}-signed`;
    // Never before the coin is verified, held or not.
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: cardBytes})).rejects.toThrow("sent once its coin is verified");
    expect(await service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: cardBytes, walletName: "Backpack", signingOrder: "page-first"})).toEqual({held: true, lastValidBlockHeight: 100});
    expect(rows(first.intent.id).find(row => row.kind === "nft")).toEqual({kind: "nft", signature: null, bytes: cardBytes, hash: card.messageSha256, bound: 100});
    // The same bytes again are accepted; other bytes for that plan are refused, and the saved bytes never change.
    await service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: cardBytes});
    await expect(service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-guarded`})).rejects.toThrow("other approved bytes");
    expect(() => sqlite.exec(`UPDATE live_launch_transactions SET signed_transaction_base64 = 'other' WHERE message_sha256 = '${card.messageSha256}'`)).toThrow("immutable");
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).approvedCard).toEqual({messageSha256: card.messageSha256, transactionBase64: cardBytes, nftMint});
    await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: coin.messageSha256, transactionBase64: `${coin.transactionBase64}-signed`});
    expect(sendCalls).toBe(1);
    // The tab closes. A fresh page reads the saved launch: the coin is pending, the card still approved.
    const resumed = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(resumed).toMatchObject({status: "token_pending", approvedCard: {messageSha256: card.messageSha256}});
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: cardBytes})).rejects.toThrow("sent once its coin is verified");
    tokenVerified = true;
    const verified = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(verified.status).toBe("nft_pending"); expect(verified.approvedCard!.transactionBase64).toBe(cardBytes);
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-guarded`})).rejects.toThrow("already approved with other signed bytes");
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: verified.approvedCard!.messageSha256, transactionBase64: verified.approvedCard!.transactionBase64});
    expect(sent.intent.nftSignature).toBe(sent.signature); expect(sendCalls).toBe(2);
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).approvedCard).toBeNull();
    nftVerified = true;
    expect((await service.confirmLiveCreatorNft(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: card.messageSha256})).intent.status).toBe("complete");
    expect(verifyHashes.at(-1)).toBe(card.messageSha256);
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).approvedCard).toBeUndefined();
  });
  test("an approved card that ran out of time while the coin confirmed is prepared again on its own, with the same card key", async () => {
    const first = await service.prepareLiveLaunch(creator, {...await input(), withCard: true}), card = first.card!;
    await service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`});
    const coinSent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: first.transaction!.messageSha256, transactionBase64: `${first.transaction!.transactionBase64}-signed`});
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: coinSent.signature, messageSha256: first.transaction!.messageSha256});
    preSend = "expired";
    const refused = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`}).then(() => null, (error: unknown) => error);
    expect(service.liveFailure(refused)).toMatchObject({ok: false, unsendable: true, expired: true});
    expect(sqlite.query("SELECT status, nft_signature FROM live_launch_intents WHERE id = ?").get(first.intent.id)).toEqual({status: "nft_pending", nft_signature: null});
    preSend = "ready";
    const fresh = (await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint})).transaction!;
    expect(fresh.requiredSigners).toEqual([creator, nftMint]); expect(expiryGates).toEqual([]);
    // The newer card plan replaces the expired approval.
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).approvedCard).toBeNull();
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: fresh.messageSha256, transactionBase64: `${fresh.transactionBase64}-signed`});
    expect(sent.intent.nftSignature).toBe(sent.signature); expect(sendCalls).toBe(2);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 1});
  });
  test("a card key change waits past the approved card's expiry, and the old approval is never used for the new key", async () => {
    const first = await service.prepareLiveLaunch(creator, {...await input(), withCard: true}), card = first.card!;
    await service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`});
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: first.transaction!.messageSha256});
    await expect(service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft})).rejects.toThrow("not expired");
    expect(expiryGates).toEqual([100]);
    replaceable = true;
    const rotated = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id, nftMint: replacementNft});
    expect(rotated.intent.nftMint).toBe(replacementNft);
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).approvedCard).toBeNull();
    await expect(service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`})).rejects.toThrow("does not match");
    expect(sendCalls).toBe(0);
  });
  test("a card is saved ahead only within the same check as a send, and only before it is sent", async () => {
    const first = await service.prepareLiveLaunch(creator, {...await input(), withCard: true}), card = first.card!, coin = first.transaction!;
    const hold = (messageSha256: string, transactionBase64: string) => service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256, transactionBase64});
    await expect(hold(card.messageSha256, "modified")).rejects.toThrow("differs from the one you reviewed");
    await expect(hold(card.messageSha256, `${card.transactionBase64}-refreshed`)).rejects.toThrow("refreshed the card's blockhash");
    await expect(hold(coin.messageSha256, `${coin.transactionBase64}-signed`)).rejects.toThrow("not prepared for this launch");
    await expect(service.holdLiveCard(otherWallet, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`})).rejects.toThrow("does not belong");
    expect(rows(first.intent.id).every(row => row.bytes === null)).toBe(true);
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: coin.messageSha256});
    await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "nft", messageSha256: card.messageSha256, transactionBase64: `${card.transactionBase64}-signed`});
    await expect(hold(card.messageSha256, `${card.transactionBase64}-signed`)).rejects.toThrow("can no longer be saved");
  });
  test("readiness lists the wallets that sign both in one prompt: none unless configured, never Phantom", () => {
    // Opt-in (WW-5): no wallet takes the untested multi-transaction request on the first mainnet launch.
    expect(liveReadiness().walletBatch).toEqual([]);
    env.CARDDEX_LIVE_WALLET_BATCH = "Backpack";
    expect(liveReadiness().walletBatch).toEqual(["Backpack"]);
    env.CARDDEX_LIVE_WALLET_BATCH = "Phantom, Backpack, MetaMask";
    expect(liveReadiness().walletBatch).toEqual(["Backpack", "MetaMask"]);
    env.CARDDEX_LIVE_WALLET_BATCH = "*";
    expect(liveReadiness().walletBatch).toEqual(["*"]);
    env.CARDDEX_LIVE_WALLET_BATCH = "none";
    expect(liveReadiness().walletBatch).toEqual([]);
  });
});

const {liveSignInText} = await import("../../src/lib/carddex/live/sign-in");
describe("Sign In With Solana on the server (solana:signIn)", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const proof = (challengeId: string, text: string, seed = creatorSeed, wallet = creator) => ({challengeId, wallet, signedMessageBase64: b64(encode(text)), signatureBase64: b64(ed25519.sign(encode(text), seed))});
  test("a wallet-independent challenge names this site and mainnet, and a canonical sign-in starts the same session as the message", async () => {
    const challenge = await auth.createSignInChallenge("203.0.113.7");
    expect(challenge.input).toMatchObject({domain: "launchacard.fun", uri: "https://launchacard.fun", version: "1", chainId: "mainnet", statement: LIVE_SIGN_IN_STATEMENT_TEXT});
    expect(challenge.input.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(challenge.input.expirationTime) - Date.parse(challenge.input.issuedAt)).toBe(5 * 60_000);
    // The client is stored only as a hash.
    expect(JSON.stringify(sqlite.query("SELECT * FROM live_sign_in_challenges").all())).not.toContain("203.0.113.7");
    const session = await auth.verifySignInChallenge(proof(challenge.challengeId, liveSignInText(challenge.input, creator)));
    expect(session.wallet).toBe(creator);
    expect((await auth.requireLiveWallet(session.token)).wallet).toBe(creator);
    expect(sqlite.query("SELECT wallet, consumed_at IS NOT NULL AS used FROM live_sign_in_challenges WHERE id = ?").get(challenge.challengeId)).toEqual({wallet: creator, used: 1});
    await expect(auth.verifySignInChallenge(proof(challenge.challengeId, liveSignInText(challenge.input, creator)))).rejects.toThrow("already used");
    expect(() => sqlite.exec(`UPDATE live_sign_in_challenges SET input_json = '{}' WHERE id = '${challenge.challengeId}'`)).toThrow("immutable");
  });
  test("another site, chain, wording, account or signature is refused, and nothing starts a session", async () => {
    const challenge = await auth.createSignInChallenge("203.0.113.8"), text = liveSignInText(challenge.input, creator);
    const before = (sqlite.query("SELECT COUNT(*) AS n FROM live_wallet_sessions").get() as {n: number}).n;
    for (const [changed, reason] of [
      [text.replace("launchacard.fun wants", "www.launchacard.fun wants"), "another site"],
      [text.replace("URI: https://launchacard.fun", "URI: https://launch-a-card.gtjvv976mb.workers.dev"), "another site"],
      [text.replace("Chain ID: mainnet", "Chain ID: solana:mainnet"), "not for Solana mainnet"],
      [text.replace("Authorize Launch a Card", "Authorize"), "changed the sign-in message"],
      [`${text}\nResources:\n- https://elsewhere.example`, "changed the sign-in message"],
      [`Sign in\n${text}`, "something other than a sign-in"],
    ] as const) await expect(auth.verifySignInChallenge(proof(challenge.challengeId, changed))).rejects.toThrow(reason);
    await expect(auth.verifySignInChallenge(proof(challenge.challengeId, text, new Uint8Array(32).fill(10), otherWallet))).rejects.toThrow("names another wallet");
    await expect(auth.verifySignInChallenge({...proof(challenge.challengeId, liveSignInText(challenge.input, otherWallet), creatorSeed, otherWallet)})).rejects.toThrow("signature is invalid");
    expect((sqlite.query("SELECT COUNT(*) AS n FROM live_wallet_sessions").get() as {n: number}).n).toBe(before);
    // Still unused: the right proof is accepted afterwards.
    expect((await auth.verifySignInChallenge(proof(challenge.challengeId, text))).wallet).toBe(creator);
  });
  test("an expired challenge is refused; challenges are limited per client, not per wallet; recovery off closes sign-in", async () => {
    const expired = await auth.createSignInChallenge("203.0.113.9");
    // Its expiry is immutable in the schema; the test lifts that rule only to stand in for the passing of time.
    sqlite.exec("DROP TRIGGER carddex_live_sign_in_challenge_immutable");
    sqlite.query("UPDATE live_sign_in_challenges SET expires_at = 0 WHERE id = ?").run(expired.challengeId);
    await expect(auth.verifySignInChallenge(proof(expired.challengeId, liveSignInText(expired.input, creator)))).rejects.toThrow("expired");
    const {LIMITS} = await import("../../src/lib/carddex/live/limits.server");
    for (let i = 1; i < LIMITS.signInIp.max; i++) await auth.createSignInChallenge("203.0.113.9");
    await expect(auth.createSignInChallenge("203.0.113.9")).rejects.toThrow("Wait a minute");
    // The address is stored only as a keyed hash.
    expect(JSON.stringify(sqlite.query("SELECT client_hash FROM live_sign_in_challenges").all())).not.toContain("203.0.113.9");
    expect((await auth.createSignInChallenge("198.51.100.1")).input.domain).toBe("launchacard.fun");
    env.CARDDEX_LIVE_RECOVERY_ENABLED = "false";
    await expect(auth.createSignInChallenge("198.51.100.2")).rejects.toThrow("recovery is paused");
  });
  test("end to end: a mock wallet with solana:signIn connects and signs in with one prompt against the real server checks", async () => {
    const {mountRegistry, signInLiveWallet, connectLiveWallet, signLiveMessage, walletSupportsSignIn, disconnectLiveWallet} = await import("../../src/components/carddex/live/wallet");
    const {proveOwnership} = await import("../../src/components/carddex/live/launch-flow");
    const {mockWallet} = await import("./mock-wallets");
    const release = mountRegistry(), phantom = mockWallet({name: "Phantom", seed: creatorSeed, signIn: true});
    try {
      let token = "";
      const result = await proveOwnership({address: null, canSignIn: walletSupportsSignIn("Phantom"), origin: "https://launchacard.fun",
        signInChallenge: () => auth.createSignInChallenge("203.0.113.10"),
        verifySignIn: async signed => { token = (await auth.verifySignInChallenge(signed)).token; },
        messageChallenge: wallet => auth.createWalletChallenge(wallet), verifyMessage: async signed => { token = (await auth.verifyWalletChallenge(signed)).token; },
        signIn: input => signInLiveWallet("Phantom", input), connect: () => connectLiveWallet("Phantom"), signMessage: (message, wallet) => signLiveMessage(message, wallet)});
      expect(result).toEqual({address: creator, method: "sign-in", prompts: 1});
      expect(phantom.prompts).toEqual(["signIn"]);
      expect((await auth.requireLiveWallet(token)).wallet).toBe(creator);
    } finally { await disconnectLiveWallet(); phantom.unregister(); release(); }
  });
});

describe("provider failures read as plain words (MW-3)", () => {
  test("an RPC that refuses or drops a request reads as one sentence; launch checks keep their own words", () => {
    for (const raw of [
      '403 Forbidden:  {"jsonrpc":"2.0","error":{"code": 403, "message":"Your IP or provider is blocked from this endpoint"}, "id": "4557d45c" }',
      'failed to get recent blockhash: Error: 429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":429,"message":"Too many requests"}}',
      "502 Bad Gateway: <html>upstream</html>",
      "fetch failed",
      "Network connection lost.",
      "The operation was aborted due to timeout",
      "internal error; reference = pc27opduf86h0jp5mdcd18pu",
    ]) expect(service.plainChainError(new Error(raw), "token").message).toBe(service.PROVIDER_UNAVAILABLE);
    for (const raw of ["Current Pump accounts are unavailable", "The pair mint account is unavailable", "Token mint already exists"]) expect(service.plainChainError(new Error(raw), "token").message).toBe(raw);
    expect(service.plainChainError(new Error("A transaction signed for this mint can still land"), "token").message).toContain("can still land for up to about a minute");
    expect(service.plainChainError(Object.assign(new Error("x"), {name: "TransactionFailedOnChain"}), "nft")).toBeInstanceOf(service.LaunchFailedOnChain);
    // No provider URL ever reaches the creator.
    expect(service.plainChainError(new Error("Simulation failed at https://rpc.example.invalid/?api-key=secret"), "token").message).not.toContain("secret");
  });
});

describe("platform hardening on the server", () => {
  const sign = (message: string) => btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(message), creatorSeed)));
  const servePublic = (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    return path.startsWith("/m/") ? assets.serveLiveMetadata(path.slice(3), new Request(url, init)) : assets.serveLiveAsset(path.split("/").pop()!, new Request(url, init));
  };
  const signedTx = (plan: {transactionBase64: string}, guardedBytes = false) => `${plan.transactionBase64}-${guardedBytes ? "guarded" : "signed"}`;
  test("request limits refuse past the window, per scope and client, and store only hashes (SEC-1)", async () => {
    const {enforceLimit, purgeRateEvents, LIMITS} = await import("../../src/lib/carddex/live/limits.server");
    const rule = {scope: "test:rule", max: 3, windowMs: 60_000};
    for (let i = 0; i < 3; i++) await enforceLimit(rule, "203.0.113.20");
    await expect(enforceLimit(rule, "203.0.113.20")).rejects.toThrow("Too many requests right now");
    await enforceLimit(rule, "203.0.113.21");
    await enforceLimit({...rule, scope: "test:other"}, "203.0.113.20");
    // A refused request adds nothing; the client is stored only as a hash.
    expect(sqlite.query("SELECT COUNT(*) AS n FROM rate_events WHERE scope = 'test:rule'").get()).toEqual({n: 4});
    expect(JSON.stringify(sqlite.query("SELECT * FROM rate_events").all())).not.toContain("203.0.113");
    await enforceLimit(rule, "203.0.113.20", undefined, Date.now() + 61_000);
    await purgeRateEvents(Date.now() + 2 * 86_400_000);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM rate_events").get()).toEqual({n: 0});
    // Every rule sits above one creator's launch: a few prepares, a minute and a half of confirmation polls.
    expect(LIMITS.prepareWallet.max).toBeGreaterThanOrEqual(10); expect(LIMITS.confirmWallet.max).toBeGreaterThanOrEqual(45);
  });
  test("an IPv6 address counts as its /64, so rotating addresses inside one allocation shares one bucket (SEC-R1)", async () => {
    const {clientKey, enforceLimit, LIMITS} = await import("../../src/lib/carddex/live/limits.server");
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey(" 2001:DB8:1:2::1 ")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:0db8:0001:0002:abcd:ef01:2345:6789")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8:1:2:3::9")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(clientKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(clientKey("2001:db8:1:2:0:0:198.51.100.4")).toBe("2001:db8:1:2::/64");
    expect(clientKey("")).toBeNull(); expect(clientKey(null)).toBeNull(); expect(clientKey(undefined)).toBeNull();
    // The review's reproduction, inverted: one /64 is refused like one address.
    for (let i = 0; i < LIMITS.composeIp.max; i++) await enforceLimit(LIMITS.composeIp, clientKey(`2001:db8:1:2::${(i + 1).toString(16)}`));
    let accepted = 0;
    for (let i = 2; i < 50; i++) await enforceLimit(LIMITS.composeIp, clientKey(`2001:db8:1:2:${i.toString(16)}:${(i * 7).toString(16)}::${i.toString(16)}`)).then(() => accepted++, () => undefined);
    expect(accepted).toBe(0);
    await enforceLimit(LIMITS.composeIp, clientKey("2001:db8:1:3::1"));
    for (let i = 0; i < LIMITS.signInIp.max; i++) await auth.createSignInChallenge(clientKey(`2001:db8:9:9::${(i + 1).toString(16)}`));
    await expect(auth.createSignInChallenge(clientKey("2001:db8:9:9:ffff::1"))).rejects.toThrow("Wait a minute");
  });
  test("a burst of sign-in challenges in parallel takes exactly the limit (SEC-R3); clients are stored as keyed hashes (SEC-R4)", async () => {
    const {clientHash, LIMITS} = await import("../../src/lib/carddex/live/limits.server");
    const results = await Promise.allSettled(Array.from({length: LIMITS.signInIp.max + 20}, () => auth.createSignInChallenge("198.51.100.77")));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(LIMITS.signInIp.max);
    // An unsalted hash of a constant scope and an IPv4 address could be reversed by hashing every address; these are keyed.
    const plain = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${LIMITS.signInIp.scope}|198.51.100.77`))).subarray(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
    const stored = (sqlite.query("SELECT DISTINCT key_hash FROM rate_events WHERE scope = ?").all(LIMITS.signInIp.scope) as {key_hash: string}[]).map(row => row.key_hash);
    expect(stored).toEqual([await clientHash(LIMITS.signInIp.scope, "198.51.100.77")]);
    expect(stored).not.toContain(plain);
  });
  test("a database without this build's migrations is reported, and the limits let requests through rather than fail them (REG-2)", async () => {
    const {enforceLimit, missingMigrations} = await import("../../src/lib/carddex/live/limits.server");
    expect(await missingMigrations()).toEqual([]);
    sqlite.exec("DROP TABLE rate_events");
    const errors: unknown[][] = [], original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      for (let i = 0; i < 5; i++) await enforceLimit({scope: "test:missing", max: 1, windowMs: 60_000}, "203.0.113.50");
    } finally { console.error = original; }
    expect(errors).toHaveLength(1); expect(String(errors[0][0])).toContain("apply the D1 migrations");
    expect(await missingMigrations()).toEqual(["0014"]);
    sqlite.exec("ALTER TABLE live_assets DROP COLUMN public_until");
    expect(await missingMigrations()).toEqual(["0014", "0015"]);
  });
  test("every connecting-address read goes through clientKey, and the size check and sessions are limited per address (SEC-R1, SEC-R2)", () => {
    const sources = (dir: string): string[] => readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? sources(resolve(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [resolve(dir, entry.name)] : []);
    const reads = sources(resolve(import.meta.dir, "../../src")).flatMap(file => readFileSync(file, "utf8").split("\n").filter(line => /cf-connecting-ip/i.test(line) && !/^\s*(\/\/|\*)/.test(line)).map(line => [file, line] as const));
    // The live API's reads (the demo's account and upload reads went with the demo).
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const [file, line] of reads) expect([file, /clientKey\(/.test(line)]).toEqual([file, true]);
    const api = readFileSync(resolve(import.meta.dir, "../../src/lib/carddex/live/api.ts"), "utf8");
    const handler = (name: string) => api.slice(api.indexOf(`export const ${name} =`), api.indexOf("\nexport const", api.indexOf(`export const ${name} =`) + 1));
    expect(handler("checkLiveLaunchSize")).toContain("perAddress(LIMITS.sizeIp)");
    for (const name of ["verifyLiveWallet", "verifyLiveSignIn"]) expect(handler(name)).toContain("LIMITS.sessionIp");
  });
  test("anyone can ask for a wallet's challenge, but its owner is never locked out (SEC-2)", async () => {
    // Someone without the creator's key asks for the creator's challenges, up to the per-wallet limit.
    const issued: {challengeId: string; message: string}[] = [];
    for (let i = 0; i < auth.WALLET_CHALLENGES_PER_MINUTE; i++) issued.push(await auth.createWalletChallenge(creator, "198.51.100.66"));
    // The creator still gets a challenge (the newest open one, no new row) and signs in with their own key.
    const mine = await auth.createWalletChallenge(creator, "203.0.113.30");
    expect(mine.challengeId).toBe(issued.at(-1)!.challengeId);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_wallet_challenges WHERE wallet = ?").get(creator)).toEqual({n: auth.WALLET_CHALLENGES_PER_MINUTE});
    const session = await auth.verifyWalletChallenge({challengeId: mine.challengeId, wallet: creator, signatureBase64: sign(mine.message)});
    expect((await auth.requireLiveWallet(session.token)).wallet).toBe(creator);
    // A used challenge is never handed out again.
    expect((await auth.createWalletChallenge(creator, "203.0.113.30")).challengeId).toBe(issued.at(-2)!.challengeId);
    // The flood itself is limited per connecting address.
    const {LIMITS} = await import("../../src/lib/carddex/live/limits.server");
    for (let i = 0; i < LIMITS.challengeIp.max - auth.WALLET_CHALLENGES_PER_MINUTE; i++) await auth.createWalletChallenge(otherWallet, "198.51.100.66");
    await expect(auth.createWalletChallenge(otherWallet, "198.51.100.66")).rejects.toThrow("Too many requests");
  });
  test("an upload is not public until a launch uses it: for its approval while unsigned, for good once its coin is signed (SEC-3, SEC-R5)", async () => {
    const original = await input(), art = original.assets.artwork;
    for (const init of [undefined, {headers: {"x-launch-a-card-asset-check": "0".repeat(64)}}]) {
      const hidden = await servePublic(art.url, init);
      expect(hidden.status).toBe(404); expect(hidden.headers.get("cache-control")).toBe("no-store");
    }
    // A prepare refused before the chain (a buy that cannot fit) publishes nothing.
    sizes = {createBytes: 1032, buyBytes: 1289};
    await expect(service.prepareLiveLaunch(creator, {...original, initialBuyQuoteBaseUnits: "1000"})).rejects.toThrow("doesn't fit");
    expect((await servePublic(art.url)).status).toBe(404);
    sizes = {createBytes: 950, buyBytes: 1200};
    const prepared = await service.prepareLiveLaunch(creator, original);
    const tokenJson = await (await servePublic(prepared.intent.tokenMetadataUri)).json() as any;
    const nftJson = await (await servePublic(prepared.intent.nftMetadataUri)).json() as any;
    const urls = new Set<string>([prepared.intent.tokenMetadataUri, prepared.intent.nftMetadataUri, tokenJson.image, tokenJson.animation_url, nftJson.image,
      ...tokenJson.properties.files.map((file: {uri: string}) => file.uri), tokenJson.properties.launchACard.tokenPoster,
      ...nftJson.properties.files.map((file: {uri: string}) => file.uri), nftJson.properties.launchACard.sourceFront, nftJson.properties.launchACard.sourceBack]);
    // Both metadata files, the coin's turning GIF and its still, the case and card prints, and both design copies.
    expect(urls.size).toBe(8);
    // The permanent URL contract every launched coin and card depends on (REL-7): never change these formats (.gif is
    // the coin's turning card, added beside them).
    for (const url of urls) expect(url).toMatch(/^https:\/\/launchacard\.fun\/(?:m\/[A-Za-z0-9_-]{43}|api\/live\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif))$/);
    // Prepared but not signed (preparing costs no SOL): public for the wallet approval, so the prompt can show the coin,
    // with a short cache; once that window ends, only its uploader and the Worker's own check read it.
    for (const url of urls) {
      const served = await servePublic(url);
      expect(served.status).toBe(200);
      expect(served.headers.get("cache-control")).toBe("public, max-age=300");
      expect(served.headers.get("access-control-allow-origin")).toBe("*");
    }
    const later = (url: string, init?: RequestInit) => assets.serveLiveAsset(new URL(url).pathname.startsWith("/m/") ? `${assets.metadataShaFromUri(url)}.json` : url.split("/").pop()!, new Request(url, init), Date.now() + assets.PREVIEW_MS + 1);
    for (const url of urls) expect((await later(url)).status).toBe(404);
    const {token} = await auth.verifyWalletChallenge(await (async () => { const challenge = await auth.createWalletChallenge(creator); return {challengeId: challenge.challengeId, wallet: creator, signatureBase64: sign(challenge.message)}; })());
    const own = await later(art.url, {headers: {cookie: `carddex_live_session=${token}`}});
    expect(own.status).toBe(200); expect(own.headers.get("cache-control")).toBe("no-store"); expect(own.headers.get("access-control-allow-origin")).toBeNull();
    // Another wallet's session reads nothing it did not upload.
    const otherToken = (await auth.verifyWalletChallenge(await (async () => { const challenge = await auth.createWalletChallenge(otherWallet); return {challengeId: challenge.challengeId, wallet: otherWallet, signatureBase64: btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(challenge.message), new Uint8Array(32).fill(10))))}; })())).token;
    expect((await later(art.url, {headers: {cookie: `carddex_live_session=${otherToken}`}})).status).toBe(404);
    // The signed coin is saved (before it is sent): from then on everything is public for good.
    await service.submitLiveTransaction(creator, {intentId: prepared.intent.id, kind: "token", messageSha256: prepared.transaction!.messageSha256, transactionBase64: signedTx(prepared.transaction!)});
    for (const url of urls) {
      const served = await later(url);
      expect(served.status).toBe(200);
      expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(served.headers.get("access-control-allow-origin")).toBe("*");
      expect(served.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    }
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_assets WHERE published_at > 0").get()).toEqual({n: 9});
  });
  test("a launch an older Worker saved while the migrations ran ahead of the deploy keeps its metadata public (F2)", async () => {
    const prepared = await service.prepareLiveLaunch(creator, await input());
    // What the deployed Worker writes between `migrations apply` and the deploy: rows without published_at.
    sqlite.query("UPDATE live_assets SET published_at = NULL, public_until = NULL").run();
    for (const url of [prepared.intent.tokenMetadataUri, prepared.intent.nftMetadataUri, prepared.intent.assets.artwork.url]) {
      const served = await servePublic(url);
      expect(served.status).toBe(200); expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    }
    // A coin recorded from the chain publishes its assets too, however its bytes got there.
    sqlite.query("UPDATE live_assets SET published_at = 0").run();
    tokenVerified = true;
    await service.confirmLiveToken(creator, {intentId: prepared.intent.id, signature: "s".repeat(88), messageSha256: prepared.transaction!.messageSha256});
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_assets WHERE published_at > 0").get()).toEqual({n: 9});
  });
  test("the same bytes are stored once, and every asset stored before the gate stays public", async () => {
    const bytes = image(200, 200), first = await assets.putPublicAsset(creator, bytes, "image/png"), puts = storagePuts;
    expect((await assets.putPublicAsset(otherWallet, bytes, "image/png")).sha256).toBe(first.sha256);
    expect(storagePuts).toBe(puts);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_asset_grants WHERE sha256 = ?").get(first.sha256)).toEqual({n: 2});
    // Lost from R2 (but still listed): written again.
    objects.clear(); await assets.putPublicAsset(creator, bytes, "image/png"); expect(storagePuts).toBe(puts + 1);
    const before = new Database(":memory:");
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql") && name < "0014").sort()) { const sql = readFileSync(resolve(migrations, name), "utf8"); if (sql.replace(/--[^\n]*/g, "").trim()) before.exec(sql); }
    before.query("INSERT INTO live_assets (sha256, storage_key, mime_type, byte_length, created_at) VALUES (?, ?, 'image/png', 1, 42)").run("a".repeat(64), `live/${"a".repeat(64)}.png`);
    before.exec(readFileSync(resolve(migrations, "0014_platform_limits.sql"), "utf8"));
    expect(before.query("SELECT published_at FROM live_assets").get()).toEqual({published_at: 42});
    before.close();
  });
  const fillPlans = (intentId: string, kind: "token" | "nft", count: number, at = Date.now()) => {
    for (let i = 0; i < count; i++) sqlite.query("INSERT INTO live_launch_transactions (id, intent_id, kind, message_sha256, plan_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'prepared', ?, ?)").run(crypto.randomUUID(), intentId, kind, `cap-${kind}-${i}`, at, at);
  };
  test("a launch's plan rows are capped per stage, refused before any RPC call, then slowed rather than closed (F1)", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, original);
    fillPlans(first.intent.id, "token", service.MAX_PLANS_PER_STAGE - 1);
    const calls = prepareCalls;
    await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("prepared many times in a row");
    expect(prepareCalls).toBe(calls);
    // Card rows never count against the coin stage.
    sqlite.query("DELETE FROM live_launch_transactions WHERE intent_id = ? AND message_sha256 LIKE 'cap-token-%'").run(first.intent.id);
    fillPlans(first.intent.id, "nft", 3 * service.MAX_PLANS_PER_STAGE);
    expect((await service.prepareLiveLaunch(creator, original)).transaction).not.toBeNull();
    // Past the cap, one more plan once the newest is a few minutes old: never a dead end.
    fillPlans(first.intent.id, "token", service.MAX_PLANS_PER_STAGE, Date.now() - service.PLAN_SLOW_LANE_MS - 1_000);
    sqlite.query("UPDATE live_launch_transactions SET created_at = ? WHERE intent_id = ? AND kind = 'token'").run(Date.now() - service.PLAN_SLOW_LANE_MS - 1_000, first.intent.id);
    expect((await service.prepareLiveLaunch(creator, original)).transaction).not.toBeNull();
    await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("Wait a few minutes");
  });
  test("a coin that landed after many prepares can always prepare its card (F1)", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, original);
    // A long session: the coin was prepared again many times (stale plans, expiries) before the last one landed.
    fillPlans(first.intent.id, "token", service.MAX_PLANS_PER_STAGE - 2);
    const last = await service.prepareLiveLaunch(creator, original);
    await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: last.transaction!.messageSha256, transactionBase64: signedTx(last.transaction!)});
    tokenVerified = true;
    expect((await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: "s".repeat(88), messageSha256: last.transaction!.messageSha256})).intent.status).toBe("nft_pending");
    const card = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id});
    expect(card.transaction).not.toBeNull();
    // Even a card stage past its own cap only waits a few minutes, and its words never tell the creator to discard.
    fillPlans(first.intent.id, "nft", 2 * service.MAX_PLANS_PER_STAGE);
    const slowed = await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id}).then(() => "", (error: Error) => error.message);
    expect(slowed).toContain("Wait a few minutes"); expect(slowed).not.toMatch(/discard/i);
    sqlite.query("UPDATE live_launch_transactions SET created_at = ? WHERE intent_id = ? AND kind = 'nft'").run(Date.now() - service.PLAN_SLOW_LANE_MS - 1_000, first.intent.id);
    expect((await service.prepareLiveCreatorNft(creator, {intentId: first.intent.id})).transaction).not.toBeNull();
  });
  test("expired challenges and sessions are purged; anything still counted or valid stays (SEC-4)", async () => {
    const now = Date.now(), hour = 3_600_000;
    sqlite.query("INSERT INTO live_wallet_challenges (id, wallet, origin, message, created_at, expires_at) VALUES ('old', ?, 'https://launchacard.fun', 'm', ?, ?)").run(creator, now - 3 * hour, now - 3 * hour + 300_000);
    sqlite.query("INSERT INTO live_wallet_challenges (id, wallet, origin, message, created_at, expires_at) VALUES ('fresh', ?, 'https://launchacard.fun', 'm', ?, ?)").run(creator, now, now + 300_000);
    sqlite.query("INSERT INTO live_sign_in_challenges (id, client_hash, origin, input_json, created_at, expires_at) VALUES ('old', 'h', 'https://launchacard.fun', '{}', ?, ?)").run(now - 3 * hour, now - 3 * hour + 300_000);
    sqlite.query("INSERT INTO live_wallet_sessions (token_hash, wallet, created_at, expires_at) VALUES ('ended', ?, ?, ?), ('live', ?, ?, ?)").run(creator, now - 3 * hour, now - hour, creator, now, now + hour);
    await auth.purgeExpiredLiveRows(now);
    expect(sqlite.query("SELECT id FROM live_wallet_challenges").all()).toEqual([{id: "fresh"}]);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_sign_in_challenges").get()).toEqual({n: 0});
    expect(sqlite.query("SELECT token_hash FROM live_wallet_sessions").all()).toEqual([{token_hash: "live"}]);
  });
  test("sign-out's origin check does not depend on the switches (SEC-7)", async () => {
    const {assertSiteOrigin} = await import("../../src/lib/carddex/live/config.server");
    env.CARDDEX_LIVE_RECOVERY_ENABLED = "false";
    expect(() => assertSiteOrigin("https://launchacard.fun")).not.toThrow();
    for (const origin of [null, "https://edge.launchacard.com", "https://evil.example"]) expect(() => assertSiteOrigin(origin)).toThrow("configured Launch a Card site");
  });
  test("a coin that landed and failed still loads, says so plainly, and is prepared again with the same mint (REL-1)", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, original), tx = first.transaction!;
    const sent = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: signedTx(tx)});
    tokenFailed = true;
    // Readable, never thrown: the page can show it and offer the next step.
    const loaded = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(loaded).toMatchObject({status: "token_pending", chainCheck: {state: "failed-on-chain", kind: "token"}});
    expect(loaded.chainCheck!.reason).toContain("no coin was created");
    await expect(service.confirmLiveToken(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: tx.messageSha256})).rejects.toBeInstanceOf(service.LaunchFailedOnChain);
    // Prepared again only once nothing it signed can still land (the abandon gate), with the same mint and card key.
    await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("Prior token blockhash");
    replaceable = true;
    const again = await service.prepareLiveLaunch(creator, original);
    expect(again.intent).toMatchObject({id: first.intent.id, status: "prepared", tokenMint: mint, nftMint, tokenSignature: null});
    expect(again.transaction!.messageSha256).not.toBe(tx.messageSha256);
    // The old signature cannot pull the launch back to pending.
    tokenFailed = false;
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: sent.signature, messageSha256: tx.messageSha256});
    expect((sqlite.query("SELECT status FROM live_launch_intents WHERE id = ?").get(first.intent.id) as {status: string}).status).toBe("prepared");
    const retry = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: again.transaction!.messageSha256, transactionBase64: signedTx(again.transaction!, true)});
    expect(retry.intent.status).toBe("token_pending"); expect(retry.signature).not.toBe(sent.signature);
    // Reading the launch checks only the current submission: the old signature never replaces it.
    resendAnswer = "expired";
    const reread = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(reread).toMatchObject({status: "token_pending", tokenSignature: retry.signature, chainCheck: {state: "expired-unlanded"}});
    expect(resends.map(request => request.transactionBase64)).toEqual([signedTx(again.transaction!, true)]);
    tokenVerified = true;
    expect((await service.getLiveLaunchIntent(creator, first.intent.id))).toMatchObject({status: "nft_pending", tokenSignature: retry.signature});
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 1});
  });
  test("a chain check that cannot finish leaves the saved launch readable and unchanged (REL-1)", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: signedTx(tx)});
    for (const problem of ["429 Too Many Requests from https://rpc.example.test", "The finalized transaction message differs from the approved plan"]) {
      verifyThrows = problem;
      const loaded = await service.getLiveLaunchIntent(creator, first.intent.id);
      expect(loaded).toMatchObject({status: "token_pending", chainCheck: {state: "unchecked", kind: "token"}});
      expect(loaded.chainCheck!.reason).not.toContain("rpc.example");
    }
    verifyThrows = null;
    expect((await service.getLiveLaunchIntent(creator, first.intent.id)).chainCheck).toBeUndefined();
  });
  test("saved signed bytes are sent again while pending, and an expired coin is reported and prepared again (REL-3)", async () => {
    const original = await input(), first = await service.prepareLiveLaunch(creator, {...original, withCard: true}), tx = first.transaction!, card = first.card!;
    await service.holdLiveCard(creator, {intentId: first.intent.id, messageSha256: card.messageSha256, transactionBase64: signedTx(card)});
    uncertain = true;
    const submitted = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: signedTx(tx)});
    expect(submitted.submission).toBe("unknown");
    // The first broadcast is kept alive past a closed tab.
    expect(keptAlive).toBe(1);
    const pending = await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: submitted.signature, messageSha256: tx.messageSha256});
    expect(pending).toMatchObject({delivery: "resent"});
    // Only the submitted coin, with its saved bound; never the card held for it.
    expect(resends).toHaveLength(1);
    expect(resends[0]).toMatchObject({transactionBase64: signedTx(tx), lastValidBlockHeight: 100, plan: {messageSha256: tx.messageSha256}});
    resendAnswer = "expired";
    const expired = await service.getLiveLaunchIntent(creator, first.intent.id);
    expect(expired).toMatchObject({status: "token_pending", chainCheck: {state: "expired-unlanded", kind: "token"}});
    expect(resends.every(request => request.transactionBase64 === signedTx(tx))).toBe(true);
    replaceable = true;
    expect((await service.prepareLiveLaunch(creator, original)).intent).toMatchObject({status: "prepared", tokenMint: mint});
  });
  test("a send the RPC refused is saved, reported plainly and sent again later", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    refusedSend = true;
    const result = await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: signedTx(tx)});
    expect(result).toMatchObject({submission: "unknown", intent: {status: "token_pending"}});
    expect(result.warning).toContain("did not accept this transaction yet"); expect(result.warning).not.toContain("rpc.example");
    await service.confirmLiveToken(creator, {intentId: first.intent.id, signature: result.signature, messageSha256: tx.messageSha256});
    expect(resends).toHaveLength(1);
  });
  test("one coin in flight per wallet: another device cannot start a second coin while one is sent (REL-5)", async () => {
    const first = await service.prepareLiveLaunch(creator, await input()), tx = first.transaction!;
    await service.submitLiveTransaction(creator, {intentId: first.intent.id, kind: "token", messageSha256: tx.messageSha256, transactionBase64: signedTx(tx)});
    const other = {...await input({tokenMint: otherWallet}), idempotencyKey: "second-device", nftMint: replacementNft}, written = storagePuts;
    await expect(service.prepareLiveLaunch(creator, other)).rejects.toThrow("Finish or discard your saved launch first");
    expect(storagePuts).toBe(written);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 1});
    tokenVerified = true;
    await service.getLiveLaunchIntent(creator, first.intent.id);
    tokenVerified = false;
    expect((await service.prepareLiveLaunch(creator, other)).intent.tokenMint).toBe(otherWallet);
  });
  test("a database failure while saving a new launch is not called a reservation, and a retry saves it (REL-10)", async () => {
    const original = await input(), batch = localD1.batch;
    let failed = false;
    localD1.batch = async (statements: Prepared[]) => { if (!failed && statements.some(statement => statement.sql.startsWith("INSERT INTO live_launch_intents"))) { failed = true; throw new Error("D1_ERROR: network connection lost"); } return batch(statements); };
    try {
      await expect(service.prepareLiveLaunch(creator, original)).rejects.toThrow("The launch could not be saved. Nothing was sent. Try again.");
      expect((await service.prepareLiveLaunch(creator, original)).intent.status).toBe("prepared");
    } finally { localD1.batch = batch; }
  });
  test("launch event logs carry stage names and reasons, never keys, addresses, hashes or URLs (REL-6)", () => {
    const lines: string[] = [], info = console.info;
    console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try { service.logLaunchEvent("refused", {intentId: "0332fd55-e84e-47ad-a448-053670043c59", kind: "token", reason: `Missing or invalid signature for ${creator} at https://rpc.example.test/key ${"ab".repeat(32)}`}); }
    finally { console.info = info; }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("live_launch_event ");
    expect(lines[0]).toContain('"event":"refused"'); expect(lines[0]).toContain("0332fd55");
    for (const secret of [creator, "rpc.example", "abab".repeat(8)]) expect(lines[0]).not.toContain(secret);
  });
});

const {TEST_CARD_MINT, cardAddress} = await import("./card-mint-fixtures");
const crypto_ = await import("../../src/lib/carddex/live/vanity-crypto");
const vanity = await import("../../src/lib/carddex/live/vanity.server");
// A throwaway test key for the pool's encryption (never a real CARDDEX_VANITY_KEY).
const rawKey = crypto_.toBase64(new Uint8Array(32).map((_, i) => i * 7 + 1));
const key = await crypto_.importVanityKey(crypto_.vanityKeyBytes(rawKey)!);
describe("pre-ground card mint addresses on the server (live_vanity_mints)", () => {
  const limits = import("../../src/lib/carddex/live/limits.server");
  const wallets = Array.from({length: 12}, (_, i) => base58Encode(ed25519.getPublicKey(new Uint8Array(32).fill(40 + i))));
  /** The one real "card" keypair (the published fixture), plus rows whose addresses are valid but whose bytes are not a key. */
  async function fill(bogus = 0) {
    const sealed = await crypto_.encryptCardMint(key, TEST_CARD_MINT.publicKey, TEST_CARD_MINT.secretKey);
    sqlite.query("INSERT INTO live_vanity_mints (public_key, secret_ciphertext, secret_iv, status, created_at) VALUES (?, ?, ?, 'available', 1)").run(TEST_CARD_MINT.publicKey, sealed.secretCiphertext, sealed.secretIv);
    for (let i = 0; i < bogus; i++) sqlite.query("INSERT INTO live_vanity_mints (public_key, secret_ciphertext, secret_iv, status, created_at) VALUES (?, ?, ?, 'available', 2)").run(cardAddress(i), sealed.secretCiphertext, sealed.secretIv);
  }
  const rows = () => sqlite.query("SELECT public_key, status, issued_to, issued_at, used_at FROM live_vanity_mints ORDER BY public_key").all() as {public_key: string; status: string; issued_to: string | null; issued_at: number | null; used_at: number | null}[];
  const captureLogs = () => {
    const lines: string[] = [], saved = {info: console.info, error: console.error, warn: console.warn, log: console.log};
    for (const level of ["info", "error", "warn", "log"] as const) console[level] = (...args: unknown[]) => { lines.push(args.map(arg => arg instanceof Error ? `${arg.name} ${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ")); };
    return {lines, restore: () => Object.assign(console, saved)};
  };
  const secretTexts = [crypto_.toBase64(TEST_CARD_MINT.secretKey), crypto_.toBase64(TEST_CARD_MINT.secretKey.slice(0, 32)), rawKey];
  const session = async (wallet: string, seed: Uint8Array) => {
    const challenge = await auth.createWalletChallenge(wallet);
    return (await auth.verifyWalletChallenge({challengeId: challenge.challengeId, wallet, signatureBase64: btoa(String.fromCharCode(...ed25519.sign(new TextEncoder().encode(challenge.message), seed)))})).token;
  };

  test("off without CARDDEX_VANITY_KEY (or with a malformed one): null, nothing issued, nothing counted", async () => {
    await fill();
    for (const value of [undefined, "", "not-a-key", crypto_.toBase64(new Uint8Array(16))]) {
      env.CARDDEX_VANITY_KEY = value;
      expect(await vanity.issueCardMint(creator, "203.0.113.5")).toBeNull();
    }
    expect(rows()[0].status).toBe("available");
    expect(sqlite.query("SELECT COUNT(*) AS n FROM rate_events WHERE scope LIKE 'live:card-mint%'").get()).toEqual({n: 0});
    expect(await vanity.vanityHealth()).toEqual({configured: false, available: 1});
  });
  test("issues one key once to the signed-in wallet, checked, with nothing secret stored or logged", async () => {
    env.CARDDEX_VANITY_KEY = rawKey; await fill();
    expect(await vanity.vanityHealth()).toEqual({configured: true, available: 1});
    const log = captureLogs();
    let issued: Awaited<ReturnType<typeof vanity.issueCardMint>>, again: typeof issued;
    try {
      // No session, a bogus one or an expired one: null, and the pool is untouched.
      expect(await vanity.issueCardMintForSession(undefined, null)).toBeNull();
      expect(await vanity.issueCardMintForSession("ab".repeat(32), null)).toBeNull();
      expect(rows()[0].status).toBe("available");
      const token = await session(creator, creatorSeed);
      issued = await vanity.issueCardMintForSession(token, "203.0.113.5");
      again = await vanity.issueCardMintForSession(token, "203.0.113.5");
    } finally { log.restore(); }
    expect(issued!.publicKey).toBe(TEST_CARD_MINT.publicKey);
    expect(crypto_.fromBase64(issued!.secretKey)).toEqual(TEST_CARD_MINT.secretKey);
    // Never re-issued, even to the same wallet: the pool is now empty.
    expect(again!).toBeNull();
    expect(rows()).toEqual([{public_key: TEST_CARD_MINT.publicKey, status: "issued", issued_to: creator, issued_at: expect.any(Number), used_at: null}]);
    expect(await vanity.vanityHealth()).toEqual({configured: true, available: 0});
    // D1 holds only ciphertext; the logs hold outcomes only.
    const stored = JSON.stringify(sqlite.query("SELECT * FROM live_vanity_mints").all()) + JSON.stringify(sqlite.query("SELECT * FROM live_settings").all()) + JSON.stringify(sqlite.query("SELECT * FROM rate_events").all());
    const logged = log.lines.join("\n");
    for (const secret of secretTexts) { expect(stored).not.toContain(secret); expect(logged).not.toContain(secret); }
    for (const value of [TEST_CARD_MINT.publicKey, creator, "203.0.113"]) expect(logged).not.toContain(value);
    expect(log.lines.filter(line => line.startsWith("live_card_mint"))).toEqual([
      'live_card_mint {"event":"skipped","reason":"session"}', 'live_card_mint {"event":"skipped","reason":"session"}',
      'live_card_mint {"event":"issued"}', 'live_card_mint {"event":"empty"}']);
  });
  test("concurrent requests never get the same key, and a row that fails its check is burned, never returned", async () => {
    env.CARDDEX_VANITY_KEY = rawKey; await fill(4);
    const log = captureLogs();
    let results: Awaited<ReturnType<typeof vanity.issueCardMint>>[];
    try { results = await Promise.all(wallets.map((wallet, i) => vanity.issueCardMint(wallet, `203.0.113.${i}`))); }
    finally { log.restore(); }
    const pool = rows();
    // Five rows, twelve requests: each row went to exactly one wallet, and seven wallets got nothing.
    expect(pool.every(row => row.status === "issued")).toBe(true);
    expect(new Set(pool.map(row => row.issued_to)).size).toBe(5);
    // Only the real keypair comes back; the four rows holding another address's ciphertext are refused (bound to their address).
    expect(results!.filter(Boolean)).toEqual([{publicKey: TEST_CARD_MINT.publicKey, secretKey: crypto_.toBase64(TEST_CARD_MINT.secretKey)}]);
    expect(log.lines.filter(line => line.includes('"reason":"decrypt"'))).toHaveLength(4);
    expect(log.lines.filter(line => line.includes('"event":"empty"'))).toHaveLength(7);
    for (const secret of secretTexts) expect(log.lines.join("\n")).not.toContain(secret);
  });
  test("limits per wallet, per address and site-wide; a limit hit is null and issues nothing", async () => {
    env.CARDDEX_VANITY_KEY = rawKey; await fill(12);
    const {LIMITS, SITE, enforceLimit} = await limits;
    expect(LIMITS.cardMintWallet).toMatchObject({max: 6, windowMs: 60_000});
    expect(LIMITS.cardMintWalletDay).toMatchObject({max: 30, windowMs: 86_400_000});
    for (let i = 0; i < 6; i++) await vanity.issueCardMint(creator, null);
    expect(await vanity.issueCardMint(creator, null)).toBeNull();
    expect(rows().filter(row => row.issued_to === creator)).toHaveLength(6);
    // Per address: many fresh wallets behind one address.
    for (let i = 0; i < LIMITS.cardMintIp.max; i++) await enforceLimit(LIMITS.cardMintIp, "198.51.100.7");
    expect(await vanity.issueCardMint(wallets[0], "198.51.100.7")).toBeNull();
    expect(rows().filter(row => row.issued_to === wallets[0])).toHaveLength(0);
    // Site-wide daily cap (the six issues above already count toward it).
    expect(sqlite.query("SELECT COUNT(*) AS n FROM rate_events WHERE scope = 'live:card-mint:site'").get()).toEqual({n: 6});
    for (let i = 6; i < LIMITS.cardMintSite.max; i++) await enforceLimit(LIMITS.cardMintSite, SITE);
    expect(await vanity.issueCardMint(wallets[1], "198.51.100.8")).toBeNull();
    expect(rows().filter(row => row.status === "available")).toHaveLength(7);
  });
  test("only while new launches are open", async () => {
    env.CARDDEX_VANITY_KEY = rawKey; await fill();
    env.CARDDEX_LIVE_LAUNCH_ENABLED = "false";
    expect(await vanity.issueCardMint(creator, null)).toBeNull();
    expect(rows()[0].status).toBe("available");
  });
  test("a database without migration 0016: null, random addresses, and health reports the missing migration", async () => {
    env.CARDDEX_VANITY_KEY = rawKey;
    sqlite.exec("DROP TABLE live_vanity_mints");
    expect(await vanity.issueCardMint(creator, null)).toBeNull();
    expect(await vanity.cardMintClaim(creator, TEST_CARD_MINT.publicKey)).toEqual([]);
    expect(await vanity.vanityHealth()).toEqual({configured: true, available: 0});
    const {missingMigrations} = await import("../../src/lib/carddex/live/limits.server");
    expect(await missingMigrations()).toEqual(["0016"]);
  });
  test("prepare refuses a pool address issued to another wallet, and marks this wallet's address used when the launch is saved", async () => {
    env.CARDDEX_VANITY_KEY = rawKey; await fill();
    const issued = (await vanity.issueCardMint(otherWallet, null))!;
    expect(issued.publicKey).toBe(TEST_CARD_MINT.publicKey);
    const request = await input({tokenMint: TEST_CARD_MINT.publicKey});
    await expect(service.prepareLiveLaunch(creator, request)).rejects.toThrow(vanity.CARD_MINT_NOT_YOURS);
    expect(prepareCalls).toBe(0); expect(tokenMediaCalls).toBe(0);
    expect(sqlite.query("SELECT COUNT(*) AS n FROM live_launch_intents").get()).toEqual({n: 0});
    // Issued to this creator: the launch is saved and the address is used in the same batch.
    sqlite.query("UPDATE live_vanity_mints SET issued_to = ? WHERE public_key = ?").run(creator, TEST_CARD_MINT.publicKey);
    const prepared = await service.prepareLiveLaunch(creator, request);
    expect(prepared.intent.tokenMint).toBe(TEST_CARD_MINT.publicKey);
    expect(rows()).toEqual([{public_key: TEST_CARD_MINT.publicKey, status: "used", issued_to: creator, issued_at: expect.any(Number), used_at: expect.any(Number)}]);
    // The saved launch prepares again with the same key (the found path), and the row stays used.
    const again = await service.prepareLiveLaunch(creator, request);
    expect(again.intent.id).toBe(prepared.intent.id);
    expect(rows()[0].status).toBe("used");
  });
  test("prepare refuses a pool address that is still available or already used; random and non-pool addresses are unchanged", async () => {
    await fill();
    await expect(service.prepareLiveLaunch(creator, await input({tokenMint: TEST_CARD_MINT.publicKey}))).rejects.toThrow(vanity.CARD_MINT_NOT_YOURS);
    sqlite.query("UPDATE live_vanity_mints SET status = 'used', issued_to = ?, issued_at = 1, used_at = 2").run(creator);
    await expect(service.prepareLiveLaunch(creator, await input({tokenMint: TEST_CARD_MINT.publicKey}))).rejects.toThrow(vanity.CARD_MINT_NOT_YOURS);
    // A "card" address the creator ground themselves (not in the pool) and a random one prepare as before.
    expect(await vanity.cardMintClaim(creator, cardAddress(9))).toEqual([]);
    expect(await vanity.cardMintClaim(creator, mint)).toEqual([]);
    const prepared = await service.prepareLiveLaunch(creator, await input());
    expect(prepared.intent.tokenMint).toBe(mint);
  });
  test("a pool address issued to this wallet is used once even when it was taken between the check and the save", async () => {
    env.CARDDEX_VANITY_KEY = rawKey; await fill();
    await vanity.issueCardMint(creator, null);
    const claim = await vanity.cardMintClaim(creator, TEST_CARD_MINT.publicKey);
    expect(claim).toHaveLength(3);
    // Something else used the row first: the batch's guard rolls the whole save back.
    sqlite.query("UPDATE live_vanity_mints SET status = 'used', used_at = 5").run();
    await expect(new Promise((resolve, reject) => localD1.batch(claim as never).then(resolve, reject))).rejects.toThrow();
    expect(rows()[0]).toMatchObject({status: "used", used_at: 5});
  });
});
