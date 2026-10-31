import * as sdk from "../../../../../integrations/pumpfun/src/live";
import type { FeeSharePlan, LiveLaunchInput, WalletTransactionPlan } from "../../../../../integrations/pumpfun/src/live";
import { feeRecipientsProblem, sameFeeSplit } from "../../../../../integrations/pumpfun/src/fee-share-rules";
import { HOLDER_REWARDS_NO_SPLIT, createOptionsProblem, readCreateOptions, type CreateOptions } from "../../../../../integrations/pumpfun/src/create-options";
import { isWalletAddress } from "../../../components/carddex/live/transaction";
import reviewedDesigns from "../../../../../integrations/pumpfun/src/design-assets.json";
import { getCardDesign } from "../designs";
import { recordedDesignVersion } from "../design-versions";
import { NOT_OFFERED_PAIR, getPairAsset, isOfferedPair, isPairAssetKey, mainnetPairRefusal } from "../pairs";
import * as runtime from "../../bindings.server";
import { clearGuard, db, guard, one, q, readBatch, stmt, UserError } from "../../mintdex/server/db.server";
import { fetchPublicBytes, metadataShaFromUri, metadataUriPlaceholder, previewLaunchAssets, publishLaunchAssets, putPublicAsset, putPublicJson, validateOwnedAsset, verifyPublicJson } from "./assets.server";
import { sha256, walletBytes } from "./auth.server";
import { COMPOSITION_VERSION, composeTokenAssets, requireTrustedComposition } from "./composition.server";
import { BUY_DOES_NOT_FIT, STOCK_BUY_WARNS } from "./copy";
import { FEE_SHARING_OFF, liveReadiness, requireFeeSharing, requireLiveConfig } from "./config.server";
import { normalizeLiveFields, normalizeLiveIdentity, requireNewLaunchPair } from "./validation.server";
import { cardMintClaim } from "./vanity.server";
import { keepXOptin, queueXAnnouncement, xAnnounceFor, xOptinStatement } from "./x-announce.server";
import { LIVE_PACKET_LIMIT, type LiveCreateOptions, type LiveApprovedCard, type LiveAssets, type LiveChainCheck, type LiveFeeRecipient, type LiveFeeShare, type LiveFeeShareStatus, type LiveLaunchIntent, type LivePrepareRequest, type LiveStage } from "./types";

type Payload = {input: Omit<LiveLaunchInput, "nftMint">; assets: LiveAssets; fields: ReturnType<typeof normalizeLiveFields>};
type IntentRow = {id: string; creator_wallet: string; token_mint: string; nft_mint: string; quote_key: string; quote_mint: string; design_key: string; payload_sha256: string; payload_json: string; binding_sha256: string; token_metadata_uri: string; nft_metadata_uri: string; status: LiveStage; token_signature: string | null; nft_signature: string | null; token_receipt_json: string | null; nft_receipt_json: string | null; created_at: number; updated_at: number};
type PlanRow = {id: string; intent_id: string; kind: "token" | "nft"; message_sha256: string; plan_json: string; signature: string | null; signed_transaction_base64: string | null; signed_message_sha256: string | null; effective_last_valid_block_height: number | null; status: "prepared" | "pending" | "confirmed"};
/** The message a finalized transaction must carry: what was signed (within the shared wallet rule) once it is saved, else the plan. */
const landedMessageSha256 = (plan: PlanRow) => plan.signed_message_sha256 ?? plan.message_sha256;
/** The block height after which this plan's transaction, signed or not, can no longer land. */
const planExpiry = (plan: PlanRow) => Math.max((JSON.parse(plan.plan_json) as WalletTransactionPlan).lastValidBlockHeight, plan.effective_last_valid_block_height ?? 0);
const connection = () => sdk.createMainnetConnection(requireLiveConfig("recovery").rpcUrl);
/** runtime.keepAlive (waitUntil), or the promise itself where the runtime module has none. */
const kept = <T,>(promise: Promise<T>) => typeof runtime.keepAlive === "function" ? runtime.keepAlive(promise) : promise;
function adapterInput(row: IntentRow): LiveLaunchInput { return {...(JSON.parse(row.payload_json) as Payload).input, nftMint: row.nft_mint}; }
function publicIntent(row: IntentRow): LiveLaunchIntent {
  const payload = JSON.parse(row.payload_json) as Payload;
  return {id: row.id, creatorWallet: row.creator_wallet, tokenMint: row.token_mint, nftMint: row.nft_mint,
    name: payload.fields.name, symbol: payload.fields.symbol, description: payload.fields.description, website: payload.fields.website, xUrl: payload.fields.xUrl,
    quoteAssetKey: row.quote_key, quoteMint: row.quote_mint, cardTemplate: row.design_key, status: row.status,
    designVersion: recordedDesignVersion(row.design_key, payload.input?.card?.frontSha256, payload.input?.card?.backSha256),
    bindingSha256: row.binding_sha256, initialBuyQuoteBaseUnits: payload.input.initialBuyQuoteBaseUnits ?? "0",
    nftMetadataSha256: payload.input.nftMetadataSha256!,
    tokenMetadataUri: row.token_metadata_uri, nftMetadataUri: row.nft_metadata_uri, assets: payload.assets,
    tokenSignature: row.token_signature, nftSignature: row.nft_signature, createdAt: row.created_at, updatedAt: row.updated_at,
    // The create options saved with the launch, only when chosen (a regular coin reads exactly as before).
    ...(payload.input?.holderReward === true ? {holderReward: true as const} : {}),
    ...(typeof payload.input?.creatorFeeBps === "number" && payload.input.creatorFeeBps > 0 ? {creatorFeeBps: payload.input.creatorFeeBps} : {})};
}
/** A launch transaction that landed and failed on Solana: nothing it would have created exists. */
export class LaunchFailedOnChain extends UserError {
  constructor(readonly kind: "token" | "nft" | "fees") { super(kind === "token" ? COIN_FAILED : kind === "nft" ? CARD_FAILED : FEES_FAILED); }
}
const COIN_FAILED = "Your coin transaction failed on Solana, so no coin was created (only its network fee was charged). Prepare it again with the same details once it expires, or discard it.";
const CARD_FAILED = "Your card transaction failed on Solana, so no card was created (only its network fee was charged). Prepare the card again.";
const FEES_FAILED = "Your fee split transaction failed on Solana, so the split was not set (only its network fee was charged). Prepare it again, or keep 100%.";
const STILL_VALID = "Your previous transaction can still land for up to about a minute. Wait a moment, then try again.";
export const PROVIDER_UNAVAILABLE = "The Solana network provider didn't answer. Try again in a moment.";
/**
 * A transport failure from the mainnet RPC rather than a launch check: an HTTP status line or JSON-RPC body (a 403,
 * 429 or 5xx from the provider), a failed fetch, a dropped connection, a fetch timeout, or the Workers runtime's own
 * subrequest failure ("internal error; reference = …").
 */
const PROVIDER_FAILURE = /\b[1-5]\d\d [A-Z][A-Za-z ]*:|jsonrpc|fetch failed|failed to fetch|network connection lost|network ?error|internal error; reference|ECONNRE(?:SET|FUSED)|ETIMEDOUT|EAI_AGAIN|socket hang up|aborted due to timeout/i;
/**
 * Provider and SDK failures as a creator reads them: no URLs, plain words for the expiry gates, and one plain
 * sentence for a provider that did not answer (its own text goes to the log, redacted). SDK checks keep their words.
 */
export function plainChainError(error: unknown, kind: "token" | "nft" | "fees") {
  if (error instanceof Error && error.name === "TransactionFailedOnChain") return new LaunchFailedOnChain(kind);
  const message = (error instanceof Error ? error.message : "The mainnet provider could not verify this launch.").replace(/https?:\/\/\S+/g, "[provider]");
  if (/can still land/.test(message)) return new UserError(STILL_VALID);
  if (PROVIDER_FAILURE.test(message)) { logLaunchEvent("provider_unavailable", {kind, reason: message}); return new UserError(PROVIDER_UNAVAILABLE); }
  return new UserError(message.slice(0, 500));
}
async function chain<T>(fn: () => Promise<T>, kind: "token" | "nft" | "fees" = "token"): Promise<T> {
  try { return await fn(); }
  catch (error) { throw plainChainError(error, kind); }
}
/** Log text without keys, addresses, hashes or URLs. */
const redact = (text: string) => text.replace(/https?:\/\/\S+/g, "[provider]").replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, "[key]").replace(/[a-f0-9]{40,}/gi, "[hash]").slice(0, 200);
/**
 * One structured line per launch stage change and refusal (REL-6), so a failed mainnet launch can be traced after the
 * fact by its intent id (the support reference is its first 8 characters). Never addresses, keys, signatures or URLs.
 */
export function logLaunchEvent(event: string, fields: {intentId?: string; kind?: "token" | "nft" | "fees"; reason?: string} & Record<string, string | number | boolean | undefined>) {
  console.info("live_launch_event", JSON.stringify({event, ...fields, ...(fields.reason ? {reason: redact(fields.reason)} : {})}));
}
/**
 * Plan rows per launch stage before the slow lane: far above any real launch, so a loop or abuse cannot grow them
 * quickly. Past it, a stage still gets one more plan every few minutes, never none (F1): a coin that landed can always
 * get its card, and the rows stay bounded. Each stage counts its own rows; the card stage allows for the card plans
 * prepared with each coin plan (prepareCardAhead).
 */
export const MAX_PLANS_PER_STAGE = 120, PLAN_SLOW_LANE_MS = 3 * 60_000;
async function assertPlanRoom(intentId: string, kind: "token" | "nft", now = Date.now()) {
  const plans = await one<{n: number; newest: number | null}>("SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM live_launch_transactions WHERE intent_id = ? AND kind = ?", intentId, kind);
  const max = kind === "token" ? MAX_PLANS_PER_STAGE : 2 * MAX_PLANS_PER_STAGE;
  if ((plans?.n ?? 0) < max || now - (plans?.newest ?? 0) >= PLAN_SLOW_LANE_MS) return;
  throw new UserError(kind === "token" ? "This launch was prepared many times in a row. Wait a few minutes, then prepare it again."
    : "This card was prepared many times in a row. Wait a few minutes, then prepare it again. Your coin is not affected.");
}
async function ownedIntent(wallet: string, id: string): Promise<IntentRow> {
  requireLiveConfig("recovery");
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
/** Serialized bytes of a prepared or signed launch transaction (base64 only, so no RPC or parsing is needed). */
function wireBytes(transactionBase64: string) {
  const padding = transactionBase64.endsWith("==") ? 2 : transactionBase64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(transactionBase64.length * 3 / 4) - padding);
}
/**
 * One server log line per launch transaction: stage, size and headroom under Solana's packet limit. Ids and hashes
 * only: no keys, signatures or wallet addresses. Prepare already refuses anything over the limit.
 */
function logTransactionSize(event: "prepared" | "signed", intentId: string, kind: "token" | "nft" | "fees", messageSha256: string, transactionBase64: string, extra: Record<string, string> = {}) {
  const bytes = wireBytes(transactionBase64);
  console.info(`Live launch transaction ${event}`, JSON.stringify({intentId, kind, messageSha256, bytes, limit: LIVE_PACKET_LIMIT, headroom: LIVE_PACKET_LIMIT - bytes, ...extra}));
}
const insertPlan = (intentId: string, plan: WalletTransactionPlan, now: number) =>
  stmt("INSERT OR IGNORE INTO live_launch_transactions (id, intent_id, kind, message_sha256, plan_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?)", crypto.randomUUID(), intentId, plan.kind, plan.messageSha256, JSON.stringify(plan), now, now);
/** Saves a stage's plan; `card` is a card plan prepared with a coin plan (prepareCardAhead), saved in the same batch. */
async function savePlan(row: IntentRow, plan: WalletTransactionPlan, card: WalletTransactionPlan | null = null) {
  checkPlan(row, plan); if (card) checkPlan(row, card);
  const now = Date.now();
  if (plan.kind === "token" && row.status !== "prepared" || plan.kind === "nft" && row.status !== "nft_pending" || card && (card.kind !== "nft" || plan.kind !== "token")) throw new UserError("Recover the existing transaction before preparing another for this stage.");
  await guardedBatch([snapshotGuard(row), clearGuard(), insertPlan(row.id, plan, now), ...(card ? [insertPlan(row.id, card, now)] : [])]);
  logTransactionSize("prepared", row.id, plan.kind, plan.messageSha256, plan.transactionBase64);
  if (card) logTransactionSize("prepared", row.id, "nft", card.messageSha256, card.transactionBase64, {ahead: "coin"});
}
/**
 * The card plan prepared with the coin's, for a wallet that approves both in one prompt (readiness.walletBatch). Core
 * reads no token account, so it is built before the coin exists; it is relayed only once the coin is verified
 * (submitLiveTransaction requires nft_pending). Null whenever it cannot be prepared now: the card then follows the
 * coin with its own prompt, and nothing here can stop the coin.
 */
async function prepareCardAhead(input: LiveLaunchInput): Promise<WalletTransactionPlan | null> {
  try {
    const result = await sdk.prepareCreatorNftAheadOfCoin(input, {connection: connection()});
    return result.status === "already-created" ? null : result;
  } catch (error) {
    console.info("Live launch card not prepared with its coin", JSON.stringify({reason: (error instanceof Error ? error.message : "unknown").replace(/https?:\/\/\S+/g, "[provider]").slice(0, 200)}));
    return null;
  }
}
/** Solana refuses a transaction that leaves its fee payer holding 1 to 890,879 lamports (rent for a 0-byte account). */
const RENT_EXEMPT_MINIMUM = 890_880n;
/**
 * The card goes in the coin's prompt only if the wallet holds enough SOL for both and still keeps the coin's reserve,
 * never less than the rent minimum (WW-3): the card is simulated before the coin exists, against the whole balance, so
 * a pair that left less would pass its own checks and then fail once the coin had landed.
 */
function cardFits(coin: WalletTransactionPlan, card: WalletTransactionPlan | null) {
  if (!card) return null;
  const reserve = BigInt(coin.review.reserveBufferLamports), keep = reserve > RENT_EXEMPT_MINIMUM ? reserve : RENT_EXEMPT_MINIMUM;
  const fits = BigInt(coin.review.walletBalanceLamports) >= BigInt(coin.review.totalDebitLamports) + BigInt(card.review.totalDebitLamports) + keep;
  if (!fits) console.info("Live launch card not prepared with its coin", JSON.stringify({reason: "balance"}));
  return fits ? card : null;
}
async function sourceAssets(wallet: string, designKey: string) {
  const design = reviewedDesigns[designKey as keyof typeof reviewedDesigns];
  if (!design) throw new UserError("This card design has no approved production asset manifest.");
  const {origin} = requireLiveConfig("launch");
  const load = async (source: {path: string; sha256: string}) => {
    const bytes = await fetchPublicBytes(`${origin}${source.path}`);
    if (await sha256(bytes) !== source.sha256) throw new UserError("The public premium design differs from the approved frame manifest.");
    return putPublicAsset(wallet, bytes, "image/webp");
  };
  return {front: await load(design.front), back: await load(design.back)};
}
async function preparePayload(wallet: string, raw: LivePrepareRequest, createOptions: CreateOptions = {}): Promise<Payload> {
  const fields = normalizeLiveFields(raw);
  walletBytes(wallet); walletBytes(raw.nftMint);
  if (new Set([wallet, fields.tokenMint, raw.nftMint, fields.quoteMint]).size !== 4) throw new UserError("Creator, new token mint, creator NFT and quote mint must be distinct addresses.");
  if (!raw.termsAcknowledged || !/^(0|[1-9][0-9]{0,19})$/.test(raw.initialBuyQuoteBaseUnits) || BigInt(raw.initialBuyQuoteBaseUnits) > 0xffffffffffffffffn || !Number.isInteger(raw.slippageBps) || raw.slippageBps < 0 || raw.slippageBps > 1000) throw new UserError("Review the quote terms, initial-buy atoms and slippage before preparing a real launch.");
  if (raw.assets.tokenImage || raw.assets.tokenPoster) throw new UserError("Token image exports are created by this server from your verified card. Compose only the original artwork, card and case.");
  await requireTrustedComposition(wallet, fields, raw.assets);
  for (const role of ["artwork", "cardImage", "caseImage"] as const) await validateOwnedAsset(wallet, raw.assets[role], role);
  // After the composition and asset reads, before the first write (the design copies and metadata). Prepare still
  // re-checks the final bytes.
  if (BigInt(raw.initialBuyQuoteBaseUnits) > 0n) {
    const size = await checkLiveLaunchSize(wallet, {...fields, initialBuyQuoteBaseUnits: raw.initialBuyQuoteBaseUnits});
    if (!size.fits) throw new UserError(size.buyBlocked ? STOCK_BUY_WARNS : BUY_DOES_NOT_FIT);
  }
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
      frontSha256: sources.front.sha256, backSha256: sources.back.sha256, nftMetadataUri: nftMetadata.url},
    // Last, and only when chosen: the coin's create options (they change its create_v2 bytes and its binding).
    ...createOptions}};
}
/**
 * The create options a launch request carries (create-options.ts), checked against its pair, or {} for a regular coin.
 * A holder-rewards coin can never also share its creator fees (pump-fees refuses: its creator is pump.fun's holder
 * rewards account), so a request with both is refused before anything is made.
 */
function requestedCreateOptions(raw: LivePrepareRequest, fields: {quoteAssetKey: string}, feeShares: readonly LiveFeeRecipient[] | null): CreateOptions {
  let options: CreateOptions;
  try { options = readCreateOptions(raw); } catch (error) { throw new UserError(error instanceof Error ? error.message : "Choose who receives the creator fees."); }
  const problem = createOptionsProblem(options, {admission: isPairAssetKey(fields.quoteAssetKey) ? getPairAsset(fields.quoteAssetKey).admission : ""});
  if (problem) throw new UserError(problem);
  if (options.holderReward && feeShares) throw new UserError(HOLDER_REWARDS_NO_SPLIT);
  return options;
}
/** The options as the launch request hash adds them: nothing for a regular coin, so saved launches keep their hash. */
const hashedOptions = (options: CreateOptions) => ({...(options.holderReward ? {holderReward: true} : {}), ...(options.creatorFeeBps ? {creatorFeeBps: options.creatorFeeBps} : {})});
const OPTIONS_TTL_MS = 60_000;
let optionsCache: {at: number; value: LiveCreateOptions} | null = null;
const OPTIONS_OFF: LiveCreateOptions = {holderRewards: false, creatorFeeRate: null};
/**
 * What pump.fun allows for the create options right now, for Launch's form: one read of pump.fun's Global, kept for a
 * minute per Worker isolate. Off (nothing offered) while launches are off or when Global can't be read. Prepare reads
 * Global again and refuses an option it no longer allows.
 */
export async function liveCreateOptions(now = Date.now()): Promise<LiveCreateOptions> {
  if (!liveReadiness().ready) return OPTIONS_OFF;
  if (optionsCache && now - optionsCache.at < OPTIONS_TTL_MS) return optionsCache.value;
  try {
    const global = await sdk.readCreateOptionsGlobal({connection: connection()});
    const value: LiveCreateOptions = {holderRewards: global.holderRewards,
      creatorFeeRate: global.creatorFeeConfigurable && global.maxCreatorFeeBps > 0 ? {maxBps: Math.min(300, global.maxCreatorFeeBps)} : null};
    optionsCache = {at: now, value};
    return value;
  } catch (error) {
    logLaunchEvent("create_options_unavailable", {reason: error instanceof Error ? error.message : "unknown"});
    return OPTIONS_OFF;
  }
}
/** Test hook: forget the cached Global answer. */
export function resetLiveCreateOptions() { optionsCache = null; }
/**
 * Exact coin-transaction size for this creator, name, symbol and quote, before any artwork or metadata is uploaded.
 * `limit` is the wallet size target (Solana's packet limit less room for wallet assertions). `buyBlocked` is set when
 * prepare refuses this quote's first buy for another reason ("issuer-controls": a tokenized-stock quote).
 */
export async function checkLiveLaunchSize(wallet: string, raw: {name: string; symbol: string; quoteAssetKey: string; initialBuyQuoteBaseUnits: string}) {
  requireLiveConfig("launch"); walletBytes(wallet);
  const {name, symbol} = normalizeLiveIdentity(raw);
  // Offered pairs only (new launches are the only callers): AAVE and UNI, or a held pair, are answered as at Launch.
  if (!isOfferedPair(raw.quoteAssetKey)) throw new UserError(isPairAssetKey(raw.quoteAssetKey) ? NOT_OFFERED_PAIR : "Choose a supported pump.fun quote asset.");
  const held = mainnetPairRefusal(raw.quoteAssetKey);
  if (held) throw new UserError(held);
  if (!/^(0|[1-9][0-9]{0,19})$/.test(raw.initialBuyQuoteBaseUnits)) throw new UserError("Review the initial-buy atoms before preparing a real launch.");
  const size = await chain(() => sdk.measureTokenTransaction({creator: wallet, name, symbol, quoteKey: raw.quoteAssetKey as LiveLaunchInput["quoteKey"], tokenMetadataUri: metadataUriPlaceholder()}, {connection: connection()}));
  const buy = BigInt(raw.initialBuyQuoteBaseUnits) > 0n, bytes = buy ? size.buyBytes : size.createBytes;
  const buyFits = size.buyBytes <= size.limit && !size.buyBlocked, createFits = size.createBytes <= size.limit;
  return {limit: size.limit, bytes, fits: buy ? buyFits : createFits, buyBytes: size.buyBytes, buyFits, createBytes: size.createBytes, createFits, buyBlocked: size.buyBlocked ?? null};
}
/**
 * Every launch asset the coin and card metadata reference: the three images, the coin's turning GIF and its still (a
 * launch prepared before the GIF has neither), both design copies and both metadata files.
 */
function launchAssetShas(payload: Payload) {
  return [payload.assets?.artwork?.sha256, payload.assets?.cardImage?.sha256, payload.assets?.caseImage?.sha256,
    payload.assets?.tokenImage?.sha256, payload.assets?.tokenPoster?.sha256,
    payload.input?.card?.frontSha256, payload.input?.card?.backSha256, payload.input?.nftMetadataSha256,
    metadataShaFromUri(payload.input?.tokenMetadataUri ?? "")].filter((sha): sha is string => typeof sha === "string");
}
/**
 * A coin whose submitted transactions can no longer land and never created it (it failed on Solana, or it expired
 * unlanded) goes back to "prepared" with the same mint and details, so the creator signs once more without
 * recomposing. The proof is the abandon gate: finalized block height past every saved bound, and no mint at that bank
 * or newer. Old plan rows and their bytes stay as they were; only the intent's pending signature is cleared.
 */
async function retireUnlandedCoin(wallet: string, row: IntentRow): Promise<IntentRow> {
  const [plans] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token'", row.id));
  const expiry = Math.max(...plans.map(planExpiry));
  try { await chain(() => sdk.assertTokenMintReplaceable(adapterInput(row), {connection: connection(), lastValidBlockHeight: expiry})); }
  catch (error) {
    if (error instanceof UserError && /already exists/.test(error.message)) throw new UserError("A token transaction was already submitted. Recover its confirmation before preparing another launch.");
    throw error;
  }
  await guardedBatch([snapshotGuard(row), clearGuard(), planSetGuard(row.id, "token", plans), clearGuard(),
    stmt("UPDATE live_launch_intents SET status = 'prepared', token_signature = NULL, token_receipt_json = NULL, updated_at = ? WHERE id = ? AND status = 'token_pending'", Date.now(), row.id)]);
  logLaunchEvent("coin_retired", {intentId: row.id, kind: "token", plans: plans.length});
  return ownedIntent(wallet, row.id);
}
export async function prepareLiveLaunch(wallet: string, raw: LivePrepareRequest) {
  requireLiveConfig("launch");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(raw.idempotencyKey)) throw new UserError("Use a stable launch request identifier.");
  const fields = normalizeLiveFields(raw);
  // The creator fee split, when chosen: checked before anything is made, saved beside the launch (never in its identity).
  const feeShares = requestedFeeShares(raw, fields);
  const feesOpen = liveReadiness().feeSharing === true;
  // "Announce my coin on @launchacard": saved beside the launch while announcements are on (ignored while off).
  const announce = raw.announceOnX === true && liveReadiness().xAnnounce === true;
  // Holder rewards and a custom creator fee rate: part of the launch's identity (they change its create bytes).
  const createOptions = requestedCreateOptions(raw, fields, feeShares);
  const requestedHash = await sha256(JSON.stringify({creator: wallet, fields, assets: raw.assets, initialBuyQuoteBaseUnits: raw.initialBuyQuoteBaseUnits, slippageBps: raw.slippageBps, ...hashedOptions(createOptions)}));
  const found = await one<IntentRow>("SELECT * FROM live_launch_intents WHERE token_mint = ? OR (creator_wallet = ? AND idempotency_key = ?)", fields.tokenMint, wallet, raw.idempotencyKey);
  if (found) {
    if (found.creator_wallet !== wallet || found.payload_sha256 !== requestedHash) throw new UserError("This mint or request identifier is already bound to different launch details.");
    if (found.status === "abandoned") throw new UserError("This unused draft was safely abandoned. Start with a fresh mint and request identifier.");
    if (found.status === "nft_pending" || found.status === "complete") return {intent: await withFeeShare(publicIntent(found)), transaction: null, card: null};
    // A saved launch can always be prepared again: with the switch off its split is only checked against the saved one
    // (never saved now), and a saved split stays "requested" until sharing opens again.
    if (feeShares) await keepFeeShares(found, feeShares, feesOpen);
    if (announce) await keepXOptin(found.id);
    // A submitted coin that failed on Solana or expired without landing is prepared again with the same mint, once
    // nothing it signed can still land (retireUnlandedCoin). The mint is fixed, so this can never make a second coin.
    const existing = found.status === "token_pending" ? await retireUnlandedCoin(wallet, found) : found;
    if (existing.token_signature) throw new UserError("A token transaction was already submitted. Recover its confirmation before preparing another launch.");
    await assertPlanRoom(existing.id, "token");
    const [transaction, ahead] = await Promise.all([chain(() => sdk.prepareTokenTransaction(adapterInput(existing), {connection: connection()})), raw.withCard ? prepareCardAhead(adapterInput(existing)) : null]);
    const card = cardFits(transaction, ahead);
    await savePlan(existing, transaction, card); return {intent: await withFeeShare(publicIntent(existing)), transaction, card};
  }
  // A new launch from here on (a saved one returned above, whatever design and pair it was saved with): the pair picks
  // the card, and a design that is not the pair's own is refused before any artwork, metadata or plan is made.
  requireNewLaunchPair(fields);
  if (feeShares && !feesOpen) throw new UserError(FEE_SHARING_OFF);
  // One coin in flight per wallet (REL-5): another device or a cleared browser must recover the submitted coin first.
  const inFlight = await one<{id: string}>("SELECT id FROM live_launch_intents WHERE creator_wallet = ? AND status = 'token_pending' LIMIT 1", wallet);
  if (inFlight) throw new UserError("Finish or discard your saved launch first: its coin transaction was already sent. Find it under Saved launches.");
  // A pre-ground "card" address must have been issued to this wallet (vanity.server.ts); it is marked used in the batch
  // that saves this launch. A random address needs nothing.
  const cardMint = await cardMintClaim(wallet, fields.tokenMint);
  // A recipient that is a program or holds data is refused now, while nothing is uploaded (the live read is repeated
  // when the split is prepared).
  if (feeShares) await chain(() => sdk.checkFeeRecipientAccounts(feeShares, {connection: connection()}));
  // A chosen create option pump.fun no longer allows is refused now, before anything is uploaded (prepare checks again).
  if (createOptions.holderReward || createOptions.creatorFeeBps) {
    const global = await chain(() => sdk.readCreateOptionsGlobal({connection: connection()}));
    const problem = createOptionsProblem(createOptions, {admission: getPairAsset(fields.quoteAssetKey).admission, global});
    if (problem) throw new UserError(problem);
  }
  const payload = await preparePayload(wallet, raw, createOptions);
  // With withCard, the card plan is prepared alongside (prepareCardAhead) and saved in the same batch as the coin's.
  const [transaction, ahead] = await Promise.all([chain(() => sdk.prepareTokenTransaction({...payload.input, nftMint: raw.nftMint}, {connection: connection()})),
    raw.withCard ? prepareCardAhead({...payload.input, nftMint: raw.nftMint}) : null]);
  const card = cardFits(transaction, ahead);
  const id = crypto.randomUUID(), now = Date.now();
  try {
    await db().batch([
      ...cardMint,
      stmt("INSERT INTO live_launch_intents (id, idempotency_key, creator_wallet, token_mint, nft_mint, quote_key, quote_mint, design_key, payload_sha256, payload_json, binding_sha256, token_metadata_uri, nft_metadata_uri, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)", id, raw.idempotencyKey, wallet, fields.tokenMint, raw.nftMint, fields.quoteAssetKey, fields.quoteMint, fields.cardTemplate, requestedHash, JSON.stringify(payload), transaction.bindingSha256, payload.input.tokenMetadataUri, payload.input.card.nftMetadataUri, now, now),
      stmt("INSERT INTO live_launch_transactions (id, intent_id, kind, message_sha256, plan_json, status, created_at, updated_at) VALUES (?, ?, 'token', ?, ?, 'prepared', ?, ?)", crypto.randomUUID(), id, transaction.messageSha256, JSON.stringify(transaction), now, now),
      ...(card ? [insertPlan(id, card, now)] : []),
      ...(feeShares ? [insertFeeShares(id, feeShares, await sha256(feeSharesJson(feeShares)), now)] : []),
      ...(announce ? [xOptinStatement(id, now)] : []),
      // From here the coin and card metadata URIs are fixed. What they point to is public for the approval window, so
      // the wallet prompt can show it, and permanently once the signed coin is saved (submitLiveTransaction).
      previewLaunchAssets(launchAssetShas(payload), now),
    ]);
  } catch (error) {
    // Only a uniqueness conflict means another request reserved this mint or request id; anything else saved nothing.
    if (!/constraint|unique/i.test(error instanceof Error ? error.message : String(error))) {
      console.error("Live launch could not be saved", error);
      throw new UserError("The launch could not be saved. Nothing was sent. Try again.");
    }
    const concurrent = await one<IntentRow>("SELECT * FROM live_launch_intents WHERE token_mint = ? AND creator_wallet = ?", fields.tokenMint, wallet);
    if (!concurrent || concurrent.payload_sha256 !== requestedHash) throw new UserError("This launch mint or request identifier is already reserved.");
    if (feeShares) await keepFeeShares(concurrent, feeShares, feesOpen);
    if (announce) await keepXOptin(concurrent.id);
    await savePlan(concurrent, transaction, card); return {intent: await withFeeShare(publicIntent(concurrent)), transaction, card};
  }
  logTransactionSize("prepared", id, "token", transaction.messageSha256, transaction.transactionBase64);
  if (card) logTransactionSize("prepared", id, "nft", card.messageSha256, card.transactionBase64, {ahead: "coin"});
  if (feeShares) logLaunchEvent("fee_split_saved", {intentId: id, kind: "fees", recipients: feeShares.length});
  return {intent: await withFeeShare(publicIntent(await ownedIntent(wallet, id))), transaction, card};
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
type Delivery = Awaited<ReturnType<typeof sdk.resendSignedWalletTransaction>>["status"];
/**
 * Saved signed bytes whose confirmation is still pending are sent again while they can land (REL-3): a dropped send,
 * a provider error or a closed tab no longer leaves a launch to expire. Only submitted bytes (a saved signature), never
 * a card held for its coin. The answer feeds the saved launch's chain check; null when it could not be checked.
 */
async function resendPending(row: IntentRow, plan: PlanRow): Promise<Delivery | null> {
  if (!plan.signature || !plan.signed_transaction_base64) return null;
  try {
    const result = await sdk.resendSignedWalletTransaction({plan: JSON.parse(plan.plan_json) as WalletTransactionPlan, transactionBase64: plan.signed_transaction_base64, lastValidBlockHeight: planExpiry(plan)}, {connection: connection()});
    if (result.status !== "landed") logLaunchEvent(result.status === "expired" ? "expired_unlanded" : result.status, {intentId: row.id, kind: plan.kind,
      ...(result.status === "resent" ? {blocksLeft: result.blocksLeft} : {}), ...(result.status === "not-resent" ? {reason: result.reason} : {})});
    return result.status;
  } catch (error) {
    logLaunchEvent("resend_unchecked", {intentId: row.id, kind: plan.kind, reason: error instanceof Error ? error.message : "unknown"});
    return null;
  }
}
export async function confirmLiveToken(wallet: string, input: {intentId: string; signature: string; messageSha256?: string}) {
  const row = await ownedIntent(wallet, input.intentId), plan = await confirmationPlan(row, "token", input);
  if (["nft_pending", "complete"].includes(row.status) && row.token_signature !== input.signature) throw new UserError("This token already has a different finalized launch signature.");
  if (row.token_receipt_json && JSON.parse(row.token_receipt_json).status === "verified") return {intent: publicIntent(row), receipt: JSON.parse(row.token_receipt_json) as Awaited<ReturnType<typeof sdk.verifyTokenLaunch>>};
  let receipt: Awaited<ReturnType<typeof sdk.verifyTokenLaunch>>;
  try { receipt = await chain(() => sdk.verifyTokenLaunch(adapterInput(row), {connection: connection(), signature: input.signature, expectedMessageSha256: landedMessageSha256(plan)})); }
  catch (error) { if (error instanceof LaunchFailedOnChain) logLaunchEvent("landed_failed", {intentId: row.id, kind: "token"}); throw error; }
  verifyReceipt(row, receipt);
  // A pending receipt is recorded only for the launch's current submitted bytes: never for a plan that was not sent,
  // nor for one a retired coin left behind (proven unable to land), so an old signature never replaces the current one.
  if (receipt.status === "pending" && (!plan.signature || row.status === "prepared" || row.token_signature !== input.signature)) return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt};
  await guardedBatch([
    snapshotGuard(row), clearGuard(),
    guard("EXISTS (SELECT 1 FROM live_launch_transactions WHERE id = ? AND (signature IS NULL OR signature = ?))", plan.id, input.signature), clearGuard(),
    stmt("UPDATE live_launch_transactions SET signature = ?, status = ?, updated_at = ? WHERE id = ?", input.signature, receipt.status === "verified" ? "confirmed" : "pending", Date.now(), plan.id),
    stmt("UPDATE live_launch_intents SET token_signature = ?, token_receipt_json = ?, status = CASE WHEN status IN ('nft_pending','complete') THEN status ELSE ? END, updated_at = ? WHERE id = ?", input.signature, JSON.stringify(receipt), receipt.status === "verified" ? "nft_pending" : "token_pending", Date.now(), row.id),
    // Idempotent: a coin recorded from the chain keeps its metadata public, however its bytes reached Solana.
    publishLaunchAssets(launchAssetShas(JSON.parse(row.payload_json) as Payload), Date.now()),
  ]);
  if (receipt.status === "verified") logLaunchEvent("verified", {intentId: row.id, kind: "token"});
  const delivery = receipt.status === "pending" ? await resendPending(row, plan) : null;
  return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt, ...(delivery ? {delivery} : {})};
}
export async function confirmLiveCreatorNft(wallet: string, input: {intentId: string; signature: string; messageSha256?: string}) {
  const row = await ownedIntent(wallet, input.intentId);
  if (row.status !== "nft_pending" && row.status !== "complete") throw new UserError("Finalize the token launch before claiming the separate creator NFT.");
  if (row.status === "complete" && row.nft_signature && row.nft_signature !== input.signature) throw new UserError("This creator NFT is already finalized under another signature.");
  if (row.nft_receipt_json && JSON.parse(row.nft_receipt_json).status === "verified") return {intent: publicIntent(row), receipt: JSON.parse(row.nft_receipt_json) as Awaited<ReturnType<typeof sdk.verifyCreatorNft>>};
  const plan = await confirmationPlan(row, "nft", input);
  let receipt: Awaited<ReturnType<typeof sdk.verifyCreatorNft>>;
  try { receipt = await chain(() => sdk.verifyCreatorNft(adapterInput(row), {connection: connection(), signature: input.signature, expectedMessageSha256: landedMessageSha256(plan)}), "nft"); }
  catch (error) { if (error instanceof LaunchFailedOnChain) logLaunchEvent("landed_failed", {intentId: row.id, kind: "nft"}); throw error; }
  verifyReceipt(row, receipt);
  if (receipt.status === "pending" && !plan.signature) return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt};
  await guardedBatch([
    snapshotGuard(row), clearGuard(),
    guard("EXISTS (SELECT 1 FROM live_launch_transactions WHERE id = ? AND (signature IS NULL OR signature = ?))", plan.id, input.signature), clearGuard(),
    stmt("UPDATE live_launch_transactions SET signature = ?, status = ?, updated_at = ? WHERE id = ?", input.signature, receipt.status === "verified" ? "confirmed" : "pending", Date.now(), plan.id),
    stmt("UPDATE live_launch_intents SET nft_signature = ?, nft_receipt_json = ?, status = CASE WHEN status = 'complete' THEN status ELSE ? END, updated_at = ? WHERE id = ?", input.signature, JSON.stringify(receipt), receipt.status === "verified" ? "complete" : "nft_pending", Date.now(), row.id),
  ]);
  if (receipt.status === "verified") { logLaunchEvent("verified", {intentId: row.id, kind: "nft"}); await queueXAnnouncement(row.id); }
  const delivery = receipt.status === "pending" ? await resendPending(row, plan) : null;
  return {intent: publicIntent(await ownedIntent(wallet, row.id)), receipt, ...(delivery ? {delivery} : {})};
}
async function completeExistingNft(row: IntentRow, receipt: Awaited<ReturnType<typeof sdk.verifyCreatorNft>>) {
  verifyReceipt(row, receipt);
  if (receipt.status !== "verified") return false;
  await guardedBatch([snapshotGuard(row), clearGuard(), stmt("UPDATE live_launch_intents SET status = 'complete', nft_receipt_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(receipt), Date.now(), row.id)]);
  // The creator's @launchacard announcement, when they asked for one (never throws).
  await queueXAnnouncement(row.id);
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
    const keyChanged = nextMint !== row.nft_mint;
    walletBytes(nextMint);
    const [previous] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'nft'", row.id));
    // Signed bytes with a wallet-refreshed blockhash can outlive their plan: wait past whichever ends later.
    const expiry = previous.length ? Math.max(...previous.map(planExpiry)) : undefined;
    await chain(() => sdk.assertNftMintReplaceable(adapterInput(row), {connection: connection(), lastValidBlockHeight: expiry}));
    await guardedBatch([
      snapshotGuard(row), clearGuard(), planSetGuard(row.id, "nft", previous), clearGuard(),
      stmt("UPDATE live_launch_intents SET nft_mint = ?, nft_signature = NULL, nft_receipt_json = NULL, updated_at = ? WHERE id = ? AND nft_mint = ? AND status = 'nft_pending'", nextMint, Date.now(), row.id, row.nft_mint),
    ]);
    row = await ownedIntent(wallet, row.id);
    if (row.nft_mint !== nextMint) throw new UserError("The NFT issuance changed in another tab. Refresh this launch.");
    logLaunchEvent("nft_rotated", {intentId: row.id, kind: "nft", keyChanged});
  }
  await assertPlanRoom(row.id, "nft");
  const result = await chain(() => sdk.prepareCreatorNftTransaction(adapterInput(row), {connection: connection(), tokenSignature: row.token_signature!, tokenMessageSha256: landedMessageSha256(tokenPlan)}));
  if ("receipt" in result) { await completeExistingNft(row, result.receipt); return {intent: publicIntent(await ownedIntent(wallet, row.id)), transaction: null}; }
  await savePlan(row, result); return {intent: publicIntent(row), transaction: result};
}
/**
 * The card the wallet approved with its coin, while it is still the one to send: the newest card plan for the current
 * card address holds saved signed bytes that were never submitted. A newer card plan (prepared on its own after an
 * expiry or a refusal) replaces it.
 */
async function approvedCard(row: IntentRow): Promise<LiveApprovedCard | null> {
  if (row.nft_signature) return null;
  const newest = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'nft' ORDER BY created_at DESC, rowid DESC LIMIT 1", row.id);
  if (!newest || newest.signature || !newest.signed_transaction_base64) return null;
  if (!(JSON.parse(newest.plan_json) as WalletTransactionPlan).requiredSigners.includes(row.nft_mint)) return null;
  return {messageSha256: newest.message_sha256, transactionBase64: newest.signed_transaction_base64, nftMint: row.nft_mint};
}
const COIN_EXPIRED = "Your coin transaction expired before it landed, so no coin was created and nothing was charged. Prepare it again with the same details, or discard it.";
const CARD_EXPIRED = "Your card transaction expired before it landed, so nothing was charged for the card. Prepare the card again.";
/** A chain check that could not finish, as the saved launch reports it: the launch itself is unchanged. */
function uncheckedLaunch(error: unknown, kind: "token" | "nft", intentId: string): LiveChainCheck {
  if (error instanceof LaunchFailedOnChain) return {state: "failed-on-chain", kind, reason: error.message};
  logLaunchEvent("check_unavailable", {intentId, kind, reason: error instanceof Error ? error.message : "unknown"});
  const what = kind === "token" ? "this coin" : "this card";
  return {state: "unchecked", kind, reason: `Solana could not confirm ${what} right now. Your saved launch is unchanged; check again in a moment.`};
}
/**
 * A saved launch, after checking the chain for its pending stage (and sending saved bytes again while they can land).
 * It never throws for a chain or verification problem (REL-1): the stored launch is returned with `chainCheck`, so the
 * page can always show it, discard it or prepare it again. Only a missing launch, another wallet's launch or paused
 * recovery throws.
 */
export async function getLiveLaunchIntent(wallet: string, id: string): Promise<LiveLaunchIntent> {
  let row = await ownedIntent(wallet, id);
  let chainCheck: LiveChainCheck | undefined;
  if (row.status === "token_pending") {
    const [signed] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token' AND signature IS NOT NULL ORDER BY created_at DESC LIMIT 20", id));
    // The current submission (a retired coin's older signatures can no longer land).
    const current = signed.filter(plan => plan.signature === row.token_signature), plans = current.length ? current : signed;
    try {
      const deliveries: (Delivery | null)[] = [];
      for (const plan of plans) {
        const result = await confirmLiveToken(wallet, {intentId: id, signature: plan.signature!, messageSha256: plan.message_sha256});
        deliveries.push("delivery" in result ? result.delivery ?? null : null);
        if (result.intent.status !== "token_pending") break;
      }
      if (plans.length && deliveries.length === plans.length && deliveries.every(delivery => delivery === "expired")) chainCheck = {state: "expired-unlanded", kind: "token", reason: COIN_EXPIRED};
    } catch (error) { chainCheck = uncheckedLaunch(error, "token", id); }
    row = await ownedIntent(wallet, id);
  }
  if (row.status === "nft_pending" && row.nft_signature) {
    // The submitted card, by its signature: verified, or sent again while it can still land.
    try {
      const result = await confirmLiveCreatorNft(wallet, {intentId: id, signature: row.nft_signature});
      if ("delivery" in result && result.delivery === "expired") chainCheck = {state: "expired-unlanded", kind: "nft", reason: CARD_EXPIRED};
    } catch (error) { chainCheck = uncheckedLaunch(error, "nft", id); }
    row = await ownedIntent(wallet, id);
  }
  if (row.status === "nft_pending" && chainCheck?.state !== "failed-on-chain") {
    // Any card the creator's wallet holds completes the launch by its account alone, whatever happened to a signature.
    try {
      const receipt = await chain(() => sdk.verifyCreatorNft(adapterInput(row), {connection: connection()}), "nft");
      if (await completeExistingNft(row, receipt)) chainCheck = undefined;
    } catch (error) { chainCheck ??= uncheckedLaunch(error, "nft", id); }
    row = await ownedIntent(wallet, id);
  }
  // A sent creator fee split is checked like a pending coin or card (and sent again while it can land). Its problems
  // never stop the launch from loading: the split keeps its saved status.
  if (row.status === "complete") {
    const fee = await feeShareRow(id);
    if (fee?.status === "pending" && fee.signature) {
      try { await confirmLiveFeeShare(wallet, {intentId: id, signature: fee.signature}); }
      catch (error) { logLaunchEvent("check_unavailable", {intentId: id, kind: "fees", reason: error instanceof Error ? error.message : "unknown"}); }
    }
  }
  // A resumed page (a closed tab) reads the approved card here and sends it once the coin is verified. A finished or
  // abandoned launch has none to send, so it reads exactly as listed.
  return withFeeShare({...publicIntent(row), ...(["prepared", "token_pending", "nft_pending"].includes(row.status) ? {approvedCard: await approvedCard(row)} : {}),
    ...(chainCheck ? {chainCheck} : {})});
}
export async function listLiveLaunchIntents(wallet: string) {
  requireLiveConfig("recovery");
  const [rows] = await readBatch(q<IntentRow>("SELECT * FROM live_launch_intents WHERE creator_wallet = ? ORDER BY created_at DESC LIMIT 50", wallet));
  const fees = await withoutFeeSchema(async () => (await readBatch(q<FeeShareRow>("SELECT f.* FROM live_fee_shares f JOIN live_launch_intents i ON i.id = f.intent_id WHERE i.creator_wallet = ?", wallet)))[0], [] as FeeShareRow[]);
  const feeShares = new Map(fees.map(fee => [fee.intent_id, publicFeeShare(fee)]));
  const announcements = await xAnnounceFor(rows.map(row => row.id));
  return rows.map(row => {
    const intent = publicIntent(row), feeShare = feeShares.get(row.id), xAnnounce = announcements.get(row.id);
    return {...intent, ...(feeShare ? {feeShare} : {}), ...(xAnnounce ? {xAnnounce} : {})};
  });
}
export async function abandonLiveLaunchIntent(wallet: string, input: {intentId: string}) {
  const row = await ownedIntent(wallet, input.intentId);
  if (row.status === "abandoned") return {intent: publicIntent(row)};
  if (row.status !== "prepared" && row.status !== "token_pending") throw new UserError("A finalized token launch must be resumed, not abandoned.");
  const [plans] = await readBatch(q<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'token'", row.id));
  const expiry = Math.max(...plans.map(planExpiry));
  await chain(() => sdk.assertTokenMintReplaceable(adapterInput(row), {connection: connection(), lastValidBlockHeight: expiry}));
  await guardedBatch([snapshotGuard(row), clearGuard(), planSetGuard(row.id, "token", plans), clearGuard(), stmt("UPDATE live_launch_intents SET status = 'abandoned', updated_at = ? WHERE id = ? AND status IN ('prepared','token_pending')", Date.now(), row.id)]);
  logLaunchEvent("abandoned", {intentId: row.id, kind: "token", from: row.status});
  return {intent: publicIntent(await ownedIntent(wallet, row.id))};
}
/**
 * Not sent, and never sendable as signed (expired, rejected by the signed simulation, or not the reviewed message).
 * `expired`: the wallet approval's blockhash ran out, so the page prepares a fresh transaction and asks once more.
 */
export class UnsendableTransaction extends UserError {
  constructor(message: string, readonly expired = false) { super(message); }
}
/** What the client sees of a failed live operation: only a UserError's message, and whether the stage is prepared again. */
export function liveFailure(error: unknown) {
  return {ok: false as const, error: error instanceof UserError ? error.message : "The launch paused. Nothing was sent unless your saved launch says so.",
    ...(error instanceof UnsendableTransaction ? {unsendable: true as const, ...(error.expired ? {expired: true as const} : {})} : {})};
}
// A refusal before any broadcast. With nothing saved, an unsendable stage is prepared again and any other refusal
// keeps the same signed bytes for another send. A re-send of saved bytes says only that this retry was not sent.
function notSent(saved: boolean, unsaved: string, retry: string, unsendable = true, expired = false) {
  if (saved) return new UserError(`This retry was not sent because ${retry}. Check this launch's saved transaction before preparing another.`);
  return unsendable ? new UnsendableTransaction(`${unsaved} Prepare again for a fresh transaction.`, expired) : new UserError(`${unsaved} Send again to retry with the same wallet approval.`);
}
async function checkBeforeSend(plan: WalletTransactionPlan | FeeSharePlan, transactionBase64: string, saved: boolean) {
  try { return await sdk.checkSignedWalletTransaction({plan, transactionBase64}, {connection: connection()}); }
  catch (error) {
    if (!(error instanceof sdk.SignedTransactionNotSent)) throw notSent(saved, "The final mainnet check could not finish, so this transaction was not sent yet.", "the final mainnet check could not finish", false);
    if (error.reason === "expired") throw notSent(saved, "Your wallet approval expired before it could be sent. Nothing was sent or charged.", "its wallet approval expired", true, true);
    const detail = error.message.replace(/^Signed transaction simulation failed: /, "").slice(0, 200);
    throw notSent(saved, `Solana's final check rejected this transaction, so it was not sent and nothing was charged (${detail}).`, `Solana's final check rejected it (${detail})`);
  }
}
/** Wallet name and signing order, for the log line only: they change no check. */
type SigningContext = {walletName?: string; signingOrder?: "wallet-first" | "page-first"};
export async function submitLiveTransaction(wallet: string, input: {intentId: string; kind: "token" | "nft"; messageSha256: string; transactionBase64: string} & SigningContext) {
  const row = await ownedIntent(wallet, input.intentId);
  // A card approved with its coin waits for the coin's finalized verification: never relayed before it.
  if (input.kind === "nft" && ["prepared", "token_pending"].includes(row.status)) throw new UserError("The card is sent once its coin is verified on Solana. Check the coin's confirmation first.");
  if (input.kind === "token" && !["prepared", "token_pending"].includes(row.status) || input.kind === "nft" && row.status !== "nft_pending") throw new UserError("This launch has already advanced beyond that wallet transaction.");
  const prepared = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = ? AND message_sha256 = ?", row.id, input.kind, input.messageSha256);
  if (!prepared) throw new UserError("This transaction was not prepared for this launch.");
  const plan = JSON.parse(prepared.plan_json) as WalletTransactionPlan; checkPlan(row, plan);
  const submittedSignature = input.kind === "token" ? row.token_signature : row.nft_signature;
  let signed: ReturnType<typeof sdk.validateSignedWalletTransaction>;
  try { signed = sdk.validateSignedWalletTransaction(plan, input.transactionBase64); }
  catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "invalid signature";
    throw notSent(!!submittedSignature, `The signed transaction differs from the one you reviewed, so it was not sent (${detail}).`, `it differs from the transaction you reviewed (${detail})`);
  }
  if (submittedSignature && submittedSignature !== signed.signature) throw new UserError("A different transaction for this stage is already pending. Recover it before authorizing another.");
  if (prepared.signature && (prepared.signature !== signed.signature || prepared.signed_transaction_base64 !== signed.transactionBase64)) throw new UserError("This prepared transaction already has different submitted bytes.");
  // A card approved with its coin was saved before it was sent (holdLiveCard): only those exact bytes go for its plan.
  if (!prepared.signature && prepared.signed_transaction_base64 && prepared.signed_transaction_base64 !== signed.transactionBase64) throw new UserError("This card was already approved with other signed bytes. Send those, or prepare the card again.");
  logTransactionSize("signed", row.id, input.kind, plan.messageSha256, signed.transactionBase64, {...(input.walletName ? {wallet: input.walletName} : {}), ...(input.signingOrder ? {order: input.signingOrder} : {}),
    ...(signed.signedMessageSha256 !== plan.messageSha256 ? {signedMessageSha256: signed.signedMessageSha256, walletGuards: String(signed.walletGuards), blockhash: signed.blockhashChanged ? "refreshed" : "plan"} : {})});
  // Read-only checks run before anything is saved. A definite failure (expired approval, failed signed simulation)
  // leaves this stage as it was, so the creator can prepare it again with the same keys.
  const checked = await checkBeforeSend(plan, signed.transactionBase64, !!submittedSignature);
  // Only broadcasting a 'prepared' coin starts it. A coin the chain already has is recorded under recovery, so
  // turning off new launches never leaves a landed coin unrecorded.
  if (input.kind === "token" && row.status === "prepared" && checked.status === "ready") requireLiveConfig("launch");
  const now = Date.now();
  // Store the deterministic signature and exact signed bytes immediately before broadcast (or once the chain already
  // has them). An uncertain network answer can only retry those bytes or recover that signature, never spend again.
  await guardedBatch([
    input.kind === "token"
      ? stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_launch_intents WHERE id = ? AND (status = 'prepared' OR (status = 'token_pending' AND token_signature = ?))) THEN 1 ELSE 0 END", row.id, signed.signature)
      : stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_launch_intents WHERE id = ? AND nft_mint = ? AND binding_sha256 = ? AND status = 'nft_pending' AND (nft_signature IS NULL OR nft_signature = ?)) THEN 1 ELSE 0 END", row.id, row.nft_mint, row.binding_sha256, signed.signature),
    stmt("DELETE FROM tx_guard"),
    stmt("INSERT INTO tx_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM live_launch_transactions WHERE id = ? AND (signature IS NULL OR (signature = ? AND signed_transaction_base64 = ?))) THEN 1 ELSE 0 END", prepared.id, signed.signature, signed.transactionBase64),
    stmt("DELETE FROM tx_guard"),
    // The signed message hash and the height after which these bytes can no longer land are saved with them: every
    // finalization check expects that hash, and abandon and card replacement wait past that height.
    stmt("UPDATE live_launch_transactions SET signature = ?, signed_transaction_base64 = ?, signed_message_sha256 = ?, effective_last_valid_block_height = COALESCE(effective_last_valid_block_height, ?), status = 'pending', updated_at = ? WHERE id = ?", signed.signature, signed.transactionBase64, checked.signedMessageSha256, checked.lastValidBlockHeight, now, prepared.id),
    input.kind === "token"
      ? stmt("UPDATE live_launch_intents SET token_signature = ?, status = 'token_pending', updated_at = ? WHERE id = ? AND status IN ('prepared','token_pending')", signed.signature, now, row.id)
      : stmt("UPDATE live_launch_intents SET nft_signature = ?, updated_at = ? WHERE id = ? AND status = 'nft_pending'", signed.signature, now, row.id),
    // The coin's metadata URI is on its way to the chain: everything the coin and card metadata reference is public from
    // here on, before the broadcast, for wallets, pump.fun and explorers.
    publishLaunchAssets(launchAssetShas(JSON.parse(row.payload_json) as Payload), now),
  ]);
  try {
    if (checked.status === "landed") { logLaunchEvent("landed_before_send", {intentId: row.id, kind: input.kind}); return {intent: publicIntent(await ownedIntent(wallet, row.id)), signature: signed.signature, submission: "submitted" as const}; }
    // Kept alive past a closed tab (waitUntil): the bytes are saved above, and this send must not be cancelled.
    const result = await kept(sdk.broadcastSignedWalletTransaction({plan, transactionBase64: signed.transactionBase64}, {connection: connection()}));
    if (result.signature !== signed.signature) throw new UserError("The provider returned another transaction signature.");
    logLaunchEvent(result.status === "submitted" ? "sent" : result.status === "refused" ? "send_refused" : "send_uncertain", {intentId: row.id, kind: input.kind,
      ...(result.status !== "submitted" ? {reason: result.reason} : {}), ...(input.walletName ? {wallet: input.walletName} : {})});
    // Refused or uncertain: the saved bytes are sent again by every confirmation check while they can still land.
    return {intent: publicIntent(await ownedIntent(wallet, row.id)), signature: signed.signature,
      submission: result.status === "submitted" ? "submitted" as const : "unknown" as const,
      ...(result.status === "refused" ? {warning: `Solana's RPC did not accept this transaction yet (${redact(result.reason)}). It is saved and is sent again while it can still land.`}
        : result.status === "submission-uncertain" ? {warning: "The provider did not return a definitive submission result. The saved transaction is checked and sent again while it can still land."} : {})};
  } catch {
    return {intent: publicIntent(await ownedIntent(wallet, row.id)), signature: signed.signature, submission: "unknown" as const,
      warning: "The provider did not return a definitive submission result. The saved transaction is checked and sent again while it can still land."};
  }
}
/**
 * Saves the card the wallet approved together with its coin, before the coin is sent, so a closed tab can still send
 * it once the coin is verified. The bytes must pass the same check as any send (the shared wallet rule against the
 * card's plan, both signatures valid) and keep the plan's blockhash, so they stop landing at the plan's own expiry,
 * which card replacement already waits past. Nothing is sent here: submitLiveTransaction relays these exact bytes
 * only at the nft_pending stage.
 */
export async function holdLiveCard(wallet: string, input: {intentId: string; messageSha256: string; transactionBase64: string} & SigningContext) {
  const row = await ownedIntent(wallet, input.intentId);
  if (!["prepared", "token_pending", "nft_pending"].includes(row.status) || row.nft_signature) throw new UserError("This card can no longer be saved ahead of its coin. Check the saved launch.");
  const prepared = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = 'nft' AND message_sha256 = ?", row.id, input.messageSha256);
  if (!prepared) throw new UserError("This card transaction was not prepared for this launch.");
  const plan = JSON.parse(prepared.plan_json) as WalletTransactionPlan; checkPlan(row, plan);
  let signed: ReturnType<typeof sdk.validateSignedWalletTransaction>;
  try { signed = sdk.validateSignedWalletTransaction(plan, input.transactionBase64); }
  catch (error) { throw new UserError(`The approved card differs from the one you reviewed, so it was not saved (${error instanceof Error ? error.message.slice(0, 200) : "invalid signature"}).`); }
  // A refreshed blockhash needs an RPC read to bound when the bytes stop landing; that card is approved again later.
  if (signed.blockhashChanged) throw new UserError("Your wallet refreshed the card's blockhash, so the card is approved on its own after the coin.");
  if (prepared.signature || prepared.signed_transaction_base64 && prepared.signed_transaction_base64 !== signed.transactionBase64) throw new UserError("This card transaction already has other approved bytes.");
  await guardedBatch([
    guard("EXISTS (SELECT 1 FROM live_launch_intents WHERE id = ? AND nft_mint = ? AND binding_sha256 = ? AND nft_signature IS NULL AND status IN ('prepared','token_pending','nft_pending'))", row.id, row.nft_mint, row.binding_sha256), clearGuard(),
    stmt("UPDATE live_launch_transactions SET signed_transaction_base64 = ?, signed_message_sha256 = ?, effective_last_valid_block_height = ?, updated_at = ? WHERE id = ? AND signature IS NULL", signed.transactionBase64, signed.signedMessageSha256, plan.lastValidBlockHeight, Date.now(), prepared.id),
  ]);
  logTransactionSize("signed", row.id, "nft", plan.messageSha256, signed.transactionBase64, {held: "until the coin is verified",
    ...(input.walletName ? {wallet: input.walletName} : {}), ...(input.signingOrder ? {order: input.signingOrder} : {})});
  return {held: true as const, lastValidBlockHeight: plan.lastValidBlockHeight};
}
/**
 * A wallet returned a different message from the reviewed plan, so the page refused to co-sign it. Logs what changed
 * (sizes, blockhash, compute budget, programs added) so the mainnet test can show whether wallets add guard
 * instructions. Nothing is saved, signed or sent; the returned bytes cannot land without the page's signature.
 */
export async function reportLiveWalletChange(wallet: string, input: {intentId: string; kind: "token" | "nft"; messageSha256: string; walletName: string; transactionBase64: string}) {
  const row = await ownedIntent(wallet, input.intentId);
  const prepared = await one<PlanRow>("SELECT * FROM live_launch_transactions WHERE intent_id = ? AND kind = ? AND message_sha256 = ?", row.id, input.kind, input.messageSha256);
  if (!prepared) throw new UserError("This transaction was not prepared for this launch.");
  const plan = JSON.parse(prepared.plan_json) as WalletTransactionPlan; checkPlan(row, plan);
  console.warn("Live wallet changed the prepared transaction", JSON.stringify({intentId: row.id, kind: input.kind, messageSha256: input.messageSha256, wallet: input.walletName, ...sdk.describeWalletChange(plan, input.transactionBase64)}));
  return {};
}


// ---------------------------------------------------------------- the creator fee split (optional, after the card)

type FeeShareRow = {intent_id: string; recipients_json: string; recipients_sha256: string; status: LiveFeeShareStatus; signature: string | null; receipt_json: string | null; error: string | null; created_at: number; updated_at: number};
type FeePlanRow = {id: string; intent_id: string; message_sha256: string; plan_json: string; signature: string | null; signed_transaction_base64: string | null; signed_message_sha256: string | null; effective_last_valid_block_height: number | null; status: "prepared" | "pending" | "confirmed"};
/** A split that can never change from here: verified, locked with other recipients on pump.fun, or declined. */
const FEE_SPLIT_FINAL: readonly LiveFeeShareStatus[] = ["complete", "set_elsewhere", "skipped"];
/** Program ids and system accounts are never fee recipients (keypair addresses, so the wallet check alone passes them). */
const NOT_RECIPIENTS = ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d", "11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111"];
const FEE_EXPIRED = "Your fee split transaction expired before it landed, so the split was not set and nothing was charged. Prepare it again, or keep 100%.";
const FEE_STILL_PENDING = "Your fee split transaction was sent. Check its confirmation before preparing another.";
/**
 * The fee split a launch request carries, checked as the page checks it (fee-share-rules.ts), or null when none was
 * chosen. A new launch with one is refused while the switch is off (prepareLiveLaunch), so nothing is saved that could
 * not be set. Launch a Card adds nothing to it.
 */
function requestedFeeShares(raw: LivePrepareRequest, fields: {tokenMint: string; quoteMint: string}): LiveFeeRecipient[] | null {
  if (!raw.feeShares?.length) return null;
  const shares = raw.feeShares.map(entry => ({address: entry.address, bps: entry.bps}));
  const problem = feeRecipientsProblem(shares, {isWallet: isWalletAddress, forbidden: [fields.tokenMint, raw.nftMint, fields.quoteMint, ...NOT_RECIPIENTS]});
  if (problem) throw new UserError(problem);
  return shares;
}
const feeSharesJson = (shares: readonly LiveFeeRecipient[]) => JSON.stringify(shares.map(entry => ({address: entry.address, bps: entry.bps})));
const insertFeeShares = (intentId: string, shares: readonly LiveFeeRecipient[], sha: string, now: number) =>
  stmt("INSERT OR IGNORE INTO live_fee_shares (intent_id, recipients_json, recipients_sha256, status, created_at, updated_at) VALUES (?, ?, ?, 'requested', ?, ?)", intentId, feeSharesJson(shares), sha, now, now);
/**
 * A saved launch prepared again with a split: the same split is kept, a different one is refused (it is frozen once
 * saved), and one chosen before the coin was sent is saved now (only while sharing is open; `open` false saves nothing).
 */
async function keepFeeShares(row: IntentRow, shares: readonly LiveFeeRecipient[], open: boolean) {
  const saved = await feeShareRow(row.id);
  if (saved) {
    if (!sameFeeSplit(JSON.parse(saved.recipients_json), shares)) throw new UserError("This launch's creator fee split is already saved with other wallets or shares. It can't be changed.");
    return;
  }
  if (!open) return;
  if (row.status !== "prepared" && row.status !== "token_pending") throw new UserError("A creator fee split can only be chosen before the coin is created.");
  await db().batch([insertFeeShares(row.id, shares, await sha256(feeSharesJson(shares)), Date.now())]);
}
/**
 * A database without migration 0017 (a deploy that skipped it; health reports it) reads as no fee splits, so saved
 * launches still load. Writes are never guarded this way: they fail and say so.
 */
async function withoutFeeSchema<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try { return await read(); }
  catch (error) { if (/no such table/i.test(error instanceof Error ? error.message : String(error))) return fallback; throw error; }
}
const feeShareRow = (intentId: string) => withoutFeeSchema(() => one<FeeShareRow>("SELECT * FROM live_fee_shares WHERE intent_id = ?", intentId), null);
function publicFeeShare(row: FeeShareRow): LiveFeeShare {
  const receipt = row.receipt_json ? JSON.parse(row.receipt_json) as {shareholders?: LiveFeeRecipient[]} : null;
  return {status: row.status, recipients: JSON.parse(row.recipients_json), signature: row.signature, error: row.error,
    ...(row.status === "set_elsewhere" && receipt?.shareholders ? {onChain: receipt.shareholders} : {})};
}
/**
 * The launch with its fee split and its @launchacard announcement, each when one was chosen (absent otherwise, so
 * launches without them read exactly as before).
 */
async function withFeeShare(intent: LiveLaunchIntent): Promise<LiveLaunchIntent> {
  const [row, announce] = await Promise.all([feeShareRow(intent.id), xAnnounceFor([intent.id])]);
  const xAnnounce = announce.get(intent.id);
  return {...intent, ...(row ? {feeShare: publicFeeShare(row)} : {}), ...(xAnnounce ? {xAnnounce} : {})};
}
async function ownedFeeShare(wallet: string, intentId: string) {
  const row = await ownedIntent(wallet, intentId);
  if ((JSON.parse(row.payload_json) as Payload).input?.holderReward === true) throw new UserError(HOLDER_REWARDS_NO_SPLIT);
  const fee = await one<FeeShareRow>("SELECT * FROM live_fee_shares WHERE intent_id = ?", row.id);
  if (!fee) throw new UserError("This launch has no creator fee split to set.");
  return {row, fee, recipients: JSON.parse(fee.recipients_json) as LiveFeeRecipient[]};
}
const feeIntent = async (wallet: string, id: string) => withFeeShare(publicIntent(await ownedIntent(wallet, id)));
/** The fee row exactly as read: a batch that finds it changed (another tab) refuses (guardedBatch). */
const feeGuard = (fee: FeeShareRow) => guard("EXISTS (SELECT 1 FROM live_fee_shares WHERE intent_id = ? AND status = ? AND signature IS ? AND updated_at = ?)", fee.intent_id, fee.status, fee.signature, fee.updated_at);
/** Records a split read from the chain: "complete" when it is this one, "set_elsewhere" when pump.fun holds another. */
async function settleFeeShare(fee: FeeShareRow, recipients: LiveFeeRecipient[], shareholders: LiveFeeRecipient[], receipt: object, signature: string | null = null) {
  const matches = sameFeeSplit(shareholders, recipients);
  await guardedBatch([feeGuard(fee), clearGuard(),
    stmt("UPDATE live_fee_shares SET status = ?, signature = COALESCE(?, signature), receipt_json = ?, error = NULL, updated_at = ? WHERE intent_id = ?",
      matches ? "complete" : "set_elsewhere", signature, JSON.stringify({...receipt, shareholders}), Date.now(), fee.intent_id)]);
  logLaunchEvent(matches ? "verified" : "fee_split_set_elsewhere", {intentId: fee.intent_id, kind: "fees"});
}
async function assertFeePlanRoom(intentId: string, now = Date.now()) {
  const plans = await one<{n: number; newest: number | null}>("SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM live_fee_share_transactions WHERE intent_id = ?", intentId);
  if ((plans?.n ?? 0) < MAX_PLANS_PER_STAGE || now - (plans?.newest ?? 0) >= PLAN_SLOW_LANE_MS) return;
  throw new UserError("This fee split was prepared many times in a row. Wait a few minutes, then prepare it again. Your coin and card are not affected.");
}
function checkFeePlan(row: IntentRow, recipients: LiveFeeRecipient[], plan: FeeSharePlan) {
  try { sdk.verifyFeeSharePlan(plan, adapterInput(row), recipients); }
  catch (error) { throw new UserError(`The prepared fee split does not match this launch (${error instanceof Error ? error.message.slice(0, 200) : "invalid"}).`); }
}
/**
 * Prepares the creator-only fee split for a finished launch (status complete) and returns its plan, or settles it
 * with no transaction when the coin's split is already locked (this split: complete; another: set_elsewhere). A split
 * that was sent is checked first and never prepared over while it can still land.
 */
export async function prepareLiveFeeShare(wallet: string, input: {intentId: string}) {
  requireFeeSharing();
  let {row, fee, recipients} = await ownedFeeShare(wallet, input.intentId);
  if (row.status !== "complete") throw new UserError("Your creator fee split is set after your coin and card are confirmed.");
  if (FEE_SPLIT_FINAL.includes(fee.status)) return {intent: await feeIntent(wallet, row.id), transaction: null};
  if (fee.status === "pending" && fee.signature) {
    const checked = await confirmLiveFeeShare(wallet, {intentId: row.id, signature: fee.signature});
    if (checked.intent.feeShare?.status !== "failed") {
      if (checked.intent.feeShare?.status === "pending") throw new UserError(FEE_STILL_PENDING);
      return {intent: checked.intent, transaction: null};
    }
    ({row, fee, recipients} = await ownedFeeShare(wallet, row.id));
  }
  await assertFeePlanRoom(row.id);
  const result = await chain(() => sdk.prepareFeeShareTransaction(adapterInput(row), recipients, {connection: connection()}), "fees");
  if ("status" in result && result.status === "already-set") {
    await settleFeeShare(fee, recipients, result.shareholders, {status: "already-set"});
    return {intent: await feeIntent(wallet, row.id), transaction: null};
  }
  const plan = result as FeeSharePlan;
  checkFeePlan(row, recipients, plan);
  const now = Date.now();
  await guardedBatch([feeGuard(fee), clearGuard(),
    stmt("INSERT INTO live_fee_share_transactions (id, intent_id, message_sha256, plan_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'prepared', ?, ?)", crypto.randomUUID(), row.id, plan.messageSha256, JSON.stringify(plan), now, now),
    stmt("UPDATE live_fee_shares SET status = 'prepared', signature = NULL, error = NULL, updated_at = ? WHERE intent_id = ? AND status IN ('requested','prepared','failed')", now, row.id)]);
  logTransactionSize("prepared", row.id, "fees", plan.messageSha256, plan.transactionBase64);
  return {intent: await feeIntent(wallet, row.id), transaction: plan};
}
/**
 * Relays the creator's signed fee split: the stored plan is checked again (pre-relay), the signed bytes must be that
 * plan within the shared wallet rule and carry the creator's valid signature, the read-only pre-send checks run, and the
 * signature and exact bytes are saved before the broadcast, as for the coin and card.
 */
export async function submitLiveFeeShare(wallet: string, input: {intentId: string; messageSha256: string; transactionBase64: string} & SigningContext) {
  requireFeeSharing();
  const {row, fee, recipients} = await ownedFeeShare(wallet, input.intentId);
  if (row.status !== "complete" || !["prepared", "pending"].includes(fee.status)) throw new UserError("This fee split has already advanced beyond that wallet transaction.");
  const prepared = await one<FeePlanRow>("SELECT * FROM live_fee_share_transactions WHERE intent_id = ? AND message_sha256 = ?", row.id, input.messageSha256);
  if (!prepared) throw new UserError("This fee split transaction was not prepared for this launch.");
  const plan = JSON.parse(prepared.plan_json) as FeeSharePlan; checkFeePlan(row, recipients, plan);
  let signed: ReturnType<typeof sdk.validateSignedWalletTransaction>;
  try { signed = sdk.validateSignedWalletTransaction(plan, input.transactionBase64); }
  catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "invalid signature";
    throw notSent(!!fee.signature, `The signed fee split differs from the one you reviewed, so it was not sent (${detail}).`, `it differs from the fee split you reviewed (${detail})`);
  }
  if (fee.signature && fee.signature !== signed.signature) throw new UserError("A different fee split transaction is already pending. Check it before authorizing another.");
  if (prepared.signature && (prepared.signature !== signed.signature || prepared.signed_transaction_base64 !== signed.transactionBase64)) throw new UserError("This prepared fee split already has different submitted bytes.");
  logTransactionSize("signed", row.id, "fees", plan.messageSha256, signed.transactionBase64, {...(input.walletName ? {wallet: input.walletName} : {}),
    ...(signed.signedMessageSha256 !== plan.messageSha256 ? {signedMessageSha256: signed.signedMessageSha256, walletGuards: String(signed.walletGuards), blockhash: signed.blockhashChanged ? "refreshed" : "plan"} : {})});
  const checked = await checkBeforeSend(plan, signed.transactionBase64, !!fee.signature);
  const now = Date.now();
  await guardedBatch([
    guard("EXISTS (SELECT 1 FROM live_fee_shares WHERE intent_id = ? AND (status = 'prepared' OR (status = 'pending' AND signature = ?)))", row.id, signed.signature), clearGuard(),
    guard("EXISTS (SELECT 1 FROM live_fee_share_transactions WHERE id = ? AND (signature IS NULL OR (signature = ? AND signed_transaction_base64 = ?)))", prepared.id, signed.signature, signed.transactionBase64), clearGuard(),
    stmt("UPDATE live_fee_share_transactions SET signature = ?, signed_transaction_base64 = ?, signed_message_sha256 = ?, effective_last_valid_block_height = COALESCE(effective_last_valid_block_height, ?), status = 'pending', updated_at = ? WHERE id = ?", signed.signature, signed.transactionBase64, checked.signedMessageSha256, checked.lastValidBlockHeight, now, prepared.id),
    stmt("UPDATE live_fee_shares SET status = 'pending', signature = ?, error = NULL, updated_at = ? WHERE intent_id = ? AND status IN ('prepared','pending')", signed.signature, now, row.id),
  ]);
  try {
    if (checked.status === "landed") { logLaunchEvent("landed_before_send", {intentId: row.id, kind: "fees"}); return {intent: await feeIntent(wallet, row.id), signature: signed.signature, submission: "submitted" as const}; }
    const result = await kept(sdk.broadcastSignedWalletTransaction({plan, transactionBase64: signed.transactionBase64}, {connection: connection()}));
    if (result.signature !== signed.signature) throw new UserError("The provider returned another transaction signature.");
    logLaunchEvent(result.status === "submitted" ? "sent" : result.status === "refused" ? "send_refused" : "send_uncertain", {intentId: row.id, kind: "fees",
      ...(result.status !== "submitted" ? {reason: result.reason} : {}), ...(input.walletName ? {wallet: input.walletName} : {})});
    return {intent: await feeIntent(wallet, row.id), signature: signed.signature, submission: result.status === "submitted" ? "submitted" as const : "unknown" as const,
      ...(result.status !== "submitted" ? {warning: "The provider did not confirm the send yet. The saved fee split is checked and sent again while it can still land."} : {})};
  } catch {
    return {intent: await feeIntent(wallet, row.id), signature: signed.signature, submission: "unknown" as const,
      warning: "The provider did not return a definitive submission result. The saved fee split is checked and sent again while it can still land."};
  }
}
/**
 * The sent fee split's finalized check. Verified: complete. Still pending: its saved bytes are sent again while they
 * can land. Failed on Solana, or expired unlanded: the chain is read, and the split is complete (it is locked with
 * these wallets after all), set_elsewhere (another split is locked) or failed (prepare again or keep 100%). Read-only
 * otherwise; it needs recovery only, so a sent split is always recorded.
 */
export async function confirmLiveFeeShare(wallet: string, input: {intentId: string; signature: string}) {
  const {row, fee, recipients} = await ownedFeeShare(wallet, input.intentId);
  if (fee.status === "complete" && fee.receipt_json) return {intent: await feeIntent(wallet, row.id), receipt: JSON.parse(fee.receipt_json) as object};
  const plan = await one<FeePlanRow>("SELECT * FROM live_fee_share_transactions WHERE intent_id = ? AND signature = ?", row.id, input.signature);
  if (!plan) throw new UserError("Confirm a signature from a fee split prepared for this launch.");
  const current = fee.status === "pending" && fee.signature === input.signature;
  let receipt: Awaited<ReturnType<typeof sdk.verifyFeeShareLanded>>;
  try { receipt = await chain(() => sdk.verifyFeeShareLanded(adapterInput(row), recipients, {connection: connection(), signature: input.signature, expectedMessageSha256: plan.signed_message_sha256 ?? plan.message_sha256}), "fees"); }
  catch (error) {
    if (error instanceof LaunchFailedOnChain && current) {
      logLaunchEvent("landed_failed", {intentId: row.id, kind: "fees"});
      await reconcileFeeShare(fee, row, recipients, FEES_FAILED);
      return {intent: await feeIntent(wallet, row.id), receipt: {status: "failed" as const}};
    }
    throw error;
  }
  if (receipt.status === "verified") {
    await guardedBatch([feeGuard(fee), clearGuard(),
      stmt("UPDATE live_fee_share_transactions SET status = 'confirmed', updated_at = ? WHERE id = ?", Date.now(), plan.id),
      stmt("UPDATE live_fee_shares SET status = 'complete', signature = ?, receipt_json = ?, error = NULL, updated_at = ? WHERE intent_id = ?", input.signature, JSON.stringify(receipt), Date.now(), row.id)]);
    logLaunchEvent("verified", {intentId: row.id, kind: "fees"});
    return {intent: await feeIntent(wallet, row.id), receipt};
  }
  if (!current || !plan.signed_transaction_base64) return {intent: await feeIntent(wallet, row.id), receipt};
  let delivery: Delivery | null = null;
  const expiry = Math.max((JSON.parse(plan.plan_json) as FeeSharePlan).lastValidBlockHeight, plan.effective_last_valid_block_height ?? 0);
  try {
    const sent = await sdk.resendSignedWalletTransaction({plan: JSON.parse(plan.plan_json) as FeeSharePlan, transactionBase64: plan.signed_transaction_base64,
      lastValidBlockHeight: expiry}, {connection: connection()});
    delivery = sent.status;
    if (sent.status !== "landed") logLaunchEvent(sent.status === "expired" ? "expired_unlanded" : sent.status, {intentId: row.id, kind: "fees"});
  } catch (error) { logLaunchEvent("resend_unchecked", {intentId: row.id, kind: "fees", reason: error instanceof Error ? error.message : "unknown"}); }
  if (delivery === "expired") await reconcileFeeShare(fee, row, recipients, FEE_EXPIRED, expiry);
  return {intent: await feeIntent(wallet, row.id), receipt, ...(delivery ? {delivery} : {})};
}
/**
 * After a split that failed or expired: what the chain holds decides complete, set_elsewhere or failed (with `reason`).
 * An expired one (`expiry`, its saved last valid block height) is read only once finalized height is past it, at that
 * finalized bank or newer (readFeeSplit afterBlockHeight); until then it stays pending, so a late landing read from a
 * lagging node is never recorded as failed.
 */
async function reconcileFeeShare(fee: FeeShareRow, row: IntentRow, recipients: LiveFeeRecipient[], reason: string, expiry?: number) {
  const state = await chain(() => sdk.readFeeSplit(adapterInput(row), {connection: connection(), ...(expiry !== undefined ? {afterBlockHeight: expiry} : {})}), "fees");
  if (state.state === "unexpired") return;
  if (state.state === "locked" && state.shareholders) return settleFeeShare(fee, recipients, state.shareholders, {status: "read", slot: state.slot});
  await guardedBatch([feeGuard(fee), clearGuard(),
    stmt("UPDATE live_fee_shares SET status = 'failed', error = ?, updated_at = ? WHERE intent_id = ? AND status = 'pending'", reason, Date.now(), fee.intent_id)]);
}
/**
 * "Skip, keep 100%": the creator keeps pump.fun's default (all creator fees to the creator wallet). Nothing is sent. Not
 * while a sent split can still land; final once recorded (pump.fun itself can still set a split later).
 */
export async function skipLiveFeeShare(wallet: string, input: {intentId: string}) {
  requireFeeSharing();
  const {row, fee, recipients} = await ownedFeeShare(wallet, input.intentId);
  if (fee.status === "skipped") return {intent: await feeIntent(wallet, row.id)};
  if (fee.status === "pending") throw new UserError(FEE_STILL_PENDING);
  if (FEE_SPLIT_FINAL.includes(fee.status)) throw new UserError("This coin's creator fee split is already settled.");
  if (row.status !== "complete") throw new UserError("Your creator fee split is set after your coin and card are confirmed.");
  // Never recorded as kept while the coin's split is locked (one of its sent transactions landed after all, or it was
  // set on pump.fun): the chain is read first, at confirmed, and a locked split settles as complete or set_elsewhere.
  const state = await chain(() => sdk.readFeeSplit(adapterInput(row), {connection: connection(), commitment: "confirmed"}), "fees");
  if (state.state === "locked" && state.shareholders) {
    await settleFeeShare(fee, recipients, state.shareholders, {status: "read", slot: state.slot});
    return {intent: await feeIntent(wallet, row.id)};
  }
  await guardedBatch([feeGuard(fee), clearGuard(),
    stmt("UPDATE live_fee_shares SET status = 'skipped', updated_at = ? WHERE intent_id = ? AND status IN ('requested','prepared','failed')", Date.now(), row.id)]);
  logLaunchEvent("fee_split_skipped", {intentId: row.id, kind: "fees"});
  return {intent: await feeIntent(wallet, row.id)};
}
