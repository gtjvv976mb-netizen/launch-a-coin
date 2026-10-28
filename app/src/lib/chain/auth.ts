// Sign-In With Solana, the handle and media upload (refs/chain/m3-contract.md §3.2, §3.4.1). Lazy chunk: client.ts
// forwards signIn, signOut, setHandle and uploadMedia here on first use, and flows.ts imports it directly, so the
// SIWS parser and the session flows stay out of the main chunk (C10). The session store itself (memory and
// sessionStorage per wallet, never localStorage) lives in client.ts because getSession() is synchronous.
// Owner: app:wallet.

import type { ApiHandleResponse, ApiMediaResponse, ApiNonceResponse, ApiSession, ApiVerifyResponse } from "@mintdex/chain-sdk/api";
import { API_LIMITS, parseSiwsMessage } from "@mintdex/chain-sdk/api";

import { apiCall, bytesToBase64, dropSession, getSession, keepSession, sessionFor, walletFailure } from "./client";
import { ChainClientError, isChainError } from "./errors";
import { getWalletSnapshot, wallet } from "./wallet";

/**
 * POST /auth/nonce → wallet solana:signMessage over the exact returned text → POST /auth/verify. The wallet is asked
 * only for a well-formed MintDex sign-in for this wallet on this site (never a message built for another domain).
 */
export async function signIn(): Promise<ApiSession> {
  const snap = getWalletSnapshot();
  if (!snap.connected || !snap.address) throw new ChainClientError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
  if (!snap.canSignMessage) {
    throw new ChainClientError("SIGNATURE_INVALID", "This wallet cannot sign messages, so it cannot sign in.");
  }
  const address = snap.address;
  const n = await apiCall<ApiNonceResponse>("authNonce", { body: { address } });
  const f = parseSiwsMessage(n.message);
  const here = typeof location !== "undefined" ? location : null;
  if (!f || f.address !== address || (here && (f.domain !== here.host || f.uri !== here.origin))) {
    throw new ChainClientError(
      "NONCE_INVALID",
      "The sign-in message did not match this site, so MintDex did not ask your wallet to sign it.",
    );
  }
  let signature: Uint8Array;
  try {
    signature = await wallet.signMessage(new TextEncoder().encode(n.message));
  } catch (e) {
    throw walletFailure(e);
  }
  if (getWalletSnapshot().address !== address) {
    throw new ChainClientError("WALLET_NOT_CONNECTED", "The wallet account changed while signing in. Try again.");
  }
  if (signature.length !== 64) throw new ChainClientError("SIGNATURE_INVALID", "The wallet returned an unusable signature.");
  const v = await apiCall<ApiVerifyResponse>("authVerify", {
    body: { address, message: n.message, signature: bytesToBase64(signature) },
  });
  if (v.session.address !== address) throw new ChainClientError("SIGNATURE_INVALID", "The sign-in answer named another wallet.");
  keepSession(v.session);
  return v.session;
}

export async function signOut(): Promise<void> {
  const s = getSession();
  if (!s) return;
  dropSession(s.address);
  try {
    await apiCall("authLogout", { body: {}, token: s.token });
  } catch {
    // The token is already gone on this side; the server forgets it on its own after 12 h.
  }
}

/** Runs `fn` with a session token, signing in first when needed and once more if the server says it expired. */
export async function withSession<T>(fn: (token: string) => Promise<T>): Promise<T> {
  let s = getSession() ?? (await signIn());
  try {
    return await fn(s.token);
  } catch (e) {
    if (!isChainError(e, "AUTH_EXPIRED", "UNAUTHORIZED")) throw e;
    dropSession(s.address);
    s = await signIn();
    return fn(s.token);
  }
}

/** POST /wallets/handle (signs in first when needed). */
export async function setHandle(handle: string): Promise<{ address: string; handle: string }> {
  const h = handle.trim().toLowerCase();
  if (!new RegExp(API_LIMITS.handlePattern).test(h)) {
    throw new ChainClientError("HANDLE_INVALID", "Handles need 3 to 16 characters: lowercase letters, numbers or underscores.");
  }
  const r = await withSession((token) => apiCall<ApiHandleResponse>("walletHandle", { body: { handle: h }, token }));
  const s = sessionFor(r.address);
  if (s) keepSession({ ...s, handle: r.handle });
  return { address: r.address, handle: r.handle };
}

/** POST /media (signs in first when needed). */
export async function uploadMedia(file: Blob): Promise<ApiMediaResponse> {
  if (file.size > API_LIMITS.imageMaxBytes) throw new ChainClientError("IMAGE_TOO_LARGE", "Images can be up to 2 MB.");
  if (file.type && !(API_LIMITS.imageTypes as readonly string[]).includes(file.type)) {
    throw new ChainClientError("IMAGE_TYPE", "Use a PNG, JPEG, WebP or GIF image.");
  }
  return withSession((token) => {
    const form = new FormData();
    form.append("file", file, "art");
    return apiCall<ApiMediaResponse>("media", { body: form, token, timeoutMs: 60_000 });
  });
}
