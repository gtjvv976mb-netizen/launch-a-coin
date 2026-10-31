import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { UserError } from "../../mintdex/server/db.server";
import { LIVE_SESSION_COOKIE } from "./auth.server";
import { assertSiteOrigin, liveReadiness } from "./config.server";
import { requireReplyAdmin } from "./x-replies.server";
import * as announce from "./x-announce.server";

/*
 * The owner's review of @launchacard announcements (/admin/replies). The same owner check and "not found" as the reply
 * helper. Approving only queues a coin for the cron, and Skip ends one before a run claims it; nothing here calls X.
 * With CARDDEX_X_AUTO_APPROVE on, coins that pass the filters arrive already queued (`autoApprove` says so).
 */
type Result<T extends object> = ({ok: true} & T) | {ok: false; error: string};
async function attempt<T extends object>(op: string, fn: () => Promise<T>): Promise<Result<T>> {
  try { setResponseHeader("Cache-Control", "no-store"); setResponseHeader("X-Robots-Tag", "noindex"); } catch { /* No request context in isolated tests. */ }
  try { return {ok: true, ...await fn()}; }
  catch (error) {
    if (error instanceof UserError) return {ok: false, error: error.message};
    console.error("Announcement review failed", op, error instanceof Error ? error.name : "error");
    return {ok: false, error: "Something went wrong. Try again."};
  }
}
const session = () => getCookie(LIVE_SESSION_COOKIE);

export const getXReviewQueue = createServerFn({method: "GET"}).handler(() => attempt("queue", async () => {
  await requireReplyAdmin(session());
  const [items, upcoming] = await Promise.all([announce.xReviewQueue(), announce.xUpcomingAnnouncements()]);
  return {items, upcoming, autoApprove: liveReadiness().xAutoApprove === true};
}));
export const reviewXAnnouncement = createServerFn({method: "POST"})
  .validator(z.object({intentId: z.string().min(1).max(100), decision: z.enum(["approve", "skip"])}))
  .handler(({data}) => attempt("review", async () => {
    assertSiteOrigin(getRequestHeader("origin") ?? null);
    const wallet = await requireReplyAdmin(session());
    return announce.reviewXAnnouncement(data, wallet);
  }));
