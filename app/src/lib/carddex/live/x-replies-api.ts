import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { UserError } from "../../mintdex/server/db.server";
import { LIVE_SESSION_COOKIE } from "./auth.server";
import { assertSiteOrigin } from "./config.server";
import * as replies from "./x-replies.server";

/*
 * The reply helper's server functions (/admin/replies). Every one checks the owner's wallet session first and answers
 * a refusal with the same "not found"; the page itself is only a reader and a composer link: nothing here posts to X.
 */
type Result<T extends object> = ({ok: true} & T) | {ok: false; error: string};
async function attempt<T extends object>(op: string, fn: () => Promise<T>): Promise<Result<T>> {
  try { setResponseHeader("Cache-Control", "no-store"); setResponseHeader("X-Robots-Tag", "noindex"); } catch { /* No request context in isolated tests. */ }
  try { return {ok: true, ...await fn()}; }
  catch (error) {
    if (error instanceof UserError) return {ok: false, error: error.message};
    console.error("Reply helper operation failed", op, error instanceof Error ? error.name : "error");
    return {ok: false, error: "Something went wrong. Try again."};
  }
}
const session = () => getCookie(LIVE_SESSION_COOKIE);
/** A state-changing action from this site's own pages only (CSRF). */
const sameSite = () => assertSiteOrigin(getRequestHeader("origin") ?? null);
const tweetId = z.string().regex(/^\d{1,30}$/);

/** "hidden" (not configured, or a wallet that is not an owner), "signed-out" or "admin". Never a list or a wallet. */
export const getReplyHelperAccess = createServerFn({method: "GET"}).handler(async () => {
  try { setResponseHeader("Cache-Control", "no-store"); } catch { /* No request context in isolated tests. */ }
  const access = await replies.replyHelperAccess(session());
  return {state: access.state === "admin" || access.state === "signed-out" ? access.state : "hidden" as const};
});
export const getReplyFeed = createServerFn({method: "GET"}).handler(() => attempt("feed", () => replies.replyFeed(session())));
export const markReplyPost = createServerFn({method: "POST"}).validator(z.object({tweetId, mark: z.enum(["done", "hidden"])})).handler(({data}) => attempt("mark", async () => {
  sameSite(); return replies.markReplyPost(session(), data);
}));
export const suggestReplyText = createServerFn({method: "POST"}).validator(z.object({tweetId, mode: z.enum(["natural", "promote"]).default("natural")})).handler(({data}) => attempt("suggest", async () => {
  sameSite(); return replies.suggestReply(session(), data);
}));
