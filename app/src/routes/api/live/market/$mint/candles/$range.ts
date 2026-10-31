import { createFileRoute } from "@tanstack/react-router";
import { serveCoinCandles } from "../../../../../../lib/carddex/live/market.server";

/** Public and read-only: a launched coin's candles for one range (1m, 5m, 15m, 1h, 4h, 1d; market.server.ts). */
export const Route = createFileRoute("/api/live/market/$mint/candles/$range")({
  server: { handlers: { GET: ({ request, params }) => serveCoinCandles(request, params.mint, params.range) } },
});
