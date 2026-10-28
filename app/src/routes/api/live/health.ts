import { createFileRoute } from "@tanstack/react-router";
import { selfCheck } from "../../../lib/carddex/live/assets.server";
import { serveLiveHealth } from "../../../lib/carddex/live/health.server";

export const Route = createFileRoute("/api/live/health")({ server: { handlers: { GET: ({ request }) => new URL(request.url).searchParams.has("self") ? selfCheck() : serveLiveHealth() } } });
