import { isCardDesignKey } from "../designs";
import { completeLaunchPair, mainnetPairRefusal, resolveLaunchQuote, resolveNewLaunchPair } from "../pairs";
import { UserError } from "../../mintdex/server/db.server";
import { sha256, walletBytes } from "./auth.server";
import type { LiveComposeInput } from "./types";

function link(value?: string, social = false): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || social && !/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) throw new Error();
    return url.href;
  } catch { throw new UserError(social ? "Use a full HTTPS X or Twitter profile link." : "Use a full HTTPS website link."); }
}
/** The coin name and symbol exactly as they go on chain. */
export function normalizeLiveIdentity(input: {name: string; symbol: string}) {
  if (typeof input?.name !== "string" || typeof input.symbol !== "string") throw new UserError("Supply complete token, card and quote details.");
  const name = input.name.trim().replace(/\s+/g, " "), symbol = input.symbol.trim().toUpperCase();
  if (!name || new TextEncoder().encode(name).length > 32 || /[\x00-\x1f]/.test(name)) throw new UserError("Live token names must use 1 to 32 UTF-8 bytes without control characters.");
  if (!/^[A-Z0-9]{1,13}$/.test(symbol)) throw new UserError("Use 1 to 13 letters or numbers for the token symbol.");
  return {name, symbol};
}
/** A launch request as it arrives: the pair alone is enough (its design follows); an older client sends all three. */
export type LiveFieldsInput = Omit<LiveComposeInput, "cardTemplate" | "quoteAssetKey" | "quoteMint"> & Partial<Pick<LiveComposeInput, "cardTemplate" | "quoteAssetKey" | "quoteMint">>;
/**
 * Every live request's fields, checked and in one shape. Missing pair fields are completed (a pair takes its design,
 * a design its pair); a request that names all three comes out exactly as before, so saved launches keep their
 * binding and request hashes. The identity check is the one saved launches were made under (resolveLaunchQuote);
 * new launches also pass requireNewLaunchPair.
 */
export function normalizeLiveFields(input: LiveFieldsInput): LiveComposeInput {
  if (!input || typeof input !== "object" || [input.tokenMint, input.name, input.symbol, input.description].some(value => typeof value !== "string") || [input.cardTemplate, input.quoteAssetKey, input.quoteMint, input.website, input.xUrl].some(value => value !== undefined && typeof value !== "string")) throw new UserError("Supply complete token, card and quote details.");
  walletBytes(input.tokenMint);
  const {name, symbol} = normalizeLiveIdentity(input), description = input.description.trim();
  if (description.length > 280) throw new UserError("Keep the description under 280 characters.");
  let pair: ReturnType<typeof completeLaunchPair>;
  try { pair = completeLaunchPair(input); }
  catch (error) { throw new UserError(error instanceof Error ? error.message : "Pick a supported pair."); }
  if (!isCardDesignKey(pair.cardTemplate)) throw new UserError("Choose a reviewed creator card design.");
  try { resolveLaunchQuote(pair.cardTemplate, {quoteAssetKey: pair.quoteAssetKey, quoteMint: pair.quoteMint}); }
  catch (error) {
    // No saved launch can fail this check, so this is a new request: say why in the pair's own words.
    try { resolveNewLaunchPair(pair); } catch (plain) { if (plain instanceof Error) throw new UserError(plain.message); }
    throw new UserError(error instanceof Error ? error.message : "Choose a compatible reviewed quote.");
  }
  return {tokenMint: input.tokenMint, name, symbol, description, website: link(input.website), xUrl: link(input.xUrl, true), cardTemplate: pair.cardTemplate, quoteAssetKey: pair.quoteAssetKey, quoteMint: pair.quoteMint};
}
/**
 * New launches only (a card composition and a first prepare): the pair picks the card, so a design that is not the
 * pair's own, or has no pair, is refused in plain words before anything is rendered, stored or prepared. A saved
 * launch is never checked again here: it is recovered with the design and pair it was saved with.
 */
export function requireNewLaunchPair(fields: LiveComposeInput) {
  try { resolveNewLaunchPair(fields); }
  catch (error) { throw new UserError(error instanceof Error ? error.message : "Pick a supported pair."); }
  // A transfer-fee quote (ZCAT) would only be refused at prepare, after the uploads and the coin image, and a direct pair
  // waits for the owner's confirmation (pairs.ts mainnetPairHold): refuse them here.
  const held = mainnetPairRefusal(fields.quoteAssetKey);
  if (held) throw new UserError(held);
}
export function compositionBinding(wallet: string, fields: LiveFieldsInput) { return sha256(JSON.stringify({version: 1, creator: wallet, ...normalizeLiveFields(fields)})); }
