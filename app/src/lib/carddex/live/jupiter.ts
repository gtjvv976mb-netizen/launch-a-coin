/**
 * Asking Jupiter (lite-api.jup.ag, keyless; it allows cross-origin reads) for a SOL swap that delivers exactly the
 * quote a token pair's initial buy is short of. Read in the creator's browser: Jupiter limits each address to a few
 * calls every ten seconds, which the Worker's shared addresses would exhaust. Nothing it returns is trusted: the server
 * keeps only an allowlist of its instructions, compiles the transaction itself and simulates it (integrations/pumpfun/
 * src/swap.ts) before the wallet sees anything.
 */
import type { JupiterSwapInstructions } from "../../../../../integrations/pumpfun/src/swap";

export const JUPITER_API = "https://lite-api.jup.ag/swap/v1";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
/** Price movement allowed between the quote and the swap landing: Jupiter's route fails rather than pay more. */
export const SWAP_SLIPPAGE_BPS = 100;
/** Keeps the route small enough for one transaction with room for a wallet's own checks. */
const MAX_ACCOUNTS = 40;
const TIMEOUT_MS = 10_000;

export type JupiterQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string; swapMode: string; routePlan?: { swapInfo?: { label?: string } }[] } & Record<string, unknown>;
export class JupiterUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "JupiterUnavailable"; }
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function call(send: Fetch, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try { response = await send(url, { ...init, credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal }); }
  catch { throw new JupiterUnavailable("Jupiter could not be reached. Try again in a moment."); }
  finally { clearTimeout(timer); }
  const body = await response.json().catch(() => null) as { errorCode?: string; error?: string } | null;
  if (response.status === 429) throw new JupiterUnavailable("Jupiter is busy. Wait a few seconds and try again.");
  if (!response.ok) {
    if (body?.errorCode === "NO_ROUTES_FOUND" || body?.errorCode === "COULD_NOT_FIND_ANY_ROUTE") throw new JupiterUnavailable("Jupiter has no route to buy this token with SOL right now. Get it elsewhere, or set the initial buy to 0.");
    throw new JupiterUnavailable("Jupiter could not price this swap right now. Try again in a moment.");
  }
  return body;
}

/** An exact-output quote: `amount` of the pair's token for as little SOL as Jupiter finds. */
export async function quoteSolFor(outputMint: string, amount: bigint, send: Fetch = (u, i) => globalThis.fetch(u, i)): Promise<JupiterQuote> {
  const url = `${JUPITER_API}/quote?inputMint=${WSOL_MINT}&outputMint=${outputMint}&amount=${amount}&swapMode=ExactOut&slippageBps=${SWAP_SLIPPAGE_BPS}&maxAccounts=${MAX_ACCOUNTS}`;
  const quote = await call(send, url, { method: "GET", headers: { accept: "application/json" } }) as JupiterQuote;
  if (quote?.swapMode !== "ExactOut" || BigInt(quote.outAmount ?? "0") < amount) throw new JupiterUnavailable("Jupiter's quote did not cover the amount needed. Try again.");
  return quote;
}

/** The quote's instructions for this wallet (no transaction: the server builds that). */
export async function swapInstructions(quote: JupiterQuote, wallet: string, send: Fetch = (u, i) => globalThis.fetch(u, i)): Promise<JupiterSwapInstructions> {
  const body = { quoteResponse: quote, userPublicKey: wallet, wrapAndUnwrapSol: true, useSharedAccounts: true };
  const answer = await call(send, `${JUPITER_API}/swap-instructions`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }) as JupiterSwapInstructions & { simulationError?: unknown };
  if (!answer?.swapInstruction) throw new JupiterUnavailable("Jupiter did not return a swap. Try again in a moment.");
  return {
    computeBudgetInstructions: answer.computeBudgetInstructions ?? null, setupInstructions: answer.setupInstructions ?? null,
    swapInstruction: answer.swapInstruction, cleanupInstruction: answer.cleanupInstruction ?? null, otherInstructions: answer.otherInstructions ?? null,
    tokenLedgerInstruction: answer.tokenLedgerInstruction ?? null, addressLookupTableAddresses: answer.addressLookupTableAddresses ?? null,
  };
}
