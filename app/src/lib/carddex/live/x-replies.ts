/**
 * The private reply helper (/admin/replies, owner request 31 October 2026): fresh Solana and pump.fun posts from X's
 * recent search, ranked for the owner to answer by hand. A human reads every post, writes or edits every reply and
 * posts it from their own browser through X's reply composer (replyIntentUrl). Nothing here posts, replies, mentions,
 * likes, reposts or follows, and nothing is sent to X on anyone's behalf (X's automation rules). This module is
 * client-safe: the queries, the ranking and the reply text rules; x-replies.server.ts reads X and stores the marks.
 */
import { OFFICIAL_X_HANDLE } from "../official";
import { X_TEXT_LIMIT, xTextLength } from "./x-announce";

// ---------------------------------------------------------------- what to search (owner-editable)

/**
 * The topics searched, joined with OR into one recent-search query (one paid read per check). Edit freely: a quoted
 * phrase matches exactly, a bare word matches anywhere. The whole query must stay within X's 512 characters.
 */
export const X_REPLY_TOPICS = [
  '"pump.fun"', "pumpfun", '"pump fun"',
  '"solana memecoin"', '"solana memecoins"', '"solana meme coin"',
  '"launch a coin"', '"launched a coin"', '"new solana token"',
  "memecoin", "memecoins", '"solana nft"', '"sol meme"',
] as const;
/** Our own account, never shown (its handle without the @). */
export const X_REPLY_OWN_USERNAME = OFFICIAL_X_HANDLE.replace(/^@/, "").toLowerCase();
/** Originals only (no reposts, no replies), English, never our own posts. */
export const X_REPLY_FILTERS = `-is:retweet -is:reply -from:${X_REPLY_OWN_USERNAME} lang:en`;
/** X's recent search takes queries up to 512 characters on self-serve access. */
export const X_QUERY_MAX = 512;
export function xReplyQuery(topics: readonly string[] = X_REPLY_TOPICS): string {
  const query = `(${topics.join(" OR ")}) ${X_REPLY_FILTERS}`;
  if (query.length > X_QUERY_MAX) throw new Error(`The reply helper's search query is ${query.length} characters; X allows ${X_QUERY_MAX}.`);
  return query;
}
/** Posts per search read (X bills each post returned). The most X returns in one read, ranked by X's relevancy. */
export const X_REPLY_PAGE = 100;

// ---------------------------------------------------------------- posts and ranking

export type XReplyPost = {
  id: string; text: string; createdAt: number;
  authorId: string; username: string; name: string; followers: number; verified: boolean;
  likes: number; replies: number; reposts: number; quotes: number;
};
export type RankedXReplyPost = XReplyPost & { ageMinutes: number; fresh: "new" | "recent" | "older" };

/** Under 30 minutes is new, under an hour recent; older than a day is dropped (a late reply reads as spam). */
export const FRESH_MINUTES = 30, RECENT_MINUTES = 60, MAX_AGE_MINUTES = 24 * 60;
const CASHTAG = /(?:^|[^\w$])\$[A-Za-z][A-Za-z0-9_]{0,14}\b/g, LINK = /https?:\/\/\S+/g, HASHTAG = /(?:^|\s)#\w+/g;
/**
 * Obvious spam and shilling: three or more cashtags, two or more links, or five or more hashtags. Shown to no one, and
 * never worth a reply.
 */
export function spammyPost(text: string): boolean {
  return (text.match(CASHTAG)?.length ?? 0) >= 3 || (text.match(LINK)?.length ?? 0) >= 2 || (text.match(HASHTAG)?.length ?? 0) >= 5;
}
/** Below these a post is skipped: a reply under it reaches almost no one (unless it is brand new and may still grow). */
export const MIN_FOLLOWERS = 500, MIN_ENGAGEMENT = 5;
/** Likes, plus reposts and quotes (which spread a post) twice, plus replies. */
export const engagement = (post: Pick<XReplyPost, "likes" | "replies" | "reposts" | "quotes">) =>
  post.likes + 2 * (post.reposts + post.quotes) + post.replies;
/**
 * How many people a reply under this post is likely to reach: its engagement, scaled by the author's audience, discounted
 * as the post ages (a reply on a fresh popular post is seen most).
 */
export function replyReach(post: XReplyPost, ageMinutes: number): number {
  return (engagement(post) + 1) * Math.sqrt(1 + post.followers / 1000) / (1 + ageMinutes / 180);
}
/**
 * The posts worth a look, best first: our own account, spam, posts already marked done or hidden, posts older than a
 * day, and posts from small accounts with little engagement (unless under 30 minutes old) are dropped; the rest are
 * ordered by likely reach (replyReach), the newest first on a tie.
 */
export function rankReplyPosts(posts: readonly XReplyPost[], options: { now: number; marked: ReadonlySet<string> }): RankedXReplyPost[] {
  const seen = new Set<string>();
  const kept: RankedXReplyPost[] = [];
  for (const post of posts) {
    if (seen.has(post.id) || options.marked.has(post.id)) continue;
    seen.add(post.id);
    if (post.username.toLowerCase() === X_REPLY_OWN_USERNAME || spammyPost(post.text)) continue;
    const ageMinutes = Math.max(0, Math.floor((options.now - post.createdAt) / 60_000));
    if (ageMinutes > MAX_AGE_MINUTES) continue;
    if (ageMinutes >= FRESH_MINUTES && post.followers < MIN_FOLLOWERS && engagement(post) < MIN_ENGAGEMENT) continue;
    kept.push({ ...post, ageMinutes, fresh: ageMinutes < FRESH_MINUTES ? "new" : ageMinutes < RECENT_MINUTES ? "recent" : "older" });
  }
  return kept.sort((a, b) => replyReach(b, b.ageMinutes) - replyReach(a, a.ageMinutes) || b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------- the human's reply

export const X_POST_ID = /^\d{1,30}$/;
/**
 * X's reply composer, opened in the owner's own browser with the reply prefilled: they read it, change it if they want
 * and press Post themselves. The documented Web Intent (docs.x.com, "Web Intent") is /intent/tweet with in_reply_to and
 * text. Every value is percent-encoded (a space is %20).
 */
export function replyIntentUrl(postId: string, text: string): string {
  if (!X_POST_ID.test(postId)) throw new Error("Not an X post id.");
  return `https://x.com/intent/tweet?in_reply_to=${postId}&text=${encodeURIComponent(text)}`;
}
export const xPostLink = (post: Pick<XReplyPost, "id" | "username">) => `https://x.com/${encodeURIComponent(post.username)}/status/${post.id}`;
export function replyLength(text: string) { return xTextLength(text); }
export const REPLY_LIMIT = X_TEXT_LIMIT;

/**
 * A suggestion as the page may show it: no links, hashtags, cashtags or mentions (the $ and # are dropped, the word
 * kept; a handle goes whole, after any character, since X links "(@name" and ".@name" too), whitespace collapsed, and within X's length. Null when nothing is left, or when it still talks money (a
 * price, a return, a "buy", a holding): those are thrown away rather than shown.
 */
const MONEY_TALK = /\b(?:\d+(?:\.\d+)?\s*x\b|to the moon|moon(?:ing|shot)?|price target|financial advice|guarantee[ds]?|not financial|nfa|dyor|ape[ds]?|aping|buy(?:ing)? (?:now|it|in|this)|i (?:just )?(?:bought|sold|hold|own)|my bags?|bagholder|100x|1000x)\b/i;
/** The one cashtag a promote-mode draft may keep: the site's own official token. */
export const PROMOTE_CASHTAG = "$launchcard";
export function cleanSuggestion(raw: string, options: { promote?: boolean } = {}): string | null {
  let text = raw.normalize("NFKC").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  text = text.replace(/https?:\/\/\S+|www\.\S+/gi, " ").replace(/@\w+/g, " ");
  // Every other cashtag and hashtag loses its sign; in promote mode the official $launchcard keeps it.
  text = text.replace(/[#$＃＄](?=(\w+))/g, (sign, word: string) => options.promote && sign === "$" && word.toLowerCase() === PROMOTE_CASHTAG.slice(1) ? "$" : "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text || /^skip\.?$/i.test(text) || MONEY_TALK.test(text)) return null;
  while (xTextLength(text) > X_TEXT_LIMIT) text = Array.from(text).slice(0, -1).join("");
  return text.trim() || null;
}
