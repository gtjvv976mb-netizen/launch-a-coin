/**
 * The X API v2 calls the @launchacard announcements need, and nothing else: upload one image (POST /2/media/upload)
 * and create one original post (POST /2/tweets) with text and that image. No reply, quote, mention, tag, like, repost
 * or follow call exists here, and the post body is built from exactly two fields (text, media.media_ids).
 *
 * Auth is OAuth 1.0a user context (HMAC-SHA1, WebCrypto) with the account's four static values from the X developer
 * portal: no token store and no refresh. JSON and multipart bodies are not signed (RFC 5849 signs only query and form
 * parameters). The credentials go into the Authorization header and nowhere else: never into an error, a log line or
 * a URL. fetch is injected so tests never reach the network.
 */

export type XCredentials = { apiKey: string; apiSecret: string; accessToken: string; accessTokenSecret: string };
export type XFetch = (url: string, init: RequestInit) => Promise<Response>;
export const X_API = "https://api.x.com";
/** X's simple upload takes images up to 5 MB. */
export const X_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000, MAX_RESPONSE_BYTES = 65_536;

/**
 * An X call that did not succeed. `retryable`: X (or the network) refused before anything was made, so the same call
 * may be made again later (429, an upload's 5xx, a network error before an answer). `ambiguous`: the post call's
 * outcome is unknown (it timed out, the connection dropped after sending, or X answered 5xx, which it can do after
 * making the post), so it must never be retried automatically. `retryAt`: on a 429, when X said it takes calls again
 * (x-rate-limit-reset or retry-after). The message holds only the status and X's own short title, never a credential.
 */
export class XApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean, readonly ambiguous = false, readonly retryAt: number | null = null) { super(message); this.name = "XApiError"; }
}
/** When a 429 says calls work again: x-rate-limit-reset (epoch seconds) or retry-after (seconds or an HTTP date). */
export function rateLimitResetAt(headers: Headers, now: number): number | null {
  const reset = Number(headers.get("x-rate-limit-reset")?.trim());
  if (Number.isInteger(reset) && reset > 0) return reset * 1000;
  const after = headers.get("retry-after")?.trim();
  if (!after) return null;
  if (/^\d+$/.test(after)) return now + Number(after) * 1000;
  const date = Date.parse(after);
  return Number.isFinite(date) ? date : null;
}

/** RFC 3986 percent-encoding, as OAuth 1.0a and X require: only A-Z a-z 0-9 - . _ ~ stay; a space is %20. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
/** The OAuth 1.0a signature base string: METHOD & encoded base URL & encoded sorted parameters. */
export function signatureBaseString(method: string, url: string, params: Record<string, string>): string {
  const parsed = new URL(url), all: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => all.push([percentEncode(key), percentEncode(value)]));
  for (const [key, value] of Object.entries(params)) all.push([percentEncode(key), percentEncode(value)]);
  all.sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const base = `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`;
  return `${method.toUpperCase()}&${percentEncode(base)}&${percentEncode(all.map(([k, v]) => `${k}=${v}`).join("&"))}`;
}
/** HMAC-SHA1 of the base string under consumer secret & token secret, base64. */
export async function oauthSignature(baseString: string, consumerSecret: string, tokenSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString)));
  return btoa(String.fromCharCode(...mac));
}
/**
 * The Authorization header for one request. `params` are any form-encoded body parameters (none for JSON or
 * multipart); query parameters are read from the URL.
 */
export async function oauthHeader(credentials: XCredentials, method: string, url: string, options: { nonce: string; timestamp: number; params?: Record<string, string> }): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey, oauth_nonce: options.nonce, oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(options.timestamp), oauth_token: credentials.accessToken, oauth_version: "1.0",
  };
  const base = signatureBaseString(method, url, { ...options.params, ...oauth });
  oauth.oauth_signature = await oauthSignature(base, credentials.apiSecret, credentials.accessTokenSecret);
  return `OAuth ${Object.keys(oauth).sort().map(key => `${percentEncode(key)}="${percentEncode(oauth[key])}"`).join(", ")}`;
}
function randomNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export type XClient = {
  /** Uploads one PNG, JPEG or WebP image (tweet_image) and returns its media id. */
  uploadImage(bytes: Uint8Array, mimeType: string): Promise<string>;
  /** Creates one original post on the account: text, and the uploaded image when given. Returns the post id. */
  createPost(input: { text: string; mediaId?: string }): Promise<string>;
};
export function createXClient(credentials: XCredentials, options: { fetch?: XFetch; now?: () => number; nonce?: () => string; timeoutMs?: number } = {}): XClient {
  const send = options.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init));
  const now = options.now ?? Date.now, nonce = options.nonce ?? randomNonce, timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  async function call(path: string, body: BodyInit, contentType: string | null, step: "upload" | "post"): Promise<Record<string, unknown>> {
    const url = `${X_API}${path}`;
    const headers: Record<string, string> = { authorization: await oauthHeader(credentials, "POST", url, { nonce: nonce(), timestamp: Math.floor(now() / 1000) }), accept: "application/json" };
    if (contentType) headers["content-type"] = contentType;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      // Manual redirects: a 3xx is a failure, so the Authorization header never follows to another host.
      response = await send(url, { method: "POST", headers, body, redirect: "manual", signal: controller.signal });
    } catch {
      clearTimeout(timer);
      // An upload that failed made nothing that matters (an unused media id expires). A post whose request may have
      // reached X has an unknown outcome.
      const timedOut = controller.signal.aborted;
      throw new XApiError(`X ${step} ${timedOut ? "timed out" : "could not be reached"}`, null, step === "upload", step === "post");
    }
    let text = "";
    try { text = (await response.text()).slice(0, MAX_RESPONSE_BYTES); }
    catch { if (step === "post" && response.ok) throw new XApiError("X post answer was cut off", response.status, false, true); }
    finally { clearTimeout(timer); }
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* Not JSON: handled below. */ }
    if (!response.ok) {
      // X's own short words (title or first error), never the request or its headers.
      const errors = Array.isArray(json.errors) ? json.errors as { message?: unknown; title?: unknown }[] : [];
      const said = [json.title, json.detail, errors[0]?.title, errors[0]?.message].find(value => typeof value === "string") as string | undefined;
      // A 429 is refused before anything is made. A 5xx to the post call may come after X made the post: unknown.
      const unknown = step === "post" && response.status >= 500;
      const retryable = response.status === 429 || (response.status >= 500 && !unknown);
      throw new XApiError(`X ${step} refused (${response.status}${said ? `: ${said.slice(0, 160)}` : ""})`, response.status, retryable, unknown,
        response.status === 429 ? rateLimitResetAt(response.headers, now()) : null);
    }
    return json;
  }

  return {
    async uploadImage(bytes, mimeType) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new XApiError("X upload: unsupported image type", null, false);
      if (bytes.byteLength === 0 || bytes.byteLength > X_IMAGE_MAX_BYTES) throw new XApiError("X upload: the image is larger than X accepts", null, false);
      const form = new FormData();
      form.append("media", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }), "card");
      form.append("media_category", "tweet_image");
      const json = await call("/2/media/upload", form, null, "upload");
      const id = (json.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "string" || !/^\d{1,30}$/.test(id)) throw new XApiError("X upload answered without a media id", 200, true);
      return id;
    },
    async createPost({ text, mediaId }) {
      // Exactly these two fields: never reply, quote_tweet_id, tagged_user_ids or anything else.
      const body = JSON.stringify({ text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) });
      const json = await call("/2/tweets", body, "application/json", "post");
      const id = (json.data as { id?: unknown } | undefined)?.id;
      // The post exists but its id did not come back: unknown, never retried.
      if (typeof id !== "string" || !/^\d{1,30}$/.test(id)) throw new XApiError("X post answered without a post id", 201, false, true);
      return id;
    },
  };
}
