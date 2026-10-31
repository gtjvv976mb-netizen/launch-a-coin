/**
 * Announcements of new coins on @launchacard (the client-safe half, with the post text, is x-announce.ts).
 *
 * A creator opts in at launch (live_x_optins, saved in the launch's own batch). When that launch is complete and
 * CARDDEX_X_AUTOPOST is on, one row is added to live_x_posts for review (queueXAnnouncement, from service.server.ts).
 * An owner looks at its name, text and card image on /admin/replies and approves or skips it (reviewXAnnouncement):
 * the creator's image and name never reach @launchacard without a human seeing them first. The Worker's cron
 * (server.ts scheduled) calls runXAutoPost, which posts at most one approved coin per run:
 *   - one claim at a time: a single UPDATE moves one queued row to "posting" only while no other row is posting, the
 *     UTC day's posts are under the cap and the last claim is older than the gap, so two isolates never post twice;
 *   - a post is final ("posted", tweet_id) and is never made again, even when recording it fails; a refused attempt is
 *     tried again with backoff, up to MAX_ATTEMPTS (a 429 with X's reset time waits for it without using an attempt);
 *     a post whose outcome is unknown (timed out after sending, a 5xx, or a run that died mid-post) is "failed" and
 *     left for an operator, since X may have made it.
 * Only original posts by @launchacard: no replies, mentions, likes, reposts or follows, and nothing is triggered by
 * anyone else's posts.
 */
import { bindings } from "../../bindings.server";
import { one, readBatch, q, stmt, db, UserError } from "../../mintdex/server/db.server";
import { getPairAsset } from "../pairs";
import { liveReadiness } from "./config.server";
import type { LiveAsset, LiveAssets } from "./types";
import { xAnnouncementText, type LiveXAnnounce, type LiveXPostStatus } from "./x-announce";
import { createXClient, X_IMAGE_MAX_BYTES, XApiError, type XClient, type XCredentials, type XFetch } from "./x-client.server";

export const DEFAULT_DAILY_CAP = 20, DEFAULT_GAP_MINUTES = 10;
export const MAX_ATTEMPTS = 3;
/** Wait before the second and third attempts. */
export const BACKOFF_MS = [5 * 60_000, 30 * 60_000] as const;
/** A queued coin not posted within a day of its launch is skipped: an announcement is news only while it is new. */
export const MAX_AGE_MS = 24 * 3_600_000;
/** A "posting" claim older than this belongs to a run that died (a run's calls time out well inside it). */
export const STALE_CLAIM_MS = 5 * 60_000;
export const INTERRUPTED = "The post was interrupted and may or may not be on X. Check @launchacard before setting it back to queued.";

type PostRow = {intent_id: string; status: LiveXPostStatus; attempts: number; claim_id: string | null; tweet_id: string | null};
type IntentRow = {id: string; token_mint: string; quote_key: string; payload_json: string; status: string};
type Payload = {fields: {name: string; symbol: string}; assets: LiveAssets};

const noTable = (error: unknown) => /no such table/i.test(error instanceof Error ? error.message : String(error));
function whole(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number((value ?? "").trim());
  return value !== undefined && value.trim() !== "" && Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
export function xAutopostLimits() {
  const env = bindings();
  return {dailyCap: whole(env.CARDDEX_X_DAILY_CAP, DEFAULT_DAILY_CAP, 1, 100), gapMs: whole(env.CARDDEX_X_MIN_GAP_MINUTES, DEFAULT_GAP_MINUTES, 1, 1440) * 60_000};
}
function credentials(): XCredentials {
  const env = bindings();
  return {apiKey: env.X_API_KEY!.trim(), apiSecret: env.X_API_SECRET!.trim(), accessToken: env.X_ACCESS_TOKEN!.trim(), accessTokenSecret: env.X_ACCESS_TOKEN_SECRET!.trim()};
}
function logX(event: string, fields: Record<string, string | number | boolean | undefined>) {
  console.log(JSON.stringify({event: `x_announce_${event}`, ...fields}));
}

/** The opt-in, in the batch that saves a new launch. */
export function xOptinStatement(intentId: string, now: number) {
  return stmt("INSERT OR IGNORE INTO live_x_optins (intent_id, created_at) VALUES (?, ?)", intentId, now);
}
/** The opt-in for a launch saved earlier (a saved launch prepared again with the box ticked). Never throws. */
export async function keepXOptin(intentId: string): Promise<void> {
  try { await xOptinStatement(intentId, Date.now()).run(); }
  catch (error) { logX("optin_unsaved", {intentId, reason: noTable(error) ? "schema" : "error"}); }
}
const queueSql = (where: string) => `INSERT OR IGNORE INTO live_x_posts (intent_id, status, attempts, next_attempt_at, created_at, updated_at)
  SELECT o.intent_id, 'review', 0, ?1, ?1, ?1 FROM live_x_optins o JOIN live_launch_intents i ON i.id = o.intent_id WHERE i.status = 'complete' AND ${where}`;
/**
 * Adds the announcement of a launch that just completed for an owner's review, when its creator opted in and
 * announcements are on. Never throws: an announcement can never stop a launch from finishing. True when a row was added.
 */
export async function queueXAnnouncement(intentId: string, now = Date.now()): Promise<boolean> {
  try {
    if (!liveReadiness().xAnnounce) return false;
    const result = await stmt(queueSql("o.intent_id = ?2"), now, intentId).run();
    const queued = (result.meta?.changes ?? 0) > 0;
    if (queued) logX("review", {intentId});
    return queued;
  } catch (error) {
    logX("queue_failed", {intentId, reason: noTable(error) ? "schema" : "error"});
    return false;
  }
}

/** A launch's announcement as its creator sees it, by launch id. A database without migration 0018 has none. */
export async function xAnnounceFor(intentIds: readonly string[]): Promise<Map<string, LiveXAnnounce>> {
  const ids = [...new Set(intentIds)].slice(0, 100);
  if (!ids.length) return new Map();
  try {
    const [rows] = await readBatch(q<{intent_id: string; status: LiveXPostStatus | null; tweet_id: string | null}>(
      `SELECT o.intent_id, p.status, p.tweet_id FROM live_x_optins o LEFT JOIN live_x_posts p ON p.intent_id = o.intent_id WHERE o.intent_id IN (${ids.map(() => "?").join(", ")})`, ...ids));
    return new Map(rows.map(row => [row.intent_id, {status: row.status ?? "requested", postId: row.status === "posted" ? row.tweet_id : null}]));
  } catch (error) {
    if (noTable(error)) return new Map();
    throw error;
  }
}

/** The day's start (UTC) for the daily cap. */
const utcDayStart = (now: number) => now - now % 86_400_000;
/**
 * Claims the next queued announcement, or none: one statement, so it is atomic in D1. It takes a row only while no
 * other row is posting, fewer than `dailyCap` were posted since 00:00 UTC, and the newest claim is at least `gapMs` old.
 */
export async function claimNextXPost(now: number, limits: {dailyCap: number; gapMs: number}): Promise<PostRow | null> {
  const claimId = crypto.randomUUID();
  await stmt(`UPDATE live_x_posts SET status = 'posting', claim_id = ?1, claimed_at = ?2, attempts = attempts + 1, updated_at = ?2
    WHERE intent_id = (SELECT intent_id FROM live_x_posts WHERE status = 'queued' AND next_attempt_at <= ?2 ORDER BY next_attempt_at, created_at, intent_id LIMIT 1)
      AND status = 'queued'
      AND NOT EXISTS (SELECT 1 FROM live_x_posts WHERE status = 'posting')
      AND (SELECT COUNT(*) FROM live_x_posts WHERE status = 'posted' AND posted_at >= ?3) < ?4
      AND COALESCE((SELECT MAX(claimed_at) FROM live_x_posts), 0) <= ?2 - ?5`,
  claimId, now, utcDayStart(now), limits.dailyCap, limits.gapMs).run();
  return one<PostRow>("SELECT intent_id, status, attempts, claim_id, tweet_id FROM live_x_posts WHERE claim_id = ? AND status = 'posting'", claimId);
}
/** Housekeeping before a claim: interrupted claims fail (never retried: they may be on X), stale unposted rows skip, and
 * any opted-in launch completed in the last day without a row (its queue write failed) is added for review. */
async function sweep(now: number) {
  await db().batch([
    stmt("UPDATE live_x_posts SET status = 'failed', error = ?, updated_at = ? WHERE status = 'posting' AND claimed_at < ?", INTERRUPTED, now, now - STALE_CLAIM_MS),
    stmt("UPDATE live_x_posts SET status = 'skipped', error = 'Not posted within a day of the launch.', updated_at = ? WHERE status IN ('review','queued') AND created_at < ?", now, now - MAX_AGE_MS),
    stmt(queueSql("i.updated_at >= ?2"), now, now - MAX_AGE_MS),
  ]);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
/**
 * The coin's minted card image from this site's own R2 (the stored, content-addressed asset the card was minted
 * with), or its 1024 px still when the card is larger than X takes. Null when neither can be read or fits: the post
 * then goes out as text.
 */
const IMAGE_EXT: Record<string, string> = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"};
/** The images the post may carry, in order: the card, then its 1024 px still. */
function postableImages(assets: LiveAssets | undefined): LiveAsset[] {
  return ([assets?.cardImage, assets?.tokenPoster] as (LiveAsset | undefined)[])
    .filter((asset): asset is LiveAsset => !!asset && /^[a-f0-9]{64}$/.test(asset.sha256) && asset.mimeType in IMAGE_EXT && asset.bytes <= X_IMAGE_MAX_BYTES);
}
async function cardImage(assets: LiveAssets): Promise<{bytes: Uint8Array<ArrayBuffer>; mimeType: string} | null> {
  const storage = bindings().STORAGE;
  if (!storage) return null;
  for (const asset of postableImages(assets)) {
    const stored = await one<{storage_key: string}>("SELECT storage_key FROM live_assets WHERE sha256 = ?", asset.sha256);
    const object = stored ? await storage.get(stored.storage_key) : null;
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength <= X_IMAGE_MAX_BYTES && await sha256Hex(bytes) === asset.sha256) return {bytes, mimeType: asset.mimeType};
  }
  return null;
}

export type XRunResult = {state: "off" | "idle" | "posted" | "skipped" | "retry" | "failed"; intentId?: string; postId?: string};
/**
 * One cron run: housekeeping, then at most one claimed announcement. Never throws (the cron has nobody to tell).
 * `scheduledAt` is the cron's own scheduled time (controller.scheduledTime): the claim uses it, so runs exactly one
 * period apart are never inside the gap because one started a little late. `client`, `fetch` and `now` are for tests;
 * the Worker uses the real X client and clock.
 */
export async function runXAutoPost(options: {client?: XClient; fetch?: XFetch; now?: () => number; scheduledAt?: number} = {}): Promise<XRunResult> {
  const now = options.now ?? Date.now;
  let claimed: PostRow | null = null;
  // Set once X has made the post: from then on the row is never queued again, whatever fails after.
  let postId: string | null = null;
  try {
    const readiness = liveReadiness();
    if (!readiness.xAnnounce || !readiness.publicOrigin) return {state: "off"};
    await sweep(now());
    const at = now(), scheduled = options.scheduledAt;
    claimed = await claimNextXPost(scheduled !== undefined && scheduled <= at && at - scheduled < STALE_CLAIM_MS ? scheduled : at, xAutopostLimits());
    if (!claimed) return {state: "idle"};
    const intent = await one<IntentRow>("SELECT id, token_mint, quote_key, payload_json, status FROM live_launch_intents WHERE id = ?", claimed.intent_id);
    const payload = intent ? JSON.parse(intent.payload_json) as Payload : null;
    const built = intent && payload && intent.status === "complete"
      ? xAnnouncementText({name: payload.fields.name, symbol: payload.fields.symbol, pairSymbol: getPairAsset(intent.quote_key).symbol, origin: readiness.publicOrigin, tokenMint: intent.token_mint})
      : {ok: false as const, reason: "The launch is not complete."};
    if (!built.ok) {
      await finish(claimed, "skipped", now(), {error: built.reason});
      logX("skipped", {intentId: claimed.intent_id});
      return {state: "skipped", intentId: claimed.intent_id};
    }
    const client = options.client ?? createXClient(credentials(), {fetch: options.fetch, now});
    const image = await cardImage(payload!.assets);
    let mediaId: string | undefined;
    if (image) {
      try { mediaId = await client.uploadImage(image.bytes, image.mimeType); }
      catch (error) {
        // X refused the image for good (not a busy or rate-limited X): the post goes out as text.
        if (!(error instanceof XApiError) || error.retryable || error.status === 429) throw error;
        logX("image_dropped", {intentId: claimed.intent_id, status: error.status ?? undefined});
      }
    }
    postId = await client.createPost({text: built.text, ...(mediaId ? {mediaId} : {})});
    await finish(claimed, "posted", now(), {tweetId: postId});
    logX("posted", {intentId: claimed.intent_id, attempts: claimed.attempts, image: !!mediaId});
    return {state: "posted", intentId: claimed.intent_id, postId};
  } catch (error) {
    if (!claimed) {
      logX("run_failed", {reason: noTable(error) ? "schema" : error instanceof Error ? error.name : "error"});
      return {state: "idle"};
    }
    if (postId) return keepPosted(claimed, postId, now);
    // A refusal before anything was made is tried again later; an unknown outcome, a final refusal or the last
    // attempt fails for good. Only X's status and short title are kept, never a credential or request.
    const x = error instanceof XApiError ? error : null;
    const reason = x ? x.message : "The announcement could not be prepared.";
    if (x?.status === 429 && x.retryAt !== null) {
      // X said when it takes posts again: this coin and every queued one wait until then, and no attempt is used.
      const at = now(), until = Math.min(at + MAX_AGE_MS, Math.max(at + 60_000, x.retryAt));
      try {
        await db().batch([
          stmt("UPDATE live_x_posts SET status = 'queued', attempts = attempts - 1, error = ?, next_attempt_at = ?, updated_at = ? WHERE intent_id = ? AND claim_id = ? AND status = 'posting'",
            reason, until, at, claimed.intent_id, claimed.claim_id),
          stmt("UPDATE live_x_posts SET next_attempt_at = ?1, updated_at = ?2 WHERE status = 'queued' AND next_attempt_at < ?1", until, at),
        ]);
      } catch { /* The claim stays "posting" and the next run's sweep fails it. */ }
      logX("rate_limited", {intentId: claimed.intent_id, until});
      return {state: "retry", intentId: claimed.intent_id};
    }
    const retry = (x ? x.retryable && !x.ambiguous : true) && claimed.attempts < MAX_ATTEMPTS;
    try {
      if (retry) await finish(claimed, "queued", now(), {error: reason, nextAttemptAt: now() + BACKOFF_MS[Math.min(claimed.attempts, BACKOFF_MS.length) - 1]});
      else await finish(claimed, "failed", now(), {error: x?.ambiguous ? `${reason}. ${INTERRUPTED}` : reason});
    } catch { /* The claim stays "posting" and the next run's sweep fails it. */ }
    logX(retry ? "retry" : "failed", {intentId: claimed.intent_id, attempts: claimed.attempts, status: x?.status ?? undefined, ambiguous: x?.ambiguous});
    return {state: retry ? "retry" : "failed", intentId: claimed.intent_id};
  }
}
/**
 * X made the post but recording it failed: never queued again. Tries to record it once more, then to fail the claim
 * with the post id for an operator; if the database is down too, the log line keeps the id and the next sweep fails it.
 */
async function keepPosted(claimed: PostRow, postId: string, now: () => number): Promise<XRunResult> {
  try { await finish(claimed, "posted", now(), {tweetId: postId}); }
  catch {
    try { await finish(claimed, "failed", now(), {error: `Posted on X as ${postId}, but it could not be recorded. Record it as posted.`}); }
    catch { /* Left "posting" for the sweep. */ }
    logX("posted_unrecorded", {intentId: claimed.intent_id, postId});
  }
  return {state: "posted", intentId: claimed.intent_id, postId};
}
/** Ends this run's claim. A posted coin is recorded even if a sweep has meanwhile failed the claim (a slow run). */
async function finish(claim: PostRow, status: "posted" | "queued" | "failed" | "skipped", now: number, detail: {tweetId?: string; error?: string; nextAttemptAt?: number}) {
  if (status === "posted") {
    await stmt("UPDATE live_x_posts SET status = 'posted', tweet_id = ?, posted_at = ?, error = NULL, updated_at = ? WHERE intent_id = ? AND claim_id = ? AND status IN ('posting','failed')",
      detail.tweetId, now, now, claim.intent_id, claim.claim_id).run();
    return;
  }
  await stmt("UPDATE live_x_posts SET status = ?, error = ?, next_attempt_at = COALESCE(?, next_attempt_at), updated_at = ? WHERE intent_id = ? AND claim_id = ? AND status = 'posting'",
    status, detail.error?.slice(0, 300) ?? null, detail.nextAttemptAt ?? null, now, claim.intent_id, claim.claim_id).run();
}

// ---------------------------------------------------------------- the owner's review (/admin/replies)

/** One announcement waiting for review: exactly what would be posted, and the image path to look at. */
export type XReviewItem = {
  intentId: string; tokenMint: string; createdAt: number;
  name: string; symbol: string; text: string | null; reason: string | null; imagePath: string | null;
};
export const REVIEW_LIST_MAX = 20;
/**
 * The announcements waiting for an owner, oldest first (the caller checks the owner). Rows older than a day are left
 * out: the sweep skips them. A launch whose text cannot be built is listed with its reason, to be skipped.
 */
export async function xReviewQueue(now = Date.now()): Promise<XReviewItem[]> {
  const origin = liveReadiness().publicOrigin ?? "";
  let rows: (IntentRow & {created_at: number})[];
  try {
    rows = (await stmt(`SELECT i.id, i.token_mint, i.quote_key, i.payload_json, i.status, p.created_at FROM live_x_posts p JOIN live_launch_intents i ON i.id = p.intent_id
      WHERE p.status = 'review' AND p.created_at >= ? ORDER BY p.created_at, p.intent_id LIMIT ?`, now - MAX_AGE_MS, REVIEW_LIST_MAX).all<IntentRow & {created_at: number}>()).results ?? [];
  } catch (error) {
    if (noTable(error)) return [];
    throw error;
  }
  return rows.map(row => {
    let payload: Payload | null = null;
    try { payload = JSON.parse(row.payload_json) as Payload; } catch { /* Shown with its reason. */ }
    const built = payload && origin
      ? xAnnouncementText({name: payload.fields.name, symbol: payload.fields.symbol, pairSymbol: getPairAsset(row.quote_key).symbol, origin, tokenMint: row.token_mint})
      : {ok: false as const, reason: "The launch could not be read."};
    const image = postableImages(payload?.assets)[0];
    return {
      intentId: row.id, tokenMint: row.token_mint, createdAt: row.created_at,
      name: (payload?.fields.name ?? "").slice(0, 80), symbol: (payload?.fields.symbol ?? "").slice(0, 20),
      text: built.ok ? built.text : null, reason: built.ok ? null : built.reason,
      imagePath: image ? `/api/live/assets/${image.sha256}.${IMAGE_EXT[image.mimeType]}` : null,
    };
  });
}
/** An owner's decision on one announcement (the caller checks the owner): approve queues it now, skip ends it. */
export async function reviewXAnnouncement(input: {intentId: string; decision: "approve" | "skip"}, wallet: string, now = Date.now()) {
  const result = await stmt(`UPDATE live_x_posts SET status = ?, error = ?, next_attempt_at = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
    WHERE intent_id = ? AND status = 'review'`,
  input.decision === "approve" ? "queued" : "skipped", input.decision === "approve" ? null : "Not approved for posting.", now, wallet, now, now, input.intentId).run();
  if ((result.meta?.changes ?? 0) === 0) throw new UserError("That announcement is no longer waiting for review.");
  logX(input.decision === "approve" ? "approved" : "declined", {intentId: input.intentId});
  return {intentId: input.intentId, decision: input.decision};
}
