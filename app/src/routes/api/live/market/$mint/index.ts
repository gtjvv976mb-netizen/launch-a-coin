import { createFileRoute } from "@tanstack/react-router";
import { serveCoinMarket } from "../../../../../lib/carddex/live/market.server";

/** Public and read-only: a launched coin's price, curve, 24-hour stats, trades and holders (market.server.ts). */
export const Route = createFileRoute("/api/live/market/$mint/")({
  server: { handlers: { GET: ({ request, params }) => serveCoinMarket(request, params.mint) } },
});
