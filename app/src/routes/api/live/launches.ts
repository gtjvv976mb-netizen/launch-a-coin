import { createFileRoute } from "@tanstack/react-router";
import { serveLiveLaunches } from "../../../lib/carddex/live/launches.server";

/** Public and read-only: the finished mainnet launches Home lists under "Launched on pump.fun". */
export const Route = createFileRoute("/api/live/launches")({
  server: { handlers: { GET: () => serveLiveLaunches() } },
});
