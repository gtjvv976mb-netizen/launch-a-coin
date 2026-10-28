import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { MODE, type Mode } from "../mintdex/mode";
import type { DisplayQuoteSource, QuoteVenue } from "./display-quotes";

export const QUOTE_REFRESH_MS = 20_000;
export const QUOTE_MAX_AGE_MS = 45_000;

/** A quote snapshot expires even when the browser's RPC becomes unreachable. */
export function currentQuoteSource(
  source: DisplayQuoteSource | null | undefined,
  now = Date.now(),
): DisplayQuoteSource | null {
  return source && now >= source.readAt && now - source.readAt < QUOTE_MAX_AGE_MS ? source : null;
}

/** Launch reserves may change on either cluster. Devnet trade estimates still use the API's current coin state. */
export function displayQuoteEnabled(venue: QuoteVenue, mode: Mode = MODE): boolean {
  return mode === "mainnet" || (mode === "devnet" && venue === "launch");
}

export function useDisplayQuoteSource(
  venue: QuoteVenue,
  mint?: string,
  enabled = true,
): DisplayQuoteSource | null {
  const { data } = useQuery({
    queryKey: ["chain-display-quote", venue, mint ?? ""],
    queryFn: async () =>
      import.meta.env.SSR
        ? null
        : (await import("./display-quotes")).readDisplayQuoteSource(venue, mint),
    enabled: displayQuoteEnabled(venue) && typeof window !== "undefined" && enabled,
    staleTime: QUOTE_REFRESH_MS,
    gcTime: 60_000,
    refetchInterval: QUOTE_REFRESH_MS,
    retry: false,
  });
  const [, tick] = useState(0);
  useEffect(() => {
    if (!data || !enabled) return;
    const timer = setTimeout(
      () => tick((n) => n + 1),
      Math.max(0, data.readAt + QUOTE_MAX_AGE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [data, enabled]);
  return enabled ? currentQuoteSource(data) : null;
}
