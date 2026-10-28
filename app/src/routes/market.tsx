import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy links lead to the token directory; CardDex has no NFT resale market. */
export const Route = createFileRoute("/market")({
  validateSearch: (raw: Record<string, unknown>): { view?: "listed" | "bids"; page?: number } => ({}),
  beforeLoad: () => { throw redirect({ to: "/discover", replace: true }); },
});
