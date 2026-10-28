import { isCardDesignKey } from "../designs";
import { resolveLaunchQuote } from "../pairs";
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
export function normalizeLiveFields(input: LiveComposeInput): LiveComposeInput {
  if (!input || typeof input !== "object" || [input.tokenMint, input.name, input.symbol, input.description, input.cardTemplate, input.quoteAssetKey, input.quoteMint].some(value => typeof value !== "string") || input.website !== undefined && typeof input.website !== "string" || input.xUrl !== undefined && typeof input.xUrl !== "string") throw new UserError("Supply complete token, card and quote details.");
  walletBytes(input.tokenMint);
  const {name, symbol} = normalizeLiveIdentity(input), description = input.description.trim();
  if (description.length > 280) throw new UserError("Keep the description under 280 characters.");
  if (!isCardDesignKey(input.cardTemplate)) throw new UserError("Choose a reviewed creator card design.");
  try { resolveLaunchQuote(input.cardTemplate, {quoteAssetKey: input.quoteAssetKey, quoteMint: input.quoteMint}); }
  catch (error) { throw new UserError(error instanceof Error ? error.message : "Choose a compatible reviewed quote."); }
  return {tokenMint: input.tokenMint, name, symbol, description, website: link(input.website), xUrl: link(input.xUrl, true), cardTemplate: input.cardTemplate, quoteAssetKey: input.quoteAssetKey, quoteMint: input.quoteMint};
}
export function compositionBinding(wallet: string, fields: LiveComposeInput) { return sha256(JSON.stringify({version: 1, creator: wallet, ...normalizeLiveFields(fields)})); }
