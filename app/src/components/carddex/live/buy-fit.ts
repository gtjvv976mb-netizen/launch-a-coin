import { useQuery } from "@tanstack/react-query";
import { checkLiveLaunchSize } from "../../../lib/carddex/live/api";

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
export function useLiveBuyFit(active: boolean, name: string, symbol: string, quoteAssetKey: string): boolean | null | undefined {
  const query = useQuery({ queryKey: liveBuyFitKey(name, symbol, quoteAssetKey), enabled: active, staleTime: 60_000, retry: false,
    queryFn: async () => { const result = await checkLiveBuyFit(name, symbol, quoteAssetKey); return result.ok ? result : null; } });
  return !active ? undefined : query.data === null ? null : query.data?.buyFits;
}
