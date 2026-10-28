import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequestHeader, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { UserError } from "../../mintdex/server/db.server";
import { createWalletChallenge, deleteLiveWalletSession, LIVE_SESSION_COOKIE, liveWalletFromToken, requireLiveWallet, verifyWalletChallenge } from "./auth.server";
import { assertLiveOrigin, liveReadiness } from "./config.server";
import * as service from "./service.server";
import type { LiveResult } from "./types";
export type * from "./types";

async function attempt<T extends object>(fn: () => Promise<T>): Promise<LiveResult<T>> {
  noStore();
  try { return {ok: true, ...await fn()}; }
  catch (error) {
    if (!(error instanceof UserError)) console.error("Live launch operation failed", error);
    return {ok: false, error: error instanceof UserError ? error.message : "The real launch could not proceed. Your demo balances were not used."};
  }
}
function noStore() { try { setResponseHeader("Cache-Control", "no-store"); } catch { /* No request context in isolated tests. */ } }
function revalidate() { try { setResponseHeader("Cache-Control", "no-cache"); } catch { /* No request context in isolated tests. */ } }
function sameOrigin() { assertLiveOrigin(getRequestHeader("origin") ?? null); }
const wallet = () => requireLiveWallet(getCookie(LIVE_SESSION_COOKIE));
const publicKey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const intentId = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const asset = z.object({sha256, url: z.string().max(2048), mimeType: z.string().max(40), bytes: z.number().int().positive().max(12 * 1024 * 1024)});
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
// Readiness is site-wide configuration, not per-user data, and /launch reads it during page SSR: revalidate it on every
// use (no-cache) rather than no-store, which would also keep the /launch page out of the back/forward cache.
export const getLiveLaunchReadiness = createServerFn({method: "GET"}).handler(() => { revalidate(); return liveReadiness(); });
export const getLiveWallet = createServerFn({method: "GET"}).handler(() => { noStore(); return liveReadiness().recoveryReady ? liveWalletFromToken(getCookie(LIVE_SESSION_COOKIE)) : null; });
export const createLiveWalletChallenge = createServerFn({method: "POST"}).validator(z.object({wallet: publicKey})).handler(({data}) => attempt(async () => {
  sameOrigin(); return createWalletChallenge(data.wallet);
}));
export const verifyLiveWallet = createServerFn({method: "POST"}).validator(z.object({challengeId: intentId, wallet: publicKey, signatureBase64: z.string().max(128)})).handler(({data}) => attempt(async () => {
  sameOrigin(); const result = await verifyWalletChallenge(data);
  setCookie(LIVE_SESSION_COOKIE, result.token, {httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor((result.expiresAt - Date.now()) / 1000)});
  return {wallet: result.wallet, expiresAt: result.expiresAt};
}));
export const signOutLiveWallet = createServerFn({method: "POST"}).handler(() => attempt(async () => {
  sameOrigin(); await deleteLiveWalletSession(getCookie(LIVE_SESSION_COOKIE)); deleteCookie(LIVE_SESSION_COOKIE, {path: "/"}); return {};
}));
export const prepareLiveLaunch = createServerFn({method: "POST"}).validator(z.object({
  idempotencyKey: z.string().min(8).max(100), tokenMint: publicKey, nftMint: publicKey,
  name: z.string().min(1).max(32), symbol: z.string().regex(/^[A-Za-z0-9]{1,13}$/), description: z.string().max(280),
  website: z.string().max(2048).optional(), xUrl: z.string().max(2048).optional(),
  cardTemplate: z.string().max(50), quoteAssetKey: z.string().max(30), quoteMint: publicKey,
  initialBuyQuoteBaseUnits: z.string().regex(/^(0|[1-9][0-9]{0,19})$/), slippageBps: z.number().int().min(0).max(1000),
  assets: z.object({artwork: asset, cardImage: asset, caseImage: asset}), termsAcknowledged: z.literal(true),
})).handler(({data}) => attempt(async () => { sameOrigin(); return service.prepareLiveLaunch((await wallet()).wallet, data); }));
export const getLiveLaunchIntent = createServerFn({method: "GET"}).validator(z.object({intentId})).handler(({data}) => attempt(async () => ({intent: await service.getLiveLaunchIntent((await wallet()).wallet, data.intentId)})));
export const listLiveLaunchIntents = createServerFn({method: "GET"}).handler(() => attempt(async () => ({intents: await service.listLiveLaunchIntents((await wallet()).wallet)})));
export const abandonLiveLaunchIntent = createServerFn({method: "POST"}).validator(z.object({intentId})).handler(({data}) => attempt(async () => {
  sameOrigin(); return service.abandonLiveLaunchIntent((await wallet()).wallet, data);
}));
export const confirmLiveToken = createServerFn({method: "POST"}).validator(z.object({intentId, signature, messageSha256: sha256.optional()})).handler(({data}) => attempt(async () => {
  sameOrigin(); return service.confirmLiveToken((await wallet()).wallet, data);
}));
export const prepareLiveCreatorNft = createServerFn({method: "POST"}).validator(z.object({intentId, nftMint: publicKey.optional()})).handler(({data}) => attempt(async () => {
  sameOrigin(); return service.prepareLiveCreatorNft((await wallet()).wallet, data);
}));
export const confirmLiveCreatorNft = createServerFn({method: "POST"}).validator(z.object({intentId, signature, messageSha256: sha256.optional()})).handler(({data}) => attempt(async () => {
  sameOrigin(); return service.confirmLiveCreatorNft((await wallet()).wallet, data);
}));
export const submitLiveTransaction = createServerFn({method: "POST"}).validator(z.object({intentId, kind: z.enum(["token", "nft"]), messageSha256: sha256, transactionBase64: z.string().min(80).max(4000)})).handler(({data}) => attempt(async () => {
  sameOrigin(); return service.submitLiveTransaction((await wallet()).wallet, data);
}));
