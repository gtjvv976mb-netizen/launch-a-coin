import { createFileRoute } from "@tanstack/react-router";
import { serveLiveAsset } from "../../../../lib/carddex/live/assets.server";
export const Route = createFileRoute("/api/live/assets/$")({server: {handlers: {GET: ({params}) => serveLiveAsset(params._splat ?? "")}}});
