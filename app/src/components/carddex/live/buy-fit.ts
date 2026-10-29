import { useQuery } from "@tanstack/react-query";
import { checkLiveLaunchSize } from "../../../lib/carddex/live/api";

import { BUY_DOES_NOT_FIT, STOCK_BUY_WARNS } from "../../../lib/carddex/live/copy";

export { BUY_DOES_NOT_FIT, BUY_FIT_AFTER_SIGN_IN, STOCK_BUY_WARNS } from "../../../lib/carddex/live/copy";
export const LIVE_BUY_FIT = "live-buy-fit";
export const liveBuyFitKey = (name: string, symbol: string, quoteAssetKey: string) => [LIVE_BUY_FIT, name.trim(), symbol, quoteAssetKey] as const;
/** Exact size check for a signed-in creator. The buy amount never changes the size, so any nonzero amount answers it. */
export function checkLiveBuyFit(name: string, symbol: string, quoteAssetKey: string, initialBuyQuoteBaseUnits = "1") {
  return checkLiveLaunchSize({ data: { name: name.trim(), symbol, quoteAssetKey, initialBuyQuoteBaseUnits } });
}
/**
 * Whether this pair, name and symbol leave room for an initial buy in the one coin transaction. Undefined while
 * loading or inactive; null when the server gave no answer (not signed in yet, or the check failed). Sign-in
 * refetches it, and the panel checks again after sign-in, before any upload.
 */
function useLiveBuyFitQuery(active: boolean, name: string, symbol: string, quoteAssetKey: string) {
  return useQuery({ queryKey: liveBuyFitKey(name, symbol, quoteAssetKey), enabled: active, staleTime: 60_000, retry: false,
    queryFn: async () => { const result = await checkLiveBuyFit(name, symbol, quoteAssetKey); return result.ok ? result : null; } });
}
export function useLiveBuyFit(active: boolean, name: string, symbol: string, quoteAssetKey: string): boolean | null | undefined {
  const query = useLiveBuyFitQuery(active, name, symbol, quoteAssetKey);
  return !active ? undefined : query.data === null ? null : query.data?.buyFits;
}
/** Why the coin transaction cannot carry an initial buy, as the copy to show, or null when it can. */
export function liveBuyRefusal(size: { buyFits: boolean; buyBlocked?: string | null }): string | null {
  return size.buyFits ? null : size.buyBlocked === "issuer-controls" ? STOCK_BUY_WARNS : BUY_DOES_NOT_FIT;
}
/**
 * The same size check as useLiveBuyFit (one shared query), answered as the refusal copy: STOCK_BUY_WARNS for a
 * tokenized-stock quote, BUY_DOES_NOT_FIT for size, null when the buy fits. Undefined while loading or inactive, and
 * when the server gave no answer.
 */
export function useLiveBuyRefusal(active: boolean, name: string, symbol: string, quoteAssetKey: string): string | null | undefined {
  const query = useLiveBuyFitQuery(active, name, symbol, quoteAssetKey);
  return !active || !query.data ? undefined : liveBuyRefusal(query.data);
}
