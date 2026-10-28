import { createFileRoute } from "@tanstack/react-router";
import { serveLiveHealth } from "../../../lib/carddex/live/health.server";

export const Route = createFileRoute("/api/live/health")({ server: { handlers: { GET: () => serveLiveHealth() } } });
