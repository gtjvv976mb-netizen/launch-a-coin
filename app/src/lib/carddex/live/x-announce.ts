/**
 * Announcements of new coins on @launchacard (owner, 31 October 2026): one original post from the site's own account
 * per opted-in launch an owner approved on /admin/replies, made by the cron job in x-announce.server.ts. Never a reply, a mention, a like, a repost or a
 * follow, and never triggered by anyone else's posts (X's automation rules). This module is client-safe: the form's
 * copy and the post text, built only from fields made safe here.
 */
import { OFFICIAL_X_HANDLE, OFFICIAL_X_URL } from "../official";

export type LiveXPostStatus = "review" | "queued" | "posting" | "posted" | "failed" | "skipped";
/** A launch's announcement: "requested" once the creator opted in, until its finished launch is queued. */
export type LiveXAnnounce = { status: "requested" | LiveXPostStatus; postId: string | null };

export const X_ANNOUNCE_LABEL = `Announce my coin on ${OFFICIAL_X_HANDLE}`;
export const X_ANNOUNCE_HINT = "After your card is confirmed and we review it, we may post it once from our X account: name, ticker, pair, page link and the card image when it fits. Posts are limited per day and may be skipped. Nothing else is posted for you.";
export const X_ANNOUNCE_REVIEW = `After your card is confirmed, we review it and ${OFFICIAL_X_HANDLE} may post one announcement of your coin: its name, ticker, pair, page link and the card image when it fits. It never posts prices. Posts are limited per day, and a coin may be skipped (not approved, a name it cannot post safely, or not posted within a day).`;
export const xPostUrl = (postId: string) => `${OFFICIAL_X_URL}/status/${postId}`;
/** The saved launch's line, by status. */
export function xAnnounceStatusText(announce: LiveXAnnounce): string {
  switch (announce.status) {
    case "requested": return "Requested, after your card is confirmed";
    case "review": return "Waiting for review";
    case "queued": case "posting": return "Queued";
    case "posted": return "Posted";
    case "failed": return "Not posted";
    case "skipped": return "Not posted";
  }
}

// ---------------------------------------------------------------- the post text

/** X's own limit, counted its way: every link is 23 characters (t.co), most other scripts count 2. */
export const X_TEXT_LIMIT = 280;
const X_URL_LENGTH = 23;
const NAME_MAX = 32, TICKER_MAX = 13, PAIR_MAX = 16;
/**
 * Never posted: impersonation and scam words, and slurs. Matched on the name and ticker as letters only (spaces, digits
 * and symbols removed, common look-alike digits folded back to letters), so "Free-S0L" and "f r e e sol" still match.
 */
const BLOCKED_TEXT = ["launchacard", "pumpfun", "official", "airdrop", "giveaway", "freesol", "presale", "doubleyour", "walletconnect", "claimnow",
  "nigger", "nigga", "faggot", "retard", "kike", "hitler", "nazi"];
const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };
/** Invisible and direction-changing characters, and every control character. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g;
/** Anything X would turn into a link: a scheme, www., or a word.word domain. */
const LINKISH = /\b(?:[a-z][a-z0-9+.-]*:\/\/\S*|www\.\S*|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\S*)/gi;

function letters(text: string) {
  return text.toLowerCase().replace(/[013457@$]/g, c => LOOKALIKE[c]).replace(/[^a-z]/g, "");
}
export function blockedText(text: string): boolean {
  const flat = letters(text);
  return BLOCKED_TEXT.some(word => flat.includes(word));
}
/**
 * A coin's name as the post may print it: NFKC, no control or invisible characters, no @ (a mention), # (a hashtag),
 * $ (a cashtag), links or domains, whitespace collapsed, at most NAME_MAX characters. "" when nothing is left.
 */
export function safeName(raw: string): string {
  let text = raw.normalize("NFKC").replace(INVISIBLE, " ").replace(LINKISH, " ").replace(/[@#$＠＃＄]/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, NAME_MAX).join("").trim();
}
/** A ticker as printed: letters and digits only, upper case, without a $ (never a cashtag). */
export function safeTicker(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, TICKER_MAX);
}
/** The pair's symbol (from the site's own registry), with the same rules as a ticker plus "/" (e/acc). */
export function safePair(raw: string): string {
  return raw.normalize("NFKC").replace(/[^A-Za-z0-9/]/g, "").slice(0, PAIR_MAX);
}
/** X's weighted length: links count 23, the Latin ranges X weighs at 1 count 1, everything else (CJK, emoji) 2. */
export function xTextLength(text: string): number {
  let length = 0, rest = text;
  rest = rest.replace(/https?:\/\/\S+/g, () => { length += X_URL_LENGTH; return ""; });
  for (const char of rest) {
    const code = char.codePointAt(0)!;
    length += code <= 0x10ff || (code >= 0x2000 && code <= 0x200d) || (code >= 0x2010 && code <= 0x201f) || (code >= 0x2032 && code <= 0x2037) ? 1 : 2;
  }
  return length;
}
export type XAnnouncementText = { ok: true; text: string } | { ok: false; reason: string };
/**
 * The announcement, from safe fields only: the coin's name and ticker (made safe above), its pair's symbol and its page
 * on this site. No prices, no returns, no mentions, no hashtags and no cashtags (a link beside a cashtag reads as a
 * promotion and is what spam filters look for). A name or ticker that is empty once made safe, or matches the blocked
 * list, is never posted.
 */
export function xAnnouncementText(input: { name: string; symbol: string; pairSymbol: string; origin: string; tokenMint: string }): XAnnouncementText {
  const name = safeName(input.name), ticker = safeTicker(input.symbol), pair = safePair(input.pairSymbol);
  if (!name) return { ok: false, reason: "The coin's name has nothing that can be posted safely." };
  if (!ticker) return { ok: false, reason: "The coin's ticker has nothing that can be posted safely." };
  if (blockedText(input.name) || blockedText(name) || blockedText(ticker)) return { ok: false, reason: "The coin's name or ticker is on the blocked list." };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.tokenMint)) return { ok: false, reason: "The coin's mint is not a Solana address." };
  const pairText = pair ? `, a ${pair} pair coin with its own one-of-one card.` : ", a coin with its own one-of-one card.";
  const text = `New on Launch a Card: ${name} (${ticker})${pairText}\n${input.origin}/coin/${input.tokenMint}`;
  if (xTextLength(text) > X_TEXT_LIMIT) return { ok: false, reason: "The announcement would be longer than X allows." };
  return { ok: true, text };
}
