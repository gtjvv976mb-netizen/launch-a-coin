import { createFileRoute } from "@tanstack/react-router";
import { selfCheck } from "../../../lib/carddex/live/assets.server";
import { serveLiveHealth } from "../../../lib/carddex/live/health.server";
import { edgeCached } from "../../../lib/edge-cache";

// Public and keyless, so each colo answers from its edge cache for a few seconds (SEC-11): uptime checks and floods
// spend at most one RPC probe (or one pair of own-origin reads for ?self=1) per colo per window. Every answer still
// tells the client not to store it.
export const Route = createFileRoute("/api/live/health")({ server: { handlers: { GET: ({ request }) => new URL(request.url).searchParams.has("self")
  ? edgeCached(request, "/api/live/health?self=1", 30, selfCheck)
  : edgeCached(request, "/api/live/health", 15, serveLiveHealth) } } });
