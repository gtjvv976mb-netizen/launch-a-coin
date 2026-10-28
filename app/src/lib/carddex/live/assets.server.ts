import { bindings } from "../../bindings.server";
import { imageSize } from "../../mintdex/server/art.server";
import { db, one, stmt, UserError } from "../../mintdex/server/db.server";
import { sha256 } from "./auth.server";
import { requireLiveConfig } from "./config.server";
import type { LiveAsset, LiveAssets } from "./types";

const EXT: Record<string, string> = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/json": "json"};
const IMMUTABLE = "public, max-age=31536000, immutable";
const MAX_BYTES = 12 * 1024 * 1024;
function metadataDigest(sha: string) { return btoa(String.fromCharCode(...sha.match(/../g)!.map(byte => parseInt(byte, 16)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export function assetUrl(sha: string, mime: string) { return mime === "application/json" ? `${requireLiveConfig().origin}/m/${metadataDigest(sha)}` : `${requireLiveConfig().origin}/api/live/assets/${sha}.${EXT[mime]}`; }
export function sniffLiveImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return null;
}
export async function putPublicAsset(wallet: string, bytes: Uint8Array, mimeType: string): Promise<LiveAsset> {
  requireLiveConfig();
  if (!EXT[mimeType] || bytes.length === 0 || bytes.length > MAX_BYTES) throw new UserError("The public asset has an unsupported format or size.");
  const hash = await sha256(bytes), key = `live/${hash}.${EXT[mimeType]}`;
  const size = mimeType === "application/json" ? null : imageSize(bytes);
  await bindings().STORAGE!.put(key, bytes, {httpMetadata: {contentType: mimeType, cacheControl: IMMUTABLE}, customMetadata: {sha256: hash}});
  await db().batch([
    stmt("INSERT OR IGNORE INTO live_assets (sha256, storage_key, mime_type, byte_length, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", hash, key, mimeType, bytes.length, size?.w ?? null, size?.h ?? null, Date.now()),
    stmt("INSERT OR IGNORE INTO live_asset_grants (wallet, sha256) VALUES (?, ?)", wallet, hash),
  ]);
  return {sha256: hash, url: assetUrl(hash, mimeType), mimeType, bytes: bytes.length};
}
export async function fetchPublicBytes(url: string, maxBytes = MAX_BYTES): Promise<Uint8Array> {
  const {origin} = requireLiveConfig();
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.search || parsed.hash || parsed.username || parsed.password) throw new UserError("Public launch assets must use the configured Launch a Card origin.");
  // Workers rejects redirect:"error" before sending a request. Manual mode keeps
  // this same-origin check intact; every 3xx fails the !ok check below.
  const response = await fetch(url, {redirect: "manual", signal: AbortSignal.timeout(15_000), headers: {accept: "image/png,image/webp,image/jpeg,application/json"}});
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
export async function serveLiveAsset(filename: string): Promise<Response> {
  if (!/^[a-f0-9]{64}\.(png|jpg|webp|json)$/.test(filename)) return new Response("Not found", {status: 404});
  const object = await bindings().STORAGE?.get(`live/${filename}`);
  if (!object) return new Response("Not found", {status: 404});
  return new Response(object.body as unknown as ReadableStream, {headers: {
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": IMMUTABLE,
    "x-content-type-options": "nosniff", "access-control-allow-origin": "*", "content-security-policy": "default-src 'none'", etag: object.httpEtag,
  }});
}
export async function serveLiveMetadata(digest: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(digest)) return new Response("Not found", {status: 404});
  try {
    const bytes = Uint8Array.from(atob(digest.replaceAll("-", "+").replaceAll("_", "/") + "="), char => char.charCodeAt(0));
    const sha = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    if (bytes.length !== 32 || metadataDigest(sha) !== digest) return new Response("Not found", {status: 404});
    return serveLiveAsset(`${sha}.json`);
  } catch { return new Response("Not found", {status: 404}); }
}
