import { createFileRoute } from "@tanstack/react-router";
import { composeLiveAssets } from "../../../lib/carddex/live/composition.server";
import { liveTokenFromRequest, requireLiveWallet } from "../../../lib/carddex/live/auth.server";
import { assertLiveOrigin } from "../../../lib/carddex/live/config.server";
import { UserError } from "../../../lib/mintdex/server/db.server";

export const Route = createFileRoute("/api/live/compose")({server: {handlers: {POST: async ({request}) => {
  try {
    assertLiveOrigin(request.headers.get("origin"));
    const wallet = await requireLiveWallet(liveTokenFromRequest(request));
    if (Number(request.headers.get("content-length") ?? 0) > 5 * 1024 * 1024) throw new UserError("The creator artwork exceeds the upload limit.");
    const form = await request.formData(), input = form.get("input"), artwork = form.get("artwork");
    if (typeof input !== "string" || input.length > 10_000 || !(artwork instanceof File)) throw new UserError("Upload the creator artwork with its token details.");
    const assets = await composeLiveAssets(wallet.wallet, JSON.parse(input), artwork);
    return Response.json({ok: true, assets}, {headers: {"cache-control": "no-store"}});
  } catch (error) {
    if (!(error instanceof UserError)) console.error("Live card composition failed", error);
    return Response.json({ok: false, error: error instanceof UserError ? error.message : "The public card composition failed."}, {status: 400, headers: {"cache-control": "no-store"}});
  }
}}}});
