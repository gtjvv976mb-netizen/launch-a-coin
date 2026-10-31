import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequestHeader, setCookie, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { UserError } from "../../mintdex/server/db.server";
import { createSignInChallenge, createWalletChallenge, deleteLiveWalletSession, LIVE_SESSION_COOKIE, liveWalletFromToken, requireLiveWallet, verifySignInChallenge, verifyWalletChallenge } from "./auth.server";
import { assertLiveOrigin, assertSiteOrigin, liveReadiness } from "./config.server";
import { clientKey, enforceAddressGate, enforceLimit, LIMITS, type LimitRule } from "./limits.server";
import * as service from "./service.server";
import { issueCardMintForSession } from "./vanity.server";
import type { LiveResult } from "./types";
import { MAX_FEE_RECIPIENTS } from "../../../../../integrations/pumpfun/src/fee-share-rules";
export type * from "./types";

/**
 * Every live action's result. A refusal (UserError) goes to the client as its message and to the log as one
 * structured line with the action's name (REL-6); anything else is logged in full and reaches the client only as a
 * generic sentence.
 */
async function attempt<T extends object>(op: string, fn: () => Promise<T>): Promise<LiveResult<T>> {
  noStore();
  try { return {ok: true, ...await fn()}; }
  catch (error) {
    if (!(error instanceof UserError)) console.error("Live launch operation failed", op, error);
    else service.logLaunchEvent("refused", {op, reason: error.message});
    return service.liveFailure(error);
  }
}
function noStore() { try { setResponseHeader("Cache-Control", "no-store"); } catch { /* No request context in isolated tests. */ } }
function revalidate() { try { setResponseHeader("Cache-Control", "no-cache"); } catch { /* No request context in isolated tests. */ } }
/** The client Cloudflare's connecting address stands for (an IPv6 address as its /64), for request limits only (stored as a keyed hash). */
function clientAddress() { try { return clientKey(getRequestHeader("cf-connecting-ip")); } catch { return null; } }
/** A state-changing live action: this site's Origin (CSRF), then the optional per-address gate. */
async function sameOrigin() { assertLiveOrigin(getRequestHeader("origin") ?? null); await enforceAddressGate(clientAddress()); }
/** Counts the request against `rules` for the connecting address. */
async function perAddress(...rules: LimitRule[]) { for (const rule of rules) await enforceLimit(rule, clientAddress()); }
function startCookie(result: {token: string; wallet: string; expiresAt: number}) {
  setCookie(LIVE_SESSION_COOKIE, result.token, {httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor((result.expiresAt - Date.now()) / 1000)});
  return {wallet: result.wallet, expiresAt: result.expiresAt};
}
const wallet = () => requireLiveWallet(getCookie(LIVE_SESSION_COOKIE));
/** The signed-in creator wallet, after counting this request against `rule` for it. */
async function signedIn(rule: LimitRule) { const {wallet: address} = await wallet(); await enforceLimit(rule, address); return address; }
const publicKey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const intentId = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const asset = z.object({sha256, url: z.string().max(2048), mimeType: z.string().max(40), bytes: z.number().int().positive().max(12 * 1024 * 1024)});
const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
// The creator fee split: 1 to MAX_FEE_RECIPIENTS wallets with whole basis points (the service checks wallets and the 100% total).
const feeShares = z.array(z.object({address: publicKey, bps: z.number().int().min(1).max(10_000)})).min(1).max(MAX_FEE_RECIPIENTS);
// Readiness is site-wide configuration, not per-user data, and /launch reads it during page SSR: revalidate it on every
// use (no-cache) rather than no-store, which would also keep the /launch page out of the back/forward cache.
export const getLiveLaunchReadiness = createServerFn({method: "GET"}).handler(() => { revalidate(); return liveReadiness(); });
export const getLiveWallet = createServerFn({method: "GET"}).handler(() => { noStore(); return liveReadiness().recoveryReady ? liveWalletFromToken(getCookie(LIVE_SESSION_COOKIE)) : null; });
export const createLiveWalletChallenge = createServerFn({method: "POST"}).validator(z.object({wallet: publicKey})).handler(({data}) => attempt("challenge", async () => {
  await sameOrigin(); return createWalletChallenge(data.wallet, clientAddress());
}));
export const verifyLiveWallet = createServerFn({method: "POST"}).validator(z.object({challengeId: intentId, wallet: publicKey, signatureBase64: z.string().max(128)})).handler(({data}) => attempt("verify", async () => {
  await sameOrigin(); await perAddress(LIMITS.verifyIp, LIMITS.sessionIp); return startCookie(await verifyWalletChallenge(data));
}));
// solana:signIn: connect and ownership in one wallet prompt. The challenge names no wallet; the session is the same.
export const createLiveSignInChallenge = createServerFn({method: "POST"}).handler(() => attempt("sign-in-challenge", async () => {
  await sameOrigin(); return createSignInChallenge(clientAddress());
}));
export const verifyLiveSignIn = createServerFn({method: "POST"}).validator(z.object({challengeId: intentId, wallet: publicKey, signedMessageBase64: z.string().min(1).max(2048), signatureBase64: z.string().max(128)})).handler(({data}) => attempt("sign-in", async () => {
  await sameOrigin(); await perAddress(LIMITS.verifyIp, LIMITS.sessionIp); return startCookie(await verifySignInChallenge(data));
}));
// Sign-out checks only this site's Origin, not the switches: a creator can always end a session, even while recovery
// is paused during an incident (SEC-7).
export const signOutLiveWallet = createServerFn({method: "POST"}).handler(() => attempt("sign-out", async () => {
  assertSiteOrigin(getRequestHeader("origin") ?? null); await deleteLiveWalletSession(getCookie(LIVE_SESSION_COOKIE)); deleteCookie(LIVE_SESSION_COOKIE, {path: "/"}); return {};
}));
export const prepareLiveLaunch = createServerFn({method: "POST"}).validator(z.object({
  idempotencyKey: z.string().min(8).max(100), tokenMint: publicKey, nftMint: publicKey,
  name: z.string().min(1).max(32), symbol: z.string().regex(/^[A-Za-z0-9]{1,13}$/), description: z.string().max(280),
  website: z.string().max(2048).optional(), xUrl: z.string().max(2048).optional(),
  // The pair names the card: a pair alone is a complete request (an older client also sends the design).
  cardTemplate: z.string().max(50).optional(), quoteAssetKey: z.string().max(30).optional(), quoteMint: publicKey.optional(),
  initialBuyQuoteBaseUnits: z.string().regex(/^(0|[1-9][0-9]{0,19})$/), slippageBps: z.number().int().min(0).max(1000),
  assets: z.object({artwork: asset, cardImage: asset, caseImage: asset}), termsAcknowledged: z.literal(true), withCard: z.boolean().optional(),
  feeShares: feeShares.optional(), announceOnX: z.boolean().optional(),
})).handler(({data}) => attempt("prepare", async () => { await sameOrigin(); await perAddress(LIMITS.prepareIp); return service.prepareLiveLaunch(await signedIn(LIMITS.prepareWallet), data); }));
// A pre-ground coin address ending in "card" for the signed-in creator's next new launch (vanity.server.ts), or null:
// not configured, an empty pool, no session, another site, a limit or any error. The page then uses a random address,
// so this can never block a launch. The response holds a secret key: never cached, never logged.
export const issueLiveCardMint = createServerFn({method: "POST"}).handler(async () => {
  noStore();
  try { await sameOrigin(); return await issueCardMintForSession(getCookie(LIVE_SESSION_COOKIE), clientAddress()); }
  catch { return null; }
});
// Each check reads the chain on the paid RPC, so it is limited per address too: wallets are free to make (SEC-R2).
export const checkLiveLaunchSize = createServerFn({method: "POST"}).validator(z.object({
  name: z.string().min(1).max(32), symbol: z.string().regex(/^[A-Za-z0-9]{1,13}$/), quoteAssetKey: z.string().max(30),
  initialBuyQuoteBaseUnits: z.string().regex(/^(0|[1-9][0-9]{0,19})$/),
})).handler(({data}) => attempt("size", async () => { await sameOrigin(); await perAddress(LIMITS.sizeIp); return service.checkLiveLaunchSize(await signedIn(LIMITS.sizeWallet), data); }));
export const getLiveLaunchIntent = createServerFn({method: "GET"}).validator(z.object({intentId})).handler(({data}) => attempt("read", async () => ({intent: await service.getLiveLaunchIntent(await signedIn(LIMITS.readWallet), data.intentId)})));
export const listLiveLaunchIntents = createServerFn({method: "GET"}).handler(() => attempt("list", async () => ({intents: await service.listLiveLaunchIntents(await signedIn(LIMITS.readWallet))})));
export const abandonLiveLaunchIntent = createServerFn({method: "POST"}).validator(z.object({intentId})).handler(({data}) => attempt("abandon", async () => {
  await sameOrigin(); return service.abandonLiveLaunchIntent(await signedIn(LIMITS.abandonWallet), data);
}));
export const confirmLiveToken = createServerFn({method: "POST"}).validator(z.object({intentId, signature, messageSha256: sha256.optional()})).handler(({data}) => attempt("confirm-coin", async () => {
  await sameOrigin(); return service.confirmLiveToken(await signedIn(LIMITS.confirmWallet), data);
}));
export const prepareLiveCreatorNft = createServerFn({method: "POST"}).validator(z.object({intentId, nftMint: publicKey.optional()})).handler(({data}) => attempt("prepare-card", async () => {
  await sameOrigin(); return service.prepareLiveCreatorNft(await signedIn(LIMITS.prepareCardWallet), data);
}));
export const confirmLiveCreatorNft = createServerFn({method: "POST"}).validator(z.object({intentId, signature, messageSha256: sha256.optional()})).handler(({data}) => attempt("confirm-card", async () => {
  await sameOrigin(); return service.confirmLiveCreatorNft(await signedIn(LIMITS.confirmWallet), data);
}));
// walletName and signingOrder only label the server log line; no check depends on them.
const walletName = z.string().min(1).max(64);
export const submitLiveTransaction = createServerFn({method: "POST"}).validator(z.object({intentId, kind: z.enum(["token", "nft"]), messageSha256: sha256, transactionBase64: z.string().min(80).max(4000),
  walletName: walletName.optional(), signingOrder: z.enum(["wallet-first", "page-first"]).optional()})).handler(({data}) => attempt("submit", async () => {
  await sameOrigin(); return service.submitLiveTransaction(await signedIn(LIMITS.submitWallet), data);
}));
// The card approved with its coin in one prompt, saved before the coin is sent; relayed by submitLiveTransaction later.
export const holdLiveCard = createServerFn({method: "POST"}).validator(z.object({intentId, messageSha256: sha256, transactionBase64: z.string().min(80).max(4000),
  walletName: walletName.optional(), signingOrder: z.enum(["wallet-first", "page-first"]).optional()})).handler(({data}) => attempt("hold-card", async () => {
  await sameOrigin(); return service.holdLiveCard(await signedIn(LIMITS.submitWallet), data);
}));
export const reportLiveWalletChange = createServerFn({method: "POST"}).validator(z.object({intentId, kind: z.enum(["token", "nft"]), messageSha256: sha256, walletName, transactionBase64: z.string().min(1).max(4000)})).handler(({data}) => attempt("report", async () => {
  await sameOrigin(); return service.reportLiveWalletChange(await signedIn(LIMITS.reportWallet), data);
}));
// The creator fee split after the card: its own creator-only transaction (CARDDEX_LIVE_FEE_SHARING), or "keep 100%".
export const prepareLiveFeeShare = createServerFn({method: "POST"}).validator(z.object({intentId})).handler(({data}) => attempt("prepare-fees", async () => {
  await sameOrigin(); return service.prepareLiveFeeShare(await signedIn(LIMITS.prepareCardWallet), data);
}));
export const submitLiveFeeShare = createServerFn({method: "POST"}).validator(z.object({intentId, messageSha256: sha256, transactionBase64: z.string().min(80).max(4000),
  walletName: walletName.optional()})).handler(({data}) => attempt("submit-fees", async () => {
  await sameOrigin(); return service.submitLiveFeeShare(await signedIn(LIMITS.submitWallet), data);
}));
export const confirmLiveFeeShare = createServerFn({method: "POST"}).validator(z.object({intentId, signature})).handler(({data}) => attempt("confirm-fees", async () => {
  await sameOrigin(); return service.confirmLiveFeeShare(await signedIn(LIMITS.confirmWallet), data);
}));
export const skipLiveFeeShare = createServerFn({method: "POST"}).validator(z.object({intentId})).handler(({data}) => attempt("skip-fees", async () => {
  await sameOrigin(); return service.skipLiveFeeShare(await signedIn(LIMITS.abandonWallet), data);
}));
