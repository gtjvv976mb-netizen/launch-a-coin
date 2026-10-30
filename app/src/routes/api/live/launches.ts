import { createFileRoute } from "@tanstack/react-router";
import { serveLiveLaunches } from "../../../lib/carddex/live/launches.server";

/** Public and read-only: the finished mainnet launches, or one creator's (?creator=<wallet>). */
export const Route = createFileRoute("/api/live/launches")({
  server: { handlers: { GET: ({ request }) => serveLiveLaunches(request) } },
});
