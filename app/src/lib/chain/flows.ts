// Every devnet transaction flow (refs/chain/m3-contract.md §7.1): build → verify → sign → compare → submit → confirm.
// Lazy chunk: client.ts imports it on the first transaction (with verify.ts, trust.ts, the SDK and noble). Owner:
// app:wallet.
//
//   1. build: POST /tx/:kind (or /launch/prepare) with what the user typed (amounts as decimal strings);
//   2. verify: verify.ts on the exact bytes; any failure throws VERIFY_FAILED and the wallet never opens (C8);
//   3. sign: solana:signTransaction with chain "solana:devnet" (the host refuses accounts without devnet);
//   4. compare: if the wallet returned other message bytes, re-verify them guard-tolerantly (same intent, compute
//      budget within limits, same blockhash and fee payer) or stop with VERIFY_FAILED;
//   5. submit: POST /tx/submit (launch: /launch/finalize). On WALLET_REWROTE_TX only bytes that passed step 4 go to the
//      public devnet RPC directly; unverified wallet output is never broadcast;
//   6. confirm: poll /tx/status (or getSignatureStatuses on the public RPC) until confirmed, failed, or the blockhash
//      expired (CONFIRM_TIMEOUT: the tx may still land, the UI says so).

import { bytesEqual, decodeTransaction, type DecodedTransaction } from "@mintdex/chain-sdk";
import {
  API_LIMITS,
  type ApiLaunchFinalizeResponse,
  type ApiLaunchPrepareRequest,
  type ApiLaunchPrepareResponse,
  type ApiSellerFloorInput,
  type ApiSigningMode,
  type ApiTxKind,
  type ApiTxRequestMap,
} from "@mintdex/chain-sdk/api";

import { signIn, uploadMedia, withSession } from "./auth";
import {
  apiCall,
  buildTx,
  bytesToBase64,
  getLaunchStatus,
  getSession,
  getTxStatus,
  submitTx,
  walletFailure,
  type BuyInput,
  type LaunchInput,
  type LaunchResult,
  type OnTxStep,
  type SellInput,
  type TxResult,
  type VerifyOutcome,
} from "./client";
import { APP_CLUSTER, NET_NAME, ON_NET, TRUST_ANCHORS } from "./env";
import { ChainClientError, isChainError, isFeesBelowFloor } from "./errors";
import { assertCluster, publicRpc, readSellerFloor } from "./trust";
import { base64ToBytes, checkPrepared, prepareLaunchVerification, prepareVerification, type Prepared } from "./verify";
import { getWalletSnapshot, wallet } from "./wallet";
import { getWalletMode, rememberWalletFirst } from "./wallet-modes";

/** Poll cadence (tests shorten it). */
export const FLOW_TIMING = { pollMs: 1_000, slowPollMs: 2_000, slowAfterMs: 30_000, indexWaitMs: 30_000 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- guards

function requireWallet(): { address: string; walletName: string | null } {
  const s = getWalletSnapshot();
  if (!s.connected || !s.address) throw new ChainClientError("WALLET_NOT_CONNECTED", "Connect a wallet first.");
  if (!s.clusterOk) throw new ChainClientError("WRONG_NETWORK", `This wallet account is not on Solana ${APP_CLUSTER}.`);
  return { address: s.address, walletName: s.walletName };
}


function lamports(v: bigint, what: string): string {
  if (typeof v !== "bigint" || v <= 0n) throw new ChainClientError("INVALID_AMOUNT", `Enter ${what} above zero.`);
  return v.toString();
}

function slippage(bps: number): number {
  if (!Number.isInteger(bps) || bps < 0 || bps > API_LIMITS.slippageMaxBps) {
    throw new ChainClientError("INVALID_SLIPPAGE", "Slippage can be 0% to 20%.");
  }
  return bps;
}

function decodeTx(b64: string): Uint8Array {
  try {
    return base64ToBytes(b64);
  } catch {
    throw new ChainClientError("VERIFY_FAILED", "The chain API sent a transaction MintDex cannot read.", {
      verifyErrors: ["transaction is not base64"],
    });
  }
}

function verifyFailed(out: VerifyOutcome, afterWallet = false): ChainClientError {
  return new ChainClientError(
    "VERIFY_FAILED",
    afterWallet
      ? "Your wallet changed the transaction after MintDex checked it, so it was not sent."
      : "MintDex stopped this transaction before your wallet opened: it did not match what you asked for.",
    { verifyErrors: [...out.errors, ...out.mismatches] },
  );
}

/** Wallet signs; if the message bytes changed, they must pass the guard-tolerant re-verification. */
async function signAndCheck(
  unsigned: Uint8Array,
  prepared: Prepared,
  address: string,
): Promise<{ signed: Uint8Array; rewritten: boolean }> {
  if (getWalletSnapshot().address !== address) {
    throw new ChainClientError("WALLET_NOT_CONNECTED", "The wallet account changed. Try again.");
  }
  let signed: Uint8Array;
  try {
    signed = await wallet.signTransaction(unsigned);
  } catch (e) {
    throw walletFailure(e);
  }
  let before: DecodedTransaction;
  let after: DecodedTransaction;
  try {
    before = decodeTransaction(unsigned);
    after = decodeTransaction(signed);
  } catch {
    throw new ChainClientError("VERIFY_FAILED", "The wallet returned a transaction MintDex cannot read, so it was not sent.", {
      verifyErrors: ["unreadable signed transaction"],
    });
  }
  if (bytesEqual(before.message.bytes, after.message.bytes)) return { signed, rewritten: false };
  const out = checkPrepared(signed, prepared, before);
  if (!out.ok) throw verifyFailed(out, true);
  return { signed, rewritten: true };
}

// ---------------------------------------------------------------- confirmation

function confirmTimeout(): ChainClientError {
  return new ChainClientError("CONFIRM_TIMEOUT", "Not confirmed before the transaction expired. It may still land.");
}

/** A Custom program error code inside a transaction error ({ InstructionError: [i, { Custom: n }] }). */
function customCode(err: unknown): number | null {
  const ie = (err as { InstructionError?: unknown } | null)?.InstructionError;
  if (!Array.isArray(ie) || ie.length < 2) return null;
  const c = (ie[1] as { Custom?: unknown } | null)?.Custom;
  return typeof c === "number" ? c : null;
}

function txFailed(err: unknown): ChainClientError {
  if (customCode(err) === 6035) {
    const message = "The card's fees changed while you signed.";
    return new ChainClientError("FEES_BELOW_FLOOR", message, {
      apiError: {
        code: "FEES_BELOW_FLOOR",
        message,
        programError: { program: TRUST_ANCHORS.programId, code: 6035, name: "FeesBelowFloor" },
      },
    });
  }
  return new ChainClientError("SEND_FAILED", `The transaction failed ${ON_NET}.`);
}

const TRANSIENT = ["NETWORK", "RATE_LIMITED", "RPC_UNAVAILABLE", "INTERNAL"] as const;

async function confirmIntent(intentId: string, expiresAt: number): Promise<number | null> {
  const start = Date.now();
  const deadline = Math.max(start + 75_000, expiresAt * 1000 + 30_000);
  for (;;) {
    await sleep(Date.now() - start > FLOW_TIMING.slowAfterMs ? FLOW_TIMING.slowPollMs : FLOW_TIMING.pollMs);
    try {
      const st = await getTxStatus(intentId);
      if (st.status === "confirmed") return st.slot;
      if (st.status === "failed") throw txFailed(st.err);
      if (st.status === "expired") throw confirmTimeout();
    } catch (e) {
      if (!isChainError(e, ...TRANSIENT)) throw e;
    }
    if (Date.now() > deadline) throw confirmTimeout();
  }
}

/** Only for re-verified wallet-rewritten bytes the Worker would not relay (WALLET_REWROTE_TX). */
async function broadcastPublic(b64: string): Promise<string> {
  await assertCluster();
  try {
    return await publicRpc<string>("sendTransaction", [
      b64,
      { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 },
    ]);
  } catch {
    throw new ChainClientError("SEND_FAILED", `${NET_NAME} did not accept the transaction.`);
  }
}

async function confirmPublic(signature: string, lastValidBlockHeight: number): Promise<number | null> {
  const start = Date.now();
  for (let i = 0; ; i++) {
    await sleep(Date.now() - start > FLOW_TIMING.slowAfterMs ? FLOW_TIMING.slowPollMs : FLOW_TIMING.pollMs);
    try {
      const st = await publicRpc<{ value: Array<{ err: unknown; confirmationStatus?: string; slot?: number } | null> }>(
        "getSignatureStatuses",
        [[signature]],
      );
      const s = st?.value?.[0];
      if (s?.err) throw txFailed(s.err);
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return s.slot ?? null;
      if (i % 5 === 4) {
        const h = await publicRpc<number>("getBlockHeight", [{ commitment: "confirmed" }]);
        if (typeof h === "number" && h > lastValidBlockHeight) throw confirmTimeout();
      }
    } catch (e) {
      if (!isChainError(e, "RPC_UNAVAILABLE")) throw e;
    }
    if (Date.now() - start > 120_000) throw confirmTimeout();
  }
}

// ---------------------------------------------------------------- the generic flow

async function runTx<K extends ApiTxKind>(
  kind: K,
  makeRequest: (wallet: string) => ApiTxRequestMap[K] | Promise<ApiTxRequestMap[K]>,
  onStep?: OnTxStep,
): Promise<TxResult> {
  const { address } = requireWallet();
  onStep?.({ step: "building" });
  const request = await makeRequest(address);
  const build = await buildTx(kind, request);
  const base = { intentId: build.intentId, summary: build.summary };
  onStep?.({ step: "verifying", ...base });
  const prepared = await prepareVerification(kind, request, build);
  const unsigned = decodeTx(build.tx);
  const out = checkPrepared(unsigned, prepared);
  if (!out.ok) throw verifyFailed(out);
  onStep?.({ step: "signing", ...base });
  const { signed, rewritten } = await signAndCheck(unsigned, prepared, address);
  onStep?.({ step: "submitting", ...base });
  const b64 = bytesToBase64(signed);
  let signature: string;
  let viaPublic = false;
  try {
    signature = (await submitTx(build.intentId, b64)).signature;
  } catch (e) {
    if (!(rewritten && isChainError(e, "WALLET_REWROTE_TX"))) throw e;
    signature = await broadcastPublic(b64);
    viaPublic = true;
  }
  onStep?.({ step: "confirming", ...base, signature });
  const slot = viaPublic
    ? await confirmPublic(signature, build.lastValidBlockHeight)
    : await confirmIntent(build.intentId, build.expiresAt);
  onStep?.({ step: "confirmed", ...base, signature });
  return { ...base, signature, slot };
}

/** FEES_BELOW_FLOOR (6035): rebuild once with fresh reads and ask the seller to sign again (§3.6). */
async function withFloorRetry(run: () => Promise<TxResult>): Promise<TxResult> {
  try {
    return await run();
  } catch (e) {
    if (!isFeesBelowFloor(e)) throw e;
    return run();
  }
}

/** NEEDS_COLLECT: sweep the extra fee accounts with collect batches (≤ 8 each), then build the sale again. */
async function withCollect(mint: string, onStep: OnTxStep | undefined, run: () => Promise<TxResult>): Promise<TxResult> {
  for (let round = 0; ; round++) {
    try {
      return await run();
    } catch (e) {
      if (!isChainError(e, "NEEDS_COLLECT") || round >= 3) throw e;
      await runTx("collect", (w) => ({ wallet: w, mint }), onStep);
    }
  }
}

/** The seller's own fee floor from the public RPC (never the Worker's), sent with accept and list builds. */
async function sellerFloorInput(mint: string): Promise<ApiSellerFloorInput> {
  try {
    const f = await readSellerFloor(mint);
    return { minFeesToSellerLamports: f.floor.toString(), extraWsolAccounts: f.extraWsolAccounts };
  } catch (e) {
    if (isChainError(e, "WRONG_NETWORK")) throw e;
    throw new ChainClientError(
      "RPC_UNAVAILABLE",
      `Could not read the card's fees from ${NET_NAME}, so MintDex cannot protect your sale. Try again in a moment.`,
    );
  }
}

// ---------------------------------------------------------------- trades and fees

export function buy(input: BuyInput, onStep?: OnTxStep): Promise<TxResult> {
  return runTx(
    "buy",
    (w) => ({ wallet: w, mint: input.mint, solLamports: lamports(input.solLamports, "an amount"), slippageBps: slippage(input.slippageBps) }),
    onStep,
  );
}

export function sell(input: SellInput, onStep?: OnTxStep): Promise<TxResult> {
  return runTx(
    "sell",
    (w) => ({ wallet: w, mint: input.mint, tokenAmount: lamports(input.tokenAmount, "an amount"), slippageBps: slippage(input.slippageBps) }),
    onStep,
  );
}

export function completeCurve(input: { mint: string; slippageBps: number }, onStep?: OnTxStep): Promise<TxResult> {
  return runTx("complete-curve", (w) => ({ wallet: w, mint: input.mint, slippageBps: slippage(input.slippageBps) }), onStep);
}

export function withdrawFees(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return withCollect(input.mint, onStep, () => runTx("withdraw", (w) => ({ wallet: w, mint: input.mint }), onStep));
}

export function collectFees(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return runTx("collect", (w) => ({ wallet: w, mint: input.mint }), onStep);
}

// ---------------------------------------------------------------- the card market

export function placeBid(input: { mint: string; amountLamports: bigint }, onStep?: OnTxStep): Promise<TxResult> {
  return runTx("bid", (w) => ({ wallet: w, mint: input.mint, amountLamports: lamports(input.amountLamports, "a bid") }), onStep);
}

export function cancelBid(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return runTx("cancel-bid", (w) => ({ wallet: w, mint: input.mint }), onStep);
}

export function acceptBid(
  input: { mint: string; bidder: string; minAmountLamports: bigint },
  onStep?: OnTxStep,
): Promise<TxResult> {
  return withFloorRetry(() =>
    withCollect(input.mint, onStep, () =>
      runTx(
        "accept",
        async (w) => ({
          wallet: w,
          mint: input.mint,
          bidder: input.bidder,
          minAmountLamports: lamports(input.minAmountLamports, "a bid"),
          ...(await sellerFloorInput(input.mint)),
        }),
        onStep,
      ),
    ),
  );
}

export async function listCard(
  input: { mint: string; priceLamports: bigint; expiresAt: number; voidOnEvolve: boolean },
  onStep?: OnTxStep,
): Promise<TxResult> {
  if (!Number.isInteger(input.expiresAt) || input.expiresAt < 0) {
    throw new ChainClientError("BAD_REQUEST", "Pick when the listing ends.");
  }
  return withFloorRetry(() =>
    runTx(
      "list",
      async (w) => ({
        wallet: w,
        mint: input.mint,
        priceLamports: lamports(input.priceLamports, "a price"),
        expiresAt: input.expiresAt,
        voidOnEvolve: input.voidOnEvolve,
        ...(await sellerFloorInput(input.mint)),
      }),
      onStep,
    ),
  );
}

export function delistCard(input: { mint: string }, onStep?: OnTxStep): Promise<TxResult> {
  return runTx("delist", (w) => ({ wallet: w, mint: input.mint }), onStep);
}

export function buyNow(
  input: { mint: string; expectedPriceLamports: bigint; cancelOwnBid: boolean },
  onStep?: OnTxStep,
): Promise<TxResult> {
  return withFloorRetry(() =>
    withCollect(input.mint, onStep, () =>
      runTx(
        "buy-now",
        (w) => ({
          wallet: w,
          mint: input.mint,
          expectedPriceLamports: lamports(input.expectedPriceLamports, "a price"),
          cancelOwnBid: input.cancelOwnBid,
        }),
        onStep,
      ),
    ),
  );
}

// ---------------------------------------------------------------- launch

interface LaunchForm {
  name: string;
  symbol: string;
  description: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  devBuyLamports: bigint;
  slippageBps: number;
}

function checkLaunchInput(input: LaunchInput): LaunchForm {
  const name = input.name.trim();
  const nameBytes = new TextEncoder().encode(name).length;
  if (nameBytes < 1 || nameBytes > API_LIMITS.nameMaxBytes) {
    throw new ChainClientError("INVALID_NAME", "Names can be 1 to 32 bytes long.");
  }
  const symbol = input.symbol.trim();
  if (!new RegExp(API_LIMITS.symbolPattern).test(symbol)) {
    throw new ChainClientError("INVALID_SYMBOL", "Tickers are 2 to 10 capital letters or digits.");
  }
  const description = input.description.trim();
  if (description.length > API_LIMITS.descriptionMaxChars) {
    throw new ChainClientError("INVALID_DESCRIPTION", "Descriptions can be up to 400 characters.");
  }
  const link = (v: string | undefined) => {
    const t = (v ?? "").trim();
    if (!t) return undefined;
    if (!/^https:\/\/\S+$/.test(t) || t.length > API_LIMITS.linkMaxChars) {
      throw new ChainClientError("INVALID_LINK", "Links must start with https:// and fit in 200 characters.");
    }
    return t;
  };
  const devBuy = input.devBuyLamports;
  if (typeof devBuy !== "bigint" || devBuy < 0n || devBuy > BigInt(API_LIMITS.devBuyMaxLamports)) {
    throw new ChainClientError("INVALID_AMOUNT", "The dev buy can be 0 to 1 SOL.");
  }
  return {
    name,
    symbol,
    description,
    twitter: link(input.twitter),
    website: link(input.website),
    telegram: link(input.telegram),
    devBuyLamports: devBuy,
    slippageBps: slippage(input.slippageBps),
  };
}

/**
 * Sign in → upload art → prepare (server_first, or wallet_first when this wallet needs it) → verify → sign →
 * compare → finalize → poll until confirmed and indexed. WALLET_REWROTE_TX in server_first retries once in
 * wallet_first, and only a successful wallet_first launch remembers the mode (wallet-modes.ts).
 */
export async function launchCoin(input: LaunchInput, onStep?: OnTxStep): Promise<LaunchResult> {
  const { address, walletName } = requireWallet();
  const form = checkLaunchInput(input);
  onStep?.({ step: "signing-in" });
  if (!getSession()) await signIn();
  onStep?.({ step: "uploading" });
  const media = await uploadMedia(input.image);
  const first = getWalletMode(walletName);
  try {
    return await launchOnce(form, media.image.key, first, address, onStep);
  } catch (e) {
    if (first !== "server_first" || !isChainError(e, "WALLET_REWROTE_TX")) throw e;
    const result = await launchOnce(form, media.image.key, "wallet_first", address, onStep);
    rememberWalletFirst(walletName);
    return result;
  }
}

async function launchOnce(
  form: LaunchForm,
  imageKey: string,
  mode: ApiSigningMode,
  address: string,
  onStep?: OnTxStep,
): Promise<LaunchResult> {
  onStep?.({ step: "building" });
  const req: ApiLaunchPrepareRequest = {
    name: form.name,
    symbol: form.symbol,
    description: form.description,
    imageKey,
    twitter: form.twitter,
    website: form.website,
    telegram: form.telegram,
    devBuyLamports: form.devBuyLamports.toString(),
    slippageBps: form.slippageBps,
    mode,
    // fix pack F8: ask for the Metaplex card verified into the MintDex collection; this client verifies that and every
    // older standard, and the verifier checks whichever register instruction the Worker built (it falls back when the
    // Config or the lookup tables do not allow the newest)
    cardStandard: "metaplex-collection",
  };
  const prep = await prepareLaunch(req);
  const base = { intentId: prep.intentId, summary: prep.summary };
  onStep?.({ step: "verifying", ...base });
  const prepared = await prepareLaunchVerification(form, prep, address);
  const unsigned = decodeTx(prep.tx);
  const out = checkPrepared(unsigned, prepared);
  if (!out.ok) throw verifyFailed(out);
  onStep?.({ step: "signing", ...base });
  // A wallet that rewrites the message (priority fee) voids the server's mint signature: the re-verification drops
  // the presigned requirement and finalize re-checks and re-signs (§3.5 step 4).
  const { signed } = await signAndCheck(unsigned, prepared, address);
  onStep?.({ step: "submitting", ...base });
  const fin = await withSession((token) =>
    apiCall<ApiLaunchFinalizeResponse>("launchFinalize", {
      body: { intentId: prep.intentId, tx: bytesToBase64(signed) },
      token,
      timeoutMs: 30_000,
    }),
  );
  onStep?.({ step: "confirming", ...base, signature: fin.signature });
  await confirmLaunch(prep.intentId, prep.expiresAt);
  onStep?.({ step: "confirmed", ...base, signature: fin.signature });
  const result: LaunchResult = { ...base, signature: fin.signature, slot: null, mint: prep.mint, mode: prep.mode };
  // admin B6: the dev buy did not fit in the launch transaction; it goes now as a normal, verified buy
  if (prep.devBuySplit && form.devBuyLamports > 0n) {
    try {
      const b = await buy({ mint: prep.mint, solLamports: form.devBuyLamports, slippageBps: form.slippageBps }, onStep);
      result.devBuy = { split: true, ok: true, signature: b.signature };
    } catch (e) {
      result.devBuy = { split: true, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return result;
}

/**
 * True for the BAD_REQUEST a Worker older than the fix pack answers when it does not know a card standard ("cardStandard
 * is metaplex or token2022"). Exported for tests.
 */
export function isUnknownCardStandard(e: unknown): boolean {
  return isChainError(e, "BAD_REQUEST") && /cardStandard/i.test(e.message);
}

/**
 * launch prepare (review round 2): the site and the chain Worker deploy separately. When a Worker that predates the
 * fix pack refuses "metaplex-collection", the prepare is asked once more for the plain Metaplex card it knows; the
 * verifier checks whatever register instruction comes back, so nothing weaker can slip through. Exported for tests.
 */
export async function prepareLaunch(
  req: ApiLaunchPrepareRequest,
  call: (body: ApiLaunchPrepareRequest) => Promise<ApiLaunchPrepareResponse> = (body) =>
    withSession((token) => apiCall<ApiLaunchPrepareResponse>("launchPrepare", { body, token, timeoutMs: 30_000 })),
): Promise<ApiLaunchPrepareResponse> {
  try {
    return await call(req);
  } catch (e) {
    if (req.cardStandard !== "metaplex-collection" || !isUnknownCardStandard(e)) throw e;
    return call({ ...req, cardStandard: "metaplex" });
  }
}

/** Polls GET /launch/:intentId every second until confirmed and indexed (at most 30 s of indexing wait, C2). */
async function confirmLaunch(intentId: string, expiresAt: number): Promise<void> {
  const start = Date.now();
  const deadline = Math.max(start + 90_000, expiresAt * 1000 + 45_000);
  let confirmedAt = 0;
  for (;;) {
    await sleep(FLOW_TIMING.pollMs);
    try {
      const st = await getLaunchStatus(intentId);
      if (st.status === "confirmed") {
        if (st.coinIndexed) return;
        confirmedAt ||= Date.now();
        if (Date.now() - confirmedAt > FLOW_TIMING.indexWaitMs) return;
      } else if (st.status === "failed") {
        throw st.error ? new ChainClientError(st.error.code, st.error.message, { apiError: st.error }) : txFailed(null);
      } else if (st.status === "expired") {
        throw confirmTimeout();
      }
    } catch (e) {
      if (!isChainError(e, ...TRANSIENT, "INTENT_NOT_FOUND")) throw e;
    }
    if (!confirmedAt && Date.now() > deadline) throw confirmTimeout();
  }
}
