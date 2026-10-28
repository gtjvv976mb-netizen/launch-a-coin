import { PAIR_ASSETS, getPairAsset, resolveLaunchQuote } from "../../carddex/pairs";
import { demoQuoteStartBalance } from "../../carddex/quote-simulation";
import type { QuoteIdentity } from "../types";
import { UserError, all, db, one, stmt } from "./db.server";

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

export function launchQuote(design: string, input: { quoteAssetKey?: string; quoteMint?: string }) {
  try { return resolveLaunchQuote(design, input); }
  catch (error) { throw new UserError(error instanceof Error ? error.message : "Choose a compatible quote asset."); }
}

/** One-time local test funds only. SOL remains in users.balance; each SPL quote has its own ledger. */
export async function ensureDemoQuoteWallet(userId: string) {
  const existing = await one<{ n: number }>("SELECT COUNT(*) AS n FROM quote_balances WHERE user_id = ?", userId);
  if ((existing?.n ?? 0) >= PAIR_ASSETS.length - 1) return;
  await db().batch(PAIR_ASSETS.filter(asset => asset.key !== "sol").map(asset => stmt(
    "INSERT OR IGNORE INTO quote_balances (user_id, quote_asset_key, balance) SELECT id, ?, ? FROM users WHERE id = ?",
    asset.key, demoQuoteStartBalance(asset.key), userId,
  )));
}

export async function demoQuoteBalances(user: { id: string; balance: number }): Promise<Record<string, number>> {
  await ensureDemoQuoteWallet(user.id);
  const rows = await all<{ quote_asset_key: string; balance: number }>("SELECT quote_asset_key, balance FROM quote_balances WHERE user_id = ?", user.id);
  return { ...Object.fromEntries(rows.map(row => [row.quote_asset_key, row.balance])), sol: user.balance };
}
