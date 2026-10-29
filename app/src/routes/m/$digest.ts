import { createFileRoute } from "@tanstack/react-router";
import { serveLiveMetadata } from "../../lib/carddex/live/assets.server";
export const Route = createFileRoute("/m/$digest")({server: {handlers: {GET: ({params, request}) => serveLiveMetadata(params.digest, request)}}});
