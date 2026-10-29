import * as sdk from "../../../../../integrations/pumpfun/src/live";
import type { LiveLaunchInput, WalletTransactionPlan } from "../../../../../integrations/pumpfun/src/live";
import reviewedDesigns from "../../../../../integrations/pumpfun/src/design-assets.json";
import { getCardDesign } from "../designs";
import { getPairAsset } from "../pairs";
import { clearGuard, db, guard, one, q, readBatch, stmt, UserError } from "../../mintdex/server/db.server";
import { fetchPublicBytes, putPublicAsset, putPublicJson, validateOwnedAsset, verifyPublicJson } from "./assets.server";
import { sha256, walletBytes } from "./auth.server";
import { COMPOSITION_VERSION, composeTokenAssets, requireTrustedComposition } from "./composition.server";
import { requireLiveConfig } from "./config.server";
import { normalizeLiveFields } from "./validation.server";
import type { LiveAssets, LiveLaunchIntent, LivePrepareInput, LiveStage } from "./types";

type Payload = {input: Omit<LiveLaunchInput, "nftMint">; assets: LiveAssets; fields: ReturnType<typeof normalizeLiveFields>};
type IntentRow = {id: string; creator_wallet: string; token_mint: string; nft_mint: string; quote_key: string; quote_mint: string; design_key: string; payload_sha256: string; payload_json: string; binding_sha256: string; token_metadata_uri: string; nft_metadata_uri: string; status: LiveStage; token_signature: string | null; nft_signature: string | null; token_receipt_json: string | null; nft_receipt_json: string | null; created_at: number; updated_at: number};
type PlanRow = {id: string; intent_id: string; kind: "token" | "nft"; message_sha256: string; plan_json: string; signature: string | null; signed_transaction_base64: string | null; status: "prepared" | "pending" | "confirmed"};
const connection = () => sdk.createMainnetConnection(requireLiveConfig().rpcUrl);
function adapterInput(row: IntentRow): LiveLaunchInput { return {...(JSON.parse(row.payload_json) as Payload).input, nftMint: row.nft_mint}; }
function publicIntent(row: IntentRow): LiveLaunchIntent {
  const payload = JSON.parse(row.payload_json) as Payload;
  return {id: row.id, creatorWallet: row.creator_wallet, tokenMint: row.token_mint, nftMint: row.nft_mint,
    name: payload.fields.name, symbol: payload.fields.symbol, description: payload.fields.description, website: payload.fields.website, xUrl: payload.fields.xUrl,
    quoteAssetKey: row.quote_key, quoteMint: row.quote_mint, cardTemplate: row.design_key, status: row.status,
    bindingSha256: row.binding_sha256, initialBuyQuoteBaseUnits: payload.input.initialBuyQuoteBaseUnits ?? "0",
    nftMetadataSha256: payload.input.nftMetadataSha256!,
    tokenMetadataUri: row.token_metadata_uri, nftMetadataUri: row.nft_metadata_uri, assets: payload.assets,
    tokenSignature: row.token_signature, nftSignature: row.nft_signature, createdAt: row.created_at, updatedAt: row.updated_at};
}
async function chain<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (error) { throw new UserError((error instanceof Error ? error.message : "The mainnet provider could not verify this launch.").replace(/https?:\/\/\S+/g, "[provider]").slice(0, 500)); }
}
async function ownedIntent(wallet: string, id: string): Promise<IntentRow> {
  requireLiveConfig();
  const row = await one<IntentRow>("SELECT * FROM live_launch_intents WHERE id = ? AND creator_wallet = ?", id, wallet);
  if (!row) throw new UserError("This real launch does not belong to the signed-in creator wallet.");
  return row;
}
function snapshotGuard(row: IntentRow) {
  return guard("EXISTS (SELECT 1 FROM live_launch_intents WHERE id = ? AND status = ? AND nft_mint = ? AND binding_sha256 = ? AND token_signature IS ? AND nft_signature IS ? AND token_receipt_json IS ? AND nft_receipt_json IS ?)", row.id, row.status, row.nft_mint, row.binding_sha256, row.token_signature, row.nft_signature, row.token_receipt_json, row.nft_receipt_json);
}
function planSetGuard(id: string, kind: "token" | "nft", plans: PlanRow[]) {
  return guard("COALESCE((SELECT group_concat(id, ',') FROM (SELECT id FROM live_launch_transactions WHERE intent_id = ? AND kind = ? ORDER BY id)), '') = ?", id, kind, plans.map(plan => plan.id).sort().join(","));
}
async function guardedBatch(statements: Parameters<ReturnType<typeof db>["batch"]>[0]) {
  try { return await db().batch(statements); }
  catch (error) {
    if (/constraint|CHECK/i.test(error instanceof Error ? error.message : String(error))) throw new UserError("This launch changed in another request. Recover its latest stage before continuing.");
    throw error;
  }
}
function checkPlan(row: Pick<IntentRow, "creator_wallet" | "token_mint" | "nft_mint" | "binding_sha256">, plan: WalletTransactionPlan) {
  const asset = plan.kind === "token" ? row.token_mint : row.nft_mint;
  if (plan.feePayer !== row.creator_wallet || plan.bindingSha256 !== row.binding_sha256 || plan.requiredSigners.length !== 2 || !plan.requiredSigners.includes(asset) || !plan.requiredSigners.includes(row.creator_wallet)) throw new UserError("The prepared transaction does not match this immutable creator launch.");
}
async function savePlan(row: IntentRow, plan: WalletTransactionPlan) {
  checkPlan(row, plan);
  const now = Date.now();
  if (plan.kind === "token" && row.status !== "prepared" || plan.kind === "nft" && row.status !== "nft_pending") throw new UserError("Recover the existing transaction before preparing another for this stage.");
  await guardedBatch([
    snapshotGuard(row), clearGuard(),
    stmt("INSERT OR IGNORE INTO live_launch_transactions (id, intent_id, kind, message_sha256, plan_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?)", crypto.randomUUID(), row.id, plan.kind, plan.messageSha256, JSON.stringify(plan), now, now),
  ]);
}
async function sourceAssets(wallet: string, designKey: string) {
  const design = reviewedDesigns[designKey as keyof typeof reviewedDesigns];
  if (!design) throw new UserError("This card design has no approved production asset manifest.");
  const {origin} = requireLiveConfig();
  const load = async (source: {path: string; sha256: string}) => {
    const bytes = await fetchPublicBytes(`${origin}${source.path}`);
    if (await sha256(bytes) !== source.sha256) throw new UserError("The public premium design differs from the approved frame manifest.");
    return putPublicAsset(wallet, bytes, "image/webp");
  };
  return {front: await load(design.front), back: await load(design.back)};
}
async function preparePayload(wallet: string, raw: LivePrepareInput): Promise<Payload> {
  const fields = normalizeLiveFields(raw);
  walletBytes(wallet); walletBytes(raw.nftMint);
  if (new Set([wallet, fields.tokenMint, raw.nftMint, fields.quoteMint]).size !== 4) throw new UserError("Creator, new token mint, creator NFT and quote mint must be distinct addresses.");
  if (!raw.termsAcknowledged || !/^(0|[1-9][0-9]{0,19})$/.test(raw.initialBuyQuoteBaseUnits) || BigInt(raw.initialBuyQuoteBaseUnits) > 0xffffffffffffffffn || !Number.isInteger(raw.slippageBps) || raw.slippageBps < 0 || raw.slippageBps > 1000) throw new UserError("Review the quote terms, initial-buy atoms and slippage before preparing a real launch.");
  if (raw.assets.tokenImage || raw.assets.tokenPoster) throw new UserError("Token image exports are created by this server from your verified card. Compose only the original artwork, card and case.");
  await requireTrustedComposition(wallet, fields, raw.assets);
  for (const role of ["artwork", "cardImage", "caseImage"] as const) await validateOwnedAsset(wallet, raw.assets[role], role);
  const sources = await sourceAssets(wallet, fields.cardTemplate), quote = getPairAsset(fields.quoteAssetKey), design = getCardDesign(fields.cardTemplate);
  const media = await composeTokenAssets(wallet,fields,raw.assets);
  const common = {version: 1, rendererVersion: COMPOSITION_VERSION, creatorWallet: wallet, tokenMint: fields.tokenMint, quoteAssetKey: quote.key, quoteMint: quote.mint,
    cardTemplate: fields.cardTemplate, sourceFrontSha256: sources.front.sha256, sourceBackSha256: sources.back.sha256,
    artworkSha256: raw.assets.artwork.sha256, cardImageSha256: raw.assets.cardImage.sha256, caseImageSha256: raw.assets.caseImage.sha256};
  const tokenJson = {name: fields.name, symbol: fields.symbol, description: fields.description, image: media.tokenImage.url, animation_url: media.tokenImage.url,
    ...(fields.website ? {website: fields.website} : {}), ...(fields.xUrl ? {twitter: fields.xUrl} : {}),
    properties: {files: [{uri: media.tokenImage.url, type: media.tokenImage.mimeType}, {uri: media.tokenPoster.url, type: media.tokenPoster.mimeType}], category: "image",
      launchACard: {...common,tokenImageSha256:media.tokenImage.sha256,tokenPosterSha256:media.tokenPoster.sha256,tokenImageFormat:media.format,tokenPosterFormat:media.posterFormat,tokenPoster:media.tokenPoster.url}}};
  const nftJson = {name: fields.name, symbol: fields.symbol, description: fields.description,
    image: raw.assets.caseImage.url, seller_fee_basis_points: 0,
    ...(fields.website ? {external_url: fields.website} : {}),
    attributes: [{trait_type: "Edition", value: "1 / 1"}, {trait_type: "Card design", value: design.key},
      {trait_type: "Token mint", value: fields.tokenMint}, {trait_type: "Quote asset", value: quote.symbol}, {trait_type: "Quote mint", value: quote.mint}],
    properties: {category: "image", files: [{uri: raw.assets.caseImage.url, type: raw.assets.caseImage.mimeType}, {uri: raw.assets.cardImage.url, type: raw.assets.cardImage.mimeType}],
      creators: [{address: wallet, share: 100}], launchACard: {...common, cardImage: raw.assets.cardImage.url, sourceFront: sources.front.url, sourceBack: sources.back.url,
        website: fields.website ?? null, xUrl: fields.xUrl ?? null, rights: "Creator collectible only. No royalties, revenue share, stock ownership or redemption rights."}}};
  const tokenMetadata = await putPublicJson(wallet, tokenJson), nftMetadata = await putPublicJson(wallet, nftJson);
  await verifyPublicJson(tokenMetadata, tokenJson); await verifyPublicJson(nftMetadata, nftJson);
  if (new TextEncoder().encode(tokenMetadata.url).length > 200) throw new UserError("The public metadata URI exceeds pump.fun's supported length.");
  return {fields, assets: {...raw.assets,tokenImage:media.tokenImage,tokenPoster:media.tokenPoster}, input: {creator: wallet, mint: fields.tokenMint, name: fields.name, symbol: fields.symbol,
    tokenMetadataUri: tokenMetadata.url, quoteKey: quote.key, nftName: fields.name,
    initialBuyQuoteBaseUnits: raw.initialBuyQuoteBaseUnits, slippageBps: raw.slippageBps,
    renderedCardSha256: raw.assets.cardImage.sha256, nftMetadataSha256: nftMetadata.sha256,
    card: {designKey: fields.cardTemplate, frontUri: sources.front.url, backUri: sources.back.url,
      frontSha256: sources.front.sha256, backSha256: sources.back.sha256, nftMetadataUri: nftMetadata.url}}};
}
export async function prepareLiveLaunch(wallet: string, raw: LivePrepareInput) {
  requireLiveConfig();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(raw.idempotencyKey)) throw new UserError("Use a stable launch request identifier.");
  const fields = normalizeLiveFields(raw);
  const requestedHash = await sha256(JSON.stringify({creator: wallet, fields, assets: raw.assets, initialBuyQuoteBaseUnits: raw.initialBuyQuoteBaseUnits, slippageBps: raw.slippageBps}));
  const existing = await one<IntentRow>("SELECT * FROM live_launch_intents WHERE token_mint = ? OR (creator_wallet = ? AND idempotency_key = ?)", fields.tokenMint, wallet, raw.idempotencyKey);
  if (existing) {
    if (existing.creator_wallet !== wallet || existing.payload_sha256 !== requestedHash) throw new UserError("This mint or request identifier is already bound to different launch details.");
    if (existing.status === "abandoned") throw new UserError("This unused draft was safely abandoned. Start with a fresh mint and request identifier.");
    if (existing.status === "nft_pending" || existing.status === "complete") return {intent: publicIntent(existing), transaction: null};
    if (existing.status === "token_pending") throw new UserError("A token transaction was already submitted. Recover its confirmation before preparing another launch.");
    const pending = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token' ORDER BY created_at DESC LIMIT 1", existing.id);
    if (pending?.signature) throw new UserError("A token transaction was already submitted. Recover its confirmation before preparing another launch.");
    const transaction = await chain(() => sdk.prepareTokenTransaction(adapterInput(existing), {connection: connection()}));
    await savePlan(existing, transaction); return {intent: publicIntent(existing), transaction};
  }
  const payload = await preparePayload(wallet, raw);
  const transaction = await chain(() => sdk.prepareTokenTransaction({...payload.input, nftMint: raw.nftMint}, {connection: connection()}));
  const id = crypto.randomUUID(), now = Date.now();
  try {
    await db().batch([
      stmt("INSERT INTO live_launch_intents (id, idempotency_key, creator_wallet, token_mint, nft_mint, quote_key, quote_mint, design_key, payload_sha256, payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)", id, raw.idempotencyKey, wallet, fields.tokenMint, raw.nftMint, fields.quoteAssetKey, fields.quoteMint, fields.cardTemplate, requestedHash, JSON.stringify(payload), transaction.bindingSha256, payload.input.tokenMetadataUri, payload.input.card.nftMetadataUri, now, now),
      stmt("INSERT INTO live_launch_transactions (id, intent_id, kind, message_sha256, plan_json, status, created_at, updated_at) VALUES (?, ?, 'token', ?, ?, 'prepared', ?, ?)", crypto.randomUUID(), id, transaction.messageSha256, JSON.stringify(transaction), now, now),
    ]);
  } catch (error) {
    const concurrent = await one<IntentRow>("SELECT * FROM live_launch_intents WHERE token_mint = ? AND creator_wallet = ?", fields.tokenMint, wallet);
    if (!concurrent || concurrent.payload_sha256 !== requestedHash) throw new UserError("This launch mint or request identifier is already reserved.");
    await savePlan(concurrent, transaction); return {intent: publicIntent(concurrent), transaction};
  }
  return {intent: publicIntent(await ownedIntent(wallet, id)), transaction};
}

async function confirmationPlan(row: IntentRow, kind: "token" | "nft", input: {signature: string; messageSha256?: string}): Promise<PlanRow> {
  const plan = input.messageSha256
    ? await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = ? AND message_sha256 = ?", row.id, kind, input.messageSha256)
    : await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = ? AND signature = ?", row.id, kind, input.signature);
  if (!plan || plan.signature && plan.signature !== input.signature) throw new UserError("Confirm a signature from a transaction prepared for this launch.");
  checkPlan(row, JSON.parse(plan.plan_json)); return plan;
}
function verifyReceipt(row: IntentRow, receipt: {creatorWallet: string; tokenMint: string; quoteMint: string; nftMint: string}) {
  if (receipt.creatorWallet !== row.creator_wallet || receipt.tokenMint !== row.token_mint || receipt.quoteMint !== row.quote_mint || receipt.nftMint !== row.nft_mint) throw new UserError("The chain receipt does not match this immutable launch.");
}
export async function confirmLiveToken(wallet: string, input: {intentId: string; signature: string; messageSha256?: string}) {
  const row = await ownedIntent(wallet, input.intentId), plan = await confirmationPlan(row, "token", input);
  if (["nft_pending", "complete"].includes(row.status) && row.token_signature !== input.signature) throw new UserError("This token already has a different finalized launch signature.");
  if (row.token_receipt_json && JSON.parse(row.token_receipt_json).status === "verified") return {intent: publicIntent(row), receipt: JSON.parse(row.token_receipt_json) as Awaited<ReturnType<typeof sdk.verifyTokenLaunch>>};
  const receipt = await chain(() => sdk.verifyTokenLaunch(adapterInput(row), {connection: connection(), signature: input.signature, expectedMessageSha256: plan.message_sha256}));
  verifyReceipt(row, receipt);
  if (receipt.status === "pending" && !plan.signature) return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt};
  await guardedBatch([
    snapshotGuard(row), clearGuard(),
    guard("EXISTS (SELECT 1 FROM live_launch_transactions WHERE id = ? AND (signature IS NULL OR signature = ?))", plan.id, input.signature), clearGuard(),
    stmt("UPDATE live_launch_transactions SET signature = ?, status = ?, updated_at = ? WHERE id = ?", input.signature, receipt.status === "verified" ? "confirmed" : "pending", Date.now(), plan.id),
    stmt("UPDATE live_launch_intents SET token_signature = ?, token_receipt_json = ?, status = CASE WHEN status IN ('nft_pending','complete') THEN status ELSE ? END, updated_at = ? WHERE id = ?", input.signature, JSON.stringify(receipt), receipt.status === "verified" ? "nft_pending" : "token_pending", Date.now(), row.id),
  ]);
  return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt};
}
export async function confirmLiveCreatorNft(wallet: string, input: {intentId: string; signature: string; messageSha256?: string}) {
  const row = await ownedIntent(wallet, input.intentId);
  if (row.status !== "nft_pending" && row.status !== "complete") throw new UserError("Finalize the token launch before claiming the separate creator NFT.");
  if (row.status === "complete" && row.nft_signature && row.nft_signature !== input.signature) throw new UserError("This creator NFT is already finalized under another signature.");
  if (row.nft_receipt_json && JSON.parse(row.nft_receipt_json).status === "verified") return {intent: publicIntent(row), receipt: JSON.parse(row.nft_receipt_json) as Awaited<ReturnType<typeof sdk.verifyCreatorNft>>};
  const plan = await confirmationPlan(row, "nft", input);
  const receipt = await chain(() => sdk.verifyCreatorNft(adapterInput(row), {connection: connection(), signature: input.signature, expectedMessageSha256: plan.message_sha256}));
  verifyReceipt(row, receipt);
  if (receipt.status === "pending" && !plan.signature) return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt};
  await guardedBatch([
    snapshotGuard(row), clearGuard(),
    guard("EXISTS (SELECT 1 FROM live_launch_transactions WHERE id = ? AND (signature IS NULL OR signature = ?))", plan.id, input.signature), clearGuard(),
    stmt("UPDATE live_launch_transactions SET signature = ?, status = ?, updated_at = ? WHERE id = ?", input.signature, receipt.status === "verified" ? "confirmed" : "pending", Date.now(), plan.id),
    stmt("UPDATE live_launch_intents SET nft_signature = ?, nft_receipt_json = ?, status = CASE WHEN status = 'complete' THEN status ELSE ? END, updated_at = ? WHERE id = ?", input.signature, JSON.stringify(receipt), receipt.status === "verified" ? "complete" : "nft_pending", Date.now(), row.id),
  ]);
  return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt};
}
async function completeExistingNft(row: IntentRow, receipt: Awaited<ReturnType<typeof sdk.verifyCreatorNft>>) {
  verifyReceipt(row, receipt);
  if (receipt.status !== "verified") return false;
  await guardedBatch([snapshotGuard(row), clearGuard(), stmt("UPDATE live_launch_intents SET status = 'complete', nft_receipt_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(receipt), Date.now(), row.id)]);
  return true;
}
export async function prepareLiveCreatorNft(wallet: string, input: {intentId: string; nftMint?: string}) {
  let row = await ownedIntent(wallet, input.intentId);
  if (row.status === "complete") return {intent: publicIntent(row), transaction: null};
  if (row.status !== "nft_pending" || !row.token_signature) throw new UserError("Verify the finalized token transaction before preparing its separate creator NFT.");
  const tokenPlan = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token' AND signature = ?", row.id, row.token_signature);
  if (!tokenPlan) throw new UserError("The verified token transaction plan is missing.");
  const existing = await chain(() => sdk.verifyCreatorNft(adapterInput(row), {connection: connection()}));
  if (await completeExistingNft(row, existing)) return {intent: publicIntent(await ownedIntent(wallet, row.id)), transaction: null};
  const nextMint = input.nftMint ?? row.nft_mint;
  // A same-key retry still needs to retire the previous submitted signature. Its old transaction
  // must be unable to land before a fresh blockhash/message can replace that pending stage.
  if (nextMint !== row.nft_mint || row.nft_signature !== null) {
    walletBytes(nextMint);
    const [previous] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'nft'", row.id));
    const expiry = previous.length ? Math.max(...previous.map(attempt => (JSON.parse(attempt.plan_json) as WalletTransactionPlan).lastValidBlockHeight)) : undefined;
    await chain(() => sdk.assertNftMintReplaceable(adapterInput(row), {connection: connection(), lastValidBlockHeight: expiry}));
    await guardedBatch([
      snapshotGuard(row), clearGuard(), planSetGuard(row.id, "nft", previous), clearGuard(),
      stmt("UPDATE live_launch_intents SET nft_mint = ?, nft_signature = NULL, nft_receipt_json = NULL, updated_at = ? WHERE id = ? AND nft_mint = ? AND status = 'nft_pending'", nextMint, Date.now(), row.id, row.nft_mint),
    ]);
    row = await ownedIntent(wallet, row.id);
    if (row.nft_mint !== nextMint) throw new UserError("The NFT issuance changed in another tab. Refresh this launch.");
  }
  const result = await chain(() => sdk.prepareCreatorNftTransaction(adapterInput(row), {connection: connection(), tokenSignature: row.token_signature!, tokenMessageSha256: tokenPlan.message_sha256}));
  if ("receipt" in result) { await completeExistingNft(row, result.receipt); return {intent: publicIntent(await ownedIntent(wallet, row.id)), transaction: null}; }
  await savePlan(row, result); return {intent: publicIntent(row), transaction: result};
}
export async function getLiveLaunchIntent(wallet: string, id: string) {
  let row = await ownedIntent(wallet, id);
  if (row.status === "token_pending") {
    const [plans] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token' AND signature IS NOT NULL ORDER BY created_at DESC LIMIT 20", id));
    for (const plan of plans) {
      const result = await confirmLiveToken(wallet, {intentId: id, signature: plan.signature!, messageSha256: plan.message_sha256});
      if (result.intent.status !== "token_pending") break;
    }
    row = await ownedIntent(wallet, id);
  }
  if (row.status === "nft_pending") {
    const receipt = await chain(() => sdk.verifyCreatorNft(adapterInput(row), {connection: connection()}));
    if (await completeExistingNft(row, receipt)) row = await ownedIntent(wallet, id);
  }
  return publicIntent(row);
}
export async function listLiveLaunchIntents(wallet: string) {
  requireLiveConfig();
  const [rows] = await readBatch(q<IntentRow>("SELECT * FROM live_launch_intents WHERE creator_wallet = ? ORDER BY created_at DESC LIMIT 50", wallet));
  return rows.map(publicIntent);
}
export async function abandonLiveLaunchIntent(wallet: string, input: {intentId: string}) {
  const row = await ownedIntent(wallet, input.intentId);
  if (row.status === "abandoned") return {intent: publicIntent(row)};
  if (row.status !== "prepared" && row.status !== "token_pending") throw new UserError("A finalized token launch must be resumed, not abandoned.");
  const [plans] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token'", row.id));
  const expiry = Math.max(...plans.map(plan => (JSON.parse(plan.plan_json) as WalletTransactionPlan).lastValidBlockHeight));
  await chain(() => sdk.assertTokenMintReplaceable(adapterInput(row), {connection: connection(), lastValidBlockHeight: expiry}));
  await guardedBatch([snapshotGuard(row), clearGuard(), planSetGuard(row.id, "token", plans), clearGuard(), stmt("UPDATE live_launch_intents SET status = 'abandoned', updated_at = ? WHERE id = ? AND status IN ('prepared','token_pending')", Date.now(), row.id)]);
  return {intent: publicIntent(await ownedIntent(wallet, row.id))};
}
export async function submitLiveTransaction(wallet: string, input: {intentId: string; kind: "token" | "nft"; messageSha256: string; transactionBase64: string}) {
  const row = await ownedIntent(wallet, input.intentId);
  if (input.kind === "token" && !["prepared", "token_pending"].includes(row.status) || input.kind === "nft" && row.status !== "nft_pending") throw new UserError("This launch has already advanced beyond that wallet transaction.");
  const prepared = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = ? AND message_sha256 = ?", row.id, input.kind, input.messageSha256);
  if (!prepared) throw new UserError("This transaction was not prepared for this launch.");
  const plan = JSON.parse(prepared.plan_json) as WalletTransactionPlan; checkPlan(row, plan);
  const signed = await chain(async () => sdk.validateSignedWalletTransaction(plan, input.transactionBase64));
  const submittedSignature = input.kind === "token" ? row.token_signature : row.nft_signature;
  if (submittedSignature && submittedSignature !== signed.signature) throw new UserError("A different transaction for this stage is already pending. Recover it before authorizing another.");
  if (prepared.signature && (prepared.signature !== signed.signature || prepared.signed_transaction_base64 !== signed.transactionBase64)) throw new UserError("This prepared transaction already has different submitted bytes.");
  const now = Date.now();
  // Store the deterministic signature and exact signed bytes before RPC submission. An uncertain network
  // answer can only retry those bytes or recover that signature, never spend again with a new transaction.
  await guardedBatch([
    input.kind === "token"
      ? stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_launch_intents WHERE id = ? AND (status = 'prepared' OR (status = 'token_pending' AND token_signature = ?))) THEN 1 ELSE 0 END", row.id, signed.signature)
      : stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_launch_intents WHERE id = ? AND nft_mint = ? AND binding_sha256 = ? AND status = 'nft_pending' AND (nft_signature IS NULL OR nft_signature = ?)) THEN 1 ELSE 0 END", row.id, row.nft_mint, row.binding_sha256, signed.signature),
    stmt("DELETE FROM tx_guard"),
    stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_launch_transactions WHERE id = ? AND (signature IS NULL OR (signature = ? AND signed_transaction_base64 = ?))) THEN 1 ELSE 0 END", prepared.id, signed.signature, signed.transactionBase64),
    stmt("DELETE FROM tx_guard"),
    stmt("UPDATE live_launch_transactions SET signature = ?, signed_transaction_base64 = ?, status = 'pending', updated_at = ? WHERE id = ?", signed.signature, signed.transactionBase64, now, prepared.id),
    input.kind === "token"
      ? stmt("UPDATE live_launch_intents SET token_signature = ?, status = 'token_pending', updated_at = ? WHERE id = ? AND status IN ('prepared','token_pending')", signed.signature, now, row.id)
      : stmt("UPDATE live_launch_intents SET nft_signature = ?, updated_at = ? WHERE id = ? AND status = 'nft_pending'", signed.signature, now, row.id),
  ]);
  try {
    const result = await chain(() => sdk.sendSignedWalletTransaction({plan, transactionBase64: signed.transactionBase64}, {connection: connection()}));
    if (result.signature !== signed.signature) throw new UserError("The provider returned another transaction signature.");
    return {intent: publicIntent(await ownedIntent(wallet, row.id)), signature: signed.signature,
      submission: result.status === "submission-uncertain" ? "unknown" as const : "submitted" as const,
      ...(result.status === "submission-uncertain" ? {warning: "The provider did not return a definitive submission result. Recover this saved signature before authorizing anything else."} : {})};
  } catch {
    return {intent: publicIntent(await ownedIntent(wallet, row.id)), signature: signed.signature, submission: "unknown" as const,
      warning: "The provider did not return a definitive submission result. Check this saved signature before authorizing anything else."};
  }
}
