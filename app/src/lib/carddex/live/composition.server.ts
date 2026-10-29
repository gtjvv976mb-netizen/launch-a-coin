import { imageSize } from "../../mintdex/server/art.server";
import { one, stmt, UserError } from "../../mintdex/server/db.server";
import { getCardDesign } from "../designs";
import { getTradingPair } from "../pairs";
import { CARD_RENDERER_VERSION } from "../card-template";
import { CREATOR_IMAGE_DIMENSIONS } from "./creator-print";
import { bindings } from "../../bindings.server";
import reviewedDesigns from "../../../../../integrations/pumpfun/src/design-assets.json";
import renderedDesigns from "../render-assets.json";
import tokenBackAssets from "../token-back-assets.json";
import { fetchPublicBytes, putPublicAsset, sniffLiveImage } from "./assets.server";
import { sha256, walletBytes } from "./auth.server";
import { requireLiveConfig } from "./config.server";
import { BUSY, createRendererSlot } from "./render-slot";
import { compositionBinding, normalizeLiveFields } from "./validation.server";
import type { LiveAssets, LiveComposeInput } from "./types";

export const COMPOSITION_VERSION = CARD_RENDERER_VERSION;
/** Card and case prints and coin-image exports take turns in this isolate (render-slot.ts: the 128 MB isolate limit). */
const withRendererSlot = createRendererSlot({busy: () => new UserError(BUSY)});
export async function loadRendererAsset(path: string): Promise<Uint8Array> {
  if (!/^\/(assets|fonts)\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes("..") || path.includes("//")) throw new UserError("The card renderer requested an unsupported asset.");
  const rendered = path.startsWith("/assets/carddex/render/") ? Object.values(renderedDesigns).find(asset => asset.path === path) : undefined;
  if (path.startsWith("/assets/carddex/render/")) {
    const source = rendered && reviewedDesigns[rendered.designKey as keyof typeof reviewedDesigns];
    if (!rendered || rendered.rendererVersion !== COMPOSITION_VERSION || rendered.width !== CREATOR_IMAGE_DIMENSIONS.card.width || rendered.height !== CREATOR_IMAGE_DIMENSIONS.card.height || !source || rendered.sourceSha256 !== source.front.sha256) throw new UserError("The card render atlas does not match the current trusted renderer and approved design.");
  }
  const tokenBack = path.startsWith("/assets/carddex/token-backs/") ? Object.values(tokenBackAssets).find(asset => asset.path === path) : undefined;
  if (path.startsWith("/assets/carddex/token-backs/")) {
    const source = tokenBack && reviewedDesigns[tokenBack.designKey as keyof typeof reviewedDesigns];
    if (!tokenBack || tokenBack.conversionVersion !== "launchacard-token-back-png-v1" || tokenBack.width !== 630 || tokenBack.height !== 880 || !source || tokenBack.sourceSha256 !== source.back.sha256) throw new UserError("The token-image reverse does not match its approved Higgsfield design.");
  }
  const response = await bindings().ASSETS?.fetch(`${requireLiveConfig("launch").origin}${path}`);
  const bytes = response?.ok ? new Uint8Array(await response.arrayBuffer()) : await fetchPublicBytes(`${requireLiveConfig("launch").origin}${path}`);
  const reviewed = Object.values(reviewedDesigns).flatMap(design => [design.front, design.back]).find(asset => asset.path === path);
  if (path.startsWith("/assets/carddex/higgsfield/") && (!reviewed || await sha256(bytes) !== reviewed.sha256)) throw new UserError("The public card frame differs from the approved premium design.");
  if (path.startsWith("/assets/carddex/render/")) {
    if (!rendered || await sha256(bytes) !== rendered.sha256) throw new UserError("The card render atlas differs from its trusted conversion manifest.");
  }
  if (path.startsWith("/assets/carddex/token-backs/") && (!tokenBack || await sha256(bytes) !== tokenBack.sha256)) throw new UserError("The token-image reverse differs from its trusted conversion manifest.");
  return bytes;
}

function creatorImageInput(wallet:string,fields:LiveComposeInput,artwork:LiveAssets["artwork"],bytes:Uint8Array,mimeType:string) {
  return {card: {name: fields.name, ticker: fields.symbol, lore: fields.description, image: artwork.url, cardTemplate: fields.cardTemplate,
    quoteAssetKey: fields.quoteAssetKey, quoteMint: fields.quoteMint, tradingPair: getTradingPair(fields.symbol, fields.quoteAssetKey),
    level: getCardDesign(fields.cardTemplate).materialLevel, mcapUsd: null, mcapLabel: "At creation", holders: 0, dexNo: 0,
    dexLabel: "1 / 1", ownerHandle: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`, mintAddress: fields.tokenMint},
    tokenMint: fields.tokenMint, creator: wallet, artwork: bytes, mimeType};
}
export async function composeLiveAssets(wallet: string, raw: LiveComposeInput, file: File): Promise<LiveAssets> {
  requireLiveConfig("launch"); walletBytes(wallet);
  const fields = normalizeLiveFields(raw);
  if (fields.tokenMint === wallet) throw new UserError("Generate a separate new token mint address.");
  if (file.size < 30 || file.size > 4 * 1024 * 1024) throw new UserError("Use creator artwork under 4 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer()), mime = sniffLiveImage(bytes), dimensions = imageSize(bytes);
  if (mime !== "image/png" && mime !== "image/jpeg") throw new UserError("Use PNG or JPEG artwork for the final NFT. Convert WebP to PNG before composing.");
  if (!dimensions || dimensions.w < 32 || dimensions.h < 32 || dimensions.w > 2048 || dimensions.h > 2048 || dimensions.w * dimensions.h > 2048 * 2048) throw new UserError("Use readable artwork up to 2048 pixels per side.");
  const artwork = await putPublicAsset(wallet, bytes, mime);
  const {cardImage, caseImage} = await withRendererSlot(async () => {
    const {composeCreatorImages} = await import("./compose.server");
    const images = await composeCreatorImages(creatorImageInput(wallet,fields,artwork,bytes,mime), {loadAsset: loadRendererAsset});
    return {cardImage: await putPublicAsset(wallet, images.cardImage, images.mimeType), caseImage: await putPublicAsset(wallet, images.caseImage, images.mimeType)};
  });
  await stmt("INSERT OR IGNORE INTO live_compositions (wallet, binding_sha256, artwork_sha256, card_sha256, case_sha256, renderer_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", wallet, await compositionBinding(wallet, fields), artwork.sha256, cardImage.sha256, caseImage.sha256, COMPOSITION_VERSION, Date.now()).run();
  return {artwork, cardImage, caseImage};
}
const TOKEN_IMAGE_TOO_LARGE = "This artwork has too much fine detail for your coin's turning image. Nothing was sent. Use a simpler or smaller image and compose the card again.";
/** Called only after exact composition and ownership checks in new-launch preparation; clients cannot supply these exports. */
export function composeTokenAssets(wallet:string,fields:LiveComposeInput,assets:LiveAssets) {
  return withRendererSlot(async () => {
    // Stored inside its own function, so the encoded GIF (up to 12 MB) is unreachable before it is read back below.
    const stored = await (async () => {
      const {composeCreatorTokenMedia}=await import("./compose.server");
      const media=await composeCreatorTokenMedia(creatorImageInput(wallet,fields,assets.artwork,await fetchPublicBytes(assets.artwork.url),assets.artwork.mimeType),{loadAsset:loadRendererAsset})
        .catch(error=>{throw error instanceof Error&&error.name==="TokenAnimationTooLarge"?new UserError(TOKEN_IMAGE_TOO_LARGE):error;});
      return {tokenImage:await putPublicAsset(wallet,media.tokenImage,"image/gif"),tokenPoster:await putPublicAsset(wallet,media.tokenPoster,"image/png"),format:media.format,posterFormat:media.posterFormat};
    })();
    await validateTokenExport(stored.tokenImage); await validateTokenExport(stored.tokenPoster);
    return stored;
  });
}
async function validateTokenExport(asset:LiveAssets["artwork"]) {
  if(await sha256(await fetchPublicBytes(asset.url))!==asset.sha256)throw new UserError("The public token image does not match this creator's card export.");
}
export async function requireTrustedComposition(wallet: string, fields: LiveComposeInput, assets: LiveAssets) {
  const row = await one("SELECT 1 FROM live_compositions WHERE wallet = ? AND binding_sha256 = ? AND artwork_sha256 = ? AND card_sha256 = ? AND case_sha256 = ? AND renderer_version = ?", wallet, await compositionBinding(wallet, fields), assets.artwork.sha256, assets.cardImage.sha256, assets.caseImage.sha256, COMPOSITION_VERSION);
  if (!row) throw new UserError("Compose the canonical card and case on this server with these exact token details before launch.");
}
