import { useQuery } from "@tanstack/react-query";
import { checkLiveLaunchSize } from "../../../lib/carddex/live/api";

export { BUY_DOES_NOT_FIT } from "../../../lib/carddex/live/copy";
export const liveBuyFitKey = (name: string, symbol: string, quoteAssetKey: string) => ["live-buy-fit", name.trim(), symbol, quoteAssetKey] as const;
/** Exact size check for a signed-in creator. The buy amount never changes the size, so any nonzero amount answers it. */
export function checkLiveBuyFit(name: string, symbol: string, quoteAssetKey: string, initialBuyQuoteBaseUnits = "1") {
  return checkLiveLaunchSize({ data: { name: name.trim(), symbol, quoteAssetKey, initialBuyQuoteBaseUnits } });
}
/**
 * Whether this pair, name and symbol leave room for an initial buy in the one coin transaction. Undefined while
 * unknown (loading, not signed in yet or inactive); the panel checks again after sign-in, before any upload.
 */
export function useLiveBuyFit(active: boolean, name: string, symbol: string, quoteAssetKey: string): boolean | undefined {
  const query = useQuery({ queryKey: liveBuyFitKey(name, symbol, quoteAssetKey), enabled: active, staleTime: 60_000, retry: false,
    queryFn: async () => { const result = await checkLiveBuyFit(name, symbol, quoteAssetKey); return result.ok ? result : null; } });
  return active ? query.data?.buyFits : undefined;
}
