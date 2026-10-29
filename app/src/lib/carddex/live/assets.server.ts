import { bindings } from "../../bindings.server";
import { imageSize } from "../../mintdex/server/art.server";
import { db, one, stmt, UserError } from "../../mintdex/server/db.server";
import { liveTokenFromRequest, liveWalletFromToken, sha256 } from "./auth.server";
import { publicOrigin, requireLiveConfig } from "./config.server";
import type { LiveAsset, LiveAssets } from "./types";

const EXT: Record<string, string> = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/json": "json"};
const IMMUTABLE = "public, max-age=31536000, immutable";
/** How long a saved launch's assets are public before its coin is signed: its wallet approval (SEC-R5). */
export const PREVIEW_MS = 3_600_000;
/** While public only for an approval, caches keep a copy for minutes, not a year. */
const PREVIEW_CACHE = "public, max-age=300";
const MAX_BYTES = 12 * 1024 * 1024;
function metadataDigest(sha: string) { return btoa(String.fromCharCode(...sha.match(/../g)!.map(byte => parseInt(byte, 16)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export function assetUrl(sha: string, mime: string) { return mime === "application/json" ? `${requireLiveConfig("launch").origin}/m/${metadataDigest(sha)}` : `${requireLiveConfig("launch").origin}/api/live/assets/${sha}.${EXT[mime]}`; }
/** Same length as every real token metadata URI: the origin, /m/ and a 43-character digest. */
export function metadataUriPlaceholder() { return assetUrl("0".repeat(64), "application/json"); }
export function sniffLiveImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return null;
}
/**
 * Stores a content-addressed launch asset. Bytes already stored under the same hash are not written again (a retried
 * prepare or compose re-uploads nothing), only granted to this wallet. A new asset is not public yet (published_at 0):
 * a saved launch makes it public for its wallet approval (previewLaunchAssets) and its signed coin permanently
 * (publishLaunchAssets); until then only this Worker's own verification read can fetch it.
 */
export async function putPublicAsset(wallet: string, bytes: Uint8Array, mimeType: string): Promise<LiveAsset> {
  requireLiveConfig("launch");
  if (!EXT[mimeType] || bytes.length === 0 || bytes.length > MAX_BYTES) throw new UserError("The public asset has an unsupported format or size.");
  const hash = await sha256(bytes), key = `live/${hash}.${EXT[mimeType]}`;
  const size = mimeType === "application/json" ? null : imageSize(bytes);
  const known = await one<{storage_key: string}>("SELECT storage_key FROM live_assets WHERE sha256 = ?", hash);
  if (!(known?.storage_key === key && await bindings().STORAGE!.head(key))) {
    await bindings().STORAGE!.put(key, bytes, {httpMetadata: {contentType: mimeType, cacheControl: IMMUTABLE}, customMetadata: {sha256: hash}});
  }
  await db().batch([
    stmt("INSERT OR IGNORE INTO live_assets (sha256, storage_key, mime_type, byte_length, width, height, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)", hash, key, mimeType, bytes.length, size?.w ?? null, size?.h ?? null, Date.now()),
    stmt("INSERT OR IGNORE INTO live_asset_grants (wallet, sha256) VALUES (?, ?)", wallet, hash),
  ]);
  return {sha256: hash, url: assetUrl(hash, mimeType), mimeType, bytes: bytes.length};
}
/** The digest in a /m/ metadata URI back to the metadata's sha256 (hex), or null when it is not one. */
export function metadataShaFromUri(uri: string): string | null {
  const digest = /\/m\/([A-Za-z0-9_-]{43})$/.exec(uri)?.[1];
  if (!digest) return null;
  try {
    const bytes = Uint8Array.from(atob(digest.replaceAll("-", "+").replaceAll("_", "/") + "="), char => char.charCodeAt(0));
    const sha = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return bytes.length === 32 && metadataDigest(sha) === digest ? sha : null;
  } catch { return null; }
}
const shaList = (shas: string[]) => [...new Set(shas.filter(sha => /^[a-f0-9]{64}$/.test(sha)))];
/**
 * Makes a launch's assets public for good, in the batch that saves its signed coin transaction (before it is sent) or
 * records its coin from the chain: everything the coin and card metadata point to is served to anyone (wallets,
 * pump.fun, explorers) from then on and never unpublished. Idempotent.
 */
export function publishLaunchAssets(shas: string[], now: number) {
  const list = shaList(shas);
  if (!list.length) return stmt("SELECT 1");
  return stmt(`UPDATE live_assets SET published_at = ? WHERE COALESCE(published_at, 0) = 0 AND sha256 IN (${list.map(() => "?").join(", ")})`, now, ...list);
}
/**
 * Makes a newly saved launch's assets public for its wallet approval (PREVIEW_MS), in the batch that saves the launch,
 * so a wallet can show the coin's image in its prompt. A launch whose coin is never signed stops being served once the
 * window ends: preparing a launch costs no SOL, so it never publishes anything for good (SEC-R5).
 */
export function previewLaunchAssets(shas: string[], now: number) {
  const list = shaList(shas);
  if (!list.length) return stmt("SELECT 1");
  return stmt(`UPDATE live_assets SET public_until = MAX(COALESCE(public_until, 0), ?) WHERE published_at = 0 AND sha256 IN (${list.map(() => "?").join(", ")})`, now + PREVIEW_MS, ...list);
}
/** The header this Worker's own verification read carries to fetch an asset no launch has published yet. */
const ASSET_CHECK_HEADER = "x-launch-a-card-asset-check";
let assetCheckKey: Promise<string> | undefined;
/** A random server-only key, created once per deployment in D1 and cached per isolate. Never sent to a browser. */
function assetCheck(): Promise<string> {
  assetCheckKey ??= (async () => {
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    await stmt("INSERT OR IGNORE INTO live_settings (key, value) VALUES ('asset_check_key', ?)", fresh).run();
    const row = await one<{value: string}>("SELECT value FROM live_settings WHERE key = 'asset_check_key'");
    if (!row?.value) throw new Error("The asset check key is missing");
    return row.value;
  })().catch(error => { assetCheckKey = undefined; throw error; });
  return assetCheckKey;
}
async function isAssetCheck(request: Request | undefined) {
  const sent = request?.headers.get(ASSET_CHECK_HEADER);
  if (!sent) return false;
  const key = await assetCheck().catch(() => null);
  if (!key || sent.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ sent.charCodeAt(i);
  return diff === 0;
}
/** Behind Cloudflare for SaaS this Worker runs on a zone route, and a routed Worker cannot fetch() its own zone.
 * Static files come straight from ASSETS, Worker-served paths (/m/, /api/live/assets/) through the SELF service
 * binding; plain fetch only where neither binding exists (local dev). */
export function fetchOwnOrigin(url: string, init: RequestInit): Promise<Response> {
  const {ASSETS, SELF} = bindings();
  if (ASSETS && new URL(url).pathname.startsWith("/assets/")) return ASSETS.fetch(url, init as never) as unknown as Promise<Response>;
  if (SELF) return SELF.fetch(url, init as never) as unknown as Promise<Response>;
  return fetch(url, init);
}
/** Opt-in production probe (/api/live/health?self=1) that both own-origin paths answer before a DNS cutover. */
export async function selfCheck(): Promise<Response> {
  const origin = publicOrigin(bindings().CARDDEX_PUBLIC_ORIGIN);
  if (!origin) return Response.json({ok: false, reason: "no public origin"}, {status: 503, headers: {"cache-control": "no-store"}});
  const probe = async (path: string) => {
    try { const r = await fetchOwnOrigin(`${origin}${path}`, {redirect: "manual", signal: AbortSignal.timeout(8_000)}); await r.arrayBuffer(); return r.status; }
    catch { return 0; }
  };
  const [assets, worker] = await Promise.all([probe("/assets/brand/carddex.svg"), probe("/robots.txt")]);
  return Response.json({ok: assets === 200 && worker === 200, self: Boolean(bindings().SELF), assets, worker}, {headers: {"cache-control": "no-store"}});
}
export async function fetchPublicBytes(url: string, maxBytes = MAX_BYTES): Promise<Uint8Array> {
  const {origin} = requireLiveConfig("launch");
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.search || parsed.hash || parsed.username || parsed.password) throw new UserError("Public launch assets must use the configured Launch a Card origin.");
  // Workers rejects redirect:"error" before sending a request. Manual mode keeps
  // this same-origin check intact; every 3xx fails the !ok check below. Launch assets not yet published are read with
  // this Worker's own check key, which goes only to this configured origin.
  const headers: Record<string, string> = {accept: "image/png,image/webp,image/jpeg,application/json"};
  if (/^\/(?:m|api\/live\/assets)\//.test(parsed.pathname)) headers[ASSET_CHECK_HEADER] = await assetCheck();
  const response = await fetchOwnOrigin(url, {redirect: "manual", signal: AbortSignal.timeout(15_000), headers});
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new UserError("A public launch asset is not reachable or exceeds the size limit.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new UserError("A public launch asset exceeds the size limit.");
  return bytes;
}
export async function validateOwnedAsset(wallet: string, asset: LiveAsset, role: keyof LiveAssets) {
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new UserError("Invalid public asset hash.");
  const stored = await one<{storage_key: string; mime_type: string; byte_length: number; width: number; height: number}>("SELECT a.* FROM live_assets a JOIN live_asset_grants g ON a.sha256 = g.sha256 WHERE g.wallet = ? AND a.sha256 = ?", wallet, asset.sha256);
  if (!stored || asset.url !== assetUrl(asset.sha256, stored.mime_type) || asset.bytes !== stored.byte_length || asset.mimeType !== stored.mime_type || !stored.mime_type.startsWith("image/")) throw new UserError("Use the unchanged images uploaded by this creator wallet.");
  if (role === "cardImage" && (stored.width < 630 || stored.height < 880 || Math.abs(stored.width / stored.height - 63 / 88) > .01)) throw new UserError("The card print does not match the canonical card proportions.");
  const obj = await bindings().STORAGE!.get(stored.storage_key);
  if (!obj || await sha256(new Uint8Array(await obj.arrayBuffer())) !== asset.sha256) throw new UserError("The stored launch image does not match its commitment.");
  if (await sha256(await fetchPublicBytes(asset.url)) !== asset.sha256) throw new UserError("The public launch image does not match its committed content.");
}
export async function putPublicJson(wallet: string, value: unknown): Promise<LiveAsset> {
  return putPublicAsset(wallet, new TextEncoder().encode(JSON.stringify(value)), "application/json");
}
export async function verifyPublicJson(asset: LiveAsset, expected: unknown) {
  const bytes = await fetchPublicBytes(asset.url, 1024 * 1024);
  if (await sha256(bytes) !== asset.sha256 || new TextDecoder().decode(bytes) !== JSON.stringify(expected)) throw new UserError("The public metadata does not match this immutable launch.");
}
/** The signed-in creator who uploaded this asset (its grant), reading it in their own browser: a saved draft's preview. */
async function isOwnerRead(request: Request | undefined, sha: string) {
  const token = request ? liveTokenFromRequest(request) : null;
  const session = token ? await liveWalletFromToken(token) : null;
  return !!session && !!await one<{ok: number}>("SELECT 1 AS ok FROM live_asset_grants WHERE wallet = ? AND sha256 = ?", session.wallet, sha);
}
// Not cached anywhere: an asset that is not public yet may be published a moment later.
const notFound = () => new Response("Not found", {status: 404, headers: {"cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox"}});
/**
 * GET /api/live/assets/<sha>.<ext> (and /m/<digest>). A published asset is public, immutable and readable from any
 * origin; so is a row an older Worker stored before the publish gate existed (published_at NULL: everything stored
 * before migration 0014, and anything an older Worker still running stored after it, F2). One in its launch's approval
 * window is public with a short cache. Anything else is served only, uncached, to this Worker's own verification read
 * and to the signed-in creator who uploaded it; anyone else gets 404. A D1 outage serves stored bytes as public rather than taking every launched coin's image
 * offline.
 */
export async function serveLiveAsset(filename: string, request?: Request, now = Date.now()): Promise<Response> {
  if (!/^[a-f0-9]{64}\.(png|jpg|webp|json)$/.test(filename)) return notFound();
  let access: "public" | "preview" | "check" = "public";
  try {
    const row = await one<{published_at: number | null; public_until: number | null}>("SELECT published_at, public_until FROM live_assets WHERE sha256 = ?", filename.slice(0, 64));
    if (!row) return notFound();
    access = row.published_at === null || row.published_at > 0 ? "public" : (row.public_until ?? 0) > now ? "preview" : "check";
    if (access === "check" && !await isAssetCheck(request) && !await isOwnerRead(request, filename.slice(0, 64))) return notFound();
  } catch { /* D1 unavailable: serve below. */ }
  const object = await bindings().STORAGE?.get(`live/${filename}`);
  if (!object) return notFound();
  return new Response(object.body as unknown as ReadableStream, {headers: {
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": access === "public" ? IMMUTABLE : access === "preview" ? PREVIEW_CACHE : "no-store",
    "x-content-type-options": "nosniff", ...(access !== "check" ? {"access-control-allow-origin": "*"} : {}),
    "content-security-policy": "default-src 'none'; sandbox", etag: object.httpEtag,
  }});
}
export async function serveLiveMetadata(digest: string, request?: Request): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(digest)) return notFound();
  const sha = metadataShaFromUri(`/m/${digest}`);
  return sha ? serveLiveAsset(`${sha}.json`, request) : notFound();
}
