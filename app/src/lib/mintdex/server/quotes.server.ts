import { TRADED_PAIRS, getPairAsset, resolveNewLaunchPair } from "../../carddex/pairs";
import { demoQuoteStartBalance } from "../../carddex/quote-simulation";
import type { QuoteIdentity } from "../types";
import { UserError, all, one, stmt } from "./db.server";

export function quoteIdentity(asset: ReturnType<typeof getPairAsset>): QuoteIdentity {
  return { quoteAssetKey: asset.key, quoteMint: asset.mint, quoteSymbol: asset.symbol, quoteDecimals: asset.decimals, quoteTokenProgram: asset.tokenProgram };
}

export function resolveStoredQuote(row: { quote_asset_key: string; quote_mint: string }) {
  try {
    const asset = getPairAsset(row.quote_asset_key);
    if (asset.mint !== row.quote_mint) throw new Error("Stored quote identity does not match the verified registry.");
    return asset;
  } catch (error) { throw new UserError(error instanceof Error ? error.message : "Unsupported quote asset."); }
}

/** A new demo launch: the pair picks the card (pairs.ts resolveNewLaunchPair); a mismatched design is refused. */
export function newLaunchPair(input: { cardTemplate?: string; quoteAssetKey?: string; quoteMint?: string }) {
  try { return resolveNewLaunchPair(input); }
  catch (error) { throw new UserError(error instanceof Error ? error.message : "Pick a supported pair."); }
}

/**
 * One-time local test funds only. SOL remains in users.balance; each SPL quote has its own ledger. The pairs coins can
 * trade in (offered now or before: pairs.ts TRADED_PAIRS); a user made before a pair was offered gets its funds on the
 * next read (existing balances are never touched). One statement however many pairs there are (a batch of one insert
 * per pair would count each toward D1's per-invocation query limit); every start balance is a safe integer.
 */
export async function ensureDemoQuoteWallet(userId: string) {
  const existing = await one<{ n: number }>("SELECT COUNT(*) AS n FROM quote_balances WHERE user_id = ?", userId);
  if ((existing?.n ?? 0) >= TRADED_PAIRS.length - 1) return;
  const funds = Object.fromEntries(TRADED_PAIRS.filter(asset => asset.key !== "sol").map(asset => [asset.key, demoQuoteStartBalance(asset.key)]));
  await stmt(
    "INSERT OR IGNORE INTO quote_balances (user_id, quote_asset_key, balance) SELECT users.id, funds.key, funds.value FROM users, json_each(?) AS funds WHERE users.id = ?",
    JSON.stringify(funds), userId,
  ).run();
}

export async function demoQuoteBalances(user: { id: string; balance: number }): Promise<Record<string, number>> {
  await ensureDemoQuoteWallet(user.id);
  const rows = await all<{ quote_asset_key: string; balance: number }>("SELECT quote_asset_key, balance FROM quote_balances WHERE user_id = ?", user.id);
  return { ...Object.fromEntries(rows.map(row => [row.quote_asset_key, row.balance])), sol: user.balance };
}
